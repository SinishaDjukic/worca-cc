---
name: git-gate-test-traps
description: Read before a git-missing/refusal/hide-set test row, or touching how a project folder relates to its repo (#693 refusal, project-create, plain-folder fixtures)
paths: test/ui-git-*.test.mjs, test/git-missing-*.test.mjs, test/nogit-stub.test.mjs, test/preflight*.test.mjs, test/cli-*.test.mjs, test/*routes*.test.mjs, test/helpers/git-app-boot.mjs, test/folder-*.test.mjs, test/stop-paused-harness.test.mjs, test/projects.test.mjs, test/project-create.test.mjs, test/orchestrator-worktree.test.mjs, test/workspaces-api.test.mjs, ui/public/git-gate.mjs, ui/public/ask-panel.mjs, ui/public/index.html, src/core/projects.mjs, src/core/project-create.mjs, src/core/workspaces.mjs, src/core/store.mjs, src/core/run-harness.mjs, src/core/clone-project.mjs, src/core/project-sync.mjs, src/core/metrics/sync.mjs, src/core/policy/sync.mjs, ui/server.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Who must probe git, spies, census: [[git-capability-child-processes]]. Mutation-check every gate row (delete the gate → red): RED runs alone never show vacuity.

## Rows that can never pass, or throw
- Run/History markup lives in `<template>`s (`run-detail-tpl`, `hist-detail-tpl`, `ws-detail-tpl`, …) and `querySelectorAll` never enters them: search `[doc, ...[...doc.querySelectorAll('template')].map((t) => t.content)]`; read `data-git` off the shell. Attributes survive `cloneNode`.
- Modules given a `doc` (`ask-panel.mjs`) run with NO global document: `gitOn(doc)` like `flagOn('…', doc)`.

## Rows that pass with the gate deleted
- `refreshSyncChips` is coalesced (300 ms): wait ~400 ms; check "no request" before "git arrives → read".
- A fresh `bootGitApp` selects no project (`/api/branches` never asked): select one with a bubbling `change`. A boot at `/` lands on `chat`; `onGitFlip` re-reads branches only on `#new` — boot there.
- `ui-git-hide-set` "source rows" regex-pin P0 lines verbatim: widen with a SECOND line, never edit P0's.
- Runners behind a wrapper gate (`_testing.setRunner|setGit`) cannot pin a caller-level loop gate: count a non-git side effect (`listProjectsFn`, policy `onTick`) and pin an `onGitChange` kick with a timer that cannot fire (`tickMs: 60_000`).
- Module-level listener sets (`git-gate.mjs`, `flags.mjs`) survive `app.js?b=` re-boots: a flip runs older boots' hooks too.
- Unit rows on Ask (`createAskTools`, `buildMcpConfig`) left 9 of 13 wiring gates unpinned: drive the tool server, a turn, checkout deps and `main()`. Rows injecting a dep never pin the production default (`deps.gitAvailable ?? (() => true)` passed every file): also a hello with git OFF, and pin `GIT_ONLY_ROUTES` as a literal list (minus later plans' removals: P5 two scan entries, P6 nine team + two plugin). Two gates on one path are equivalent mutants alone.
- One gate, two sites (Ask card render + `change` listener): build with git on, then set `ctx.doc.documentElement.dataset.git = 'off'` and fire `change`.
- Sweep runners deleting a table entry must take its trailing `,` (`[a, , b]` parses, then every row reds: a fake KILL).

## Rows that hang or do real work at RED
- `runClone(plan, {spawnImpl})` with a stub returning `undefined` arms the 10-min `CLONE_TIMEOUT_MS` first: the stub must THROW.
- CLI refusal rows with default stdin and cwd = checkout run the headless path when the guard is missing and cut `worca-cc/<slug>-<id>` in the CHECKOUT's repo: `stdio: ['ignore','pipe','pipe']` + `--project <mkdtemp>`, assert stderr; after a RED `git branch --list 'worca-cc/*'`. An in-process `POST /api/run` refusal row without `mock: true` starts a real run. `checkRows` ignores `skip:` — POSIX-only rows return early.
- A fake `claude` echoing `$PATH` in `--version` passes here and fails where PATH holds a version folder (`probeClaudeCapabilities` keeps the FIRST `\d+\.\d+\.\d+`; CI's `/opt/hostedtoolcache/node/22.x.y`): print fixed answers per case and test with that PATH prefix.

## Rows must survive later plans (run-2…run-7 frozen against P0 v1)
- Never import by name what a later plan deletes (P6 drops `metricsLoopCanSync`/`policyLoopCanSync`): namespace imports.
- "Still GIT_MISSING after P6" needs a non-GitHub host (`https://gitlab.com/…`) and a plugin in the lock (`writePluginsLock`).
- A new `!gitAvailable()` refusal goes INSIDE the git-only branch, never at a function's top (P1a runs Folder projects through the same paths: guard `fireTicket`'s `sourceFromPrevious` block, not `ticket.after`).
- No client-side `!gitOn()` refusal of a U2a action (plugin Install): P6's HTTPS path needs it; let the server decide.

## A project is its own repo's top folder, or in no repo (#693: REFUSE)
Settled user decision (2026-10-14): a folder with no `.git` of its own inside another repository is refused; monorepo sub-folder support was ruled out. The unmerged `worca-cc/fix-693-sub-folder-project-fails-e403029f` (`enclosingRepoOf`, `nestedInRepo`) is not on dev — never build on it.
- One copy: `containingRepoOf(dir)`/`insideRepoMessage(dir, root)` in `projects.mjs` (sync `execFileSync` + `realpathSync.native`); `scanMemberProblems` uses the same helpers.
- Fires in `insertProject` (Add, bulk `skipped`, `worca add` exit 1, clone) BEFORE `projectKey`/`tx()`; `startRunHandler` per target/member (400, after mkdir of a missing dir); `_ensureGitCheckpointFor` for old rows (`markTerminal` error, before any `git init`). Allowed: a submodule or old-run `git init`ed folder, a folder in no repo (harness `git init`s it), a not-yet-existing path. A home that is a repo refuses everything under it. Workspace CREATE checks only `isGitRepo`. The UI needs nothing: `POST /api/projects` maps every throw to 400 `{error}` (`#proj-add-msg`).
- `project-create.mjs` mkdirs/`git init`s BEFORE `insertProject`: mirror every refusal first and in the dry run (`isNoProjectWorkDir`, `getProjectByPath`); after a throw remove only what THIS call made (`if (willInit)`). Kill rows: a folder with git + throwing `addProject` (Use git on and off); a fake `gitInit` making `.git` then `{ok:false}`.
- "Refuse this exact folder" guards check the NORMALIZED path (`resolveProjectDir`: trim + `~`), never raw `body.projectDir`; APFS is case-insensitive and JS `realpathSync` keeps typed case — compare `fs.statSync(v).ino`; probe each spelling with a logging `git` wrapper.
- `canonicalProjectRoot` answers the nearest `.git`, so a sub-dir has its repo's key; `projectKey()` memoizes forever (`_keyCache`): a legacy `git init`ed row changes key after restart (Resume 400 "not onboarded").

## Fixtures
- `git init`'s branch is host-dependent (Xcode's system gitconfig makes `main` on this Mac; CI makes `master`): use `dev`/`parent-only` or `GIT_CONFIG_GLOBAL`; read with `git rev-parse --abbrev-ref HEAD`.
- Plain-folder fixtures use `mkdtemp(tmpdir())`, never under the checkout (now refused); expect `insideRepoMessage(sub, realpathSync.native(parent))`. `listProjects` orders by `created_at, name`: compare sorted.
- `npm test`'s `WORCA_HOME=.worca-cc-test` sits INSIDE the checkout (subsets use an absolute mkdtemp): anything defaulting under worcaHome (`<worcaHome>/projects`) is inside a repo only in the full run — set an absolute `WORCA_HOME` or `WORCA_PROJECTS_ROOT`. `npm run smoke` uses `<checkout>/sandbox`: valid only if `git -C sandbox rev-parse --show-toplevel` is the sandbox.
- Repro (~15 s): `git archive HEAD` scratch + `node_modules` link + sandbox homes; parent repo `git init -b parent-only` with tracked `sub/app.txt`; `createOrchestrator({projectDir: sub, prompt:'x', auto:true, claude:{mock:true}}).run()` → `{status:'error', error: insideRepoMessage(...)}`, no `sub/.git`.
