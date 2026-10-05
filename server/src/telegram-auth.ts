import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "./env.js";

const telegramUserSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  first_name: z.string().min(1).max(128),
  username: z.string().max(32).optional(),
});

export type TelegramIdentity = {
  telegramId: string;
  firstName: string;
  username: string | null;
  startParam: string | null;
};

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function validateTelegramInitData(
  initData: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramIdentity {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f\d]{64}$/i.test(receivedHash)) {
    throw new AuthenticationError("Telegram initData hash is missing or invalid.");
  }

  const fields = [...params.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(env.BOT_TOKEN).digest();
  const expectedHash = createHmac("sha256", secretKey).update(fields).digest();
  const suppliedHash = Buffer.from(receivedHash, "hex");

  if (
    suppliedHash.length !== expectedHash.length ||
    !timingSafeEqual(suppliedHash, expectedHash)
  ) {
    throw new AuthenticationError("Telegram initData signature does not match.");
  }

  const authDate = Number(params.get("auth_date"));
  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds + 60 ||
    nowSeconds - authDate > env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS
  ) {
    throw new AuthenticationError("Telegram initData has expired.");
  }

  let userData: unknown;
  try {
    userData = JSON.parse(params.get("user") ?? "");
  } catch {
    throw new AuthenticationError("Telegram user data is invalid.");
  }
  const parsedUser = telegramUserSchema.safeParse(userData);
  if (!parsedUser.success) {
    throw new AuthenticationError("Telegram user data is incomplete.");
  }

  const user = parsedUser.data;
  return {
    telegramId: String(user.id),
    firstName: user.first_name,
    username: user.username ?? null,
    startParam: params.get("start_param"),
  };
}
