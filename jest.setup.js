// Provide stub env vars so modules that instantiate clients at import time
// (e.g., src/lib/supabase.ts → createClient) load cleanly under Jest.
// We unconditionally overwrite to a known test value so a CI environment that
// happens to have a real production URL set (e.g., reused build secret) cannot
// leak into the test runner.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
