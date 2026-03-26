#!/usr/bin/env bash
# check-hex-colors.sh — CI check for hardcoded hex color values
# Scans app/, src/components/, src/hooks/, src/store/, and src/lib/ for raw hex literals
# Allowed locations: src/lib/design.ts, src/lib/constants.ts (design token definitions)
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
EXCLUDE_FILES=(--exclude=design.ts --exclude=constants.ts)

# Find hex color patterns, excluding design token files
# The regex requires # to be preceded by a word boundary or line start to avoid URL anchors
violations=$(grep -rn --include='*.ts' --include='*.tsx' "${EXCLUDE_FILES[@]}" -E '(^|[^&\w])#[0-9a-fA-F]{3,8}\b' "${DIRS[@]}" 2>/dev/null || true)

# Filter out comments: // line comments, inline // comments, {/* JSX comments */}, /* block comments */
if [ -n "$violations" ]; then
  filtered=""
  while IFS= read -r line; do
    # Extract the content after file:line: prefix
    content="${line#*:*:}"
    # Skip lines that are pure // comments
    if echo "$content" | grep -qE '^\s*//'; then
      continue
    fi
    # Skip lines that are JSX comments {/* ... */}
    if echo "$content" | grep -qE '^\s*\{/\*'; then
      continue
    fi
    # Skip lines that are block comments /* ... */ or continuation * lines
    if echo "$content" | grep -qE '^\s*(/\*|\*\s|\*/)'; then
      continue
    fi
    # Skip if the hex literal only appears after // (inline trailing comment)
    code_before_comment=$(echo "$content" | sed 's|//.*||')
    if ! echo "$code_before_comment" | grep -qE '(^|[^&\w])#[0-9a-fA-F]{3,8}\b'; then
      continue
    fi
    filtered="${filtered}${line}"$'\n'
  done <<< "$violations"
  violations="${filtered%$'\n'}"
fi

if [ -n "$violations" ]; then
  echo "ERROR: Hardcoded hex colors found. Use Colors.* design tokens from @/src/lib/design instead."
  echo ""
  echo "Violations:"
  echo "$violations"
  echo ""
  echo "Fix: Replace hex values with design tokens (e.g., Colors.textSecondary, Colors.primary)"
  exit 1
fi

echo "No hardcoded hex colors found."
exit 0
