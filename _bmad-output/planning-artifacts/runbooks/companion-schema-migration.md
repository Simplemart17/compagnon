# Migrating Companion to a shared Supabase project (schema: `companion`)

Moves the entire Companion database from the implicit `public` schema into a
dedicated `companion` schema in a **shared** Supabase project (multiple apps +
one shared `auth` schema).

**Code changes are already landed** (this branch): every `createClient` (RN app
+ all 6 Edge Functions) sets `db: { schema: "companion" }`, and `signUpWithEmail`
tags new users with `app: "companion"` so the metadata-gated auth trigger only
fires for Companion signups. The DB side is the single file
[`supabase/companion-schema.sql`](../../../supabase/companion-schema.sql) (1.5k
lines, final consolidated state of all 16 migrations — paste + run in the
Dashboard SQL editor).

---

## ⚠️ Decide first: fresh start vs. preserving existing data

`companion-schema.sql` creates the **structure only** (empty tables). It does NOT
move data.

- **Fresh start (no existing users to keep):** skip data migration entirely.
  Follow steps 1–6 below.
- **Preserving existing users/data:** this is the hard case, because in a shared
  project the **`auth.users` pool is shared and separate from your current
  project's**. You cannot just copy rows — every `profiles.id` /`user_id` FKs to
  `auth.users(id)`, and those UUIDs only exist in the OLD project's auth. You
  must first migrate the auth users (Supabase `auth` schema export/import, or a
  re-invite/re-signup flow that preserves ids), THEN `pg_dump --data-only` the
  old `public` tables and load them into `companion.*`. Treat this as its own
  project — it is not covered by the single file. **Verify the auth-user
  migration strategy with your Supabase plan before running anything.**

---

## Order of operations (fresh start)

1. **Enable `vector`** — the script does `CREATE EXTENSION IF NOT EXISTS vector`;
   if your shared project already has it (in `public` or `extensions`), that's a
   no-op and the script's `SET search_path = companion, extensions, public`
   resolves it either way. No action unless the extension is disabled project-wide.

2. **Run `companion-schema.sql`** in Dashboard → SQL Editor. It is idempotent
   (safe to re-run). Runs the core schema only — the cron appendix at the bottom
   is clearly delimited and should be skipped on this pass unless prerequisites
   (step 5) are met.

3. **Expose the schema:** Dashboard → Settings → API → **Exposed schemas** → add
   `companion`. Without this, the client's `.from()`/`.rpc()` return
   `PGRST106 / schema must be one of the following` even though the objects exist.
   (The RN + Edge clients already target `companion` in code.)

4. **Set Edge Function secrets** (project-global): `supabase secrets set
   OPENAI_API_KEY=... AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... CRON_SECRET=...`
   then `supabase functions deploy ai-proxy realtime-session pronunciation-assess
   account-delete notification-register send-notifications`.

   **API keys (publishable/secret):** the code already handles both key systems.
   The RN client reads `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (falling back to
   the legacy `EXPO_PUBLIC_SUPABASE_ANON_KEY`) — set the publishable key
   (`sb_publishable_...`) in the app's env. Edge Functions read the new
   `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` JSON-dict env vars
   (auto-injected by Supabase, `["default"]`), falling back to the legacy
   `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — no action needed beyond
   confirming those secrets exist in Dashboard → Edge Functions → Secrets.
   **Deploy the functions with `--no-verify-jwt`** (they self-verify via
   `supabase.auth.getUser()`): the platform's built-in `verify_jwt` only
   understands the legacy JWT-based keys, so it must stay off when using the
   new keys — which is already this project's deploy posture.

5. **(Optional) push notifications:** enable `pg_cron` + `pg_net` via Dashboard →
   Database → Extensions, insert the Vault secrets `project_url` + `cron_secret`,
   THEN run the **OPTIONAL cron appendix** at the bottom of the SQL file (its jobs
   are namespaced `companion-*` so they don't collide with other apps in the
   shared project).

6. **Ship the client build** — the `db: { schema: "companion" }` + signup-metadata
   changes are already in the code on this branch; build/OTA as usual.

---

## Verification (after steps 1–4)

- `select count(*) from companion.profiles;` returns 0 rows (no error) → schema +
  grants OK.
- Sign up a test user in the app → a `companion.profiles` row appears (metadata
  gate + trigger OK). Sign up via a DIFFERENT app in the shared project (or via
  the dashboard without the `app` metadata) → NO `companion.profiles` row (gate
  correctly scoped).
- Home screen loads (exercises `get_home_aggregate` RPC resolves → exposed-schema
  + function search_path OK).
- Start a voice conversation → memory retrieval works (`match_memories` → pgvector
  operator resolves → `extensions`/`public` on function search_path OK).
- `curl` the cost-cap RPC directly with an anon JWT and a forged `p_user_id` →
  `auth.uid() must match p_user_id` exception (hardening carried through).

---

## Rollback

The old `public`-schema project is untouched — point the client env back at the
old project URL/anon key (and revert the two client commits) to fall back. To
drop the new schema: `DROP SCHEMA companion CASCADE;` (does NOT touch shared
`auth.users`; but manually `DROP TRIGGER IF EXISTS companion_on_auth_user_created
ON auth.users;` first since triggers on `auth.users` are not inside `companion`).

---

## Residual caveats (unchanged from the feasibility review)

- **Shared `auth.users`** — one user pool for every app in the project. The
  metadata gate prevents cross-app `profiles` pollution, but auth users, email
  templates, and auth rate-limits are shared. Triggers on `auth.users` may be
  restricted on some plans — if the trigger `CREATE` fails, switch to lazy
  client-side profile creation.
- **Profile creation is email-signup-only (today).** The metadata gate fires
  only when `raw_user_meta_data.app = 'companion'`, which currently only
  `signUpWithEmail` sets — and email/password is the app's only signup method
  (no OAuth / magic-link / admin-created). Before adding ANY non-email signup
  path, tag it with the same metadata or add a client-side `companion.profiles`
  upsert fallback, or those users land on the profile-retry surface.
- **`companion-schema.sql` is the authoritative artifact.** It contains the
  hardened `companion.*` RPCs the app actually calls. The standalone
  `supabase/migrations/20260518000000_rate_limit_cost_rpc_hardening.sql` hardens
  the `public.*` copies — which the app no longer invokes once it routes to
  `companion` — so it is relevant only to a legacy `public`-schema deployment.
- **Deploy ordering is load-bearing.** The client build ships
  `db:{schema:"companion"}`; if the app is deployed BEFORE `companion-schema.sql`
  is run and `companion` is added to Exposed schemas, every DB call + RPC fails.
  Always complete steps 2–3 before shipping the client (step 6).
- **Project-global namespaces** — Edge Function names, cron job names (namespaced
  `companion-*` here), and secrets are shared with the other app(s).
- **`db reset` is destructive** to the whole shared project — never run it.
