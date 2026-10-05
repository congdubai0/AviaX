create extension if not exists pgcrypto with schema extensions;

create type public.mission_status as enum ('not_started', 'checking', 'done');

create table public.users (
  id uuid primary key default extensions.gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  group_code text,
  referrer_id uuid references public.users(id) on delete set null,
  referral_code text not null unique,
  accepted_terms_at timestamptz,
  ip_hash text,
  device_hash text,
  is_flagged boolean not null default false,
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_referrer_id_idx on public.users(referrer_id);
create index users_ip_hash_idx on public.users(ip_hash) where ip_hash is not null;
create index users_device_hash_idx on public.users(device_hash) where device_hash is not null;

create table public.seasons (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint seasons_valid_range check (ends_at > starts_at)
);

create table public.weeks (
  id uuid primary key default extensions.gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number smallint not null check (week_number between 1 and 4),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_final boolean not null default false,
  created_at timestamptz not null default now(),
  unique (season_id, week_number),
  constraint weeks_valid_range check (ends_at > starts_at)
);

create index weeks_active_range_idx on public.weeks(starts_at, ends_at);

create table public.missions (
  code text primary key,
  title_id text not null,
  points integer not null check (points >= 0),
  kind text not null check (kind in ('open_app', 'join_channel', 'visit_link', 'demo_timer', 'soft_check', 'daily_checkin')),
  requires text references public.missions(code) on delete set null,
  sort_order smallint not null,
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.user_missions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mission_code text not null references public.missions(code) on delete restrict,
  status public.mission_status not null default 'not_started',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, mission_code)
);

create index user_missions_user_status_idx on public.user_missions(user_id, status);

create table public.point_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  week_id uuid references public.weeks(id) on delete set null,
  points integer not null check (points > 0),
  reason text not null,
  ref_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref_id)
);

create index point_events_user_created_idx on public.point_events(user_id, created_at desc);
create index point_events_week_points_idx on public.point_events(week_id, points desc);

create table public.daily_flights (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  flight_date date not null,
  points integer not null check (points between 10 and 50),
  created_at timestamptz not null default now(),
  unique (user_id, flight_date)
);

create table public.checkins (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  checkin_date date not null,
  streak integer not null check (streak between 1 and 7),
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create table public.click_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mission_code text not null references public.missions(code) on delete restrict,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index click_logs_user_created_idx on public.click_logs(user_id, created_at desc);

create table public.referrals (
  id uuid primary key default extensions.gen_random_uuid(),
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid not null unique references public.users(id) on delete cascade,
  completed_missions integer not null default 0 check (completed_missions >= 0),
  rewarded boolean not null default false,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referrals_not_self check (inviter_id <> invitee_id)
);

create index referrals_inviter_created_idx on public.referrals(inviter_id, created_at desc);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.security_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index security_events_kind_created_idx on public.security_events(kind, created_at desc);

create table public.daily_draws (
  id uuid primary key default extensions.gen_random_uuid(),
  draw_date date not null unique,
  winner_id uuid references public.users(id) on delete set null,
  points integer not null check (points > 0),
  drawn_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.award_points(
  p_user_id uuid,
  p_week_id uuid,
  p_points integer,
  p_reason text,
  p_ref_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_points <= 0 then
    raise exception 'points must be positive';
  end if;

  insert into public.point_events(user_id, week_id, points, reason, ref_id)
  values (p_user_id, p_week_id, p_points, p_reason, p_ref_id)
  on conflict (user_id, reason, ref_id) do nothing;

  return found;
end;
$$;

revoke all on function public.award_points(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.award_points(uuid, uuid, integer, text, text) to service_role;

create or replace view public.leaderboard_weekly
with (security_invoker = true)
as
select
  pe.week_id,
  pe.user_id,
  sum(pe.points)::bigint as points,
  min(pe.created_at) as reached_at
from public.point_events pe
join public.users u on u.id = pe.user_id
where not u.is_banned
  and exists (
    select 1 from public.user_missions um
    where um.user_id = u.id
      and um.mission_code = 'join_channel'
      and um.status = 'done'
  )
group by pe.week_id, pe.user_id;

revoke all on public.leaderboard_weekly from public, anon, authenticated;
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;

alter table public.users enable row level security;
alter table public.seasons enable row level security;
alter table public.weeks enable row level security;
alter table public.missions enable row level security;
alter table public.user_missions enable row level security;
alter table public.point_events enable row level security;
alter table public.daily_flights enable row level security;
alter table public.checkins enable row level security;
alter table public.click_logs enable row level security;
alter table public.referrals enable row level security;
alter table public.settings enable row level security;
alter table public.security_events enable row level security;
alter table public.daily_draws enable row level security;

-- The browser talks only to Edge Functions; service-role access stays server-side.
insert into public.settings(key, value) values
  ('timezone', '"Asia/Jakarta"'::jsonb),
  ('campaign_start_at', '{"value":null,"TODO":"Set the confirmed campaign start time before launch."}'::jsonb),
  ('channel_username', '{"value":"","TODO":"Set the official Telegram channel username."}'::jsonb),
  ('channel_url', '{"value":"https://t.me/","TODO":"Set the official Telegram channel URL."}'::jsonb),
  ('aviax_redirect_url', '{"value":"","TODO":"Set the approved AviaX destination URL."}'::jsonb),
  ('demo_url', '{"value":"","TODO":"Set the approved demo URL."}'::jsonb),
  ('social_links', '{"facebook":"","instagram":"","tiktok":"","TODO":"Set only the official social links used in Indonesia."}'::jsonb),
  ('bot_username', '{"value":"","TODO":"Set the Telegram bot username."}'::jsonb),
  ('app_short_name', '{"value":"","TODO":"Set the Telegram Mini App short name."}'::jsonb),
  ('admin_telegram_ids', '[]'::jsonb),
  ('daily_checkin_points', '10'::jsonb),
  ('flight_min_points', '10'::jsonb),
  ('flight_max_points', '50'::jsonb),
  ('streak_days', '7'::jsonb),
  ('streak_bonus_points', '100'::jsonb),
  ('referral_daily_limit', '10'::jsonb),
  ('referral_reward_points', '100'::jsonb),
  ('reward_configuration', '{"weekly":{"weeks":4,"total_usd":1400,"top_1":100,"top_2":70,"top_3":50,"ranks_4_10_each":18},"daily_draw":{"per_day_usd":20,"total_usd":560},"final_week":{"top_1":200,"top_2":140,"top_3":100,"total_usd":440},"total_usd":2400,"TODO":"Confirm proposed reward values before announcing the campaign."}'::jsonb)
on conflict (key) do nothing;

insert into public.missions(code, title_id, points, kind, requires, sort_order, active, config) values
  ('open_app', 'Buka aplikasi & setujui usia 18+', 10, 'open_app', null, 1, true, '{}'::jsonb),
  ('join_channel', 'Gabung channel Telegram resmi', 50, 'join_channel', null, 2, true, '{"TODO":"Configure channel_username and channel_url in settings."}'::jsonb),
  ('visit_aviax', 'Kunjungi halaman AviaX', 100, 'visit_link', null, 3, true, '{"TODO":"Configure aviax_redirect_url and UTM parameters in settings."}'::jsonb),
  ('demo_60s', 'Coba demo selama 60 detik', 100, 'demo_timer', 'visit_aviax', 4, true, '{"minimum_seconds":60,"TODO":"Configure demo_url in settings. This is a soft check; time on the external site cannot be independently verified."}'::jsonb),
  ('follow_social', 'Ikuti media sosial AviaX', 50, 'soft_check', null, 5, true, '{"TODO":"Configure official social_links in settings."}'::jsonb),
  ('daily_checkin', 'Absen harian', 10, 'daily_checkin', null, 6, true, '{"streak_bonus_points":100,"streak_days":7}'::jsonb)
on conflict (code) do nothing;
