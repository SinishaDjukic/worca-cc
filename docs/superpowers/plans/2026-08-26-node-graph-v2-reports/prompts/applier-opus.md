# Edit-manifest applier (Opus) — node-graph v2 plans, worca

Apply the edit manifest at `<MANIFEST>` to the plan files it names (all under `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/` — writing those untracked files is the ONLY repo write allowed; never git add/commit/push/stash/clean; never touch any other repo file; never `npm test` in the repo).

Procedure, per edit in manifest order:
1. `grep -c -F '<old_string first line>' <file>` must be exactly 1 (uniqueness); if 0 or > 1, do NOT guess — try to disambiguate with the surrounding lines the manifest quotes; if still ambiguous, record the edit as SKIPPED with the reason and continue.
2. Apply with the Edit tool (exact old_string → new_string). Confirm by re-grepping for a distinctive fragment of new_string.
3. After all edits: banned-string verification on every plan file — `grep -n -E 'TBD|TODO|see spec|see the spec|adapt as needed|similar to Task|fill in|<!--END-->' <file>` must be empty (list any hit; do not fix content you were not told to fix — report it).
4. `wc -l` each plan before/after.
Report (final message + `<SCRATCH>/reports/apply-<label>.md` via Bash heredoc): applied / skipped (with reasons) per plan, banned-string hits, line counts.
