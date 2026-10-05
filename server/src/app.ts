import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { MissionStatus, MissionType, Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "./env.js";
import { prisma } from "./db.js";
import {
  completeMission,
  getCurrentPeriod,
  getFlightStatus,
  getRankings,
  getSetting,
  recordFlight,
  referralUrl,
  totalPoints,
  totalPointsForPeriod,
} from "./domain.js";
import { createReferralCode, createRedirectToken, hashIp, verifyRedirectToken } from "./security.js";
import { addDateKeys, localDateKey, localMidnightUtc } from "./time.js";
import { secondsRemainingForMinimum } from "./rules.js";
import { AuthenticationError, validateTelegramInitData, type TelegramIdentity } from "./telegram-auth.js";
import { bot } from "./telegram-bot.js";

const app = express();
const applicationDirectory = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
app.set("trust proxy", env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: env.NODE_ENV === "production" ? env.APP_ORIGIN : [env.APP_ORIGIN, "http://localhost:5173"],
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Telegram-Init-Data", "X-Admin-Secret", "X-Telegram-Bot-Api-Secret-Token"],
}));
app.use(express.json({ limit: "32kb" }));

const ipLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (request) => ipKeyGenerator(request.ip || "unknown"),
});
const userLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id ?? ipKeyGenerator(request.ip || "unknown"),
});
app.use("/api", ipLimiter);

async function authenticate(request: Request, response: Response, next: NextFunction) {
  try {
    const rawInitData = request.header("X-Telegram-Init-Data");
    if (!rawInitData) {
      response.status(401).json({ error: "Buka AviaX dari Telegram untuk melanjutkan." });
      return;
    }

    let identity: TelegramIdentity;
    try {
      identity = validateTelegramInitData(rawInitData);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        response.status(401).json({ error: error.message });
        return;
      }
      throw error;
    }

    const ipHash = hashIp(request.ip || "unknown");
    let user = await prisma.user.findUnique({ where: { telegramId: identity.telegramId } });
    let newUser = false;
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          username: identity.username,
          firstName: identity.firstName,
          lastSeenIpHash: ipHash,
        },
      });
    } else {
      try {
        const created = await prisma.$transaction(async (tx) => {
          const concurrentUser = await tx.user.findUnique({
            where: { telegramId: identity.telegramId },
          });
          if (concurrentUser) {
            return {
              user: await tx.user.update({
                where: { id: concurrentUser.id },
                data: {
                  username: identity.username,
                  firstName: identity.firstName,
                  lastSeenIpHash: ipHash,
                },
              }),
              created: false,
            };
          }

          const start = identity.startParam?.startsWith("ref_")
            ? identity.startParam.slice("ref_".length)
            : null;
          const referrer = start
            ? await tx.user.findUnique({ where: { referralCode: start } })
            : null;
          const settings = await tx.setting.findMany({
            where: { key: { in: ["timezone", "referralDailyLimit"] } },
          });
          const settingMap = new Map(settings.map((setting) => [setting.key, setting.value]));
          const timezone = settingMap.get("timezone");
          const dailyLimit = settingMap.get("referralDailyLimit");
          if (typeof timezone !== "string" || typeof dailyLimit !== "number") {
            throw new Error("Referral configuration is missing. Run the seed command.");
          }

          let referredById: string | null = null;
          if (referrer && referrer.telegramId !== identity.telegramId) {
            await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${referrer.id}::uuid FOR UPDATE`);
            const today = localDateKey(new Date(), timezone);
            const [dayStart, dayEnd] = [
              localMidnightUtc(today, timezone),
              localMidnightUtc(addDateKeys(today, 1), timezone),
            ];
            const friendsToday = await tx.referral.count({
              where: { referrerId: referrer.id, createdAt: { gte: dayStart, lt: dayEnd } },
            });
            if (friendsToday < dailyLimit) referredById = referrer.id;
          }

          const createdUser = await tx.user.create({
            data: {
              telegramId: identity.telegramId,
              username: identity.username,
              firstName: identity.firstName,
              groupCode: start ? null : identity.startParam?.slice(0, 64) ?? null,
              referralCode: createReferralCode(),
              lastSeenIpHash: ipHash,
              ...(referredById ? { referredById } : {}),
            },
          });
          if (referredById) {
            await tx.referral.create({
              data: { referrerId: referredById, referredId: createdUser.id },
            });
          } else if (referrer?.telegramId === identity.telegramId) {
            await tx.securityEvent.create({
              data: {
                kind: "self_referral_attempt",
                details: { userId: createdUser.id, ipHash },
              },
            });
          }
          return { user: createdUser, created: true };
        });
        user = created.user;
        newUser = created.created;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        const concurrentUser = await prisma.user.findUnique({
          where: { telegramId: identity.telegramId },
        });
        if (!concurrentUser) throw error;
        user = await prisma.user.update({
          where: { id: concurrentUser.id },
          data: {
            username: identity.username,
            firstName: identity.firstName,
            lastSeenIpHash: ipHash,
          },
        });
      }
    }

    if (newUser) {
      const sameIpAccounts = await prisma.user.count({ where: { lastSeenIpHash: ipHash } });
      if (sameIpAccounts >= 5) {
        await prisma.securityEvent.create({
          data: {
            kind: "multiple_accounts_same_ip",
            details: { ipHash, accountCount: sameIpAccounts },
          },
        });
      }
    }

    if (user.isBlocked) {
      response.status(403).json({ error: "Akun ini tidak dapat mengakses AviaX." });
      return;
    }
    request.user = user;
    request.ipHash = ipHash;
    next();
  } catch (error) {
    next(error);
  }
}

function requireUser(request: Request, response: Response): string | null {
  if (!request.user) {
    response.status(401).json({ error: "Sesi Telegram tidak valid." });
    return null;
  }
  return request.user.id;
}

function requireAgeConfirmed(request: Request, response: Response, next: NextFunction) {
  if (!request.user?.ageConfirmedAt) {
    response.status(403).json({ error: "Konfirmasi usia dibutuhkan sebelum bermain.", code: "AGE_CONFIRMATION_REQUIRED" });
    return;
  }
  next();
}

function adminOnly(request: Request, response: Response, next: NextFunction) {
  const supplied = request.header("X-Admin-Secret") ?? "";
  const expected = Buffer.from(env.ADMIN_SECRET);
  const provided = Buffer.from(supplied);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    response.status(401).json({ error: "Akses admin ditolak." });
    return;
  }
  next();
}

function escapeCsv(value: string | number | boolean | null | undefined) {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function maskedName(username: string | null, firstName: string) {
  const name = username ? `@${username}` : firstName;
  if (name.startsWith("@")) return `${name.slice(0, 3)}***`;
  return `${name.slice(0, 2)}***`;
}

const api = express.Router();
api.use(authenticate);
api.use(userLimiter);

api.get("/bootstrap", async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const [points, prizeText, period, timezone] = await Promise.all([
    totalPoints(userId),
    getSetting<string>("prizeText"),
    getCurrentPeriod(),
    getSetting<string>("timezone"),
  ]);
  response.json({
    user: {
      firstName: request.user?.firstName,
      username: request.user?.username,
      points,
      ageConfirmed: Boolean(request.user?.ageConfirmedAt),
      referralUrl: referralUrl(request.user?.referralCode ?? ""),
    },
    prizeText: prizeText.trim() ? prizeText : null,
    period: {
      startsAt: period.period.startsAt.toISOString(),
      endsAt: period.period.endsAt.toISOString(),
      secondsRemaining: period.secondsRemaining,
      timezone,
    },
  });
});

api.post("/age-confirm", async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const body = z.object({ confirm: z.literal(true) }).safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Konfirmasi usia tidak valid." });
    return;
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { ageConfirmedAt: request.user?.ageConfirmedAt ?? new Date() },
  });
  request.user = user;
  response.json({ ageConfirmed: true });
});

api.get("/missions", requireAgeConfirmed, async (request, response) => {
  const missions = await prisma.mission.findMany({
    where: { isActive: true },
    include: {
      prerequisite: { select: { id: true } },
      userMissions: { where: { userId: request.user?.id }, select: { status: true } },
    },
    orderBy: { orderIndex: "asc" },
  });
  const completedIds = new Set(
    await prisma.userMission.findMany({
      where: { userId: request.user?.id, status: MissionStatus.done },
      select: { missionId: true },
    }).then((rows) => rows.map((row) => row.missionId)),
  );

  response.json({
    missions: missions.map((mission) => {
      const state = mission.userMissions[0]?.status ?? MissionStatus.not_started;
      const locked = Boolean(mission.requiresMissionId && !completedIds.has(mission.requiresMissionId));
      return {
        id: mission.id,
        key: mission.key,
        title: mission.titleId,
        points: mission.points,
        type: mission.type,
        status: state,
        locked: state !== MissionStatus.done && locked,
      };
    }),
  });
});

const missionParams = z.object({ key: z.string().min(1).max(80) });

api.post("/missions/:key/start", requireAgeConfirmed, async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const params = missionParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "Misi tidak valid." });
    return;
  }
  const mission = await prisma.mission.findUnique({
    where: { key: params.data.key, isActive: true },
    include: { prerequisite: { select: { id: true } } },
  });
  if (!mission) {
    response.status(404).json({ error: "Misi tidak ditemukan." });
    return;
  }
  if (mission.requiresMissionId) {
    const prerequisite = await prisma.userMission.findUnique({
      where: {
        userId_missionId: { userId, missionId: mission.requiresMissionId },
      },
      select: { status: true },
    });
    if (prerequisite?.status !== MissionStatus.done) {
      response.status(409).json({ error: "Selesaikan misi sebelumnya dulu.", code: "MISSION_LOCKED" });
      return;
    }
  }

  const existing = await prisma.userMission.findUnique({
    where: { userId_missionId: { userId, missionId: mission.id } },
  });
  if (existing?.status === MissionStatus.done) {
    response.json({ status: MissionStatus.done });
    return;
  }
  const userMission = await prisma.userMission.upsert({
    where: { userId_missionId: { userId, missionId: mission.id } },
    create: { userId, missionId: mission.id, status: MissionStatus.checking, startedAt: new Date() },
    update: existing?.status === MissionStatus.checking
      ? {}
      : { status: MissionStatus.checking, startedAt: new Date() },
  });

  const config = mission.config as Prisma.JsonObject;
  if (mission.type === MissionType.VISIT_LINK) {
    response.json({
      status: userMission.status,
      redirectUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/r/${createRedirectToken(userId, mission.id)}`,
    });
    return;
  }
  if (mission.type === MissionType.JOIN_CHANNEL) {
    response.json({ status: userMission.status, channelUrl: String(config.channel_url ?? env.TELEGRAM_CHANNEL_URL) });
    return;
  }
  response.json({
    status: userMission.status,
    minimumSeconds: Number(config.minimum_seconds ?? 0),
    ...(mission.type === MissionType.SOFT_CHECK && config.page_url
      ? { pageUrl: String(config.page_url) }
      : {}),
  });
});

api.post("/missions/:key/verify", requireAgeConfirmed, async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const params = missionParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "Misi tidak valid." });
    return;
  }
  const mission = await prisma.mission.findUnique({
    where: { key: params.data.key, isActive: true },
  });
  if (!mission) {
    response.status(404).json({ error: "Misi tidak ditemukan." });
    return;
  }
  const userMission = await prisma.userMission.findUnique({
    where: { userId_missionId: { userId, missionId: mission.id } },
  });
  if (userMission?.status === MissionStatus.done) {
    response.json({ status: MissionStatus.done });
    return;
  }
  if (!userMission?.startedAt) {
    response.status(409).json({ error: "Tekan MULAI dulu.", code: "MISSION_NOT_STARTED" });
    return;
  }

  if (mission.type === MissionType.JOIN_CHANNEL) {
    const config = mission.config as Prisma.JsonObject;
    const channelId = config.channel_id;
    if (typeof channelId !== "string" || !channelId) {
      response.status(503).json({ error: "Channel Telegram belum dikonfigurasi." });
      return;
    }
    const telegramUserId = Number(request.user?.telegramId);
    if (!Number.isSafeInteger(telegramUserId)) {
      response.status(401).json({ error: "Identitas Telegram tidak valid." });
      return;
    }
    const memberResponse = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: channelId, user_id: telegramUserId }),
      },
    );
    if (!memberResponse.ok) {
      response.status(503).json({ error: "Telegram belum bisa memeriksa keanggotaan. Coba lagi nanti." });
      return;
    }
    const memberBody = await memberResponse.json() as {
      ok: boolean;
      result?: { status?: string };
      description?: string;
    };
    if (!memberBody.ok) {
      response.status(503).json({ error: memberBody.description ?? "Pemeriksaan channel gagal." });
      return;
    }
    const isMember = ["member", "administrator", "creator"].includes(memberBody.result?.status ?? "");
    if (!isMember) {
      response.json({ status: MissionStatus.checking, retry: true, message: "Belum terdeteksi. Gabung dulu lalu coba lagi." });
      return;
    }
    if (Date.now() - userMission.startedAt.getTime() < 1000) {
      await prisma.securityEvent.create({
        data: {
          kind: "instant_mission_completion",
          details: { userId, missionKey: mission.key, ipHash: request.ipHash ?? null },
        },
      });
    }
  } else {
    const config = mission.config as Prisma.JsonObject;
    const minimumSeconds = mission.type === MissionType.DEMO_TIMER
      ? Math.max(60, Number(config.minimum_seconds ?? 60))
      : Number(config.minimum_seconds ?? 5);
    const remainingSeconds = secondsRemainingForMinimum(userMission.startedAt, new Date(), minimumSeconds);
    if (remainingSeconds > 0) {
      response.json({
        status: MissionStatus.checking,
        retryAfterSeconds: remainingSeconds,
      });
      return;
    }
    if (mission.type === MissionType.VISIT_LINK) {
      response.json({ status: MissionStatus.checking, retry: true });
      return;
    }
  }

  await prisma.$transaction((tx) =>
    completeMission(tx, userId, mission.id),
  );
  response.json({ status: MissionStatus.done });
});

api.get("/flight", requireAgeConfirmed, async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  response.json(await getFlightStatus(userId));
});

api.post("/flight", requireAgeConfirmed, async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const result = await recordFlight(userId);
  response.json({ ...result, flight: await getFlightStatus(userId) });
});

api.get("/leaderboard", requireAgeConfirmed, async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const periodInfo = await getCurrentPeriod();
  const [rankings, currentPoints] = await Promise.all([
    getRankings(periodInfo.period.startsAt, periodInfo.period.endsAt),
    totalPointsForPeriod(periodInfo.period.startsAt, periodInfo.period.endsAt, userId),
  ]);
  const userRank = currentPoints > 0
    ? rankings.find((entry) => entry.userId === userId)?.rank ?? null
    : null;

  response.json({
    entries: rankings.slice(0, 10).map((entry) => ({
      rank: entry.rank,
      displayName: maskedName(entry.username, entry.firstName),
      points: entry.points,
    })),
    me: { rank: userRank, points: currentPoints },
    period: {
      startsAt: periodInfo.period.startsAt.toISOString(),
      endsAt: periodInfo.period.endsAt.toISOString(),
      secondsRemaining: periodInfo.secondsRemaining,
    },
  });
});

api.get("/referrals", requireAgeConfirmed, async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const query = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0) }).safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Halaman daftar teman tidak valid." });
    return;
  }
  const timezone = await getSetting<string>("timezone");
  const today = localDateKey(new Date(), timezone);
  const start = localMidnightUtc(today, timezone);
  const end = localMidnightUtc(addDateKeys(today, 1), timezone);
  const pageSize = 50;
  const [countToday, dailyLimit, totalFriends, referrals] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId, createdAt: { gte: start, lt: end } } }),
    getSetting<number>("referralDailyLimit"),
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { username: true, firstName: true } } },
      orderBy: { createdAt: "desc" },
      skip: query.data.offset,
      take: pageSize,
    }),
  ]);
  response.json({
    referralUrl: referralUrl(request.user?.referralCode ?? ""),
    joinedToday: countToday,
    dailyLimit,
    totalFriends,
    nextOffset: query.data.offset + referrals.length < totalFriends
      ? query.data.offset + referrals.length
      : null,
    friends: referrals.map((referral) => ({
      displayName: maskedName(referral.referred.username, referral.referred.firstName),
      status: referral.status === "qualified" ? "qualified" : "joined",
      joinedAt: referral.createdAt.toISOString(),
    })),
  });
});

app.use("/r", ipLimiter);
app.get("/r/:token", async (request, response) => {
  const token = verifyRedirectToken(request.params.token ?? "");
  if (!token) {
    response.status(400).send("Tautan ini tidak valid atau sudah kedaluwarsa.");
    return;
  }
  const mission = await prisma.mission.findUnique({ where: { id: token.missionId, isActive: true } });
  const user = await prisma.user.findUnique({ where: { id: token.userId } });
  if (!mission || !user || user.isBlocked || !user.ageConfirmedAt || mission.type !== MissionType.VISIT_LINK) {
    response.status(404).send("Misi tidak ditemukan.");
    return;
  }
  const config = mission.config as Prisma.JsonObject;
  const targetUrl = new URL(String(config.target_url ?? env.AVIAX_TARGET_URL));
  if (targetUrl.protocol !== "https:") {
    response.status(500).send("Alamat tujuan misi tidak aman.");
    return;
  }
  const campaign = `aviax_${new Date().toISOString().slice(0, 7).replace("-", "")}`;
  targetUrl.searchParams.set("utm_source", "telegram");
  targetUrl.searchParams.set("utm_medium", user.groupCode ?? "organic");
  targetUrl.searchParams.set("utm_campaign", campaign);

  await prisma.$transaction(async (tx) => {
    await tx.linkClick.create({
      data: {
        userId: user.id,
        missionId: mission.id,
        ipHash: hashIp(request.ip || "unknown"),
        userAgent: request.header("user-agent")?.slice(0, 512) ?? null,
      },
    });
    await tx.userMission.upsert({
      where: { userId_missionId: { userId: user.id, missionId: mission.id } },
      create: { userId: user.id, missionId: mission.id, status: MissionStatus.checking, startedAt: new Date() },
      update: {},
    });
    await completeMission(tx, user.id, mission.id);
  });
  response.redirect(302, targetUrl.toString());
});

const admin = express.Router();
admin.use(adminOnly);

admin.get("/metrics", async (_request, response) => {
  const [
    users,
    points,
    clicks,
    missionCounts,
    prizeText,
    periodWeeks,
    timezone,
    missions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.pointsLedger.aggregate({ _sum: { delta: true } }),
    prisma.linkClick.count(),
    prisma.userMission.groupBy({
      by: ["missionId", "status"],
      _count: { _all: true },
    }),
    getSetting<string>("prizeText"),
    getSetting<number>("periodWeeks"),
    getSetting<string>("timezone"),
    prisma.mission.findMany({ orderBy: { orderIndex: "asc" } }),
  ]);
  response.json({
    totals: { users, points: points._sum.delta ?? 0, clicks },
    missionCounts,
    prizeText,
    periodWeeks,
    timezone,
    missions: missions.map((mission) => ({
      id: mission.id,
      key: mission.key,
      title: mission.titleId,
      points: mission.points,
      active: mission.isActive,
      type: mission.type,
      config: mission.config,
    })),
  });
});

admin.patch("/settings", async (request, response) => {
  const body = z.object({
    prizeText: z.string().max(200),
    periodWeeks: z.number().int().min(1).max(12),
    timezone: z.string().min(1).max(64),
  }).safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Pengaturan tidak valid." });
    return;
  }
  try {
    new Intl.DateTimeFormat("id-ID", { timeZone: body.data.timezone });
  } catch {
    response.status(400).json({ error: "Zona waktu tidak dikenal." });
    return;
  }
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: "prizeText" }, create: { key: "prizeText", value: body.data.prizeText }, update: { value: body.data.prizeText } }),
    prisma.setting.upsert({ where: { key: "periodWeeks" }, create: { key: "periodWeeks", value: body.data.periodWeeks }, update: { value: body.data.periodWeeks } }),
    prisma.setting.upsert({ where: { key: "timezone" }, create: { key: "timezone", value: body.data.timezone }, update: { value: body.data.timezone } }),
  ]);
  response.json({ saved: true });
});

admin.patch("/users/:telegramId", async (request, response) => {
  const params = z.object({ telegramId: z.string().regex(/^\d{1,20}$/) }).safeParse(request.params);
  const body = z.object({ blocked: z.boolean() }).safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Data akun tidak valid." });
    return;
  }
  const result = await prisma.user.updateMany({
    where: { telegramId: params.data.telegramId },
    data: { isBlocked: body.data.blocked },
  });
  if (result.count === 0) {
    response.status(404).json({ error: "Pemain tidak ditemukan." });
    return;
  }
  response.json({ saved: true });
});

admin.patch("/missions/:id", async (request, response) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z.object({
    title: z.string().min(1).max(120),
    points: z.number().int().min(0).max(100_000),
    active: z.boolean(),
    targetUrl: z.string().url().optional(),
    channelUrl: z.string().url().optional(),
    channelId: z.string().min(1).max(128).optional(),
    pageUrl: z.string().url().optional(),
    minimumSeconds: z.number().int().min(1).max(3600).optional(),
  }).safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Data misi tidak valid." });
    return;
  }
  const mission = await prisma.mission.findUnique({ where: { id: params.data.id } });
  if (!mission) {
    response.status(404).json({ error: "Misi tidak ditemukan." });
    return;
  }
  const config = { ...(mission.config as Prisma.JsonObject) };
  if (body.data.targetUrl) {
    const url = new URL(body.data.targetUrl);
    if (url.protocol !== "https:") {
      response.status(400).json({ error: "Tautan tujuan harus menggunakan HTTPS." });
      return;
    }
    config.target_url = url.toString();
  }
  for (const urlString of [body.data.channelUrl, body.data.pageUrl]) {
    if (urlString && new URL(urlString).protocol !== "https:") {
      response.status(400).json({ error: "Tautan misi harus menggunakan HTTPS." });
      return;
    }
  }
  if (body.data.channelUrl) config.channel_url = body.data.channelUrl;
  if (body.data.pageUrl) config.page_url = body.data.pageUrl;
  if (body.data.channelId) config.channel_id = body.data.channelId;
  if (body.data.minimumSeconds) config.minimum_seconds = body.data.minimumSeconds;
  if (body.data.active && mission.type === MissionType.JOIN_CHANNEL
    && (typeof config.channel_id !== "string" || !config.channel_id
      || typeof config.channel_url !== "string" || !config.channel_url)) {
    response.status(400).json({ error: "Isi ID dan tautan channel sebelum mengaktifkan misi." });
    return;
  }
  if (body.data.active && mission.type === MissionType.VISIT_LINK
    && (typeof config.target_url !== "string" || !config.target_url)) {
    response.status(400).json({ error: "Isi tautan tujuan sebelum mengaktifkan misi." });
    return;
  }
  if (body.data.active && mission.type === MissionType.SOFT_CHECK
    && (typeof config.page_url !== "string" || !config.page_url)) {
    response.status(400).json({ error: "Isi tautan fanpage sebelum mengaktifkan misi." });
    return;
  }
  if (mission.type === MissionType.DEMO_TIMER && Number(config.minimum_seconds ?? 60) < 60) {
    config.minimum_seconds = 60;
  }
  await prisma.mission.update({
    where: { id: mission.id },
    data: {
      titleId: body.data.title,
      points: body.data.points,
      isActive: body.data.active,
      config,
    },
  });
  response.json({ saved: true });
});

admin.get("/export.csv", async (_request, response) => {
  const users = await prisma.user.findMany({
    select: {
      telegramId: true,
      username: true,
      firstName: true,
      groupCode: true,
      createdAt: true,
      ageConfirmedAt: true,
      isBlocked: true,
      ledgerEntries: { select: { delta: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const rows = [
    ["telegram_id", "username", "first_name", "group_code", "created_at", "age_confirmed_at", "blocked", "total_points"],
    ...users.map((user) => [
      user.telegramId,
      user.username,
      user.firstName,
      user.groupCode,
      user.createdAt.toISOString(),
      user.ageConfirmedAt?.toISOString() ?? "",
      user.isBlocked,
      user.ledgerEntries.reduce((sum, entry) => sum + entry.delta, 0),
    ]),
  ];
  response
    .type("text/csv")
    .attachment("aviax-users.csv")
    .send(rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n"));
});

app.use("/api/admin", admin);

app.post("/api/telegram/webhook", async (request, response) => {
  const supplied = request.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const expected = Buffer.from(env.BOT_WEBHOOK_SECRET);
  const provided = Buffer.from(supplied);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    response.status(401).send("Unauthorized");
    return;
  }
  await bot.handleUpdate(request.body);
  response.sendStatus(200);
});

app.use("/api", api);

const publicDirectory = path.resolve(applicationDirectory, "../../dist");
if (existsSync(publicDirectory)) {
  app.use(express.static(publicDirectory, { index: false, maxAge: env.NODE_ENV === "production" ? "1h" : 0 }));
}

app.get("/healthz", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.json({ status: "ok" });
});

if (existsSync(publicDirectory)) {
  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/") || request.path.startsWith("/r/")) {
      next();
      return;
    }
    response.sendFile(path.join(publicDirectory, "index.html"));
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (
    error instanceof SyntaxError
    && "status" in error
    && error.status === 400
  ) {
    response.status(400).json({ error: "Isi permintaan tidak valid." });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    response.status(409).json({ error: "Permintaan ini sudah diproses." });
    return;
  }
  console.error("Request failed", error);
  response.status(500).json({ error: "Terjadi gangguan. Coba lagi sebentar." });
});

export { app };
