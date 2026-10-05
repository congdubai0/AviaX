-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('not_started', 'checking', 'done');

-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('JOIN_CHANNEL', 'VISIT_LINK', 'DEMO_TIMER', 'SOFT_CHECK');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'qualified');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "username" TEXT,
    "first_name" TEXT NOT NULL,
    "group_code" TEXT,
    "referral_code" TEXT NOT NULL,
    "referred_by" UUID,
    "age_confirmed_at" TIMESTAMPTZ(3),
    "bot_started_at" TIMESTAMPTZ(3),
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "type" "MissionType" NOT NULL,
    "order_index" INTEGER NOT NULL,
    "requires_mission_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_missions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'not_started',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mission_id" UUID,

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_flights" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date_utc7" DATE NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referred_id" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "qualified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_clicks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "clicked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_periods" (
    "id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "weekly_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_results" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "reached_at" TIMESTAMPTZ(3),
    "notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_referred_by_idx" ON "users"("referred_by");

-- CreateIndex
CREATE INDEX "users_last_seen_ip_hash_idx" ON "users"("last_seen_ip_hash");

-- CreateIndex
CREATE UNIQUE INDEX "missions_key_key" ON "missions"("key");

-- CreateIndex
CREATE INDEX "missions_is_active_order_index_idx" ON "missions"("is_active", "order_index");

-- CreateIndex
CREATE INDEX "user_missions_user_id_status_idx" ON "user_missions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_missions_user_id_mission_id_key" ON "user_missions"("user_id", "mission_id");

-- CreateIndex
CREATE INDEX "points_ledger_created_at_user_id_idx" ON "points_ledger"("created_at", "user_id");

-- CreateIndex
CREATE INDEX "points_ledger_user_id_created_at_idx" ON "points_ledger"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "points_ledger_user_id_reason_ref_type_ref_id_key" ON "points_ledger"("user_id", "reason", "ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "daily_flights_user_id_date_utc7_idx" ON "daily_flights"("user_id", "date_utc7");

-- CreateIndex
CREATE UNIQUE INDEX "daily_flights_user_id_date_utc7_key" ON "daily_flights"("user_id", "date_utc7");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_id_key" ON "referrals"("referred_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_qualified_at_idx" ON "referrals"("referrer_id", "qualified_at");

-- CreateIndex
CREATE INDEX "link_clicks_mission_id_clicked_at_idx" ON "link_clicks"("mission_id", "clicked_at");

-- CreateIndex
CREATE INDEX "link_clicks_user_id_clicked_at_idx" ON "link_clicks"("user_id", "clicked_at");

-- CreateIndex
CREATE INDEX "weekly_periods_starts_at_ends_at_idx" ON "weekly_periods"("starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_periods_starts_at_ends_at_key" ON "weekly_periods"("starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "period_results_period_id_rank_key" ON "period_results"("period_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "period_results_period_id_user_id_key" ON "period_results"("period_id", "user_id");

-- CreateIndex
CREATE INDEX "security_events_kind_created_at_idx" ON "security_events"("kind", "created_at");

-- Points are an immutable audit ledger; all corrections are compensating entries.
CREATE FUNCTION reject_points_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'points_ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER points_ledger_append_only
BEFORE UPDATE OR DELETE ON "points_ledger"
FOR EACH ROW EXECUTE FUNCTION reject_points_ledger_mutation();

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_requires_mission_id_fkey" FOREIGN KEY ("requires_mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_missions" ADD CONSTRAINT "user_missions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_missions" ADD CONSTRAINT "user_missions_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_flights" ADD CONSTRAINT "daily_flights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_results" ADD CONSTRAINT "period_results_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "weekly_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
