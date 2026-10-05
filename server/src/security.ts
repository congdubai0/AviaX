import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

export function hashIp(ip: string): string {
  return createHmac("sha256", env.IP_HASH_SECRET).update(ip).digest("hex");
}

export function createReferralCode(): string {
  return randomBytes(9).toString("base64url");
}

export function randomFlightPoints(): number {
  return randomInt(10, 51);
}

export function createRedirectToken(userId: string, missionId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      missionId,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      nonce: randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", env.REDIRECT_SIGNING_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyRedirectToken(token: string): { userId: string; missionId: string } | null {
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length > 0) return null;
  const expected = createHmac("sha256", env.REDIRECT_SIGNING_SECRET)
    .update(payload)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId?: unknown;
      missionId?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.missionId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < Date.now()
    ) {
      return null;
    }
    return { userId: parsed.userId, missionId: parsed.missionId };
  } catch {
    return null;
  }
}
