import { getSupabaseClient, telegramInitData } from "./supabase";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function invokeApi<T>(
  functionName: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const initData = telegramInitData();
  if (!initData) {
    throw new ApiError("Buka aplikasi dari Telegram untuk melanjutkan.", 401, "TELEGRAM_INIT_DATA_REQUIRED");
  }

  const { data, error } = await getSupabaseClient().functions.invoke<T>(functionName, {
    body,
    headers: { "X-Telegram-Init-Data": initData },
  });

  if (error) {
    const response = error.context instanceof Response ? error.context : undefined;
    let payload: { error?: string; code?: string } | undefined;
    if (response) {
      try {
        payload = await response.json() as { error?: string; code?: string };
      } catch {
        payload = undefined;
      }
    }
    throw new ApiError(
      payload?.error ?? error.message,
      response?.status ?? 500,
      payload?.code,
    );
  }

  if (data === null) {
    throw new ApiError("Server tidak mengembalikan data.", 502, "EMPTY_RESPONSE");
  }
  return data;
}
