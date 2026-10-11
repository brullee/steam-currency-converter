#!/usr/bin/env bash
# Gates for the verify skill. Usage: check.sh [--quick]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

quick=false
[ "${1:-}" = "--quick" ] && quick=true
status=0

run_step() {
  local label="$1"; shift
  echo "--- $label ---"
  if "$@"; then echo "✓ $label"; else echo "✗ $label"; status=1; fi
}

[ -d tests/node_modules ] || (cd tests && npm ci --silent)

# node:test prints TAP; keep failures and the summary so real errors stand out.
tap() { (cd tests && npm run --silent "$1" 2>&1 | grep -E '^not ok|^# (tests|pass|fail)|^\s+(error|expected|actual):'; exit "${PIPESTATUS[0]}"); }

run_step "unit" tap test

if $quick; then
  echo "- e2e skipped (--quick)"
else
  run_step "e2e" tap test:e2e
fi

# Two comparisons: uncommitted edits against HEAD, and this branch's commits against where
# it left main. One base-to-working-tree diff would miss an edit to a test file that was
# itself added on this branch - the whole file just shows up as new.
echo "--- tests not weakened ---"
base=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)
diff=$(git diff HEAD -- tests/unit tests/e2e tests/live; git diff "$base" HEAD -- tests/unit tests/e2e tests/live)
removed=$(grep -E '^-[^-].*(assert\.|test\()' <<< "$diff" || true)
added_skips=$(grep -E '^\+[^+].*(\.(skip|only|todo)\(|\{ *(skip|only|todo) *:)' <<< "$diff" || true)
if [ -z "$removed$added_skips" ]; then
  echo "✓ no assertions or tests removed, nothing skipped"
else
  echo "⚠ review these test changes - justify each one:"
  [ -n "$removed" ] && printf '%s\n' "$removed"
  [ -n "$added_skips" ] && printf '%s\n' "$added_skips"
  status=1
fi

exit $status
