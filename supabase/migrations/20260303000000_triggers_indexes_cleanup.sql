-- ============================================================
-- 004_triggers_indexes_cleanup.sql
-- P3: Production & compliance improvements:
--   1. Auto-update updated_at timestamps via trigger
--   2. Auto-set profiles.last_active_date via trigger on daily_activity
--   3. Additional performance indexes
--   4. Data retention cleanup function (abandoned conversations, stale data)
-- ============================================================

-- ─── 1. updated_at trigger function ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables that have an updated_at column
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_skill_progress_updated_at
  BEFORE UPDATE ON skill_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. Auto-set last_active_date when daily_activity is inserted/updated ───

CREATE OR REPLACE FUNCTION update_last_active_date()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET last_active_date = NEW.date
  WHERE id = NEW.user_id
    AND (last_active_date IS NULL OR last_active_date < NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_daily_activity_last_active
  AFTER INSERT OR UPDATE ON daily_activity
  FOR EACH ROW EXECUTE FUNCTION update_last_active_date();

-- ─── 3. Additional performance indexes ──────────────────────────────────────

-- Conversations: filter by status (active vs completed) and list by date
CREATE INDEX IF NOT EXISTS idx_conversations_status
  ON conversations(user_id, status);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON conversations(user_id, created_at DESC);

-- Vocabulary: next_review for SRS queries (standalone, not compound)
CREATE INDEX IF NOT EXISTS idx_vocabulary_next_review
  ON vocabulary(next_review);

-- Mock tests: list by date
CREATE INDEX IF NOT EXISTS idx_mock_tests_created_at
  ON mock_tests(user_id, created_at DESC);

-- ─── 4. Data retention cleanup function ─────────────────────────────────────
-- Call via: SELECT cleanup_stale_data();
-- Safe to run periodically (e.g., via pg_cron or a scheduled Edge Function).

CREATE OR REPLACE FUNCTION cleanup_stale_data()
RETURNS TABLE (
  abandoned_conversations INT,
  stale_exercises INT,
  orphan_messages INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
