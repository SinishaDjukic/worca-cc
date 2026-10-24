---
name: adding-a-run-engine
description: Traps when adding a run engine beyond claude/codex (the registry is not the only engine list)
paths: src/core/engines/**, src/core/exec-env/**, test/exec-env-*.test.mjs, src/shared/engine-switch.mjs, src/core/model-env.mjs, src/core/settings*.mjs, src/core/config.mjs, ui/public/*.mjs, ui/public/app.js
updated: 2026-10-24T07:26:10.332Z
author: Bulibas
---

Registering an adapter in `src/core/engines/index.mjs` is not enough. Three hidden traps:

- **Silent coercion to Claude.** Many sites use `x === 'codex' ? 'codex' : 'claude'`. A new engine's catalog rows,
  settings and UI picks then quietly become Claude. Examples: `config.mjs` `engineTag`, `settings.mjs`
  `sanitizeGlobalModel` / `assertModelEngine`, `workflows.mjs` resolveGraph, `ask/models.mjs`, `ui/server.mjs` Ask
  turn engine, `models-view.mjs` `collectModelEditor`, `app.js` `setRunEngine`. Grep `=== 'codex'` in src and ui.
- **Silent coercion to Codex.** Other sites use `engine !== 'claude'` to mean codex: `phases.mjs` fanOutDirective and
  the skills hint, the helper jobs (title, overview, PR description, classifier, night decider pass
  `sandbox: 'read-only'`), and `model-test.mjs`.
- **The usage-limit switch vanishes.** `src/shared/engine-switch.mjs` `otherEngine()` answers only when exactly ONE
  other engine exists. A third engine makes it null everywhere: no error, just no offer.

Also: the helper jobs pass `bin: this.claude.bin`. That is the RUN engine's binary. Forward it only when the helper
runs on the same engine, or a "Claude" helper launches the other CLI. The same holds for the `claudeAuth` seam's
default in `orchestrator.mjs` (`probeClaudeAuth({ bin: this.claude.bin })`).

More traps found while planning the Cursor engine (each one cost a refine cycle):
- `runCwd` is still null at every engine-gate call (`_engineGate`, `_engineResumeGate`, the server's
  `engineStartRefusal`). Never key a gate check on it.
- `_assembleContext` runs only in detached run-root mode. Register §8.8 injected paths beside `_mountMemory()`, which
  runs in both modes. `_reattachMemoryForStop` returns early when memory never mounted, so register from `stopPaused`.
- `utilityModelFor(engine, …)` also serves agent-node slots that run ON the run engine (memory defrag, workspace scan).
  Mapping a new engine to Claude's slots there puts Claude models on that engine's nodes.
- A file the spawn reads from the checkout must be readable by the agent user (`asAgent` spawns): `superviseSpawn`
  shares only `stagedDir` with the agent's group. Write it 0644 if it holds no secret.
- Removing an export from `src/shared/engine-switch.mjs` breaks `ui/public/app.js`'s import, and with it every jsdom
  test. Change app.js in the same step. Resume-menu items are bound once at setup: clones need a delegated listener.
- Run-root teardown scans for strays against `RUN_ROOT_KNOWN_SET` (`run-manifest.mjs`); a new run-root file needs an entry.
- An engine config file worca writes into a cwd is "worca's" only if worca can prove it wrote it. "Untracked" is not
  proof: outside git that is every file, and `model-test.mjs` spawns in the server's own cwd (often `$HOME`, holding
  the user's `~/.cursor/`). An agent may also write the same path as the deliverable. Own such files by a content-hash
  ledger, and run a full-tools model test in a temp cwd.
- Before you rewrite a validator block, grep for every name it binds. `policy/registry.mjs` reads `codex` again
  outside the codex block (the upstream check), and a ReferenceError there is caught and silently drops the entry.
- A line appended to `info/exclude` goes to the SHARED common-dir file in a linked worktree and is never removed.
  worca's own staging honours it: `_commitWork` (`git add -A`, and its porcelain "no changes" check),
  `_stageWorkingTree` (`add -A -N`) and liveDiff (`ls-files --exclude-standard`). So dropping a foreign file from the
  §8.8 set does not put it in the commit; force-stage it (`git add -f`) when `git check-ignore -v --no-index` shows
  only worca's own line decides. A test that writes no exclude line hides this. Find such files from the checkout
  itself, not from the run's registered §8.8 entries: a LATER run on any engine registers nothing, yet the line still
  hides the agent's file.
- Never pass an exclude pathspec for a file an ignore rule already matches: `git add -A -- . ':(exclude).cursor/cli.json'`
  stages the rest but exits 1 ("paths are ignored … use -f"; git 2.50.1), and `_commitWork` then fails at
  `step: 'add'` and retains the work. A directory or wildcard exclude does not trigger it; a literal file path does.
  Keep such files out with the ignore line plus `git rm --cached --ignore-unmatch` after the add.

Found in implementation review (each one blocked a review cycle):
- An engine with `cost: false` must read "cost unknown" on the TEXT surfaces too, not only in the browser UI. These
  format `totalCostUsd` as a number and print `$0.00`: `src/cli/render.mjs` `formatTotals` (end-of-run summary),
  `src/cli/runs.mjs` run detail, `src/core/chat/command-router.mjs` `/cost` `/status` `/last`, and
  `src/core/chat/renderers.mjs` completion message, and `src/core/ask/follow.mjs`. Use `runCostLabel` (src/shared/
  engine-switch.mjs) or chat's `fmtRunCost`. Trap: History LIST entries (`artifacts.mjs` `rowToHistoryEntry`, fed by
  `listAllPipelines`/`listPipelines`) carry only the columns their SELECT names, so `r.runEngine` was undefined there
  (read as Claude) until `run_engine` was SELECTed. Only the detail state (`state.runEngine`) had it.
- Before writing an engine config file into a checkout, `lstat` the config directory (`.cursor`). A symlinked dir
  passes the "tracked" and "absent, so owned" checks, and the write lands at the link's target (`~/.cursor` included).

Remote (E2B/loopback) runs on another engine (seen 2026-10-21, run ca4bb3b7):
- A remote codex/copilot run still calls this machine's CLI in `_engineChecks` (its helper jobs stay on the run engine,
  `helperEngineFor`). Any test that builds such a run without `claude.mock` must set `claude.bin` or
  `WORCA_<ENGINE>_BIN` to a nonexistent path. Unsetting `WORCA_CODEX_BIN` ran the user's real `codex login status`.
  `WORCA_MOCK=1` alone does not set `claude.mock` in the CLI run path.
- Two guards doing one job cannot be pinned: removing either stays green. In `runCodexProcess`, `home = remote ? null`
  also hid the rollout, so `f.completed || remote` had no test that could fail. Leave one guard per invariant.

Engine facts that UI, CLI and chat text show come from the catalog (core-4, 2026-10-24). A new engine fills its
`ENGINES` presentation fields: `harness`, `efforts`, `ask`, `signInLabel`, `signInHint`, `helpersNote`, `helperSlots`
and `modelConnection`. It edits no ui/public, src/cli or src/core/ask file.
- Pickers use `engineOptions`; the CLI `--engine` help uses `engineHelpList()`; the chat rules use `engineList`.
- `HELPER_ENGINE_NAMES`, and with it the `models.<e>.utility.*` setting keys, follow `helperSlots` only, never the note.
- `ask/tools.mjs` imports nothing. Engine facts reach it as `deps.engineCatalog`, which `tool-deps.mjs`
  `defaultToolDeps` passes the way it passes `limits`. A unit fake without it gets descriptions that name no engine.
- `model-proposal.mjs`'s Connection row is `modelConnection`, and its Efforts row is "none" when `efforts` is empty.
`test/boundary-ui-catalog.test.mjs` scans ui/public, src/shared, src/cli and src/core/ask. It counts engine ids and labels
per file against an ALLOWED map that may only shrink, and it catches array literals that copy an engine's effort list.
A brief that says "every static copy, and elsewhere" includes the CLI help and the chat tools and rules: review
bounced cycle 1 for missing them. Prove the claim on each engine PR's OWN commit (#643 `e66ce86a3`, #819 `d6cafc934`,
#672 `5dd3a8f4e`, not its branch): `git show <sha> --stat`, then `git merge-file` per file. Still hard-coded (follow-ups):
the own-sign-in checks in settings, policy and plugin-manifest, and `ask/settings-registry.mjs` Codex helper slots.
Also `ask/tools.mjs` `propose_model_change`'s per-engine model rules ("a cursor model takes no env, no upstream and no
efforts (cursor-agent's own sign-in)"). #819 and #672 each add a sentence there, so after a `git merge-file` their
sentence survives and fails the guard: the rebase must build those clauses from `modelConnection` (or a new field).
The guard counts hits, so swapping one allowed hit for a new one in the same file stays green.
