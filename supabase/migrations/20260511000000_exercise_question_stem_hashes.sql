-- Story 10-8: Anti-cheat & frequency anti-repetition
--
-- Adds `question_stem_hashes TEXT[]` to `exercises` so the dedup
-- layer at `src/lib/exercise-dedup-db.ts` `getSeenHashes` can read
-- a user's last 100 completed exercises and skip already-seen
-- question stems on the next generation.
--
-- Forward-only: pre-Story-10-8 rows stay NULL and the dedup helper
-- treats NULL as "no hashes" (Story 10-6 forward-only pattern).
-- No backfill — the seen set will be sparse for early users but
-- grows monotonically as they complete post-10-8 exercises.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS question_stem_hashes TEXT[];

-- NOTE: GIN index intentionally NOT created here. Review-patch P11
-- (Blind Hunter BH18 + BH22): the Story 10-8 dedup query at
-- `getSeenHashes` reads the column via the existing
-- (user_id, skill, cefr_level, exercise_type, completed) filter
-- chain + ORDER BY completed_at — never via array membership.
-- A GIN index here would add write-amplification on every insert
-- (every completed exercise) for a benefit (inverse-direction
-- `WHERE question_stem_hashes && ARRAY[$1]` queries) that does
-- NOT yet exist. Furthermore, `CREATE INDEX` without `CONCURRENTLY`
-- locks the `exercises` table during build, which is hostile to
-- live writes (and Supabase wraps each migration in a transaction,
-- which forbids `CONCURRENTLY`).
--
-- Epic 13.x (server-side item bank caching) is the consumer of
-- array-membership queries; the index can be added then via a
-- separate migration that runs `CREATE INDEX CONCURRENTLY` outside
-- a transaction (the standard Supabase-recommended pattern for
-- non-blocking index builds on populated tables).

-- No RLS policy change needed: the existing
-- "Users can manage own exercises" FOR ALL USING (auth.uid() = user_id)
-- policy continues to govern the new column.
