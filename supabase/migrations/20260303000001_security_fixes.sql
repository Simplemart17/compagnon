-- ============================================================
-- 20260303000001_security_fixes.sql
-- Security hardening:
--   1. Add DELETE RLS policy on profiles
--   2. Restrict cleanup_stale_data() execution to superuser only
--   3. Add SET search_path to SECURITY DEFINER functions
-- ============================================================

-- ─── 1. Add DELETE RLS policy on profiles ─────────────────────────────────────
-- The profiles table had SELECT, UPDATE, INSERT policies but no DELETE policy.
-- This allows users to delete their own profile (needed for account deletion).

CREATE POLICY "Users can delete own profile" ON profiles
  FOR DELETE USING (auth.uid() = id);

-- ─── 2. Restrict cleanup_stale_data() execution ──────────────────────────────
-- This function is SECURITY DEFINER and modifies/deletes data across all users.
-- It must only be callable by superusers (e.g., via pg_cron or manual admin).

REVOKE EXECUTE ON FUNCTION cleanup_stale_data() FROM public, anon, authenticated;

-- ─── 3. Harden SECURITY DEFINER functions with SET search_path ───────────────
-- Without SET search_path, a SECURITY DEFINER function can be exploited via
-- search_path manipulation. Re-create both functions with the fix.

-- 3a. handle_new_user() — auto-creates profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3b. update_last_active_date() — sets profiles.last_active_date on activity
CREATE OR REPLACE FUNCTION update_last_active_date()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET last_active_date = NEW.date
  WHERE id = NEW.user_id
    AND (last_active_date IS NULL OR last_active_date < NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
