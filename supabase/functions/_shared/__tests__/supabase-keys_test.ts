/**
 * supabase-keys resolver tests (Deno-runnable).
 *
 * RUN MANUALLY: `deno test --no-check --allow-env=SUPABASE_PUBLISHABLE_KEYS,\
 *   SUPABASE_SECRET_KEYS,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY \
 *   --config supabase/functions/deno.json \
 *   supabase/functions/_shared/__tests__/supabase-keys_test.ts`
 *
 * CI runs it via the "Deno tests (Edge Function _shared utilities)" step.
 *
 * Pins the new-key (publishable/secret JSON-dict) → legacy (plain-string)
 * fallback contract so a future edit can't silently break key resolution in a
 * project that has migrated (or not yet migrated) its Supabase API keys.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getSupabasePublishableKey, getSupabaseSecretKey } from "../supabase-keys.ts";

const ENV_VARS = [
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function clearEnv(): void {
  for (const v of ENV_VARS) Deno.env.delete(v);
}

Deno.test("publishable: prefers new SUPABASE_PUBLISHABLE_KEYS[default] over legacy anon", () => {
  clearEnv();
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_new" }));
  Deno.env.set("SUPABASE_ANON_KEY", "legacy_anon");
  assertEquals(getSupabasePublishableKey(), "sb_publishable_new");
  clearEnv();
});

Deno.test("publishable: falls back to legacy anon when the new dict is unset", () => {
  clearEnv();
  Deno.env.set("SUPABASE_ANON_KEY", "legacy_anon");
  assertEquals(getSupabasePublishableKey(), "legacy_anon");
  clearEnv();
});

Deno.test("publishable: falls back to legacy anon when the new dict is malformed JSON", () => {
  clearEnv();
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", "{not valid json");
  Deno.env.set("SUPABASE_ANON_KEY", "legacy_anon");
  assertEquals(getSupabasePublishableKey(), "legacy_anon");
  clearEnv();
});

Deno.test("publishable: falls back when the dict lacks the requested key name", () => {
  clearEnv();
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ other: "x" }));
  Deno.env.set("SUPABASE_ANON_KEY", "legacy_anon");
  assertEquals(getSupabasePublishableKey(), "legacy_anon");
  clearEnv();
});

Deno.test("publishable: undefined when neither new nor legacy is set", () => {
  clearEnv();
  assertEquals(getSupabasePublishableKey(), undefined);
});

Deno.test("secret: prefers new SUPABASE_SECRET_KEYS[default] over legacy service_role", () => {
  clearEnv();
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_new" }));
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "legacy_service_role");
  assertEquals(getSupabaseSecretKey(), "sb_secret_new");
  clearEnv();
});

Deno.test("secret: falls back to legacy service_role when the new dict is unset", () => {
  clearEnv();
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "legacy_service_role");
  assertEquals(getSupabaseSecretKey(), "legacy_service_role");
  clearEnv();
});

Deno.test("custom keyName resolves the named key from the dict", () => {
  clearEnv();
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "d", mobile: "m" }));
  assertEquals(getSupabasePublishableKey("mobile"), "m");
  clearEnv();
});
