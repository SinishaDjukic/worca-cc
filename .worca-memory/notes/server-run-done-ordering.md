---
name: server-run-done-ordering
description: Read before driving runs or the server in-process (POST /api/run, schedules, stop/pause/resume, mock agents), a post-pause harness write, or a path alias
paths: ui/server.mjs, src/core/run-harness.mjs, src/core/orchestrator.mjs, src/core/artifacts.mjs, src/core/stop-paused.mjs, src/core/title.mjs, src/core/scheduler.mjs, src/core/run-overlay.mjs, test/api-*.test.mjs, test/*-api.test.mjs, test/orchestrator-*.test.mjs, test/ui-server-*.test.mjs, test/clarify-node*.test.mjs, test/step-questions-*.test.mjs, test/stop-paused-*.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Resume/stop claims and teardown windows: [[pipelines-db-traps]].

## What `done` means
- `run()`/`resume()`: (1) `_setStatus('done')` emits `state`, mirrored into `entry.status` at once — a poll on `status === 'done'` resolves HERE; (2) `_persist`, audit, `_buildResults`, `_stampDefrag`, `_reportToSource`, `_recordRunMetrics`; (3) `_emit('done')`; (4) `finally`: `_stopHeartbeat`, `await _teardownRunRoot()` (run root, checkouts, branches, run.json copy), `logWriter.close()`. Poll `runs.get(runId).settled` before asserting teardown output (status-only polls race under load); `spawnSync` in a test blocks the loop teardown needs.
- Browser consumers: the terminal `state` frame comes BEFORE the facts (stopped/error too): re-read on the `done` frame (`pokeAskRuns(runId, 'done')`), as History does.
- The first `exec` is `{nodeId:'preflight'}`, before `createPipeline`/`_setupRunRoot`: stopping there makes "a stopped run leaves no branch" vacuous — hook the agent node's `start`; mutation-check every stop/pause test.
- `resumeRun(pipelineId, opts)` defaults `baseCheck:false` (409 `base-moved`/`base-missing` only with `baseCheck === true && baseAck !== true`): UI Resume and the chat bridge send `baseCheck:true`. Map `engine-refused` via `engineRefusalFor(text, 'ui'|'chat')`.
- Two parallel POSTs stayed green with the reservation deleted: check + reservation are the first two statements of ONE function (no await between); test twice in one tick via `_testing`.
- A new target arm in `startRunHandler` (No project, Folder members) repeats the project arm's gates one by one (P3 skipped `checkStartPair(body, await listModels(dir))` and the one-live-defragment 409). Probe that 409 with a fake `runs.set('fake', {id, orch:{memoryScope:'global', pause: () => ({})}, projectDir, kind:'run', status:'running', events:[], pendingQuestion:null})`, deleted in `finally`.

## A paused harness outlives its pause
A resume builds a NEW harness on the same row while the paused one lives on; `writeState` is a FULL replace, so a late `_persist` from the old one overwrites the live run. Pause does not abort the title call (keep it).
- Guard = an ownership TOKEN, never a timestamp: `_completePaused` sets `_pauseToken`, `_persist` writes it as `resume_point.pausedBy`; `_rowHandedOff()` = row not `paused` OR `pausedBy` ≠ own token, latched. Handed off: `_persist` skips, `_recordCost` writes the ledger only, `_bookTitleCost`/`_nightBook*` emit nothing. Every NEW post-pause write/emit/log checks it (`wireRun` never detaches old listeners). Its `try … catch { return false }` hides a dropped `./artifacts.mjs` import (only `orchestrator-title` notices). Gap: `stop()` on a paused harness flips memory only.
- Probe: `createOrchestrator({…, titleRunClaude})` awaiting a gate; pause orch1, `orch2.resume()` to done, release, await `orch1._titlePromise`, `readPipelineForResume(id)`.

## Driving the real server in-process (mock)
- Copy `test/api-run-overlay.test.mjs`: env BEFORE `await import('<tree>/ui/server.mjs')` (no bind on import) — temp `HOME`/`USERPROFILE`/`WORCA_HOME`/`WORCA_PROJECTS_ROOT`, `WORCA_MOCK=1`, no `WORCA_HOST_PID`, no-real-claude PATH, `-u NODE_TEST_CONTEXT` or `WORCA_TEST_ALLOW_HOME_FALLBACK=1`; chdir into a throwaway git repo; `mod.server.listen(0,'127.0.0.1')`; `mod.runs` is the live Map. A bare `node -e` importing src/core reads the REAL home. Remove every `gitDir()` you make.
- Tickets: `_testing.fireTicket(getTicket(id,{withRequest:true}))` (real `req._internal` re-entry) or `POST /api/schedules/<id>/run-now`; the fired body is re-parsed (drops `effort:''`). `_testing.startRunHandler` + fake `res` + `{body, _internal:{ticket:{id, runAt}}}` fakes a fired ticket. `repeat.rule` = `{freq:'daily', time:'09:00', tz:'UTC'}`.
- A mock `wf_default` run parks on clarify even with `humanInLoop:false`: answer `POST /api/answer {runId, id, payload:{answers:[]}}`; prove a field is NOT parsed by posting it with `scheduledFor` a day out (202). `wf_memory_defrag` + `memoryScope` settles.
- Pause/resume: wrap `runs.set` to attach `orch.on('exec')`; on the first agent `start` `POST /api/pause {runId}`, poll `paused`, `POST /api/resume {pipelineId, mock:true}` → a new runId.
- Read-back: `GET /api/runs/<pid>?projectDir=…` and `/api/history/:key/:id` put the manifest under `state.stepper`; `entry.pipelineId` is empty right after the manifest appears (404): poll it.
- Workspace target: two `gitDir()` repos + `addProject` + `createWorkspace` → `POST /api/run {workspaceId}`; it resolves over `members[0]`: configure both.
- Non-Claude engines with `guardrailsId:'normal'` answer 409 `engine-refused`: use `'permissive'`. Project engine: `PATCH /api/projects/<key>/settings {"run.engine":"codex"}`.
- User catalog models live in `settingsFile()` (`defaultRoot()/.worca-cc/settings.json`), not `worcaHome()`. An OpenAI-Responses entry gets `harnesses: ['claude','codex']`: `ownedPair` maps its effort via `effortOn` (a `max` that `checkShapeModels` accepts runs as `high` on codex; `assertSlotModels` refuses it). `projectKey` is in `store.mjs`; `setStep` needs a model before an effort; per-node `setNodeModel`.
- Audit lines are DB rows (`pipeline_events`). WS checks origin: `connectAndCollect(id)`. Routes take `entry.id` AND `entry.pipelineId`; `GET /api/runs` needs `?projectDir=`; restart = `runs.delete(k)`.
- Out of process: a driver OUTSIDE the tree spawns `node ui/server.mjs` with one sandbox home on a free port (4399 is taken), kills only `child.pid`, finds rows by branch slug; SIGKILL + respawn = a real restart (`interrupted`).
- Real adapters, no binary: `WORCA_CLAUDE_BIN`/`WORCA_CURSOR_BIN`/`WORCA_CODEX_BIN` (read at load) → recording fakes, `WORCA_MOCK` unset (claude answers `--version`, `--help`, `auth status`). Git census: a `git` wrapper on PATH logging `$(pwd -P)\t$*`.

## A/B byte identity (checkpoint vs prototype)
One driver per clone over the SAME fixture paths (fixed git dates/names), both instrumented by a `module.registerHooks` `load` hook patching `runClaude(`/`runMock(`. Normalise times, UUIDs, hex ids, PIDs, temp names; keep `<slug>-<sha1(path)[:8]>` keys; capture TEXT, not hashes. The first mock spawn is the async title (`spawnKind:'aux'`). Member order, log order and concurrent git order are racy at the checkpoint too: diff base vs base first.

## Orchestrator fixtures
- Agents run in a worktree cut from HEAD: commit fixtures first. Auto mode primes no round file.
- `runMock`'s `MOCK_ASK` arm and `mockClarify` both write the ask file; `questionsPromptBlock` re-emits `MOCK_ASK` while `questionsAnswered` is empty. `ctx.meta` IS the registry entry. An injected `runners.producer` gets ctx BEFORE `readPriorAnswers` (delegate to `runAgentExecution`). "Same session" pins `[mock] resumed session <first id>`. `writeClarify`/`writeStepQuestions` run only in a graph run with a committed user-layer clarifier sidecar (`runnerType:'clarifier'`). Pause with a question open: `orch.pause()` in the `question` handler → `readPipelineForResume` → `createOrchestrator({…, resume: saved})` re-asks once.

## Path aliases (`/api/sets` → `/api/mcp`)
Express 4 matches case-insensitively, a hand-written alias regex does not (`/i`, pin mixed case). A path-scoped guard covers only later routes; re-dispatch re-runs global middleware. `fetch` folds `..`: use `http.request({path})`; a route added after import lands after the SPA fallback.
