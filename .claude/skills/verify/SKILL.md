---
name: verify
description: Run this project's gates (unit tests, Chrome e2e tests) and check no test was weakened, before calling a code change done. Use after editing anything under content/, shared/, background/, popup/, the manifests or tests/, and before suggesting a commit.
---

Run `.claude/skills/verify/check.sh` from the repo root. It runs, in order:

1. `npm test` in `tests/` - jsdom unit tests, including the manifest-consistency check.
2. `npm run test:e2e` in `tests/` - the packed Chrome build in real Chrome on fixture pages, offline. About 15s.
3. A diff of `tests/` against the branch point with `main`, flagging removed assertions or tests and any new `skip`/`only`/`todo`.

Pass `--quick` to skip step 2 when the change can't affect the extension at runtime (docs, CI config, `.claude/`).

Report each step's actual result from the output - never summarize as "looks good". If step 3 flags anything, say which assertion or test changed and why that change is correct; a test loosened just to make it pass is a failure, not a fix.

These gates use fixture pages, so they can't see Steam changing its markup. If the change depends on how a live Steam page is built, also use the `check-live` skill.
