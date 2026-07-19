-- =============================================================================
-- Companion — consolidated fresh-install schema (SHARED Supabase project)
-- =============================================================================
-- Recreates the ENTIRE Companion database under a dedicated `companion` schema
-- (previously everything lived implicitly in `public`). This file represents the
-- FINAL desired state merged from all 16 migrations in supabase/migrations/ — it
-- is NOT a replay of those migrations. Paste + run in the Supabase Dashboard SQL
-- editor of the shared project.
--
-- Design rules applied throughout:
--   * Every companion object is explicitly schema-qualified (`companion.<obj>`).
--   * `auth.users` / `auth.uid()` stay in the `auth` schema (untouched, shared).
--   * The pgvector `vector` type + `<=>` operator + `vector_cosine_ops` opclass
--     stay UNqualified — they resolve via the `extensions` (or `public`) schema,
--     which is on the Supabase session search_path and is also injected into every
--     SECURITY DEFINER function via `SET search_path = companion, extensions, public`.
--   * Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.
--   * pg_cron / pg_net + all cron scheduling live ONLY in the optional appendix.
--
-- Manual dashboard steps this SQL cannot perform are listed in the FOOTER.
-- =============================================================================


-- =============================================================================
-- SECTION 0 — SCHEMA + EXTENSIONS
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS companion;

GRANT USAGE ON SCHEMA companion TO anon, authenticated, service_role;

-- pgvector: Supabase convention is to keep extensions in the `extensions` schema
-- (NOT public). Idempotent — if `vector` is already installed elsewhere in this
-- shared project, IF NOT EXISTS makes this a no-op and the WITH SCHEMA is ignored.
-- Either way, the `extensions` + `public` entries in every function's search_path
-- resolve the vector type/operator regardless of where the extension actually lives.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Put the vector extension's schema on the SESSION search_path for the rest of
-- this script. This is load-bearing: unqualified `vector` / `vector_cosine_ops`
-- must resolve during (a) table DDL, (b) HNSW index creation, AND (c) CREATE
-- FUNCTION parameter-type parsing — and a function's OWN `SET search_path` does
-- NOT apply to its parameter types (only the session path does). `companion`
-- leads so incidental unqualified names hit our schema; `public` covers a shared
-- project that already installed pgvector into public (IF NOT EXISTS above would
-- have left it there). Without this line the script can fail on the first
-- VECTOR(1536) column if the ambient session path lacks the extension schema.
SET search_path = companion, extensions, public;


-- =============================================================================
-- SECTION 1 — TABLES (15)
-- =============================================================================
-- FINAL column state (ALTER TABLE ADD COLUMNs from later migrations merged in).
-- FKs between companion tables reference companion.<table>. device_tokens and
-- notification_log intentionally reference auth.users directly (as in source).

-- ── 1.1 profiles ─────────────────────────────────────────────────────────────
-- Base cols from 20260301000000; streak_alerts/srs_reminders from 20260401000000;
-- daily_ai_cost_cents_limit from 20260512000000; daily_nudge/nudge_utc_hour
-- from Story 18-3 (2026-07-19).
CREATE TABLE IF NOT EXISTS companion.profiles (
  id                         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name                  TEXT,
  native_language            TEXT DEFAULT 'en',
  current_cefr_level         TEXT DEFAULT 'A1' CHECK (current_cefr_level IN ('A1','A2','B1','B2','C1','C2')),
  target_cefr_level          TEXT DEFAULT 'C1' CHECK (target_cefr_level IN ('A1','A2','B1','B2','C1','C2')),
  daily_goal_minutes         INTEGER DEFAULT 15,
  streak_days                INTEGER DEFAULT 0,
  last_active_date           DATE,
  onboarding_completed       BOOLEAN DEFAULT FALSE,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW(),
  streak_alerts              BOOLEAN NOT NULL DEFAULT TRUE,
  srs_reminders              BOOLEAN NOT NULL DEFAULT TRUE,
  daily_ai_cost_cents_limit  INTEGER NOT NULL DEFAULT 100,
  daily_nudge                BOOLEAN NOT NULL DEFAULT TRUE,
  nudge_utc_hour             SMALLINT NOT NULL DEFAULT 17 CHECK (nudge_utc_hour BETWEEN 0 AND 23)
);

-- Story 18-3 schema evolution (existing deployed DBs — the CREATE TABLE above
-- is skipped when companion.profiles already exists, so the same columns are
-- added idempotently here; fresh installs no-op these):
ALTER TABLE companion.profiles
  ADD COLUMN IF NOT EXISTS daily_nudge BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE companion.profiles
  ADD COLUMN IF NOT EXISTS nudge_utc_hour SMALLINT NOT NULL DEFAULT 17
    CONSTRAINT profiles_nudge_utc_hour_range CHECK (nudge_utc_hour BETWEEN 0 AND 23);

-- ── 1.2 skill_progress ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.skill_progress (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  skill                TEXT NOT NULL CHECK (skill IN ('listening','reading','speaking','writing','grammar')),
  cefr_level           TEXT DEFAULT 'A1',
  score                FLOAT DEFAULT 0,
  exercises_completed  INTEGER DEFAULT 0,
  total_time_minutes   INTEGER DEFAULT 0,
  last_practiced       TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, skill)
);

-- ── 1.3 conversations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  topic                 TEXT NOT NULL,
  scenario_description  TEXT,
  cefr_level            TEXT NOT NULL,
  mode                  TEXT DEFAULT 'companion' CHECK (mode IN ('companion','debate','tcf_simulation')),
  duration_seconds      INTEGER DEFAULT 0,
  ai_feedback           JSONB,
  status                TEXT DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- ── 1.4 conversation_messages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.conversation_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES companion.conversations(id) ON DELETE CASCADE,
  role               TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content            TEXT NOT NULL,
  audio_storage_path TEXT,
  corrections        JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── 1.5 exercises ────────────────────────────────────────────────────────────
-- question_stem_hashes TEXT[] added by 20260511000000 (no GIN index — see source).
CREATE TABLE IF NOT EXISTS companion.exercises (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  skill                 TEXT NOT NULL CHECK (skill IN ('listening','reading','writing','grammar')),
  cefr_level            TEXT NOT NULL,
  exercise_type         TEXT NOT NULL,
  content               JSONB NOT NULL,
  user_answer           JSONB,
  ai_evaluation         JSONB,
  score                 FLOAT,
  completed             BOOLEAN DEFAULT FALSE,
  time_spent_seconds    INTEGER,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  question_stem_hashes  TEXT[]
);

-- ── 1.6 vocabulary ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.vocabulary (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  french_word           TEXT NOT NULL,
  english_translation   TEXT NOT NULL,
  context_sentence      TEXT,
  cefr_level            TEXT NOT NULL,
  phonetic              TEXT,
  ease_factor           FLOAT DEFAULT 2.5,
  interval_days         INTEGER DEFAULT 1,
  repetitions           INTEGER DEFAULT 0,
  next_review           TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, french_word)
);

-- ── 1.7 mock_tests ───────────────────────────────────────────────────────────
-- status CHECK merged from 20260301000002 (mock_tests_status_check) into the DDL.
CREATE TABLE IF NOT EXISTS companion.mock_tests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  test_type         TEXT NOT NULL CHECK (test_type IN ('full','listening','reading','grammar','speaking','writing')),
  total_score       INTEGER,
  section_scores    JSONB,
  cefr_result       TEXT,
  duration_seconds  INTEGER,
  questions         JSONB NOT NULL,
  status            TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- ── 1.8 mock_test_answers (introduced by 20260301000002) ─────────────────────
CREATE TABLE IF NOT EXISTS companion.mock_test_answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_test_id    UUID NOT NULL REFERENCES companion.mock_tests(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  question_index  INT NOT NULL,
  selected_option TEXT,
  is_correct      BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 1.9 daily_activity ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.daily_activity (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  date                     DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes_practiced        INTEGER DEFAULT 0,
  exercises_completed      INTEGER DEFAULT 0,
  conversations_completed  INTEGER DEFAULT 0,
  words_learned            INTEGER DEFAULT 0,
  UNIQUE (user_id, date)
);

-- ── 1.10 companion_memory (pgvector RAG) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.companion_memory (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  content                TEXT NOT NULL,
  embedding              VECTOR(1536),
  memory_type            TEXT CHECK (memory_type IN ('personal_fact','preference','topic_discussed','milestone')),
  source_conversation_id UUID REFERENCES companion.conversations(id),
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── 1.11 error_patterns (embedding col added by 20260513000000) ──────────────
CREATE TABLE IF NOT EXISTS companion.error_patterns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES companion.profiles(id) ON DELETE CASCADE,
  error_type         TEXT NOT NULL CHECK (error_type IN ('grammar','pronunciation','vocabulary','register')),
  error_description  TEXT NOT NULL,
  occurrences        INTEGER DEFAULT 1,
  last_occurred      TIMESTAMPTZ DEFAULT NOW(),
  resolved           BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  embedding          VECTOR(1536)
);

-- ── 1.12 device_tokens (FK → auth.users) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion.device_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL,
  platform    TEXT        NOT NULL CHECK (platform IN ('ios','android')),
  device_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

-- ── 1.13 notification_log (FK → auth.users; receipt cols from 20260403000000) ─
CREATE TABLE IF NOT EXISTS companion.notification_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL CHECK (type IN ('streak','srs')),
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ticket_id        TEXT,
  token            TEXT,
  receipt_checked  BOOLEAN     NOT NULL DEFAULT FALSE
);

-- ── 1.14 rate_limit_counters (no FK — sentinel cron user_id) ─────────────────
CREATE TABLE IF NOT EXISTS companion.rate_limit_counters (
  user_id        UUID        NOT NULL,
  key            TEXT        NOT NULL,
  window_start   TIMESTAMPTZ NOT NULL,
  request_count  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key, window_start)
);

-- ── 1.15 daily_cost_ledger (NUMERIC(20,6) fractional-cent precision) ─────────
CREATE TABLE IF NOT EXISTS companion.daily_cost_ledger (
  user_id           UUID          NOT NULL,
  day               DATE          NOT NULL,
  total_cost_cents  NUMERIC(20,6) NOT NULL DEFAULT 0,
  request_count     INTEGER       NOT NULL DEFAULT 0,
  last_updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);


-- =============================================================================
-- SECTION 2 — INDEXES
-- =============================================================================
-- Note: the initial ivfflat index on companion_memory.embedding was replaced by
-- HNSW in 20260301000002 — only the HNSW index is created here. No GIN indexes
-- exist in source (exercises.question_stem_hashes is intentionally unindexed).

-- user_id indexes (RLS + hot queries)
CREATE INDEX IF NOT EXISTS idx_skill_progress_user   ON companion.skill_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user     ON companion.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_user         ON companion.exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_user        ON companion.vocabulary(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_tests_user        ON companion.mock_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_activity_user    ON companion.daily_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_companion_memory_user  ON companion.companion_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_error_patterns_user    ON companion.error_patterns(user_id);

-- compound / hot-query indexes
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date
  ON companion.daily_activity(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_error_patterns_user_unresolved
  ON companion.error_patterns(user_id, resolved, occurrences DESC);
CREATE INDEX IF NOT EXISTS idx_vocabulary_user_review
  ON companion.vocabulary(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_exercises_user_skill
  ON companion.exercises(user_id, skill, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
  ON companion.conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status
  ON companion.conversations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON companion.conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vocabulary_next_review
  ON companion.vocabulary(next_review);
CREATE INDEX IF NOT EXISTS idx_mock_tests_created_at
  ON companion.mock_tests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_test_answers_test
  ON companion.mock_test_answers(mock_test_id);
CREATE INDEX IF NOT EXISTS idx_mock_test_answers_user
  ON companion.mock_test_answers(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id
  ON companion.device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_dedup
  ON companion.notification_log(user_id, type, sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_unchecked_receipts
  ON companion.notification_log(receipt_checked, sent_at)
  WHERE receipt_checked = false AND ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window_start
  ON companion.rate_limit_counters(window_start);
CREATE INDEX IF NOT EXISTS idx_daily_cost_ledger_day
  ON companion.daily_cost_ledger(day);

-- HNSW vector indexes (vector_cosine_ops opclass resolves via extensions/public)
CREATE INDEX IF NOT EXISTS idx_companion_memory_embedding
  ON companion.companion_memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_error_patterns_embedding
  ON companion.error_patterns USING hnsw (embedding vector_cosine_ops);


-- =============================================================================
-- SECTION 3 — FUNCTIONS (18)
-- =============================================================================
-- Every function is defined as companion.<name>(...). Table references inside the
-- bodies stay UNqualified and resolve via `SET search_path = companion, extensions,
-- public`. auth.uid() stays schema-qualified. Per-function REVOKE/GRANT is
-- co-located immediately after each definition.

-- ── 3.1 handle_new_user (final robust version from 20260325000000) ───────────
-- Inserts into companion.profiles. Called only by the gated auth trigger below.
CREATE OR REPLACE FUNCTION companion.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, LEFT(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 100))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but do not fail signup
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3.2 set_updated_at (SECURITY INVOKER; no table refs, no search_path in source)
CREATE OR REPLACE FUNCTION companion.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3.3 update_last_active_date (final version from 20260303000001) ──────────
CREATE OR REPLACE FUNCTION companion.update_last_active_date()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
BEGIN
  UPDATE profiles
  SET last_active_date = NEW.date
  WHERE id = NEW.user_id
    AND (last_active_date IS NULL OR last_active_date < NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3.4 cleanup_stale_data (from 20260303000000) ─────────────────────────────
CREATE OR REPLACE FUNCTION companion.cleanup_stale_data()
RETURNS TABLE (
  abandoned_conversations INT,
  stale_exercises INT,
  orphan_messages INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
DECLARE
  v_abandoned INT;
  v_stale INT;
  v_orphan INT;
BEGIN
  -- 1. Mark conversations as abandoned if still "active" after 24 hours
  WITH updated AS (
    UPDATE conversations
    SET status = 'abandoned'
    WHERE status = 'active'
      AND created_at < NOW() - INTERVAL '24 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_abandoned FROM updated;

  -- 2. Delete incomplete exercises older than 30 days
  WITH deleted AS (
    DELETE FROM exercises
    WHERE completed = FALSE
      AND created_at < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_stale FROM deleted;

  -- 3. Delete orphaned conversation_messages (conversation was deleted)
  WITH deleted AS (
    DELETE FROM conversation_messages cm
    WHERE NOT EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = cm.conversation_id
    )
    RETURNING cm.id
  )
  SELECT COUNT(*) INTO v_orphan FROM deleted;

  RETURN QUERY SELECT v_abandoned, v_stale, v_orphan;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.cleanup_stale_data() FROM public, anon, authenticated;

-- ── 3.5 match_memories (final version from 20260301000002; auth.uid()-scoped) ─
DROP FUNCTION IF EXISTS companion.match_memories(vector, integer, double precision);
CREATE OR REPLACE FUNCTION companion.match_memories(
  query_embedding VECTOR(1536),
  match_count     INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  memory_type TEXT,
  similarity  FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cm.id,
    cm.content,
    cm.memory_type,
    1 - (cm.embedding <=> query_embedding) AS similarity
  FROM companion_memory cm
  WHERE cm.user_id = auth.uid()
    AND 1 - (cm.embedding <=> query_embedding) > match_threshold
  ORDER BY cm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.match_memories(vector, integer, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.match_memories(vector, integer, double precision) TO authenticated, service_role;

-- ── 3.6 cleanup_stale_rate_limits (from 20260512000000) ──────────────────────
CREATE OR REPLACE FUNCTION companion.cleanup_stale_rate_limits()
RETURNS void
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE sql
AS $$
  DELETE FROM rate_limit_counters
   WHERE window_start < now() - interval '24 hours';
  DELETE FROM daily_cost_ledger
   WHERE day < (now() AT TIME ZONE 'UTC')::date - interval '30 days';
$$;

REVOKE EXECUTE ON FUNCTION companion.cleanup_stale_rate_limits() FROM public, anon, authenticated;

-- ── 3.7 check_and_increment_rate_limit (HARDENED — 20260518000000) ───────────
-- auth.uid() guard permits NULL (service-role / cron) but blocks authenticated
-- cross-user forging.
CREATE OR REPLACE FUNCTION companion.check_and_increment_rate_limit(
  p_user_id        uuid,
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
) RETURNS TABLE (
  allowed          boolean,
  remaining        integer,
  reset_in_seconds integer
)
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start  timestamptz;
  v_window_end    timestamptz;
  v_new_count     integer;
BEGIN
  -- Hardening: block authenticated users from forging another user's counter.
  -- Service-role callers (cron / send-notifications) have auth.uid() = NULL and
  -- are permitted (they legitimately pass the cron sentinel user id).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Bucket window_start to the floor of the window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds)::bigint * p_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  -- (a) Try fresh insert. ON CONFLICT DO NOTHING returns NULL into v_new_count
  --     when a row already exists; otherwise returns 1 (the new request_count).
  INSERT INTO rate_limit_counters (user_id, key, window_start, request_count)
  VALUES (p_user_id, p_key, v_window_start, 1)
  ON CONFLICT (user_id, key, window_start) DO NOTHING
  RETURNING request_count INTO v_new_count;

  IF v_new_count IS NOT NULL THEN
    -- Fresh row inserted; first request of the window for this (user, key).
    RETURN QUERY SELECT
      true,
      GREATEST(0, p_limit - v_new_count),
      GREATEST(1, EXTRACT(epoch FROM (v_window_end - now()))::integer);
    RETURN;
  END IF;

  -- (b) Row exists. Conditionally UPDATE only when below limit. Concurrent
  --     UPDATEs serialize on the row lock; at most p_limit increments succeed,
  --     and the (p_limit+1)th caller sees RETURNING return NULL.
  UPDATE rate_limit_counters
  SET request_count = request_count + 1
  WHERE user_id = p_user_id
    AND key = p_key
    AND window_start = v_window_start
    AND request_count < p_limit
  RETURNING request_count INTO v_new_count;

  IF v_new_count IS NULL THEN
    -- UPDATE didn't fire because request_count was already >= p_limit.
    -- Denied. No rollback needed — we never incremented.
    RETURN QUERY SELECT
      false,
      0,
      GREATEST(1, EXTRACT(epoch FROM (v_window_end - now()))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    GREATEST(0, p_limit - v_new_count),
    GREATEST(1, EXTRACT(epoch FROM (v_window_end - now()))::integer);
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.check_and_increment_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.check_and_increment_rate_limit(uuid, text, integer, integer) TO authenticated, service_role;

-- ── 3.8 check_daily_cost_budget (HARDENED — 20260518000000) ──────────────────
CREATE OR REPLACE FUNCTION companion.check_daily_cost_budget(
  p_user_id         uuid,
  p_estimated_cents numeric
) RETURNS TABLE (
  allowed           boolean,
  total_today_cents numeric,
  limit_cents       integer
)
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
  v_limit integer;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Hardening: block cross-user forging (service-role NULL auth.uid permitted).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Hardening: a negative estimate must not trivially pass the pre-check.
  p_estimated_cents := GREATEST(0::numeric, p_estimated_cents);

  -- Read per-user limit; default 100¢ if profile is missing (defensive).
  SELECT COALESCE(daily_ai_cost_cents_limit, 100) INTO v_limit
  FROM profiles
  WHERE id = p_user_id;
  v_limit := COALESCE(v_limit, 100);

  -- Read today's cumulative cost (0 if no row yet).
  SELECT COALESCE(total_cost_cents, 0::numeric) INTO v_total
  FROM daily_cost_ledger
  WHERE user_id = p_user_id AND day = v_today;
  v_total := COALESCE(v_total, 0::numeric);

  RETURN QUERY SELECT
    (v_total + p_estimated_cents) <= v_limit::numeric,
    v_total,
    v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.check_daily_cost_budget(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.check_daily_cost_budget(uuid, numeric) TO authenticated, service_role;

-- ── 3.9 record_daily_cost (HARDENED — 20260518000000) ────────────────────────
CREATE OR REPLACE FUNCTION companion.record_daily_cost(
  p_user_id     uuid,
  p_cost_cents  numeric
) RETURNS TABLE (
  total_today_cents numeric
)
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_total numeric;
BEGIN
  -- Hardening: block cross-user forging (service-role NULL auth.uid permitted).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Hardening: clamp non-negative. A negative contribution can no longer drive
  -- the ledger down and bypass the daily spend cap. Real costs are positive.
  p_cost_cents := GREATEST(0::numeric, p_cost_cents);

  INSERT INTO daily_cost_ledger (user_id, day, total_cost_cents, request_count, last_updated_at)
  VALUES (p_user_id, v_today, p_cost_cents, 1, now())
  ON CONFLICT (user_id, day)
  DO UPDATE SET
    total_cost_cents = daily_cost_ledger.total_cost_cents + p_cost_cents,
    request_count    = daily_cost_ledger.request_count + 1,
    last_updated_at  = now()
  RETURNING daily_cost_ledger.total_cost_cents INTO v_total;

  RETURN QUERY SELECT v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.record_daily_cost(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.record_daily_cost(uuid, numeric) TO authenticated, service_role;

-- ── 3.10 get_home_aggregate (from 20260515000000) ───────────────────────────
CREATE OR REPLACE FUNCTION companion.get_home_aggregate(
  p_user_id uuid,
  p_date    date,
  p_now     timestamptz DEFAULT now()
) RETURNS jsonb
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_skills              jsonb;
  v_daily_today         jsonb;
  v_recent_activity     jsonb;
  v_top_errors          jsonb;
  v_streak_days         integer;
  v_weakest_skill       jsonb;
  v_srs_due_count       integer;
  v_total_errors        integer;
  v_resolved_errors     integer;
  v_has_activity_today  boolean;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- 1. skills — all skill_progress rows for the user.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'skill',                skill,
      'cefr_level',           cefr_level,
      'score',                score,
      'exercises_completed',  exercises_completed,
      'total_time_minutes',   total_time_minutes
    )
  ), '[]'::jsonb)
  INTO v_skills
  FROM skill_progress
  WHERE user_id = p_user_id;

  -- 2. daily_activity_today — the row for p_date (or null).
  SELECT COALESCE(to_jsonb(da.*), 'null'::jsonb)
  INTO v_daily_today
  FROM (
    SELECT date, minutes_practiced, exercises_completed,
           conversations_completed, words_learned
    FROM daily_activity
    WHERE user_id = p_user_id AND date = p_date
    LIMIT 1
  ) da;
  IF v_daily_today IS NULL THEN
    v_daily_today := 'null'::jsonb;
  END IF;

  -- 3. recent_activity — last 7 days (most recent first).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',                    date,
      'minutes_practiced',       minutes_practiced,
      'exercises_completed',     exercises_completed,
      'conversations_completed', conversations_completed,
      'words_learned',           words_learned
    ) ORDER BY date DESC
  ), '[]'::jsonb)
  INTO v_recent_activity
  FROM (
    SELECT date, minutes_practiced, exercises_completed,
           conversations_completed, words_learned
    FROM daily_activity
    WHERE user_id = p_user_id
    ORDER BY date DESC
    LIMIT 7
  ) AS recent;

  -- 4. top_errors — top 5 unresolved by occurrences DESC.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                id,
      'error_type',        error_type,
      'error_description', error_description,
      'occurrences',       occurrences,
      'resolved',          resolved
    ) ORDER BY occurrences DESC, id ASC
  ), '[]'::jsonb)
  INTO v_top_errors
  FROM (
    SELECT id, error_type, error_description, occurrences, resolved
    FROM error_patterns
    WHERE user_id = p_user_id AND resolved = false
    ORDER BY occurrences DESC, id ASC
    LIMIT 5
  ) AS errs;

  -- 5. streak_days from profiles.
  SELECT COALESCE(streak_days, 0)
  INTO v_streak_days
  FROM profiles
  WHERE id = p_user_id;
  IF v_streak_days IS NULL THEN
    v_streak_days := 0;
  END IF;

  -- 6. weakest_skill — lowest-score row (or null).
  SELECT to_jsonb(ws.*)
  INTO v_weakest_skill
  FROM (
    SELECT skill, score AS average_score
    FROM skill_progress
    WHERE user_id = p_user_id
    ORDER BY score ASC, skill ASC
    LIMIT 1
  ) ws;
  IF v_weakest_skill IS NULL THEN
    v_weakest_skill := 'null'::jsonb;
  END IF;

  -- 7. srs_due_count — vocabulary with next_review <= p_now.
  SELECT COUNT(*)::integer
  INTO v_srs_due_count
  FROM vocabulary
  WHERE user_id = p_user_id AND next_review <= p_now;

  -- 8. error_counts.total + error_counts.resolved — single-query FILTER snapshot.
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE resolved = true)::integer
  INTO v_total_errors, v_resolved_errors
  FROM error_patterns
  WHERE user_id = p_user_id;

  -- 9. has_activity_today — derived from daily_activity_today.
  v_has_activity_today := (v_daily_today IS NOT NULL AND v_daily_today != 'null'::jsonb);

  RETURN jsonb_build_object(
    'skills',               v_skills,
    'daily_activity_today', v_daily_today,
    'recent_activity',      v_recent_activity,
    'top_errors',           v_top_errors,
    'streak_days',          v_streak_days,
    'weakest_skill',        v_weakest_skill,
    'srs_due_count',        v_srs_due_count,
    'error_counts',         jsonb_build_object(
                              'total',    v_total_errors,
                              'resolved', v_resolved_errors
                            ),
    'has_activity_today',   v_has_activity_today
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.get_home_aggregate(uuid, date, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.get_home_aggregate(uuid, date, timestamptz) TO authenticated;

-- ── 3.11 get_session_feedback_aggregate (from 20260516000000) ────────────────
CREATE OR REPLACE FUNCTION companion.get_session_feedback_aggregate(
  p_user_id          uuid,
  p_conversation_id  uuid,
  p_pre_cefr_level   text,
  p_now              timestamptz DEFAULT now()
) RETURNS jsonb
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_session            jsonb;
  v_cefr_promotion          jsonb;
  v_max_fluency_rating      numeric;
  v_max_grammar_rating      numeric;
  v_recent_resolved_error   jsonb;
  v_total_errors            integer;
  v_resolved_errors         integer;
  v_current_cefr_level      text;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Validate p_pre_cefr_level (NULL allowed — caller passes null when no
  -- pre-conversation level was captured).
  IF p_pre_cefr_level IS NOT NULL
     AND p_pre_cefr_level NOT IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2') THEN
    RAISE EXCEPTION 'invalid CEFR level: %', p_pre_cefr_level
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. prev_session — most-recent OTHER completed conversation, 21-day cutoff (inclusive).
  SELECT to_jsonb(ps.*)
  INTO v_prev_session
  FROM (
    SELECT ai_feedback, duration_seconds, completed_at
    FROM conversations
    WHERE user_id = p_user_id
      AND status = 'completed'
      AND id <> p_conversation_id
      AND completed_at >= p_now - INTERVAL '21 days'
    ORDER BY completed_at DESC
    LIMIT 1
  ) ps;
  IF v_prev_session IS NULL THEN
    v_prev_session := 'null'::jsonb;
  END IF;

  -- 2. cefr_promotion — non-null only if p_pre_cefr_level differs from current level.
  SELECT current_cefr_level
  INTO v_current_cefr_level
  FROM profiles
  WHERE id = p_user_id;

  IF v_current_cefr_level IS NOT NULL
     AND p_pre_cefr_level IS NOT NULL
     AND v_current_cefr_level <> p_pre_cefr_level THEN
    v_cefr_promotion := jsonb_build_object(
      'from', p_pre_cefr_level,
      'to',   v_current_cefr_level
    );
  ELSE
    v_cefr_promotion := 'null'::jsonb;
  END IF;

  -- 3 + 4. max_fluency_rating + max_grammar_rating — server-side MAX scalars with
  --        defensive JSONB numeric type-check (skips non-numeric historical rows).
  SELECT
    COALESCE(MAX(CASE WHEN jsonb_typeof(ai_feedback->'fluencyRating') = 'number'
                       THEN (ai_feedback->>'fluencyRating')::numeric
                       ELSE NULL END), 0),
    COALESCE(MAX(CASE WHEN jsonb_typeof(ai_feedback->'grammarRating') = 'number'
                       THEN (ai_feedback->>'grammarRating')::numeric
                       ELSE NULL END), 0)
  INTO v_max_fluency_rating, v_max_grammar_rating
  FROM conversations
  WHERE user_id = p_user_id
    AND status = 'completed'
    AND id <> p_conversation_id
    AND ai_feedback IS NOT NULL;

  -- 5. recent_resolved_error — most-recent resolved error within the 5-minute window.
  SELECT to_jsonb(re.*)
  INTO v_recent_resolved_error
  FROM (
    SELECT error_description
    FROM error_patterns
    WHERE user_id = p_user_id
      AND resolved = true
      AND last_occurred >= p_now - INTERVAL '5 minutes'
    ORDER BY last_occurred DESC
    LIMIT 1
  ) re;
  IF v_recent_resolved_error IS NULL THEN
    v_recent_resolved_error := 'null'::jsonb;
  END IF;

  -- 6. error_counts — single-query atomic snapshot via COUNT(*) FILTER.
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE resolved = true)::integer
  INTO v_total_errors, v_resolved_errors
  FROM error_patterns
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'prev_session',          v_prev_session,
    'cefr_promotion',        v_cefr_promotion,
    'max_fluency_rating',    v_max_fluency_rating,
    'max_grammar_rating',    v_max_grammar_rating,
    'recent_resolved_error', v_recent_resolved_error,
    'error_counts',          jsonb_build_object(
                               'total',    v_total_errors,
                               'resolved', v_resolved_errors
                             )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.get_session_feedback_aggregate(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.get_session_feedback_aggregate(uuid, uuid, text, timestamptz) TO authenticated;

-- ── 3.12 get_srs_notification_targets (from 20260402000000) ──────────────────
CREATE OR REPLACE FUNCTION companion.get_srs_notification_targets()
RETURNS TABLE (
  user_id uuid,
  due_count bigint,
  token text,
  platform text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
  SELECT v.user_id, COUNT(*) AS due_count, dt.token, dt.platform
  FROM vocabulary v
  JOIN profiles p ON p.id = v.user_id
  JOIN device_tokens dt ON dt.user_id = v.user_id
  WHERE v.next_review <= NOW()
    AND p.srs_reminders = true
  GROUP BY v.user_id, dt.token, dt.platform
  HAVING COUNT(*) >= 10;
$$;

REVOKE EXECUTE ON FUNCTION companion.get_srs_notification_targets() FROM public, anon, authenticated;

-- ── 3.13 get_streak_notification_targets (from 20260402000000) ───────────────
CREATE OR REPLACE FUNCTION companion.get_streak_notification_targets()
RETURNS TABLE (
  user_id uuid,
  streak_days integer,
  token text,
  platform text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
  SELECT p.id AS user_id, p.streak_days, dt.token, dt.platform
  FROM profiles p
  JOIN device_tokens dt ON dt.user_id = p.id
  WHERE p.streak_days > 0
    AND p.last_active_date < CURRENT_DATE
    AND p.streak_alerts = true;
$$;

REVOKE EXECUTE ON FUNCTION companion.get_streak_notification_targets() FROM public, anon, authenticated;

-- ── 3.13b get_nudge_notification_targets (Story 18-3, 2026-07-19) ────────────
-- Daily conversation nudge ("your pal texts you first"). Four server-side
-- eligibility filters: opt-in, per-user UTC-hour window, no-practice-today,
-- and a 20-hour one-per-day cap against notification_log (type 'nudge').
-- Context payload = TOP unresolved error pattern only. PRIVACY: never join
-- companion_memory here — nudges render on the LOCK SCREEN.
CREATE OR REPLACE FUNCTION companion.get_nudge_notification_targets()
RETURNS TABLE (
  user_id uuid,
  streak_days integer,
  token text,
  platform text,
  top_error_description text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
  SELECT
    p.id AS user_id,
    p.streak_days,
    dt.token,
    dt.platform,
    ep.error_description AS top_error_description
  FROM profiles p
  JOIN device_tokens dt ON dt.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT e.error_description
    FROM error_patterns e
    WHERE e.user_id = p.id
      AND e.resolved = false
    ORDER BY e.occurrences DESC, e.last_occurred DESC
    LIMIT 1
  ) ep ON true
  WHERE p.daily_nudge = true
    AND p.nudge_utc_hour = EXTRACT(HOUR FROM now())::smallint
    AND (p.last_active_date IS NULL OR p.last_active_date < CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1
      FROM notification_log nl
      WHERE nl.user_id = p.id
        AND nl.type = 'nudge'
        AND nl.sent_at > now() - INTERVAL '20 hours'
    );
$$;

REVOKE EXECUTE ON FUNCTION companion.get_nudge_notification_targets() FROM public, anon, authenticated;

-- ── 3.14 match_error_pattern (from 20260513000000; auth.uid()-scoped) ────────
DROP FUNCTION IF EXISTS companion.match_error_pattern(text, text, vector, double precision);
CREATE OR REPLACE FUNCTION companion.match_error_pattern(
  p_error_type        TEXT,
  p_error_description TEXT,
  p_query_embedding   VECTOR(1536),
  p_threshold         FLOAT DEFAULT 0.85
)
RETURNS TABLE (
  id          UUID,
  occurrences INTEGER,
  similarity  FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = companion, extensions, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ep.id,
    ep.occurrences,
    CASE
      WHEN ep.embedding IS NOT NULL THEN 1 - (ep.embedding <=> p_query_embedding)
      WHEN ep.error_description = p_error_description THEN 1.0
      ELSE 0.0
    END AS similarity
  FROM error_patterns ep
  WHERE ep.user_id = auth.uid()
    AND ep.error_type = p_error_type
    AND ep.resolved = FALSE
    AND (
      -- Arm 1: new rows with embedding → cosine threshold (strict greater-than)
      (ep.embedding IS NOT NULL AND 1 - (ep.embedding <=> p_query_embedding) > p_threshold)
      OR
      -- Arm 2: legacy NULL-embedding rows → string-equality fallback
      (ep.embedding IS NULL AND ep.error_description = p_error_description)
    )
  ORDER BY similarity DESC, ep.last_occurred DESC, ep.id
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.match_error_pattern(text, text, vector, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.match_error_pattern(text, text, vector, double precision) TO authenticated, service_role;

-- ── 3.15 update_streak_atomic (from 20260514000000) ──────────────────────────
CREATE OR REPLACE FUNCTION companion.update_streak_atomic(
  p_user_id    uuid,
  p_today      date,
  p_yesterday  date
) RETURNS integer
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_streak integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  UPDATE profiles
  SET streak_days = CASE
        WHEN last_active_date = p_today THEN COALESCE(streak_days, 0)
        WHEN last_active_date = p_yesterday THEN COALESCE(streak_days, 0) + 1
        WHEN last_active_date > p_today THEN COALESCE(streak_days, 0)
        ELSE 1
      END,
      last_active_date = p_today,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING streak_days INTO v_new_streak;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found for user_id %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_new_streak;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.update_streak_atomic(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.update_streak_atomic(uuid, date, date) TO authenticated;

-- ── 3.16 update_skill_progress_atomic (from 20260514000000) ──────────────────
CREATE OR REPLACE FUNCTION companion.update_skill_progress_atomic(
  p_user_id        uuid,
  p_skill          text,
  p_cefr_level     text,
  p_incoming_score numeric,
  p_time_minutes   integer
) RETURNS void
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Validate p_cefr_level early (skill_progress.cefr_level has no CHECK constraint).
  IF p_cefr_level NOT IN ('A1','A2','B1','B2','C1','C2') THEN
    RAISE EXCEPTION 'invalid CEFR level: %', p_cefr_level
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- NaN guard: NaN <> NaN in IEEE 754; catches both NaN and SQL NULL → 0.
  IF p_incoming_score IS NULL OR NOT (p_incoming_score = p_incoming_score) THEN
    p_incoming_score := 0;
  END IF;

  -- Clamp incoming score to [0, 100] server-side (mirrors clampScore).
  p_incoming_score := GREATEST(0, LEAST(100, p_incoming_score));

  INSERT INTO skill_progress (
    user_id, skill, cefr_level, score, exercises_completed,
    total_time_minutes, last_practiced
  )
  VALUES (
    p_user_id, p_skill, p_cefr_level, round(p_incoming_score), 1,
    COALESCE(p_time_minutes, 0), now()
  )
  ON CONFLICT (user_id, skill) DO UPDATE
  SET
    score = round(
      (
        (skill_progress.score * skill_progress.exercises_completed)
        + EXCLUDED.score
      ) / (skill_progress.exercises_completed + 1)::numeric
    ),
    exercises_completed = skill_progress.exercises_completed + 1,
    total_time_minutes  = skill_progress.total_time_minutes + EXCLUDED.total_time_minutes,
    last_practiced      = EXCLUDED.last_practiced,
    -- No-regress CEFR: keep the higher level (COALESCE array_position to 0 so
    -- legacy NULL/out-of-list stored values are treated as "below A1").
    cefr_level = CASE
      WHEN COALESCE(
             array_position(
               ARRAY['A1','A2','B1','B2','C1','C2'],
               EXCLUDED.cefr_level
             ),
             0
           ) > COALESCE(
             array_position(
               ARRAY['A1','A2','B1','B2','C1','C2'],
               skill_progress.cefr_level
             ),
             0
           )
        THEN EXCLUDED.cefr_level
      ELSE skill_progress.cefr_level
    END,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.update_skill_progress_atomic(uuid, text, text, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.update_skill_progress_atomic(uuid, text, text, numeric, integer) TO authenticated;

-- ── 3.17 increment_daily_activity_atomic (from 20260514000000) ───────────────
CREATE OR REPLACE FUNCTION companion.increment_daily_activity_atomic(
  p_user_id        uuid,
  p_date           date,
  p_minutes        integer,
  p_exercises      integer,
  p_conversations  integer,
  p_words          integer
) RETURNS void
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  INSERT INTO daily_activity (
    user_id, date,
    minutes_practiced, exercises_completed, conversations_completed, words_learned
  )
  VALUES (
    p_user_id, p_date,
    COALESCE(p_minutes, 0),
    COALESCE(p_exercises, 0),
    COALESCE(p_conversations, 0),
    COALESCE(p_words, 0)
  )
  ON CONFLICT (user_id, date) DO UPDATE
  SET
    minutes_practiced       = daily_activity.minutes_practiced       + EXCLUDED.minutes_practiced,
    exercises_completed     = daily_activity.exercises_completed     + EXCLUDED.exercises_completed,
    conversations_completed = daily_activity.conversations_completed + EXCLUDED.conversations_completed,
    words_learned           = daily_activity.words_learned           + EXCLUDED.words_learned;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.increment_daily_activity_atomic(uuid, date, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.increment_daily_activity_atomic(uuid, date, integer, integer, integer, integer) TO authenticated;

-- ── 3.18 promote_cefr_level_atomic (from 20260514000000) ─────────────────────
CREATE OR REPLACE FUNCTION companion.promote_cefr_level_atomic(
  p_user_id                 uuid,
  p_expected_current_level  text,
  p_next_level              text
) RETURNS boolean
SECURITY DEFINER
SET search_path = companion, extensions, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_updated integer;
  v_user_exists  boolean;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Validate p_next_level early.
  IF p_next_level NOT IN ('A1','A2','B1','B2','C1','C2') THEN
    RAISE EXCEPTION 'invalid CEFR level: %', p_next_level
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Distinguish "row missing" (raise) from "CAS mismatch" (return FALSE).
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    RAISE EXCEPTION 'profile not found for user_id %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE profiles
  SET current_cefr_level = p_next_level,
      updated_at = now()
  WHERE id = p_user_id
    AND current_cefr_level = p_expected_current_level;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION companion.promote_cefr_level_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION companion.promote_cefr_level_atomic(uuid, text, text) TO authenticated;


-- =============================================================================
-- SECTION 4 — TRIGGERS
-- =============================================================================
-- DROP ... IF EXISTS then CREATE for idempotency.

-- 4.1 updated_at auto-touch triggers
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON companion.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON companion.profiles
  FOR EACH ROW EXECUTE FUNCTION companion.set_updated_at();

DROP TRIGGER IF EXISTS trg_skill_progress_updated_at ON companion.skill_progress;
CREATE TRIGGER trg_skill_progress_updated_at
  BEFORE UPDATE ON companion.skill_progress
  FOR EACH ROW EXECUTE FUNCTION companion.set_updated_at();

DROP TRIGGER IF EXISTS set_device_tokens_updated_at ON companion.device_tokens;
CREATE TRIGGER set_device_tokens_updated_at
  BEFORE UPDATE ON companion.device_tokens
  FOR EACH ROW EXECUTE FUNCTION companion.set_updated_at();

-- 4.2 daily_activity → profiles.last_active_date auto-set
DROP TRIGGER IF EXISTS trg_daily_activity_last_active ON companion.daily_activity;
CREATE TRIGGER trg_daily_activity_last_active
  AFTER INSERT OR UPDATE ON companion.daily_activity
  FOR EACH ROW EXECUTE FUNCTION companion.update_last_active_date();

-- 4.3 Auth trigger — NAMESPACED (avoids collision with other apps in the shared
-- project) and METADATA-GATED so it fires ONLY for Companion signups. Companion's
-- client must call supabase.auth.signUp({ options: { data: { app: 'companion', ... } } }).
DROP TRIGGER IF EXISTS companion_on_auth_user_created ON auth.users;
CREATE TRIGGER companion_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  WHEN (NEW.raw_user_meta_data->>'app' = 'companion')
  EXECUTE FUNCTION companion.handle_new_user();


-- =============================================================================
-- SECTION 5 — ROW-LEVEL SECURITY (enable + policies)
-- =============================================================================
-- Every companion table has RLS enabled. User tables are auth.uid()-scoped.
-- notification_log / rate_limit_counters / daily_cost_ledger have RLS enabled with
-- NO policies (deny-all for anon/authenticated; service_role bypasses RLS).

-- 5.1 profiles (id-scoped: SELECT / UPDATE / INSERT / DELETE)
ALTER TABLE companion.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON companion.profiles;
CREATE POLICY "Users can view own profile" ON companion.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON companion.profiles;
CREATE POLICY "Users can update own profile" ON companion.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON companion.profiles;
CREATE POLICY "Users can insert own profile" ON companion.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can delete own profile" ON companion.profiles;
CREATE POLICY "Users can delete own profile" ON companion.profiles
  FOR DELETE USING (auth.uid() = id);

-- 5.2 skill_progress
ALTER TABLE companion.skill_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own skill progress" ON companion.skill_progress;
CREATE POLICY "Users can manage own skill progress" ON companion.skill_progress
  FOR ALL USING (auth.uid() = user_id);

-- 5.3 conversations
ALTER TABLE companion.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own conversations" ON companion.conversations;
CREATE POLICY "Users can manage own conversations" ON companion.conversations
  FOR ALL USING (auth.uid() = user_id);

-- 5.4 conversation_messages (ownership via parent conversation)
ALTER TABLE companion.conversation_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own conversation messages" ON companion.conversation_messages;
CREATE POLICY "Users can manage own conversation messages" ON companion.conversation_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM companion.conversations c
      WHERE c.id = conversation_messages.conversation_id
      AND c.user_id = auth.uid()
    )
  );

-- 5.5 exercises
ALTER TABLE companion.exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own exercises" ON companion.exercises;
CREATE POLICY "Users can manage own exercises" ON companion.exercises
  FOR ALL USING (auth.uid() = user_id);

-- 5.6 vocabulary
ALTER TABLE companion.vocabulary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own vocabulary" ON companion.vocabulary;
CREATE POLICY "Users can manage own vocabulary" ON companion.vocabulary
  FOR ALL USING (auth.uid() = user_id);

-- 5.7 mock_tests
ALTER TABLE companion.mock_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own mock tests" ON companion.mock_tests;
CREATE POLICY "Users can manage own mock tests" ON companion.mock_tests
  FOR ALL USING (auth.uid() = user_id);

-- 5.8 mock_test_answers
ALTER TABLE companion.mock_test_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own mock test answers" ON companion.mock_test_answers;
CREATE POLICY "Users can manage own mock test answers" ON companion.mock_test_answers
  FOR ALL USING (auth.uid() = user_id);

-- 5.9 daily_activity
ALTER TABLE companion.daily_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own daily activity" ON companion.daily_activity;
CREATE POLICY "Users can manage own daily activity" ON companion.daily_activity
  FOR ALL USING (auth.uid() = user_id);

-- 5.10 companion_memory
ALTER TABLE companion.companion_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own companion memory" ON companion.companion_memory;
CREATE POLICY "Users can manage own companion memory" ON companion.companion_memory
  FOR ALL USING (auth.uid() = user_id);

-- 5.11 error_patterns
ALTER TABLE companion.error_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own error patterns" ON companion.error_patterns;
CREATE POLICY "Users can manage own error patterns" ON companion.error_patterns
  FOR ALL USING (auth.uid() = user_id);

-- 5.12 device_tokens (4 separate policies)
ALTER TABLE companion.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own device tokens" ON companion.device_tokens;
CREATE POLICY "Users can read own device tokens"
  ON companion.device_tokens FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own device tokens" ON companion.device_tokens;
CREATE POLICY "Users can insert own device tokens"
  ON companion.device_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own device tokens" ON companion.device_tokens;
CREATE POLICY "Users can update own device tokens"
  ON companion.device_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own device tokens" ON companion.device_tokens;
CREATE POLICY "Users can delete own device tokens"
  ON companion.device_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- 5.13 notification_log — RLS enabled, NO policies (service_role only)
ALTER TABLE companion.notification_log ENABLE ROW LEVEL SECURITY;

-- 5.14 rate_limit_counters — RLS enabled, NO policies (service_role only)
ALTER TABLE companion.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- 5.15 daily_cost_ledger — RLS enabled, NO policies (service_role only)
ALTER TABLE companion.daily_cost_ledger ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 6 — SCHEMA-WIDE TABLE / SEQUENCE GRANTS + DEFAULT PRIVILEGES
-- =============================================================================
-- Table-level privileges are broad; RLS (Section 5) restricts rows. This is the
-- standard Supabase grant model. There are currently NO sequences in the schema
-- (all PKs use gen_random_uuid()); the sequence grants are harmless no-ops kept
-- for forward-compatibility.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA companion TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA companion TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA companion TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA companion TO authenticated, service_role;

-- Future objects created in this schema inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA companion
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA companion
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA companion
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA companion
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;


-- =============================================================================
-- ============ OPTIONAL: NOTIFICATION CRON + RATE-LIMIT CLEANUP CRON ===========
-- =============================================================================
-- RUN THIS APPENDIX ONLY AFTER:
--   (1) Enabling `pg_cron` AND `pg_net` via Dashboard → Database → Extensions.
--   (2) Seeding the two Vault secrets used by the push-notification job:
--         SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--         SELECT vault.create_secret('<cron-secret-value>', 'cron_secret');
--       The cron_secret MUST match the Edge Function secret:
--         supabase secrets set CRON_SECRET=<cron-secret-value>
--
-- All cron job names are prefixed `companion-` to avoid collisions with other
-- apps' cron jobs in this shared project. Each cron.schedule is wrapped in a
-- defensive cron.unschedule guard so re-running the appendix does not fail on the
-- cron.job jobname unique constraint. cron./net./vault. stay schema-qualified;
-- companion table/function references inside cron SQL are qualified `companion.`.
-- =============================================================================

-- The CREATE EXTENSION calls are idempotent no-ops if the extensions were already
-- enabled via the Dashboard (the preferred path). Kept for belt-and-braces.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Cron job 1: hourly push-notification dispatch ────────────────────────────
DO $do$
BEGIN
  PERFORM cron.unschedule('companion-send-push-notifications');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$do$;

SELECT cron.schedule(
  'companion-send-push-notifications',
  '0 * * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := jsonb_build_object('time', now()::text),
    timeout_milliseconds := 30000
  ) AS request_id;
  $job$
);

-- ── Cron job 2: daily notification_log cleanup (03:00) ───────────────────────
DO $do$
BEGIN
  PERFORM cron.unschedule('companion-cleanup-notification-log');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$do$;

SELECT cron.schedule(
  'companion-cleanup-notification-log',
  '0 3 * * *',
  $job$DELETE FROM companion.notification_log WHERE sent_at < now() - interval '24 hours';$job$
);

-- ── Cron job 3: nightly rate-limit + cost-ledger cleanup (02:00) ─────────────
DO $do$
BEGIN
  PERFORM cron.unschedule('companion-cleanup-rate-limits');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$do$;

SELECT cron.schedule(
  'companion-cleanup-rate-limits',
  '0 2 * * *',
  $job$SELECT companion.cleanup_stale_rate_limits();$job$
);


-- =============================================================================
-- FOOTER — MANUAL DASHBOARD STEPS THIS SQL CANNOT PERFORM
-- =============================================================================
-- 1. Settings → API → "Exposed schemas": add `companion` (so PostgREST / the JS
--    client can query it). The client must also target the schema, e.g.
--    createClient(url, key, { db: { schema: 'companion' } }).
-- 2. Optional cron appendix: enable `pg_cron` + `pg_net` via Dashboard → Database
--    → Extensions, seed the Vault secrets `project_url` + `cron_secret`, THEN run
--    the appendix above.
-- 3. Set Edge Function secrets: `supabase secrets set OPENAI_API_KEY=... \
--    AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... CRON_SECRET=...`.
-- 4. Signup metadata gate: the auth trigger only fires when a new user's
--    raw_user_meta_data->>'app' = 'companion', so Companion's signUp call MUST
--    pass options.data = { app: 'companion', full_name: '...' }.
-- =============================================================================
