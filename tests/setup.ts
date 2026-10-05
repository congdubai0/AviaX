const testEnvironment: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "3000",
  APP_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgresql://aviax:test@localhost:5432/aviax_test?schema=public",
  BOT_TOKEN: "123456:test-token",
  BOT_USERNAME: "aviax_test_bot",
  MINI_APP_SHORT_NAME: "app",
  BOT_WEBHOOK_SECRET: "test-webhook-secret",
  PUBLIC_BASE_URL: "https://aviax.example.test",
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: "86400",
  REDIRECT_SIGNING_SECRET: "test-redirect-signing-secret-value-32",
  IP_HASH_SECRET: "test-ip-hash-secret-value-32-characters",
  ADMIN_SECRET: "test-admin-secret-value-32-characters",
  TELEGRAM_CHANNEL_ID: "",
  TELEGRAM_CHANNEL_URL: "https://t.me/",
  FANPAGE_URL: "",
  AVIAX_TARGET_URL: "https://microgaming.io/game/aviax/",
  TZ: "Asia/Jakarta",
};

for (const [key, value] of Object.entries(testEnvironment)) {
  process.env[key] ??= value;
}
