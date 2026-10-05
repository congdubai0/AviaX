import "dotenv/config";
import { PrismaClient, MissionType } from "@prisma/client";

const prisma = new PrismaClient();
const channelUrl = process.env.TELEGRAM_CHANNEL_URL || "https://t.me/";
const targetUrl = process.env.AVIAX_TARGET_URL || "https://microgaming.io/game/aviax/";
const fanpageUrl = process.env.FANPAGE_URL || "";

async function seedConfiguration() {
  await prisma.setting.upsert({
    where: { key: "timezone" },
    create: { key: "timezone", value: process.env.TZ || "Asia/Jakarta" },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "periodWeeks" },
    create: { key: "periodWeeks", value: 1 },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "prizeText" },
    create: { key: "prizeText", value: "" },
    update: {},
  });
  for (const [key, value] of [
    ["referralDailyLimit", 10],
    ["referralRewardPoints", 100],
    ["flightStreakDays", 7],
    ["flightStreakBonusPoints", 100],
  ] as const) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }

  const missionRecords = [
    {
      key: "join_channel",
      titleId: "Gabung channel AviaX",
      points: 25,
      type: MissionType.JOIN_CHANNEL,
      orderIndex: 1,
      isActive: Boolean(process.env.TELEGRAM_CHANNEL_ID && process.env.TELEGRAM_CHANNEL_URL),
      config: {
        channel_id: process.env.TELEGRAM_CHANNEL_ID || "",
        channel_url: channelUrl,
      },
    },
    {
      key: "visit_aviax",
      titleId: "Kunjungi halaman AviaX",
      points: 25,
      type: MissionType.VISIT_LINK,
      orderIndex: 2,
      isActive: true,
      config: { target_url: targetUrl },
    },
    {
      key: "demo_60s",
      titleId: "Ikuti demo selama 60 detik",
      points: 25,
      type: MissionType.DEMO_TIMER,
      orderIndex: 3,
      isActive: true,
      config: { minimum_seconds: 60 },
    },
    {
      key: "follow_fanpage",
      titleId: "Ikuti fanpage AviaX",
      points: 25,
      type: MissionType.SOFT_CHECK,
      orderIndex: 4,
      isActive: Boolean(fanpageUrl),
      config: { minimum_seconds: 5, page_url: fanpageUrl },
    },
  ];

  const savedMissions = new Map<string, string>();
  for (const mission of missionRecords) {
    const { key, ...data } = mission;
    const saved = await prisma.mission.upsert({
      where: { key },
      create: { key, ...data },
      update: {},
    });
    savedMissions.set(key, saved.id);
  }

  await prisma.mission.update({
    where: { id: savedMissions.get("demo_60s") },
    data: { requiresMissionId: savedMissions.get("visit_aviax") },
  });
}

seedConfiguration()
  .catch((error) => {
    console.error("Config seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
