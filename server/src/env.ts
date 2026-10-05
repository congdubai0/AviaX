import "dotenv/config";
import { z } from "zod";

const httpsUrl = z.string().url().refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const webOrigin = z.string().url().refine((value) => {
  const parsed = new URL(value);
  return parsed.origin === value.replace(/\/$/, "")
    && (process.env.NODE_ENV !== "production" || parsed.protocol === "https:");
}, "APP_ORIGIN must be an origin without a path");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: webOrigin.default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
  MINI_APP_SHORT_NAME: z.string().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/).default("app"),
  BOT_WEBHOOK_SECRET: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  PUBLIC_BASE_URL: httpsUrl,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  REDIRECT_SIGNING_SECRET: z.string().min(32),
  IP_HASH_SECRET: z.string().min(32),
  ADMIN_SECRET: z.string().min(32),
  TELEGRAM_CHANNEL_ID: z.string().optional().default(""),
  TELEGRAM_CHANNEL_URL: httpsUrl.optional().default("https://t.me/"),
  FANPAGE_URL: z.union([z.literal(""), httpsUrl]).default(""),
  AVIAX_TARGET_URL: httpsUrl.default("https://microgaming.io/game/aviax/"),
  TZ: z.string().default("Asia/Jakarta"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${z.prettifyError(parsed.error)}\n`
    + "Create .env from .env.example, then set the database URL, real Telegram bot credentials, "
    + "public HTTPS URL, and signing secrets before starting the API.",
  );
}

export const env = parsed.data;
