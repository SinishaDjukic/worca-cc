# Wave-2 full re-execution (Opus) — the REFINED plan <PLAN> (node-graph v2 <N>), worca

Clone `<CLONE>` holds the wave-1 end state. Reset it to the plan's starting point FIRST: `git -C <CLONE> reset --hard <BASE> && git -C <CLONE> clean -fd` (node_modules survives), `WORCA_HOME=<HOME>` (wipe it: `rm -rf <HOME> && mkdir -p <HOME>`). Repo `/Users/denislavprinov/Develop/worca-cc` is READ-ONLY (never edit/git/`npm test` there). Wrap every command in `timeout 900`. No servers/browsers/`open`/non-exiting processes.

<PREREQ>

Execute the REFINED plan `<PLAN>` from scratch, every task, exactly as written (you are the zero-context implementer; commit per task in the clone; never push). Record predicted vs actual for every `Expected:`; any step that does not work as written is a FINDING with the exact plan-ready fix. Then re-run every wave-1 mutation SURVIVOR listed in `<SURVIVORS>` against the new tests and confirm each now goes RED (list any that still survive). Finally run `npm test` and record the total.
Output `<SCRATCH>/reports/<N>-reexec.md` (Bash heredoc, chunks): §1 per-task log, §2 findings with fixes, §3 survivor re-check table, §4 counts (baseline/final/added), §5 `git log --oneline`. Leave the clone in place. Final message = §2 + §3 + counts + path.
