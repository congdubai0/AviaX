import { Bot, InlineKeyboard } from "grammy";
import { env } from "./env.js";
import { prisma } from "./db.js";

export const bot = new Bot(env.BOT_TOKEN);

bot.command("start", async (context) => {
  if (!context.from) return;
  const telegramId = String(context.from.id);
  await prisma.user.updateMany({
    where: { telegramId },
    data: { botStartedAt: new Date() },
  });
  const appUrl = `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}`;
  const keyboard = new InlineKeyboard().url("Buka AviaX", appUrl);
  await context.reply("Hai! Siap ikuti misi AviaX hari ini?", { reply_markup: keyboard });
});

bot.catch((error) => {
  console.error("Telegram bot update failed", error);
});
