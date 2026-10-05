# AviaX Telegram Mini App

AviaX is a mobile-first Telegram Mini App for Indonesian players. Players complete server-verified missions, collect ranking points, check in daily, take one daily flight, and invite friends. Points are not money and cannot be redeemed. Rewards are reviewed and delivered manually.

## Stack and trust boundaries

- React 18, TypeScript, Vite, TanStack Query, and `HashRouter`
- Supabase Postgres, Row Level Security, and Edge Functions
- Telegram Mini App `initData` is verified by Edge Functions with the BotFather token
- The browser uses only the Supabase anon key. The service-role key, bot token, redirect signing secret, and IP hash salt must remain Supabase secrets.
- No fake players, points, or leaderboard rows are seeded. Migrations seed configuration only.

## Run locally

Requirements: Node.js 22+, npm, and a Supabase project.

```powershell
npm ci
npm run db:generate
Copy-Item .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, then run:

```powershell
npm run dev
```

Telegram `initData` must be genuine and signed by Telegram. For end-to-end local testing, expose the Vite development server through an HTTPS tunnel and open it from a Telegram Mini App configured for that URL. The app intentionally does not create fake player identities.

Check the application:

```powershell
npm test -- --run
npm run build
```

## Create and configure Supabase

1. Create a Supabase project and install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Link this folder to the project and apply the schema:

   ```powershell
   supabase login
   supabase link --project-ref your-project-ref
   supabase db push
   ```

3. Add the server-only project secrets. Generate unique random values for the salt and signing key; do not put real values in `.env`, `VITE_*` variables, source, or GitHub Pages:

   ```powershell
   $env:BOT_TOKEN = [System.Net.NetworkCredential]::new("", (Read-Host -AsSecureString "Bot token")).Password
   $env:IP_HASH_SALT = [System.Net.NetworkCredential]::new("", (Read-Host -AsSecureString "IP hash salt")).Password
   $env:REDIRECT_SIGNING_SECRET = [System.Net.NetworkCredential]::new("", (Read-Host -AsSecureString "Redirect signing secret")).Password
   supabase secrets set "BOT_TOKEN=$env:BOT_TOKEN" "IP_HASH_SALT=$env:IP_HASH_SALT" "REDIRECT_SIGNING_SECRET=$env:REDIRECT_SIGNING_SECRET" "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=86400"
   Remove-Item Env:BOT_TOKEN, Env:IP_HASH_SALT, Env:REDIRECT_SIGNING_SECRET
   ```

   Supabase automatically provides the project secret API key to Edge Functions. Do not try to add it as a custom secret with a `SUPABASE_` prefix.

4. Deploy all application Edge Functions:

   ```powershell
   supabase functions deploy auth --no-verify-jwt
   supabase functions deploy missions --no-verify-jwt
   supabase functions deploy mission-start --no-verify-jwt
   supabase functions deploy mission-complete --no-verify-jwt
   supabase functions deploy check-channel --no-verify-jwt
   supabase functions deploy go --no-verify-jwt
   supabase functions deploy daily-flight --no-verify-jwt
   supabase functions deploy leaderboard --no-verify-jwt
   supabase functions deploy referral --no-verify-jwt
   supabase functions deploy admin --no-verify-jwt
   ```

   `verify_jwt` is disabled in `supabase/config.toml` because each player-facing function verifies the signed `X-Telegram-Init-Data` header itself. The signed redirect token protects the `go` endpoint.

5. Fill the `settings` rows marked `TODO` before launch. In particular set `channel_username`, `channel_url`, `aviax_redirect_url`, `demo_url`, `social_links`, `bot_username`, `app_short_name`, and confirm `reward_configuration`. Use Supabase SQL Editor, for example:

   ```sql
   update public.settings set value = '"your_channel"'::jsonb where key = 'channel_username';
   update public.settings set value = '"https://t.me/your_channel"'::jsonb where key = 'channel_url';
   update public.settings set value = '"https://your-approved-aviax-url.example/"'::jsonb where key = 'aviax_redirect_url';
   update public.settings set value = '"https://your-approved-demo-url.example/"'::jsonb where key = 'demo_url';
   update public.settings set value = '"your_bot_username"'::jsonb where key = 'bot_username';
   update public.settings set value = '"your_mini_app_short_name"'::jsonb where key = 'app_short_name';
   ```

   Replace every example URL with a real customer-approved URL. Do not launch with the placeholder channel or destination. Set the approved prize values in `reward_configuration`; the migration values are proposals that require customer confirmation.

## Telegram and campaign setup

1. Create the bot with [@BotFather](https://t.me/BotFather), then use `/newapp`.
2. Set the Mini App URL to `https://congdubai0.github.io/AviaX/` and choose a 3–30 character short name (`a-z`, `A-Z`, `0-9`, `_`). Match that short name and the bot username in Supabase `settings`.
3. Add the bot as an administrator of the official channel so Telegram `getChatMember` checks can verify membership.
4. Copy the administrator's numeric Telegram ID into `settings.admin_telegram_ids`, as a JSON array of strings:

   ```sql
   update public.settings
   set value = '["<ADMIN_TELEGRAM_ID>"]'::jsonb
   where key = 'admin_telegram_ids';
   ```

5. Open `https://congdubai0.github.io/AviaX/#/admin` from the administrator's Telegram account. Create the four-week campaign schedule there after agreeing on its start date. Admin actions are authorized against the server-side Telegram ID allowlist.
6. Once the Mini App is registered, use `/editapp` in BotFather to update the Web App URL if the hosting URL changes.

The Mini App deep link is `https://t.me/<bot_username>/<app_short_name>`. Referral links append `?startapp=ref_<CODE>`; other `startapp` values are recorded as traffic group codes.

## GitHub Pages deployment

The Vite base path and `HashRouter` are configured for the repository path `/AviaX/`. In the GitHub repository:

1. Add repository **Variables** named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is public; never use the service-role key).
2. Enable GitHub Pages with **GitHub Actions** as the build/deploy source.
3. Push to `main` or run the `Deploy AviaX to GitHub Pages` workflow manually.
4. Verify the deployment at `https://congdubai0.github.io/AviaX/` and set that HTTPS URL in BotFather `/newapp` or `/editapp`.

## Human launch checklist

- Create/link the Supabase project and apply the migration.
- Set all server-only Supabase secrets; never expose them to Vite or GitHub Pages.
- Deploy every Edge Function listed above.
- Supply the official channel, AviaX and demo URLs, official social links, bot username, app short name, and confirmed reward amounts in `settings`.
- Confirm the campaign start date and create its four weeks in the admin page.
- Complete legal review of the Syarat & Ketentuan content; the current page is a launch placeholder.
- Replace the legal placeholder in `src/i18n/id.ts` and update the `terms_url` / `terms_content` settings with the approved content.
- Provide final logo, plane, and cloud artwork if replacing the CSS illustration/background.
- Create/configure the BotFather Mini App and make the bot an administrator of the verification channel.
- Add GitHub Pages repository variables and enable the Actions-based Pages deployment.

## Validation

```powershell
npm test -- --run
npm run build
```

The deployment workflow also type-checks all Edge Functions with Deno 2:

```powershell
deno check supabase/functions/auth/index.ts supabase/functions/missions/index.ts supabase/functions/mission-start/index.ts supabase/functions/mission-complete/index.ts supabase/functions/check-channel/index.ts supabase/functions/go/index.ts supabase/functions/daily-flight/index.ts supabase/functions/leaderboard/index.ts supabase/functions/referral/index.ts supabase/functions/admin/index.ts
```
