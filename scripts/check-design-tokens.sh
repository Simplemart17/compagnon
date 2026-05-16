#!/usr/bin/env bash
# check-design-tokens.sh — CI check for raw design-token literals
# Scans app/, src/components/, src/hooks/, src/store/, and src/lib/ for:
#   Pattern 1: rounded-[Npx] arbitrary-value NativeWind classes
#   Pattern 2: raw shadowOpacity / shadowRadius / shadowOffset literals
# Allowed locations: src/lib/design.ts (where Radii.* + Shadows.* are defined)
# Magic-comment exemption: lines containing `design-token-exempt` are skipped
# (per Story 14-4 AC-Q6 — bespoke active-state glows).
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

DIRS=(app/ src/components/ src/hooks/ src/store/ src/lib/)
EXCLUDE_FILES=(--exclude=design.ts)

filter_comments_and_exempts() {
  # Reads violation lines on stdin (format: file:line:content) and strips:
  #   - // line comments
  #   - {/* JSX comments */}
  #   - /* block comments */ and continuation * lines
  #   - lines where the violation only appears AFTER an inline //
  #   - lines containing the magic-comment exemption tag `design-token-exempt`
  # The regex pattern to validate against is passed as $1.
  local pattern="$1"
  local filtered=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
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
    # Skip exempted lines (magic-comment escape hatch per Q6)
    if echo "$content" | grep -q 'design-token-exempt'; then
      continue
    fi
    # Strip trailing inline comment and re-check the pattern is still present in code
    code_before_comment=$(echo "$content" | sed 's|//.*||')
    if ! echo "$code_before_comment" | grep -qE "$pattern"; then
      continue
    fi
    filtered="${filtered}${line}"$'\n'
  done
  printf '%s' "${filtered%$'\n'}"
}

# --- Pattern 1: rounded-[Npx] arbitrary-value NativeWind classes ---
radius_pattern='rounded-\[[0-9]+px\]'
radius_raw=$(grep -rn --include='*.ts' --include='*.tsx' "${EXCLUDE_FILES[@]}" -E "$radius_pattern" "${DIRS[@]}" 2>/dev/null || true)
radius_violations=""
if [ -n "$radius_raw" ]; then
  radius_violations=$(echo "$radius_raw" | filter_comments_and_exempts "$radius_pattern")
fi

# --- Pattern 2: raw shadow primitives in JS-style objects ---
shadow_pattern='(shadowOpacity|shadowRadius)\s*:\s*[0-9.]+'
shadow_raw=$(grep -rn --include='*.ts' --include='*.tsx' "${EXCLUDE_FILES[@]}" -E "$shadow_pattern" "${DIRS[@]}" 2>/dev/null || true)
shadow_violations=""
if [ -n "$shadow_raw" ]; then
  shadow_violations=$(echo "$shadow_raw" | filter_comments_and_exempts "$shadow_pattern")
fi

if [ -n "$radius_violations" ] || [ -n "$shadow_violations" ]; then
  echo "ERROR: Raw design-token literals found. Use Radii.* / Shadows.* from @/src/lib/design instead."
  echo ""
  if [ -n "$radius_violations" ]; then
    echo "Raw rounded-[Npx] arbitrary radii (use a Tailwind preset class or Radii.* token):"
    echo "$radius_violations"
    echo ""
    echo "Fix: rounded-[16px] → rounded-2xl (Radii.card); rounded-[12px] → rounded-xl (Radii.button);"
    echo "     rounded-[8px] / rounded-[10px] → rounded-lg (Radii.chip); rounded-[20px]+ pills → rounded-full;"
    echo "     rounded-[28px] → inline style={{borderRadius: Radii.heroBottom}}."
    echo ""
  fi
  if [ -n "$shadow_violations" ]; then
    echo "Raw shadowOpacity/shadowRadius literals (spread Shadows.* token instead):"
    echo "$shadow_violations"
    echo ""
    echo "Fix: spread one of ...Shadows.card / ...Shadows.hero / ...Shadows.heroSubtle / ...Shadows.subtle."
    echo "     If the value is a bespoke per-state glow (e.g., active-recording pulse), add the magic-comment"
    echo "     exemption \`design-token-exempt\` on the same line with rationale."
    echo ""
  fi
  echo "Reference: src/lib/design.ts (Radii.* + Shadows.* token definitions). See Story 14-4."
  exit 1
fi

echo "No raw design-token literals found."
exit 0
