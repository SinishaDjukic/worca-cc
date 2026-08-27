# Anchor fact-check (Opus) — plan <PLAN> (node-graph v2 <N>), worca

Repo `/Users/denislavprinov/Develop/worca-cc` (dev @ e6968e15) is READ-ONLY. Never git add/commit/push/stash/clean/checkout; never `npm test` in the repo; never edit repo files. Old branch: `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:<path>`.

Read the plan `<PLAN>` in full. Then verify, against the REAL working tree, EVERY factual claim it makes:
- every `path:line` anchor (open the file, quote the actual line; report drift ±lines and wrong lines),
- every quoted "existing" line/snippet the plan says to replace (must match byte-for-byte),
- every symbol/export/function/test-file the plan says EXISTS on dev (grep it),
- every import path + relative depth (`..` count) the plan writes,
- every existing test the plan modifies (line ranges + the assertions it names),
- every "copied VERBATIM from the old branch" claim (diff the embedded code against `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:<path>`; report every difference),
- every Expected: failure/pass text that pins a Node/assert message shape (does Node 22+/`node:test` actually print that?),
- the Task 0 sentinel greps (would they match the predecessor plan's exact export text? read the predecessor plan `<PRED>`),
- cross-checks the spec makes about test files (e.g. `EXPECTED_TABLES` length, pins of version numbers): run the plan's own grep commands and report what they print.
Output `<SCRATCH>/reports/<N>-anchors.md` (Bash heredoc, chunks) — a table: `#` · plan location (task/step) · claim · verdict (OK / DRIFT / WRONG / MISSING) · correction (exact replacement text). Then a short list of the 10 most consequential corrections. Final message = that list + the path.
