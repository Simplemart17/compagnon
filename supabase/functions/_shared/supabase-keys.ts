/**
 * Supabase API key resolution for Edge Functions.
 *
 * Supabase's new API keys (publishable / secret) replace the legacy
 * `anon` / `service_role` keys. In Edge Functions they arrive as JSON
 * DICTIONARIES keyed by key-name — `SUPABASE_PUBLISHABLE_KEYS` /
 * `SUPABASE_SECRET_KEYS` — NOT the plain strings the legacy vars used. The
 * `"default"` entry is the key created at project setup.
 *
 * The legacy plain-string vars (`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`)
 * are still auto-injected ALONGSIDE the new ones during the transition, so this
 * resolver prefers the new dict key and falls back to the legacy var — a
 * zero-downtime swap that works whether the project has migrated its keys yet
 * or not. (Verified against Supabase docs "Migrating to new API keys" +
 * "Edge Functions secrets", 2026-07.)
 *
 * Role semantics are UNCHANGED: the publishable key resolves to the `anon`
 * Postgres role (→ `authenticated` when a user JWT is attached); the secret
 * key bypasses RLS like `service_role`. So RLS policies + `GRANT ... TO
 * anon/authenticated/service_role` need no changes.
 *
 * NOTE: platform-level `verify_jwt` only understands the legacy JWT-based keys,
 * so functions using the new keys must deploy with `--no-verify-jwt` (these
 * functions already do — they self-verify via `supabase.auth.getUser()`).
 */

const DEFAULT_KEY_NAME = "default";

function resolveKey(
  dictVar: string,
  legacyVar: string,
  keyName: string = DEFAULT_KEY_NAME
): string | undefined {
  const raw = Deno.env.get(dictVar);
  if (raw) {
    try {
      const dict = JSON.parse(raw) as Record<string, unknown>;
      const key = dict[keyName];
      if (typeof key === "string" && key.length > 0) {
        return key;
      }
    } catch {
      // Malformed dict — fall through to the legacy plain-string var.
    }
  }
  const legacy = Deno.env.get(legacyVar);
  return legacy && legacy.length > 0 ? legacy : undefined;
}

/**
 * Publishable (client-safe, low-privilege) key. Prefers the new
 * `SUPABASE_PUBLISHABLE_KEYS["default"]`; falls back to the legacy
 * `SUPABASE_ANON_KEY`. Resolves to the `anon` / `authenticated` Postgres role.
 */
export function getSupabasePublishableKey(keyName?: string): string | undefined {
  return resolveKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY", keyName);
}

/**
 * Secret (server-only, RLS-bypassing) key. Prefers the new
 * `SUPABASE_SECRET_KEYS["default"]`; falls back to the legacy
 * `SUPABASE_SERVICE_ROLE_KEY`. NEVER expose this to a client.
 */
export function getSupabaseSecretKey(keyName?: string): string | undefined {
  return resolveKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY", keyName);
}
