const encoder = new TextEncoder();

function encodeBase64Url(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createRedirectToken(userId: string, code: string): Promise<string> {
  const secret = Deno.env.get("REDIRECT_SIGNING_SECRET");
  if (!secret || secret.length < 32) throw new Error("REDIRECT_SIGNING_SECRET must contain at least 32 characters.");
  const payload = encodeBase64Url(JSON.stringify({
    userId,
    code,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
  }));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyRedirectToken(token: string): Promise<{ userId: string; code: string }> {
  const secret = Deno.env.get("REDIRECT_SIGNING_SECRET");
  if (!secret || secret.length < 32) throw new Error("REDIRECT_SIGNING_SECRET must contain at least 32 characters.");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || signature.length !== 64) throw new Error("Invalid redirect token.");

  const expected = await sign(payload, secret);
  let difference = signature.length ^ expected.length;
  for (let index = 0; index < Math.min(signature.length, expected.length); index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (difference !== 0) throw new Error("Invalid redirect signature.");

  let value: { userId?: unknown; code?: unknown; expiresAt?: unknown };
  try {
    value = JSON.parse(decodeBase64Url(payload));
  } catch {
    throw new Error("Invalid redirect payload.");
  }
  if (
    typeof value.userId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(value.userId)
    || value.code !== "visit_aviax"
    || typeof value.expiresAt !== "number"
    || value.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Expired or invalid redirect token.");
  }
  return { userId: value.userId, code: value.code };
}
