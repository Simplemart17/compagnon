#!/usr/bin/env bash
# check-hex-colors.sh — CI check for hardcoded hex color values
# Scans app/, src/components/, src/hooks/, src/store/, and src/lib/ for raw hex literals
# Allowed locations: src/lib/design.ts, src/lib/constants.ts (design token definitions)
#
# Exemptions (Story 14-4 follow-up `14-4-followup-test-fixture-hex-exemption`):
#   - Test files (**/__tests__/**, *.test.ts[x], *.spec.ts[x]) — fixtures and the
#     design-token drift detectors legitimately embed hex literals (e.g. a test
#     that asserts `design.ts` still defines `streak: "#F59E0B"`). Mirrors the
#     drift-detector exemption already in scripts/check-design-tokens.sh.
#   - Comments — // line comments, {/* JSX */}, /* block */, block-comment
#     continuation prose (lines physically inside a /* ... */ that don't start
#     with a `*` marker), and inline trailing // comments.
#
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

# Print "yes" if physical line $2 of file $1 begins inside an unterminated
# /* ... */ (or {/* ... */}) block comment, else "no". Catches continuation
# prose that does not start with a `*` marker. Ignores the rare `/*` / `*/`
# inside string literals — acceptable for a lint-style check.
in_block_comment() {
  awk -v target="$2" '
    NR==target { print (inblock ? "yes" : "no"); exit }
    {
      s = $0
      while (1) {
        if (inblock) { p = index(s, "*/"); if (p==0) break; s = substr(s, p+2); inblock=0 }
        else         { p = index(s, "/*"); if (p==0) break; s = substr(s, p+2); inblock=1 }
      }
    }
  ' "$1"
}

# Find hex color patterns, excluding design token files
# The regex requires # to be preceded by a word boundary or line start to avoid URL anchors
violations=$(grep -rn --include='*.ts' --include='*.tsx' "${EXCLUDE_FILES[@]}" -E '(^|[^&\w])#[0-9a-fA-F]{3,8}\b' "${DIRS[@]}" 2>/dev/null || true)

# Filter out exempt lines (test files + comments in all their forms)
if [ -n "$violations" ]; then
  filtered=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    content="${rest#*:}"

    # Exempt test files — fixtures + design-token drift-detector assertions.
    case "$file" in
      */__tests__/* | *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx) continue ;;
    esac

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
    # Skip block-comment continuation prose that does not start with a marker
    # (e.g. a wrapped {/* ... */} JSX comment whose middle lines carry a hex
    # inside explanatory text).
    if [ "$(in_block_comment "$file" "$lineno")" = "yes" ]; then
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
