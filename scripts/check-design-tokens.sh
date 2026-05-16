#!/usr/bin/env bash
# check-design-tokens.sh — CI check for raw design-token literals
# Scans app/ and src/ (except src/lib/design.ts, where Radii.* + Shadows.* are
# defined) for:
#   Pattern 1: rounded-[Nunit] arbitrary-value NativeWind classes
#     - integer or decimal value (e.g. `rounded-[1.5px]`)
#     - unit suffix: px / pt / rem / em / %
#   Pattern 2: raw shadowOpacity / shadowRadius / shadowOffset literals
#     - opacity / radius accept positive AND negative numeric literals
#     - offset accepts the canonical `{ width, height }` object form
# Magic-comment exemption: a line containing the `design-token-exempt` token
# INSIDE a `//` line comment, `{/* */}` JSX comment, or `/* */` block comment
# is skipped (per Story 14-4 AC-Q6 + R1-P6 hardening — bypass requires a
# comment-context marker, not an unbounded substring in any string literal).
# Exit 0 = clean, Exit 1 = violations found

set -euo pipefail

# Ensure we run from the repo root (where app/ and src/ live)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d "app" ] || [ ! -d "src" ]; then
  echo "ERROR: Must be run from the repo root (app/ and src/ directories not found)." >&2
  exit 2
fi

# Story 14-4 R1-P15: scan src/ entirely (was src/components/ + src/hooks/ + src/store/ + src/lib/).
# This covers src/styles/, src/types/, src/test-utils/ which were silently un-scanned pre-R1.
DIRS=(app/ src/)

# Story 14-4 R1-P8: the previous `--exclude=design.ts` was filename-based — a future
# `app/foo/design.ts` would have silently been exempted. We now post-filter by exact
# path so only the canonical-token-definition + drift-detector-test files are exempted.
# - `src/lib/design.ts` DEFINES the Radii.* + Shadows.* tokens themselves.
# - `src/lib/__tests__/design-token-enforcement-source-drift.test.ts` asserts the
#   gate's regex patterns AS LITERAL STRINGS inside describe/it descriptions; if it
#   weren't exempt it would self-flag (R1-P9 surfaced the test name "shadowOffset: { height: -4 }").
EXEMPT_PATHS=(
  "src/lib/design.ts"
  "src/lib/__tests__/design-token-enforcement-source-drift.test.ts"
)

filter_comments_and_exempts() {
  # Reads violation lines on stdin (format: file:line:content) and strips:
  #   - lines from the exempted path (R1-P8)
  #   - // line comments
  #   - {/* JSX comments */}
  #   - /* block comments */ and continuation * lines
  #   - lines where the violation only appears AFTER an inline // OR a trailing
  #     /* */ block comment (R1-P12: strip /* ... */ before re-check)
  #   - lines containing the `design-token-exempt` marker INSIDE a comment
  #     context (R1-P6: not an unbounded substring search)
  # The regex pattern to validate against is passed as $1.
  local pattern="$1"
  local filtered=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # R1-P8: drop the exempt paths explicitly (each EXEMPT_PATHS entry matches "<path>:NN:content").
    local is_exempt=0
    for exempt in "${EXEMPT_PATHS[@]}"; do
      case "$line" in
        "$exempt":*) is_exempt=1; break ;;
      esac
    done
    if [ "$is_exempt" -eq 1 ]; then
      continue
    fi
    content="${line#*:*:}"
    # Skip pure // comments
    if echo "$content" | grep -qE '^\s*//'; then
      continue
    fi
    # Skip JSX comments {/* ... */}
    if echo "$content" | grep -qE '^\s*\{/\*'; then
      continue
    fi
    # Skip block comments /* ... */ or continuation * lines
    if echo "$content" | grep -qE '^\s*(/\*|\*\s|\*/)'; then
      continue
    fi
    # R1-P6: skip exempted lines only when the marker appears in a comment context.
    # Accepts: trailing `//... design-token-exempt`, trailing `/*... design-token-exempt`,
    # or JSX `{/*... design-token-exempt`. Bare string-literal occurrences (e.g.,
    # `const evil = "design-token-exempt"`) no longer bypass the gate.
    if echo "$content" | grep -qE '(//|/\*|\{/\*)[^"]*design-token-exempt'; then
      continue
    fi
    # R1-P12: strip BOTH trailing inline `// ...` comments AND inline `/* ... */`
    # block comments before re-checking the pattern. Pre-R1 a line like
    # `const c = ""; /* shadowOpacity: 0.5 */` was wrongly flagged because the
    # block-comment content was preserved.
    code_before_comment=$(echo "$content" | sed -E 's|/\*[^*]*\*/||g; s|//.*||')
    if ! echo "$code_before_comment" | grep -qE "$pattern"; then
      continue
    fi
    filtered="${filtered}${line}"$'\n'
  done
  printf '%s' "${filtered%$'\n'}"
}

# --- Pattern 1: rounded-[Nunit] arbitrary-value NativeWind classes ---
# R1-P11: accept decimal values + unit suffix variation (px / pt / rem / em / %).
# Pre-R1 the regex required integer-px only; `rounded-[1.5px]` / `rounded-[10pt]` /
# `rounded-[1rem]` / `rounded-[50%]` all bypassed.
radius_pattern='rounded-\[[0-9]+(\.[0-9]+)?(px|pt|rem|em|%)\]'
radius_raw=$(grep -rn --include='*.ts' --include='*.tsx' -E "$radius_pattern" "${DIRS[@]}" 2>/dev/null || true)
radius_violations=""
if [ -n "$radius_raw" ]; then
  radius_violations=$(echo "$radius_raw" | filter_comments_and_exempts "$radius_pattern")
fi

# --- Pattern 2: raw shadow primitives in JS-style objects ---
# R1-P7: accept negative-numeric literals (`shadowOpacity: -0.5`). Optional `-`.
# R1-P9: ALSO cover `shadowOffset: { ... }` (the canonical object-form offset
# primitive). Pre-R1 a regression could re-introduce `shadowOffset: { width: 0, height: 4 }`
# silently because only opacity + radius were scanned.
shadow_prim_pattern='(shadowOpacity|shadowRadius)\s*:\s*-?[0-9.]+'
shadow_offset_pattern='shadowOffset\s*:\s*\{'
shadow_raw=$(grep -rn --include='*.ts' --include='*.tsx' -E "$shadow_prim_pattern|$shadow_offset_pattern" "${DIRS[@]}" 2>/dev/null || true)
shadow_violations=""
if [ -n "$shadow_raw" ]; then
  # The filter helper takes ONE pattern; we pass the combined alternation so it
  # re-validates after comment-stripping for both branches.
  shadow_violations=$(echo "$shadow_raw" | filter_comments_and_exempts "$shadow_prim_pattern|$shadow_offset_pattern")
fi

if [ -n "$radius_violations" ] || [ -n "$shadow_violations" ]; then
  echo "ERROR: Raw design-token literals found. Use Radii.* / Shadows.* from @/src/lib/design instead."
  echo ""
  if [ -n "$radius_violations" ]; then
    echo "Raw rounded-[Nunit] arbitrary radii (use a Tailwind preset class or Radii.* token):"
    echo "$radius_violations"
    echo ""
    echo "Fix: rounded-[16px] → rounded-2xl (Radii.card); rounded-[12px] → rounded-xl (Radii.button);"
    echo "     rounded-[8px] / rounded-[10px] → rounded-lg (Radii.chip); pills → rounded-full;"
    echo "     rounded-[28px] (hero bottom corners) → inline style={{borderRadius: Radii.heroBottom}}."
    echo ""
  fi
  if [ -n "$shadow_violations" ]; then
    echo "Raw shadowOpacity/shadowRadius/shadowOffset literals (spread Shadows.* token instead):"
    echo "$shadow_violations"
    echo ""
    # R1-P17: the Shadows.* roster is `card / hero / subtle / bottomSheet` (NOT heroSubtle —
    # that was the spec recommendation but the impl shipped `bottomSheet` for the load-bearing
    # negative-height auth-sheet semantic).
    echo "Fix: spread one of ...Shadows.card / ...Shadows.hero / ...Shadows.subtle / ...Shadows.bottomSheet."
    echo "     If the value is a bespoke per-state glow (e.g., active-recording pulse), add the magic-comment"
    echo "     exemption \`design-token-exempt\` inside a comment on the same line with a rationale."
    echo ""
  fi
  echo "Reference: src/lib/design.ts (Radii.* + Shadows.* token definitions). See Story 14-4."
  exit 1
fi

echo "No raw design-token literals found."
exit 0
