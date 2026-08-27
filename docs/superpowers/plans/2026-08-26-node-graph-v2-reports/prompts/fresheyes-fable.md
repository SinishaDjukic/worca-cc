# Cold fresh-eyes review (Fable 5, max effort) — the REFINED plan <PLAN> (node-graph v2 <N>), worca

You have no history with this plan. Read IN FULL: `<PLAN>` (the refined v2), then the rebuild spec `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (your sections: <SECTIONS>) and the base spec's "Amendment f — full text" (`/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-10-node-graph-pipelines-design.md`, at the end). Repo `/Users/denislavprinov/Develop/worca-cc` (dev @ e6968e15) is READ-ONLY (open files to verify; never edit; never git add/commit/push/stash/clean; never `npm test` in the repo).

Review as the document a zero-context implementer will execute in a fresh worktree with NO access to the spec or any scratch report:
1. Document integrity: placeholders/TODO/"see spec"; a step without code where code is needed; symbols used before any task defines them; type/signature/name consistency between tasks (a function named X in Task 3 and X' in Task 7); import paths + depth; duplicate imports; commit messages; Task 0; sentinels; the split point (if any); the Q&A carries decisions with sources and invents no user answers.
2. Spec coverage: each requirement of the listed sections → a task; list gaps.
3. Contract sanity toward the successor plan (exports/signatures/messages the HANDOFF names as sentinels or the spec names as contracts).
4. Anything that looks empirically doubtful (an Expected text that Node would not print; an assertion that cannot fail; a DDL/SQL that SQLite rejects; a jsdom API that does not exist) — flag it for the re-execution agent rather than asserting.
Output `<SCRATCH>/reports/<N>-fresheyes.md` (Bash heredoc): findings `G<k>` with severity (CRITICAL/MAJOR/MINOR), location, problem, exact fix text. Final message = the CRITICAL+MAJOR lines + the path + a one-line verdict (ready to execute / not yet).
