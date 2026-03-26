-- ============================================================
-- 20260325000000_fix_handle_new_user_regression.sql
-- Fix handle_new_user() regression from 20260303000001:
--   The security-fixes migration re-created handle_new_user() with
--   SET search_path but lost the robustness improvements from
--   20260301000002 (ON CONFLICT, EXCEPTION handler, input sanitization).
--   This migration restores all improvements while keeping search_path fix.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
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
