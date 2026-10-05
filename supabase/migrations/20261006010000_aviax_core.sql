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

create table public.rate_limits (
  bucket_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  primary key (bucket_key, window_started_at)
);

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  insert into public.rate_limits(bucket_key, window_started_at, request_count)
  values (p_bucket_key, v_window, 1)
  on conflict (bucket_key, window_started_at) do update
    set request_count = public.rate_limits.request_count + 1
    where public.rate_limits.request_count < p_max_requests
  returning request_count into v_count;

  return found;
end;
$$;

create or replace function public.start_user_mission(
  p_user_id uuid,
  p_mission_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_user_mission public.user_missions;
begin
  perform 1 from public.users
  where id = p_user_id and accepted_terms_at is not null and not is_banned
  for update;
  if not found then raise exception 'age_confirmation_required'; end if;

  select * into v_mission from public.missions
  where code = p_mission_code and active;
  if not found then raise exception 'mission_not_found'; end if;
  if v_mission.kind = 'daily_checkin' then raise exception 'use_daily_checkin_endpoint'; end if;

  if v_mission.requires is not null and not exists (
    select 1 from public.user_missions
    where user_id = p_user_id and mission_code = v_mission.requires and status = 'done'
  ) then raise exception 'mission_locked'; end if;

  insert into public.user_missions(user_id, mission_code)
  values (p_user_id, p_mission_code)
  on conflict (user_id, mission_code) do nothing;

  select * into v_user_mission from public.user_missions
  where user_id = p_user_id and mission_code = p_mission_code
  for update;
  if v_user_mission.status = 'not_started' then
    update public.user_missions
    set status = 'checking', started_at = now()
    where id = v_user_mission.id
    returning * into v_user_mission;
  end if;

  return jsonb_build_object(
    'status', v_user_mission.status,
    'started_at', v_user_mission.started_at
  );
end;
$$;

create or replace function public.bootstrap_telegram_user(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_start_param text,
  p_referral_code text,
  p_ip_hash text,
  p_device_hash text
)
returns setof public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users;
  v_user_id uuid;
  v_created boolean;
  v_referrer_id uuid;
  v_timezone text := 'Asia/Jakarta';
  v_daily_limit integer := 10;
  v_today date;
  v_referrals_today integer;
begin
  insert into public.users(
    telegram_id, username, first_name, referral_code, ip_hash, device_hash,
    group_code
  )
  values (
    p_telegram_id, p_username, p_first_name, p_referral_code, p_ip_hash, p_device_hash,
    case when p_start_param is not null and p_start_param not like 'ref\_%' escape '\'
      then left(p_start_param, 64) else null end
  )
  on conflict (telegram_id) do update
    set username = excluded.username,
        first_name = excluded.first_name,
        ip_hash = excluded.ip_hash,
        device_hash = coalesce(excluded.device_hash, public.users.device_hash),
        updated_at = now()
  returning id, (xmax = 0) into v_user_id, v_created;

  if v_created and p_start_param like 'ref\_%' escape '\' then
    select id into v_referrer_id
    from public.users
    where referral_code = substring(p_start_param from 5)
      and telegram_id <> p_telegram_id
    for update;

    if v_referrer_id is not null then
      select coalesce((value #>> '{}')::text, 'Asia/Jakarta')
        into v_timezone from public.settings where key = 'timezone';
      select coalesce((value #>> '{}')::integer, 10)
        into v_daily_limit from public.settings where key = 'referral_daily_limit';
      v_today := (now() at time zone v_timezone)::date;

      select count(*)::integer into v_referrals_today
      from public.referrals
      where inviter_id = v_referrer_id
        and created_at >= (v_today::timestamp at time zone v_timezone)
        and created_at < ((v_today + 1)::timestamp at time zone v_timezone);

      if v_referrals_today < v_daily_limit then
        update public.users set referrer_id = v_referrer_id where id = v_user_id;
        insert into public.referrals(inviter_id, invitee_id)
        values (v_referrer_id, v_user_id)
        on conflict (invitee_id) do nothing;
      end if;
    end if;
  end if;

  select * into v_user from public.users where id = v_user_id;
  return next v_user;
  return;
end;
$$;

create or replace function public.complete_user_mission(
  p_user_id uuid,
  p_mission_code text,
  p_ref_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_user_mission public.user_missions;
  v_week_id uuid;
  v_awarded boolean;
  v_task_count integer;
  v_referral public.referrals;
  v_timezone text := 'Asia/Jakarta';
  v_daily_limit integer := 10;
  v_reward_points integer := 100;
  v_today date;
  v_rewarded_today integer;
begin
  select * into v_mission from public.missions
  where code = p_mission_code and active;
  if not found then raise exception 'mission_not_found'; end if;

  perform 1 from public.users where id = p_user_id and not is_banned for update;
  if not found then raise exception 'user_not_found_or_banned'; end if;

  select * into v_user_mission from public.user_missions
  where user_id = p_user_id and mission_code = p_mission_code
  for update;
  if found and v_user_mission.status = 'done' then
    return jsonb_build_object('awarded', false, 'points', 0, 'status', 'done');
  end if;

  if v_mission.requires is not null and not exists (
    select 1 from public.user_missions
    where user_id = p_user_id and mission_code = v_mission.requires and status = 'done'
  ) then
    raise exception 'mission_locked';
  end if;

  if v_mission.kind = 'demo_timer' and (
    v_user_mission.started_at is null
    or now() < v_user_mission.started_at + interval '60 seconds'
  ) then
    raise exception 'demo_timer_incomplete';
  end if;

  select id into v_week_id from public.weeks
  where now() >= starts_at and now() < ends_at
  order by starts_at desc limit 1;
  if v_week_id is null then raise exception 'campaign_week_not_configured'; end if;

  insert into public.user_missions(user_id, mission_code, status, started_at, completed_at)
  values (p_user_id, p_mission_code, 'done', coalesce(v_user_mission.started_at, now()), now())
  on conflict (user_id, mission_code) do update
    set status = 'done', completed_at = now()
    where public.user_missions.status <> 'done';

  select public.award_points(p_user_id, v_week_id, v_mission.points, 'mission', p_ref_id)
    into v_awarded;

  if p_mission_code <> 'open_app' then
    select count(*)::integer into v_task_count
    from public.user_missions um
    join public.missions m on m.code = um.mission_code
    where um.user_id = p_user_id and um.status = 'done' and m.kind <> 'open_app';

    if v_task_count >= 2 then
      select * into v_referral from public.referrals
      where invitee_id = p_user_id and not rewarded
      for update;

      if found then
        perform 1 from public.users where id = v_referral.inviter_id for update;
        select coalesce((value #>> '{}')::text, 'Asia/Jakarta')
          into v_timezone from public.settings where key = 'timezone';
        select coalesce((value #>> '{}')::integer, 10)
          into v_daily_limit from public.settings where key = 'referral_daily_limit';
        select coalesce((value #>> '{}')::integer, 100)
          into v_reward_points from public.settings where key = 'referral_reward_points';
        v_today := (now() at time zone v_timezone)::date;
        select count(*)::integer into v_rewarded_today
        from public.referrals
        where inviter_id = v_referral.inviter_id
          and rewarded
          and rewarded_at >= (v_today::timestamp at time zone v_timezone)
          and rewarded_at < ((v_today + 1)::timestamp at time zone v_timezone);

        if v_rewarded_today < v_daily_limit then
          update public.referrals
          set completed_missions = v_task_count, rewarded = true, rewarded_at = now()
          where id = v_referral.id;
          perform public.award_points(
            v_referral.inviter_id, v_week_id, v_reward_points, 'referral', v_referral.id::text
          );
        else
          update public.referrals set completed_missions = v_task_count
          where id = v_referral.id;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'awarded', coalesce(v_awarded, false),
    'points', case when coalesce(v_awarded, false) then v_mission.points else 0 end,
    'status', 'done'
  );
end;
$$;

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
revoke all on function public.bootstrap_telegram_user(bigint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_telegram_user(bigint, text, text, text, text, text, text) to service_role;
revoke all on function public.complete_user_mission(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_user_mission(uuid, text, text) to service_role;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
revoke all on function public.start_user_mission(uuid, text) from public, anon, authenticated;
grant execute on function public.start_user_mission(uuid, text) to service_role;
revoke all on public.rate_limits from public, anon, authenticated;

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
alter table public.rate_limits enable row level security;

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
