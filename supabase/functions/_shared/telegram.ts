const encoder = new TextEncoder();

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const keyData = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyData).set(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export type TelegramIdentity = {
  telegramId: string;
  firstName: string;
  username: string | null;
  startParam: string | null;
};

export class TelegramAuthError extends Error {
  constructor(message: string, readonly code: string, readonly status = 401) {
    super(message);
    this.name = "TelegramAuthError";
  }
}

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TelegramIdentity> {
  if (!initData || initData.length > 16_384) {
    throw new TelegramAuthError("Telegram session tidak valid.", "INVALID_INIT_DATA");
  }

  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash");
  const authDateValue = params.get("auth_date");
  const userValue = params.get("user");
  if (!suppliedHash || !authDateValue || !userValue) {
    throw new TelegramAuthError("Data sesi Telegram tidak lengkap.", "INVALID_INIT_DATA");
  }

  const authDate = Number(authDateValue);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new TelegramAuthError("Sesi Telegram sudah kedaluwarsa.", "EXPIRED_INIT_DATA");
  }

  params.delete("hash");
  params.delete("signature");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await hmac(encoder.encode("WebAppData"), botToken);
  const expectedHash = toHex(await hmac(secretKey, dataCheckString));
  if (!equalHex(suppliedHash, expectedHash)) {
    throw new TelegramAuthError("Tanda tangan Telegram tidak valid.", "INVALID_SIGNATURE");
  }

  let user: { id?: unknown; first_name?: unknown; username?: unknown };
  try {
    user = JSON.parse(userValue);
  } catch {
    throw new TelegramAuthError("Identitas Telegram tidak valid.", "INVALID_USER");
  }
  if (
    (typeof user.id !== "number" && typeof user.id !== "string")
    || !/^\d+$/.test(String(user.id))
    || typeof user.first_name !== "string"
    || !user.first_name.trim()
  ) {
    throw new TelegramAuthError("Identitas Telegram tidak valid.", "INVALID_USER");
  }

  return {
    telegramId: String(user.id),
    firstName: user.first_name.slice(0, 128),
    username: typeof user.username === "string" ? user.username.slice(0, 64) : null,
    startParam: params.get("start_param"),
  };
}
