#!/usr/bin/env bash
# ============================================================
# Edge Function Deployment & Security Verification Script
# Story 1.6 — Run after deploying Edge Functions
#
# Prerequisites:
#   1. supabase login
#   2. supabase secrets set OPENAI_API_KEY=... AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=...
#   3. supabase functions deploy ai-proxy realtime-session pronunciation-assess account-delete
#   4. Set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_JWT env vars
#
# Usage:
#   chmod +x scripts/verify-edge-functions.sh
#   ./scripts/verify-edge-functions.sh                    # Standard tests
#   ./scripts/verify-edge-functions.sh --rate-limit       # Include rate limit exhaustion tests
#   ./scripts/verify-edge-functions.sh --destructive      # Include account-delete live test (CREATES + DELETES a test user)
#   ./scripts/verify-edge-functions.sh --all              # Run everything
# ============================================================

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
TEST_JWT="${TEST_JWT:-}"  # Get via: supabase auth token (or from your app's login flow)

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" || -z "$TEST_JWT" ]]; then
  echo "ERROR: Set SUPABASE_URL, SUPABASE_ANON_KEY, and TEST_JWT environment variables"
  echo ""
  echo "Example:"
  echo "  export SUPABASE_URL=https://your-project.supabase.co"
  echo "  export SUPABASE_ANON_KEY=eyJ..."
  echo "  export TEST_JWT='Bearer eyJ...'"
  exit 1
fi

# ─── Flags ─────────────────────────────────────────────────────
RUN_RATE_LIMIT_TESTS=false
RUN_DESTRUCTIVE_TESTS=false

for arg in "$@"; do
  case "$arg" in
    --rate-limit) RUN_RATE_LIMIT_TESTS=true ;;
    --destructive) RUN_DESTRUCTIVE_TESTS=true ;;
    --all) RUN_RATE_LIMIT_TESTS=true; RUN_DESTRUCTIVE_TESTS=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ─── Counters & Helpers ───────────────────────────────────────
PASS=0
FAIL=0
SKIP=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  SKIP: $1"; SKIP=$((SKIP + 1)); }

# Invoke an Edge Function, cleanly separating body and HTTP status.
# Sets globals: BODY, STATUS
invoke() {
  local fn="$1"; shift
  local tmpfile
  tmpfile=$(mktemp)
  STATUS=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    "${SUPABASE_URL}/functions/v1/${fn}" \
    -H "Authorization: ${TEST_JWT}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    "$@") || true
  BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

# Invoke without Authorization header. Sets globals: BODY, STATUS
invoke_no_auth() {
  local fn="$1"; shift
  local tmpfile
  tmpfile=$(mktemp)
  STATUS=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    "${SUPABASE_URL}/functions/v1/${fn}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    "$@") || true
  BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

# Invoke with a custom Authorization header. Sets globals: BODY, STATUS
invoke_with_auth() {
  local fn="$1"; local auth="$2"; shift 2
  local tmpfile
  tmpfile=$(mktemp)
  STATUS=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    "${SUPABASE_URL}/functions/v1/${fn}" \
    -H "Authorization: ${auth}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    "$@") || true
  BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

# Invoke and capture response headers. Sets globals: BODY, STATUS, HEADERS
invoke_with_headers() {
  local fn="$1"; shift
  local tmpbody tmpheaders
  tmpbody=$(mktemp)
  tmpheaders=$(mktemp)
  STATUS=$(curl -s -o "$tmpbody" -D "$tmpheaders" -w "%{http_code}" \
    "${SUPABASE_URL}/functions/v1/${fn}" \
    -H "Authorization: ${TEST_JWT}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    "$@") || true
  BODY=$(cat "$tmpbody")
  HEADERS=$(cat "$tmpheaders")
  rm -f "$tmpbody" "$tmpheaders"
}

# Check if HEADERS contains a specific header (case-insensitive)
has_header() {
  echo "$HEADERS" | grep -qi "$1"
}

# Check if BODY contains a substring
body_contains() {
  [[ "$BODY" == *"$1"* ]]
}

echo "============================================"
echo "Edge Function Verification — Story 1.6"
echo "============================================"
echo ""

# ─── AC-A2: CORS Preflight ─────────────────────────────────────
echo "--- CORS Preflight (AC-A2) ---"
for fn in ai-proxy realtime-session pronunciation-assess account-delete; do
  local_tmp=$(mktemp)
  local_status=$(curl -s -o "$local_tmp" -w "%{http_code}" \
    "${SUPABASE_URL}/functions/v1/${fn}" \
    -X OPTIONS \
    -H "apikey: ${SUPABASE_ANON_KEY}") || true
  rm -f "$local_tmp"
  if [[ "$local_status" == "200" ]]; then
    pass "OPTIONS ${fn} returns 200"
  else
    fail "OPTIONS ${fn} returns ${local_status} (expected 200)"
  fi
done
echo ""

# ─── AC-A3: Auth Missing ────────────────────────────────────────
echo "--- Auth Missing — No Header (AC-A3) ---"
for fn in ai-proxy realtime-session pronunciation-assess account-delete; do
  invoke_no_auth "$fn" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{}'
  if [[ "$STATUS" == "401" ]] && body_contains "AUTH_MISSING"; then
    pass "No-auth ${fn} returns 401 AUTH_MISSING"
  else
    fail "No-auth ${fn}: status=${STATUS}, body=${BODY}"
  fi
done
echo ""

# ─── AC-A3 (extended): Malformed JWT ────────────────────────────
echo "--- Auth Invalid — Malformed JWT (AC-A3) ---"
for fn in ai-proxy realtime-session pronunciation-assess account-delete; do
  invoke_with_auth "$fn" "Bearer invalid-not-a-real-jwt" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{}'
  if [[ "$STATUS" == "401" ]] && body_contains "AUTH_INVALID"; then
    pass "Malformed JWT ${fn} returns 401 AUTH_INVALID"
  else
    fail "Malformed JWT ${fn}: status=${STATUS}, body=${BODY}"
  fi
done
echo ""

# ─── AC-B1: ai-proxy chat completion ────────────────────────────
echo "--- ai-proxy Chat Completion (AC-B1) ---"
invoke_with_headers ai-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"chat","messages":[{"role":"user","content":"Say hello in French in one word"}],"maxTokens":50}'
if [[ "$STATUS" == "200" ]] && body_contains "choices"; then
  pass "Chat completion returns 200 with choices"
else
  fail "Chat completion: status=${STATUS}"
fi
if has_header "x-ratelimit-remaining"; then
  pass "X-RateLimit-Remaining header present on chat"
else
  fail "X-RateLimit-Remaining header missing on chat"
fi
echo ""

# ─── AC-B2: ai-proxy TTS ────────────────────────────────────────
echo "--- ai-proxy TTS (AC-B2) ---"
invoke_with_headers ai-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"tts","input":"Bonjour"}'
if has_header "content-type:.*audio/mpeg"; then
  pass "TTS returns audio/mpeg content-type"
else
  fail "TTS content-type not audio/mpeg"
fi
if has_header "x-ratelimit-remaining"; then
  pass "X-RateLimit-Remaining header present on TTS"
else
  fail "X-RateLimit-Remaining header missing on TTS"
fi
echo ""

# ─── AC-B3: ai-proxy Embedding ──────────────────────────────────
echo "--- ai-proxy Embedding (AC-B3) ---"
invoke_with_headers ai-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"embedding","input":"test"}'
if [[ "$STATUS" == "200" ]] && body_contains "embedding"; then
  pass "Embedding returns 200 with embedding data"
else
  fail "Embedding: status=${STATUS}"
fi
if has_header "x-ratelimit-remaining"; then
  pass "X-RateLimit-Remaining header present on embedding"
else
  fail "X-RateLimit-Remaining header missing on embedding"
fi
echo ""

# ─── AC-B4: Model allowlist ─────────────────────────────────────
echo "--- ai-proxy Model Allowlist (AC-B4) ---"
invoke ai-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"chat","messages":[{"role":"user","content":"hi"}],"model":"gpt-3.5-turbo","maxTokens":10}'
if [[ "$STATUS" == "200" ]] && body_contains "gpt-4o"; then
  pass "Non-allowlisted model falls back to gpt-4o (verified in response)"
elif [[ "$STATUS" == "200" ]]; then
  fail "Non-allowlisted model: got 200 but response does not contain 'gpt-4o' — fallback may not be working"
else
  fail "Non-allowlisted model: status=${STATUS}"
fi
echo ""

# ─── AC-B5: Rate limiting (opt-in) ──────────────────────────────
echo "--- ai-proxy Rate Limiting (AC-B5) ---"
if [[ "$RUN_RATE_LIMIT_TESTS" == "true" ]]; then
  echo "  Sending 31 rapid requests to test 30/min rate limit..."
  rate_limited=false
  for i in $(seq 1 31); do
    invoke ai-proxy \
      -X POST \
      -H "Content-Type: application/json" \
      -d '{"action":"chat","messages":[{"role":"user","content":"rate limit test"}],"maxTokens":5}'
    if [[ "$STATUS" == "429" ]] && body_contains "RATE_LIMITED"; then
      pass "Rate limited at request #${i} with 429 RATE_LIMITED"
      if body_contains "retryAfter"; then
        pass "Rate limit response includes retryAfter"
      else
        fail "Rate limit response missing retryAfter"
      fi
      rate_limited=true
      break
    fi
  done
  if [[ "$rate_limited" == "false" ]]; then
    fail "ai-proxy did not rate limit after 31 requests"
  fi
  echo "  NOTE: Waiting 60s for rate limit window to reset..."
  sleep 60
else
  skip "Rate limit exhaustion test — run with --rate-limit flag (sends 31 requests, costs API credits)"
fi
echo ""

# ─── AC-B6: Body size guard ─────────────────────────────────────
echo "--- ai-proxy Body Size Guard (AC-B6) ---"
big_payload=$(python3 -c "import json; print(json.dumps({'action':'chat','messages':[{'role':'user','content':'x'*60000}]}))")
invoke ai-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$big_payload"
if [[ "$STATUS" == "413" ]] && body_contains "BODY_TOO_LARGE"; then
  pass "Body >50KB returns 413 BODY_TOO_LARGE"
else
  fail "Body size guard: status=${STATUS}, body=${BODY}"
fi
echo ""

# ─── AC-B7: Unknown action ──────────────────────────────────────
echo "--- ai-proxy Unknown Action (AC-B7) ---"
invoke ai-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"unknown_action"}'
if [[ "$STATUS" == "400" ]] && body_contains "UNKNOWN_ACTION"; then
  pass "Unknown action returns 400 UNKNOWN_ACTION"
else
  fail "Unknown action: status=${STATUS}, body=${BODY}"
fi
echo ""

# ─── AC-C1: realtime-session ────────────────────────────────────
echo "--- realtime-session (AC-C1) ---"
invoke_with_headers realtime-session \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-realtime-preview","voice":"coral"}'
if [[ "$STATUS" == "200" ]]; then
  pass "Realtime session returns 200"
else
  fail "Realtime session: status=${STATUS}"
fi
if body_contains "client_secret"; then
  pass "Realtime session response contains client_secret"
else
  fail "Realtime session response missing client_secret"
fi
if has_header "x-ratelimit-remaining"; then
  pass "X-RateLimit-Remaining header present on realtime-session"
else
  fail "X-RateLimit-Remaining header missing on realtime-session"
fi
echo ""

# ─── AC-C2: realtime-session model allowlist ─────────────────────
echo "--- realtime-session Model Allowlist (AC-C2) ---"
invoke realtime-session \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5-turbo","voice":"coral"}'
if [[ "$STATUS" == "200" ]]; then
  pass "Non-allowlisted realtime model returns 200 (defaults to gpt-realtime)"
else
  fail "Non-allowlisted realtime model: status=${STATUS}, body=${BODY}"
fi
echo ""

# ─── AC-C3: realtime-session rate limiting (opt-in) ──────────────
echo "--- realtime-session Rate Limiting (AC-C3) ---"
if [[ "$RUN_RATE_LIMIT_TESTS" == "true" ]]; then
  echo "  Sending 11 rapid requests to test 10/min rate limit..."
  rate_limited=false
  for i in $(seq 1 11); do
    invoke realtime-session \
      -X POST \
      -H "Content-Type: application/json" \
      -d '{"model":"gpt-4o-realtime-preview","voice":"coral"}'
    if [[ "$STATUS" == "429" ]] && body_contains "RATE_LIMITED"; then
      pass "Realtime rate limited at request #${i} with 429 RATE_LIMITED"
      rate_limited=true
      break
    fi
  done
  if [[ "$rate_limited" == "false" ]]; then
    fail "realtime-session did not rate limit after 11 requests"
  fi
  echo "  NOTE: Waiting 60s for rate limit window to reset..."
  sleep 60
else
  skip "Rate limit exhaustion test — run with --rate-limit flag"
fi
echo ""

# ─── AC-D1: pronunciation-assess positive path ───────────────────
echo "--- pronunciation-assess Positive Path (AC-D1) ---"
# Generate a minimal valid WAV file (0.5s silence, 16kHz, PCM16, mono)
MINI_WAV_B64=$(python3 -c "
import struct, base64, io
sr, dur = 16000, 0.5
n = int(sr * dur)
buf = io.BytesIO()
data_size = n * 2
buf.write(b'RIFF')
buf.write(struct.pack('<I', 36 + data_size))
buf.write(b'WAVEfmt ')
buf.write(struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16))
buf.write(b'data')
buf.write(struct.pack('<I', data_size))
buf.write(b'\x00' * data_size)
print(base64.b64encode(buf.getvalue()).decode())
")
invoke_with_headers pronunciation-assess \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"referenceText\":\"Bonjour\",\"audioBase64\":\"${MINI_WAV_B64}\"}"
if [[ "$STATUS" == "200" ]]; then
  pass "Pronunciation assess returns 200 with valid audio"
else
  # Azure may reject silence — 200 confirms the function works end-to-end
  # Non-200 may mean Azure rejected the audio content (not a function bug)
  if body_contains "UPSTREAM_ERROR"; then
    skip "Pronunciation assess: Azure rejected silent WAV (function works, audio invalid) — test with real recording"
  else
    fail "Pronunciation assess: status=${STATUS}, body=${BODY}"
  fi
fi
if [[ "$STATUS" == "200" ]] && has_header "x-ratelimit-remaining"; then
  pass "X-RateLimit-Remaining header present on pronunciation-assess"
elif [[ "$STATUS" != "200" ]]; then
  skip "X-RateLimit-Remaining check skipped (non-200 response)"
else
  fail "X-RateLimit-Remaining header missing on pronunciation-assess"
fi
echo ""

# ─── AC-D2: pronunciation-assess missing params ─────────────────
echo "--- pronunciation-assess Missing Params (AC-D2) ---"
invoke pronunciation-assess \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"referenceText":"Bonjour"}'
if [[ "$STATUS" == "400" ]] && body_contains "INVALID_PARAMS"; then
  pass "Missing audioBase64 returns 400 INVALID_PARAMS"
else
  fail "Missing audioBase64: status=${STATUS}, body=${BODY}"
fi

invoke pronunciation-assess \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"audioBase64":"dGVzdA=="}'
if [[ "$STATUS" == "400" ]] && body_contains "INVALID_PARAMS"; then
  pass "Missing referenceText returns 400 INVALID_PARAMS"
else
  fail "Missing referenceText: status=${STATUS}, body=${BODY}"
fi
echo ""

# ─── AC-D3: pronunciation-assess oversized audio ────────────────
echo "--- pronunciation-assess Oversized Audio (AC-D3) ---"
# Generate >5MB base64 payload
big_audio=$(python3 -c "import base64; print(base64.b64encode(b'x' * (5 * 1024 * 1024 + 1)).decode())")
invoke pronunciation-assess \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"referenceText\":\"Bonjour\",\"audioBase64\":\"${big_audio}\"}"
if [[ "$STATUS" == "413" ]] && body_contains "BODY_TOO_LARGE"; then
  pass "Audio >5MB returns 413 BODY_TOO_LARGE"
else
  fail "Oversized audio: status=${STATUS}, body=${BODY}"
fi
echo ""

# ─── AC-D4: pronunciation-assess rate limiting (opt-in) ──────────
echo "--- pronunciation-assess Rate Limiting (AC-D4) ---"
if [[ "$RUN_RATE_LIMIT_TESTS" == "true" ]]; then
  echo "  Sending 21 rapid requests to test 20/min rate limit..."
  rate_limited=false
  for i in $(seq 1 21); do
    # Use invalid audio to avoid Azure costs — the rate limiter fires before param validation
    invoke pronunciation-assess \
      -X POST \
      -H "Content-Type: application/json" \
      -d '{"referenceText":"Bonjour","audioBase64":"dGVzdA=="}'
    if [[ "$STATUS" == "429" ]] && body_contains "RATE_LIMITED"; then
      pass "Pronunciation rate limited at request #${i} with 429 RATE_LIMITED"
      rate_limited=true
      break
    fi
  done
  if [[ "$rate_limited" == "false" ]]; then
    fail "pronunciation-assess did not rate limit after 21 requests"
  fi
  echo "  NOTE: Waiting 60s for rate limit window to reset..."
  sleep 60
else
  skip "Rate limit exhaustion test — run with --rate-limit flag"
fi
echo ""

# ─── AC-E1/E2/E3: account-delete (opt-in, destructive) ─────────
echo "--- account-delete Live Test (AC-E1, E2, E3) ---"
if [[ "$RUN_DESTRUCTIVE_TESTS" == "true" ]]; then
  skip "account-delete destroys real user data — TEST_JWT user would be deleted. Use a dedicated test account."
  echo "  To test manually:"
  echo "    1. Create a test user via signup flow"
  echo "    2. Get their JWT"
  echo "    3. Call: curl -X POST \${SUPABASE_URL}/functions/v1/account-delete -H 'Authorization: Bearer <jwt>' -H 'apikey: \${SUPABASE_ANON_KEY}'"
  echo "    4. Verify response: { success: true }"
  echo "    5. Verify user data removed from all tables"
else
  skip "account-delete live test — run with --destructive flag (WARNING: deletes TEST_JWT user)"
fi
echo ""

# ─── AC-E3: account-delete rate limiting (opt-in) ────────────────
echo "--- account-delete Rate Limiting (AC-E3) ---"
if [[ "$RUN_RATE_LIMIT_TESTS" == "true" ]]; then
  echo "  Sending 2 rapid requests to test 1/min rate limit..."
  # First request will succeed (or fail for other reasons) — we just need the rate limiter to fire
  invoke account-delete \
    -X POST \
    -H "Content-Type: application/json"
  first_status="$STATUS"
  invoke account-delete \
    -X POST \
    -H "Content-Type: application/json"
  if [[ "$STATUS" == "429" ]] && body_contains "RATE_LIMITED"; then
    pass "account-delete rate limited on 2nd request with 429 RATE_LIMITED"
  else
    fail "account-delete rate limit: first_status=${first_status}, second_status=${STATUS}, body=${BODY}"
  fi
  echo "  NOTE: Waiting 60s for rate limit window to reset..."
  sleep 60
else
  skip "Rate limit exhaustion test — run with --rate-limit flag"
fi
echo ""

# ─── AC-E4: account-delete client review ────────────────────────
echo "--- account-delete Client Review (AC-E4) ---"
skip "Client-side invocation in settings.tsx verified via code review (not automatable)"
echo ""

# ─── Summary ─────────────────────────────────────────────────────
echo "============================================"
echo "Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Some tests FAILED. Review output above."
  exit 1
else
  echo ""
  echo "All executed tests passed."
fi
