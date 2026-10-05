import cron from "node-cron";
import { app } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import {
  ensureCurrentPeriod,
  qualifyPendingReferrals,
  recordPeriodResults,
} from "./domain.js";
import { bot } from "./telegram-bot.js";

async function notifyPendingWinners() {
  const pending = await prisma.periodResult.findMany({
    where: { notifiedAt: null },
    include: {
      period: { select: { startsAt: true, endsAt: true } },
    },
    orderBy: [{ period: { endsAt: "asc" } }, { rank: "asc" }],
  });

  for (const result of pending) {
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { telegramId: true, botStartedAt: true },
    });
    try {
      if (!user?.botStartedAt) continue;
      await bot.api.sendMessage(
        user.telegramId,
        `Periode AviaX sudah selesai. Kamu berada di peringkat #${result.rank} dengan ${result.points} poin. Buka Mini App untuk melihat info periode berikutnya.`,
        {
          reply_markup: {
            inline_keyboard: [[{
              text: "Buka AviaX",
              url: `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}`,
            }]],
          },
        },
      );
      await prisma.periodResult.update({
        where: { id: result.id },
        data: { notifiedAt: new Date() },
      });
    } catch (error) {
      console.error(`Could not notify period winner ${result.id}`, error);
    }
  }
}

async function runScheduledWork() {
  await ensureCurrentPeriod();
  await recordPeriodResults();
  await notifyPendingWinners();
  await qualifyPendingReferrals();
}

async function start() {
  await prisma.$connect();
  await ensureCurrentPeriod();
  const webhookUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/telegram/webhook`;
  await bot.api.setWebhook(webhookUrl, { secret_token: env.BOT_WEBHOOK_SECRET });

  cron.schedule("*/5 * * * *", () => {
    runScheduledWork().catch((error) => console.error("Scheduled AviaX job failed", error));
  }, { timezone: env.TZ });
  await runScheduledWork();

  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.info(`AviaX server listening on port ${env.PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch(async (error) => {
  console.error("AviaX server failed to start", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
