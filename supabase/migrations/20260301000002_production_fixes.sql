-- ============================================================
-- 003_production_fixes.sql
-- Production readiness fixes:
--   1. Performance indexes on user_id and hot query columns
--   2. Fix handle_new_user trigger (ON CONFLICT + exception handler)
--   3. Replace match_memories function (use auth.uid(), drop match_user_id param)
--   4. Replace ivfflat index with HNSW (no minimum row count requirement)
--   5. Add missing CHECK constraint on mock_tests.status
--   6. Add missing conversation_messages.conversation_id index
--   7. Add mock_test_answers table with RLS (referenced in docs, missing from schema)
-- ============================================================

-- ─── 1. Performance indexes ───────────────────────────────────────────────────

-- user_id indexes (required by RLS policies and common queries)
CREATE INDEX IF NOT EXISTS idx_skill_progress_user       ON skill_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user        ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_user            ON exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_user           ON vocabulary(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_tests_user           ON mock_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_activity_user       ON daily_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_companion_memory_user     ON companion_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_error_patterns_user       ON error_patterns(user_id);

-- Compound indexes for hot query patterns
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date
  ON daily_activity(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_error_patterns_user_unresolved
  ON error_patterns(user_id, resolved, occurrences DESC);

CREATE INDEX IF NOT EXISTS idx_vocabulary_user_review
  ON vocabulary(user_id, next_review);

CREATE INDEX IF NOT EXISTS idx_exercises_user_skill
  ON exercises(user_id, skill, created_at DESC);

-- Foreign key index missing from conversation_messages
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
  ON conversation_messages(conversation_id);

-- ─── 2. Fix handle_new_user trigger ──────────────────────────────────────────
-- Added: ON CONFLICT DO NOTHING (prevents duplicate profile crash)
-- Added: EXCEPTION block (prevents auth signup rollback on any trigger error)

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 3. Fix match_memories — use auth.uid() instead of caller-supplied param ─
-- Removes the match_user_id parameter entirely.
-- RLS on companion_memory enforces row ownership; auth.uid() is authoritative.

DROP FUNCTION IF EXISTS match_memories(VECTOR, UUID, INT, FLOAT);

CREATE OR REPLACE FUNCTION match_memories(
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
SET search_path = public
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

-- ─── 4. Replace ivfflat with HNSW for companion_memory ───────────────────────
-- ivfflat with lists=100 requires ~4,000 rows for accurate recall.
-- HNSW has no minimum row count requirement and performs better on small datasets.

DROP INDEX IF EXISTS companion_memory_embedding_idx;

CREATE INDEX IF NOT EXISTS idx_companion_memory_embedding
  ON companion_memory USING hnsw (embedding vector_cosine_ops);

-- ─── 5. Add missing CHECK constraint on mock_tests.status ────────────────────

ALTER TABLE mock_tests
  DROP CONSTRAINT IF EXISTS mock_tests_status_check;

ALTER TABLE mock_tests
  ADD CONSTRAINT mock_tests_status_check
  CHECK (status IN ('in_progress', 'completed', 'abandoned'));

-- ─── 6. Create mock_test_answers table (referenced in docs, missing from schema) ──

CREATE TABLE IF NOT EXISTS mock_test_answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_test_id    UUID NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_index  INT NOT NULL,
  selected_option TEXT,
  is_correct      BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mock_test_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own mock test answers" ON mock_test_answers
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_mock_test_answers_test
  ON mock_test_answers(mock_test_id);

CREATE INDEX IF NOT EXISTS idx_mock_test_answers_user
  ON mock_test_answers(user_id);
