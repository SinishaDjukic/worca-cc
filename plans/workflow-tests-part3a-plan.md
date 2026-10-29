# Workflow tests, Part 3a: project workflows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An example can name a git project and a fixed start point. Each try works in Worca's own copy of that project, nothing leaves the try, the changes are checked ("The command passes", text in a named file) and kept, and the Part 2 rule "tests are for workflows without a project" (D20) is gone.

**Architecture:**
- **Worca's copy of a project** lives at `<worcaHome>/workflow-tests/repos/<projectKey>`. It is a `git clone --local --no-checkout` with no remote. `projectKey()` answers the real project's key for the copy and for every worktree of it (D52, the same kind of rule as the no-project work folder). So a try is an ordinary git project run whose project folder is the copy: the run config, the model catalog, the MCP scope and the row's `project_key` are the real project's. The person's repository is only ever read.
- **A start point** is a commit of the person's repository, pinned when the example is saved, plus an optional patch of their uncommitted changes. With a patch, Worca makes one deterministic start commit in the copy (D53). Both live under `refs/worca-tests/<sha>` in the copy.
- **One try:**
  - `tryRunBody` sends `projectDir: <copy>` and `sourceBranch: <start commit>`.
  - `workflowTest.project` carries the key and the setup command.
  - The harness runs "Before each try, run" in the checkout before the first step (`trySetup`, D55) and keeps the checkout after teardown (`keepCheckout`, D43).
  - The runner judges the try in that checkout, then removes the checkout, the try's branch and the run root (D61). `results.json` and `diff-patch.patch`, which the harness already writes, stay.
- **Nothing leaves a try** (every try, both connector modes, D56):
  - the copy has no remote;
  - a PreToolUse hook (`try-guard.mjs`) denies pushes, forge CLIs, remote changes, publishes and web calls that write;
  - stand-ins for `gh`, `glab` and `az` come first on PATH, and the git env has no way to sign in;
  - the push, PR and issue routes refuse a test row (409).
  - Each attempt is written to the try's `connector-calls.ndjson` and shown under "Would have sent".

**Tech Stack:** Node ESM, `node:sqlite`, `node:test` + jsdom, Express (`ui/server.mjs`), vanilla DOM modules (`ui/public/workflows/*.mjs`), git ≥ 2.38 (fetch by SHA from a local path, protocol v2).

**Spec:**
- `.superpowers/sdd/part3-planning-brief.md`: decisions D41–D51 and questions Q1–Q13. The user approved every recommendation and split Part 3 in two. This plan is **3a**; 3b is listed under "Later".
- The canvas boards 32–39 (`P3Editor`, `P3AddCheck`, `P3TestVersion`, `P3Running`, `P3SideBySide`, `P3WouldHaveSent`, `P3PastRun`, `P3Empty` on the evals canvas). Elements marked "Part 3b", "Your criteria" and "A result you liked" are not built.
- Part 2's plan (`plans/workflow-tests-part2-plan.md`): its decisions D18–D40 still hold unless a decision below replaces one.
- Where a board and a decision disagree, the decision wins. The places where this plan leaves a board are in "Copy and design gaps".

---

## Corrections to the brief (verified on `feat/workflow-tests-part3` @ `25d1d5233`)

1. **result.mjs line numbers are off by about 33.** `mainResult` is `result.mjs:61-81` (not :28-48). `readTryOutcome` is :87-101 (not :54-68). The script check is :115-154 (not :82-121).
2. **The teardown that detached runs use is `_teardownRunRoot` (run-harness.mjs:5107-5268).** `:4918-4967` is `_teardownWorktree`, the legacy run-root arm. `keepCheckout` goes into `_teardownRunRoot` step (5) (:5179) and step (9) (:5251). `_mirrorPrimaryBranchTeardown` (:5457) stamps `worktreeRemoved: true` and must be skipped for a kept checkout.
3. **`uncommittedPatch` writes into the person's repository.** Its own doc says so (git-info.mjs:233): "The only trace is the blobs `add` hashes into the object store". D42's "no objects written" needs a new `scratchObjects` option: a temporary `GIT_OBJECT_DIRECTORY` that reads through `GIT_ALTERNATE_OBJECT_DIRECTORIES` (Task 3).
4. **A harness option cannot carry the real key on its own.** The harness already accepts `opts.projectKey` on a git run (run-harness.mjs:812, :1127). But it reads `projectKey(this.projectDir)` directly at :3111, :6531, :6567 and :7474. The server also reads by folder: `readRunConfig(projectDir)` (server.mjs:3176), `listModels(projectDir)` (:3159), `knownMcpOptOut` (:3204) and `runSetupOf`, and config.mjs keys everything by `projectKey(projectDir)`. So the key rule goes into `projectKey()` itself (D52).
5. **Two more paths would act on the person's repository under the real key.**
   - `runProjectDir` (store.mjs:103), used by stop-paused.mjs:42 and server.mjs:3625 and :5745. A paused try is stopped through `stopRun` → `stopPausedPipeline` (server.mjs:4720). That builds a harness on `projectDirForKey(row.project_key)`, the real folder, and its teardown would run `git worktree prune` and branch deletes there.
   - `ensureMeta` (artifacts.mjs:953-979). For a project that never ran, it would record the copy as the project's store path for good.
   - Task 1 fixes both.
6. **`PATH` cannot ride `spawnEnv`.** `PATH` is a reserved model-env key (model-env.mjs:212), and `cleanRunEnv` (engines/spawn.mjs:84-89) drops it. The stand-ins need their own `composeSpawnEnv` input, next to `withNoGitPath` (spawn.mjs:109).
7. **The push and PR routes share one gate.** `resolvePrPipeline` (server.mjs:9010) is used by `/api/pr/remotes` (:9082), `/api/pr` (:9322), PR watch (:9408), `/api/runs/:id/publish` GET and POST (:9522, :9539), `/api/push` (:9588), `/api/pr/describe` (:9827) and `/api/pr/crosslink` (:9908). The only issue route is `/api/pipelines/:id/report-issue` (:18445), which files a Worca bug report. `createRunPr` (:9175) is reached from `/api/pr` and the ship flows (shape :5141, chains :5276, run groups :5395), which a try never joins.
8. **The harness already writes a git run's diff.** `_buildResults()` (run-harness.mjs:6838-6918) persists `results.json` and `diff-patch.patch` against the run's start, before teardown. The runner reads them; it does not diff again.
9. **Two post-teardown steps run on every git run.** `_keepCheckoutByPolicy` (:5378) would re-create a checkout of the try, and `_checkBaseAfterRun` (:5394) fetches. Both skip a try.
10. **A restart leaves a try `interrupted`, and its run root is then kept.** `reconcileStaleRunning` marks the row `interrupted`, and `sweepRunRoots` keeps an interrupted run's root (`RUN_ROOT_KEEP`, worktree.mjs:783). `recoverInterruptedTestRuns` must also move such rows to `stopped` (Task 7).
11. **No workflow is bound to several projects.** The only workspace-bound workflow is the reserved Workspace scan, which has no tests. "Workflows on several projects can't be tested yet" therefore applies to past workspace runs only (board 39's picker rows). The Tests-page state on board 39 is not built.
12. **On Windows, Node's `spawn('gh')` without a shell finds `gh.exe`, not a `.cmd` stand-in.** So the stand-ins alone do not stop a script that spawns a forge CLI directly. The guard env also points `GH_CONFIG_DIR`, `GLAB_CONFIG_DIR` and `AZURE_CONFIG_DIR` at empty folders, so such a CLI has no sign-in (D56).
13. **Fetching by SHA works on this machine.** git 2.45.1 fetches an unadvertised commit by SHA from a local path (protocol v2, checked in a scratch repo on 2026-10-28). D42's `git fetch <projectDir> <sha>` stands.
14. **Smaller references:**
    - The run page's ⋯ gate is `wftRunMenuItems` (app.js:3824-3832, `canUseAsExample(… noProject …)` at :3827). app.js:3811 is `wftAddFromRun`'s refusal toast.
    - `ghCreatePr` is git-info.mjs:383-411.
    - The script step's test env is script-runner.mjs:185-189 (the brief's :183-186); `stripHostCredentials` there is :201.
    - The single-project branch's `projectKey` line is server.mjs:3225 (the brief's :3226).
15. **The capability probe now asks the `claude` the run spawns (`8a81e8063`).** This is not byte-identical for people who set `WORCA_CLAUDE_BIN` / `ORCH_CLAUDE_BIN`: on every run, not only tries, run.json's capabilities and the `--mcp-config` / `--plugin-dir` decisions now describe that binary instead of a bare `claude` on PATH. That is the correct behaviour, and nothing changes when neither variable is set.

## Copy and design gaps (decided here)

| # | Where | What this plan builds |
|---|---|---|
| P1 | Board 32 leaves out "Name of the example" and "Files" | Both stay as Part 2 built them (G5). The "Where it starts" group comes after Files. |
| P2 | Board 32's start point "Change" opens nothing drawn | A small dialog titled "Start point": "Pick the branch this example starts from. Worca takes its newest commit." It shows radio rows "main · abc1234 · 28 Oct", and the confirm button "Use this start point". |
| P3 | Board 32's "Include my changes that are not committed yet" | It is shown only when the start branch is the branch the project folder has checked out. The server refuses it otherwise ("uncommitted changes can be kept only for the branch your project folder is on"). |
| P4 | Board 39's "Pick the folder" | The button moves the focus to the Project select. Picking a project whose repository has the start commit keeps the start point ("The start point is kept"). |
| P5 | Board 35's "Working" sub-line "The workflow fixes the bug" | "The workflow does its work". The board's words belong to that one example. |
| P6 | Board 36's line "Failed: `<file>` · "<test name>"" | Not built: Worca does not parse test output. "See the command output" opens the output's last 40 lines. |
| P7 | Board 37's compact change lists with "See the changes" | Not built. One page shows board 36's change cards, and each column's "Would have sent" card (board 37) follows its change card. |
| P8 | Board 34's reuse sentence ("two examples moved to a newer start point") | Part 2's C6 sentence stays: an example moved to a new start point is an edited example. |
| P9 | Board 37's "… on GitHub" in the push text | Named only when the real project's remote of that name is on a forge Worca knows (`forgeOf`). Otherwise the words are left out. |
| P10 | Board 33's confirm label | "Add check" for a new check and "Save check" when editing one. Part 2 used "Save check" for both. |
| P11 | A start commit the project no longer has (not drawn) | "The start point of this example is no longer in the project. Pick a new start point." |
| P12 | A past project run with no recorded start (not drawn) | "Worca did not record where this run started." |
| P13 | Board 34's lock line and Part 2's shield line ("Tests never touch real work through your connectors.") | When a chosen example has a project, the lock line shows in both modes and the shield line is hidden. Real's hint gains " Pushes, pull requests and issues stay blocked." |
| P14 | Board 34's "Examples" option "All 5 · on worca-cc" | Used when every ready example is on one project; otherwise Part 2's "All N". |
| P15 | Board 35's "Disk in use" fact and phase card | Shown only for a test with a project example. |
| P16 | Part 2's "without a project" sentences (tests-view.mjs:168, test-dialogs.mjs:25) | "Worca found no runs of <workflow> yet. …" (board 39's wording). For a workflow that needs a project, the board 39 sentence: "Run the workflow once on a project, or write an example yourself." |
| P17 | Board 33's "Read from" radios | Only for an example with a project. The text checks of an example without one read the final result, as in Part 2. |
| P18 | Small states no board draws | "This try changed no file.", "Reading the changes…", "No changes to show for this file.", "A binary file." (the change card); "Pick a branch first.", "Worca could not read the branches of the project.", "The start point did not move." (the editor). |

## Decisions

D41–D51 are the brief's (approved). These continue them. The `(technical)` rows are for the reviewer.

| # | Decision |
|---|---|
| D52 | *(technical)* **The copy is the project.** `projectKey(dir)` returns `<key>` when `dir`'s canonical root is `<worcaHome>/workflow-tests/repos/<key>`; this covers the copy and every worktree of it. It is one rule in store.mjs, like `isNoProjectWorkDir` → `NO_PROJECT_KEY`. It survives a restart and needs no harness option. `runProjectDir` of a test row with a project key is the copy. `ensureMeta` never records the copy as a project's path. |
| D53 | *(technical)* **Start commit.** Without a patch it is the person's commit. With one, it is a commit in the copy:<br>• parent: the start commit; tree: the start tree plus the patch;<br>• author and committer `Worca <worca@localhost>`, both dates the start commit's own committer date, `--no-gpg-sign`;<br>• so it is the same SHA every time it is made.<br>Both are pinned as `refs/worca-tests/<sha>` in the copy. The patch is taken with a temporary index **and** a temporary object folder, so nothing is written to the person's repository. Changes are at most 5 MB. |
| D54 | *(technical)* **The copy.** It is made with `git clone --local --no-checkout --no-tags`, then `remote remove origin`, `core.longpaths true`, `gc.auto 0` and `maintenance.auto false`. A start tree with a `.gitmodules` file, or a `.gitattributes` with `filter=lfs`, is refused with board 39's sentences. |
| D55 | **Setup ("Before each try, run").**<br>• It is filled in from the project's setup (`readProjectActions(key).setup`). It runs through the OS shell in the checkout, with the try's guard env, for at most 30 minutes.<br>• Its untracked output folders (`ls-files --others --exclude-standard --directory`) are left out of the try's commit and diff. A setup that edits tracked files shows those edits as changes (accepted: use `npm ci`, not `npm install`).<br>• On failure, the try's run ends as an error, "The setup step failed: `<cmd>` ended with an error.". The runner stops the test (`setup`), the try is `stopped` (not failed), and "Try again" is "Finish the rest". |
| D56 | **Nothing leaves a try** (every try, with or without a project, Pretend or Real).<br>• The hook (on Bash and on the CLI's PowerShell tool) denies `git push`, `git remote add`/`set-url`, `git send-email`, `gh`, `glab`, `az`, publishes (`npm`/`yarn`/`pnpm`/`bun`, `cargo`, `twine`, `gem`, `poetry`, `uv`, `dotnet nuget`, …; `--dry-run` passes), image pushes (`docker`/`podman`/`nerdctl push`, `image`/`manifest`/`compose push`, `build --push`, `buildah push`, `skopeo copy` to `docker://`, `crane push`/`copy`, `helm push`), and web calls that write (`curl`/`wget` with a writing method or data, `Invoke-WebRequest`/`Invoke-RestMethod`, httpie/xh, .NET uploads). It reads through wrappers, nested shells (`sh -c`, `bash -c`, `cmd /c` and `//c`, `powershell -Command`), WSL (`wsl`, `wslg`, distro launchers, System32 `bash.exe`), pipes and here-strings into a shell (escape-encoded `printf` / `echo -e` decoded, and denied even when nothing is found), a `$( )` / backtick that only writes a literal, read where it lands (the command word, `eval`, `sh -c`, a here-string), `xargs -I` replacement and `xargs sh -c`, `$'…'` and names set earlier in the line; what it cannot read and carries a guarded word is denied, and so is anything nested deeper than 6.<br>• The hook answers with a structured deny (`permissionDecision: "deny"`, exit 0) only when the harness probed a Claude Code at or above `TRY_GUARD_MIN_CLAUDE` (2.1.304); otherwise, and whenever that answer cannot be written, stderr + exit 2.<br>• The stand-ins refuse every `gh`, `glab` and `az` call.<br>• The git env sets `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never` and `GIT_SSH_COMMAND='exit 1 #'`, resets `credential.helper` (an appended `GIT_CONFIG_*` pair), and points `GH_CONFIG_DIR`, `GLAB_CONFIG_DIR` and `AZURE_CONFIG_DIR` at empty folders. On Windows `WSLENV` carries all of it into WSL (its own git and gh).<br>• The try env drops these tokens in any spelling and never names them in `WSLENV`: forge / CI (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_PAT`, `GITHUB_PAT`, `GITLAB_TOKEN`, `GLAB_TOKEN`, `GL_TOKEN`, `CI_JOB_TOKEN`, `GITEA_TOKEN`, `BITBUCKET_TOKEN`, `BITBUCKET_APP_PASSWORD`, `AZURE_DEVOPS_EXT_PAT`, `SYSTEM_ACCESSTOKEN`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_RUNTIME_TOKEN`); publish-only (`CARGO_REGISTRY_TOKEN`, `TWINE_PASSWORD`, `TWINE_USERNAME`, `UV_PUBLISH_TOKEN`, `UV_PUBLISH_PASSWORD`, `GEM_HOST_API_KEY`, `HELM_REGISTRY_PASSWORD`, `DOCKER_AUTH_CONFIG`, `POETRY_PYPI_TOKEN_*`); install-side (`NPM_TOKEN`, `NODE_AUTH_TOKEN`, `YARN_NPM_AUTH_TOKEN`, `YARN_NPM_AUTH_IDENT`, `npm_config_*_auth*` / `*_password` / `*username`, `CARGO_REGISTRIES_*_TOKEN`, `POETRY_HTTP_BASIC_*_PASSWORD`). The setup step ("Before each try, run", e.g. `npm ci`) alone keeps the install-side ones (`.npmrc` auth is untouched anyway), never a forge, CI or publish-only one: setup is trusted, it is the person's own command and runs before the agent changed anything (a setup command that itself publishes is the person's own choice). The agents and the checks (the command check, Library scripts) get the full strip, because by then the agent may have changed project scripts.<br>• `TRY_DENY` joins the permission deny list, for Bash and the same rules for PowerShell, unless Task 9's free proof shows that a deny rule pre-empts the hook (then the overlapping rules are dropped, see Task 9).<br>• Other engines get the env layers but not the hook (accepted).<br>• **Stated limits** (no network block yet): a hand-made web call with a typed token; `npm publish` run from inside a script (`npm run …`, `make`, a test); web calls from `node -e`, `python -c` or any program; a shell alias, `Set-Alias` or git alias set in an earlier, separate command; tokens a WSL profile sets (`GH_TOKEN` in `~/.bashrc`, `/etc/environment`); tokens in files (`~/.npmrc`, `~/.docker/config.json`, gh / glab config inside WSL); git `http.extraheader` / `url.insteadOf` tokens; image pushes beyond those above (e.g. `oras`, `ko`, `jib`, `kaniko`, or an image tool run through a package runner: `pnpm dlx <image tool> push`); credential env vars other than those listed above; `curl -K` config files; a PowerShell `-Method` given as a variable; `Send-MailMessage` and .NET web calls other than `Upload*` / `*Async`. |
| D57 | **The command check.**<br>• Kind `command`: `{ cmd, timeoutMin }`, the command on one line of at most 500 characters, `timeoutMin` 1, 5, 10 or 30 (default 10). Only on an example with a project.<br>• It runs in the checkout after the pure checks, with the guard env. Met = exit 0 within the time limit. Its value is the last summary line, and the last 40 lines of output are kept for "See the command output".<br>• It is not run when the try did not finish. |
| D58 | **Text checks can read a file.** Words, sections, mentions and not-mentions take an optional `file`: on a project example it is read from the checkout, without one from the try's `work/`. The label ends with " in <file>". |
| D59 | **The file check on a project example** matches an added, changed or renamed path, never a removed one. Its option reads "A file with this name is added or changed" (board 33). |
| D60 | **Disk.**<br>• One try needs the example's last measured checkout size (the checkout is walked once after its checks, without following junctions). Until one is measured: `git ls-tree -r -l` bytes of the start tree plus the patch.<br>• A test needs the sum of its 3 largest per-try sizes, since 3 tries run at once. It is refused when free space is below 1.2 × that need (`NO_DISK`, 422), with board 34's and board 39's sentences.<br>• While a test runs, "Disk in use" is the free space at the start minus the free space now (`statfs`). |
| D61 | **Cleanup.**<br>• After its checks, and on every other way a try ends (stopped, error, refused, a setup failure), the runner removes:<br>&nbsp;&nbsp;– the checkout: `rm` with retries, never following a junction, then `git worktree prune` in the copy (git's own `worktree remove` is not proved junction-safe, Task 3 review);<br>&nbsp;&nbsp;– the try's branch in the copy;<br>&nbsp;&nbsp;– the run root.<br>• At boot, a test row left `paused` or `interrupted` becomes `stopped`, so `sweepRunRoots` reclaims its root. `sweepTestCopies` then prunes worktrees and deletes leftover try branches in every copy. |
| D62 | **Each example is checked, not the workflow (replaces D20).**<br>• A workflow that needs a project is testable. Its examples without a project show "Pick a project first", are left out of "All", and a pick that names one is refused ("<name> is left out: pick its project first.", 422).<br>• A project example whose folder is missing, which is a Folder project, uses LFS or submodules, or is no longer registered, shows its board 39 card and is left out the same way. |
| D63 | **Drift.** "Behind" = `git rev-list --count <start>..refs/heads/<ref>` in the person's repository (read only). "Start from the latest" pins the branch's newest commit now, and takes the uncommitted changes again when the example keeps them. |
| D64 | *(technical)* **Reuse.** A project example's fingerprint adds `p: [key, startCommit, setupCmd]`. Examples without a project keep their Part 2 fingerprint byte for byte. The start commit already covers the patch. |
| D65 | **A past project run** (D50) is a finished, single-project git run with a recorded start (`branch.baseSha`, else `diffBase`). Its example starts from that commit, on the ref `branch.source`, with no changes. Folder and workspace runs are listed disabled with board 39's sentences. |
| D66 | **UI level Simple, flag `workflowTests`** (as Part 2). The copy is boards 32–39's; parts of a board marked "Part 3b", "Your criteria" or "A result you liked" are not built. |
| D67 | *(technical)* **What changed.** A try stores its change list on its row: the first 50 files and the totals. The full diff stays in its pipeline (`diff-patch.patch`) and is read per try (`GET …/tries/:try/changes`). |
| D68 | **Would have sent** lists the guard's attempts in both modes; a pretend try also lists its connector calls. A project try adds "The changes stayed in Worca's own copy of the project: nothing was pushed.". |
| D69 | *(technical)* **Accepted for 3a.** Claude Code's own `.mcp.json` approvals are per folder, so a Real project try loads a project's committed `.mcp.json` servers only through Worca's registry. A Pretend try loads only stand-ins (Part 2), so nothing changes there. |

## Global Constraints

- **Worktree and branch:** `C:\Users\BRT1BG\worca-cc\worca-cc-tests3`, branch `feat/workflow-tests-part3`, stacked on `feat/workflow-tests-part2` (25d1d5233). Its PR targets `dev` after Part 2 merges. Until then, merge `feat/workflow-tests-part2` in when it moves.
- **Commits:** one per task. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Author email is `tomica.brkovic@yahoo.com` (checked in Task 0).
- **Upstream:**
  - Target `dev`.
  - Merge commits only. Merge `dev` in, never rebase or force-push.
  - State `npm test` and a smoke run in the PR.
  - Name the UI level and update `docs/ui-levels.md`.
- **Never push or open a PR without the user's explicit go.**
- **Run one test file:** `node tools/test.mjs test/<file>.test.mjs` (hermetic home + no-real-claude guard). About 170 failures already exist on clean `dev` on this laptop, so compare against the Task 0 baseline before blaming the branch.
- **Test facts found in Task 1** (the plan's test code gets these wrong in places; correct it in your task, do not change product code for it):
  - `worcaHome()` is `<WORCA_HOME>/.worca-cc`, not `WORCA_HOME` itself. Paths such as `runs/<pid>` and `workflow-tests/repos/<key>` sit under `join(WORCA_HOME, '.worca-cc')`.
  - `invokeStartRun` and `POST /api/run` answer only `{ runId }`. The pipeline id comes from the run entry (`runs.get(runId).pipelineId`) once it is known, e.g. after the run settles.
  - `setHumanInLoop(false)` does not change a saved workflow: the mock `wf_default` run still parks at its clarify gate. A test that waits for a run to settle answers its pending questions with `server._testing.answerRun`, as `test/api-run-no-project.test.mjs` and `test/workflow-test-project-key.test.mjs` do.
- **The person's repository is only read.** In 3a code, the only git commands on a registered project's folder are:
  - `clone` and `fetch` (as the source);
  - `rev-parse`, `rev-list`, `ls-tree`, `cat-file`, `show`, `grep <tree>`, `symbolic-ref`, `for-each-ref`, `remote get-url`;
  - `uncommittedPatch(…, { scratchObjects: true })`.
  `test/helpers/repo-snapshot.mjs` (Task 1) is the test for it, and Tasks 3, 4 and 7 reuse it.
- **style.css:**
  - Tokens only, never a hex colour.
  - Status colours: green = done, red = failed, blue = information, amber only "needs you" (the moved-on note and the not-enough-disk refusal are: boards 34 and 39 draw the refusal amber, not red). Grey `--seq` = some passed. Peach = running, as `.pill-run.peach` already is.
  - New CSS goes in the workflows section, right after Part 2's last `.wft-*` rule (style.css:8872, before `.wfv-bar .btn`), never after a `/* ── marketplace … ── */` marker.
  - Every CSS block is closed (the brace-balance test).
- **UI follows `docs/design-system.md`**, which `test/ui-design-language.test.mjs` and `test/ui-shared-controls.test.mjs` enforce:
  - Type steps only: `font-size` is `var(--fs-caption)` 11, `var(--fs-meta)` 12, `var(--fs-body)` 13, `var(--fs-section)` 15, `var(--fs-subpage)` 18 or `var(--fs-stat)` 22. No other px size.
  - Radius tokens only: `var(--r-xs)` for chips, pills and bars, `var(--r-sm)` for boxes and icon tiles, `var(--r-card)` for a card. `50%` only on a selector whose name says it is round (`…-dot`, `radio`, …: the test's `ROUND`). Never `999px`, never `--r-pill`.
  - Icons, not glyphs: `icon(doc, 'more' | 'x' | …)` from `ui/public/icons.mjs` inside a button with an `aria-label`. No string that is only `⋯`, `×`, `✓`, `▾`.
  - On/off is a switch (`makeSwitch`, `ui/public/switch.mjs`). A checkbox only picks items or opts in next to a field, and then its emitting statement carries a token listed in `JS_CHECKBOX_OK` (test/ui-shared-controls.test.mjs) with the reason; the task that adds the checkbox adds the row.
- **UI tasks start only on approved screens.** Tasks 10–13 each name their boards (32–39).
  - Before a UI task starts, the controller confirms the user approved those boards, and re-reads the board files (`…\scratchpad\evals-canvas3\project\P3*.dc.html`).
  - If a board's copy changed since this plan, apply it to the task's text first. The strings quoted in Tasks 10–13 are the boards' text on 2026-10-28.
- **Every UI task runs the design guards** after its own tests: `node tools/test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`, then the style.css slicing tests (below). On this branch `ui-design-language` has four failures that are not Part 3a's (the guide, the charts, a typed "+" and the member rows); any other failure is the task's.
- **Route errors:** `{ error }` with 400 / 404 / 409 / 422 / 500 (`NOT_READY` and `NO_DISK` are 422). Every route is behind `requireFlag('workflowTests')`. The UI is behind `data-flag="workflowTests"`.
- **Hidden tries (D21, D22) hold for project tries too:**
  - the entry carries `isTest: true`, and `pipelines.is_test = 1`;
  - no memory, no frames, no hello row, no chat notifier, no scheduled resume and no run tags;
  - never in Runs, History or Statistics; their cost counts in the spending limit.
- **No new identifier may be called `version`** (D7). Use `versionNo`, `use`, `useRef`.
- **UI text:** `textContent` only (no innerHTML with data). Use the shared dialog `createDialog({doc, win, width})` (ui/public/marketplace/layers.mjs) through `testDialog`, `notify` and `confirmModal`.
- **Test files must not read `plans/`.** Pin copy literals in the tests.
- **Paid model calls: none in tests** (mock engine only; `WORCA_MOCK=1` for API tests). The one paid proof (Task 9, Step 7) is run by the controller only. It runs on Haiku through the user's own Claude sign-in, never the `~/.worca-cc` Vertex routing, with a $2 cap.
- **Windows:**
  - Hook and stand-in commands use forward slashes (host-guard.mjs:38-47).
  - Write `PATH` to the env's own key (`Path` on Windows) and remove any other spelling of it.
  - Every stand-in has a `.cmd` twin.
  - Removals use `rm(…, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })` and never follow a junction (proved in Task 3).
  - Each copy sets `core.longpaths true`.
  - A test that needs a POSIX shell skips on win32 with a named reason. A Windows-only behaviour gets a win32 test.
- **Schema:** `SCHEMA_VERSION` becomes **81**. Part 1 is v79 (feat/workflow-tests, already) and Part 2 is v80 once it merges Part 1 and renumbers.
  - Task 2 starts by checking `SCHEMA_VERSION`. It must be 80. If it reads 78 (Part 2 not renumbered yet), merge the renumbered `feat/workflow-tests-part2` first. If that is not available yet, stop Task 2 and tell the controller. Do not write a v79 or v80 of your own.
  - If `dev` takes a number first, renumber. A renumber touches: `SCHEMA_VERSION`, the `WORKFLOW_TEST_PROJECTS_DDL` comment, the ladder line `if (current < 81)`, the `INCREMENTAL_COLUMNS` comment on `wf_test_tries`, the test file name `test/db-migrate-v81.test.mjs` and its `>= 81` and `user_version = 80` lines, and `docs/storage.md`'s "(v81)" heading.
  - Then run `node tools/test.mjs test/db-migrate-v78.test.mjs test/db-migrate-v81.test.mjs test/db.test.mjs` plus every other `test/db-migrate-v7*.test.mjs` and `v8*` file by name (tools/test.mjs does not expand a `*`, and PowerShell passes it as is).
- **The style.css slicing tests** (they cut the file at its `/* … */` markers; run them in every UI task and after every merge of `dev`): `node tools/test.mjs test/marketplace-add-dialog.test.mjs test/marketplace-install-view.test.mjs test/marketplace-installed-view.test.mjs test/marketplace-marketplaces-view.test.mjs test/marketplace-sheets-css.test.mjs test/ui-artifact-browser.test.mjs test/ui-artifact-viewer.test.mjs test/ui-chat-action-cards.test.mjs test/ui-chat-direction.test.mjs test/ui-chat-panel-view.test.mjs test/ui-chat-run-card.test.mjs test/ui-chat-scope-style.test.mjs test/ui-chat-style.test.mjs test/ui-folder-changes.test.mjs test/ui-shared-controls.test.mjs test/ui-skills-view.test.mjs`. To refresh the list in PowerShell: `Select-String -Path test\*.test.mjs -SimpleMatch "indexOf('/*" -List | ForEach-Object { $_.Path }`.

## Review Focus

1. **The person's repository is only read** (Tasks 1, 3, 4, 7). Expect: `repoSnapshot(real)` (refs, worktrees, status, stash, every file under `.git` except `index`) is identical before and after: making the copy, pinning (with uncommitted changes), a whole project try, stopping a paused try, and the boot sweep.
2. **The copy keeps the real key** (Task 1). Expect `projectKey(copy) === projectKey(worktree of copy) === key`, `readRunConfig(copy)` reads the real project's row, `pipelines.project_key === key`, and the checkout is under `<home>/runs/<pid>/repos/<key>`.
3. **A push, `gh pr create` and an issue are refused or recorded** (Task 5, Task 9).
   - The hook denies `git push origin x` and writes `{server:'git', tool:'push', guard:true}`.
   - `gh pr create` through the stand-in exits 1, prints "Not sent: this is a test." and is recorded.
   - `POST /api/pr`, `/api/runs/:id/publish`, `/api/push` and `/api/pipelines/:id/report-issue` answer 409 for a test row.
   - The real CLI, driven by a fake model, has its `git push` denied and recorded (Task 9, free). A real Haiku agent's push is denied too (Task 9, paid, controller only).
4. **Normal runs are byte-identical** (Tasks 4, 5).
   - `buildClaudeArgs`/`buildSettingsPayload` without `tryGuard` equal their current output, and `composeSpawnEnv` without it returns the same env.
   - `runOpts` has no `tryGuard` key, and the script env has no guard variables.
   - A normal mock git run still removes its checkout and run root.
   - `_excludePathspecs` with no setup paths is unchanged.
5. **Setup failure stops the test, and no try counts as failed** (Tasks 4, 7). Expect the run ends `error` with `try-setup.json` `ok:false`, the test is `stopped` with `stopReason:'setup'`, and the try is `stopped` with no verdict.
6. **The checkout is removed after its checks and on every other end** (Tasks 3, 7). Expect no worktree in `git -C <copy> worktree list`, no `worca-cc/*` branch and no `<home>/runs/<pid>` after a done try, a stopped test, a refused start and a restart (boot sweep). A junction inside the checkout is not followed.
7. **Disk** (Tasks 3, 7, 8). Expect a start with free < 1.2 × need answers 422 `NO_DISK` with the board's sentence, and the plan's `disk` gives `needBytes` and `freeBytes`.
8. **Per-example readiness** (Tasks 7, 8). Expect a `needsRepo` workflow's overview to say `testable: true`, an example without a project to say `ready: false, reason: 'pick-project'`, and a start that names it to answer 422 "<name> is left out: pick its project first.".
9. **Reuse only on the same start point** (Task 2, Task 7). Expect a Part 2 example's fingerprint to be unchanged. A project example's fingerprint changes with the key, the start commit (patch included) or the setup command.
10. **Flag off** (Task 8). Expect every new route to answer 404 (`WORKFLOW_TEST_ROUTES` walk).
11. **Design guards** (Tasks 10–13): no new `ui-design-language` failure, and `ui-shared-controls` passes with the new `JS_CHECKBOX_OK` row.

---

## File structure

**New files**

| File | Responsibility |
|---|---|
| `src/shared/workflow-tests/project-text.mjs` | Pure, browser-safe: every 3a sentence and label (start point, drift, disk, refusals, phases, lock line, nothing pushed), `fmtGb`, `changeCountText`. Shared by server and browser so the words never drift. |
| `src/core/workflow-tests/project-copy.mjs` | Worca's copy of a project: clone, pin a start point (with uncommitted changes), make the start commit again, drift, sizes, free disk, branches, removing a try's checkout, the boot sweep. |
| `src/core/workflow-tests/shell-step.mjs` | One command through the OS shell with a time limit and the tail of its output (setup and the command check), and the setup marker file. |
| `src/core/workflow-tests/try-guard.mjs` | The guard's decisions (pure), the PreToolUse hook CLI and the stand-in CLI. Imports only `node:` built-ins (it runs on every Bash call). |
| `src/core/workflow-tests/try-guard-env.mjs` | The guard's env (PATH stand-ins, git env, empty forge config folders), the hook entry, `TRY_DENY`, `tryShellEnv`. |
| `src/core/workflow-tests/guard-calls.mjs` | Board 37's rows for the guard's attempts. |
| `test/helpers/repo-snapshot.mjs` | "Only read": everything git keeps for a repository, as one string. |
| `test/workflow-test-project-key.test.mjs` | Task 1 (the prototype). |
| `test/db-migrate-v81.test.mjs`, `test/workflow-test-project-store.test.mjs` | Task 2. |
| `test/workflow-test-project-copy.test.mjs` | Task 3. |
| `test/api-workflow-test-project-try.test.mjs` | Task 4. |
| `test/workflow-test-try-guard.test.mjs`, `test/api-workflow-test-guard-routes.test.mjs` | Task 5. |
| `test/workflow-test-project-checks.test.mjs` | Task 6. |
| `test/workflow-test-project-runner.test.mjs` | Task 7. |
| `test/api-workflow-tests-projects.test.mjs` | Task 8. |
| `test/workflow-test-project-text.test.mjs` | Task 8 (the shared sentences). |
| `.superpowers/sdd/proofs/try-guard-real-cli.mjs` | Task 9's free proof (a script, not a test: it starts the real CLI). |

**Modified files**

| File | Change |
|---|---|
| `src/core/store.mjs` | `testCopiesRoot`, `testCopyDirFor`, `testCopyKeyOf`; the D52 rule in `projectKey` and `runProjectDir`. |
| `src/core/artifacts.mjs` | `ensureMeta` never records the copy. |
| `src/core/db.mjs` | v81: `wf_test_example_projects`, `wf_test_tries` + `start_commit`, `disk_bytes`, `setup`, `changes`. |
| `src/core/git-info.mjs` | `uncommittedPatch(…, { scratchObjects })`. |
| `src/core/workflow-tests/store.mjs` | The example's project, the fingerprint, the try's new columns, disk and setup reads, the boot recovery. |
| `src/shared/workflow-tests/checks.mjs` | `command`, a text check's `file`, labels, `commandSummary`, `PROJECT_FILE_KIND_LABEL`. |
| `src/core/workflow-tests/{try-body,result,runner,service,routes,connectors}.mjs` | Project tries end to end. |
| `src/core/run-harness.mjs` | `keepCheckout`, `trySetup`, `_trySetupPaths`, `_tryGuard()`, the two post-teardown skips. |
| `src/core/orchestrator.mjs`, `src/core/phases.mjs`, `src/core/claude-runner.mjs`, `src/core/engines/claude.mjs`, `src/core/engines/spawn.mjs`, `src/core/graph/script-runner.mjs` | `tryGuard` from the node context to the hook, the deny rules and the spawn env. |
| `ui/server.mjs` | Project tries in `startRunHandler`, the 409s, `connectorsPreview` per project, `bootMaintenance`'s copy sweep, the runner's new deps. |
| `ui/public/workflows/{example-editor,tests-view,test-dialogs,test-progress,test-compare,test-ui}.mjs`, `ui/public/app.js`, `ui/public/style.css` | Boards 32–39. |
| `test/api-workflow-test-try.test.mjs`, `test/workflow-test-isolation.test.mjs`, `test/workflow-test-runner.test.mjs`, `test/workflow-test-routes.test.mjs`, `test/spawn-args.test.mjs`, `test/ui-shared-controls.test.mjs`, the `ui-workflow-*` tests | Updated where Part 2 pinned the D20 rule, plus new rows. |
| `docs/storage.md`, `docs/ui-levels.md`, `docs/feature-flags.md`, `src/shared/flags/registry.mjs`, `docs/changelog/unreleased.md` | Task 14. |

---

## Task 0: Baseline (no commit)

- [ ] **Step 1: Check the worktree**

Run (PowerShell):
```powershell
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 status --short --branch
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 log -1 --format=%H
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 config user.email
Test-Path C:\Users\BRT1BG\worca-cc\worca-cc-tests3\node_modules\jsdom
git --version; node --version
```
Expected:
- `## feat/workflow-tests-part3` and a clean tree;
- `25d1d5233…`;
- `tomica.brkovic@yahoo.com`;
- `True`;
- git ≥ 2.38 and Node ≥ 22.

If the email is not set, run `git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 config user.email tomica.brkovic@yahoo.com`. If `node_modules` is missing, make the junction as Part 2 did: `cmd /c mklink /J C:\Users\BRT1BG\worca-cc\worca-cc-tests3\node_modules C:\Users\BRT1BG\worca-cc\worca-cc-dev\node_modules`.

- [ ] **Step 2: Record the full-suite baseline at 25d1d5233** (about 45–60 minutes; run it in the background)

Run:
```powershell
node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs C:\Users\BRT1BG\worca-cc\worca-cc-tests3 C:\Users\BRT1BG\worca-cc\worca-cc-tests3\.superpowers\sdd\baseline-3a 4 300
```
Expected: a summary with about 170–190 failing tests in a few dozen files. These are the known upstream Windows failures (git timing, `EPERM symlink`, `/` path splits, CRLF scans, CPU-time bounds, headless-Chrome PDF), not Part 3a's.

Write the failing file names, one per line, to `C:\Users\BRT1BG\worca-cc\worca-cc-tests3\.superpowers\sdd\baseline-3a-failing.txt`. Every later full-suite comparison is against this list. A file that fails later and is not on it is checked with `node tools/test.mjs <file>` on 25d1d5233 and on the branch back to back, under the same load.

- [ ] **Step 3: Record a quick baseline of the files this part touches**

Run:
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests3; node tools/test.mjs test/db-migrate-v78.test.mjs test/db.test.mjs test/workflow-test-store.test.mjs test/workflow-test-isolation.test.mjs test/api-workflow-test-try.test.mjs test/workflow-test-connectors.test.mjs test/workflow-test-result.test.mjs test/workflow-test-runner.test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs test/workflow-test-routes.test.mjs test/workflow-test-checks.test.mjs test/spawn-args.test.mjs test/claude-mcpjson-guard.test.mjs test/ui-workflows-markup.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflow-example-editor.test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-progress.test.mjs test/ui-workflow-test-compare.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs
```
Expected: all pass, except the four known `ui-design-language` failures and the `spawn-args` tests that skip on Windows ("fake claude shim is a POSIX shell script"). Note any other failure in `baseline-3a-failing.txt` with "(focused)".

---
## Task 1: Prototype: a git run in Worca's copy keeps the real project's key (D42, D52)

The biggest risk first. This task proves that a git run whose project folder is a clone under `<worcaHome>/workflow-tests/repos/<key>`:
- runs under the real key;
- reads the real project's settings;
- never touches the person's repository.

The test it leaves behind stays as a regression test.

**Stop-and-report rule.** If an assertion in Step 1 still fails after Step 4, and the fix would be outside `store.mjs` (`projectKey`, `runProjectDir`) or `artifacts.mjs` (`ensureMeta`), stop. Report to the controller:
- the failing assertion and its output;
- the code path that read or wrote the wrong key or folder (a `console.trace` in `projectKey` is enough).

Tasks 3–13 depend on D52, so do not start them. Task 2 (schema) may go on.

**Files:**
- Modify `src/core/store.mjs`:
  - `testCopiesRoot`, `testCopyDirFor` and `testCopyKeyOf`, after `isNoProjectWorkDir` (:86-99);
  - `projectKey` (:108-120), after `const root = …`;
  - `runProjectDir` (:103-105).
- Modify `src/core/artifacts.mjs`:
  - the store.mjs import;
  - `ensureMeta` (:953-979), after `const canonical = …` (:968).
- Create: `test/helpers/repo-snapshot.mjs`
- Test: `test/workflow-test-project-key.test.mjs`

**Interfaces:**
- Produces:
  - `testCopiesRoot() → string` (`<worcaHome>/workflow-tests/repos`)
  - `testCopyDirFor(key) → string` (throws `testCopyDirFor: not a project key: …` for a key that does not match `PROJECT_KEY_RE`)
  - `testCopyKeyOf(dir) → string|null`: the key when `dir` is exactly a copy folder
  - `projectKey(dir)`: returns the copy's key for the copy and for any worktree of it
  - `runProjectDir(row, lookup)`: returns the copy for a row with `is_test` and a project key (not a workspace)
  - `repoSnapshot(dir) → string` (test helper)

- [ ] **Step 1: Write the snapshot helper and the failing test**

Create `test/helpers/repo-snapshot.mjs`:
```js
// test/helpers/repo-snapshot.mjs — workflow tests 3a ("the person's repository is only read"): everything git keeps for a
// repository, as one string. Compare it before and after: a new ref, worktree entry, object, config line, reflog line or
// working-tree change shows up. The index is left out: git refreshes its stat cache on reads (GIT_OPTIONAL_LOCKS=0 keeps
// this helper from doing it, but other reads may).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', env });

function files(dir, base, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, base, out);
    else out.push(`${relative(base, p).replaceAll('\\', '/')} ${statSync(p).size}`);
  }
  return out;
}

export function repoSnapshot(dir) {
  const gitDir = join(dir, '.git');
  return JSON.stringify({
    refs: git(dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
    worktrees: git(dir, ['worktree', 'list', '--porcelain']),
    status: git(dir, ['status', '--porcelain=v1', '--untracked-files=all']),
    stash: git(dir, ['stash', 'list']),
    files: files(gitDir, gitDir).filter((f) => !/^index /.test(f)).sort(),
  }, null, 1);
}
```

Create `test/workflow-test-project-key.test.mjs`:
```js
// test/workflow-test-project-key.test.mjs — workflow tests 3a, Task 1 (D42, D52): the prototype. A git run in Worca's own
// copy of a project runs under the real project's key, reads the real project's settings, and only reads the person's
// repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

const home = useTempHome(after, 'worca-cc-wftkey-');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const cleanup = [];
let real, key, copy, store, artifacts, config, server;

async function settled(runs, runId, ms = 200000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  process.env.WORCA_MOCK = '1';
  real = templateRepo('wftkey', { branch: 'main', user: true, files: { 'README.md': '# hi\n', 'src/a.mjs': 'export const a = 1;\n' } });
  cleanup.push(real);
  store = await import('../src/core/store.mjs');
  const projects = await import('../src/core/projects.mjs');
  projects.insertProject({ name: 'real-project', path: real });
  key = store.projectKey(real);
  copy = store.testCopyDirFor(key);
  mkdirSync(store.testCopiesRoot(), { recursive: true });
  git(home, 'clone', '-q', '--local', '--no-checkout', '--no-tags', '--', real, copy);
  git(copy, 'remote', 'remove', 'origin');
  config = await import('../src/core/config.mjs');
  await config.setHumanInLoop(real, false);
  artifacts = await import('../src/core/artifacts.mjs');
  server = await import('../ui/server.mjs');
});
after(() => {
  delete process.env.WORCA_MOCK;
  for (const d of cleanup) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the copy and every worktree of it answer the real project key; nothing else does', () => {
  assert.equal(copy, join(home, 'workflow-tests', 'repos', key));
  assert.equal(store.testCopyKeyOf(copy), key);
  assert.equal(store.projectKey(copy), key);
  const wt = join(home, 'wt-probe');
  git(copy, 'worktree', 'add', '-q', '--detach', '--', wt, 'HEAD');
  try { assert.equal(store.projectKey(wt), key, 'a worktree of the copy is the project too'); }
  finally { git(copy, 'worktree', 'remove', '--force', wt); }
  assert.equal(store.testCopyKeyOf(join(copy, 'src')), null, 'only the copy folder itself');
  assert.equal(store.testCopyKeyOf(real), null);
  assert.equal(store.testCopyKeyOf(join(home, 'workflow-tests', 'repos', 'Not A Key')), null);
  assert.throws(() => store.testCopyDirFor('../x'), /not a project key/);
});

test('a run in the copy reads the real project settings', async () => {
  assert.equal((await config.readRunConfig(copy)).humanInLoop, false);
});

test('a test row acts on the copy, a normal row on its project', async () => {
  const lookup = async () => real;
  assert.equal(await store.runProjectDir({ id: 'abcd0001', project_key: key, is_test: 1, target: 'project' }, lookup), copy);
  assert.equal(await store.runProjectDir({ id: 'abcd0002', project_key: key, is_test: null, target: 'project' }, lookup), real);
});

test('a git run in the copy: the real key, a checkout under its run root, and the person\'s repository only read', { timeout: 240000 }, async () => {
  const sha = git(real, 'rev-parse', 'HEAD');
  const was = repoSnapshot(real);
  assert.equal(artifacts.readStoreMeta(key), null, 'the project never ran');
  const out = await server._testing.invokeStartRun({ projectDir: copy, sourceBranch: sha, prompt: 'Add a feature', title: 'Prototype try' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const { runId, pipelineId } = out.body;
  await settled(server.runs, runId);
  const row = artifacts.findPipelineRowById(pipelineId);
  assert.equal(row.project_key, key);
  const br = JSON.parse(row.branch);
  assert.equal(br.baseSha, sha, 'the run started at the pinned commit');
  assert.ok(String(br.worktreeDir).toLowerCase().startsWith(join(home, 'runs', pipelineId, 'repos', key).toLowerCase()), br.worktreeDir);
  assert.ok(br.feature, 'the run made its own branch');
  assert.ok(git(copy, 'rev-parse', '--verify', `refs/heads/${br.feature}`), 'in the copy');
  assert.throws(() => git(real, 'rev-parse', '--verify', '--quiet', `refs/heads/${br.feature}`), 'never in the person\'s repository');
  const meta = artifacts.readStoreMeta(key);
  assert.ok(!meta || meta.path !== copy, 'the copy is never recorded as the project');
  assert.equal(repoSnapshot(real), was, 'nothing in the person\'s repository changed');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-project-key.test.mjs`
Expected: FAIL with `store.testCopyDirFor is not a function`.

- [ ] **Step 3: Add the rule to `src/core/store.mjs`**

After `isNoProjectWorkDir` (ends at :99), add:
```js
/** Workflow tests 3a (D42, D52): Worca's own copies of projects, one per project key. */
export function testCopiesRoot() {
  return join(worcaHome(), 'workflow-tests', 'repos');
}

/** The folder of Worca's own copy of the project `key`. */
export function testCopyDirFor(key) {
  if (!PROJECT_KEY_RE.test(String(key ?? ''))) throw new Error(`testCopyDirFor: not a project key: ${JSON.stringify(key ?? null)}`);
  return join(testCopiesRoot(), key);
}

/**
 * The real project's key when `dir` is exactly Worca's copy of it (<worcaHome>/workflow-tests/repos/<key>), else null.
 * A path test (realpath only as a fallback), like isNoProjectWorkDir. projectKey() applies it to the canonical root, so
 * every worktree of the copy answers the same key (D52).
 */
export function testCopyKeyOf(dir) {
  if (!dir) return null;
  const r = resolve(String(dir));
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);   // NTFS: one folder, any case
  const name = fold(basename(r));
  if (!PROJECT_KEY_RE.test(name)) return null;
  const parent = dirname(r);
  if (fold(basename(parent)) !== 'repos' || fold(basename(dirname(parent))) !== 'workflow-tests') return null;   // cheap first
  let root;
  try { root = testCopiesRoot(); } catch { return null; }                       // node:test without WORCA_HOME
  if (fold(parent) === fold(resolve(root))) return name;
  try { return fold(realpathSync(parent)) === fold(realpathSync(root)) ? name : null; } catch { return null; }
}
```

Change `runProjectDir` to:
```js
/** P3: a pipelines row's project dir — its own work folder for the reserved key (lookup never called), else lookup(key).
 *  Workflow tests 3a (D52): a test try with a project ran in Worca's copy of it, so whatever acts on its row (a stop of a
 *  paused try) acts there, never in the person's folder. */
export async function runProjectDir(row, lookup) {
  if (isNoProjectKey(row?.project_key)) return noProjectWorkDir(row.id);
  if (row?.is_test && row?.target !== 'workspace' && PROJECT_KEY_RE.test(String(row?.project_key ?? ''))) return testCopyDirFor(row.project_key);
  return lookup(row?.project_key);
}
```

In `projectKey`, right after `const root = canonicalProjectRoot(projectDir);`, add:
```js
  // Workflow tests 3a (D52): Worca's own copy of a project, and every worktree of it, is that project.
  const copyKey = testCopyKeyOf(root);
  if (copyKey) {
    if (gitAvailable()) _keyCache.set(cacheKey, copyKey);
    return copyKey;
  }
```

- [ ] **Step 4: Never record the copy as a project (`src/core/artifacts.mjs`)**

Add `testCopyKeyOf` to the `./store.mjs` import. In `ensureMeta`, right after the `const canonical = …` line (:968), add:
```js
  // Workflow tests 3a (D52): Worca's copy of a project is never written as the project's meta. The first write wins
  // (firstSeenAt), so a project that never ran would otherwise keep the copy as its path for good.
  if (!plain && testCopyKeyOf(canonical)) return { key, path: canonical, name: basename(canonical), firstSeenAt: new Date().toISOString() };
```

- [ ] **Step 5: Run the test**

Run: `node tools/test.mjs test/workflow-test-project-key.test.mjs`
Expected: PASS (4 tests). If not, apply the stop-and-report rule above.

- [ ] **Step 6: Run the neighbours**

Find the file names first: `Get-ChildItem C:\Users\BRT1BG\worca-cc\worca-cc-tests3\test\store*.test.mjs, C:\Users\BRT1BG\worca-cc\worca-cc-tests3\test\stop-paused*.test.mjs, C:\Users\BRT1BG\worca-cc\worca-cc-tests3\test\artifacts*.test.mjs | ForEach-Object Name`.

Run: `node tools/test.mjs <those files> test/api-run-no-project.test.mjs test/orchestrator-no-project.test.mjs`
Expected: the same results as the Task 0 baseline.

- [ ] **Step 7: Commit**

```bash
git add src/core/store.mjs src/core/artifacts.mjs test/helpers/repo-snapshot.mjs test/workflow-test-project-key.test.mjs
git commit -m "Workflow tests 3a: Worca's copy of a project keeps the real project's key (prototype)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Schema v81 and the store: an example's project and start point

**Files:**
- Modify `src/core/db.mjs`:
  - `SCHEMA_VERSION` (:66), 80 → 81;
  - a new `WORKFLOW_TEST_PROJECTS_DDL` after `WORKFLOW_TESTS_DDL` (ends :1442);
  - the `INCREMENTAL_COLUMNS` entry `wf_test_tries`;
  - the `INCREMENTAL_TABLES` entry;
  - the ladder line after Part 2's (renumbered) line.
- Modify `src/core/workflow-tests/store.mjs`:
  - `exampleFingerprint` (:86-92);
  - `exampleOf` (:100-111);
  - `normaliseExample` (:44-83): command checks need a project;
  - `createExample` (:115) and `updateExample` (:145): the `project` option;
  - `deleteExample` (:156);
  - `TRY_COLS` / `tryOf` / `TRY_PATCH` / `updateTry` (:260-296);
  - two new reads.
- Test: `test/db-migrate-v81.test.mjs`, `test/workflow-test-project-store.test.mjs`

**Interfaces:**
- Produces:
  - Table `wf_test_example_projects(example_id PK, project_key, start_sha, start_ref, start_at, start_commit, changes BLOB, changes_sha256, setup_cmd, updated_at)`.
  - `wf_test_tries` gains `start_commit TEXT`, `disk_bytes INTEGER`, `setup TEXT` (JSON) and `changes TEXT` (JSON).
  - The example shape gains `project: null | { key, startSha, startRef, startAt, startCommit, changesSha256, changesBytes, setupCmd }`.
  - `createExample(workflowId, input, { by, from, project })` and `updateExample(workflowId, id, input, { project })`.
    - `project` is a **pin**: `{ key, startSha, startRef, startAt, startCommit, changes: Buffer|null, setupCmd }`.
    - On update, `undefined` keeps the stored pin and `null` removes it.
  - `readExampleChanges(exampleId) → Buffer|null`
  - `normaliseExample(input, { hasProject = false })`: a `command` check without a project gives the error `'the command check needs a project: pick one under Where it starts'`.
  - `exampleFingerprint(ex)`: adds `p: [key, startCommit, setupCmd]` only for a project example.
  - The try shape gains `startCommit, diskBytes, setup, changes`; `updateTry` takes the same four.
  - `lastDiskBytes(exampleId, startCommit) → number|null`, `avgSetupMs(exampleId, startCommit) → number|null`
  - `PIN_MAX_CHANGES = 5 * 1024 * 1024`, `SETUP_MAX = 4000`

- [ ] **Step 0: Check the schema number**

Run: `Select-String -Path C:\Users\BRT1BG\worca-cc\worca-cc-tests3\src\core\db.mjs -Pattern "export const SCHEMA_VERSION"`
Expected: `= 80;`. If it reads 78, follow the Schema rule in the Global Constraints (merge the renumbered Part 2, or stop and tell the controller).

- [ ] **Step 1: Write the failing migration test.** Create `test/db-migrate-v81.test.mjs`:

```js
// test/db-migrate-v81.test.mjs — workflow tests, Part 3a (plans/workflow-tests-part3a-plan.md Task 2): an example's project
// and start point, and what a project try records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const PROJECTS = ['example_id', 'project_key', 'start_sha', 'start_ref', 'start_at', 'start_commit', 'changes', 'changes_sha256',
  'setup_cmd', 'updated_at'];
const TRY_NEW = ['start_commit', 'disk_bytes', 'setup', 'changes'];

test('fresh DB: the example projects table and the try columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 81);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test('a DB stamped 80 without them gets them and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE wf_test_example_projects;
    ${TRY_NEW.map((c) => `ALTER TABLE wf_test_tries DROP COLUMN ${c};`).join('\n')}
    PRAGMA user_version = 80`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test('a DB from before the tests tables (stamped 77) gets the try columns too', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_example_projects; DROP TABLE wf_test_tries; PRAGMA user_version = 77');
  migrate(db);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});
```

- [ ] **Step 2: Write the failing store test.** Create `test/workflow-test-project-store.test.mjs`:

```js
// test/workflow-test-project-store.test.mjs — workflow tests 3a, Task 2 (D41, D53, D64): an example's project, its pinned
// start, the fingerprint, and what a try records.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { canon } from '../src/shared/graph/diff-graphs.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftps-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const pin = (over = {}) => ({ key: 'worca-cc-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z',
  startCommit: SHA, changes: null, setupCmd: 'npm ci', ...over });

test('a Part 2 example keeps its fingerprint byte for byte (D64)', () => {
  const ex = store.createExample('wf_p', { name: 'Brief', request: 'Write it.', checks: [{ kind: 'mentions', text: 'x' }] });
  const old = createHash('sha256').update(canon({ r: ex.request, f: [], a: ex.answers, o: ex.otherwise, b: ex.basics,
    c: ex.checks.map(({ id: _id, ...c }) => c) })).digest('hex').slice(0, 16);
  assert.equal(ex.fingerprint, old);
  assert.equal(ex.project, null);
});

test('an example with a project: stored, read back, and part of its fingerprint', () => {
  const ex = store.createExample('wf_p', { name: 'Ticket 482', request: 'Fix it.' }, { project: pin() });
  assert.deepEqual(ex.project, { key: 'worca-cc-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z',
    startCommit: SHA, changesSha256: null, changesBytes: 0, setupCmd: 'npm ci' });
  const fp = ex.fingerprint;
  assert.notEqual(store.updateExample('wf_p', ex.id, {}, { project: pin({ setupCmd: 'npm install' }) }).fingerprint, fp, 'the setup counts');
  assert.notEqual(store.updateExample('wf_p', ex.id, {}, { project: pin({ startCommit: SHA2, startSha: SHA2 }) }).fingerprint, fp, 'the start counts');
  assert.equal(store.updateExample('wf_p', ex.id, {}, { project: pin() }).fingerprint, fp, 'the same pin, the same fingerprint');
  assert.equal(store.updateExample('wf_p', ex.id, { note: 'n' }).project.startCommit, SHA, 'undefined keeps the pin');
  assert.equal(store.updateExample('wf_p', ex.id, {}, { project: null }).project, null, 'null removes it');
});

test('uncommitted changes are kept as bytes with their hash, at most 5 MB', () => {
  const changes = Buffer.from('diff --git a/x b/x\n');
  const ex = store.createExample('wf_p', { name: 'With changes', request: 'r' }, { project: pin({ changes, startCommit: SHA2 }) });
  assert.equal(ex.project.changesSha256, createHash('sha256').update(changes).digest('hex'));
  assert.equal(ex.project.changesBytes, changes.length);
  assert.deepEqual(store.readExampleChanges(ex.id), changes);
  assert.throws(() => store.createExample('wf_p', { name: 'Big', request: 'r' },
    { project: pin({ changes: Buffer.alloc(store.PIN_MAX_CHANGES + 1), startCommit: SHA2 }) }), /larger than 5 MB/);
});

test('a pin is checked before it is written', () => {
  const bad = (over, re) => assert.throws(() => store.createExample('wf_p', { name: 'x', request: 'r' }, { project: pin(over) }), re);
  bad({ key: 'Not a key' }, /project/);
  bad({ startSha: 'abc' }, /commit/);
  bad({ startCommit: '-x' }, /commit/);
  bad({ setupCmd: 'a\nb' }, /one line/);
  bad({ setupCmd: 'x'.repeat(store.SETUP_MAX + 1) }, /one line/);
  bad({ startRef: 'bad\u0000ref' }, /branch/);
});

test('the command check needs a project (the kind itself is Task 6's; this refusal comes first)', () => {
  assert.throws(() => store.createExample('wf_p', { name: 'x', request: 'r', checks: [{ kind: 'command', cmd: 'npm test' }] }), /needs a project/);
});

test('deleting an example deletes its project row', () => {
  const ex = store.createExample('wf_p', { name: 'x', request: 'r' }, { project: pin({ changes: Buffer.from('p'), startCommit: SHA2 }) });
  store.deleteExample('wf_p', ex.id);
  assert.equal(store.readExampleChanges(ex.id), null);
});

test('a try records its start, disk, setup and changes; the last disk size and setup time are read back', () => {
  const ex = store.createExample('wf_p', { name: 'x', request: 'r' }, { project: pin() });
  const run = store.createTestRun({ workflowId: 'wf_p', kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: 'wf_p', exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  const changes = { files: [{ status: 'added', path: 'src/x.mjs', added: 3, removed: 0 }], counts: { added: 1, changed: 0, removed: 0 }, added: 3, removed: 0, total: 1 };
  const u = store.updateTry(t.id, { status: 'passed', startCommit: SHA, diskBytes: 1234, setup: { cmd: 'npm ci', ok: true, ms: 90000 }, changes });
  assert.deepEqual([u.startCommit, u.diskBytes, u.setup.ms, u.changes.total], [SHA, 1234, 90000, 1]);
  assert.equal(store.lastDiskBytes(ex.id, SHA), 1234);
  assert.equal(store.avgSetupMs(ex.id, SHA), 90000);
  assert.equal(store.lastDiskBytes(ex.id, SHA2), null);
});
```

The `command` check kind itself is Task 6's: Task 6's test checks that an example with a project keeps one.

- [ ] **Step 3: Run both to verify they fail**

Run: `node tools/test.mjs test/db-migrate-v81.test.mjs test/workflow-test-project-store.test.mjs`
Expected: FAIL. The migration test fails on `SCHEMA_VERSION >= 81`. The store test fails because `ex.project` is `undefined`, not `null`.

- [ ] **Step 4: Schema v81 (`src/core/db.mjs`)**

Set `export const SCHEMA_VERSION = 81;`. After `WORKFLOW_TESTS_DDL`, add:
```js
// v81 (plans/workflow-tests-part3a-plan.md D41, D53): an example's project and pinned start point. FK-free like the v78
// tables. `changes` = the person's uncommitted changes at save time, as a binary patch (NULL = none); `start_commit` = the
// commit tries start from (start_sha itself, or Worca's commit of start_sha + changes in its copy of the project).
const WORKFLOW_TEST_PROJECTS_DDL = `
CREATE TABLE IF NOT EXISTS wf_test_example_projects (
  example_id     INTEGER PRIMARY KEY,
  project_key    TEXT NOT NULL,
  start_sha      TEXT NOT NULL,
  start_ref      TEXT,
  start_at       TEXT NOT NULL,
  start_commit   TEXT NOT NULL,
  changes        BLOB,
  changes_sha256 TEXT,
  setup_cmd      TEXT,
  updated_at     TEXT NOT NULL
);`;
```
In `INCREMENTAL_COLUMNS`, add this entry:
```js
  wf_test_tries:          { start_commit: 'TEXT', disk_bytes: 'INTEGER',   // v81 (workflow tests 3a): a project try's start and checkout size
                            setup: 'TEXT', changes: 'TEXT' },              // v81: its setup run (JSON) and its change list (JSON)
```
In `INCREMENTAL_TABLES`, after `wf_test_run_tries`, add `wf_test_example_projects: WORKFLOW_TEST_PROJECTS_DDL,   // v81 (workflow tests 3a)`. In the ladder, after Part 2's line, add:
```js
    // v81 workflow tests 3a. The repair runs again: wf_test_tries is created at v78, after the hoisted repair, so a DB
    // coming from below 78 gets its v81 columns only from this call (v74's pattern).
    if (current < 81) { db.exec(WORKFLOW_TEST_PROJECTS_DDL); repairSchemaGaps(db, schemaGaps(db)); }
```

- [ ] **Step 5: The store (`src/core/workflow-tests/store.mjs`)**

Add near the other constants:
```js
export const PIN_MAX_CHANGES = 5 * 1024 * 1024;
export const SETUP_MAX = 4000;   // actions/model.mjs MAX_CMD: a project's own setup always fits
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;   // store.mjs PROJECT_KEY_RE, inlined: this module imports no fs code
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
```
In `src/shared/workflow-tests/checks.mjs`, next to `TEXT_KINDS`, add `export const PROJECT_KINDS = Object.freeze(['command']);   // 3a D57: checks that run in the copy of the project (Task 6 adds the kind)`. Import `PROJECT_KINDS` from `../../shared/workflow-tests/checks.mjs` in the store.

Change `normaliseExample`'s signature to `export function normaliseExample(input = {}, { hasProject = false } = {})`. In the checks loop, a `command` check must not be refused as an unknown kind before Task 6. So change the loop to:
```js
    for (const raw of rawChecks) {
      if (raw && PROJECT_KINDS.includes(raw.kind) && !hasProject) {   // 3a D57: it runs in the copy of the project
        errors.push('the command check needs a project: pick one under Where it starts');
        break;
      }
      const { check, error } = normaliseCheck(raw);
      if (error) { errors.push(error); break; }
      checks.push(check.id ? check : { id: `c_${randomBytes(5).toString('hex')}`, ...check });
    }
```
In `exampleFingerprint`, replace the hash with:
```js
  const body = { r: ex.request, f: files, a: ex.answers, o: ex.otherwise, b: ex.basics, c: checks };
  // 3a D64: a project example also depends on where it starts and how it is set up; an example without one keeps its
  // Part 2 fingerprint byte for byte. The start commit already covers the uncommitted changes.
  if (ex.project) body.p = [ex.project.key, ex.project.startCommit, ex.project.setupCmd || null];
  return createHash('sha256').update(canon(body)).digest('hex').slice(0, 16);
```
Add the project reads and the pin check:
```js
const PROJECT_COLS = 'project_key, start_sha, start_ref, start_at, start_commit, changes_sha256, length(changes) AS changes_bytes, setup_cmd';
function projectOf(exampleId) {
  const r = prepare(`SELECT ${PROJECT_COLS} FROM wf_test_example_projects WHERE example_id = ?`).get(Number(exampleId));
  if (!r) return null;
  return { key: r.project_key, startSha: r.start_sha, startRef: r.start_ref ?? null, startAt: r.start_at, startCommit: r.start_commit,
    changesSha256: r.changes_sha256 ?? null, changesBytes: Number(r.changes_bytes || 0), setupCmd: r.setup_cmd ?? null };
}

/** The bytes of an example's uncommitted changes, or null. */
export function readExampleChanges(exampleId) {
  getDb();
  const r = prepare('SELECT changes FROM wf_test_example_projects WHERE example_id = ?').get(Number(exampleId));
  return r && r.changes ? Buffer.from(r.changes) : null;
}

/** A pin as written (service.mjs makes it with project-copy.mjs pinStart): checked, or an error. */
function checkPin(p) {
  if (!p || typeof p !== 'object') throw testError('a project needs a start point', 'BAD_REQUEST');
  if (!PROJECT_KEY_RE.test(String(p.key || ''))) throw testError('pick a project', 'BAD_REQUEST');
  if (!SHA_RE.test(String(p.startSha || '')) || !SHA_RE.test(String(p.startCommit || ''))) throw testError('the start point must be a commit', 'BAD_REQUEST');
  if (p.startRef != null && (typeof p.startRef !== 'string' || !p.startRef || p.startRef.length > 255 || /[\u0000-\u001f\u007f]/.test(p.startRef))) {
    throw testError('the start point names a branch Worca cannot read', 'BAD_REQUEST');
  }
  if (!Number.isFinite(Date.parse(p.startAt))) throw testError('the start point has no date', 'BAD_REQUEST');
  const changes = p.changes == null ? null : Buffer.isBuffer(p.changes) ? p.changes : Buffer.from(p.changes);
  if (changes && changes.length > PIN_MAX_CHANGES) throw testError('your changes that are not committed are larger than 5 MB: commit them first, or leave them out', 'BAD_REQUEST');
  const setup = typeof p.setupCmd === 'string' && p.setupCmd.trim() ? p.setupCmd.trim() : null;
  if (setup && (setup.length > SETUP_MAX || /[\r\n]/.test(setup))) throw testError(`the setup command must fit on one line of up to ${SETUP_MAX} characters`, 'BAD_REQUEST');
  return { ...p, startRef: p.startRef ?? null, changes: changes && changes.length ? changes : null, setupCmd: setup };
}

function writePin(exampleId, p) {
  prepare(`INSERT INTO wf_test_example_projects (example_id, project_key, start_sha, start_ref, start_at, start_commit, changes,
      changes_sha256, setup_cmd, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(example_id) DO UPDATE SET project_key = excluded.project_key, start_sha = excluded.start_sha, start_ref = excluded.start_ref,
      start_at = excluded.start_at, start_commit = excluded.start_commit, changes = excluded.changes, changes_sha256 = excluded.changes_sha256,
      setup_cmd = excluded.setup_cmd, updated_at = excluded.updated_at`)
    .run(Number(exampleId), p.key, p.startSha, p.startRef, p.startAt, p.startCommit, p.changes,
      p.changes ? createHash('sha256').update(p.changes).digest('hex') : null, p.setupCmd, nowIso());
}
```
In `exampleOf`, add `project: projectOf(Number(r.id)),` to the `ex` object, before `files`.

Change `createExample` to:
```js
/** @param {{by?: string|null, from?: object|null, project?: object|null}} [opts] `project` = a pin (checkPin) */
export function createExample(workflowId, input, { by = null, from = null, project = null } = {}) {
  const pinned = project ? checkPin(project) : null;
  const { value, errors } = normaliseExample(input, { hasProject: !!pinned });
  if (!value) throw invalid(errors);
  getDb();
  const at = nowIso();
  const id = tx(() => {
    const info = prepare(`INSERT INTO wf_test_examples (workflow_id, name, request, answers, otherwise, basics, checks, tries, note,
        from_pipeline, from_use, from_verdict, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(workflowId, value.name, value.request, JSON.stringify(value.answers), value.otherwise, JSON.stringify(value.basics),
        JSON.stringify(value.checks), value.tries, value.note, from ? from.pipelineId : null,
        from && from.use != null ? useRef(from.use) : null, from ? from.verdict ?? null : null, by, at, at);
    const newId = Number(info.lastInsertRowid);
    if (pinned) writePin(newId, pinned);
    return newId;
  });
  return readExample(workflowId, id);
}
```
Change `updateExample` to:
```js
/** Fields left out of `input` keep their value. `project`: undefined keeps the pin, null removes it, a pin replaces it. */
export function updateExample(workflowId, id, input = {}, { project } = {}) {
  const was = requireExample(workflowId, id);
  const pinned = project ? checkPin(project) : null;
  const hasProject = project === undefined ? !!was.project : !!pinned;
  const { value, errors } = normaliseExample({ ...was, ...input }, { hasProject });
  if (!value) throw invalid(errors);
  if (project !== undefined) {
    const run = runningTestRun(workflowId);
    if (run && run.exampleIds.includes(was.id)) throw testError('a test is trying this example: stop it first', 'BUSY');
  }
  tx(() => {
    prepare(`UPDATE wf_test_examples SET name = ?, request = ?, answers = ?, otherwise = ?, basics = ?, checks = ?, tries = ?, note = ?,
        updated_at = ? WHERE workflow_id = ? AND id = ?`)
      .run(value.name, value.request, JSON.stringify(value.answers), value.otherwise, JSON.stringify(value.basics),
        JSON.stringify(value.checks), value.tries, value.note, nowIso(), workflowId, was.id);
    if (project === null) prepare('DELETE FROM wf_test_example_projects WHERE example_id = ?').run(was.id);
    else if (pinned) writePin(was.id, pinned);
  });
  return readExample(workflowId, was.id);
}
```
In `deleteExample`'s `tx`, add `prepare('DELETE FROM wf_test_example_projects WHERE example_id = ?').run(ex.id);`.

The tries: append `, t.start_commit, t.disk_bytes, t.setup, t.changes` to `TRY_COLS`. In `tryOf`, add before the `side` spread:
```js
    startCommit: r.start_commit ?? null, diskBytes: r.disk_bytes == null ? null : Number(r.disk_bytes),
    setup: parse(r.setup, null), changes: parse(r.changes, null),
```
Extend `TRY_PATCH` with `startCommit: 'start_commit', diskBytes: 'disk_bytes', setup: 'setup', changes: 'changes'`. In `updateTry`, change the value line to:
```js
    vals.push(['verdict', 'setup', 'changes'].includes(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
```
Add the two reads after `spentOfRun`:
```js
/** D60: the newest measured checkout size of an example on this start, in bytes (null = never measured). */
export function lastDiskBytes(exampleId, startCommit) {
  getDb();
  const r = prepare(`SELECT disk_bytes AS b FROM wf_test_tries WHERE example_id = ? AND start_commit = ? AND disk_bytes IS NOT NULL
      ORDER BY id DESC LIMIT 1`).get(Number(exampleId), String(startCommit || ''));
  return r ? Number(r.b) : null;
}

/** D60: how long this example's setup took, on average over its last 5 good setups on this start (null = never ran). */
export function avgSetupMs(exampleId, startCommit) {
  getDb();
  const r = prepare(`SELECT AVG(m) AS a, COUNT(*) AS n FROM (SELECT json_extract(setup, '$.ms') AS m FROM wf_test_tries
      WHERE example_id = ? AND start_commit = ? AND json_valid(setup) AND json_extract(setup, '$.ok') = 1 ORDER BY id DESC LIMIT 5)`)
    .get(Number(exampleId), String(startCommit || ''));
  return r && Number(r.n) > 0 && r.a != null ? Math.round(Number(r.a)) : null;
}
```
SQLite's `json_extract` returns `1` for a JSON `true`, so `= 1` matches `ok: true`.

- [ ] **Step 6: Run the tests**

Run: `node tools/test.mjs test/db-migrate-v81.test.mjs test/workflow-test-project-store.test.mjs test/db-migrate-v78.test.mjs test/db.test.mjs test/workflow-test-store.test.mjs`
Expected: PASS. Part 2's store test still passes, because `createExample` without `project` behaves as before.

- [ ] **Step 7: Commit**

```bash
git add src/core/db.mjs src/core/workflow-tests/store.mjs src/shared/workflow-tests/checks.mjs test/db-migrate-v81.test.mjs test/workflow-test-project-store.test.mjs
git commit -m "Workflow tests 3a: schema v81, an example's project and start point, what a project try records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Worca's copy of a project: clone, start point, sizes, removal (D42, D53, D54, D60, D61)

**Files:**
- Create: `src/core/workflow-tests/project-copy.mjs`
- Create: `src/shared/workflow-tests/project-text.mjs` (the refusal sentences; Task 8 adds the rest)
- Modify: `src/core/git-info.mjs`, `uncommittedPatch` (:236-293): the `scratchObjects` option. Add `mkdir` to its `node:fs/promises` import if it is not there.
- Test: `test/workflow-test-project-copy.test.mjs`

**Interfaces:**
- Consumes:
  - `testCopiesRoot`, `testCopyDirFor`, `PROJECT_KEY_RE` (store.mjs, Task 1);
  - `testError`, `PIN_MAX_CHANGES` (workflow-tests/store.mjs, Task 2);
  - `rmGuarded(runRoot, { worcaHome, pipelineId })` (run-manifest.mjs:108);
  - `isSafeBranchName` (git-sync.mjs);
  - `uncommittedPatch`.
- Produces (`project-copy.mjs`):
  - `ensureTestCopy(key, { projectDir }) → Promise<{ dir, created }>`
  - `pinStart({ key, name, projectDir, ref = null, sha = null, includeChanges = false }) → Promise<pin>`. A pin is `{ key, startSha, startRef, startAt, startCommit, changes: Buffer|null, setupCmd: null }`, Task 2's shape. It throws `testError(…, 'NOT_READY' | 'BAD_REQUEST')`.
  - `ensureStartCommit({ key, projectDir, project, changes }) → Promise<{ copyDir, startCommit }>`
  - `projectUnsupported({ projectDir, sha }) → Promise<null|'lfs'|'submodules'>`
  - `behindCount({ projectDir, startSha, startRef }) → Promise<number|null>`
  - `treeBytes({ projectDir, sha }) → Promise<number|null>`
  - `freeDiskBytes(dir = worcaHome()) → Promise<number|null>`
  - `dirBytes(dir, { maxEntries }) → Promise<number|null>`
  - `listBranches(projectDir, { max }) → Promise<Array<{ name, sha, at, current }>>`
  - `removeTree(dir, { rmImpl, attempts, waitMs }) → Promise<string|null>` (null = removed; else the error)
  - `removeTryCheckout({ copyDir, worktreeDir, branch, runRoot, pipelineId, rmImpl }) → Promise<{ removed, error }>`
  - `sweepTestCopies({ log }) → Promise<{ copies, branches }>`
  - `withKeyLock(key, fn) → Promise`: one copy is written by one job at a time
- Produces (`project-text.mjs`): `FOLDER_MISSING_TITLE`, `folderMissingText(name, path)`, `FOLDER_PROJECT_TITLE`, `folderProjectText(name)`, `UNSUPPORTED_TITLE`, `lfsText(name)`, `submodulesText(name)`, `START_GONE_TEXT`, `CHANGES_TOO_BIG_TEXT`.
- Produces (`git-info.mjs`): `uncommittedPatch(dir, { base, outFile, scratchObjects = false })`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-project-copy.test.mjs`:

```js
// test/workflow-test-project-copy.test.mjs — workflow tests 3a, Task 3 (D42, D53, D54, D60, D61): Worca's copy of a
// project. The person's repository is only read, the start commit is the same every time, removal never follows a
// junction, and a busy file is retried.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { projectKey } from '../src/core/store.mjs';
import { uncommittedPatch } from '../src/core/git-info.mjs';
import * as copy from '../src/core/workflow-tests/project-copy.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commit = (cwd, msg) => git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', msg);
const dirs = [];
let home, real, key;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'worca-cc-wftcopy-'));
  _resetForTests(); process.env.WORCA_HOME = home;
  real = templateRepo('wftcopy', { branch: 'main', user: true, files: { 'README.md': '# hi\n', 'src/a.mjs': 'export const a = 1;\n' } });
  dirs.push(home, real);
  key = projectKey(real);
});
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('the copy has no remote, long paths on, and making it only reads the project', async () => {
  const was = repoSnapshot(real);
  const a = await copy.ensureTestCopy(key, { projectDir: real });
  assert.equal(a.created, true);
  assert.equal(a.dir, join(home, 'workflow-tests', 'repos', key));
  assert.equal(git(a.dir, 'remote'), '');
  assert.equal(git(a.dir, 'config', 'core.longpaths'), 'true');
  assert.equal((await copy.ensureTestCopy(key, { projectDir: real })).created, false, 'made once');
  assert.equal(repoSnapshot(real), was);
});

test('a start point: HEAD of the branch the folder is on, pinned in the copy', async () => {
  const was = repoSnapshot(real);
  const head = git(real, 'rev-parse', 'HEAD');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  assert.deepEqual([p.startSha, p.startRef, p.startCommit, p.changes], [head, 'main', head, null]);
  assert.ok(Number.isFinite(Date.parse(p.startAt)));
  const dir = join(home, 'workflow-tests', 'repos', key);
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${head}`), head);
  assert.equal(repoSnapshot(real), was);
});

test('uncommitted changes: one start commit on top, the same every time, and nothing written to the project', async () => {
  writeFileSync(join(real, 'src', 'a.mjs'), 'export const a = 2;\n');
  writeFileSync(join(real, 'notes.md'), 'new file\n');
  const was = repoSnapshot(real);
  const head = git(real, 'rev-parse', 'HEAD');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  assert.ok(p.changes && p.changes.length);
  assert.notEqual(p.startCommit, head);
  const dir = join(home, 'workflow-tests', 'repos', key);
  assert.equal(git(dir, 'rev-parse', `${p.startCommit}^`), head, 'its parent is the start commit');
  assert.equal(git(dir, 'show', `${p.startCommit}:src/a.mjs`), 'export const a = 2;');
  assert.equal(git(dir, 'show', `${p.startCommit}:notes.md`), 'new file');
  const again = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  assert.equal(again.startCommit, p.startCommit, 'deterministic (D53)');
  assert.equal(repoSnapshot(real), was, 'scratch objects: the project gets no new object');
});

test('the brief was wrong: without scratch objects, reading the changes writes objects into the project', async () => {
  writeFileSync(join(real, 'brand-new.md'), 'x\n');
  const out = join(home, 'p.patch');
  const before = repoSnapshot(real);
  await uncommittedPatch(real, { base: 'HEAD', outFile: out });
  assert.notEqual(repoSnapshot(real), before, 'blobs were hashed into .git/objects');
  const before2 = repoSnapshot(real);
  await uncommittedPatch(real, { base: 'HEAD', outFile: out, scratchObjects: true });
  assert.equal(repoSnapshot(real), before2);
  assert.match(readFileSync(out, 'utf8'), /brand-new\.md/);
});

test('a copy that is gone is made again, with the same start commit', async () => {
  writeFileSync(join(real, 'src', 'a.mjs'), 'export const a = 3;\n');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  rmSync(join(home, 'workflow-tests'), { recursive: true, force: true });
  const r = await copy.ensureStartCommit({ key, projectDir: real, project: p, changes: p.changes });
  assert.equal(r.startCommit, p.startCommit);
  assert.equal(r.copyDir, join(home, 'workflow-tests', 'repos', key));
});

test('LFS and submodules are refused with the board 39 sentences; changes only on the checked-out branch', async () => {
  writeFileSync(join(real, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n');
  git(real, 'add', '.gitattributes'); commit(real, 'lfs');
  await assert.rejects(copy.pinStart({ key, name: 'design-assets', projectDir: real }),
    { code: 'NOT_READY', message: "design-assets keeps large files with Git LFS. Worca's own copy of the project would not have them, so tries could go wrong." });
  git(real, 'rm', '-q', '.gitattributes'); commit(real, 'no lfs');
  writeFileSync(join(real, '.gitmodules'), '[submodule "x"]\n\tpath = x\n\turl = ../x\n');
  git(real, 'add', '.gitmodules'); commit(real, 'sub');
  await assert.rejects(copy.pinStart({ key, name: 'mobile-app', projectDir: real }),
    { code: 'NOT_READY', message: "mobile-app holds other projects inside it (submodules). Worca's own copy of the project would not have them, so tries could go wrong." });
  git(real, 'rm', '-q', '.gitmodules'); commit(real, 'no sub');
  git(real, 'branch', 'side');
  await assert.rejects(copy.pinStart({ key, name: 'real', projectDir: real, ref: 'side', includeChanges: true }), /only for the branch your project folder is on/);
});

test('behind, tree size and the branch list', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  writeFileSync(join(real, 'README.md'), '# one\n'); commit(real, 'one');
  writeFileSync(join(real, 'README.md'), '# two\n'); commit(real, 'two');
  assert.equal(await copy.behindCount({ projectDir: real, startSha: p.startSha, startRef: 'main' }), 2);
  assert.equal(await copy.behindCount({ projectDir: real, startSha: p.startSha, startRef: 'gone' }), null);
  assert.equal(await copy.treeBytes({ projectDir: real, sha: p.startSha }), '# hi\n'.length + 'export const a = 1;\n'.length);
  git(real, 'branch', 'older', p.startSha);
  const branches = await copy.listBranches(real);
  assert.deepEqual(branches.map((b) => [b.name, b.current]), [['main', true], ['older', false]]);
  assert.ok(Number.isFinite(await copy.freeDiskBytes(home)));
});

test('removing a try checkout: the folder, its branch and its run root go; a junction is never followed', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(home, 'workflow-tests', 'repos', key);
  const runRoot = join(home, 'runs', 'abcd1234');
  const wt = join(runRoot, 'repos', key);
  mkdirSync(join(runRoot, 'repos'), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-abcd1234', '--', wt, p.startCommit);
  const outside = mkdtempSync(join(tmpdir(), 'worca-cc-wftstore-'));   // a pnpm store, say
  dirs.push(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  mkdirSync(join(wt, 'node_modules'));
  symlinkSync(outside, join(wt, 'node_modules', '.pnpm-store'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok((await copy.dirBytes(wt)) < 10_000, 'the size walk does not follow the junction either');
  const r = await copy.removeTryCheckout({ copyDir: dir, worktreeDir: wt, branch: 'worca-cc/try-abcd1234', runRoot, pipelineId: 'abcd1234' });
  assert.deepEqual(r, { removed: true, error: null });
  assert.equal(existsSync(wt), false);
  assert.equal(existsSync(runRoot), false);
  assert.equal(existsSync(join(outside, 'keep.txt')), true, 'never through the junction');
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/try-abcd1234'));
  assert.equal(git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
});

test('a busy file is retried; one that stays busy is reported, not thrown', async () => {
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  assert.equal(await copy.removeTree(join(home, 'x'), { rmImpl: flaky, waitMs: 1 }), null);
  assert.equal(calls, 3);
  const stuck = async () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); };
  assert.match(await copy.removeTree(join(home, 'x'), { rmImpl: stuck, waitMs: 1, attempts: 2 }), /EBUSY/);
});

test('Windows long paths: a checkout with paths over 260 characters is removed', async () => {
  const top = join(home, 'deep');
  const deep = join(top, ...Array.from({ length: 12 }, (_, i) => `node_modules_level_${i}_xxxxxxxxxxxxxxxx`));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, 'index.js'), 'x');
  assert.ok(join(deep, 'index.js').length > 260, 'longer than MAX_PATH');
  assert.ok((await copy.dirBytes(top)) >= 1);
  assert.equal(await copy.removeTree(top), null);
  assert.equal(existsSync(top), false);
});

test('the boot sweep prunes leftover worktrees and deletes leftover try branches', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(home, 'workflow-tests', 'repos', key);
  const wt = join(home, 'runs', 'feed0001', 'repos', key);
  mkdirSync(join(home, 'runs', 'feed0001', 'repos'), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/left-feed0001', '--', wt, p.startCommit);
  rmSync(join(home, 'runs'), { recursive: true, force: true });   // a restart's run-root sweep took the folder
  assert.deepEqual(await copy.sweepTestCopies(), { copies: 1, branches: 1 });
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/left-feed0001'));
});
```

On Windows, `symlinkSync(…, 'junction')` needs no admin rights. On POSIX a `dir` symlink stands in for it. Both are links that `rm` must not follow.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-project-copy.test.mjs`
Expected: FAIL with `Cannot find module '…/project-copy.mjs'`.

- [ ] **Step 3: `uncommittedPatch`'s scratch objects (`src/core/git-info.mjs`)**

Change the signature to `export async function uncommittedPatch(dir, { base = 'HEAD', outFile, scratchObjects = false } = {}) {`. After `const realPath = real.ok ? real.stdout.trim() : '';` and before `env.GIT_INDEX_FILE = …`, add:
```js
    // Workflow tests 3a (D53): the blobs `add -A` hashes go to a scratch object folder that reads through to the
    // repository's own objects, so the person's repository gets no new object at all. Asked before any GIT_* is set.
    if (scratchObjects) {
      const o = await _run('git', ['rev-parse', '--git-path', 'objects'], { cwd: dir, env });
      const objPath = o.ok ? o.stdout.trim() : '';
      if (!objPath) return fail('objects', o);
      env.GIT_OBJECT_DIRECTORY = join(tmp, 'objects');
      await mkdir(env.GIT_OBJECT_DIRECTORY, { recursive: true });
      env.GIT_ALTERNATE_OBJECT_DIRECTORIES = isAbsolute(objPath) ? objPath : join(dir, objPath);
    }
```
Update the JSDoc: "With `scratchObjects`, nothing at all is written to the repository."

- [ ] **Step 4: The refusal sentences.** Create `src/shared/workflow-tests/project-text.mjs`:

```js
// src/shared/workflow-tests/project-text.mjs — workflow tests 3a: the words for examples that work on a project (canvas
// boards 32–39; plans/workflow-tests-part3a-plan.md). Shared by the server (its refusals) and the browser (cards, rows,
// dialogs), so the two never say it differently. Pure and browser-safe.

// Board 39: the example's project cannot be used.
export const FOLDER_MISSING_TITLE = 'The project folder is missing';
export const folderMissingText = (name, path) => `Worca can't find ${name} in ${path}. Move the folder back, or pick where it is now. The start point is kept.`;
export const FOLDER_PROJECT_TITLE = "Folder projects can't be tested yet";
export const folderProjectText = (name) => `${name} is a Folder project. Worca can test examples on Git projects for now. Pick a Git project.`;
export const UNSUPPORTED_TITLE = "This project can't be tested yet";
export const lfsText = (name) => `${name} keeps large files with Git LFS. Worca's own copy of the project would not have them, so tries could go wrong.`;
export const submodulesText = (name) => `${name} holds other projects inside it (submodules). Worca's own copy of the project would not have them, so tries could go wrong.`;
// P11 (not drawn) and the 5 MB limit (D53).
export const START_GONE_TEXT = 'The start point of this example is no longer in the project. Pick a new start point.';
export const CHANGES_TOO_BIG_TEXT = 'Your changes that are not committed are larger than 5 MB: commit them first, or leave them out.';
```

- [ ] **Step 5: The copy.** Create `src/core/workflow-tests/project-copy.mjs`:

```js
// src/core/workflow-tests/project-copy.mjs
// Worca's own copy of a project (plans/workflow-tests-part3a-plan.md D42, D53, D54, D60, D61). One clone per project key at
// <worcaHome>/workflow-tests/repos/<key>, with no remote. Examples pin a start commit in it; every try is a worktree of it.
// The person's repository is only ever read: clone and fetch use it as their source, everything else is rev-parse,
// rev-list, ls-tree, cat-file, show, grep <tree>, for-each-ref and symbolic-ref, and uncommitted changes are read with
// uncommittedPatch's scratch objects.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { testCopiesRoot, testCopyDirFor, PROJECT_KEY_RE } from '../store.mjs';
import { uncommittedPatch } from '../git-info.mjs';
import { isSafeBranchName } from '../git-sync.mjs';
import { rmGuarded } from '../run-manifest.mjs';
import { testError, PIN_MAX_CHANGES } from './store.mjs';
import { lfsText, submodulesText, START_GONE_TEXT, CHANGES_TOO_BIG_TEXT } from '../../shared/workflow-tests/project-text.mjs';

const GIT_TIMEOUT_MS = 10 * 60_000;
const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0].slice(0, 300) || 'git failed';
/** Worca's commits in its copy (D53): one identity and the start commit's own date, so a start commit is the same every time. */
const WORCA_ID = Object.freeze({ GIT_AUTHOR_NAME: 'Worca', GIT_AUTHOR_EMAIL: 'worca@localhost', GIT_COMMITTER_NAME: 'Worca', GIT_COMMITTER_EMAIL: 'worca@localhost' });
const GIT_DIR_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
const RM = Object.freeze({ recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);

function git(cwd, args, { env = null } = {}) {
  const e = { ...(env || process.env) };
  if (!env) for (const k of GIT_DIR_ENV) delete e[k];
  return new Promise((done) => {
    execFile('git', args, { cwd, env: e, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      done({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const LOCKS = new Map();
/** One job at a time writes a copy (a clone, a fetch, a start commit): three tries start at once (D36). */
export function withKeyLock(key, fn) {
  const prev = LOCKS.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  LOCKS.set(key, tail);
  tail.then(() => { if (LOCKS.get(key) === tail) LOCKS.delete(key); });
  return next;
}

/** The copy of `key`, made from `projectDir` when it is missing or half made (D54). */
export async function ensureTestCopy(key, { projectDir }) {
  const dir = testCopyDirFor(key);
  if (existsSync(join(dir, '.git')) && (await git(dir, ['rev-parse', '--git-dir'])).ok) return { dir, created: false };
  await rm(dir, RM);
  await mkdir(testCopiesRoot(), { recursive: true });
  const c = await git(testCopiesRoot(), ['clone', '--quiet', '--local', '--no-checkout', '--no-tags', '--', resolve(projectDir), dir]);
  if (!c.ok) throw testError(`Worca could not copy the project: ${firstLine(c.stderr)}`, 'NOT_READY');
  for (const args of [['remote', 'remove', 'origin'], ['config', 'core.longpaths', 'true'], ['config', 'gc.auto', '0'], ['config', 'maintenance.auto', 'false']]) {
    const r = await git(dir, args);
    if (!r.ok) throw testError(`Worca could not set up its copy of the project: ${firstLine(r.stderr)}`, 'NOT_READY');
  }
  return { dir, created: true };
}

/** D54: what the copy could not hold. Read only (cat-file, grep on the tree). */
export async function projectUnsupported({ projectDir, sha }) {
  if ((await git(projectDir, ['cat-file', '-e', `${sha}:.gitmodules`])).ok) return 'submodules';
  const g = await git(projectDir, ['grep', '-q', '-I', '-e', 'filter=lfs', sha, '--', '.gitattributes', '*/.gitattributes']);
  return g.ok ? 'lfs' : null;
}

async function resolveStart(projectDir, { ref, sha }) {
  const current = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  if (sha) {
    const v = await git(projectDir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (!v.ok) throw testError(START_GONE_TEXT, 'NOT_READY');
    return { commit: v.stdout.trim(), startRef: ref ?? null, current };
  }
  const startRef = ref ?? current;
  const v = await git(projectDir, ['rev-parse', '--verify', '--quiet', startRef ? `refs/heads/${startRef}^{commit}` : 'HEAD^{commit}']);
  if (!v.ok) throw testError(startRef ? `the branch ${startRef} is not in the project` : 'the project has no commit yet', 'BAD_REQUEST');
  return { commit: v.stdout.trim(), startRef, current };
}

async function readChanges(projectDir, base) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-wft-changes-'));
  try {
    const r = await uncommittedPatch(projectDir, { base, outFile: join(tmp, 'changes.patch'), scratchObjects: true });
    if (!r.ok) throw testError(`Worca could not read your changes that are not committed: ${r.message}`, 'BAD_REQUEST');
    if (!r.file) return null;
    if (r.bytes > PIN_MAX_CHANGES) throw testError(CHANGES_TOO_BIG_TEXT, 'BAD_REQUEST');
    return await readFile(r.file);
  } finally { await rm(tmp, RM).catch(() => {}); }
}

async function fetchInto(dir, projectDir, sha) {
  if ((await git(dir, ['cat-file', '-e', `${sha}^{commit}`])).ok) return;
  const f = await git(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--', resolve(projectDir), sha]);
  if (!f.ok) throw testError(START_GONE_TEXT, 'NOT_READY');
}

/** D53: start commit = `base` + the patch, in the copy, with a temporary index. Same inputs → same SHA. */
async function commitChanges(dir, base, patch, at) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-wft-start-'));
  try {
    const env = { ...process.env, ...WORCA_ID, GIT_INDEX_FILE: join(tmp, 'index'), GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
    for (const k of GIT_DIR_ENV) if (k !== 'GIT_INDEX_FILE') delete env[k];
    const file = join(tmp, 'changes.patch');
    await writeFile(file, patch);
    for (const args of [['read-tree', base], ['apply', '--cached', '--binary', '--whitespace=nowarn', file]]) {
      const r = await git(dir, args, { env });
      if (!r.ok) throw testError(`Worca could not apply your changes that are not committed: ${firstLine(r.stderr)}`, 'BAD_REQUEST');
    }
    const tree = (await git(dir, ['write-tree'], { env })).stdout.trim();
    const c = await git(dir, ['commit-tree', '--no-gpg-sign', tree, '-p', base, '-m', 'Worca test start: changes that were not committed yet'], { env });
    if (!c.ok || !c.stdout.trim()) throw testError(`Worca could not make the start point: ${firstLine(c.stderr)}`, 'NOT_READY');
    return c.stdout.trim();
  } finally { await rm(tmp, RM).catch(() => {}); }
}

const pinRef = (dir, sha) => git(dir, ['update-ref', `refs/worca-tests/${sha}`, sha]);

/**
 * Pin a start point (D41, D53): the newest commit of `ref` (default: the branch the folder is on), or exactly `sha` (a past
 * run's start, D65). With `includeChanges`, the person's uncommitted changes go on top as Worca's own start commit.
 */
export async function pinStart({ key, name = key, projectDir, ref = null, sha = null, includeChanges = false } = {}) {
  if (ref != null && !isSafeBranchName(ref)) throw testError('pick a branch of the project', 'BAD_REQUEST');
  const { commit, startRef, current } = await resolveStart(projectDir, { ref, sha });
  const why = await projectUnsupported({ projectDir, sha: commit });
  if (why) throw testError(why === 'lfs' ? lfsText(name) : submodulesText(name), 'NOT_READY');
  const startAt = new Date((await git(projectDir, ['show', '-s', '--format=%cI', commit])).stdout.trim()).toISOString();
  let changes = null;
  if (includeChanges) {
    if (sha || !startRef || startRef !== current) throw testError('uncommitted changes can be kept only for the branch your project folder is on', 'BAD_REQUEST');
    changes = await readChanges(projectDir, commit);
  }
  return withKeyLock(key, async () => {
    const { dir } = await ensureTestCopy(key, { projectDir });
    await fetchInto(dir, projectDir, commit);
    const startCommit = changes ? await commitChanges(dir, commit, changes, startAt) : commit;
    await pinRef(dir, startCommit);
    return { key, startSha: commit, startRef, startAt, startCommit, changes, setupCmd: null };
  });
}

/** Before a try: the example's start commit is in the copy; a copy removed meanwhile is made again (same SHA, D53). */
export async function ensureStartCommit({ key, projectDir, project, changes = null }) {
  return withKeyLock(key, async () => {
    const { dir } = await ensureTestCopy(key, { projectDir });
    if (!(await git(dir, ['cat-file', '-e', `${project.startCommit}^{commit}`])).ok) {
      await fetchInto(dir, projectDir, project.startSha);
      const again = changes ? await commitChanges(dir, project.startSha, changes, project.startAt) : project.startSha;
      if (again !== project.startCommit) throw testError(START_GONE_TEXT, 'NOT_READY');
    }
    await pinRef(dir, project.startCommit);
    return { copyDir: dir, startCommit: project.startCommit };
  });
}

/** D63: how many commits the start branch gained since the start point; null when Worca cannot tell. Read only. */
export async function behindCount({ projectDir, startSha, startRef }) {
  if (!startRef || !projectDir || !existsSync(projectDir) || !isSafeBranchName(startRef)) return null;
  const r = await git(projectDir, ['rev-list', '--count', `${startSha}..refs/heads/${startRef}`]);
  return r.ok ? Number(r.stdout.trim()) || 0 : null;
}

/** D60: the bytes of every file in the start tree (exact, cheap). Read only. */
export async function treeBytes({ projectDir, sha }) {
  const r = await git(projectDir, ['ls-tree', '-r', '-l', '-z', sha]);
  if (!r.ok) return null;
  let n = 0;
  for (const entry of r.stdout.split('\0')) {
    const m = /^\d+ blob [0-9a-f]+ +(\d+)\t/.exec(entry);
    if (m) n += Number(m[1]);
  }
  return n;
}

/** D60: free bytes on the disk that holds the run folders. */
export async function freeDiskBytes(dir = worcaHome()) {
  try {
    await mkdir(dir, { recursive: true });
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

/** D60: the bytes in a checkout after its setup. Links and junctions are never followed. null past `maxEntries`. */
export async function dirBytes(dir, { maxEntries = 300_000 } = {}) {
  let bytes = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names;
    try { names = await readdir(d); } catch { continue; }
    for (const name of names) {
      seen += 1;
      if (seen > maxEntries) return null;
      const p = join(d, name);
      let st;
      try { st = await lstat(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;   // Node reports a Windows junction as a link too
      if (st.isDirectory()) stack.push(p); else bytes += st.size;
    }
  }
  return bytes;
}

/** The start point dialog (P2): the project's local branches, the one its folder is on first. Read only. */
export async function listBranches(projectDir, { max = 50 } = {}) {
  const current = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  const r = await git(projectDir, ['for-each-ref', '--sort=-committerdate', `--count=${max}`,
    '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)', 'refs/heads']);
  if (!r.ok) return [];
  const out = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, sha, at] = line.split('\0');
    return { name, sha, at: new Date(at).toISOString(), current: name === current };
  });
  return out.sort((x, y) => Number(y.current) - Number(x.current));
}

/** Remove a folder, riding out a Windows file lock (EPERM, EBUSY). null = gone; else why it stayed. Never throws. */
export async function removeTree(dir, { rmImpl = rm, attempts = 5, waitMs = 500 } = {}) {
  for (let i = 1; ; i += 1) {
    try { await rmImpl(dir, RM); return null; }
    catch (e) {
      if (i >= attempts || !RETRY_CODES.has(e && e.code)) return e && e.message ? e.message : String(e);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * D61: after a try's checks, or on any other end: its checkout, its branch in the copy and its run root. Node's rm removes
 * the checkout first (it never follows a junction, as the test proves); `git worktree prune` then drops the registration.
 * `git worktree remove` is not used: its own walk is not proved junction-safe on Windows.
 */
export async function removeTryCheckout({ copyDir, worktreeDir = null, branch = null, runRoot = null, pipelineId = null, rmImpl } = {}) {
  const errors = [];
  if (worktreeDir && existsSync(worktreeDir)) {
    const e = await removeTree(worktreeDir, rmImpl ? { rmImpl } : {});
    if (e) errors.push(e);
  }
  if (copyDir && existsSync(copyDir)) {
    await git(copyDir, ['worktree', 'prune']);
    if (branch && /^[^-]/.test(branch)) await git(copyDir, ['branch', '-D', branch]);
  }
  if (runRoot && pipelineId && existsSync(runRoot)) {
    const r = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId });
    if (!r.removed && existsSync(runRoot)) errors.push(r.reason || 'the run folder stayed');
  }
  return { removed: !errors.length, error: errors[0] || null };
}

/** D61, at boot (no try runs): every copy prunes its worktrees and loses the try branches no worktree holds. */
export async function sweepTestCopies({ log = () => {} } = {}) {
  const out = { copies: 0, branches: 0 };
  let names = [];
  try { names = (await readdir(testCopiesRoot(), { withFileTypes: true })).filter((e) => e.isDirectory() && PROJECT_KEY_RE.test(e.name)).map((e) => e.name); }
  catch { return out; }
  for (const name of names) {
    const dir = join(testCopiesRoot(), name);
    if (!(await git(dir, ['rev-parse', '--git-dir'])).ok) continue;
    out.copies += 1;
    await git(dir, ['worktree', 'prune']);
    const held = new Set((await git(dir, ['worktree', 'list', '--porcelain'])).stdout.split('\n')
      .filter((l) => l.startsWith('branch refs/heads/')).map((l) => l.slice('branch refs/heads/'.length)));
    const r = await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/worca-cc/']);
    for (const b of r.stdout.split('\n').filter(Boolean)) {
      if (held.has(b)) continue;
      if ((await git(dir, ['branch', '-D', b])).ok) out.branches += 1;
    }
  }
  if (out.branches) log('info', `workflow tests: removed ${out.branches} leftover try branch(es) in ${out.copies} copy(ies) of a project`);
  return out;
}
```

`PROJECT_KEY_RE` is already exported by store.mjs (:80). `isSafeBranchName` is exported by git-sync.mjs (server.mjs imports it from there, :357). `rmGuarded` refuses any path outside `<worcaHome>/runs/` (run-manifest.mjs:114).

- [ ] **Step 6: Run the tests**

Run: `node tools/test.mjs test/workflow-test-project-copy.test.mjs test/git-info.test.mjs`
Expected: PASS. (Use the real git-info test file names: `Get-ChildItem test\git-info*.test.mjs`.)

If the junction assertion fails on Windows (`keep.txt` gone), stop. Node's `rm` followed the junction, and every removal in this plan depends on it not doing that. Report it to the controller. The fix to propose is to unlink each link found by an `lstat` walk before the recursive `rm`.

- [ ] **Step 7: Commit**

```bash
git add src/core/workflow-tests/project-copy.mjs src/shared/workflow-tests/project-text.mjs src/core/git-info.mjs test/workflow-test-project-copy.test.mjs
git commit -m "Workflow tests 3a: Worca's own copy of a project, pinned start points, sizes and removal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: A project try: the run body, the server, setup and the kept checkout (D43, D44, D55)

**Files:**
- Create: `src/core/workflow-tests/shell-step.mjs`
- Modify: `src/core/workflow-tests/try-body.mjs`, `tryRunBody` (:24-33)
- Modify: `src/shared/workflow-tests/project-text.mjs` (add `setupFailedText`)
- Modify `ui/server.mjs`:
  - the store.mjs import: add `testCopyKeyOf`;
  - the shell-step import;
  - `startRunHandler`'s workflow-test checks (:2533-2541);
  - `syncAllowed` (:2890);
  - the single-project branch: `workMode` (:3112), `runSetup` (:3208), `createOrchestratorFor` (:3220-3255), the entry (:3257-3268).
- Modify `src/core/run-harness.mjs`:
  - the imports;
  - `run()` after `_setupRunRoot()` (:1652-1662);
  - a new `_runTrySetup` and `_untrackedDirs` after `_setupRunRoot`;
  - `_excludePathspecs` (:7105-7111);
  - `_teardownRunRoot` step (5) (:5172-5180), the mirror (:5230) and step (9) (:5251-5266);
  - `_keepCheckoutByPolicy` (:5378);
  - `_checkBaseAfterRun` (:5394).
- Modify: `test/api-workflow-test-try.test.mjs` (the refusal text of a try with a project folder)
- Test: `test/workflow-test-shell-step.test.mjs`, `test/api-workflow-test-project-try.test.mjs`

**Interfaces:**
- Consumes:
  - `testCopyKeyOf`, `testCopyDirFor` (Task 1);
  - `pinStart`, `ensureStartCommit` (Task 3);
  - `repoSnapshot` (Task 1);
  - `spawnActionProcess`, `stopProcess`, `actionBaseEnv` (actions/spawn.mjs).
- Produces (`shell-step.mjs`):
  - `runShellStep({ command, cwd, env, timeoutMs, signal, spawnImpl }) → Promise<{ ok, exitCode, timedOut, ms, tail }>` (`tail` = the last 40 lines, at most 8 KB)
  - `tryShellEnv({ logFile } = {}) → env` (the action env + `WORCA_TEST=1`; Task 5 adds the guard)
  - `writeTrySetup(pipelineDir, rec)`, `readTrySetup(pipelineDir) → rec|null`
  - `TRY_SETUP_FILE = 'try-setup.json'`, `TRY_SETUP_STAGE = 'Running setup'`, `SETUP_TIMEOUT_MS = 1_800_000`, `TAIL_LINES = 40`
- Produces (`try-body.mjs`): `tryRunBody(example, files, { workflowId, tryNo, mock, quick, project })`. With `project = { copyDir, startCommit }` the body is `{ projectDir: copyDir, sourceBranch: startCommit, workflowId, prompt, title, extras, mock? }`.
- Produces (server, in-process only): `workflowTest.project = { key, setupCmd: string|null }`. The refusals are:
  - `"a test try runs without a project, or in Worca's copy of one"` (400);
  - `'a test try starts now, on a branch of its own'` (400);
  - `'a project try needs git'` (400).
- Produces (harness options):
  - `keepCheckout: true`: teardown commits, keeps the worktree and the run root, and stamps `branch.worktreeKept = true`;
  - `trySetup: { cmd, timeoutMs }`;
  - `this._trySetupPaths`;
  - a setup failure ends the run `error` with the message `setupFailedText(cmd)` and `try-setup.json` `{ cmd, ok:false, exitCode, timedOut, ms, tail }`.
- Produces (`project-text.mjs`): `setupFailedText(cmd) → 'The setup step failed: <cmd> ended with an error.'`

- [ ] **Step 1: Write the failing shell-step test.** Create `test/workflow-test-shell-step.test.mjs`:

```js
// test/workflow-test-shell-step.test.mjs — workflow tests 3a (D55, D57): one command through the OS shell, with a time
// limit and the end of its output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellStep, tryShellEnv, writeTrySetup, readTrySetup, TAIL_LINES } from '../src/core/workflow-tests/shell-step.mjs';

const node = (code) => `node -e "${code}"`;
const cwd = tmpdir();

test('a command that passes: exit 0, its output tail', async () => {
  const r = await runShellStep({ command: node("console.log('a'); console.log('3 passed')"), cwd, env: tryShellEnv(), timeoutMs: 30000 });
  assert.deepEqual([r.ok, r.exitCode, r.timedOut], [true, 0, false]);
  assert.match(r.tail, /3 passed/);
});

test('an exit code, a time limit and an abort are not ok', async () => {
  const bad = await runShellStep({ command: node('process.exit(2)'), cwd, env: tryShellEnv(), timeoutMs: 30000 });
  assert.deepEqual([bad.ok, bad.exitCode], [false, 2]);
  const slow = await runShellStep({ command: node('setTimeout(() => {}, 60000)'), cwd, env: tryShellEnv(), timeoutMs: 400 });
  assert.deepEqual([slow.ok, slow.timedOut], [false, true]);
  const ac = new AbortController();
  const p = runShellStep({ command: node('setTimeout(() => {}, 60000)'), cwd, env: tryShellEnv(), timeoutMs: 30000, signal: ac.signal });
  setTimeout(() => ac.abort(), 200);
  assert.equal((await p).ok, false);
});

test('the tail keeps the last 40 lines', async () => {
  const r = await runShellStep({ command: node('for (let i = 1; i <= 100; i++) console.log(\'line \' + i)'), cwd, env: tryShellEnv(), timeoutMs: 30000 });
  const lines = r.tail.split('\n');
  assert.equal(lines.length, TAIL_LINES);
  assert.equal(lines.at(-1), 'line 100');
});

test('the env knows it is a test and holds no Worca home', () => {
  const env = tryShellEnv();
  assert.equal(env.WORCA_TEST, '1');
  assert.equal(env.WORCA_HOME, undefined);
});

test('the setup file round-trips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-wftsetup-'));
  try {
    assert.equal(await readTrySetup(dir), null);
    await writeTrySetup(dir, { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 5, tail: 'npm error' });
    assert.deepEqual(await readTrySetup(dir), { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 5, tail: 'npm error' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Write the failing server test.** Create `test/api-workflow-test-project-try.test.mjs`:

```js
// test/api-workflow-test-project-try.test.mjs — workflow tests 3a, Task 4 (D42, D43, D55): one project try through the run
// handler (mock engine). It runs in Worca's copy under the real key, is hidden like a Part 2 try, runs its setup first,
// keeps its checkout for its checks, and leaves the person's repository as it was. A normal run is unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, runs, _testing, artifacts, real, key, pin, copyDir;
const frames = [];
const extra = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const GRAPH = {
  version: 2, id: 'wf_ptry', name: 'Fix a bug', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};
const SETUP_OK = 'node -e "const f=require(\'fs\');f.mkdirSync(\'node_modules/x\',{recursive:true});f.writeFileSync(\'node_modules/x/y.txt\',\'x\');f.mkdirSync(\'setup-out\',{recursive:true});f.writeFileSync(\'setup-out/z.txt\',\'z\')"';
async function settled(runId, ms = 200000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftptry-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  artifacts = await import('../src/core/artifacts.mjs');
  _testing.sockets.add({ readyState: 1, OPEN: 1, send: (t) => frames.push(JSON.parse(t)) });
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftptry', { branch: 'main', user: true, files: { '.gitignore': 'node_modules/\n', 'README.md': '# hi\n' } });
  extra.push(real);
  const { insertProject } = await import('../src/core/projects.mjs');
  insertProject({ name: 'tickets', path: real });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(homeDir, 'workflow-tests', 'repos', key);
  assert.equal((await post('/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const tryBody = async (over = {}) => {
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  return { ...tryRunBody({ name: 'Ticket 482', request: 'Fix the rounding.' }, [], { workflowId: 'wf_ptry', tryNo: 1,
    project: { copyDir, startCommit: pin.startCommit } }), ...over };
};

test('a try names its folder: without a project, or Worca\'s copy of the project it names', async () => {
  const TEXT = "a test try runs without a project, or in Worca's copy of one";
  const own = await _testing.invokeStartRun({ ...(await tryBody()), projectDir: real }, null, { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
  assert.deepEqual([own.status, own.body.error], [400, TEXT], 'never the person\'s folder');
  const noKey = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft' } });
  assert.deepEqual([noKey.status, noKey.body.error], [400, TEXT]);
  const same = await _testing.invokeStartRun(await tryBody({ sameAsSource: true }), null, { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
  assert.deepEqual([same.status, same.body.error], [400, 'a test try starts now, on a branch of its own']);
});

test('a project try: the real key, hidden, setup first, its checkout kept, setup output out of the diff, the project only read', { timeout: 240000 }, async () => {
  const was = repoSnapshot(real);
  const out = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft', project: { key, setupCmd: SETUP_OK } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const { runId, pipelineId } = out.body;
  const entry = await settled(runId);
  assert.equal(entry.isTest, true);
  const row = artifacts.findPipelineRowById(pipelineId);
  assert.deepEqual([row.is_test, row.project_key, row.status], [1, key, 'done']);
  const br = JSON.parse(row.branch);
  assert.equal(br.baseSha, pin.startCommit);
  assert.equal(br.worktreeKept, true);
  assert.ok(existsSync(br.worktreeDir), 'kept for the checks');
  assert.ok(existsSync(join(br.worktreeDir, 'setup-out', 'z.txt')), 'the setup ran in the checkout');
  const { readTrySetup } = await import('../src/core/workflow-tests/shell-step.mjs');
  const setup = await readTrySetup(entry.orch.pipeline.dir);
  assert.deepEqual([setup.ok, setup.exitCode], [true, 0]);
  const results = JSON.parse(readFileSync(join(entry.orch.pipeline.dir, 'results.json'), 'utf8'));
  const paths = [...results.newFiles, ...results.changedFiles].map((f) => f.path);
  assert.ok(paths.includes('src/feature.mjs'), 'the mock implementer\'s work is the try\'s change');
  assert.ok(!paths.some((p) => p.startsWith('setup-out/')), 'what the setup made is not');
  assert.ok(git(copyDir, 'rev-parse', '--verify', `refs/heads/${br.feature}`));
  assert.ok(!frames.some((f) => f.runId === runId), 'no frame of the try reached a tab');
  const h = await (await fetch(`${base}/api/history`)).json();
  assert.ok(!h.pipelines.some((p) => p.id === pipelineId));
  assert.equal(repoSnapshot(real), was);
});

test('a setup that fails ends the try as a setup failure, before any step', { timeout: 240000 }, async () => {
  const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 2' }), null,
    { workflowTest: { use: 'draft', project: { key, setupCmd: 'node -e "process.exit(3)"' } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  const row = artifacts.findPipelineRowById(out.body.pipelineId);
  assert.equal(row.status, 'error');
  const { readTrySetup } = await import('../src/core/workflow-tests/shell-step.mjs');
  const setup = await readTrySetup(entry.orch.pipeline.dir);
  assert.deepEqual([setup.ok, setup.exitCode, setup.cmd], [false, 3, 'node -e "process.exit(3)"']);
  assert.equal(existsSync(join(entry.orch.pipeline.dir, 'results.json')), false, 'no step ran, nothing changed');
  assert.ok(existsSync(JSON.parse(row.branch).worktreeDir), 'kept: the runner removes it');
});

test('a normal git run is unchanged: its checkout and run root go at teardown', { timeout: 240000 }, async () => {
  const other = templateRepo('wftpnormal', { branch: 'main', user: true, files: { 'README.md': '# n\n' } });
  extra.push(other);
  const out = await _testing.invokeStartRun({ projectDir: other, prompt: 'Add a feature', title: 'Normal run', workflowId: 'wf_ptry' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  await settled(out.body.runId);
  const row = artifacts.findPipelineRowById(out.body.pipelineId);
  const br = JSON.parse(row.branch);
  assert.equal(br.worktreeKept, undefined);
  assert.equal(br.worktreeRemoved, true);
  assert.equal(existsSync(br.worktreeDir), false);
  assert.equal(existsSync(join(homeDir, 'runs', out.body.pipelineId)), false);
  assert.equal(row.is_test, null);
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `node tools/test.mjs test/workflow-test-shell-step.test.mjs test/api-workflow-test-project-try.test.mjs`
Expected: FAIL. The first fails with `Cannot find module '…/shell-step.mjs'`. The second fails because the first refusal still reads `a test try runs without a project`.

- [ ] **Step 4: Create `src/core/workflow-tests/shell-step.mjs`**

```js
// src/core/workflow-tests/shell-step.mjs — one command through the OS shell (cmd.exe /d /s /c, or /bin/sh -c), with a time
// limit and the end of its output (plans/workflow-tests-part3a-plan.md D55, D57): "Before each try, run" and the command
// check. Also the file a project try's setup leaves in its pipeline folder.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnActionProcess, stopProcess, actionBaseEnv } from '../actions/spawn.mjs';

export const TAIL_LINES = 40;
export const TAIL_BYTES = 8 * 1024;
export const SETUP_TIMEOUT_MS = 30 * 60_000;
export const TRY_SETUP_FILE = 'try-setup.json';
/** The harness's setup stage while a try's setup runs (state.setupStage): the runner reads it as the "Running setup" phase. */
export const TRY_SETUP_STAGE = 'Running setup';

/** What a project try's setup and command checks start from: the action env (no host credential, no Worca home) and
 *  WORCA_TEST=1. Task 5 adds the outward guard. */
export function tryShellEnv({ logFile = null } = {}) {
  void logFile;
  return { ...actionBaseEnv(), WORCA_TEST: '1' };
}

/** @returns {Promise<{ok: boolean, exitCode: number|null, timedOut: boolean, ms: number, tail: string}>} never throws */
export async function runShellStep({ command, cwd, env, timeoutMs, signal = null, spawnImpl = null } = {}) {
  const t0 = Date.now();
  const lines = [];
  let bytes = 0;
  const onLine = (_stream, line) => {
    lines.push(line);
    bytes += line.length + 1;
    while (lines.length > TAIL_LINES || (bytes > TAIL_BYTES && lines.length > 1)) bytes -= lines.shift().length + 1;
  };
  let child;
  try { child = spawnActionProcess({ command, cwd, env, onLine, ...(spawnImpl ? { spawnImpl } : {}) }); }
  catch (e) { return { ok: false, exitCode: null, timedOut: false, ms: Date.now() - t0, tail: String(e && e.message ? e.message : e) }; }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void stopProcess(child); }, timeoutMs);
  const onAbort = () => { void stopProcess(child); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const exitCode = await new Promise((done) => {
    child.once('error', (e) => { onLine('err', String(e && e.message ? e.message : e)); done(null); });
    child.once('close', (code) => done(code));
  });
  clearTimeout(timer);
  if (signal) signal.removeEventListener('abort', onAbort);
  return { ok: exitCode === 0 && !timedOut && !(signal && signal.aborted), exitCode, timedOut, ms: Date.now() - t0, tail: lines.join('\n') };
}

export async function writeTrySetup(pipelineDir, rec) {
  await writeFile(join(pipelineDir, TRY_SETUP_FILE), `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
}

/** The setup record of a try, or null (no setup, or not written). Never throws. */
export async function readTrySetup(pipelineDir) {
  try {
    const v = JSON.parse(await readFile(join(pipelineDir, TRY_SETUP_FILE), 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}
```

In `src/shared/workflow-tests/project-text.mjs`, add:
```js
// D55, board 35: why a test stopped before any step of a try.
export const setupFailedText = (cmd) => `The setup step failed: ${cmd} ended with an error.`;
```

- [ ] **Step 5: The run body (`src/core/workflow-tests/try-body.mjs`)**

Change `tryRunBody` to:
```js
/**
 * The /api/run body of one try, startRunHandler's shape. The files ride base64 as `extras`, as the New run form sends
 * them. The draft or the version (`use`) travels in-process through invokeStartRun's workflowTest, never in this body.
 * 3a (D42): a try of an example with a project runs in Worca's copy of that project, from the example's start commit.
 * @param {{name: string, request: string}} example
 * @param {Array<{name: string, data: Buffer}>} files
 * @param {{workflowId: string, tryNo: number, mock?: boolean, quick?: boolean, project?: {copyDir: string, startCommit: string}|null}} opts
 */
export function tryRunBody(example, files, { workflowId, tryNo, mock = false, quick = false, project = null }) {
  return {
    ...(project ? { projectDir: project.copyDir, sourceBranch: project.startCommit } : { noProject: true }),
    workflowId,
    prompt: example.request,
    title: quick ? `Quick check: ${example.name}` : tryTitle(example, tryNo),
    extras: (files || []).map((f) => ({ name: f.name, dataBase64: Buffer.from(f.data).toString('base64') })),
    ...(mock || quick ? { mock: true } : {}),
  };
}
```
Update the module header's last sentence to: "Part 3a adds the project branch: the try runs in Worca's copy of the example's project (D42)."

- [ ] **Step 6: The server (`ui/server.mjs`)**

Add `testCopyKeyOf` to the `../src/core/store.mjs` import. Add `import { SETUP_TIMEOUT_MS } from '../src/core/workflow-tests/shell-step.mjs';` beside the other workflow-tests imports (:336-339). Replace the line `if (workflowTest && body.noProject !== true) return badRequest(res, 'a test try runs without a project');` (:2535) with:
```js
    // 3a (D42): a project try runs in Worca's copy of the project it names (workflowTest.project.key), never in a person's
    // folder; the copy is never a registered project, so the key travels in-process with it.
    const tryProject = workflowTest && workflowTest.project && typeof workflowTest.project === 'object' ? workflowTest.project : null;
    if (workflowTest && !(body.noProject === true
      || (tryProject && typeof body.projectDir === 'string' && testCopyKeyOf(body.projectDir) === tryProject.key))) {
      return badRequest(res, "a test try runs without a project, or in Worca's copy of one");
    }
    if (workflowTest && (body.sameAsSource === true || body.scheduledFor != null || body.repeat != null || body.after != null || body.workspaceId)) {
      return badRequest(res, 'a test try starts now, on a branch of its own');
    }
    if (tryProject && tryProject.setupCmd != null && (typeof tryProject.setupCmd !== 'string' || /[\r\n]/.test(tryProject.setupCmd))) {
      return badRequest(res, 'a test try names its setup command on one line');
    }
```
Change `syncAllowed` (:2890) to:
```js
    const syncAllowed = !scanTarget && !memoryScope && !workflowTest;   // 3a: a try never syncs (Worca's copy has no remote)
```
In the single-project branch, right after `const workMode = workModeForStart(…)` (:3112), add:
```js
      if (workflowTest && workMode !== 'git') return badRequest(res, 'a project try needs git');
```
Change `const runSetup = scanTarget || memoryScope ? null` (:3208) to `const runSetup = scanTarget || memoryScope || workflowTest ? null`. In the `createOrchestratorFor({` call of that branch, after `...(runSetup ? { runSetup } : {}),`, add:
```js
        // 3a (D21, D43, D55): a project try is a hidden try like Part 2's. It keeps its checkout for its checks and runs its
        // setup before any step. Its key is the real project's: projectKey() answers it for the copy (D52).
        ...(workflowTest ? { workflowUse: workflowTest.use, workflowTest: true, noMemory: true, titleLocked: true,
          testConnectors: workflowTest.connectors === 'real' ? 'real' : 'pretend', keepCheckout: true,
          ...(tryProject && tryProject.setupCmd ? { trySetup: { cmd: tryProject.setupCmd, timeoutMs: SETUP_TIMEOUT_MS } } : {}) } : {}),
```
In that branch's `entry = {`, after `pendingQuestion: null,`, add `...(workflowTest ? { isTest: true } : {}),`.

- [ ] **Step 7: The harness (`src/core/run-harness.mjs`)**

Imports:
- `import { runShellStep, tryShellEnv, writeTrySetup, TRY_SETUP_STAGE } from './workflow-tests/shell-step.mjs';`
- `import { setupFailedText } from '../shared/workflow-tests/project-text.mjs';`
- add `CONNECTOR_CALLS_FILE` to the existing `./workflow-tests/connectors.mjs` import.

In `run()`, after the block that ends `if (!this.resumeOpts) this._kickoffTitleGeneration();` and its `this._checkAbort();` (:1661-1662), add:
```js
      // Workflow tests 3a (D55): a project try's "Before each try, run", in its checkout, before any step.
      if (this.opts.trySetup && this.workMode === 'git' && !this.isWorkspace) await this._runTrySetup();
```
After `_setupRunRoot` (it ends at :2802), add:
```js
  /** Workflow tests 3a (D55): "Before each try, run", in the try's checkout, before any step. A failure ends the run as an
   *  error the runner reads as a setup failure (try-setup.json), never as the workflow's. */
  async _runTrySetup() {
    const { cmd, timeoutMs } = this.opts.trySetup;
    const cwd = this.workDirs.get(this.members[0].projectKey) || this.runCwd || this.workDir;
    this._setupStage(TRY_SETUP_STAGE);
    const r = await runShellStep({ command: cmd, cwd, env: tryShellEnv({ logFile: join(this.pipeline.dir, CONNECTOR_CALLS_FILE) }),
      timeoutMs, signal: this.abort.signal });
    if (r.ok) this._trySetupPaths = await this._untrackedDirs(cwd);
    await writeTrySetup(this.pipeline.dir, { cmd, ok: r.ok, exitCode: r.exitCode, timedOut: r.timedOut, ms: r.ms, tail: r.tail });
    await appendAudit(this.pipeline.dir, `Setup \`${cmd}\` ${r.ok ? 'finished' : 'failed'} in ${Math.round(r.ms / 1000)} s.`).catch(() => {});
    if (r.ok) return;
    this._checkAbort();   // a stop during the setup is a stop, not a setup failure
    throw markTerminal(Object.assign(new Error(setupFailedText(cmd)), { code: 'TRY_SETUP_FAILED' }));
  }

  /** What a try's setup made that git would track (untracked, not ignored), folders collapsed, at most 200 paths. */
  async _untrackedDirs(cwd) {
    const r = await this._git(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '--directory', '-z'], { cwd });
    if (!r.ok) return [];
    return r.stdout.split('\0').filter(Boolean).map((p) => p.replace(/\/$/, '')).slice(0, 200);
  }
```
Change `_excludePathspecs` to:
```js
  _excludePathspecs(projectKey) {
    const entries = this.injectedPaths?.[projectKey] ?? [];
    // Workflow tests 3a (D55): what "Before each try, run" made is not the try's work. Absent on every other run.
    const setup = Array.isArray(this._trySetupPaths) ? this._trySetupPaths.map((p) => `:(exclude)${p}`) : [];
    if ((!Array.isArray(entries) || !entries.length) && !setup.length) return [];
    return [...(Array.isArray(entries) ? entries : [])
      .filter((e) => e && e.path && e.kind !== 'claudeMdSection' && e.kind !== 'engineConfig')
      .map((e) => `:(exclude)${e.path}`), ...setup];
  }
```
In `_teardownRunRoot`, after `const at = new Date().toISOString();` (:5122), add `let keptForChecks = false;   // 3a D43`. After the `if (retained) { … continue; }` block (ends :5179), add:
```js
      // Workflow tests 3a (D43): a project try keeps its checkout, and so its run root, until its checks have run; the runner
      // removes both (project-copy.mjs removeTryCheckout). The commit above is on the try's branch in Worca's copy.
      if (this.opts.keepCheckout === true) {
        if (branchRecord) branchRecord.worktreeKept = true;
        keptForChecks = true;
        continue;
      }
```
Change the mirror line (:5230) to:
```js
    if (!commitRetained && !keptForChecks && this.workMode === 'git' && this._memberWorkMode(this.members[0]?.projectKey) === 'git') this._mirrorPrimaryBranchTeardown();
```
In step (9), before the final `} else {` that calls `rmGuarded` (:5258), add:
```js
      } else if (keptForChecks) {
        this._log('worktree', 'info', `Run root kept at ${this.runRoot} until the test's checks have run.`);
```
At the top of `_keepCheckoutByPolicy` and of `_checkBaseAfterRun`, add:
```js
    if (this.opts.workflowTest === true) return;   // 3a: a try's checkout belongs to its test, and a try never fetches
```

- [ ] **Step 8: Update Part 2's refusal text**

In `test/api-workflow-test-try.test.mjs`, in the test "the in-process option is checked", change the `bad1` expectation to:
```js
  assert.deepEqual([bad1.status, bad1.body.error], [400, "a test try runs without a project, or in Worca's copy of one"]);
```

- [ ] **Step 9: Run the tests**

Run: `node tools/test.mjs test/workflow-test-shell-step.test.mjs test/api-workflow-test-project-try.test.mjs test/api-workflow-test-try.test.mjs test/workflow-test-isolation.test.mjs test/api-run-no-project.test.mjs`
Expected: PASS. Then run the harness neighbours: `node tools/test.mjs test/run-harness-teardown.test.mjs test/orchestrator-worktree.test.mjs` (use `Get-ChildItem test\*teardown*.test.mjs, test\*worktree*.test.mjs` for the real names). Expected: the Task 0 results.

- [ ] **Step 10: Commit**

```bash
git add src/core/workflow-tests/shell-step.mjs src/core/workflow-tests/try-body.mjs src/shared/workflow-tests/project-text.mjs ui/server.mjs src/core/run-harness.mjs test/workflow-test-shell-step.test.mjs test/api-workflow-test-project-try.test.mjs test/api-workflow-test-try.test.mjs
git commit -m "Workflow tests 3a: a project try runs in Worca's copy, runs its setup first and keeps its checkout for the checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Nothing leaves a try: the outward guard (D45, D56, D68)

Every try gets the guard: with or without a project, Pretend or Real. A normal run's argv, settings and env stay byte-identical.

**Files:**
- Create: `src/core/workflow-tests/try-guard.mjs` (pure decisions, the hook CLI and the stand-in CLI; `node:` built-ins only)
- Create: `src/core/workflow-tests/try-guard-env.mjs`
- Create: `src/core/workflow-tests/guard-calls.mjs`
- Modify: `src/core/workflow-tests/shell-step.mjs`: `tryShellEnv` adds the guard.
- Modify: `src/core/workflow-tests/connectors.mjs`: `sentCall` (:215-227) and `wouldHaveSent` (:244-252).
- Modify: `src/shared/workflow-tests/project-text.mjs`: `TRY_NEVER_SHIPS_TEXT`.
- Modify: `src/core/run-harness.mjs`: `_tryGuard()` after `_testConnectors()` (:3842-3845).
- Modify: `src/core/orchestrator.mjs`: `_nodeCtx`, beside `testConnectors` (:1888).
- Modify: `src/core/phases.mjs`: `runOpts` (:823-925), beside `strictMcpConfig`.
- Modify: `src/core/claude-runner.mjs`: `runClaude`'s destructure (:132-160) and its `engine.run` object (:241-275), the GATE.
- Modify `src/core/engines/claude.mjs`:
  - `buildSettingsPayload` (:59-87);
  - `buildSettingsArgs` (:283);
  - `buildClaudeArgs` (:320-356, the parameter list and the `buildSettingsArgs` call);
  - `planClaudeInvocation` (:445);
  - `runClaudeProcess` (:465, the destructure; :552, `stageClaudeInvocation`; :580-583, `composeSpawnEnv`).
- Modify: `src/core/engines/spawn.mjs`: `composeSpawnEnv` (:100-111).
- Modify: `src/core/graph/script-runner.mjs`: `buildEnvelope` (:147) and `envForShell` (:156-190).
- Modify `ui/server.mjs`:
  - `resolvePrPipeline` (:9033);
  - `createRunPr` (:9177);
  - `/api/pipelines/:id/report-issue` (:18445);
  - the project-text import.
- Modify: `test/spawn-args.test.mjs`: one forwarding test (POSIX shim, like its neighbours).
- Test: `test/workflow-test-try-guard.test.mjs`, `test/api-workflow-test-guard-routes.test.mjs`

**Interfaces:**
- Produces (`try-guard.mjs`):
  - `NOT_SENT_TEXT = 'Not sent: this is a test.'`, `TRY_GUARD_LOG_ENV = 'WORCA_TRY_GUARD_LOG'`
  - `FORGE_CLIS = { gh: 'GitHub CLI', glab: 'GitLab CLI', az: 'Azure CLI' }`
  - `shellSegments(command) → string[][]`
  - `guardDecision(command) → null | { server, tool, argv, readOnly }`
  - `guardEntry(decision, command) → { ts, server, tool, arguments: { command, argv }, readOnly, guard: true }`
  - `guardReason(decision) → string`
  - the CLI. As a hook: stdin is the PreToolUse payload; it exits 2 (deny) with the reason on stderr. As a stand-in: `--stand-in <gh|glab|az> …args`; it exits 1 with `NOT_SENT_TEXT`.
- Produces (`try-guard-env.mjs`):
  - `TRY_GUARD_PATH`, `STAND_INS`, `TRY_DENY`
  - `standInDir(home)`, `standInFiles(name)`, `ensureStandIns(home)`
  - `withTryGuardEnv(env, tryGuard, { home, platform }) → env` (`tryGuard = { logFile } | null`)
  - `tryGuardHookEntry() → { matcher: 'Bash', hooks: [...] }`
  - `withTryDeny(rules) → rules`
- Produces (`guard-calls.mjs`): `guardCall(entry, { forgeOf }) → { guard: true, server, tool, noun, preview, cap, full, cmd, to: null }`. `forgeOf(remoteName)` returns a forge's display name or null.
- Produces (spawn path): the node context's `tryGuard: { logFile }` → `runOpts` → `runClaude` → `runClaudeProcess` → `buildSettingsPayload(rules, { tryGuard })` and `composeSpawnEnv({ tryGuard })`. The script envelope's `ctx.test.guard`.
- Produces (server): `TRY_NEVER_SHIPS_TEXT = 'A test try stays in Worca: it is never pushed and gets no pull request or issue.'` (409).
- Produces (`connectors.mjs`): `sentCall(e, { forgeOf })` returns `guardCall(e, …)` for a guard entry; `wouldHaveSent(pipelineId, { forgeOf } = {})`.

- [ ] **Step 1: Write the failing guard test.** Create `test/workflow-test-try-guard.test.mjs`:

```js
// test/workflow-test-try-guard.test.mjs — workflow tests 3a, Task 5 (D45, D56): nothing leaves a try. The hook denies and
// records a push, a forge CLI, a remote change, a publish and a web call that writes; the stand-ins answer "Not sent"; the
// git env cannot sign in; and every normal spawn stays byte-identical.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync, execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { guardDecision, NOT_SENT_TEXT, TRY_GUARD_LOG_ENV } from '../src/core/workflow-tests/try-guard.mjs';
import { TRY_GUARD_PATH, TRY_DENY, standInDir, withTryGuardEnv, withTryDeny, tryGuardHookEntry } from '../src/core/workflow-tests/try-guard-env.mjs';
import { guardCall } from '../src/core/workflow-tests/guard-calls.mjs';
import { NOT_SENT } from '../src/core/mcp/mock-connector.mjs';
import { shellArgv } from '../src/core/actions/spawn.mjs';
import { buildSettingsPayload } from '../src/core/engines/claude.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { envForShell, buildEnvelope } from '../src/core/graph/script-runner.mjs';

let home;
const readLog = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
before(() => { home = mkdtempSync(join(tmpdir(), 'worca-cc-wftguard-')); _resetForTests(); process.env.WORCA_HOME = home; });
after(() => { _resetForTests(); delete process.env.WORCA_HOME; rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('what the hook stops, and what it lets through', () => {
  const hit = (c) => { const d = guardDecision(c); return d ? `${d.server}|${d.tool}|${d.readOnly}` : null; };
  assert.equal(hit('git push origin fix-482'), 'git|push|false');
  assert.equal(hit('git -C repo -c a=b push'), 'git|push|false');
  assert.equal(hit('cd x && FOO=1 git push'), 'git|push|false');
  assert.equal(hit('sh -c "git push origin main"'), 'git|push|false');
  assert.equal(hit('echo $(git push)'), 'git|push|false');
  assert.equal(hit('git remote add up https://example.com/x.git'), 'git|remote add|false');
  assert.equal(hit('gh pr create --title "Fix rounding" --base main'), 'GitHub CLI|pr create|false');
  assert.equal(hit('gh pr view 12'), 'GitHub CLI|pr view|true');
  assert.equal(hit('gh issue comment 482 --body "Fixed"'), 'GitHub CLI|issue comment|false');
  assert.equal(hit('glab mr create'), 'GitLab CLI|mr create|false');
  assert.equal(hit('az repos pr create --title T'), 'Azure CLI|repos pr|false');
  assert.equal(hit('npm publish'), 'npm|publish|false');
  assert.equal(hit('curl -X POST https://api.example.com/x'), 'web|request|false');
  assert.equal(hit('curl -d a=1 https://api.example.com/x'), 'web|request|false');
  assert.equal(hit('wget --post-data=a https://example.com'), 'web|request|false');
  for (const ok of ['git status', 'git commit -m "push it"', 'echo "git push"', 'npm test', 'npm ci', 'curl https://example.com', 'node test.mjs']) {
    assert.equal(guardDecision(ok), null, ok);
  }
  assert.equal(NOT_SENT_TEXT, NOT_SENT, 'the same words as the connector stand-ins');
});

test('the hook CLI denies and records; anything else passes; a malformed payload passes', () => {
  const log = join(home, 'calls-hook.ndjson');
  const env = { ...process.env, [TRY_GUARD_LOG_ENV]: log };
  const run = (payload) => spawnSync(process.execPath, [TRY_GUARD_PATH], { input: payload, env, encoding: 'utf8' });
  const denied = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin fix-482' } }));
  assert.equal(denied.status, 2);
  assert.ok(denied.stderr.startsWith(NOT_SENT_TEXT), denied.stderr);
  const [entry] = readLog(log);
  assert.deepEqual([entry.server, entry.tool, entry.guard, entry.readOnly, entry.arguments.command], ['git', 'push', true, false, 'git push origin fix-482']);
  assert.deepEqual(entry.arguments.argv, ['origin', 'fix-482']);
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } })).status, 0);
  assert.equal(run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } })).status, 0);
  assert.equal(run('not json').status, 0);
  assert.equal(readLog(log).length, 1);
});

test('the stand-ins come first on PATH, answer "Not sent" and are recorded (gh pr create)', () => {
  const log = join(home, 'calls-stand-in.ndjson');
  const env = withTryGuardEnv({ ...process.env }, { logFile: log }, { home });
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  assert.equal(keys.length, 1, 'one PATH key, the env\'s own spelling');
  assert.ok(env[keys[0]].startsWith(standInDir(home)));
  const line = 'gh pr create --title "Fix rounding" --body "Totals round half up." --base main --head fix-482';
  const { file, args, verbatim } = shellArgv(line, process.platform, env);
  const r = spawnSync(file, args, { env, encoding: 'utf8', windowsVerbatimArguments: verbatim });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not sent: this is a test\./);
  const [e] = readLog(log);
  assert.deepEqual([e.server, e.tool, e.guard], ['GitHub CLI', 'pr create', true]);
  const row = guardCall(e);
  assert.deepEqual([row.tool, row.noun, row.preview, row.cap], ['open a pull request', 'pull request', 'Open a pull request: Fix rounding', 'Full text · from fix-482 into main']);
  assert.equal(row.full, 'Title: Fix rounding\nTotals round half up.');
});

test('git in a try cannot sign in: the credential helper is reset, ssh fails fast, nothing is asked', async () => {
  // The control's own helper answers u/p. Any helper of the machine (Git Credential Manager on this laptop) is reset first,
  // so no sign-in window can open in a test.
  const env0 = { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '!f() { echo username=u; echo password=p; }; f' };
  const env = withTryGuardEnv(env0, { logFile: join(home, 'calls-git.ndjson') }, { home });
  const helpers = execFileSync('git', ['config', '--get-all', 'credential.helper'], { env, encoding: 'utf8' }).split(/
?
/);
  assert.equal(helpers[helpers.length - 2], '', 'the last entry resets the list');
  const repo = mkdtempSync(join(tmpdir(), 'worca-cc-wftguard-repo-'));
  // Async on purpose: a spawnSync would block this process, and with it the test's own HTTP server.
  const gitAsync = (args, e) => new Promise((done) => execFile('git', args, { cwd: repo, env: e, timeout: 30000 },
    (err, _out, stderr) => done({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stderr: String(stderr) })));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: repo });
    assert.notEqual((await gitAsync(['push', 'ssh://git@127.0.0.1:1/x.git', 'HEAD'], env)).status, 0, 'ssh fails at once');
    let withAuth = 0;
    const srv = http.createServer((req, res) => {
      if (req.headers.authorization) withAuth += 1;
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); res.end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/x.git`;
    try {
      assert.notEqual((await gitAsync(['push', url, 'HEAD'], env)).status, 0);
      assert.equal(withAuth, 0, 'the guarded push sent no credentials');
      await gitAsync(['push', url, 'HEAD'], env0);
      assert.ok(withAuth > 0, 'control: without the guard the helper's credentials are sent');
    } finally { await new Promise((r) => srv.close(r)); }
  } finally { rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});

test('the try settings: the hook beside the host guard, the deny list added; without tryGuard byte-identical', () => {
  const rules = { deny: ['Read(.env*)'] };
  assert.deepEqual(buildSettingsPayload(rules, { hostGuard: true }), buildSettingsPayload(rules, { hostGuard: true, tryGuard: null }));
  const p = buildSettingsPayload(rules, { hostGuard: true, tryGuard: { logFile: join(home, 'c.ndjson') } });
  const cmds = p.settings.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(cmds.some((c) => c.includes('try-guard.mjs')), JSON.stringify(cmds));
  assert.ok(cmds.some((c) => c.includes('host-guard.mjs')));
  assert.deepEqual(p.settings.permissions.deny, [...new Set(['Read(.env*)', ...TRY_DENY])]);
  assert.deepEqual(withTryDeny(null).deny, [...TRY_DENY]);
  assert.equal(tryGuardHookEntry().matcher, 'Bash');
});

test('the spawn env and the run options: the guard only for a try', () => {
  assert.deepEqual(composeSpawnEnv({}).env, composeSpawnEnv({ tryGuard: null }).env);
  const env = composeSpawnEnv({ tryGuard: { logFile: join(home, 'c.ndjson') } }).env;
  assert.equal(env[TRY_GUARD_LOG_ENV], join(home, 'c.ndjson'));
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  const base = { claudeOpts: {}, projectDir: home };
  assert.equal('tryGuard' in runOpts(base, { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: [] }), false);
  assert.deepEqual(runOpts({ ...base, tryGuard: { logFile: 'x' } }, { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: [] }).tryGuard, { logFile: 'x' });
});

test('a script step of a try gets the guard env; any other script step does not', () => {
  const ctx = { executionId: 'e1', projectDir: home, pipelineDir: home, pipelineId: 'abcd1234', claudeOpts: {} };
  const node = { id: 'n1', key: 's1' };
  const script = { meta: {}, params: {} };
  const plain = envForShell(buildEnvelope({ ...ctx, node, script }));
  assert.equal(plain[TRY_GUARD_LOG_ENV], undefined);
  const tried = envForShell(buildEnvelope({ ...ctx, node, script, testConnectors: 'pretend', tryGuard: { logFile: join(home, 's.ndjson') } }));
  assert.equal(tried[TRY_GUARD_LOG_ENV], join(home, 's.ndjson'));
  assert.equal(tried.WORCA_TEST, '1');
});
```

`buildEnvelope(ctx)` reads `ctx.node` and `ctx.script` (script-runner.mjs:94-150). If its signature differs, read :94-110 and pass what it needs: the node, the script and the inputs/outputs maps it expects (empty ones are fine).

- [ ] **Step 2: Write the failing route test.** Create `test/api-workflow-test-guard-routes.test.mjs`:

```js
// test/api-workflow-test-guard-routes.test.mjs — workflow tests 3a (D45): a test try never ships. Every push, pull request,
// publish and issue route answers 409 for its run; a normal run is not refused for that reason.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

useTempHome(after);
const TEXT = 'A test try stays in Worca: it is never pushed and gets no pull request or issue.';
let homeDir, prevHome, srv, base, project, tryId, normalId;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftship-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  project = templateRepo('wftship', { branch: 'main', user: true, files: { 'README.md': '# s\n' } });
  const { createPipeline, writeState } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const now = new Date().toISOString();
  const seed = async (isTest) => {
    const { id, dir } = await createPipeline(project, { prompt: 'p', title: isTest ? 'Test: x · try 1' : 'normal', isTest });
    await writeState(dir, { projectKey: projectKey(project), id, status: 'done', startedAt: now, updatedAt: now, steps: [],
      branch: { source: 'main', feature: `worca-cc/x-${id}`, baseSha: 'a'.repeat(40) } });
    return id;
  };
  tryId = await seed(true);
  normalId = await seed(false);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, project]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('push, pull request, publish and issue: 409 for a test try', async () => {
  for (const [path, body] of [
    ['/api/pr', { id: tryId, projectDir: project, title: 'x' }],
    [`/api/runs/${tryId}/publish`, { projectDir: project }],
    ['/api/push', { id: tryId, projectDir: project }],
    ['/api/pr/describe', { id: tryId, projectDir: project }],
    [`/api/pipelines/${tryId}/report-issue`, {}],
  ]) {
    const r = await post(path, body);
    assert.equal(r.status, 409, path);
    assert.equal((await r.json()).error, TEXT, path);
  }
  const remotes = await fetch(`${base}/api/pr/remotes?id=${tryId}&projectDir=${encodeURIComponent(project)}`);
  assert.equal(remotes.status, 409);
});

test('a normal run is not refused for that reason', async () => {
  for (const [path, body] of [['/api/pr', { id: normalId, projectDir: project, title: 'x' }], ['/api/push', { id: normalId, projectDir: project }]]) {
    const r = await post(path, body);
    const j = await r.json();
    assert.notEqual(j.error, TEXT, path);
  }
});
```

`writeState`'s `branch` field reaches `pipelines.branch` the way Part 2's isolation test seeds a row (`test/workflow-test-isolation.test.mjs` `seed`). If `readPipeline` needs more state to answer, copy what `test/api-pr*.test.mjs` seeds (`Get-ChildItem test\api-pr*.test.mjs`).

- [ ] **Step 3: Run both to verify they fail**

Run: `node tools/test.mjs test/workflow-test-try-guard.test.mjs test/api-workflow-test-guard-routes.test.mjs`
Expected: FAIL. The first fails with `Cannot find module '…/try-guard.mjs'`. The second fails because `/api/pr` answers something other than 409.

- [ ] **Step 4: Create `src/core/workflow-tests/try-guard.mjs`**

```js
// src/core/workflow-tests/try-guard.mjs
// Nothing leaves a test try (plans/workflow-tests-part3a-plan.md D45, D56). This file is three things:
//   - guardDecision(command): whether a shell command would push, open a pull request or an issue, change a remote,
//     publish a package or send a web request that writes; pure;
//   - the PreToolUse Bash hook every try's agents carry (engines/claude.mjs buildSettingsPayload): a hit is written to the
//     try's connector-calls.ndjson (WORCA_TRY_GUARD_LOG) and denied with exit 2;
//   - the CLI behind the gh / glab / az stand-ins on a try's PATH (try-guard-env.mjs): it writes the call down and answers
//     "Not sent: this is a test." with exit 1.
// Only node: built-ins: the hook runs on every Bash call of every try.
import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NOT_SENT_TEXT = 'Not sent: this is a test.';   // = mcp/mock-connector.mjs NOT_SENT (the test pins them equal)
export const TRY_GUARD_LOG_ENV = 'WORCA_TRY_GUARD_LOG';
export const FORGE_CLIS = Object.freeze({ gh: 'GitHub CLI', glab: 'GitLab CLI', az: 'Azure CLI' });
const READ_VERBS = new Set(['view', 'list', 'status', 'diff', 'checks', 'show']);
const SKIP = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nohup', 'builtin', 'xargs', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const GIT_OPT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const PUBLISHERS = new Set(['npm', 'yarn', 'pnpm']);
const SPLIT = new Set([';', '&', '|', '\n', '\r', '(', ')', '`']);
const WRITE_METHOD_RE = /^(post|put|patch|delete)$/i;

/** The words of each command in a shell line: split at ; & | ( ) ` and newlines outside quotes; quotes removed. */
export function shellSegments(command) {
  const out = [];
  let words = [];
  let cur = '';
  let has = false;
  let quote = null;
  const endWord = () => { if (has) words.push(cur); cur = ''; has = false; };
  const endSeg = () => { endWord(); if (words.length) out.push(words); words = []; };
  const s = String(command ?? '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (SPLIT.has(ch)) { endSeg(); continue; }
    if (/\s/.test(ch)) { endWord(); continue; }
    cur += ch;
    has = true;
  }
  endSeg();
  return out;
}

const bin = (w) => basename(String(w)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
const nonOptions = (args) => args.filter((a) => !String(a).startsWith('-'));
/** "pr create", "issue comment", "repos pr", …: a forge CLI's first two words. */
export const cliTool = (args) => nonOptions(args).slice(0, 2).join(' ');

function gitDecision(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_OPT_VALUE.has(args[i]) ? 2 : 1;
  const sub = args[i];
  if (sub === 'push') return { server: 'git', tool: 'push', argv: args.slice(i + 1) };
  if (sub === 'send-email') return { server: 'git', tool: 'send-email', argv: args.slice(i + 1) };
  if (sub === 'remote' && (args[i + 1] === 'add' || args[i + 1] === 'set-url')) return { server: 'git', tool: `remote ${args[i + 1]}`, argv: args.slice(i + 2) };
  return null;
}

function curlWrites(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-X' || a === '--request') { if (WRITE_METHOD_RE.test(args[i + 1] || '')) return true; continue; }
    if (/^-X./.test(a) && WRITE_METHOD_RE.test(a.slice(2))) return true;
    if (a.startsWith('--request=') && WRITE_METHOD_RE.test(a.slice(10))) return true;
    if (/^-[dFT]/.test(a) || /^--(data|form|json|upload-file)/.test(a)) return true;
  }
  return false;
}
const wgetWrites = (args) => args.some((a) => /^--(post-data|post-file|body-data|body-file)/.test(a)
  || (a.startsWith('--method=') && WRITE_METHOD_RE.test(a.slice(9))));

/** @returns {null | {server: string, tool: string, argv: string[], readOnly: boolean}} */
export function guardDecision(command, depth = 0) {
  for (const words of shellSegments(command)) {
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || SKIP.has(words[i]))) i += 1;
    const w = words.slice(i);
    if (!w.length) continue;
    const b = bin(w[0]);
    const args = w.slice(1);
    if (SHELLS.has(b)) {
      const c = args.indexOf('-c');
      if (c >= 0 && args[c + 1] != null && depth < 3) { const d = guardDecision(args[c + 1], depth + 1); if (d) return d; }
      continue;
    }
    if (b === 'git') { const d = gitDecision(args); if (d) return { ...d, readOnly: false }; continue; }
    if (FORGE_CLIS[b]) return { server: FORGE_CLIS[b], tool: cliTool(args), argv: args, readOnly: READ_VERBS.has(nonOptions(args)[1] || '') };
    if (PUBLISHERS.has(b) && nonOptions(args)[0] === 'publish') return { server: b, tool: 'publish', argv: args, readOnly: false };
    if ((b === 'curl' && curlWrites(args)) || (b === 'wget' && wgetWrites(args))) return { server: 'web', tool: 'request', argv: args, readOnly: false };
  }
  return null;
}

/** One attempt, as connector-calls.ndjson holds a call ({ts, server, tool, arguments, readOnly}), marked `guard`. */
export function guardEntry(d, command, ts = new Date().toISOString()) {
  return { ts, server: d.server, tool: d.tool,
    arguments: { command: String(command).slice(0, 4000), argv: (d.argv || []).slice(0, 60).map((a) => String(a).slice(0, 2000)) },
    readOnly: !!d.readOnly, guard: true };
}

/** What the agent is told. It starts with the stand-ins' words, so an agent sees the same answer either way. */
export const guardReason = (d) => `${NOT_SENT_TEXT} Worca stopped this ${d.server === 'web' ? 'web request' : `${d.server} ${d.tool}`.trim()}: a test try never sends anything outside Worca.`;

function record(entry) {
  const file = process.env[TRY_GUARD_LOG_ENV];
  if (!file) return;
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify(entry)}\n`); } catch { /* the deny still holds */ }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--stand-in') {
    const name = String(argv[1] || '');
    const args = argv.slice(2);
    record(guardEntry({ server: FORGE_CLIS[name] || name, tool: cliTool(args), argv: args, readOnly: READ_VERBS.has(nonOptions(args)[1] || '') },
      [name, ...args].join(' ')));
    process.stderr.write(`${NOT_SENT_TEXT}\n`);
    process.exit(1);
  }
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let command = '';
    try {
      const payload = JSON.parse(raw);
      if (payload?.tool_name !== 'Bash') process.exit(0);
      command = String(payload?.tool_input?.command ?? '');
    } catch { process.exit(0); }   // a malformed payload must not brick Bash; the env layers still hold
    const d = guardDecision(command);
    if (!d) process.exit(0);
    record(guardEntry(d, command));
    process.stderr.write(`${guardReason(d)}\n`);
    process.exit(2);
  });
}
```

- [ ] **Step 5: Create `src/core/workflow-tests/try-guard-env.mjs`**

```js
// src/core/workflow-tests/try-guard-env.mjs — a test try's outward guard in its environment and settings (D56): the gh /
// glab / az stand-ins first on PATH, git that cannot sign in, forge CLIs with no sign-in of their own, the PreToolUse hook
// and the deny list. Every function returns its input unchanged without a guard, so every other spawn is byte-identical.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from '../projects.mjs';
import { TRY_GUARD_LOG_ENV } from './try-guard.mjs';

export const TRY_GUARD_PATH = fileURLToPath(new URL('./try-guard.mjs', import.meta.url));
export const STAND_INS = Object.freeze(['gh', 'glab', 'az']);
/** D56: the permission rules a try adds (guardrails.mjs NORMAL_DENY's push and publish pairs, plus the forge CLIs). */
export const TRY_DENY = Object.freeze([
  'Bash(git push)', 'Bash(git push:*)', 'Bash(git remote add:*)', 'Bash(git remote set-url:*)',
  'Bash(gh)', 'Bash(gh:*)', 'Bash(glab)', 'Bash(glab:*)', 'Bash(az)', 'Bash(az:*)',
  'Bash(npm publish)', 'Bash(npm publish:*)', 'Bash(yarn publish)', 'Bash(yarn publish:*)', 'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
]);
// Forward slashes, as host-guard.mjs:38-47 does: JSON would double each backslash, and both shells accept them.
const fwd = (s) => String(s).replaceAll('\\', '/');
export const standInDir = (home = worcaHome()) => join(home, 'workflow-tests', 'bin');
const noAuthDir = (home, name) => join(home, 'workflow-tests', 'no-auth', name);

/** A stand-in for Git Bash and sh (no extension) and its cmd.exe twin (.cmd, CRLF). */
export function standInFiles(name, { node = process.execPath, script = TRY_GUARD_PATH } = {}) {
  return {
    sh: `#!/bin/sh\nexec "${fwd(node)}" "${fwd(script)}" --stand-in ${name} "$@"\n`,
    cmd: `@echo off\r\n"${node}" "${script}" --stand-in ${name} %*\r\nexit /b %ERRORLEVEL%\r\n`,
  };
}

function writeIfChanged(file, text, mode = null) {
  let same = false;
  try { same = readFileSync(file, 'utf8') === text; } catch { /* missing: write it */ }
  if (!same) writeFileSync(file, text);
  if (mode != null) { try { chmodSync(file, mode); } catch { /* Windows has no exec bit */ } }
}

/** The stand-in folder, refreshed only when a file differs. Never throws: without it, the hook and the git env still hold. */
export function ensureStandIns(home = worcaHome()) {
  const dir = standInDir(home);
  try {
    mkdirSync(dir, { recursive: true });
    for (const name of STAND_INS) {
      const f = standInFiles(name);
      writeIfChanged(join(dir, name), f.sh, 0o755);
      writeIfChanged(join(dir, `${name}.cmd`), f.cmd);
      mkdirSync(noAuthDir(home, name), { recursive: true });
    }
  } catch { /* an unwritable home */ }
  return dir;
}

const pathKeyOf = (env) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';

/**
 * `env` with a try's outward guard (D56). `tryGuard` null returns `env` itself.
 * - PATH: the stand-ins first, written to the env's own key (`Path` on Windows); any other spelling of PATH is dropped.
 * - git: no terminal prompt, Git Credential Manager never interactive, ssh fails at once, every credential helper reset.
 * - gh / glab / az found some other way (a script's spawn('gh') skips .cmd on Windows): empty config, so no sign-in.
 * Stated limit: a web call with a token typed into the command can still go out (no network block yet).
 */
export function withTryGuardEnv(env, tryGuard, { home = worcaHome(), platform = process.platform } = {}) {
  if (!tryGuard) return env;
  const out = { ...(env ?? process.env) };
  const key = pathKeyOf(out);
  const dir = ensureStandIns(home);
  const sep = platform === 'win32' ? ';' : ':';
  const cur = out[key] || '';
  out[key] = cur.split(sep).includes(dir) ? cur : cur ? `${dir}${sep}${cur}` : dir;
  for (const k of Object.keys(out)) if (k !== key && k.toUpperCase() === 'PATH') delete out[k];
  out[TRY_GUARD_LOG_ENV] = tryGuard.logFile;
  out.GIT_TERMINAL_PROMPT = '0';
  out.GCM_INTERACTIVE = 'never';
  out.GIT_SSH_COMMAND = 'exit 1 #';
  out.GH_CONFIG_DIR = noAuthDir(home, 'gh');
  out.GLAB_CONFIG_DIR = noAuthDir(home, 'glab');
  out.AZURE_CONFIG_DIR = noAuthDir(home, 'az');
  const n = Number.parseInt(out.GIT_CONFIG_COUNT || '0', 10) || 0;   // appended: an empty helper resets the list before it
  out[`GIT_CONFIG_KEY_${n}`] = 'credential.helper';
  out[`GIT_CONFIG_VALUE_${n}`] = '';
  out.GIT_CONFIG_COUNT = String(n + 1);
  return out;
}

/** The PreToolUse hook entry buildSettingsPayload adds for a try, beside the host guard. */
export function tryGuardHookEntry() {
  const q = (s) => JSON.stringify(fwd(s));
  return { matcher: 'Bash', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(TRY_GUARD_PATH)}` }] };
}

/** Permission rules with the try's deny list added. */
export function withTryDeny(rules) {
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  return { ...r, deny: [...new Set([...(Array.isArray(r.deny) ? r.deny : []), ...TRY_DENY])] };
}
```

In `src/core/workflow-tests/shell-step.mjs`, import `withTryGuardEnv` from `./try-guard-env.mjs` and change `tryShellEnv` to:
```js
/** What a project try's setup and command checks start from: the action env (no host credential, no Worca home),
 *  WORCA_TEST=1, and the outward guard writing to the try's connector-calls.ndjson (D56). */
export function tryShellEnv({ logFile = null } = {}) {
  return withTryGuardEnv({ ...actionBaseEnv(), WORCA_TEST: '1' }, logFile ? { logFile } : null);
}
```

- [ ] **Step 6: Board 37's rows.** Create `src/core/workflow-tests/guard-calls.mjs`:

```js
// src/core/workflow-tests/guard-calls.mjs — board 37 (D68): what a try tried to send that the outward guard stopped. One row
// per attempt, in connectors.mjs sentCall's shape (server, tool, noun, preview, full) plus `guard`, the caption of its full
// text and the command itself. `forgeOf(remote)` names the forge of the real project's remote (P9), or null.
const VALUE_OPTS = new Set(['--title', '-t', '--body', '-b', '--base', '-B', '--head', '-H', '--repo', '-R', '--label', '-l',
  '--assignee', '-a', '--reviewer', '-r', '--milestone', '-m', '--body-file', '-F', '--description', '-d', '--target-branch',
  '--source-branch', '--push-option', '-o']);
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
function opt(argv, ...names) {
  for (let i = 0; i < argv.length; i += 1) {
    for (const n of names) {
      if (argv[i] === n) return argv[i + 1] ?? null;
      if (argv[i].startsWith(`${n}=`)) return argv[i].slice(n.length + 1);
    }
  }
  return null;
}
function positional(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('-')) { if (!a.includes('=') && VALUE_OPTS.has(a)) i += 1; continue; }
    out.push(a);
  }
  return out;
}
const STOPPED = 'Not sent · stopped by Worca';

export function guardCall(e, { forgeOf = () => null } = {}) {
  const argv = Array.isArray(e && e.arguments && e.arguments.argv) ? e.arguments.argv.map(String) : [];
  const cmd = String((e && e.arguments && e.arguments.command) || '');
  const server = String((e && e.server) || '');
  const tool = String((e && e.tool) || '');
  const row = (fields) => ({ guard: true, server, cmd, to: null, ...fields });
  const pos = positional(argv);
  if (server === 'git' && tool === 'push') {
    const remote = pos[0] || null;
    const branch = pos.length > 1 ? pos[pos.length - 1].replace(/^\+/, '').split(':').pop() : null;
    const forge = remote ? forgeOf(remote) : null;
    const where = branch ? `the branch ${branch}` : 'its branch';
    return row({ tool: 'push', noun: 'push', preview: `Send the changes to ${where}`, cap: STOPPED,
      full: `This try tried to send its changes to ${where}${forge ? ` on ${forge}` : ''}.` });
  }
  const sub = pos.slice(0, 2).join(' ');
  const mr = server === 'GitLab CLI' && sub === 'mr create';
  if ((server === 'GitHub CLI' && sub === 'pr create') || mr || (server === 'Azure CLI' && pos.slice(0, 3).join(' ') === 'repos pr create')) {
    const title = opt(argv, '--title', '-t') || '';
    const body = opt(argv, '--body', '-b', '--description', '-d') || '';
    const head = opt(argv, '--head', '-H', '--source-branch');
    const into = opt(argv, '--base', '-B', '--target-branch');
    const what = mr ? 'merge request' : 'pull request';
    return row({ tool: `open a ${what}`, noun: what, preview: `Open a ${what}: ${clip(title, 80)}`,
      cap: head && into ? `Full text · from ${head} into ${into}` : 'Full text', full: `Title: ${title}${body ? `\n${body}` : ''}` });
  }
  if (server === 'GitHub CLI' && sub === 'issue comment') {
    const n = pos[2] || '';
    const body = opt(argv, '--body', '-b') || '';
    return row({ tool: 'comment on an issue', noun: 'issue comment', preview: `on issue ${n}: "${clip(body, 40)}"`, cap: `Full text · on issue ${n}`, full: body });
  }
  if ((server === 'GitHub CLI' || server === 'GitLab CLI') && sub === 'issue create') {
    const title = opt(argv, '--title', '-t') || '';
    const body = opt(argv, '--body', '-b', '--description', '-d') || '';
    return row({ tool: 'open an issue', noun: 'issue', preview: `Open an issue: ${clip(title, 80)}`, cap: 'Full text', full: `Title: ${title}${body ? `\n${body}` : ''}` });
  }
  if (server === 'git' && tool.startsWith('remote ')) return row({ tool: 'change a remote', noun: 'remote change', preview: clip(cmd, 80), cap: STOPPED, full: cmd });
  if (['npm', 'yarn', 'pnpm'].includes(server)) return row({ tool: 'publish a package', noun: 'package', preview: clip(cmd, 80), cap: STOPPED, full: cmd });
  if (server === 'web') {
    const url = argv.find((a) => /^https?:\/\//i.test(a)) || '';
    return row({ tool: 'send a web request', noun: 'web request', preview: clip(url || cmd, 80), cap: STOPPED, full: cmd });
  }
  return row({ tool: tool || 'call', noun: 'call', preview: clip(cmd, 80), cap: STOPPED, full: cmd });
}
```

In `src/core/workflow-tests/connectors.mjs`, import `guardCall` from `./guard-calls.mjs`. Change `sentCall`'s first line to `export function sentCall(e, { forgeOf } = {}) {` and add as its first statement:
```js
  if (e && e.guard === true) return guardCall(e, { forgeOf });   // 3a D68: what the outward guard stopped
```
Change `wouldHaveSent` to take `(pipelineId, { forgeOf } = {})` and call `sent.push(sentCall(e, { forgeOf }));`.

- [ ] **Step 7: The spawn path**

`src/core/run-harness.mjs`: after `_testConnectors()`, add:
```js
  /** Workflow tests 3a (D56): every try's outward guard writes to its connector-calls.ndjson; null for every other run. */
  _tryGuard() {
    if (this.opts.workflowTest !== true || !this.pipeline?.dir) return null;
    return { logFile: join(this.pipeline.dir, CONNECTOR_CALLS_FILE) };
  }
```

`src/core/orchestrator.mjs` `_nodeCtx`: after the `testConnectors` spread (:1888), add:
```js
      // Workflow tests 3a (D56): nothing leaves a try: its spawns carry the hook and the guard env, its script steps the env.
      ...(this._tryGuard() ? { tryGuard: this._tryGuard() } : {}),
```

`src/core/phases.mjs` `runOpts`: after the `strictMcpConfig` spread, add:
```js
    // Workflow tests 3a (D56): a try's outward guard. Absent on every other spawn, so its argv and env stay byte-identical.
    ...(ctx.tryGuard ? { tryGuard: ctx.tryGuard } : {}),
```

`src/core/claude-runner.mjs` `runClaude` (the GATE): add `tryGuard,` to the destructure, after `strictMcpConfig,`. Add `tryGuard,` to the `engine.run({ … })` object, after its `strictMcpConfig,`. Add `@param {{logFile: string}} [o.tryGuard]  workflow tests 3a: a try's outward guard` to the JSDoc.

`src/core/engines/claude.mjs`:
- `import { tryGuardHookEntry, withTryDeny } from '../workflow-tests/try-guard-env.mjs';`
- `buildSettingsPayload(permissionRules, { hostGuard = false, extraSettings = null, memoryLoadLog = null, tryGuard = null } = {})`. Replace its body from `const hasRules = …` to the end with:
```js
  // Workflow tests 3a (D56): a try's outward guard: its PreToolUse hook beside the host guard, and its deny rules.
  const tg = tryGuard ? tryGuardHookEntry() : null;
  const rules = tg ? withTryDeny(permissionRules) : permissionRules;
  const hasRules = !!rules && Object.values(rules).some((a) => Array.isArray(a) && a.length);
  if (!hasRules && permissionRules && typeof permissionRules === 'object'
      && Object.values(permissionRules).some((a) => a != null && !Array.isArray(a))) {
    console.warn('[worca] guardrails: permissionRules is malformed (deny/allow/ask must be arrays of strings) — ignoring it; this spawn carries NO permission rules');
  }
  if (!hook && !hasRules && !guard && !extra && !usage && !tg) return null;
  const settings = { ...(extra ?? {}) };
  if (hook) settings.hooks = { ...hook.hooks };
  if (guard) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), guard];
  }
  if (tg) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), tg];
  }
  if (usage) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.InstructionsLoaded = [...(settings.hooks.InstructionsLoaded ?? []), usage];
  }
  if (hasRules) settings.permissions = rules;
  return { hook: !!hook, settings };
```
- `buildSettingsArgs(permissionRules, settingsFile = null, { hostGuard = false, extraSettings = null, memoryLoadLog = null, tryGuard = null } = {})` passes `tryGuard` to `buildSettingsPayload`.
- `buildClaudeArgs`: add `tryGuard` to the parameter list (after `memoryLoadLog`), and to the `buildSettingsArgs(…, { hostGuard, extraSettings, memoryLoadLog, tryGuard })` call (:356).
- `planClaudeInvocation` (:445): add `tryGuard: opts.tryGuard` to the `buildSettingsPayload` options.
- `runClaudeProcess`: add `tryGuard` to its destructure. Add `tryGuard,` to the `stageClaudeInvocation({ … })` object (next to `memoryLoadLog`). Add `tryGuard: tryGuard || null` to the `composeSpawnEnv({ … })` call.

`src/core/engines/spawn.mjs` `composeSpawnEnv`:
- `import { withTryGuardEnv } from '../workflow-tests/try-guard-env.mjs';`
- change the signature to `export function composeSpawnEnv({ envScrub, envAllowlist, prefixes, runEnv, overlay, hostPid, tryGuard = null } = {}) {`;
- right before `env = withNoGitPath(env);`, add:
```js
  // Workflow tests 3a (D56): a try's outward guard (PATH stand-ins, git that cannot sign in). Absent: byte-identical.
  if (tryGuard) env = withTryGuardEnv(env, tryGuard);
```

`src/core/graph/script-runner.mjs`:
- import `withTryGuardEnv` from `../workflow-tests/try-guard-env.mjs`;
- in `buildEnvelope`, change the `test` spread (:147) to:
```js
      ...(ctx.testConnectors === 'pretend' || ctx.testConnectors === 'real'
        ? { test: { connectors: ctx.testConnectors, ...(ctx.tryGuard ? { guard: ctx.tryGuard } : {}) } } : {}),
```
- in `envForShell`, replace `return env;` with:
```js
  // Workflow tests 3a (D56): a try's script step gets the outward guard too (stand-ins first on PATH, git with no sign-in).
  return c.test && c.test.guard ? withTryGuardEnv(env, c.test.guard) : env;
```

- [ ] **Step 8: The routes refuse a test row (`ui/server.mjs`)**

Add `import { TRY_NEVER_SHIPS_TEXT } from '../src/shared/workflow-tests/project-text.mjs';`. In `src/shared/workflow-tests/project-text.mjs`, add:
```js
// D45: the push, pull request, publish and issue routes' answer for a test try (409).
export const TRY_NEVER_SHIPS_TEXT = 'A test try stays in Worca: it is never pushed and gets no pull request or issue.';
```
In `resolvePrPipeline`, after `if (!state) { … return null; }` (:9033), add:
```js
  // Workflow tests 3a (D45): a test try never leaves Worca. Every push, pull request and publish route comes through here.
  if (isTestPipeline(state.id || id)) { res.status(409).json({ error: TRY_NEVER_SHIPS_TEXT }); return null; }
```
At the top of `createRunPr`'s body, add `if (isTestPipeline(id)) return { ok: false, status: 409, error: TRY_NEVER_SHIPS_TEXT };   // 3a D45: also from the ship flows`. At the top of the `/api/pipelines/:id/report-issue` handler's `try {`, add:
```js
    if (isTestPipeline(String(req.params.id || ''))) return res.status(409).json({ error: TRY_NEVER_SHIPS_TEXT });   // 3a D45
```

- [ ] **Step 9: The forwarding test (`test/spawn-args.test.mjs`)**

After the test "runClaude FORWARDS every argv field to runReal…", add (it skips on Windows like its neighbours; Task 9's free proof covers Windows with the real CLI):
```js
test('runClaude FORWARDS tryGuard to runReal: the try-guard hook reaches --settings (workflow tests 3a D56)', POSIX_SHIM, async () => {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', allowedTools: ['Bash'], tryGuard: { logFile: join(dir, 'calls.ndjson') } });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
  assert.ok(settings.hooks.PreToolUse.some((h) => h.hooks.some((x) => x.command.includes('try-guard.mjs'))));
  assert.ok(settings.permissions.deny.includes('Bash(git push:*)'));
});
```

- [ ] **Step 10: Run the tests**

Run: `node tools/test.mjs test/workflow-test-try-guard.test.mjs test/api-workflow-test-guard-routes.test.mjs test/spawn-args.test.mjs test/claude-mcpjson-guard.test.mjs test/workflow-test-connectors.test.mjs test/api-workflow-test-project-try.test.mjs test/host-guard.test.mjs`
Expected: PASS. The spawn-args tests that use the POSIX shim skip on Windows, as in the baseline. Use `Get-ChildItem test\host-guard*.test.mjs` for the host guard file's real name.

- [ ] **Step 11: Commit**

```bash
git add src/core/workflow-tests/try-guard.mjs src/core/workflow-tests/try-guard-env.mjs src/core/workflow-tests/guard-calls.mjs src/core/workflow-tests/shell-step.mjs src/core/workflow-tests/connectors.mjs src/shared/workflow-tests/project-text.mjs src/core/run-harness.mjs src/core/orchestrator.mjs src/core/phases.mjs src/core/claude-runner.mjs src/core/engines/claude.mjs src/core/engines/spawn.mjs src/core/graph/script-runner.mjs ui/server.mjs test/workflow-test-try-guard.test.mjs test/api-workflow-test-guard-routes.test.mjs test/spawn-args.test.mjs
git commit -m "Workflow tests 3a: nothing leaves a try (hook, stand-ins, git with no sign-in, 409 on push, PR and issue routes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: What a project try changed, and "The command passes" (D47, D57, D58, D59)

**Files:**
- Modify `src/shared/workflow-tests/checks.mjs`:
  - `CHECK_KINDS` (:6), `CHECK_KIND_LABELS` (:9-16), `normaliseCheck` (:150-199), `checkLabel` (:205-217), `runCheck` (:230-252);
  - new `PROJECT_FILE_KIND_LABEL`, `COMMAND_TIMEOUTS`, `commandSummary`.
- Modify `src/core/workflow-tests/result.mjs`:
  - `mainResult` (:61-81), `readTryOutcome` (:87-101), `runScriptCheck` (:115-154), `checkTry` (:162-177);
  - new `isProjectRow`, `projectChanges`, `projectOutcome`, `readCheckFile`, `runCommandCheck`.
- Test: `test/workflow-test-project-checks.test.mjs`

**Interfaces:**
- Consumes:
  - `PROJECT_KINDS` (checks.mjs, Task 2);
  - `runShellStep`, `tryShellEnv`, `readTrySetup` (Tasks 4, 5);
  - `CONNECTOR_CALLS_FILE` (connectors.mjs);
  - `RESULTS_FILE`, `DIFF_PATCH_FILE` (results.mjs).
- Produces (shared `checks.mjs`):
  - `CHECK_KINDS` gains `'command'`; `CHECK_KIND_LABELS.command = 'The command passes'`.
  - `PROJECT_FILE_KIND_LABEL = 'A file with this name is added or changed'`, `COMMAND_TIMEOUTS = [1, 5, 10, 30]`
  - The command check's shape is `{ id?, kind: 'command', cmd, timeoutMin }`. A text check gains an optional `file`.
  - `checkLabel`: `The command <cmd> passes`; a text check with a file gets ` in <file>`.
  - `commandSummary(text) → string`
- Produces (`result.mjs`):
  - `isProjectRow(row) → boolean` (a git try: its branch record has a `baseSha`)
  - `projectChanges(results, { max = 50 }) → { files, paths, total, counts: { added, changed, removed }, added, removed }`. `files` are `[{ status: 'added'|'changed'|'renamed'|'removed', path, from?, added, removed, binary? }]`, at most 50. `paths` are all paths that are not removed.
  - `readTryOutcome(…)` adds:
    - `project: null | { base, branch, files, paths, total, counts, added, removed, patchFile, checkoutDir, runRoot }`
    - `setup: null | try-setup.json`
    - `logFile`
  - `mainResult(pipelineId, { project } = {})`: a project try has no "largest file" fallback.
  - `readCheckFile(outcome, rel) → Promise<string|null>`
  - `runCommandCheck(check, { cwd, logFile, run }) → Promise<{ met, value, output }>`
  - `runScriptCheck(check, { pipelineId, cwdDir, … })`: with `cwdDir` it runs in that folder, without a copy.
  - `checkTry(example, outcome, { runScript, runCommand, readText, scriptName, onCommand })`: the pure checks first, then commands and scripts, in the example's order. A command result carries `output`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-project-checks.test.mjs`:

```js
// test/workflow-test-project-checks.test.mjs — workflow tests 3a, Task 6 (D47, D57, D58, D59): what a project try changed,
// the command check, and text checks that read a file of the project.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { normaliseCheck, checkLabel, commandSummary, CHECK_KIND_LABELS, PROJECT_FILE_KIND_LABEL } from '../src/shared/workflow-tests/checks.mjs';
import { projectChanges, checkTry, readCheckFile, runCommandCheck, isProjectRow } from '../src/core/workflow-tests/result.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const dirs = [];
let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'worca-cc-wftpchk-')); dirs.push(home); _resetForTests(); process.env.WORCA_HOME = home; });
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
const check = (raw) => normaliseCheck(raw).check;

test('the command check: its shape, its limits and its label (board 33)', () => {
  assert.deepEqual(check({ kind: 'command', cmd: '  npm test ' }), { kind: 'command', cmd: 'npm test', timeoutMin: 10 });
  assert.deepEqual(check({ kind: 'command', cmd: 'npm test', timeoutMin: '30' }), { kind: 'command', cmd: 'npm test', timeoutMin: 30 });
  assert.equal(normaliseCheck({ kind: 'command', cmd: '' }).error, 'write the command, such as npm test');
  assert.equal(normaliseCheck({ kind: 'command', cmd: 'a\nb' }).error, 'the command must fit on one line of up to 500 characters');
  assert.equal(normaliseCheck({ kind: 'command', cmd: 'npm test', timeoutMin: 7 }).error, 'the time limit must be 1, 5, 10 or 30 minutes');
  assert.equal(checkLabel(check({ kind: 'command', cmd: 'npm test' })), 'The command npm test passes');
  assert.equal(CHECK_KIND_LABELS.command, 'The command passes');
  assert.equal(PROJECT_FILE_KIND_LABEL, 'A file with this name is added or changed');
});

test('a text check can read a file; its label says which', () => {
  assert.deepEqual(check({ kind: 'sections', names: 'Fixed', file: 'CHANGELOG.md' }), { kind: 'sections', names: ['Fixed'], file: 'CHANGELOG.md' });
  assert.equal(checkLabel(check({ kind: 'sections', names: 'Fixed', file: 'CHANGELOG.md' })), 'Has the section Fixed in CHANGELOG.md');
  assert.equal(checkLabel(check({ kind: 'mentions', text: 'rounds', file: 'docs\\brief.md' })), 'Mentions "rounds" in docs/brief.md');
  assert.equal(checkLabel(check({ kind: 'words', max: 900, file: 'docs/brief.md' })), 'Length is at most 900 words in docs/brief.md');
  assert.deepEqual(check({ kind: 'mentions', text: 'x', file: '' }), { kind: 'mentions', text: 'x' }, 'no file: the Part 2 shape');
  for (const bad of ['../x', '/etc/passwd', 'C:/x']) {
    assert.equal(normaliseCheck({ kind: 'mentions', text: 'x', file: bad }).error, 'give a file inside the project, such as CHANGELOG.md', bad);
  }
});

test('an example with a project keeps its command check (Task 2 refuses it without one)', () => {
  const pin = { key: 'worca-cc-1a2b3c4d', startSha: 'a'.repeat(40), startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: 'a'.repeat(40), changes: null, setupCmd: null };
  const ex = store.createExample('wf_c', { name: 'x', request: 'r', checks: [{ kind: 'command', cmd: 'npm test' }] }, { project: pin });
  assert.deepEqual(ex.checks.map((c) => [c.kind, c.cmd, c.timeoutMin]), [['command', 'npm test', 10]]);
});

test('the summary line: node:test counts, a "passed" line, else the last line', () => {
  assert.equal(commandSummary('ok\nℹ tests 213\nℹ pass 213\nℹ fail 0\nℹ duration_ms 812'), '213 passed');
  assert.equal(commandSummary('ℹ pass 212\nℹ fail 1\nℹ duration_ms 812'), '212 passed, 1 failed');
  assert.equal(commandSummary('Tests: 1 failed, 212 passed, 213 total\nTime: 3 s'), 'Tests: 1 failed, 212 passed, 213 total');
  assert.equal(commandSummary('\u001b[32mall good\u001b[0m\n\n'), 'all good');
  assert.equal(commandSummary(''), '');
});

test('what changed: board 36\'s counts; a rename is a change; the paths a file check matches leave the removed out', () => {
  const c = projectChanges({ summary: { linesAdded: 22, linesRemoved: 31 },
    newFiles: [{ path: 'src/money.mjs', status: 'A', added: 20, removed: 0 }],
    changedFiles: [{ path: 'src/round.mjs', status: 'M', added: 2, removed: 1 }, { path: 'src/legacy-round.mjs', status: 'D', added: 0, removed: 30 },
      { path: 'test/new.test.mjs', status: 'R', from: 'test/old.test.mjs', added: 0, removed: 0 }] });
  assert.deepEqual(c.counts, { added: 1, changed: 2, removed: 1 });
  assert.deepEqual([c.total, c.added, c.removed], [4, 22, 31]);
  assert.deepEqual(c.files.map((f) => [f.status, f.path]), [['removed', 'src/legacy-round.mjs'], ['added', 'src/money.mjs'], ['changed', 'src/round.mjs'], ['renamed', 'test/new.test.mjs']]);
  assert.deepEqual(c.paths, ['src/money.mjs', 'src/round.mjs', 'test/new.test.mjs']);
  assert.equal(c.files.find((f) => f.status === 'renamed').from, 'test/old.test.mjs');
  assert.deepEqual(projectChanges(null), { files: [], paths: [], total: 0, counts: { added: 0, changed: 0, removed: 0 }, added: 0, removed: 0 });
  assert.equal(isProjectRow({ project_key: 'x-1a2b3c4d', branch: JSON.stringify({ baseSha: 'a'.repeat(40) }) }), true);
  assert.equal(isProjectRow({ project_key: 'x-1a2b3c4d', branch: null }), false, 'Part 2\'s seeded rows stay no-project');
});

/** A finished project try's outcome, as readTryOutcome builds it, on a real folder (no git needed for the checks). */
function outcome(dir, { status = 'done', files = ['src/feature.mjs'] } = {}) {
  return { pipelineId: null, facts: { status, costUsd: 0, durationMs: 1, sentBack: 0, help: [], failReason: null },
    name: null, text: 'Fixed the rounding.', source: 'end-value', files,
    project: { checkoutDir: dir, files: files.map((p) => ({ status: 'added', path: p, added: 1, removed: 0 })), paths: files },
    logFile: join(dir, '..', 'calls.ndjson') };
}

test('the command check runs in the checkout after the pure checks; its value and output are kept', { timeout: 60000 }, async () => {
  const dir = join(home, 'checkout');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## Fixed\n\nRounding.\n');
  writeFileSync(join(dir, 'pass.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('CHANGELOG.md', '# gone\\n'); console.log('ℹ pass 3'); console.log('ℹ fail 0');\n");
  writeFileSync(join(dir, 'fail.mjs'), "console.log('ℹ pass 2'); console.log('ℹ fail 1'); process.exit(1);\n");
  const example = { basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'command', cmd: 'node pass.mjs' }) },
    { id: 'c_2', ...check({ kind: 'sections', names: 'Fixed', file: 'CHANGELOG.md' }) },
    { id: 'c_3', ...check({ kind: 'file', name: 'feature.mjs' }) },
    { id: 'c_4', ...check({ kind: 'command', cmd: 'node fail.mjs' }) },
    { id: 'c_5', ...check({ kind: 'mentions', text: 'x', file: 'missing.md' }) },
  ] };
  const seen = [];
  const v = await checkTry(example, outcome(dir), { onCommand: (c) => seen.push(c) });
  assert.deepEqual(v.checks.map((c) => [c.label, c.met, c.value]), [
    ['The command node pass.mjs passes', true, '3 passed'],
    ['Has the section Fixed in CHANGELOG.md', true, 'Met'],
    ['Has a file named feature.mjs', true, 'Met'],
    ['The command node fail.mjs passes', false, '2 passed, 1 failed'],
    ['Mentions "x" in missing.md', false, 'No file named missing.md'],
  ], 'the sections check read CHANGELOG.md before the first command rewrote it');
  assert.match(v.checks[3].output, /fail 1/);
  assert.deepEqual(seen, ['node pass.mjs', 'node fail.mjs']);
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), '# gone\n', 'the commands did run, after the pure checks');
});

test('a try that did not finish runs no command; a checkout that is gone runs none either', async () => {
  const example = { basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', ...check({ kind: 'command', cmd: 'node x.mjs' }) }] };
  const stopped = await checkTry(example, outcome(home, { status: 'stopped' }));
  assert.equal(stopped.checks[0].value, 'Not run: the try did not finish');
  const gone = outcome(home);
  gone.project.checkoutDir = null;
  assert.equal((await checkTry(example, gone)).checks[0].value, 'Not run: the copy of the project is gone');
});

test('a time limit stops a command; a file outside the checkout is never read', async () => {
  const dir = join(home, 'slow');
  mkdirSync(dir, { recursive: true });
  const r = await runCommandCheck({ kind: 'command', cmd: 'node -e "setTimeout(() => {}, 60000)"', timeoutMin: 1 }, { cwd: dir, run: async (o) => ({ ok: false, exitCode: null, timedOut: true, ms: o.timeoutMs, tail: '' }) });
  assert.deepEqual([r.met, r.value], [false, 'Stopped after 1 minute']);
  assert.equal(await readCheckFile(outcome(dir), '../outside.md'), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-project-checks.test.mjs`
Expected: FAIL with `does not provide an export named 'commandSummary'`.

- [ ] **Step 3: The checks (`src/shared/workflow-tests/checks.mjs`)**

Change `CHECK_KINDS` to `Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'file', 'script', 'command'])`. Add `command: 'The command passes',` to `CHECK_KIND_LABELS`. After it, add:
```js
/** Board 33: the file check's name in an example with a project (D59: added, changed or renamed, never removed). */
export const PROJECT_FILE_KIND_LABEL = 'A file with this name is added or changed';
/** D57: "Stop the command after" (board 33), in minutes. */
export const COMMAND_TIMEOUTS = Object.freeze([1, 5, 10, 30]);
const CMD_MAX = 500;
```
After `cleanText`, add:
```js
const cleanPath = (v) => cleanText(v).replace(/\\/g, '/');
/** D58: a text check's optional file. {file: null} when none; {error} for a path outside the project. */
function fileOf(raw) {
  if (raw.file == null || String(raw.file).trim() === '') return { file: null };
  const p = cleanPath(raw.file);
  if (p.length > TEXT_MAX || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) {
    return { error: 'give a file inside the project, such as CHANGELOG.md' };
  }
  return { file: p };
}
```
In `normaliseCheck`, change `const done = …` to:
```js
  const done = (fields, file = null) => ({ check: { ...(id ? { id } : {}), kind, ...fields, ...(file ? { file } : {}) }, error: null });
  const f = TEXT_KINDS.includes(kind) ? fileOf(raw) : { file: null };
  if (f.error) return { check: null, error: f.error };
```
Then pass `f.file` as the second argument of `done` in the words, sections and mentions/not-mentions branches (`return done({ min, max }, f.file);` and so on). Before the script branch (`const key = …`), add:
```js
  if (kind === 'command') {
    const cmd = typeof raw.cmd === 'string' ? raw.cmd.trim() : '';
    if (!cmd) return { check: null, error: 'write the command, such as npm test' };
    if (cmd.length > CMD_MAX || /[\r\n]/.test(cmd)) return { check: null, error: `the command must fit on one line of up to ${CMD_MAX} characters` };
    const t = raw.timeoutMin === undefined || raw.timeoutMin === null || raw.timeoutMin === '' ? 10 : Number(raw.timeoutMin);
    if (!COMMAND_TIMEOUTS.includes(t)) return { check: null, error: 'the time limit must be 1, 5, 10 or 30 minutes' };
    return done({ cmd, timeoutMin: t });
  }
```
In `checkLabel`, add `const inFile = (s) => (c.file ? `${s} in ${c.file}` : s);`. Wrap the words, sections, mentions and not-mentions returns in `inFile(…)`, and add before `return 'Unknown check';`:
```js
  if (c.kind === 'command') return `The command ${c.cmd} passes`;
```
In `runCheck`, change the final throw to cover both kinds the server runs itself:
```js
  throw new Error(`runCheck: "${check.kind}" is not a built-in check`);   // script and command: result.mjs runs them
```
(It is already the fall-through, so only the comment changes.) Add `commandSummary` at the end of the file:
```js
/**
 * D57: the value of a command check (board 36: "213 passed", "212 passed, 1 failed"). node:test's and TAP's counts become
 * that sentence; otherwise the last line that counts passed or failed tests; otherwise the last line. Colours removed.
 */
export function commandSummary(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  const last = (re) => { for (let i = lines.length - 1; i >= 0; i -= 1) { const m = re.exec(lines[i]); if (m) return Number(m[1]); } return null; };
  const pass = last(/^(?:ℹ|#)\s*pass\s+(\d+)$/);
  const fail = last(/^(?:ℹ|#)\s*fail\s+(\d+)$/);
  if (pass !== null && fail !== null) return fail ? `${pass} passed, ${fail} failed` : `${pass} passed`;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/\b\d+\s+(?:passed|passing|failed|failing)\b/i.test(lines[i])) return lines[i].slice(0, 120);
  }
  return lines.length ? lines[lines.length - 1].slice(0, 120) : '';
}
```

- [ ] **Step 4: What a project try changed, and running its checks (`src/core/workflow-tests/result.mjs`)**

New imports: `existsSync` from `node:fs`; `readFile` from `node:fs/promises` (beside `lstat`); `worcaHome` from `../projects.mjs`; `RESULTS_FILE`, `DIFF_PATCH_FILE` from `../results.mjs`; `CONNECTOR_CALLS_FILE` from `./connectors.mjs`; `runShellStep`, `readTrySetup` from `./shell-step.mjs`; `tryShellEnv` from `./shell-step.mjs`; `TEXT_KINDS`, `commandSummary` from the shared checks.

Add after `clip`:
```js
const parseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
/** 3a: a git try (it ran in Worca's copy of a project): its branch record has the commit it started from. */
export function isProjectRow(row) {
  const br = row && typeof row.branch === 'string' ? parseJson(row.branch) : null;
  return !!(br && typeof br.baseSha === 'string' && br.baseSha);
}

const STATUS_WORD = { A: 'added', C: 'added', M: 'changed', T: 'changed', R: 'renamed', D: 'removed' };
/** D47, D67: results.json (the harness's, run-harness.mjs _buildResults) as board 36 lists it. */
export function projectChanges(results, { max = 50 } = {}) {
  const r = results && typeof results === 'object' ? results : {};
  const rows = [...(Array.isArray(r.newFiles) ? r.newFiles : []), ...(Array.isArray(r.changedFiles) ? r.changedFiles : [])]
    .map((f) => ({ status: STATUS_WORD[String(f.status || 'M')[0]] || 'changed', path: String(f.path || ''), ...(f.from ? { from: String(f.from) } : {}),
      added: Number(f.added || 0), removed: Number(f.removed || 0), ...(f.binary ? { binary: true } : {}) }))
    .filter((f) => f.path)
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const counts = { added: rows.filter((f) => f.status === 'added').length,
    changed: rows.filter((f) => f.status === 'changed' || f.status === 'renamed').length,
    removed: rows.filter((f) => f.status === 'removed').length };
  const s = r.summary && typeof r.summary === 'object' ? r.summary : {};
  return { files: rows.slice(0, max), paths: rows.filter((f) => f.status !== 'removed').map((f) => f.path), total: rows.length, counts,
    added: Number(s.linesAdded || 0), removed: Number(s.linesRemoved || 0) };
}

/** D47: what a project try changed and where its checkout is (kept until its checks have run, D43). */
async function projectOutcome(row, dir) {
  const br = parseJson(row.branch) || {};
  const results = dir ? parseJson(await readFile(join(dir, RESULTS_FILE), 'utf8').catch(() => 'null')) : null;
  const wt = typeof br.worktreeDir === 'string' && br.worktreeDir && existsSync(br.worktreeDir) ? br.worktreeDir : null;
  return { base: br.baseSha || null, branch: br.feature || null, ...projectChanges(results),
    patchFile: dir && existsSync(join(dir, DIFF_PATCH_FILE)) ? join(dir, DIFF_PATCH_FILE) : null,
    checkoutDir: wt, runRoot: join(worcaHome(), 'runs', row.id) };
}
```
Change `mainResult`'s signature to `export async function mainResult(pipelineId, { project } = {})`. Before its `const work = …` fallback, add:
```js
    // 3a D47: a project try's result is its End node's; the largest text file of a project is not a result.
    if (project ?? isProjectRow(row)) return { ...NONE };
```
Change `readTryOutcome` to:
```js
export async function readTryOutcome(pipelineId, { help = [], failReason = null, durationMs = null } = {}) {
  const row = pipelineId ? findPipelineRowById(pipelineId) : null;
  const state = row ? readPipelineStateById(row.id) : null;
  const facts = {
    status: row ? row.status : 'error',
    costUsd: row ? Number(row.total_cost_usd || 0) : 0,
    durationMs,
    sentBack: sumDeliveries(state && state.wireDeliveries),   // correction 2: loop deliveries
    help,
    failReason: failReason || (row ? null : 'The try did not start.'),
  };
  const dir = row ? await runDirForRow(row) : null;
  const projectRun = !!row && isProjectRow(row);
  const main = row ? await mainResult(row.id, { project: projectRun }) : { ...NONE };
  const project = projectRun ? await projectOutcome(row, dir) : null;
  const files = project ? project.paths : row ? (await listRunArtifacts(row.id, { kind: WORK_ARTIFACT_KIND })).map((a) => a.relPath) : [];
  return { pipelineId: row ? row.id : null, facts, ...main, files, project,
    setup: projectRun && dir ? await readTrySetup(dir) : null, logFile: dir ? join(dir, CONNECTOR_CALLS_FILE) : null };
}
```
Change `runScriptCheck`'s option list to `{ pipelineId, cwdDir = null, runBench = runBenchOnce, waitMs = BUSY_WAIT_MS, deadlineMs = null, timeoutOf = declaredTimeout } = {}`. In `work`, replace the block from `scratch = await mkdtemp(…)` through the `cp` line with:
```js
      let dir = cwdDir;   // 3a D47: a project try's checkout is thrown away after its checks, so it needs no copy
      if (!dir) {
        scratch = await mkdtemp(join(tmpdir(), 'worca-wft-'));
        dir = scratch;
        if (row) {
          const src = join(await runDirForRow(row), 'work');
          try { if ((await stat(src)).isDirectory()) await cp(src, scratch, { recursive: true, force: true, filter: copyable }); } catch { /* no result folder: an empty one */ }
        }
      }
```
and change the bench call's `cwd: { kind: 'dir', dir: scratch }` to `cwd: { kind: 'dir', dir }`.

Add before `checkTry`:
```js
/** D58: a text check's file: from the checkout of a project try (a regular file inside it), else from the try's work/. */
export async function readCheckFile(outcome, rel) {
  const clean = String(rel || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) return null;
  if (outcome.project) {
    const dir = outcome.project.checkoutDir;
    if (!dir) return null;
    const file = join(dir, ...clean.split('/'));
    try { return (await lstat(file)).isFile() ? clip(await readFile(file, 'utf8')) : null; } catch { return null; }
  }
  const row = outcome.pipelineId ? findPipelineRowById(outcome.pipelineId) : null;
  const hit = row ? await resolveIndexedArtifactForRow(row, `work/${clean}`) : null;
  return hit ? clip(hit.text) : null;
}

/** D57: "The command passes": in the checkout, with the try's guard env, within its time limit. */
export async function runCommandCheck(check, { cwd, logFile = null, run = runShellStep } = {}) {
  const n = check.timeoutMin;
  const r = await run({ command: check.cmd, cwd, env: tryShellEnv({ logFile }), timeoutMs: n * 60_000 });
  if (r.timedOut) return { met: false, value: `Stopped after ${n} ${n === 1 ? 'minute' : 'minutes'}`, output: r.tail };
  return { met: r.ok, value: commandSummary(r.tail) || (r.ok ? 'Met' : 'Ended with an error'), output: r.tail };
}
```
Replace `checkTry` with:
```js
/**
 * The verdict of one try (D18, D47): the pure checks first (they read the result as the try left it), then the commands
 * and Library scripts in the example's order (they may change a project try's checkout).
 * @param {{basics: object, checks: Array}} example
 * @param {object} outcome readTryOutcome's answer
 * @param {{runScript?: Function, runCommand?: Function, readText?: Function, scriptName?: (key: string) => string, onCommand?: (cmd: string) => void}} [opts]
 */
export async function checkTry(example, outcome, { runScript = runScriptCheck, runCommand = runCommandCheck, readText = readCheckFile,
  scriptName = (k) => k, onCommand = () => {} } = {}) {
  const checks = example.checks || [];
  const results = new Array(checks.length);
  const later = [];
  for (const [i, check] of checks.entries()) {
    if (check.kind === 'script' || check.kind === 'command') { later.push(i); continue; }
    const label = checkLabel(check);
    let text = outcome.text;
    if (TEXT_KINDS.includes(check.kind) && check.file) {
      text = await readText(outcome, check.file);
      if (text === null) { results[i] = { id: check.id, label, met: false, value: `No file named ${check.file}` }; continue; }
    }
    const r = runCheck(check, { text, files: outcome.files });
    results[i] = { id: check.id, label, met: r.met, value: r.value };
  }
  const cwdDir = outcome.project ? outcome.project.checkoutDir : null;
  for (const i of later) {
    const check = checks[i];
    const label = checkLabel(check, { scriptName: check.kind === 'script' ? scriptName(check.key) : null });
    const not = (value) => { results[i] = { id: check.id, label, met: false, value }; };
    if (outcome.facts.status !== 'done') { not('Not run: the try did not finish'); continue; }
    if (outcome.project && !cwdDir) { not('Not run: the copy of the project is gone'); continue; }
    if (check.kind === 'command') {
      onCommand(check.cmd);
      const r = await runCommand(check, { cwd: cwdDir, logFile: outcome.logFile });
      results[i] = { id: check.id, label, met: !!r.met, value: r.value, ...(r.output ? { output: r.output } : {}) };
      continue;
    }
    const r = await runScript(check, { pipelineId: outcome.pipelineId, cwdDir });
    results[i] = { id: check.id, label, met: !!r.met, value: r.value, ...(r.error ? { error: r.error } : {}) };
  }
  return judgeTry(example, outcome.facts, results,
    { name: outcome.name, source: outcome.source, words: typeof outcome.text === 'string' ? wordCount(outcome.text) : null });
}
```

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-test-project-checks.test.mjs test/workflow-test-checks.test.mjs test/workflow-test-result.test.mjs test/workflow-test-project-store.test.mjs test/workflow-test-store.test.mjs`
Expected: PASS. Part 2's result test keeps its shapes: its seeded rows have no branch record, so `isProjectRow` is false.

- [ ] **Step 6: Commit**

```bash
git add src/shared/workflow-tests/checks.mjs src/core/workflow-tests/result.mjs test/workflow-test-project-checks.test.mjs
git commit -m "Workflow tests 3a: what a project try changed, the command check, and text checks that read a file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The runner with project examples: readiness, disk, setup failures, phases, cleanup (D55, D60, D61, D62)

**Files:**
- Modify: `src/core/workflow-tests/try-body.mjs`: `testTargetOf` (:8-10) and a new `exampleReadiness`.
- Modify `src/core/workflow-tests/runner.mjs`:
  - the imports;
  - `start` (:117-160): the per-example readiness and the disk check;
  - `drive` (:177);
  - `runTry` (:270-344);
  - `quickCheck` (:347-390);
  - new `cleanUp`, `phaseOf`, `diskOf`;
  - the return.
- Modify `src/core/workflow-tests/result.mjs`: `projectOutcome` adds `key`.
- Modify `src/core/workflow-tests/service.mjs`: new `projectStateOf`, `readinessText`, `targetFor`, `diskPlanOf`, `prepareProject`, `cleanupTry`. Change `testTarget` (:50-53).
- Modify: `src/core/workflow-tests/routes.mjs`: the runner's deps (:42-56).
- Modify: `src/core/workflow-tests/store.mjs`: `recoverInterruptedTestRuns` (:349-363).
- Modify: `src/shared/workflow-tests/project-text.mjs`: `fmtGb`, `diskRow`, `diskRefusalText`, `diskRefusalOnceText`, `leftOutText`, `DISK_TITLE`.
- Modify `ui/server.mjs`:
  - `bootMaintenance` (:18681), after the run-root sweep (:18744): `sweepTestCopies`;
  - the project-copy import.
- Modify `test/workflow-test-runner.test.mjs` (:259-261) and `test/workflow-test-isolation.test.mjs` (:102): they pinned D20.
- Test: `test/workflow-test-project-runner.test.mjs`, `test/api-workflow-test-project-restart.test.mjs`

**Interfaces:**
- Consumes:
  - `ensureStartCommit`, `treeBytes`, `freeDiskBytes`, `dirBytes`, `removeTryCheckout`, `sweepTestCopies` (Task 3);
  - `readExampleChanges`, `lastDiskBytes` (Task 2);
  - `readTryOutcome`'s `project` / `setup` and `checkTry`'s `onCommand` (Task 6);
  - `TRY_SETUP_STAGE`, `setupFailedText` (Task 4).
- Produces (`try-body.mjs`):
  - `testTargetOf(graph, registry) → { testable: true, reason: null, needsProject: boolean }` (D62: a workflow is always testable)
  - `exampleReadiness({ needsProject, example, state }) → { ready, reason: null|'pick-project'|'missing'|'folder'|'not-registered' }`
- Produces (`service.mjs`):
  - `projectStateOf(project, { projects }) → Promise<{ state: 'ok'|'missing'|'folder'|'not-registered', reg }>`
  - `readinessText(example, reason, { reg }) → string`
  - `targetFor(workflowId, use, example, { registry }) → Promise<{ ready, reason, text }>`
  - `diskPlanOf(examples, { tries, sides, projects }) → Promise<null | { needBytes, freeBytes, enough, text, once }>` (`once` = the Try it once now sentence)
  - `prepareProject(example) → Promise<{ copyDir, startCommit }>` (throws `NOT_READY`)
  - `cleanupTry(outcome) → Promise<{ removed, error }>`
  - `DISK_MARGIN = 1.2`
- Produces (runner deps; Part 2's are unchanged unless named here):
  - `targetOf(workflowId, use, example) → { ready, reason, text }` (was `(workflowId, use) → { testable }`)
  - `diskCheck({ workflowId, examples, tries, uses }) → { enough, text } | null`
  - `prepareProject(example)`, `cleanupTry(outcome)`, `measureDisk(dir) → number|null`, `freeDisk() → number|null`
  - `judge(example, outcome, { onCommand })`
- Produces (runner):
  - `createTestRunner(...)` returns `{ start, stop, continueRun, recover, idle, costOf, phaseOf, diskOf }`;
  - `phaseOf(runId, tryId) → null | { phase: 'preparing'|'setup'|'working'|'checking', checking: string|null, startedMs }`;
  - `diskOf(runId) → null | { freeAtStart }`;
  - the stop reason `'setup'` (its detail = `setupFailedText(cmd)`);
  - refusals `NOT_READY` (the readiness sentence) and `NO_DISK` (the disk sentence).
- Produces (store): `recoverInterruptedTestRuns()` also sets test rows that are `paused` or `interrupted` to `stopped`.
- Produces (`project-text.mjs`):
  - `fmtGb(bytes) → '1.2 GB'`
  - `diskRow(need, free) → 'Needs about 1.2 GB free while it runs · 48 GB free'`
  - `diskRefusalText(need, free)`, `diskRefusalOnceText(need, free)`
  - `leftOutText(names) → '<A and B> are left out: pick their project first.'`
  - `DISK_TITLE = 'Not enough free disk'`

- [ ] **Step 1: Write the failing runner test.** Create `test/workflow-test-project-runner.test.mjs`:

```js
// test/workflow-test-project-runner.test.mjs — workflow tests 3a, Task 7 (D55, D60, D61, D62): the runner with examples that
// work on a project. A try runs in the copy and is cleaned up however it ends; a failed setup stops the test without failing
// a try; readiness and disk refuse a start with their sentences; the progress page can see each try's phase.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { exampleReadiness, testTargetOf } from '../src/core/workflow-tests/try-body.mjs';
import { fmtGb, diskRow, diskRefusalText, diskRefusalOnceText, leftOutText } from '../src/shared/workflow-tests/project-text.mjs';

const WF = 'wf_prun';
const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftprun-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const SHA = 'a'.repeat(40);
const pin = { key: 'tickets-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: SHA, changes: null, setupCmd: 'npm ci' };
const example = (over = {}, project = pin) => store.createExample(WF, { name: 'Ticket 482', request: 'Fix the rounding.', ...over }, { project });

function harness({ setup = { cmd: 'npm ci', ok: true, exitCode: 0, timedOut: false, ms: 1000, tail: '' }, hold = false } = {}) {
  const entries = new Map();
  const started = []; const prepared = []; const cleaned = [];
  let n = 0;
  const deps = {
    startRun: async (body, { workflowTest }) => {
      n += 1;
      const runKey = `run-${n}`; const pipelineId = `p${String(n).padStart(7, '0')}`;
      const orch = new EventEmitter(); orch.state = { totalCostUsd: 0, setupStage: null };
      let finish;
      const launch = new Promise((r) => { finish = r; });
      const e = { orch, launch, status: 'running', pipelineId, end(status) { if (e.status !== 'running') return; e.status = status; finish(); } };
      entries.set(runKey, e);
      workflowTest.onOrch(orch, { runKey });
      started.push({ projectDir: body.projectDir, sourceBranch: body.sourceBranch, noProject: body.noProject, project: workflowTest.project, title: body.title });
      setImmediate(() => { orch.state.totalCostUsd = 0.5; if (!hold) e.end(setup.ok ? 'done' : 'error'); });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { entries.get(k)?.end('stopped'); },
    answer: () => true,
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: 0.5, durationMs, sentBack: 0, help, failReason },
        text: 'Fixed.', name: null, source: 'end-value', files: ['src/round.mjs'], setup,
        project: { key: pin.key, checkoutDir: `/copy/${pipelineId}`, branch: `worca-cc/t-${pipelineId}`, runRoot: `/runs/${pipelineId}`,
          files: [{ status: 'changed', path: 'src/round.mjs', added: 2, removed: 1 }], paths: ['src/round.mjs'], total: 1,
          counts: { added: 0, changed: 1, removed: 0 }, added: 2, removed: 1 } };
    },
    judge: (ex, outcome) => checkTry(ex, outcome),
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    prepareProject: async (ex) => { prepared.push(ex.id); return { copyDir: '/copy', startCommit: ex.project.startCommit }; },
    cleanupTry: async (o) => { cleaned.push(o.pipelineId); return { removed: true, error: null }; },
    measureDisk: async () => 123_456,
    freeDisk: async () => 50 * 2 ** 30,
    mockMode: () => false,
    pollMs: 5,
  };
  return { deps, entries, started, prepared, cleaned };
}

test('a workflow that needs a project is testable; an example without one is left out (D62)', () => {
  assert.deepEqual(testTargetOf({ nodes: [{ kind: 'agent', key: 'coder' }] }, { coder: { needsRepo: true } }), { testable: true, reason: null, needsProject: true });
  assert.deepEqual(exampleReadiness({ needsProject: true, example: { project: null }, state: null }), { ready: false, reason: 'pick-project' });
  assert.deepEqual(exampleReadiness({ needsProject: false, example: { project: null }, state: null }), { ready: true, reason: null });
  assert.deepEqual(exampleReadiness({ needsProject: false, example: { project: pin }, state: 'missing' }), { ready: false, reason: 'missing' });
  assert.deepEqual(exampleReadiness({ needsProject: true, example: { project: pin }, state: 'ok' }), { ready: true, reason: null });
  assert.equal(leftOutText(['Ticket 497']), 'Ticket 497 is left out: pick its project first.');
  assert.equal(leftOutText(['A', 'B']), 'A and B are left out: pick their project first.');
});

test('the disk sentences (boards 34, 39)', () => {
  const GB = 2 ** 30;
  assert.equal(fmtGb(1.2 * GB), '1.2 GB');
  assert.equal(diskRow(1.2 * GB, 48 * GB), 'Needs about 1.2 GB free while it runs · 48.0 GB free');
  assert.equal(diskRefusalText(1.2 * GB, 0.9 * GB), 'Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples.');
  assert.equal(diskRefusalOnceText(0.4 * GB, 0.2 * GB), 'One try needs about 0.4 GB free, and this computer has 0.2 GB free. Free up at least 0.2 GB and try again. Nothing was tried and nothing was charged.');
});

test('a project try runs in the copy, records what it changed, and is cleaned up', async () => {
  const ex = example();
  const h = harness();
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  assert.deepEqual(h.started[0], { projectDir: '/copy', sourceBranch: SHA, noProject: undefined, project: { key: pin.key, setupCmd: 'npm ci' }, title: 'Test: Ticket 482 · try 1' });
  const [t] = store.triesOfRun(run.id);
  assert.equal(t.status, 'passed');
  assert.deepEqual([t.startCommit, t.diskBytes, t.changes.total, t.changes.counts.changed, t.setup.ok], [SHA, 123_456, 1, 1, true]);
  assert.equal('paths' in t.changes, false, 'the stored list has no second copy of the paths');
  assert.deepEqual(h.prepared, [ex.id]);
  assert.deepEqual(h.cleaned, [t.pipelineId], 'removed after its checks');
});

test('a setup that fails stops the test; the try is not a failed try (D55)', async () => {
  const ex = example();
  const h = harness({ setup: { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 900, tail: 'npm error code EUSAGE' } });
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3 });
  await runner.idle(run.id);
  const done = store.readTestRun(run.id);
  assert.deepEqual([done.status, done.stopReason, done.stopDetail], ['stopped', 'setup', 'The setup step failed: npm ci ended with an error.']);
  const tries = store.triesOfRun(run.id);
  assert.ok(!tries.some((t) => t.status === 'failed'), 'no try counts as failed');
  const stopped = tries.find((t) => t.status === 'stopped');
  assert.equal(stopped.verdict, null);
  assert.equal(stopped.setup.tail, 'npm error code EUSAGE');
  assert.ok(h.cleaned.includes(stopped.pipelineId));
});

test('readiness and disk refuse a start with their sentences', async () => {
  const ex = example({ name: 'Ticket 497' }, null);
  const notReady = createTestRunner({ ...harness().deps, targetOf: async (_wf, _use, e) => ({ ready: false, reason: 'pick-project', text: leftOutText([e.name]) }) });
  await assert.rejects(notReady.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'NOT_READY', message: 'Ticket 497 is left out: pick its project first.' });
  const full = createTestRunner({ ...harness().deps, diskCheck: async () => ({ enough: false, text: 'Not enough free disk to start.' }) });
  await assert.rejects(full.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [example().id], tries: 1 }), { code: 'NO_DISK' });
  assert.equal(store.runningTestRun(WF), null, 'nothing was written');
});

test('a project that cannot be prepared stops the test as refused; the try waits for Finish the rest', async () => {
  const ex = example();
  const h = harness();
  const runner = createTestRunner({ ...h.deps, prepareProject: async () => { throw Object.assign(new Error('The project folder is missing'), { code: 'NOT_READY' }); } });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const done = store.readTestRun(run.id);
  assert.deepEqual([done.status, done.stopReason, done.stopDetail], ['stopped', 'refused', 'The project folder is missing']);
  assert.equal(store.triesOfRun(run.id)[0].status, 'waiting');
});

test('phases while a try runs (board 35), and a stopped try is cleaned up too', async () => {
  const ex = example();
  const h = harness({ hold: true });
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  let t;
  for (let i = 0; i < 200 && !(t = store.triesOfRun(run.id)[0]).runKey; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(runner.phaseOf(run.id, t.id).phase, 'working');
  h.entries.get(t.runKey).orch.state.setupStage = 'Running setup';
  assert.equal(runner.phaseOf(run.id, t.id).phase, 'setup');
  assert.equal(runner.diskOf(run.id).freeAtStart, 50 * 2 ** 30);
  await runner.stop(run.id);
  assert.ok(h.cleaned.includes(store.triesOfRun(run.id)[0].pipelineId));
  assert.equal(runner.phaseOf(run.id, t.id), null);
});

test('a restart stops a paused or interrupted test row, so its run folder is reclaimed', () => {
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test) VALUES ('feed0002', 'tickets-1a2b3c4d', 'interrupted', 1),
    ('feed0003', 'tickets-1a2b3c4d', 'paused', 1), ('feed0004', 'tickets-1a2b3c4d', 'paused', NULL)`).run();
  store.recoverInterruptedTestRuns();
  const st = (id) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status;
  assert.deepEqual([st('feed0002'), st('feed0003'), st('feed0004')], ['stopped', 'stopped', 'paused'], 'never a normal run');
});
```

- [ ] **Step 2: Write the failing restart test.** Create `test/api-workflow-test-project-restart.test.mjs`:

```js
// test/api-workflow-test-project-restart.test.mjs — workflow tests 3a (D61): what a restart leaves of a project try is
// removed at boot: its run folder (the run-root sweep, once the row is stopped) and its branch in Worca's copy (the copy sweep).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templateRepo } from './helpers/git-dir.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let homeDir, prevHome, real;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftrestart-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  real = templateRepo('wftrestart', { branch: 'main', user: true, files: { 'README.md': '# r\n' } });
});
after(async () => {
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const d of [homeDir, real]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('boot: an interrupted project try loses its run folder and its branch', { timeout: 120000 }, async () => {
  const { projectKey } = await import('../src/core/store.mjs');
  const key = projectKey(real);
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  const p = await pinStart({ key, name: 'r', projectDir: real });
  const copy = join(homeDir, 'workflow-tests', 'repos', key);
  const runRoot = join(homeDir, 'runs', 'feed0009');
  mkdirSync(join(runRoot, 'repos'), { recursive: true });
  git(copy, 'worktree', 'add', '-q', '-b', 'worca-cc/left-feed0009', '--', join(runRoot, 'repos', key), p.startCommit);
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test, resume_point) VALUES ('feed0009', ?, 'running', 1, NULL)`).run(key);
  const { bootMaintenance } = await import('../ui/server.mjs');
  const summary = await bootMaintenance();
  assert.equal(getDb().prepare("SELECT status FROM pipelines WHERE id = 'feed0009'").get().status, 'stopped');
  assert.equal(existsSync(runRoot), false, 'the run-root sweep took it');
  assert.throws(() => git(copy, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/left-feed0009'));
  assert.deepEqual(summary.testCopies, { copies: 1, branches: 1 });
});
```

`bootMaintenance` is exported from server.mjs (:18681). Importing server.mjs runs no boot by itself (Part 2's tests import it the same way). If the run-root sweep keeps the folder because it has no `run.json`, read `sweepRunRoots`' row-less branch (worktree.mjs:870-890). Then seed a manifest the way `test/run-root-sweep*.test.mjs` does (`Get-ChildItem test\*sweep*.test.mjs`).

- [ ] **Step 3: Run both to verify they fail**

Run: `node tools/test.mjs test/workflow-test-project-runner.test.mjs test/api-workflow-test-project-restart.test.mjs`
Expected: FAIL. The runner test fails with `does not provide an export named 'exampleReadiness'`; the restart test fails on `summary.testCopies`.

- [ ] **Step 4: The sentences (`src/shared/workflow-tests/project-text.mjs`)**

Add `import { andList } from './checks.mjs';` at the top, and:
```js
// D60, boards 34 and 39: disk.
const GB = 2 ** 30;
export const fmtGb = (bytes) => `${Math.max(0.1, Number(bytes || 0) / GB).toFixed(1)} GB`;
const freeUp = (need, free) => fmtGb(Math.max(0, need - free));
export const DISK_TITLE = 'Not enough free disk';
export const diskRow = (need, free) => `Needs about ${fmtGb(need)} free while it runs · ${fmtGb(free)} free`;
export const diskRefusalText = (need, free) => `Not enough free disk to start. This test needs about ${fmtGb(need)} free, and this computer has ${fmtGb(free)} free. Free up at least ${freeUp(need, free)}, or pick fewer examples.`;
export const diskRefusalOnceText = (need, free) => `One try needs about ${fmtGb(need)} free, and this computer has ${fmtGb(free)} free. Free up at least ${freeUp(need, free)} and try again. Nothing was tried and nothing was charged.`;
// D62, board 34: an example a test leaves out.
export const leftOutText = (names) => `${andList(names)} ${names.length === 1 ? 'is' : 'are'} left out: pick ${names.length === 1 ? 'its' : 'their'} project first.`;
```
Board 34 writes "48 GB free"; `fmtGb` always gives one decimal ("48.0 GB"). The plan keeps one rule for every size, and the test pins it.

- [ ] **Step 5: Readiness (`src/core/workflow-tests/try-body.mjs`)**

Replace `testTargetOf` with:
```js
/** 3a (D62, replaces D20): every workflow can be tested; whether it needs a project decides what its examples need. */
export function testTargetOf(graph, registry) {
  return { testable: true, reason: null, needsProject: graphNeedsRepo(graph, registry) };
}

/**
 * 3a (D62): whether one example can be tried on a version. `state` is its project's state now (service.projectStateOf),
 * null for an example without a project.
 * @returns {{ready: boolean, reason: null|'pick-project'|'missing'|'folder'|'not-registered'}}
 */
export function exampleReadiness({ needsProject, example, state }) {
  if (!example || !example.project) return needsProject ? { ready: false, reason: 'pick-project' } : { ready: true, reason: null };
  return state === 'ok' ? { ready: true, reason: null } : { ready: false, reason: state || 'not-registered' };
}
```
Update Part 2's test at `test/workflow-test-isolation.test.mjs:102-103`:
```js
  assert.deepEqual(testTargetOf(graph, { coder: { needsRepo: true } }), { testable: true, reason: null, needsProject: true });
  assert.deepEqual(testTargetOf(graph, { coder: {} }), { testable: true, reason: null, needsProject: false });
```
and rename that test to `'try-body: every workflow can be tested (3a D62); the run body of one try'`.

- [ ] **Step 6: The service's project reads (`src/core/workflow-tests/service.mjs`)**

New imports:
```js
import { listProjects } from '../projects.mjs';
import { testCopyDirFor } from '../store.mjs';
import { ensureStartCommit, treeBytes, freeDiskBytes, removeTryCheckout } from './project-copy.mjs';
import { exampleReadiness } from './try-body.mjs';
import { leftOutText, folderMissingText, folderProjectText, diskRefusalText, diskRefusalOnceText } from '../../shared/workflow-tests/project-text.mjs';
```
Change `testTarget` to return the readiness rule's input:
```js
/** D62 (replaces D20): every saved user workflow can be tested; `needsProject` says what its examples need. */
export function testTarget(workflowId, { registry = loadAgentRegistry() } = {}) {
  const row = workflowRowOf(workflowId);
  return { row, ...testTargetOf(row.graph, registry) };
}
```
(Its body is unchanged; `testTargetOf` now always answers `testable: true` and adds `needsProject`.) Add:
```js
export const DISK_MARGIN = 1.2;

/** The project an example names, as the registry knows it now (D62). */
export async function projectStateOf(project, { projects = null } = {}) {
  const list = projects || await listProjects();
  const reg = list.find((p) => p.key === project.key) || null;
  const state = !reg ? 'not-registered' : !reg.exists ? 'missing' : reg.vcs !== 'git' ? 'folder' : 'ok';
  return { state, reg };
}

/** The sentence for an example a test cannot try (board 39's cards; board 34's left-out hint). */
export function readinessText(example, reason, { reg = null } = {}) {
  const name = reg ? reg.name : example.project ? example.project.key : '';
  if (reason === 'missing') return folderMissingText(name, reg ? reg.path : '');
  if (reason === 'folder') return folderProjectText(name);
  return leftOutText([example.name]);   // pick-project, not-registered
}

/** The runner's targetOf (D62): one example on one version. */
export async function targetFor(workflowId, use, example, { registry = loadAgentRegistry(), projects = null } = {}) {
  const g = await useGraph(workflowId, use);
  const needsProject = g ? testTargetOf(g, registry).needsProject : false;
  const { state, reg } = example.project ? await projectStateOf(example.project, { projects }) : { state: null, reg: null };
  const r = exampleReadiness({ needsProject, example, state });
  return { ...r, text: r.ready ? null : readinessText(example, r.reason, { reg }) };
}

/**
 * D60: what a test of these examples needs on disk while it runs, and what is free. One try needs the example's last
 * measured checkout, else its start tree (`git ls-tree`, read only) plus its patch. The test needs the 3 largest tries at
 * once, times DISK_MARGIN. null when no example has a project.
 */
export async function diskPlanOf(examples, { tries = 3, sides = 1, projects = null } = {}) {
  const list = projects || await listProjects();
  const per = [];
  for (const ex of examples) {
    if (!ex.project) continue;
    const reg = list.find((p) => p.key === ex.project.key);
    const measured = store.lastDiskBytes(ex.id, ex.project.startCommit);
    const bytes = measured ?? (reg && reg.exists ? ((await treeBytes({ projectDir: reg.path, sha: ex.project.startSha })) ?? 0) + (ex.project.changesBytes || 0) : 0);
    for (let k = 0; k < Math.min(tries * sides, TRIES_AT_ONCE); k += 1) per.push(bytes);
  }
  if (!per.length) return null;
  const needBytes = Math.ceil(DISK_MARGIN * per.sort((x, y) => y - x).slice(0, TRIES_AT_ONCE).reduce((s, n) => s + n, 0));
  const freeBytes = await freeDiskBytes();
  const enough = freeBytes === null || freeBytes >= needBytes;
  return { needBytes, freeBytes, enough, text: enough ? null : diskRefusalText(needBytes, freeBytes), once: enough ? null : diskRefusalOnceText(needBytes, freeBytes) };
}

/** Before a try (D42): the example's start commit in Worca's copy of its project. */
export async function prepareProject(example) {
  const { state, reg } = await projectStateOf(example.project);
  if (state !== 'ok') throw err(readinessText(example, state, { reg }), 'NOT_READY');
  return ensureStartCommit({ key: example.project.key, projectDir: reg.path, project: example.project, changes: store.readExampleChanges(example.id) });
}

/** D61: a project try's checkout, its branch in the copy and its run folder, once its run has settled. */
export async function cleanupTry(outcome) {
  const p = outcome && outcome.project;
  if (!p || !p.key) return { removed: true, error: null };
  return removeTryCheckout({ copyDir: testCopyDirFor(p.key), worktreeDir: p.checkoutDir, branch: p.branch, runRoot: p.runRoot, pipelineId: outcome.pipelineId });
}
```
In `result.mjs`'s `projectOutcome`, add `key: row.project_key,` as the first field of its returned object.

- [ ] **Step 7: The runner (`src/core/workflow-tests/runner.mjs`)**

Imports: add
- `import { setupFailedText } from '../../shared/workflow-tests/project-text.mjs';`
- `import { TRY_SETUP_STAGE } from './shell-step.mjs';`

In `start`, replace the Part 2 block `// Review M9 (D20): each side is checked …` (:140-146) with:
```js
      // D62 (replaces D20): each example on each side. A version that needs a project tries only examples that have
      // one, and an example whose project cannot be used now is left out; the first such example names the refusal.
      if (deps.targetOf) {
        for (const ex of examples) {
          for (const [, use] of sides) {
            const t = await deps.targetOf(workflowId, use, ex);
            if (t && !t.ready) throw err(t.text, 'NOT_READY');
          }
        }
      }
      // D60: free disk for the largest tries at once, before anything is written.
      if (deps.diskCheck) {
        const d = await deps.diskCheck({ workflowId, examples, tries, uses: sides.map(([, use]) => use) });
        if (d && d.enough === false) throw err(d.text, 'NO_DISK');
      }
```
In `drive`, after `live.set(runId, st);`, add:
```js
    st.freeAtStart = null;   // D60, board 35's "Disk in use": free disk now minus free disk later
    if (deps.freeDisk) Promise.resolve().then(() => deps.freeDisk()).then((n) => { st.freeAtStart = n; }, () => {});
```
Replace `runTry` with:
```js
  async function runTry(run, st, t) {
    const rec = { runKey: null, pipelineId: null, help: [], failReason: null, detach: null, outcome: null, project: null,
      phase: 'waiting', checking: null, startedMs: Date.now() };
    const detach = () => { const d = rec.detach; rec.detach = null; if (d) d(); };
    st.running.set(t.id, rec);
    store.updateTry(t.id, { status: 'running', startedAt: nowIso() });   // before the first await: the loop sees it at once
    const t0 = Date.now();
    try {
      const example = store.readExample(run.workflowId, t.exampleId);
      if (!example) { store.updateTry(t.id, { status: 'stopped', finishedAt: nowIso() }); return; }
      // D27 (review I3): a try runs today's draft, Library and example. If any of them changed since the test started,
      // it would run one state and be stored as another (and be reused for the old one): the test stops first.
      const changed = example.fingerprint !== t.exampleFp ? editedText(example.name)
        : (await fingerprintNow(run.workflowId, t.use)) !== t.fp ? changedText(t.use) : null;
      if (changed) {
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays as it was
        requestStop(st, 'changed', changed);
        return;
      }
      if (st.stopping) { store.updateTry(t.id, { status: 'waiting', startedAt: null }); return; }
      notify(run);
      // attachAnswerer may call this more than once (one per question): the first reason wins, the run is stopped once.
      const fail = (reason) => {
        if (rec.failReason) return;
        rec.failReason = reason;
        if (rec.runKey) stopQuietly(rec.runKey);
      };
      // 3a (D42): a project example's try runs in Worca's copy of the project, from the example's start commit.
      if (example.project) {
        rec.phase = 'preparing';
        rec.project = await deps.prepareProject(example);   // NOT_READY: the catch stops the test as refused
        if (st.stopping) { store.updateTry(t.id, { status: 'waiting', startedAt: null }); return; }
      }
      rec.phase = 'working';
      rec.startedMs = Date.now();
      // Never an auto (--yes) run: canned answers need the question to wait (tryRunBody sets no `yes`).
      const body = tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: t.tryNo, mock: t.mock,
        ...(rec.project ? { project: rec.project } : {}) });
      const out = await deps.startRun(body, {
        startedBy: run.startedBy,
        workflowTest: {
          use: t.use,
          connectors: t.connectors,   // D35
          ...(example.project ? { project: { key: example.project.key, setupCmd: example.project.setupCmd } } : {}),
          onOrch: (orch, { runKey }) => {
            rec.runKey = runKey;
            rec.detach = attachAnswerer(orch, example, { answer: (id, payload) => deps.answer(runKey, id, payload), onHelp: (x) => rec.help.push(x), onFail: fail });
          },
        },
      });
      const s = await settleRun(st, rec, out, 'the try did not start',
        (runKey, pipelineId) => { rec.pipelineId = pipelineId; store.updateTry(t.id, { runKey, pipelineId }); });
      if (s.refused) {
        detach();
        rec.runKey = null;
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays for "Finish the rest"
        return;
      }
      // A step error is a finished, failed try; any other pause leaves it unfinished (pauseVerdict).
      if (s.pause && s.pause.fail && !rec.failReason) rec.failReason = sentence(s.pause.detail);
      const unfinished = !!(s.pause && s.pause.stop);
      detach();
      rec.outcome = await deps.outcomeOf(s.pipelineId, { help: rec.help, failReason: rec.failReason, durationMs: Date.now() - t0 });
      const outcome = rec.outcome;
      const facts = outcome.project ? projectFacts(rec, outcome) : {};
      // D55: a setup that failed is the test's problem, not the workflow's: the test stops and this try is not judged.
      if (outcome.setup && outcome.setup.ok === false) {
        store.updateTry(t.id, { status: 'stopped', costUsd: outcome.facts.costUsd, finishedAt: nowIso(), ...facts });
        requestStop(st, 'setup', setupFailedText(outcome.setup.cmd));
        return;
      }
      if ((unfinished || st.stopping) && !rec.failReason && outcome.facts.status !== 'done') {
        store.updateTry(t.id, { status: 'stopped', costUsd: outcome.facts.costUsd, finishedAt: nowIso(), ...facts });
        return;
      }
      rec.phase = 'checking';
      const verdict = await deps.judge(example, outcome, { onCommand: (cmd) => { rec.checking = cmd; } });
      // D60: the checkout's size after its setup, measured once per example and start.
      const diskBytes = outcome.project && outcome.project.checkoutDir && deps.measureDisk && facts.startCommit
        && store.lastDiskBytes(example.id, facts.startCommit) === null ? await deps.measureDisk(outcome.project.checkoutDir) : null;
      store.updateTry(t.id, { status: verdict.passed ? 'passed' : 'failed', verdict, costUsd: outcome.facts.costUsd, finishedAt: nowIso(),
        ...facts, ...(diskBytes != null ? { diskBytes } : {}) });
    } catch (e) {
      // Never leave a try 'running' behind: one that never started waits again, one that ran is stopped with its cost.
      if (rec.runKey) {
        stopQuietly(rec.runKey);
        const cost = rec.outcome ? rec.outcome.facts.costUsd : liveCost(rec.runKey);
        store.updateTry(t.id, { status: 'stopped', costUsd: cost, finishedAt: nowIso() });
      } else {
        store.updateTry(t.id, { status: 'waiting', startedAt: null });
      }
      requestStop(st, e && e.code === 'NOT_READY' ? 'refused' : 'error', msgOf(e));
    } finally {
      detach();
      if (rec.project) await cleanUp(rec);   // D61: however it ended
      st.running.delete(t.id);
      notify(run);
    }
  }

  /** What a project try stores on its row (D67): its start, its change list without the paths, its setup run. */
  function projectFacts(rec, outcome) {
    const { files, total, counts, added, removed } = outcome.project;
    return { startCommit: rec.project ? rec.project.startCommit : null, changes: { files, total, counts, added, removed },
      ...(outcome.setup ? { setup: outcome.setup } : {}) };
  }

  /** D61: a project try's checkout, branch and run folder go once its run has settled. Never throws: the boot sweep
   *  takes whatever a failure leaves. */
  async function cleanUp(rec) {
    try {
      if (rec.runKey) { const l = deps.liveRun(rec.runKey); if (l && l.launch) await Promise.resolve(l.launch).catch(() => {}); }
      const o = rec.outcome || (rec.pipelineId ? await deps.outcomeOf(rec.pipelineId, {}) : null);
      if (o && o.project && deps.cleanupTry) await deps.cleanupTry(o);
    } catch { /* boot sweep */ }
  }
```
In `quickCheck`, before `const out = await deps.startRun(…)`, add:
```js
        const project = example.project ? await deps.prepareProject(example) : null;   // 3a: the quick check runs in the copy too
        rec.project = project;
```
Change its `tryRunBody(…)` call to pass `...(project ? { project } : {})` in the options. Add `...(example.project ? { project: { key: example.project.key, setupCmd: null } } : {}),` to its `workflowTest` (no setup: a mock run needs no installed dependencies). In its `finally`, before `st.running.delete(key);`, add `if (rec.project) await cleanUp(rec);`. The quick check's `rec` gets `pipelineId: null` and `outcome: null` fields, and its `settleRun` call passes `(runKey, pipelineId) => { rec.pipelineId = pipelineId; }` as `onStarted`.

Add before `return { … }`:
```js
  /** Board 35: what a running try is doing now. The harness's setup stage tells setup and the worktree apart. */
  function phaseOf(runId, tryId) {
    const st = live.get(Number(runId));
    const rec = st ? st.running.get(Number(tryId)) : null;
    if (!rec) return null;
    let phase = rec.phase;
    if (phase === 'working' && rec.runKey) {
      const l = deps.liveRun(rec.runKey);
      const stage = l && l.orch && l.orch.state ? l.orch.state.setupStage : null;
      if (stage === TRY_SETUP_STAGE) phase = 'setup';
      else if (stage === 'Creating the worktree') phase = 'preparing';
    }
    return { phase, checking: rec.checking, startedMs: rec.startedMs };
  }

  /** D60: what was free when the test started, for board 35's "Disk in use". */
  function diskOf(runId) { const st = live.get(Number(runId)); return st ? { freeAtStart: st.freeAtStart ?? null } : null; }
```
and change the return to `return { start, stop, continueRun, recover, idle, costOf, phaseOf, diskOf };`. The running map is keyed by the try id (a number) and by `quick:<use>` for the quick check, so `phaseOf` reads `Number(tryId)`.

Update Part 2's runner test (`test/workflow-test-runner.test.mjs:259-261`) to the per-example dep:
```js
  const guarded = createTestRunner({ ...harness().deps, targetOf: async (_wf, use, e) => (use === 1
    ? { ready: false, reason: 'pick-project', text: `${e.name} is left out: pick its project first.` } : { ready: true, reason: null, text: null }) });
  await assert.rejects(guarded.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'NOT_READY', message: `${ex.name} is left out: pick its project first.` }, 'review M9: side A is checked too');
```

- [ ] **Step 8: The routes' runner deps (`src/core/workflow-tests/routes.mjs`)**

Add `import { dirBytes, freeDiskBytes } from './project-copy.mjs';` and add `NOT_READY: 422, NO_DISK: 422` to `STATUS`. Replace the `targetOf` dep and add the new ones:
```js
    // D62 (replaces D20 and review M9): each example on each version.
    targetOf: (workflowId, use, example) => service.targetFor(workflowId, use, example),
    diskCheck: ({ examples, tries, uses }) => service.diskPlanOf(examples, { tries, sides: uses.length }),
    prepareProject: (example) => service.prepareProject(example),
    cleanupTry: (outcome) => service.cleanupTry(outcome),
    measureDisk: (dir) => dirBytes(dir),
    freeDisk: () => freeDiskBytes(),
```
Change the `judge` dep to `judge: (example, outcome, o = {}) => checkTry(example, outcome, { scriptName, onCommand: o.onCommand }),`. Remove the now-unused `testTargetOf`, `useGraph` and `loadAgentRegistry` imports if nothing else in routes.mjs uses them.

- [ ] **Step 9: The boot recovery (`src/core/workflow-tests/store.mjs`) and the copy sweep (`ui/server.mjs`)**

In `recoverInterruptedTestRuns`, inside its `tx`, after the `resume_point = NULL` update, add:
```js
    // 3a D61: nothing resumes a try, so a paused or interrupted one is stopped; the run-root sweep that follows in
    // bootMaintenance then reclaims its folder (it keeps an interrupted run's root).
    prepare("UPDATE pipelines SET status = 'stopped' WHERE is_test = 1 AND status IN ('paused', 'interrupted')").run();
```
In `ui/server.mjs`, add `import { sweepTestCopies } from '../src/core/workflow-tests/project-copy.mjs';`. Add `testCopies: null` to `bootMaintenance`'s `summary`. After the run-root sweep's `try { … } catch { … }` (ends :18744), add:
```js
  // Workflow tests 3a (D61): every copy of a project prunes the worktrees the sweep above removed and loses its leftover
  // try branches. Nothing tries at boot.
  try {
    summary.testCopies = await sweepTestCopies({ log: sink('workflow-tests') });
  } catch (err) {
    console.error(`[worca-ui] workflow tests copy sweep failed: ${err && err.message ? err.message : err}`);
  }
```

- [ ] **Step 10: Run the tests**

Run: `node tools/test.mjs test/workflow-test-project-runner.test.mjs test/api-workflow-test-project-restart.test.mjs test/workflow-test-runner.test.mjs test/workflow-test-isolation.test.mjs test/workflow-test-store.test.mjs test/api-workflow-test-project-try.test.mjs`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/core/workflow-tests/try-body.mjs src/core/workflow-tests/runner.mjs src/core/workflow-tests/result.mjs src/core/workflow-tests/service.mjs src/core/workflow-tests/routes.mjs src/core/workflow-tests/store.mjs src/shared/workflow-tests/project-text.mjs ui/server.mjs test/workflow-test-project-runner.test.mjs test/api-workflow-test-project-restart.test.mjs test/workflow-test-runner.test.mjs test/workflow-test-isolation.test.mjs
git commit -m "Workflow tests 3a: the runner with project examples (readiness, disk, setup failures, phases, cleanup on every end and at boot)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Read models and routes: projects, start points, drift, plan, progress, side by side, past project runs (D41, D48, D50, D62, D63, D65, D67, D68)

**Files:**
- Modify: `src/shared/workflow-tests/project-text.mjs`: every board 32–39 string the server or the browser shows.
- Modify: `src/core/workflow-tests/project-copy.mjs`: `headOf`, `commitExists`, `commitDate` (read only).
- Modify `src/core/workflow-tests/service.mjs`:
  - `NOT_TESTABLE_REASONS` (:25-32);
  - `recentRuns` (:95-107), `pastRunSummary` (:129-153), `usablePastRun` (:159-164), `exampleFromRun` (:166-182), `examplesFromRuns` (:186-202);
  - `testsOverview` (:223-255);
  - `connectorsOf` and `testPlan` (:263-312);
  - `progressOf` (:352-381);
  - `sideBySide` (:415-439).
  - New: `projectView`, `projectsForTests`, `projectBranches`, `resolveProjectInput`, `saveExample`, `startFromLatest`, `progressDisk`, `tryChanges`, `forgeNamer`.
- Modify `src/core/workflow-tests/routes.mjs`:
  - `WORKFLOW_TEST_ROUTES` (:17-24);
  - the example create and update routes (:78-81, :97-100);
  - from-run (:82-88);
  - `GET …/runs/:run` (:142);
  - four new routes.
- Modify `ui/server.mjs`: `workflowTestDeps.connectorsPreview` (:13153-13164) takes the project's scope.
- Modify `test/api-workflow-tests.test.mjs` (:154) and `test/api-workflow-tests-flag-off.test.mjs` (:30-32): they pinned D20 and the route count.
- Test: `test/workflow-test-project-text.test.mjs`, `test/api-workflow-tests-projects.test.mjs`

**Interfaces:**
- Consumes:
  - `pinStart`, `listBranches`, `behindCount`, `treeBytes`, `freeDiskBytes` (Task 3);
  - `projectStateOf`, `readinessText`, `targetFor`, `diskPlanOf` (Task 7);
  - the runner's `phaseOf`, `diskOf` (Task 7);
  - `wouldHaveSent(pipelineId, { forgeOf })` (Task 5);
  - `readProjectActions(key)` (config.mjs:1517), `avgSetupMs` (Task 2), `listRemotes` (git-info.mjs:799), `resolveIndexedArtifactForRow` (artifacts.mjs:3172), `workModeOfRow` (project-kind.mjs:59).
- Produces (routes; JSON shapes the UI tasks read):
  - `GET /api/workflow-tests/projects` returns `{ projects: [{ key, name, path, exists, vcs, current: { branch, sha, short, at }|null, setupCmd }] }`.
  - `GET /api/workflow-tests/projects/:key/branches` returns `{ branches: [{ name, sha, short, at, current }] }`.
  - `POST ${W}/examples` and `PUT ${W}/examples/:ex` take `project: { key, ref?, includeChanges?, setupCmd?, repin? } | null` beside the Part 2 fields. They return `{ example }`, whose `project` is Task 2's shape.
  - `POST ${W}/examples/:ex/project/latest` returns `{ example }` ("Start from the latest", D63).
  - `GET ${W}/runs/:run/tries/:try/changes` returns `{ patch }` (the try's `diff-patch.patch`, at most 5 MB; `''` when none).
  - `GET ${W}` (overview):
    - `needsProject` at the top;
    - each example gains `project: null | { key, name, path, state, startSha, short, startRef, startAt, changes, setupCmd, behind }` and `ready`, `reason`, `readyText`;
    - each `pastRuns[]` row gains `project: string|null` and `refusal: null|'folder'|'workspace'`.
  - `GET ${W}/plan` gains `project: null | { names, leftOut, disk: { needBytes, freeBytes, enough, text, once }|null, setupCmd, setupMs }`. Its `examples` counts only the ready examples.
  - `GET ${W}/runs/:run` (progress):
    - each row gains `now: null | { tryNo, phase, checking, setupCmd, startedMs }`;
    - the top gains `project: null | { phases: { exampleName, label, tryNo, phase, start: { ref, short, at }, setupCmd }|null, disk: { inUseBytes, needBytes, freeBytes }|null, setupStop: { cmd, tail, exampleId, exampleName, label, tryNo }|null }`.
  - `GET ${W}/runs/:run/examples/:ex` (side by side):
    - each try view gains `project: null | { changes, setup }`, and `wouldHaveSent` in both modes;
    - the top gains `start: null | { ref, short, at, setupCmd, setupMs }` and `nothingPushed: boolean`.
  - `GET /api/workflow-tests/past-run/:pipelineId` gains:
    - `project: null | { key, name, startSha, short, startRef, startAt, setupCmd }`;
    - the new reasons `folder-run`, `workspace-run`, `no-start`.
  - `POST ${W}/examples/from-run` takes `setupCmd`.
- Produces (`project-copy.mjs`): `headOf(projectDir) → { branch, sha, at }|null`, `commitExists(projectDir, sha) → boolean`, `commitDate(projectDir, sha) → ISO|null`.
- Produces (`project-text.mjs`): the constants and functions listed in Step 3 (every string the UI tasks use).

- [ ] **Step 1: Write the failing text test.** Create `test/workflow-test-project-text.test.mjs`:

```js
// test/workflow-test-project-text.test.mjs — workflow tests 3a: the words for project examples, as boards 32–39 write them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../src/shared/workflow-tests/project-text.mjs';

test('board 32: where it starts', () => {
  assert.equal(t.WHERE_TITLE, 'Where it starts');
  assert.equal(t.WHERE_HINT, "Each try works in Worca's own copy of the project. Your folder and your branches are never touched.");
  assert.equal(t.START_HINT, 'Both versions start from here. It stays the same until you change it, so results can be compared.');
  assert.equal(t.behindText(14, 'main'), 'The project has moved on: 14 newer commits on main since this start point.');
  assert.equal(t.behindText(1, 'main'), 'The project has moved on: 1 newer commit on main since this start point.');
  assert.equal(t.LATEST_BUTTON, 'Start from the latest');
  assert.equal(t.LATEST_HINT, 'Both versions are then tried again from the new point, so their results stay comparable.');
  assert.equal(t.CHANGES_LABEL, 'Include my changes that are not committed yet');
  assert.equal(t.CHANGES_HINT, 'Off: the example starts from the commit only. On: your changes are saved with the example.');
  assert.equal(t.SETUP_LABEL, 'Before each try, run');
  assert.equal(t.SETUP_HINT, "Filled in from the project's setup. If it fails, the test stops and no try counts as failed.");
  assert.equal(t.CARD1_HINT_PROJECT, 'The same request and the same starting point are used every time this example is tried.');
  assert.equal(t.CHECKS_HINT_PROJECT, "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.");
  assert.equal(t.shortSha('abc1234def'), 'abc1234');
});

test('board 33: the project checks in the dialog', () => {
  assert.equal(t.CHECK_DIALOG_HINT_PROJECT, "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.");
  assert.equal(t.COMMAND_HINT, 'It runs in Worca\'s own copy of the project after the try is done. Met when the command ends without an error. Worca shows its last summary line, for example "212 passed, 1 failed".');
  assert.deepEqual([t.TIMEOUT_LABEL, t.TIMEOUT_HINT], ['Stop the command after', 'A command that runs longer counts as not met.']);
  assert.deepEqual([t.GROUP_RESULT, t.GROUP_PROJECT], ['The result', 'The project']);
  assert.deepEqual([t.READ_FROM_LEGEND, t.READ_FROM_RESULT, t.READ_FROM_RESULT_SUB, t.READ_FROM_FILE],
    ['Read from', 'The final result', ' · what the workflow says at the end', 'A file in the project']);
  assert.equal(t.timeoutText(1), '1 minute');
  assert.equal(t.timeoutText(10), '10 minutes');
});

test('board 34: test a version', () => {
  assert.equal(t.LOCK_LEAD, 'Tests never push, open pull requests or change your project.');
  assert.equal(t.LOCK_REST, " Each try works in Worca's own copy of the project, which is deleted after the checks.");
  assert.equal(t.REAL_BLOCKED_HINT, ' Pushes, pull requests and issues stay blocked.');
  assert.equal(t.allOnProject(5, 'worca-cc'), 'All 5 · on worca-cc');
  assert.equal(t.aboutDuration(70 * 60000), 'about 1 hour 10 minutes');
  assert.equal(t.aboutDuration(2 * 60000), 'about 2 minutes');
  assert.equal(t.aboutDuration(1 * 60000), 'about 1 minute');
  assert.equal(t.aboutDuration(2 * 3600000), 'about 2 hours');
});

test('board 35: while the test runs', () => {
  assert.deepEqual(t.PHASES.map(([k, label]) => [k, label]), [['preparing', 'Preparing a copy of the project'], ['setup', 'Running setup'],
    ['working', 'Working'], ['checking', 'Checking']]);
  assert.deepEqual(t.PHASE_SUB, { working: 'The workflow does its work', checking: 'The checks run, then the copy is deleted' });
  assert.equal(t.PHASES_TITLE, 'What happens in each try');
  assert.equal(t.phasesShownFor('Ticket 482', 'v3 draft', 1), 'Shown for Ticket 482, v3 draft, try 1. Three tries run at once, each in its own copy of the project.');
  assert.equal(t.nowText({ tryNo: 2, phase: 'checking' }), 'Try 2 · Checking');
  assert.equal(t.DISK_IN_USE, 'Disk in use');
  assert.equal(t.SETUP_STOP_REST, ' The test stopped, and no try counts as failed.');
  assert.equal(t.SETUP_STOP_HINT, "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: ");
  assert.deepEqual([t.SEE_SETUP_OUTPUT, t.SETUP_FIX_HINT, t.EDIT_EXAMPLE, t.TRY_AGAIN],
    ['See the setup output', 'Fix the setup in the example, or in the project, then try again.', 'Edit the example', 'Try again']);
});

test('boards 36 and 37: what changed, what would have been sent', () => {
  assert.equal(t.changesTitle('v2'), 'What changed in the project · v2');
  assert.equal(t.changeCountText({ added: 0, changed: 3, removed: 0 }), '3 changed');
  assert.equal(t.changeCountText({ added: 1, changed: 2, removed: 1 }), '1 added, 2 changed, 1 removed');
  assert.equal(t.changeCountText({ added: 0, changed: 0, removed: 0 }), 'Nothing changed');
  assert.deepEqual(t.FILE_BADGE, { added: 'Added', changed: 'Changed', renamed: 'Renamed', removed: 'Removed' });
  assert.equal(t.READ_ALL_CHANGES, 'Read all the changes');
  assert.equal(t.DEV_SBS_HINT, "Each try worked in Worca's own copy of the project, which was deleted after the checks. The list of changes and the full diff of each try are kept here.");
  assert.equal(t.changesLine('v2', { total: 3, added: 14, removed: 3 }), 'v2: 3 files, 14 lines added, 3 removed');
  assert.equal(t.changesLine('v3 draft', { total: 1, added: 1, removed: 0 }), 'v3 draft: 1 file, 1 line added, 0 removed');
  assert.equal(t.notMetFor('v3 draft'), 'Not met for v3 draft:');
  assert.equal(t.COMMAND_ENDED, ' the command ended with an error.');
  assert.equal(t.SEE_COMMAND_OUTPUT, 'See the command output');
  assert.equal(t.NOTHING_PUSHED_TEXT, "The changes stayed in Worca's own copy of the project: nothing was pushed.");
  assert.equal(t.REAL_BLOCKED_TEXT, ' Pushes, pull requests and issues stay blocked in every test, also with Real connectors.');
  assert.equal(t.EACH_ANSWERED_TEXT, 'Each one answered "Not sent: this is a test."');
});

test('boards 38 and 39: the list, a past run, the empty and refused states', () => {
  assert.equal(t.PICK_FIRST_TEXT, 'Pick a project first');
  assert.equal(t.NO_PROJECT_YET_HINT, 'Request only · no project yet, so it is left out of tests');
  assert.equal(t.WITH_CHANGES_HINT, ' · with changes not committed yet');
  assert.equal(t.LIST_FOOT_HINT, 'Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.');
  assert.equal(t.fromRunIntro('Fix a bug from a ticket'), 'Worca keeps the request and where the run started, so every new version of Fix a bug from a ticket can be tried on exactly the same thing.');
  assert.equal(t.STARTS_FROM_RUN, 'Starts from where this run started: ');
  assert.equal(t.pastRunProjectNote('worca-cc'), "Project: worca-cc · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project.");
  assert.deepEqual(t.PAST_RUN_REFUSALS, {
    'folder-run': "This run worked on a Folder project. Folder projects can't be tested yet.",
    'workspace-run': "This run worked on several projects. Workflows on several projects can't be tested yet.",
    'no-start': 'Worca did not record where this run started.',
  });
  assert.equal(t.PICK_PROJECT_TITLE, 'Pick the project this example works on');
  assert.equal(t.pickProjectText('Fix a bug from a ticket'), "Fix a bug from a ticket changes a project's code, so each example needs one. Each try works in Worca's own copy of the project.");
  assert.equal(t.PICK_PROJECT_OPTION, 'Pick a project');
  assert.equal(t.NO_PROJECT_OPTION, 'No project');
  assert.equal(t.PICK_THE_FOLDER, 'Pick the folder');
  assert.equal(t.firstUseNoneText('Fix a bug from a ticket', { needsProject: true }), 'Worca found no runs of Fix a bug from a ticket yet. Run the workflow once on a project, or write an example yourself.');
  assert.equal(t.firstUseNoneText('Brief writer', { needsProject: false }), 'Worca found no runs of Brief writer yet. Write an example yourself, or run the workflow once and come back.');
  assert.equal(t.pickerNoneText('Brief writer', { needsProject: false }), 'Worca found no runs of Brief writer yet. Run the workflow once, or write an example yourself.');
  assert.equal(t.pickerNoneText('Fix', { needsProject: true }), 'Worca found no runs of Fix yet. Run the workflow once on a project, or write an example yourself.');
  assert.deepEqual([t.START_DIALOG_TITLE, t.START_DIALOG_HINT, t.START_DIALOG_OK],
    ['Start point', 'Pick the branch this example starts from. Worca takes its newest commit.', 'Use this start point']);
});
```

- [ ] **Step 2: Write the failing API test.** Create `test/api-workflow-tests-projects.test.mjs`:

```js
// test/api-workflow-tests-projects.test.mjs — workflow tests 3a, Task 8 (mock engine): the routes for examples that work on
// a project. Projects and branches to pick from; save with a start point (and the uncommitted changes); drift and Start from
// the latest; the overview's readiness; the plan's disk; a whole project test to its side-by-side page; past project runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, real, key, folderKey, runs;
const extra = [];
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const WF = '/api/workflows/wf_pt/tests';
const GRAPH = {
  version: 2, id: 'wf_pt', name: 'Fix a bug from a ticket', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftpapi', { branch: 'main', user: true, files: { 'README.md': '# t\n', 'CHANGELOG.md': '# Changelog\n' } });
  const folder = await mkdtemp(join(tmpdir(), 'worca-cc-wftpfolder-'));
  extra.push(real, folder);
  const { insertProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  insertProject({ name: 'tickets', path: real });
  insertProject({ name: 'docs-site', path: folder });
  key = projectKey(real);
  folderKey = projectKey(folder);
  const { writeProjectActions } = await import('../src/core/config.mjs');
  writeProjectActions(key, { setup: 'node -e "0"' });
  assert.equal((await call('POST', '/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the projects to pick from, with the branch each folder is on and its setup; a project\'s branches', async () => {
  const p = await call('GET', '/api/workflow-tests/projects');
  const tickets = p.body.projects.find((x) => x.key === key);
  assert.deepEqual([tickets.name, tickets.vcs, tickets.current.branch, tickets.current.short.length, tickets.setupCmd], ['tickets', 'git', 'main', 7, 'node -e "0"']);
  assert.equal(p.body.projects.find((x) => x.key === folderKey).vcs, 'none');
  const b = await call('GET', `/api/workflow-tests/projects/${key}/branches`);
  assert.deepEqual(b.body.branches.map((x) => [x.name, x.current]), [['main', true]]);
  assert.equal((await call('GET', '/api/workflow-tests/projects/nope-00000000/branches')).status, 404);
});

test('an example with a project: the overview says where it starts; drift; Start from the latest; the person\'s repository only read', { timeout: 120000 }, async () => {
  const was = repoSnapshot(real);
  const head = git(real, 'rev-parse', 'HEAD');
  const c = await call('POST', `${WF}/examples`, { name: 'Ticket 482', request: 'Fix the rounding.', project: { key, setupCmd: 'node -e "0"' },
    checks: [{ kind: 'command', cmd: 'node -e "process.exit(0)"' }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const ex = c.body.example;
  assert.deepEqual([ex.project.key, ex.project.startSha, ex.project.startRef, ex.project.setupCmd], [key, head, 'main', 'node -e "0"']);
  let o = (await call('GET', WF)).body;
  assert.equal(o.needsProject, false, 'the implementer alone needs no repo (brief 1.1)');
  let row = o.examples.find((e) => e.id === ex.id);
  assert.deepEqual([row.project.name, row.project.short, row.project.behind, row.project.state, row.ready], ['tickets', head.slice(0, 7), 0, 'ok', true]);
  assert.equal(repoSnapshot(real), was, 'saving only read the project');
  writeFileSync(join(real, 'README.md'), '# t2\n');
  git(real, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'later');
  row = (await call('GET', WF)).body.examples.find((e) => e.id === ex.id);
  assert.equal(row.project.behind, 1);
  const latest = await call('POST', `${WF}/examples/${ex.id}/project/latest`);
  assert.equal(latest.status, 200, JSON.stringify(latest.body));
  assert.equal(latest.body.example.project.startSha, git(real, 'rev-parse', 'HEAD'));
  assert.notEqual(latest.body.example.fingerprint, ex.fingerprint, 'a new start point: older results stop being reused (D48)');
  const kept = await call('PUT', `${WF}/examples/${ex.id}`, { note: 'n', project: { key } });
  assert.equal(kept.body.example.project.startSha, latest.body.example.project.startSha, 'same project, no repin: the start stays');
});

test('uncommitted changes are kept with the example; a Folder project and a missing folder are refused with board 39\'s words', async () => {
  writeFileSync(join(real, 'CHANGELOG.md'), '# Changelog\n\n## Fixed\n');
  const c = await call('POST', `${WF}/examples`, { name: 'With changes', request: 'r', project: { key, includeChanges: true } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(c.body.example.project.changesBytes > 0);
  assert.notEqual(c.body.example.project.startCommit, c.body.example.project.startSha);
  git(real, 'checkout', '-q', '--', 'CHANGELOG.md');
  const folder = await call('POST', `${WF}/examples`, { name: 'Docs', request: 'r', project: { key: folderKey } });
  assert.equal(folder.status, 422);
  assert.match(folder.body.error, /is a Folder project\. Worca can test examples on Git projects for now\. Pick a Git project\.$/);
});

test('a workflow that needs a project: its example without one is left out, and the start says so', async () => {
  const service = await import('../src/core/workflow-tests/service.mjs');
  const none = await call('POST', `${WF}/examples`, { name: 'Ticket 497', request: 'r' });
  const o = await service.testsOverview('wf_pt', { registry: { implementer: { needsRepo: true } } });
  assert.deepEqual([o.testable, o.needsProject], [true, true]);
  const row = o.examples.find((e) => e.id === none.body.example.id);
  assert.deepEqual([row.ready, row.reason, row.readyText], [false, 'pick-project', 'Ticket 497 is left out: pick its project first.']);
  await call('DELETE', `${WF}/examples/${none.body.example.id}`);
});

test('a whole project test: the plan\'s disk, the progress phases, then what changed and what would have been sent', { timeout: 240000 }, async () => {
  const ex = (await call('POST', `${WF}/examples`, { name: 'Ticket 455', request: 'Fix the CSV export.', project: { key },
    checks: [{ kind: 'command', cmd: 'node -e "console.log(\'# pass 4\');console.log(\'# fail 0\')"' }] })).body.example;
  const plan = (await call('GET', `${WF}/plan?b=draft&examples=${ex.id}&tries=1`)).body;
  assert.ok(plan.project.disk.needBytes > 0 && plan.project.disk.freeBytes > 0 && plan.project.disk.enough);
  assert.deepEqual(plan.project.names, ['tickets']);
  const r = await call('POST', `${WF}/examples/${ex.id}/try-once`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const runId = r.body.run.id;
  let p;
  for (let i = 0; i < 2000; i += 1) {
    p = (await call('GET', `${WF}/runs/${runId}`)).body;
    if (p.run.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(p.run.status, 'done', JSON.stringify(p.run));
  const s = (await call('GET', `${WF}/runs/${runId}/examples/${ex.id}`)).body;
  const v = s.tries[0].b;
  assert.equal(v.status, 'passed');
  assert.ok(v.project.changes.files.some((f) => f.path === 'src/feature.mjs' && f.status === 'added'), 'the mock implementer\'s file');
  assert.deepEqual(v.verdict.checks.map((c) => [c.met, c.value]), [[true, '4 passed']]);
  assert.deepEqual(v.wouldHaveSent, [], 'the mock pushed nothing');
  assert.equal(s.nothingPushed, true);
  assert.equal(s.start.ref, 'main');
  const ch = await call('GET', `${WF}/runs/${runId}/tries/${v.tryId}/changes`);
  assert.match(ch.body.patch, /src\/feature\.mjs/);
  const t = (await import('../src/core/workflow-tests/store.mjs')).readTry(v.tryId);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(homeDir, 'runs', t.pipelineId)), false, 'the checkout and run folder are gone after the checks');
});

test('a past project run: it starts where the run started; a Folder run is refused with board 39\'s sentence', { timeout: 240000 }, async () => {
  const { _testing } = await import('../ui/server.mjs');
  const out = await _testing.invokeStartRun({ projectDir: real, workflowId: 'wf_pt', prompt: 'Fix: invoice totals', title: 'Fix: invoice totals round wrong' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  for (let i = 0; i < 2000 && !runs.get(out.body.runId)?.settled; i += 1) await new Promise((res) => setTimeout(res, 100));
  const past = (await call('GET', `/api/workflow-tests/past-run/${out.body.pipelineId}`)).body;
  assert.deepEqual([past.testable, past.project.key, past.project.startRef, past.project.name, past.project.setupCmd], [true, key, 'main', 'tickets', 'node -e "0"']);
  const o = (await call('GET', WF)).body;
  const listed = o.pastRuns.find((x) => x.pipelineId === out.body.pipelineId);
  assert.deepEqual([listed.project, listed.refusal], ['tickets', null]);
  const made = await call('POST', `${WF}/examples/from-run`, { pipelineId: out.body.pipelineId, setupCmd: 'npm ci' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual([made.body.example.project.startSha, made.body.example.project.changesBytes, made.body.example.project.setupCmd],
    [past.project.startSha, 0, 'npm ci']);
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare("UPDATE pipelines SET branch = json_set(branch, '$.workMode', 'folder') WHERE id = ?").run(out.body.pipelineId);
  const folderRun = (await call('GET', `/api/workflow-tests/past-run/${out.body.pipelineId}`)).body;
  assert.deepEqual([folderRun.testable, folderRun.reason, folderRun.reasonText],
    [false, 'folder-run', "This run worked on a Folder project. Folder projects can't be tested yet."]);
});
```

The "whole project test" runs a real mock try end to end: the copy, the start commit, the harness, the guard, the checks in the checkout, then the cleanup. It takes about 30–60 s on this laptop.

- [ ] **Step 3: Run both to verify they fail**

Run: `node tools/test.mjs test/workflow-test-project-text.test.mjs test/api-workflow-tests-projects.test.mjs`
Expected: FAIL. The first fails with `t.WHERE_TITLE` undefined; the second fails with `GET /api/workflow-tests/projects` answering 404.

- [ ] **Step 4: The words (`src/shared/workflow-tests/project-text.mjs`)**

Append:
```js
// ── Board 32: Edit an example, where it starts ───────────────────────────────
export const shortSha = (sha) => String(sha || '').slice(0, 7);
export const WHERE_TITLE = 'Where it starts';
export const WHERE_HINT = "Each try works in Worca's own copy of the project. Your folder and your branches are never touched.";
export const START_HINT = 'Both versions start from here. It stays the same until you change it, so results can be compared.';
export const behindText = (n, ref) => `The project has moved on: ${n} newer ${n === 1 ? 'commit' : 'commits'} on ${ref} since this start point.`;
export const LATEST_BUTTON = 'Start from the latest';
export const LATEST_HINT = 'Both versions are then tried again from the new point, so their results stay comparable.';
export const CHANGES_LABEL = 'Include my changes that are not committed yet';
export const CHANGES_HINT = 'Off: the example starts from the commit only. On: your changes are saved with the example.';
export const DEV_CAPTION = 'For developers';
export const SETUP_LABEL = 'Before each try, run';
export const SETUP_HINT = "Filled in from the project's setup. If it fails, the test stops and no try counts as failed.";
export const SETUP_HINT_PAST = "Filled in from the project's setup.";
export const CARD1_HINT_PROJECT = 'The same request and the same starting point are used every time this example is tried.';
export const CHECKS_HINT_PROJECT = "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.";
export const PROJECT_LABEL = 'Project';
export const START_LABEL = 'Start point';
export const CHANGE_BUTTON = 'Change';
export const NO_PROJECT_OPTION = 'No project';
export const PICK_PROJECT_OPTION = 'Pick a project';
// P2 (not drawn): the start point dialog.
export const START_DIALOG_TITLE = 'Start point';
export const START_DIALOG_HINT = 'Pick the branch this example starts from. Worca takes its newest commit.';
export const START_DIALOG_OK = 'Use this start point';

// ── Board 33: the project checks ─────────────────────────────────────────────
export const CHECK_DIALOG_HINT_PROJECT = "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.";
export const GROUP_RESULT = 'The result';
export const GROUP_PROJECT = 'The project';
export const COMMAND_LABEL = 'Command';
export const COMMAND_HINT = 'It runs in Worca\'s own copy of the project after the try is done. Met when the command ends without an error. Worca shows its last summary line, for example "212 passed, 1 failed".';
export const TIMEOUT_LABEL = 'Stop the command after';
export const TIMEOUT_HINT = 'A command that runs longer counts as not met.';
export const timeoutText = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
export const READ_FROM_LEGEND = 'Read from';
export const READ_FROM_RESULT = 'The final result';
export const READ_FROM_RESULT_SUB = ' · what the workflow says at the end';
export const READ_FROM_FILE = 'A file in the project';
export const ADD_CHECK = 'Add check';

// ── Board 34: Test a version ─────────────────────────────────────────────────
export const LOCK_LEAD = 'Tests never push, open pull requests or change your project.';
export const LOCK_REST = " Each try works in Worca's own copy of the project, which is deleted after the checks.";
export const REAL_BLOCKED_HINT = ' Pushes, pull requests and issues stay blocked.';
export const allOnProject = (n, name) => `All ${n} · on ${name}`;
export const DISK_KEY = 'Disk';
export const TIME_KEY = 'Time';
/** "about 1 hour 10 minutes", "about 2 minutes": the time row (board 34). */
export function aboutDuration(ms) {
  const m = Math.max(1, Math.round(Number(ms || 0) / 60000));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const mins = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  if (!h) return `about ${mins(r)}`;
  return `about ${h} ${h === 1 ? 'hour' : 'hours'}${r ? ` ${mins(r)}` : ''}`;
}
export const SETUP_TAKES_LEAD = ' · setup ';
export const setupTakesRest = (ms) => ` takes ${aboutDuration(ms)} a try`;

// ── Board 35: while the test runs ────────────────────────────────────────────
export const PHASES = Object.freeze([['preparing', 'Preparing a copy of the project'], ['setup', 'Running setup'], ['working', 'Working'], ['checking', 'Checking']]);
export const PHASE_LABEL = Object.freeze(Object.fromEntries(PHASES));
export const PHASE_SUB = Object.freeze({ working: 'The workflow does its work', checking: 'The checks run, then the copy is deleted' });
export const PHASES_TITLE = 'What happens in each try';
export const phasesShownFor = (name, label, tryNo) => `Shown for ${name}, ${label}, try ${tryNo}. Three tries run at once, each in its own copy of the project.`;
export const nowText = (now) => `Try ${now.tryNo} · ${PHASE_LABEL[now.phase] || PHASE_LABEL.working}`;
export const forMinutes = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return `for ${m} ${m === 1 ? 'minute' : 'minutes'}`; };
export const RUNNING_LEAD = 'running ';
export const FROM_LEAD = 'From ';
export const DISK_IN_USE = 'Disk in use';
export const diskInUseSub = (need, free) => `of about ${fmtGb(need)} · ${fmtGb(free)} free`;
export const SETUP_STOP_REST = ' The test stopped, and no try counts as failed.';
export const SETUP_STOP_HINT = "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: ";
export const SEE_SETUP_OUTPUT = 'See the setup output';
export const setupWhere = (name, label, tryNo) => `${name}, ${label}, try ${tryNo}`;
export const SETUP_FIX_HINT = 'Fix the setup in the example, or in the project, then try again.';
export const EDIT_EXAMPLE = 'Edit the example';
export const TRY_AGAIN = 'Try again';

// ── Boards 36, 37: one example side by side ──────────────────────────────────
export const changesTitle = (label) => `What changed in the project · ${label}`;
export function changeCountText(c) {
  const parts = [];
  if (c && c.added) parts.push(`${c.added} added`);
  if (c && c.changed) parts.push(`${c.changed} changed`);
  if (c && c.removed) parts.push(`${c.removed} removed`);
  return parts.length ? parts.join(', ') : 'Nothing changed';
}
export const FILE_BADGE = Object.freeze({ added: 'Added', changed: 'Changed', renamed: 'Renamed', removed: 'Removed' });
export const READ_ALL_CHANGES = 'Read all the changes';
export const BOTH_STARTED_FROM = ' · both started from ';
export const DEV_SBS_HINT = "Each try worked in Worca's own copy of the project, which was deleted after the checks. The list of changes and the full diff of each try are kept here.";
export const DEV_START_LEAD = 'Start point: ';
export const DEV_SETUP_LEAD = 'Setup: ';
const n1 = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const changesLine = (label, c) => `${label}: ${n1(c.total, 'file', 'files')}, ${n1(c.added, 'line', 'lines')} added, ${c.removed} removed`;
export const notMetFor = (label) => `Not met for ${label}:`;
export const COMMAND_ENDED = ' the command ended with an error.';
export const SEE_COMMAND_OUTPUT = 'See the command output';
export const NOTHING_PUSHED_TEXT = "The changes stayed in Worca's own copy of the project: nothing was pushed.";
export const REAL_BLOCKED_TEXT = ' Pushes, pull requests and issues stay blocked in every test, also with Real connectors.';
export const EACH_ANSWERED_TEXT = 'Each one answered "Not sent: this is a test."';

// ── Board 38: the Tests list and a past project run ──────────────────────────
export const PICK_FIRST_TEXT = 'Pick a project first';
export const NO_PROJECT_YET_HINT = 'Request only · no project yet, so it is left out of tests';
export const WITH_CHANGES_HINT = ' · with changes not committed yet';
export const MOVED_BADGE = 'Moved on';
export const LIST_FOOT_HINT = 'Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.';
export const fromRunIntro = (workflow) => `Worca keeps the request and where the run started, so every new version of ${workflow} can be tried on exactly the same thing.`;
export const STARTS_FROM_RUN = 'Starts from where this run started: ';
export const pastRunProjectNote = (name) => `Project: ${name} · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project.`;
export const PAST_RUN_REFUSALS = Object.freeze({
  'folder-run': "This run worked on a Folder project. Folder projects can't be tested yet.",
  'workspace-run': "This run worked on several projects. Workflows on several projects can't be tested yet.",
  'no-start': 'Worca did not record where this run started.',
});

// ── Board 39: empty and refused states ───────────────────────────────────────
export const PICK_PROJECT_TITLE = 'Pick the project this example works on';
export const pickProjectText = (workflow) => `${workflow} changes a project's code, so each example needs one. Each try works in Worca's own copy of the project.`;
export const PICK_THE_FOLDER = 'Pick the folder';
export const firstUseNoneText = (workflow, { needsProject }) => (needsProject
  ? `Worca found no runs of ${workflow} yet. Run the workflow once on a project, or write an example yourself.`
  : `Worca found no runs of ${workflow} yet. Write an example yourself, or run the workflow once and come back.`);
export const pickerNoneText = (workflow, { needsProject }) => (needsProject
  ? `Worca found no runs of ${workflow} yet. Run the workflow once on a project, or write an example yourself.`
  : `Worca found no runs of ${workflow} yet. Run the workflow once, or write an example yourself.`);
```

- [ ] **Step 5: Read-only git helpers (`src/core/workflow-tests/project-copy.mjs`)**

Append:
```js
/** The branch the folder is on and its commit (the editor's default start point). Read only. null without a commit. */
export async function headOf(projectDir) {
  const sha = (await git(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).stdout.trim();
  if (!sha) return null;
  const branch = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  return { branch, sha, at: await commitDate(projectDir, sha) };
}

/** Whether the repository has this commit (P4: a project added again keeps an example's start point). Read only. */
export async function commitExists(projectDir, sha) {
  return !!sha && (await git(projectDir, ['cat-file', '-e', `${sha}^{commit}`])).ok;
}

/** A commit's committer date as ISO, or null. Read only. */
export async function commitDate(projectDir, sha) {
  const r = await git(projectDir, ['show', '-s', '--format=%cI', sha]);
  const d = r.ok ? Date.parse(r.stdout.trim()) : NaN;
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
}
```

- [ ] **Step 6: The service (`src/core/workflow-tests/service.mjs`)**

New imports (beside Task 7's):
```js
import { readProjectActions } from '../config.mjs';
import { listRemotes } from '../git-info.mjs';
import { workModeOfRow } from '../project-kind.mjs';
import { resolveIndexedArtifactForRow } from '../artifacts.mjs';
import { pinStart, listBranches, behindCount, headOf, commitExists, commitDate } from './project-copy.mjs';
import { PAST_RUN_REFUSALS, folderMissingText, folderProjectText } from '../../shared/workflow-tests/project-text.mjs';
import { graphNeedsRepo } from '../workflows.mjs';
```
`NOT_TESTABLE_REASONS`: remove `'project-run'` and `'needs-project'`, and add `...PAST_RUN_REFUSALS`. `NOT_TESTABLE_TEXT` stays exported for old callers, but nothing in 3a produces it.

**Projects to pick from, and branches:**
```js
const setupOf = (key) => { try { return readProjectActions(key).setup || null; } catch { return null; } };

/** The editor's project select (board 32): every registered project, the branch its folder is on, its setup. */
export async function projectsForTests() {
  const out = [];
  for (const p of await listProjects()) {
    const head = p.exists && p.vcs === 'git' ? await headOf(p.path) : null;
    out.push({ key: p.key, name: p.name, path: p.path, exists: p.exists, vcs: p.vcs,
      current: head ? { branch: head.branch, sha: head.sha, short: head.sha.slice(0, 7), at: head.at } : null, setupCmd: setupOf(p.key) });
  }
  return { projects: out };
}

/** The start point dialog (P2). */
export async function projectBranches(key) {
  const reg = (await listProjects()).find((p) => p.key === key);
  if (!reg || !reg.exists || reg.vcs !== 'git') throw err('no such Git project', 'NOT_FOUND');
  return { branches: (await listBranches(reg.path)).map((b) => ({ ...b, short: b.sha.slice(0, 7) })) };
}
```
**An example's project in the overview and the editor:**
```js
/** Board 32 / 38: an example's project as the page shows it, with its drift (D63). */
export async function projectView(project, { projects = null } = {}) {
  if (!project) return null;
  const { state, reg } = await projectStateOf(project, { projects });
  const behind = state === 'ok' ? await behindCount({ projectDir: reg.path, startSha: project.startSha, startRef: project.startRef }) : null;
  return { key: project.key, name: reg ? reg.name : project.key, path: reg ? reg.path : null, state, startSha: project.startSha,
    short: project.startSha.slice(0, 7), startRef: project.startRef, startAt: project.startAt, changes: !!project.changesSha256,
    setupCmd: project.setupCmd, behind };
}
```
**Saving an example with a project (D41, D63, P3, P4):**
```js
/** A save's `project` field → the pin to store: undefined keeps, null removes. Pins only when the start point changes. */
export async function resolveProjectInput(was, input) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const key = String((input && input.key) || '');
  const { state, reg } = await projectStateOf({ key });
  if (state === 'not-registered') throw err('pick a project', 'BAD_REQUEST');
  if (state === 'missing') throw err(folderMissingText(reg.name, reg.path), 'NOT_READY');
  if (state === 'folder') throw err(folderProjectText(reg.name), 'NOT_READY');
  const prev = was && was.project ? was.project : null;
  const setupCmd = typeof input.setupCmd === 'string' ? input.setupCmd : prev ? prev.setupCmd : setupOf(key);
  const wantsChanges = input.includeChanges === undefined ? !!(prev && prev.changesSha256) : !!input.includeChanges;
  const same = prev && prev.key === key && input.repin !== true && (input.ref === undefined || input.ref === prev.startRef)
    && wantsChanges === !!prev.changesSha256;
  if (same) return { ...prev, changes: store.readExampleChanges(was.id), setupCmd };
  // P4: the same start, when the project's repository (re-added under another key, say) still has that commit.
  const keepSha = prev && input.ref === undefined && input.repin !== true && !wantsChanges && prev.key !== key
    && await commitExists(reg.path, prev.startSha) ? prev.startSha : null;
  const pin = await pinStart({ key, name: reg.name, projectDir: reg.path, ref: keepSha ? prev.startRef : (input.ref ?? null),
    sha: keepSha, includeChanges: wantsChanges });
  return { ...pin, setupCmd };
}

/** Create (id null) or update an example; its `project` input goes through resolveProjectInput. */
export async function saveExample(workflowId, id, body = {}, { by = null } = {}) {
  const was = id == null ? null : store.readExample(workflowId, id);
  if (id != null && !was) throw err(`no example ${id}`, 'NOT_FOUND');
  const { project: input, ...fields } = body || {};
  const project = await resolveProjectInput(was, input);
  return id == null ? store.createExample(workflowId, fields, { by, project: project ?? null })
    : store.updateExample(workflowId, was.id, fields, { project });
}

/** D63: "Start from the latest": the newest commit of the example's branch, now. */
export async function startFromLatest(workflowId, id) {
  const ex = store.readExample(workflowId, id);
  if (!ex) throw err(`no example ${id}`, 'NOT_FOUND');
  if (!ex.project || !ex.project.startRef) throw err('this example does not follow a branch', 'BAD_REQUEST');
  return saveExample(workflowId, ex.id, { project: { key: ex.project.key, ref: ex.project.startRef, repin: true } });
}
```
**The overview** (`testsOverview`). After `const { row, testable, reason } = testTarget(…)`, read `needsProject` too: `const { row, testable, reason, needsProject } = testTarget(workflowId, { registry });`. Read `const projects = await listProjects();` once. Make the example mapping async and add the project fields:
```js
  const examples = [];
  for (const ex of store.listExamples(workflowId)) {
    const from = ex.from ? findPipelineRowById(ex.from.pipelineId) : null;
    const project = await projectView(ex.project, { projects });
    const ready = exampleReadiness({ needsProject, example: ex, state: project ? project.state : null });
    examples.push({
      id: ex.id, name: ex.name, hasRequest: !!ex.request.trim(), files: ex.files.map((f) => f.name),
      fromAt: from ? from.started_at || null : null, note: ex.note, tries: ex.tries,
      basics: basicsList(ex.basics).length, checks: ex.checks.length,
      cells: Object.fromEntries(uses.map((use) => [store.useRef(use), cellOf(ex, use, fpNow[store.useRef(use)])])),
      project, ready: ready.ready, reason: ready.reason, readyText: ready.ready ? null : readinessText(ex, ready.reason, { reg: project ? projects.find((p) => p.key === project.key) : null }),
    });
  }
```
Add `needsProject` to the returned object, after `testable, reason,`. Change `pastRuns: recentRuns(workflowId)` to `pastRuns: await recentRuns(workflowId, { projects })`.

**Past runs** (`recentRuns`, `pastRunSummary`, `exampleFromRun`). Replace `recentRuns` with:
```js
/** Boards 19, 25, 38, 39 (D65): the workflow's newest finished runs, any target, never a try. A Folder or workspace run is
 *  listed with its refusal. An exactly equal request is "the same". */
export async function recentRuns(workflowId, { limit = 10, projects = null } = {}) {
  getDb();
  const list = projects || await listProjects();
  const rows = prepare(`SELECT id, title, prompt, status, started_at, project_key, target, branch, workspace_meta FROM pipelines
      WHERE is_test IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND status IN ('done', 'stopped', 'error') AND ${templateIdSql} = ?
      ORDER BY started_at DESC LIMIT ?`).all(workflowId, limit);
  const first = new Map();
  return rows.map((r) => {
    const key = normPrompt(r.prompt);
    const sameAs = key && first.has(key) ? first.get(key) : null;
    if (key && !first.has(key)) first.set(key, r.title || r.id);
    const ws = r.target === 'workspace';
    const refusal = ws ? 'workspace' : !isNoProjectKey(r.project_key) && workModeOfRow(r) !== 'git' ? 'folder' : null;
    const members = ws ? ((parse(r.workspace_meta, {}) || {}).projects || []).map((m) => m.projectName).filter(Boolean) : [];
    const project = ws ? members.join(', ') || null : isNoProjectKey(r.project_key) ? null
      : (list.find((p) => p.key === r.project_key) || {}).name || null;
    return { pipelineId: r.id, title: r.title || r.id, at: r.started_at, status: r.status, files: extrasOf(r.id).length, sameAs, project, refusal,
      refusalText: refusal ? PAST_RUN_REFUSALS[`${refusal}-run`] : null };
  });
}
```
In `pastRunSummary`, replace the reason chain's `else if (!isNoProjectKey(row.project_key)) reason = 'project-run';` with:
```js
  else if (row.target === 'workspace') reason = 'workspace-run';
  else if (!isNoProjectKey(row.project_key) && workModeOfRow(row) !== 'git') reason = 'folder-run';
  else if (!isNoProjectKey(row.project_key) && !startOfRow(row)) reason = 'no-start';
```
and the `try { target = testTarget(…); if (!target.testable) reason = 'needs-project'; }` line with `try { target = testTarget(workflowId || '', { registry }); }` (a workflow is always testable now). Add above `pastRunSummary`:
```js
/** D65: where a single-project git run started: its branch record's baseSha (else diffBase), on its source branch. */
function startOfRow(row) {
  const br = parse(row.branch, {}) || {};
  const sha = typeof br.baseSha === 'string' && br.baseSha ? br.baseSha : typeof br.diffBase === 'string' && br.diffBase ? br.diffBase : null;
  return sha ? { sha, ref: typeof br.source === 'string' && br.source ? br.source : null } : null;
}
```
At the end of `pastRunSummary`, compute the project before the return, and add it to the returned object:
```js
  let project = null;
  const start = !reason && !isNoProjectKey(row.project_key) ? startOfRow(row) : null;
  if (start) {
    const reg = (await listProjects()).find((p) => p.key === row.project_key) || null;
    project = { key: row.project_key, name: reg ? reg.name : row.project_key, startSha: start.sha, short: start.sha.slice(0, 7), startRef: start.ref,
      startAt: (reg && reg.exists ? await commitDate(reg.path, start.sha) : null) || row.started_at || null, setupCmd: setupOf(row.project_key) };
  }
```
and add `project,` to the returned object. In `usablePastRun`, the `NOT_TESTABLE` code is no longer reached: change it to `throw err(NOT_TESTABLE_REASONS[past.reason] || NOT_TESTABLE_TEXT, 'BAD_REQUEST');`.

In `exampleFromRun`, take `setupCmd = null` in its first options object. After `const clean = exampleName(name, past);`, add:
```js
  // D65: a project run's example starts exactly where the run started, with no changes (runs start from commits).
  let project = null;
  if (past.project) {
    const { state, reg } = await projectStateOf({ key: past.project.key });
    if (state !== 'ok') throw err(readinessText({ name: clean, project: past.project }, state, { reg }), 'NOT_READY');
    const pin = await pinStart({ key: past.project.key, name: reg.name, projectDir: reg.path, sha: past.project.startSha, ref: past.project.startRef });
    project = { ...pin, setupCmd: typeof setupCmd === 'string' && setupCmd.trim() ? setupCmd.trim() : past.project.setupCmd };
  }
```
and pass `project` in the `store.createExample(…, { by, from: …, project })` options. In `examplesFromRuns`, nothing changes (each run goes through `exampleFromRun`).

**The plan** (`testPlan` and `connectorsOf`). Change `connectorsOf`'s preview call to pass the scope: `preview = connectorsPreview ? (await connectorsPreview(scope)) || {} : {};`, with `scope = null` added to its options. In `testPlan`, after `const examples = …`, add:
```js
  // D62: only the examples that can be tried count; the others are named in the dialog's hint (board 34).
  const projects = await listProjects();
  const readyEx = [];
  const leftOut = [];
  for (const ex of examples) {
    let ok = true;
    for (const use of [a, b].filter((u) => u != null)) { if (!(await targetFor(workflowId, use, ex, { projects })).ready) ok = false; }
    (ok ? readyEx : leftOut).push(ex);
  }
  const projEx = readyEx.filter((e) => e.project);
  const names = [...new Set(projEx.map((e) => (projects.find((p) => p.key === e.project.key) || {}).name || e.project.key))];
  const setupMsList = projEx.map((e) => store.avgSetupMs(e.id, e.project.startCommit)).filter((n) => n != null);
  const cmds = [...new Set(projEx.map((e) => e.project.setupCmd).filter(Boolean))];
  const one = names.length === 1 && projEx.length ? projects.find((p) => p.key === projEx[0].project.key) : null;
  const project = projEx.length ? {
    names, leftOut: leftOut.map((e) => e.name),
    disk: await diskPlanOf(projEx, { tries, sides: a != null ? 2 : 1, projects }),
    setupCmd: cmds.length === 1 ? cmds[0] : null,
    setupMs: setupMsList.length ? Math.round(setupMsList.reduce((s, n) => s + n, 0) / setupMsList.length) : null,
  } : (leftOut.length ? { names: [], leftOut: leftOut.map((e) => e.name), disk: null, setupCmd: null, setupMs: null } : null);
```
Then use `readyEx` in place of `examples` in `side` (both the reuse loop and `want: readyEx.length * tries`). Return `examples: readyEx.length` and add `project`. Pass the scope to `connectorsOf(workflowId, [a, b], { connectorsPreview, runEngine, mode: connectors, scope: one ? { key: one.key, name: one.name, projectDir: one.path } : null })`.

**Progress** (`progressOf`) gains `phaseOf` and `diskOf` options. In the rows loop, for each row add the running try's `now`:
```js
      const running = list.find((t) => t.status === 'running');
      const ph = running && phaseOf ? phaseOf(run.id, running.id) : null;
      const now = running && ex && ex.project ? { tryNo: running.tryNo, phase: ph ? ph.phase : 'working', checking: ph ? ph.checking : null,
        setupCmd: ex.project.setupCmd, startedMs: ph ? ph.startedMs : null } : null;
```
and push `now` with the row. After the rows loop, add:
```js
  // Board 35: the phase card shows the first running project try; a setup stop shows its output.
  const firstNow = rows.find((r) => r.now);
  const projectRows = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter((x) => x && x.project);
  let setupStop = null;
  if (run.stopReason === 'setup') {
    const bad = own.find((t) => t.setup && t.setup.ok === false);
    const ex = bad ? store.readExample(workflowId, bad.exampleId) : null;
    if (bad) setupStop = { cmd: bad.setup.cmd, tail: bad.setup.tail || '', exampleId: bad.exampleId, exampleName: ex ? ex.name : '', label: useLabel(bad.use, ctx), tryNo: bad.tryNo };
  }
  const project = projectRows.length ? {
    phases: firstNow ? (() => { const ex = store.readExample(workflowId, firstNow.exampleId);
      return { exampleName: firstNow.name, label: firstNow.label || useLabel(run.b, ctx), tryNo: firstNow.now.tryNo, phase: firstNow.now.phase,
        start: { ref: ex.project.startRef, short: ex.project.startSha.slice(0, 7), at: ex.project.startAt }, setupCmd: ex.project.setupCmd }; })() : null,
    disk: null,   // filled by progressDisk (async) in the route
    setupStop,
  } : null;
```
and add `project` to the returned object. Add:
```js
/** Board 35's "Disk in use" (D60): free at the start minus free now, of about the need. The route adds it (statfs is async). */
export async function progressDisk(workflowId, run, { diskOf = null } = {}) {
  const exs = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter((x) => x && x.project);
  if (!exs.length) return null;
  const plan = await diskPlanOf(exs, { tries: run.tries, sides: run.a != null ? 2 : 1 });
  const free = plan ? plan.freeBytes : null;
  const start = diskOf ? (diskOf(run.id) || {}).freeAtStart : null;
  return { inUseBytes: start != null && free != null ? Math.max(0, start - free) : null, needBytes: plan ? plan.needBytes : null, freeBytes: free };
}
```
**One example side by side** (`sideBySide`). Change its signature to `sideBySide(workflowId, runId, exampleId, { forgeOf = null } = {})`. In `view`, read what the guard stopped in both modes and add the project facts:
```js
    const sent = await wouldHaveSent(t.pipelineId, forgeOf ? { forgeOf } : {});   // 3a D68: the guard's rows in both modes
    …
    return { tryId: t.id, status: t.status, verdict: t.verdict, name: m.name,
      text: text && text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text, truncated: !!text && text.length > PREVIEW_MAX,
      connectors: t.connectors, wouldHaveSent: sent.sent, answeredReads: sent.reads,
      project: t.startCommit || t.changes ? { changes: t.changes, setup: t.setup ? { cmd: t.setup.cmd, ms: t.setup.ms } : null } : null };
```
A real try's card used to read `wouldHaveSent: null`. Now a real try's `wouldHaveSent` holds only the guard's rows (a real try has no stand-ins, so its log has no connector calls). Add to the returned object:
```js
    start: ex.project ? { ref: ex.project.startRef, short: ex.project.startSha.slice(0, 7), at: ex.project.startAt, setupCmd: ex.project.setupCmd,
      setupMs: store.avgSetupMs(ex.id, ex.project.startCommit) } : null,
    nothingPushed: !!ex.project,
```
Add:
```js
const FORGE_NAMES = Object.freeze({ github: 'GitHub', azure: 'Azure DevOps' });
/** P9: the forge of the real project's remote by its name, for board 37's "… on GitHub". Read only (`git remote -v`). */
export async function forgeNamer(key) {
  const reg = (await listProjects()).find((p) => p.key === key);
  if (!reg || !reg.exists) return () => null;
  const r = await listRemotes(reg.path);
  const by = new Map((r.ok ? r.remotes : []).map((x) => [x.name, FORGE_NAMES[x.forge] || null]));
  return (name) => by.get(name) || null;
}

/** A try's whole diff (board 36's "Read all the changes"), at most 5 MB. */
export async function tryChanges(workflowId, runId, tryId) {
  const run = runOf(workflowId, runId);
  const t = store.triesOfRun(run.id).find((x) => x.id === Number(tryId));
  if (!t) throw err(`no try ${tryId} in this test`, 'NOT_FOUND');
  const row = t.pipelineId ? findPipelineRowById(t.pipelineId) : null;
  const hit = row ? await resolveIndexedArtifactForRow(row, 'diff-patch.patch') : null;
  const patch = hit ? hit.text : '';
  return { patch: patch.length > 5 * 1024 * 1024 ? patch.slice(0, 5 * 1024 * 1024) : patch };
}
```

- [ ] **Step 7: The routes (`src/core/workflow-tests/routes.mjs`)**

Add to `WORKFLOW_TEST_ROUTES`, after `['GET', '/api/workflow-tests/past-run/:pipelineId']`:
```js
  ['GET', '/api/workflow-tests/projects'], ['GET', '/api/workflow-tests/projects/:key/branches'],
  ['POST', `${W}/examples/:ex/project/latest`], ['GET', `${W}/runs/:run/tries/:try/changes`],
```
Change the example create route's handler body to `res.status(201).json({ example: await service.saveExample(wid(req), null, req.body || {}, { by: by(req) }) });` (keep the `workflowRowOf` line). Change the update route's to `res.json({ example: await service.saveExample(wid(req), num(req.params.ex, 'example'), req.body || {}) });`. In from-run, pass `setupCmd: typeof b.setupCmd === 'string' ? b.setupCmd : null` to `exampleFromRun`. Change `GET ${W}/runs/:run` to:
```js
  route('GET', `${W}/runs/:run`, async (req, res) => {
    const p = service.progressOf(wid(req), num(req.params.run, 'test'), { costOf: runner.costOf, phaseOf: runner.phaseOf });
    if (p.project) p.project.disk = await service.progressDisk(wid(req), p.run, { diskOf: runner.diskOf });
    res.json(p);
  });
```
Change the side-by-side route to pass the forge namer when the example has a project:
```js
  route('GET', `${W}/runs/:run/examples/:ex`, async (req, res) => {
    const ex = example(req);
    const forgeOf = ex.project ? await service.forgeNamer(ex.project.key) : null;
    res.json(await service.sideBySide(wid(req), num(req.params.run, 'test'), ex.id, { forgeOf }));
  });
```
Add, after the past-run route:
```js
  route('GET', '/api/workflow-tests/projects', async (_req, res) => res.json(await service.projectsForTests()));
  route('GET', '/api/workflow-tests/projects/:key/branches', async (req, res) => res.json(await service.projectBranches(String(req.params.key || ''))));
  route('POST', `${W}/examples/:ex/project/latest`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.json({ example: await service.startFromLatest(wid(req), num(req.params.ex, 'example')) });
  });
  route('GET', `${W}/runs/:run/tries/:try/changes`, async (req, res) =>
    res.json(await service.tryChanges(wid(req), num(req.params.run, 'test'), num(req.params.try, 'try'))));
```

- [ ] **Step 8: The connectors preview of a project (`ui/server.mjs`)**

Change `workflowTestDeps.connectorsPreview` to take a scope:
```js
  // D35, board 30 (3a: board 34): what a try would load, for the Test a version dialog's notes. Without a project: the
  // registry's no-project scope and the projects root's `.mcp.json`. On one project: that project's scope and the
  // `.mcp.json` of its folder (read only).
  connectorsPreview: async (scope = null) => {
    const target = scope && scope.key ? { kind: 'project', key: scope.key, name: scope.name || scope.key, rank: 0 }
      : { kind: 'project', key: NO_PROJECT_KEY, name: NO_PROJECT_NAME, rank: 0 };
    const [{ result }, mcpStore] = await Promise.all([mcpRunPreview(target), readMcpStore()]);
    const standIns = new Set(pretendCopies(result.copies, (mcpStore && mcpStore.tests) || {}).map((c) => c.name));
    const root = scope && scope.projectDir ? scope.projectDir : getProjectsRoot();
    const file = root ? (await readMcpFile(path.join(root, '.mcp.json'))).servers : null;
    return {
      copies: result.copies.map((c) => ({ name: c.name, untested: !standIns.has(c.name) })),
      fileServers: [...new Set(Object.keys(file || {}).map(normalizeServerName))].sort(),
    };
  },
```

- [ ] **Step 9: Update the Part 2 tests that pinned D20 and the route count**

- `test/api-workflow-tests.test.mjs:154`: `assert.deepEqual([o.testable, o.reason, o.needsProject], [true, null, true]);`. Rename that test to say "a workflow that needs a project is testable (3a D62)".
- `test/api-workflow-tests.test.mjs:201`: `recentRuns` is async now: `const pastId = (await service.recentRuns('wf_api_t'))[0].pipelineId;`.
- `test/api-workflow-tests-flag-off.test.mjs:30`: `assert.equal(routes.length, 23);`.
- `test/api-workflow-tests-flag-off.test.mjs:32`: add `.replace(':key', 'p-1a2b3c4d')` to the URL chain.

- [ ] **Step 10: Run the tests**

Run: `node tools/test.mjs test/workflow-test-project-text.test.mjs test/api-workflow-tests-projects.test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs test/workflow-test-routes.test.mjs test/workflow-test-connectors.test.mjs test/workflow-test-runner.test.mjs`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/shared/workflow-tests/project-text.mjs src/core/workflow-tests/project-copy.mjs src/core/workflow-tests/service.mjs src/core/workflow-tests/routes.mjs ui/server.mjs test/workflow-test-project-text.test.mjs test/api-workflow-tests-projects.test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs
git commit -m "Workflow tests 3a: projects, start points, drift, the plan's disk, progress phases, what changed, past project runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Proofs: the free ones with the real CLI, and the one paid proof (controller only)

The brief's §6 proofs that apply to 3a are in this task. The plugins-off proofs belong to 3b.
- **Free (no model call):**
  - The env layers (`GIT_CONFIG_*`, ssh, the PATH stand-ins) are proved by Task 5's tests in local repos.
  - This task adds the real Claude Code CLI. Pointed at a fake Anthropic API that answers with Bash tool calls, it shows three things: the try-guard hook runs and denies, the stand-in on PATH answers, and whether a permission deny rule pre-empts the hook (D56's open point).
- **Paid (Step 7):** an agent's real `git push` is denied in a try, and the Claude sign-in still works. It runs on Haiku through the user's own Claude sign-in, never the `~/.worca-cc` Vertex routing, capped at $2. Only the controller runs it, as its own step, after the user's explicit OK for this run.

**Files:**
- Create: `.superpowers/sdd/proofs/try-guard-real-cli.mjs` (a script, not a test: it starts the real CLI, which `tools/test.mjs` forbids)
- Create (by running): `.superpowers/sdd/proofs/try-guard-real-cli.json`, `.superpowers/sdd/real-call-proof-3a.md`
- Possibly modify: `src/core/workflow-tests/try-guard-env.mjs` (`TRY_DENY`) and `test/workflow-test-try-guard.test.mjs`, only by the Step 4 rule.

**Interfaces:**
- Consumes:
  - `runClaude` (claude-runner.mjs);
  - `composeSpawnEnv` (engines/spawn.mjs);
  - `tryGuardHookEntry`, `TRY_DENY` (Task 5);
  - `NOT_SENT_TEXT`, `TRY_GUARD_LOG_ENV` (Task 5).
- Produces: the proof's JSON and markdown records. No product code changes unless Step 4's rule fires.

- [ ] **Step 1: Write the free proof.** Create `.superpowers/sdd/proofs/try-guard-real-cli.mjs`:

```js
// .superpowers/sdd/proofs/try-guard-real-cli.mjs — workflow tests 3a, Task 9 (free: no model is called). The real Claude
// Code CLI, pointed at a fake Anthropic API that answers with Bash tool calls, runs a try's outward guard:
//   turn 1: `git push origin main` → the try-guard hook denies it and writes it down;
//   turn 2: a node one-liner that runs `gh pr create` → the hook does not see it; the gh stand-in on PATH answers;
//   turn 3: the end.
// Variant A goes through runClaude with tryGuard, as a try does (the hook and TRY_DENY in --settings). Variant B spawns the
// CLI with the hook alone. If A has no hook entry for the push and B has one, a deny rule pre-empts the hook (Task 9, Step 4).
// Usage, from the worktree root: node .superpowers/sdd/proofs/try-guard-real-cli.mjs <path to the claude binary>
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = process.argv[2];
if (!bin || !existsSync(bin)) { console.error('usage: node try-guard-real-cli.mjs <path to the claude binary>'); process.exit(2); }
const home = mkdtempSync(join(tmpdir(), 'worca-proof-3a-'));
process.env.WORCA_HOME = home;
delete process.env.WORCA_MOCK;
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLOUD_ML_|VERTEX_|AWS_BEARER)/.test(k)) delete process.env[k];

const { runClaude } = await import('../../../src/core/claude-runner.mjs');
const { composeSpawnEnv } = await import('../../../src/core/engines/spawn.mjs');
const { tryGuardHookEntry } = await import('../../../src/core/workflow-tests/try-guard-env.mjs');
const { NOT_SENT_TEXT } = await import('../../../src/core/workflow-tests/try-guard.mjs');

const GH_LINE = "node -e \"require('child_process').execSync('gh pr create --title Proof --body Proof', { stdio: 'inherit' })\"";
const TURNS = [
  { tool: { name: 'Bash', input: { command: 'git push origin main', description: 'Push the branch' } } },
  { tool: { name: 'Bash', input: { command: GH_LINE, description: 'Open a pull request' } } },
  { text: 'Done.' },
];
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url.split('?')[0].endsWith('/v1/messages')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
    let j = {};
    try { j = JSON.parse(body); } catch { /* keep {} */ }
    const hasBash = Array.isArray(j.tools) && j.tools.some((t) => t && t.name === 'Bash');
    const results = (j.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content.filter((c) => c && c.type === 'tool_result') : []));
    seen.push({ hasBash, results: results.map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))) });
    reply(res, j.stream === true, hasBash ? TURNS[Math.min(results.length, TURNS.length - 1)] : { text: 'ok' });
  });
});
function reply(res, stream, turn) {
  const msg = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-haiku-proof', usage: { input_tokens: 10, output_tokens: 5 } };
  const block = turn.tool ? { type: 'tool_use', id: `toolu_${Date.now()}`, name: turn.tool.name, input: turn.tool.input } : { type: 'text', text: turn.text };
  const stop = turn.tool ? 'tool_use' : 'end_turn';
  if (!stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...msg, content: [block], stop_reason: stop })); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...msg, content: [], stop_reason: null } });
  if (turn.tool) {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: block.text } });
  }
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  ev('message_stop', {});
  res.end();
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
// The fake API, a dummy key and an empty Claude config folder: no sign-in, no person's plugins or hooks, nothing paid.
const fakeEnv = { ANTHROPIC_BASE_URL: url, ANTHROPIC_API_KEY: 'sk-ant-proof-000000000000', DISABLE_TELEMETRY: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

function workRepo() {
  const work = mkdtempSync(join(tmpdir(), 'worca-proof-3a-work-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: work });
  return work;
}
const readLog = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function variantA() {
  const work = workRepo();
  const log = join(home, 'calls-A.ndjson');
  Object.assign(process.env, fakeEnv, { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'worca-proof-3a-cfg-')) });
  seen.length = 0;
  let error = null;
  try { await runClaude({ cwd: work, bin, prompt: 'Push the work, then open a pull request.', allowedTools: ['Bash'], permissionMode: 'acceptEdits', tryGuard: { logFile: log } }); }
  catch (e) { error = e && e.message ? e.message : String(e); }
  return { error, calls: readLog(log), results: seen.flatMap((s) => s.results) };
}

async function variantB() {
  const work = workRepo();
  const log = join(home, 'calls-B.ndjson');
  const env = { ...composeSpawnEnv({ tryGuard: { logFile: log } }).env, ...fakeEnv, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'worca-proof-3a-cfg-')) };
  const settings = JSON.stringify({ hooks: { PreToolUse: [tryGuardHookEntry()] } });   // the hook alone: no deny rules
  seen.length = 0;
  const code = await new Promise((done) => {
    const child = spawn(bin, ['-p', 'Push the work, then open a pull request.', '--output-format', 'stream-json', '--verbose',
      '--settings', settings, '--allowedTools', 'Bash', '--permission-mode', 'acceptEdits'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume();
    child.on('close', done);
  });
  return { exitCode: code, calls: readLog(log), results: seen.flatMap((s) => s.results) };
}

const A = await variantA();
const B = await variantB();
server.close();
const has = (v, server, tool) => v.calls.some((c) => c.guard && c.server === server && c.tool === tool);
const out = {
  at: new Date().toISOString(), bin,
  A: { error: A.error, hookPush: has(A, 'git', 'push'), standInPr: has(A, 'GitHub CLI', 'pr create'), notSentSeen: A.results.some((r) => r.includes(NOT_SENT_TEXT)) },
  B: { exitCode: B.exitCode, hookPush: has(B, 'git', 'push'), standInPr: has(B, 'GitHub CLI', 'pr create'), notSentSeen: B.results.some((r) => r.includes(NOT_SENT_TEXT)) },
};
out.denyPreemptsHook = !out.A.hookPush && out.B.hookPush;
writeFileSync(join(import.meta.dirname, 'try-guard-real-cli.json'), `${JSON.stringify({ ...out, callsA: A.calls, callsB: B.calls }, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.B.hookPush && out.B.standInPr ? 0 : 1);
```

- [ ] **Step 2: Run the free proof**

Run (PowerShell, from the worktree root):
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests3; node .superpowers\sdd\proofs\try-guard-real-cli.mjs (Get-Command claude).Source
```
Expected:
- exit 0;
- `B.hookPush: true` (the real CLI ran the hook and the hook denied the push) and `B.standInPr: true` (the stand-in answered a `gh` started by a child of the agent's Bash);
- `B.notSentSeen: true` (the agent got "Not sent: this is a test.").

`A.*` is the shipped settings. If `A.error` says the CLI refused the key or the base URL, read `try-guard-real-cli.json` and the CLI's stderr. The fake API may need one more endpoint the CLI asks for: answer it the way `test/helpers/fake-model-upstream.mjs` does. Make the fix in the script only.

- [ ] **Step 3: Record it.** Add a "Free proof (real CLI, fake model)" section to `.superpowers/sdd/real-call-proof-3a.md` with the CLI version (`claude --version`), the JSON summary, and one line per claim:
  1. The hook runs in the real CLI and denies `git push`.
  2. The stand-in answers a `gh` run through a child process.
  3. The agent sees "Not sent: this is a test.".
  4. Whether a deny rule pre-empts the hook.

- [ ] **Step 4: The deny-rule rule (D56)**

If `denyPreemptsHook` is `true`, the push was blocked but never written down, so "Would have sent" would miss it. Then:
- set `TRY_DENY` in `src/core/workflow-tests/try-guard-env.mjs` to `Object.freeze([])`. The hook denies every one of those commands itself, and the env layers stay;
- change Task 5's test expectations (`p.settings.permissions.deny` equals `['Read(.env*)']`; `withTryDeny(null).deny` equals `[]`);
- run `node tools/test.mjs test/workflow-test-try-guard.test.mjs test/spawn-args.test.mjs`, run Step 2 again, and expect `A.hookPush: true`.

Commit:
```bash
git add src/core/workflow-tests/try-guard-env.mjs test/workflow-test-try-guard.test.mjs
git commit -m "Workflow tests 3a: the try guard records what a deny rule would hide (the real CLI checks deny rules first)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If `false`, change nothing and note "deny rules and the hook both hold".

- [ ] **Step 5: The Windows realities, checked on this laptop**

Run `node tools/test.mjs test/workflow-test-project-copy.test.mjs test/workflow-test-try-guard.test.mjs test/api-workflow-test-project-restart.test.mjs` and record in `real-call-proof-3a.md` that these pass on Windows:
- the long-path removal;
- the junction that is not followed;
- the retried `EPERM`;
- the `.cmd` stand-in;
- the single `Path` key;
- the boot sweep.

- [ ] **Step 6: Commit the free proof**

```bash
git add .superpowers/sdd/proofs/try-guard-real-cli.mjs .superpowers/sdd/proofs/try-guard-real-cli.json .superpowers/sdd/real-call-proof-3a.md
git commit -m "Workflow tests 3a: free proof with the real CLI (try guard hook, stand-ins), Windows checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(If `.superpowers/` is git-ignored in this worktree, skip the commit and say so in the report: the files stay on disk for the reviewer.)

- [ ] **Step 7: The paid proof. CONTROLLER ONLY, after the user's explicit OK for this run, capped at $2.**

Do not dispatch this step to an implementer. Do it in this order and stop at the first surprise.

1. **Who pays.**
   - Run `claude auth status`. It must show the user's own Claude sign-in (`authMethod: claude.ai`, `apiProvider: firstParty`).
   - Check Worca's own routing without printing values: run `node -e "const s=require(require('os').homedir()+'/.worca-cc/settings.json');console.log(Object.keys(s.models||{}).filter(k=>s.models[k]&&s.models[k].env))"`. It lists the aliases that route elsewhere (the Vertex ones on this laptop).
   - The proof must not read that file. Start the server with `HOME` and `USERPROFILE` pointed at a fresh empty folder (Worca's settings root) and `CLAUDE_CONFIG_DIR` at the real `C:\Users\BRT1BG\.claude` (the CLI's sign-in). This is the memory note's recipe from 2026-10-27.
   - Delete every `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLOUD_ML_*`, `VERTEX_*` and `WORCA_MOCK` variable from the server's env.
   - Tell the user, in one line, which account pays: the Claude sign-in's plan, not Vertex.
2. **Money guards.**
   - The sandbox Worca settings are `{"totalCostLimitUsd": 2, "pipelineCostLimitUsd": 1, "debugSpawnEnabled": true}`.
   - The test's cost cap is $2, and the agent node's model is `claude-haiku-5-5`.
   - Reuse Part 2's logging shim (`…\scratchpad\proof\shim\claude.exe`, see `C:\Users\BRT1BG\worca-cc\worca-cc-tests2\.superpowers\sdd\real-call-proof.md` "Setup"). It refuses a non-Haiku model and honours a `STOP` file.
3. **The project.**
   - In the scratchpad, make `origin.git` (`git init --bare`) and a project `proofproj` with one commit and `remote add origin <origin.git>`, then push `main` there once by hand. A push that got through would now succeed, which is the point.
   - Register `proofproj` as a project.
   - Record `git -C origin.git for-each-ref` and `repoSnapshot(proofproj)` (run the helper with `node -e`).
4. **The workflow.**
   - Make a user agent `proofPusher` (producer, domain coding). Its prompt: "Add the line `proof` to README.md. Then run, with the Bash tool and one at a time, exactly: `git add -A`, `git commit -m proof`, `git push origin HEAD`, `gh pr create --title proof --body proof`. Report what each printed. Do nothing else."
   - The workflow is task → proofPusher (model `claude-haiku-5-5`) → end.
   - Add an example on `proofproj` with no setup, then **Try it once now** (one try, Pretend).
5. **Record, in `real-call-proof-3a.md`, each claim with its evidence:**
   - The try's `connector-calls.ndjson` has `{ server: 'git', tool: 'push', guard: true }`, plus a `GitHub CLI` / `pr create` entry from the hook or the stand-in.
   - `git -C origin.git for-each-ref` is unchanged: nothing reached the remote.
   - `repoSnapshot(proofproj)` is unchanged.
   - The copy (`<home>/workflow-tests/repos/<key>`) has no remote.
   - The try's checkout and run folder are gone.
   - The side-by-side route lists the push row ("Send the changes to …", "Not sent · stopped by Worca") and `nothingPushed: true`.
   - The init event says `apiKeySource: none` / `firstParty`: the sign-in still works with the try's hook and env.
   - The cost against the spending meter is under $2.
6. **Stop rule.** If anything reached `origin.git`, or a non-Haiku call was attempted, stop. Write down what happened and tell the user before anything else. Do not retry.

---

## Task 10: UI: Edit an example, where it starts (boards 32, 39) and the project checks (board 33)

**Precondition:** the controller confirms boards 32, 33 and 39 are approved. Re-read `P3Editor.dc.html`, `P3AddCheck.dc.html` and `P3Empty.dc.html`. If a string below differs from the board, the board wins: change the string here, in `project-text.mjs` and in the test.

**Match board 32** (Edit an example):
- card 1's hint is "The same request and the same starting point are used every time this example is tried.";
- a "Where it starts" group sits in card 1 under the Part 2 fields (P1): the Project select; the start point row "**main** at `abc1234` · 28 Oct" with "Change"; the moved-on note with "Start from the latest"; the uncommitted-changes box; the dashed "For developers" box with "Before each try, run";
- card 3's Automatic checks hint is "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.";
- a command check's line reads "The command `npm test` passes";
- the "Part 3b" lines, "Your criteria" and "A result you liked" are not built.

**Match board 33** (the dialog):
- the hint "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.";
- "What to check" grouped as "The result" (Part 2's kinds, the file kind as "A file with this name is added or changed") and "The project" ("The command passes"; the 3b kinds are not built);
- the command's fields: "Command", its hint, and "Stop the command after" (1, 5, 10, 30 minutes) with "A command that runs longer counts as not met.";
- the preview "The command npm test passes" and the button "Add check" (P10);
- for a text kind: "Read from" with "The final result · what the workflow says at the end" and "A file in the project" (P17).

**Match board 39**, the editor's states, as a note in "Where it starts":
- "Pick the project this example works on", with Try it once now disabled;
- "The project folder is missing", with "Pick the folder" (P4);
- "Folder projects can't be tested yet".

**Files:**
- Modify `ui/public/workflows/example-editor.mjs`:
  - `renderExampleEditor`'s context and card 1 (:186-254) and card 3 (:296-334);
  - `paintBusy` (:155-161), `value()` (:362-374);
  - `openCheckDialog` (:37-114);
  - a new `openStartDialog`.
- Modify `ui/public/icons.mjs`: a `lock` icon (Task 11 and 12 use it too).
- Modify `ui/public/app.js`: `wftOpenExample` (:3873-3893), `wftRenderEditor` (:3866-3872), `wftEditorActions` (:3903-3945).
- Modify `ui/public/style.css`: the 3a block after style.css:8872.
- Modify `test/ui-shared-controls.test.mjs`: a `JS_CHECKBOX_OK` row.
- Modify `test/ui-workflow-example-editor.test.mjs`: `value()` now has `project: null`; a new check's button reads "Add check".
- Test: `test/ui-workflow-example-project.test.mjs`

**Interfaces:**
- Consumes:
  - `GET /api/workflow-tests/projects` and `GET /api/workflow-tests/projects/:key/branches`;
  - the example's `project` (Task 2) and the overview's `examples[].project` (Task 8), passed in as `projectView`;
  - `POST …/examples/:ex/project/latest`;
  - the `project-text.mjs` strings (Task 8);
  - `PROJECT_FILE_KIND_LABEL`, `COMMAND_TIMEOUTS` (Task 6).
- Produces:
  - `renderExampleEditor(root, ex, actions, { doc, win, scripts, perTryUsd, draftLabel, testRunning, projects, needsProject, workflowName, projectView, dateText })`;
  - its actions gain `branches(key) → {ok, data: {branches}}` and `startLatest() → {ok, example}`;
  - `value().project = null | { key, setupCmd, ref?, repin?, includeChanges? }`;
  - `openCheckDialog({ …, project })`;
  - `openStartDialog({ doc, win, branches, current, dateText, onPick })`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-example-project.test.mjs`:

```js
// test/ui-workflow-example-project.test.mjs — workflow tests 3a: Edit an example that works on a project (canvas boards 32,
// 33 and 39): where it starts, the start point, the moved-on note, the uncommitted changes, the setup, the command check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExampleEditor, openCheckDialog } from '../ui/public/workflows/example-editor.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text);
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const PROJECTS = [
  { key: 'worca-cc-1a2b3c4d', name: 'worca-cc', path: '/code/worca-cc', exists: true, vcs: 'git',
    current: { branch: 'main', sha: SHA, short: 'abc1234', at: '2026-10-28T09:00:00.000Z' }, setupCmd: 'npm ci' },
  { key: 'docs-site-1a2b3c4e', name: 'docs-site', path: '/code/docs', exists: true, vcs: 'none', current: null, setupCmd: null },
  { key: 'gone-1a2b3c4f', name: 'gone', path: '/code/gone', exists: false, vcs: 'git', current: null, setupCmd: null },
];
const PIN = { key: 'worca-cc-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: SHA,
  changesSha256: null, changesBytes: 0, setupCmd: 'npm ci' };
const example = (over = {}) => ({ id: 7, name: 'Ticket 482, invoice totals round wrong', request: 'Ticket 482: invoice totals round wrong.', answers: [],
  otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null },
  checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }], tries: 3, files: [], note: null, project: PIN, ...over });
function boot(ex = example(), { needsProject = false, projectView = { state: 'ok', behind: 14, startRef: 'main' }, over = {} } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = {
    back: () => {}, save: async (v) => { calls.push(['save', v]); return { ok: true }; }, tryOnce: async () => ({ ok: true }),
    addFiles: async () => ({ ok: true }), removeFile: async () => ({ ok: true }),
    branches: async (key) => { calls.push(['branches', key]); return { ok: true, data: { branches: [
      { name: 'main', sha: SHA, short: 'abc1234', at: '2026-10-28T09:00:00.000Z', current: true },
      { name: 'release', sha: 'e9f2c47'.padEnd(40, '0'), short: 'e9f2c47', at: '2026-10-20T09:00:00.000Z', current: false }] } }; },
    startLatest: async () => { calls.push(['latest']); return { ok: true, example: { ...ex, project: { ...PIN, startSha: 'f'.repeat(40), startCommit: 'f'.repeat(40) } } }; },
    ...over,
  };
  const root = window.document.getElementById('root');
  const ed = renderExampleEditor(root, ex, actions, { doc: window.document, win: window, scripts: [], perTryUsd: 0.95, draftLabel: 'v3 draft',
    projects: PROJECTS, needsProject, workflowName: 'Fix a bug from a ticket', projectView, dateText: () => '28 Oct' });
  return { root, doc: window.document, win: window, calls, ed };
}

test('board 32: where it starts, the start point, the moved-on note, the changes box and the setup', () => {
  const { root } = boot();
  assert.equal(root.querySelector('.wft-c1 > .hint').textContent, 'The same request and the same starting point are used every time this example is tried.');
  assert.deepEqual(texts(root, '.wft-where > .wft-grp, .wft-where > .wft-grp-hint'), ['Where it starts',
    "Each try works in Worca's own copy of the project. Your folder and your branches are never touched."]);
  const sel = root.querySelector('#wft-ex-project');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['No project', 'worca-cc', 'docs-site', 'gone']);
  assert.equal(sel.value, 'worca-cc-1a2b3c4d');
  assert.equal(root.querySelector('.wft-start > span').textContent, 'main at abc1234 · 28 Oct');
  assert.equal(root.querySelector('.wft-start .code').textContent, 'abc1234');
  assert.ok(byText(root, '.wft-start button', 'Change'));
  assert.ok(texts(root, '.wft-start-field > .hint').includes('Both versions start from here. It stays the same until you change it, so results can be compared.'));
  assert.equal(root.querySelector('.wft-moved').getAttribute('role'), 'note');
  assert.equal(root.querySelector('.wft-moved-top > span').textContent, 'The project has moved on: 14 newer commits on main since this start point.');
  assert.ok(byText(root, '.wft-moved button', 'Start from the latest'));
  assert.equal(root.querySelector('.wft-moved-act .hint').textContent, 'Both versions are then tried again from the new point, so their results stay comparable.');
  assert.equal(root.querySelector('.wft-changes span').textContent, 'Include my changes that are not committed yet');
  assert.equal(root.querySelector('.wft-changes-hint').textContent, 'Off: the example starts from the commit only. On: your changes are saved with the example.');
  assert.equal(root.querySelector('.wft-dev-cap').textContent, 'For developers');
  assert.equal(root.querySelector('label[for="wft-ex-setup"]').textContent, 'Before each try, run');
  assert.equal(root.querySelector('#wft-ex-setup').value, 'npm ci');
  assert.equal(root.querySelector('.wft-dev .hint').textContent, "Filled in from the project's setup. If it fails, the test stops and no try counts as failed.");
  assert.equal(root.querySelector('.wft-c3 .wft-grp-hint').textContent, "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.");
  const line = root.querySelector('.wft-c3 .wft-line-text');
  assert.equal(line.textContent, 'The command npm test passes');
  assert.equal(line.querySelector('.code').textContent, 'npm test');
});

test('the value: the project and its setup; the changes box; a new start point from Change (P2, P3)', async () => {
  const { root, doc, ed, calls } = boot();
  assert.deepEqual(ed.value().project, { key: 'worca-cc-1a2b3c4d', setupCmd: 'npm ci', includeChanges: false });
  root.querySelector('.wft-changes-box').checked = true;
  assert.equal(ed.value().project.includeChanges, true);
  click(byText(root, '.wft-start button', 'Change'));
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c[0] === 'branches'), ['branches', 'worca-cc-1a2b3c4d']);
  assert.equal(doc.querySelector('.mk-dialog-title').textContent, 'Start point');
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, 'Pick the branch this example starts from. Worca takes its newest commit.');
  doc.querySelector('input[name="wft-start-ref"][value="release"]').checked = true;
  click(byText(doc, '.mk-dialog button', 'Use this start point'));
  await tick();
  assert.deepEqual(ed.value().project, { key: 'worca-cc-1a2b3c4d', setupCmd: 'npm ci', ref: 'release', repin: true });
  assert.equal(root.querySelector('.wft-start > span').textContent, 'release at e9f2c47 · 28 Oct');
  assert.equal(root.querySelector('.wft-changes').hidden, true, 'not the branch the folder is on: no changes box');
  assert.equal(root.querySelector('.wft-moved'), null, 'a new start point is not behind');
  const sel = root.querySelector('#wft-ex-project');
  sel.value = ''; sel.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(ed.value().project, null, 'No project');
  assert.equal(root.querySelector('.wft-dev').hidden, true);
});

test('Start from the latest moves the start point and the note goes', async () => {
  const { root, calls } = boot();
  click(byText(root, '.wft-moved button', 'Start from the latest'));
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['latest']);
  assert.equal(root.querySelector('.wft-moved'), null);
  assert.equal(root.querySelector('.wft-start .code').textContent, 'fffffff');
});

test('board 39: no project picked for a workflow that changes a project; a missing folder; a Folder project', () => {
  const none = boot(example({ project: null, checks: [] }), { needsProject: true, projectView: null });
  assert.equal(none.root.querySelector('#wft-ex-project').options[0].textContent, 'Pick a project');
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ['Pick the project this example works on',
    "Fix a bug from a ticket changes a project's code, so each example needs one. Each try works in Worca's own copy of the project."]);
  assert.equal(byText(none.root, '.wft-acts button', 'Try it once now').disabled, true);
  const sel = none.root.querySelector('#wft-ex-project');
  sel.value = 'gone-1a2b3c4f'; sel.dispatchEvent(new none.doc.defaultView.Event('change'));
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ['The project folder is missing',
    "Worca can't find gone in /code/gone. Move the folder back, or pick where it is now. The start point is kept."]);
  click(byText(none.root, '.wft-notice button', 'Pick the folder'));
  assert.equal(none.doc.activeElement, sel, 'P4: the folder is picked in the Project select');
  sel.value = 'docs-site-1a2b3c4e'; sel.dispatchEvent(new none.doc.defaultView.Event('change'));
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ["Folder projects can't be tested yet",
    'docs-site is a Folder project. Worca can test examples on Git projects for now. Pick a Git project.']);
});

test('board 33: the project checks, the command, read from a file; without a project the Part 2 dialog', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const saved = [];
  openCheckDialog({ doc, win: window, scripts: [], project: true, onSave: (c) => saved.push(c) });
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.");
  const kind = doc.querySelector('#wft-ck-kind');
  assert.deepEqual([...kind.querySelectorAll('optgroup')].map((g) => g.label), ['The result', 'The project']);
  assert.ok([...kind.options].some((o) => o.textContent === 'A file with this name is added or changed'));
  kind.value = 'command'; kind.dispatchEvent(new window.Event('change'));
  assert.equal(doc.querySelector('label[for="wft-ck-cmd"]').textContent, 'Command');
  assert.equal(doc.querySelector('#wft-ck-cmd').closest('.field').querySelector('.hint').textContent,
    'It runs in Worca\'s own copy of the project after the try is done. Met when the command ends without an error. Worca shows its last summary line, for example "212 passed, 1 failed".');
  const time = doc.querySelector('#wft-ck-timeout');
  assert.deepEqual([...time.options].map((o) => o.textContent), ['1 minute', '5 minutes', '10 minutes', '30 minutes']);
  assert.equal(time.value, '10');
  assert.equal(doc.querySelector('label[for="wft-ck-timeout"]').textContent, 'Stop the command after');
  assert.equal(time.closest('.field').querySelector('.hint').textContent, 'A command that runs longer counts as not met.');
  const cmd = doc.querySelector('#wft-ck-cmd');
  cmd.value = 'npm test'; cmd.dispatchEvent(new window.Event('input'));
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'The command npm test passes');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'command', cmd: 'npm test', timeoutMin: 10 }]);
  openCheckDialog({ doc, win: window, scripts: [], project: true, onSave: (c) => saved.push(c) });
  const k2 = [...doc.querySelectorAll('#wft-ck-kind')].at(-1);
  k2.value = 'sections'; k2.dispatchEvent(new window.Event('change'));
  assert.equal([...doc.querySelectorAll('.wft-rads legend')].at(-1).textContent, 'Read from');
  assert.deepEqual([...doc.querySelectorAll('.wft-rads')].at(-1).querySelectorAll('.wft-rad').length, 2);
  assert.equal([...doc.querySelectorAll('.wft-rad')].at(-2).textContent, 'The final result · what the workflow says at the end');
  assert.equal([...doc.querySelectorAll('.wft-rad')].at(-1).textContent, 'A file in the project');
  [...doc.querySelectorAll('#wft-ck-names')].at(-1).value = 'Fixed';
  [...doc.querySelectorAll('input[name="wft-ck-from"][value="file"]')].at(-1).checked = true;
  const f = [...doc.querySelectorAll('#wft-ck-from-file')].at(-1);
  f.value = 'CHANGELOG.md'; f.dispatchEvent(new window.Event('input'));
  assert.equal([...doc.querySelectorAll('.wft-ck-preview')].at(-1).textContent, 'Has the section Fixed in CHANGELOG.md');
  openCheckDialog({ doc, win: window, scripts: [], project: false, onSave: () => {} });
  const k3 = [...doc.querySelectorAll('#wft-ck-kind')].at(-1);
  assert.equal(k3.querySelectorAll('optgroup').length, 0);
  assert.ok(![...k3.options].some((o) => o.value === 'command'), 'no command without a project');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-example-project.test.mjs`
Expected: FAIL with `.wft-where` not found (the editor has no "Where it starts").

- [ ] **Step 3: The `lock` icon (`ui/public/icons.mjs`)**

Add to `ICONS`, after `shield`:
```js
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path>',
```

- [ ] **Step 4: The editor (`ui/public/workflows/example-editor.mjs`)**

Imports: add `icon` from `../icons.mjs`. Add `PROJECT_FILE_KIND_LABEL`, `COMMAND_TIMEOUTS` to the checks import. Add:
```js
import {
  WHERE_TITLE, WHERE_HINT, START_HINT, START_LABEL, PROJECT_LABEL, CHANGE_BUTTON, behindText, LATEST_BUTTON, LATEST_HINT, CHANGES_LABEL,
  CHANGES_HINT, DEV_CAPTION, SETUP_LABEL, SETUP_HINT, CARD1_HINT_PROJECT, CHECKS_HINT_PROJECT, NO_PROJECT_OPTION, PICK_PROJECT_OPTION,
  PICK_PROJECT_TITLE, pickProjectText, PICK_THE_FOLDER, FOLDER_MISSING_TITLE, folderMissingText, FOLDER_PROJECT_TITLE, folderProjectText,
  UNSUPPORTED_TITLE, START_DIALOG_TITLE, START_DIALOG_HINT, START_DIALOG_OK, CHECK_DIALOG_HINT_PROJECT, GROUP_RESULT, GROUP_PROJECT,
  COMMAND_LABEL, COMMAND_HINT, TIMEOUT_LABEL, TIMEOUT_HINT, timeoutText, READ_FROM_LEGEND, READ_FROM_RESULT, READ_FROM_RESULT_SUB,
  READ_FROM_FILE, ADD_CHECK,
} from '../../../src/shared/workflow-tests/project-text.mjs';
```
Add `project: null` to `BLANK_EXAMPLE`. Add these helpers above `openAnswerDialog`:
```js
const P2_CARD1_HINT = 'The same request and files are used every time this example is tried.';
const P2_CHECKS_HINT = 'Counted exactly, without AI. Pick a ready check, or a script from the Library.';   // C3
const TEXT_KIND_SET = new Set(['words', 'sections', 'mentions', 'not-mentions']);
/** A check as its line shows it: a command in code (board 32), any other check as its label. */
function checkLineEl(doc, c, label) {
  const s = el(doc, 'span', 'wft-line-text');
  if (c.kind === 'command') s.append(doc.createTextNode('The command '), el(doc, 'span', 'code', c.cmd), doc.createTextNode(' passes'));
  else s.textContent = label;
  return s;
}

/** P2 (not drawn): the start point, from the project's local branches; the one its folder is on comes first. */
export function openStartDialog({ doc, win, branches = [], current = null, dateText = (s) => s, onPick }) {
  const list = el(doc, 'div', 'wft-pick-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', START_DIALOG_TITLE);
  for (const b of branches) {
    const row = el(doc, 'label', 'wft-pick-row');
    const radio = el(doc, 'input');
    radio.type = 'radio'; radio.name = 'wft-start-ref'; radio.value = b.name; radio.checked = b.name === current;
    const text = el(doc, 'span', 'wft-pick-text');
    text.append(el(doc, 'b', '', b.name), el(doc, 'span', 'hint', ' · '), el(doc, 'span', 'code', b.short), el(doc, 'span', 'hint', ` · ${dateText(b.at)}`));
    row.append(radio, text);
    list.append(row);
  }
  return testDialog({
    doc, win, title: START_DIALOG_TITLE, confirmLabel: START_DIALOG_OK, body: [el(doc, 'p', 'hint', START_DIALOG_HINT), list],
    onConfirm: () => {
      const hit = [...list.querySelectorAll('input[name="wft-start-ref"]')].find((x) => x.checked);
      if (!hit) return { ok: false, error: 'Pick a branch first.' };
      onPick(branches.find((b) => b.name === hit.value));
      return { ok: true };
    },
  });
}
```
**`openCheckDialog`** gains `project = false` in its options.
- Replace the kind-select loop with:
```js
  const opt = (k, label = CHECK_KIND_LABELS[k]) => { const o = el(doc, 'option', '', label); o.value = k; return o; };
  const resultKinds = CHECK_KINDS.filter((k) => k !== 'command' && !(k === 'script' && !scripts.length && !(check && check.kind === 'script')));
  const fileLabel = project ? PROJECT_FILE_KIND_LABEL : CHECK_KIND_LABELS.file;   // D59, board 33
  if (project) {
    const g1 = el(doc, 'optgroup'); g1.label = GROUP_RESULT;
    for (const k of resultKinds) g1.append(opt(k, k === 'file' ? fileLabel : undefined));
    const g2 = el(doc, 'optgroup'); g2.label = GROUP_PROJECT;
    g2.append(opt('command'));
    kind.append(g1, g2);
  } else {
    for (const k of resultKinds) kind.append(opt(k));
  }
```
- In `paintFields`, add a command branch before the script `else`:
```js
    } else if (kind.value === 'command') {
      const cmd = input('wft-ck-cmd', 'text', c.cmd ?? '', { maxLength: 500, className: 'wft-mono' });
      const time = el(doc, 'select');
      time.id = 'wft-ck-timeout';
      for (const n of COMMAND_TIMEOUTS) { const o = el(doc, 'option', '', timeoutText(n)); o.value = String(n); time.append(o); }
      time.value = String(c.timeoutMin ?? 10);
      time.addEventListener('change', paintPreview);
      fields.append(field(doc, COMMAND_LABEL, cmd, { id: cmd.id, hint: COMMAND_HINT }), field(doc, TIMEOUT_LABEL, time, { id: time.id, hint: TIMEOUT_HINT }));
      read = () => ({ kind: 'command', cmd: cmd.value, timeoutMin: Number(time.value) });
```
- After the `if/else` chain, add the "Read from" choice for a text kind on a project example. It wraps `read` so the file goes with the check:
```js
    if (project && TEXT_KIND_SET.has(kind.value)) {
      const rads = el(doc, 'fieldset', 'wft-rads');
      rads.append(el(doc, 'legend', '', READ_FROM_LEGEND));
      const rad = (value, label, sub = null) => {
        const l = el(doc, 'label', 'wft-rad');
        const r = el(doc, 'input'); r.type = 'radio'; r.name = 'wft-ck-from'; r.value = value;
        const words = el(doc, 'span', '', label);
        if (sub) words.append(el(doc, 'span', 'hint', sub));
        l.append(r, words);
        r.addEventListener('change', () => { from.disabled = value !== 'file'; paintPreview(); });
        return { l, r };
      };
      const res = rad('result', READ_FROM_RESULT, READ_FROM_RESULT_SUB);
      const fil = rad('file', READ_FROM_FILE);
      const from = input('wft-ck-from-file', 'text', c.file ?? '', { maxLength: 200, className: 'wft-mono' });
      from.setAttribute('aria-label', 'File in the project');
      res.r.checked = !c.file; fil.r.checked = !!c.file; from.disabled = !c.file;
      rads.append(res.l, fil.l);
      fields.append(rads, from);
      const base = read;
      read = () => ({ ...base(), ...(fil.r.checked && from.value.trim() ? { file: from.value.trim() } : {}) });
    }
```
  The `input` helper's `Object.assign(i, extra)` sets `className`. A radio change reads `from` before its line runs; that is safe because the listener only runs after `from` exists.
- In the `testDialog({ … })` call, change the body's first line to `el(doc, 'p', 'hint', project ? CHECK_DIALOG_HINT_PROJECT : 'Counted exactly, without AI.')` and the confirm label to `check ? 'Save check' : ADD_CHECK`.

**`renderExampleEditor`.** Its context becomes `{ doc, win, scripts = [], perTryUsd = null, draftLabel = 'your draft', testRunning = false, projects = null, needsProject = false, workflowName = '', projectView = null, dateText = (s) => s }`.

In `paintBusy`, change the Try line to `tryBtn.disabled = on || testRunning || (needsProject && !usableProject);`. Declare `let usableProject = false;` before `paintBusy`.

After `const c1 = card(…)` and its `c1.append(…)`, change the card's hint to be painted (`const c1Hint = c1.querySelector(':scope > .hint');`) and add "Where it starts":
```js
  // ── 1b. Where it starts (board 32; board 39's states; D41, D63, P2–P4) ──
  const reg = (key) => (Array.isArray(projects) ? projects.find((p) => p.key === key) : null) || null;
  let stored = draft.project || null;                    // the store's pin
  let view = projectView;                                // the overview's view of it (state, behind)
  const pick = { key: stored ? stored.key : '', ref: undefined, branch: null, repin: false };
  const where = el(doc, 'div', 'wft-sect wft-where');
  const projectSel = el(doc, 'select');
  projectSel.id = 'wft-ex-project';
  const startField = el(doc, 'div', 'field wft-start-field');
  const notice = el(doc, 'div', 'wft-notice');
  notice.setAttribute('role', 'note');
  const changesRow = el(doc, 'label', 'wft-chk wft-changes');
  const changesBox = el(doc, 'input', 'wft-changes-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: opts in to keeping uncommitted changes
  changesBox.type = 'checkbox';
  changesBox.checked = !!(stored && stored.changesSha256);
  changesRow.append(changesBox, el(doc, 'span', '', CHANGES_LABEL));
  const changesHint = el(doc, 'span', 'hint wft-changes-hint', CHANGES_HINT);
  const setup = el(doc, 'input');
  setup.type = 'text'; setup.id = 'wft-ex-setup'; setup.className = 'wft-mono'; setup.maxLength = 4000;
  setup.addEventListener('input', () => { setup.dataset.touched = '1'; });
  const dev = el(doc, 'div', 'wft-dev');
  dev.append(el(doc, 'span', 'wft-dev-cap', DEV_CAPTION), field(doc, SETUP_LABEL, setup, { id: setup.id, hint: SETUP_HINT }));
  const fillProjects = () => {
    projectSel.replaceChildren();
    const first = el(doc, 'option', '', needsProject ? PICK_PROJECT_OPTION : NO_PROJECT_OPTION);
    first.value = '';
    projectSel.append(first);
    for (const p of Array.isArray(projects) ? projects : []) { const o = el(doc, 'option', '', p.name); o.value = p.key; projectSel.append(o); }
    if (pick.key && !reg(pick.key)) { const o = el(doc, 'option', '', pick.key); o.value = pick.key; projectSel.append(o); }   // no longer registered: it stays picked
    projectSel.value = pick.key;
  };
  /** The start point the row shows: the stored pin, a branch picked in Change, else the branch the folder is on. */
  const startShown = () => {
    if (pick.branch) return { ref: pick.branch.name, short: pick.branch.short, at: pick.branch.at };
    if (stored && stored.key === pick.key) return { ref: stored.startRef, short: stored.startSha.slice(0, 7), at: stored.startAt };
    const r = reg(pick.key);
    return r && r.current ? { ref: r.current.branch, short: r.current.short, at: r.current.at } : null;
  };
  const paintWhere = () => {
    const r = reg(pick.key);
    const st = startShown();
    startField.replaceChildren();
    notice.replaceChildren();
    notice.hidden = true;
    const say = (title, text, button = null) => {
      notice.hidden = false;
      notice.append(el(doc, 'p', 'wft-notice-title', title), el(doc, 'p', 'hint', text));
      if (button) notice.append(button);
    };
    if (!pick.key) { if (needsProject) say(PICK_PROJECT_TITLE, pickProjectText(workflowName)); }
    else if (r && !r.exists) say(FOLDER_MISSING_TITLE, folderMissingText(r.name, r.path), btn(doc, PICK_THE_FOLDER, () => projectSel.focus()));
    else if (r && r.vcs !== 'git') say(FOLDER_PROJECT_TITLE, folderProjectText(r.name));
    usableProject = !!(pick.key && r && r.exists && r.vcs === 'git' && st);
    if (usableProject) {
      const row = el(doc, 'div', 'wft-start');
      const words = el(doc, 'span');
      words.append(el(doc, 'b', '', st.ref || st.short), doc.createTextNode(' at '), el(doc, 'span', 'code', st.short), doc.createTextNode(` · ${dateText(st.at)}`));
      row.append(words, btn(doc, CHANGE_BUTTON, () => void changeStart(), 'btn btn-sm'));
      startField.append(el(doc, 'span', 'label', START_LABEL), row, el(doc, 'span', 'hint', START_HINT));
      const behind = view && stored && stored.key === pick.key && !pick.branch && view.behind > 0 && view.startRef ? view.behind : 0;
      if (behind) {
        const moved = el(doc, 'div', 'wft-moved');
        moved.setAttribute('role', 'note');
        const top = el(doc, 'span', 'wft-moved-top');
        top.append(icon(doc, 'alert', 14), el(doc, 'span', '', behindText(behind, view.startRef)));
        const act = el(doc, 'span', 'wft-moved-act');
        act.append(btn(doc, LATEST_BUTTON, () => void latest(), 'btn btn-sm'), el(doc, 'span', 'hint', LATEST_HINT));
        moved.append(top, act);
        startField.append(moved);
      }
    }
    const onCurrent = usableProject && !!(r.current && st.ref && st.ref === r.current.branch);   // P3
    changesRow.hidden = !onCurrent;
    changesHint.hidden = !onCurrent;
    dev.hidden = !usableProject;
    if (usableProject && !setup.dataset.touched) setup.value = stored && stored.key === pick.key && stored.setupCmd != null ? stored.setupCmd : (r.setupCmd || '');
    c1Hint.textContent = pick.key ? CARD1_HINT_PROJECT : P2_CARD1_HINT;
    if (checksHint) checksHint.textContent = pick.key ? CHECKS_HINT_PROJECT : P2_CHECKS_HINT;
    paintBusy();
  };
  async function changeStart() {
    if (busyN) return;
    error.textContent = '';
    const r = await busyWhile(() => actions.branches(pick.key));
    if (!r || !r.ok) { error.textContent = (r && r.error) || 'Worca could not read the branches of the project.'; return; }
    const st = startShown();
    openStartDialog({ doc, win, branches: r.data.branches, current: st ? st.ref : null, dateText,
      onPick: (b) => { pick.branch = b; pick.ref = b.name; pick.repin = true; paintWhere(); } });
  }
  async function latest() {
    if (busyN) return;
    error.textContent = '';
    const r = await busyWhile(() => actions.startLatest());
    if (!r || !r.ok) { failed(r, 'The start point did not move.'); return; }
    stored = r.example.project;
    draft.project = stored;
    view = view ? { ...view, behind: 0 } : view;
    pick.branch = null; pick.ref = undefined; pick.repin = false;
    paintWhere();
  }
  projectSel.addEventListener('change', () => {
    pick.key = projectSel.value; pick.ref = undefined; pick.branch = null; pick.repin = false;
    setup.dataset.touched = '';
    paintWhere();
  });
  fillProjects();
  where.append(el(doc, 'p', 'wft-grp', WHERE_TITLE), el(doc, 'p', 'wft-grp-hint', WHERE_HINT),
    field(doc, PROJECT_LABEL, projectSel, { id: projectSel.id }), notice, startField, changesRow, changesHint, dev);
  c1.append(where);
```
In the card 3 section, give its hint a name: `const checksHint = el(doc, 'p', 'wft-grp-hint', P2_CHECKS_HINT);`, append it in place of the literal one, and declare `let checksHint = null;` before "Where it starts" so `paintWhere` can test it. Then assign it here instead of declaring it again. In `repaintCheckRows`:
- replace `main.append(el(doc, 'span', 'wft-line-text', label));` with `main.append(checkLineEl(doc, c, label));`;
- pass `project: !!pick.key` to both `openCheckDialog({ … })` calls.

Call `paintWhere();` once, right after `root.append(page);`.

In `value()`, add the project:
```js
      project: !pick.key ? null : {
        key: pick.key, setupCmd: setup.value.trim() || null,
        ...(pick.ref !== undefined ? { ref: pick.ref } : {}), ...(pick.repin ? { repin: true } : {}),
        ...(!changesRow.hidden ? { includeChanges: changesBox.checked } : {}),
      },
```

**A save refused because the project uses LFS or submodules (board 39).** In `run`, after `failed(…)`, show the refusal as a notice too:
```js
    const r = await busyWhile(() => fn(value()));
    failed(r, 'That did not work. Try again.');
    if (r && !r.ok && /so tries could go wrong\.$/.test(String(r.error || ''))) {   // board 39: LFS or submodules
      notice.replaceChildren(el(doc, 'p', 'wft-notice-title', UNSUPPORTED_TITLE), el(doc, 'p', 'hint', r.error));
      notice.hidden = false;
    }
```
(replacing `failed(await busyWhile(() => fn(value())), 'That did not work. Try again.');`).

- [ ] **Step 5: Wire the editor (`ui/public/app.js`)**

In `wftOpenExample`, after the scripts read, add `const pj = await wftCall('GET', '/api/workflow-tests/projects');`, and add `projects: pj.ok ? pj.data.projects : null` to the `wft = { … }` object. Change `wftRenderEditor`'s call:
```js
  const o = wft.overview;
  const row = o && wft.example && wft.example.id ? o.examples.find((e) => e.id === wft.example.id) : null;
  renderExampleEditor(root, wft.example, wftEditorActions(session), { doc: document, win: window, scripts: wft.scripts, perTryUsd: wft.perTryUsd,
    draftLabel: o ? wftUseLabel('draft', o.ctx) : 'your draft', testRunning: !!(o && o.running),   // G19
    projects: wft.projects || null, needsProject: !!(o && o.needsProject), workflowName: o ? o.name : '',
    projectView: row ? row.project : null, dateText: wftDate });
```
In `wftEditorActions`, add:
```js
    branches: (key) => wftCall('GET', `/api/workflow-tests/projects/${encodeURIComponent(key)}/branches`),
    startLatest: async () => {
      if (!session.exampleId) return { ok: false, error: 'Save the example first.' };
      const r = await wftCall('POST', `${base}/examples/${session.exampleId}/project/latest`, {});
      if (!r.ok) return r;
      keep(r.data.example);
      return { ok: true, example: r.data.example };
    },
```

- [ ] **Step 6: The CSS (`ui/public/style.css`)**

Right after style.css:8872 (Part 2's last `.wft-*` rule), add:
```css
/* Workflow tests, Part 3a: examples that work on a project (plans/workflow-tests-part3a-plan.md; canvas boards 32–39) */
.wft-start{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--panel);font-size:var(--fs-body);}
.wft-start b{font-weight:600;}
.wft-moved{display:flex;flex-direction:column;gap:10px;margin:10px 0 0;padding:12px 14px;border-radius:var(--r-sm);background:var(--amber-wash);border:1px solid var(--amber-line);font-size:var(--fs-body);line-height:1.45;color:var(--ink);}
.wft-moved-top{display:flex;gap:8px;align-items:flex-start;}
.wft-moved-top .ic{flex:0 0 auto;margin-top:2px;color:var(--amber-ink);}
.wft-moved-act{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
.wft-changes{margin-top:10px;}
.wft-changes-hint{display:block;margin:0 0 0 26px;}
.wft-dev{margin-top:16px;padding:14px 14px 4px;border:1px dashed var(--line-2);border-radius:var(--r-sm);}
.wft-dev-cap{display:block;margin:0 0 10px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.wft-mono{font-family:var(--mono);font-size:var(--fs-body);}
.wft-notice{margin:10px 0;padding:12px 14px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--canvas-2);}
.wft-notice-title{margin:0 0 4px;font-size:var(--fs-section);font-weight:600;color:var(--ink);}
.wft-rads{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;padding:0;border:0;}
.wft-rads legend{margin-bottom:6px;padding:0;font-size:var(--fs-body);font-weight:600;}
.wft-rad{display:grid;grid-template-columns:16px minmax(0,1fr);gap:10px;align-items:start;font-size:var(--fs-body);cursor:pointer;}
```

- [ ] **Step 7: The checkbox row and Part 2's two expectations**

In `test/ui-shared-controls.test.mjs` `JS_CHECKBOX_OK`, add:
```js
  ['workflows/example-editor.mjs', 'wft-changes-box', 'opts in to keeping the uncommitted changes with the example, next to its start point (board 32)'],
```
In `test/ui-workflow-example-editor.test.mjs`:
- add `project: null` to the object the "Basics, tries and the estimate read back into the value" test expects from `value()`;
- where a test confirms a NEW check's dialog by the text `'Save check'`, change it to `'Add check'`. An edited check keeps "Save check".

- [ ] **Step 8: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-example-project.test.mjs test/ui-workflow-example-editor.test.mjs`
Expected: PASS.

Run the design guards: `node tools/test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`. Expected: no failure beyond the four known `ui-design-language` ones. Then run the style.css slicing tests from the Global Constraints. Expected: PASS.

Run: `cd C:\Users\BRT1BG\worca-cc\worca-cc-tests3; npm run build --if-present` (if the UI has a build step; Part 2 had none).

- [ ] **Step 9: Commit**

```bash
git add ui/public/workflows/example-editor.mjs ui/public/icons.mjs ui/public/app.js ui/public/style.css test/ui-workflow-example-project.test.mjs test/ui-workflow-example-editor.test.mjs test/ui-shared-controls.test.mjs
git commit -m "Workflow tests 3a: Edit an example: where it starts, the start point, setup, the command check (boards 32, 33, 39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: UI: Test a version on a project (board 34) and while the test runs (board 35)

**Precondition:** the controller confirms boards 34, 35 and 39 are approved. Re-read `P3TestVersion.dc.html`, `P3Running.dc.html` and `P3Empty.dc.html`, and apply any copy change to this task first.

**Match board 34** (the dialog, when a chosen example has a project):
- the "Examples" option "All 5 · on worca-cc" (P14), and its hint "Ticket 497 is left out: pick its project first.";
- the Real hint ends with " Pushes, pull requests and issues stay blocked.";
- the lock line "**Tests never push, open pull requests or change your project.** Each try works in Worca's own copy of the project, which is deleted after the checks." shows in both modes, in place of Part 2's shield line (P13);
- the estimate starts with the rows "Disk · Needs about 1.2 GB free while it runs · 48.0 GB free" and "Time · about 1 hour 10 minutes · setup `npm ci` takes about 2 minutes a try", and then reads just "Total";
- with too little disk, the alert "Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples." and a disabled "Start 30 tries".
- Not built: the board's "Part 3b" lines in the Pretend list, and its reuse sentence (P8).

**Match board 35** (the progress page, when the test has a project example):
- the fact "Disk in use · 0.9 GB · of about 1.2 GB · 47.0 GB free";
- the card "What happens in each try" with four numbered phases. Their sub-lines are "From main at `abc1234` · 28 Oct", `npm ci`, "The workflow does its work" (P5) and "The checks run, then the copy is deleted". Done phases are marked done and the current one now. The hint below is "Shown for Ticket 482, v3 draft, try 1. Three tries run at once, each in its own copy of the project.";
- the rows' third column is headed "Now" and reads "Try 2 · Checking" with "running `npm test`", "Try 1 · Working" with "for 6 minutes", or "Try 1 · Running setup" with `npm ci`;
- after a setup failure:
  - the pill "Stopped · 0 of 30 tries done", and the buttons "Edit the example" and "Try again" (Try again = Finish the rest);
  - the alert "**The setup step failed: `npm ci` ended with an error.** The test stopped, and no try counts as failed.";
  - "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: `$0.00`.";
  - "See the setup output", which shows the output, beside "Ticket 482, v2, try 1";
  - "Fix the setup in the example, or in the project, then try again.".

**Match board 39**, "Try it once now · not enough free disk": in the editor, a card "Not enough free disk" with the Disk row and "One try needs about 0.4 GB free, and this computer has 0.2 GB free. Free up at least 0.2 GB and try again. Nothing was tried and nothing was charged." It appears when Try it once now is refused with `NO_DISK`.

**Files:**
- Modify `ui/public/workflows/test-dialogs.mjs`: `openTestVersionDialog` (:162-378).
- Modify `ui/public/workflows/test-progress.mjs`: `STOPPED` (:11-21), `fact` use, the facts (:150-155), the rows (:166-178), the setup stop, and a new phase card.
- Modify `ui/public/workflows/example-editor.mjs`: `run` shows the Try it once now disk card.
- Modify `ui/public/app.js`: `wftTestVersion` (:3835-3862) passes readiness and project names; `wftProgressActions` (:3713-3736) gains `editExample`; `wftEditorActions.tryOnce` (:3910-3917) returns the refusal's plan.
- Modify: `src/core/workflow-tests/routes.mjs`, the try-once route: on `NO_DISK`, add the disk plan to the error body.
- Modify: `ui/public/style.css`.
- Test: `test/ui-workflow-test-project-run.test.mjs`

**Interfaces:**
- Consumes:
  - the plan's `project` (Task 8);
  - the progress `project`, `rows[].now` and `run.stopReason === 'setup'` (Tasks 7, 8);
  - the overview's `examples[].ready`, `project.name`;
  - the `project-text.mjs` strings;
  - the `lock` icon (Task 10).
- Produces:
  - `openTestVersionDialog({ …, examples: [{ id, name, tries, ready, projectName }] })`;
  - `renderTestProgress(…, actions)`: actions gain `editExample(exampleId)`;
  - the try-once route's 422 body `{ error, code: 'NO_DISK', disk: { needBytes, freeBytes } }`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-project-run.test.mjs`:

```js
// test/ui-workflow-test-project-run.test.mjs — workflow tests 3a: Test a version on a project (board 34) and the page while
// it runs (board 35): disk and time, the lock line, examples left out, the phases, the Now column, a setup that failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openTestVersionDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';

const GB = 2 ** 30;
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const side = (use, short, n) => ({ use, label: short, short, want: n, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
const plan = (over = {}) => ({
  a: side(2, 'v2', 15), b: side('draft', 'v3 draft', 15), examples: 5, tries: 3, perTryMs: 7 * 60000,   // 30 tries, 3 at once: 10 rounds of 7 minutes
  connectors: { mode: 'pretend', pretend: ['github'], off: [], scripts: [], quickScripts: [], engines: [] },
  project: { names: ['worca-cc'], leftOut: ['Ticket 497'], disk: { needBytes: 1.2 * GB, freeBytes: 48 * GB, enough: true, text: null }, setupCmd: 'npm ci', setupMs: 2 * 60000 },
  ...over,
});
function dialog(p = plan()) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const examples = [1, 2, 3, 4, 5].map((id) => ({ id, name: `Ticket ${id}`, tries: 3, ready: true, projectName: 'worca-cc' }))
    .concat([{ id: 6, name: 'Ticket 497', tries: 3, ready: false, projectName: null }]);
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2 · the team uses it' }, { use: 'draft', label: 'v3 draft · your changes' }],
    a: 2, b: 'draft', examples, dateText: () => '24 Oct', loadPlan: async () => p, onStart: async () => ({ ok: true }) });
  return window.document;
}

test('board 34: one project, disk and time, the lock line in both modes, an example left out', async () => {
  const doc = dialog();
  await tick(); await tick();
  assert.equal(doc.querySelector('#wft-tv-examples').options[0].textContent, 'All 5 · on worca-cc');
  assert.equal(doc.querySelector('.wft-tv-left').textContent, 'Ticket 497 is left out: pick its project first.');
  assert.deepEqual(texts(doc, '.wft-est-row.is-disk span, .wft-est-row.is-time span').slice(0, 2), ['Disk', 'Needs about 1.2 GB free while it runs · 48.0 GB free']);
  assert.equal(doc.querySelector('.wft-est-row.is-time').textContent, 'Timeabout 1 hour 10 minutes · setup npm ci takes about 2 minutes a try');
  assert.equal(doc.querySelector('.wft-est-row.is-time .code').textContent, 'npm ci');
  assert.equal(doc.querySelector('.wft-est-row.is-total span').textContent, 'Total');
  const lock = doc.querySelector('.wft-lock');
  assert.equal(lock.hidden, false);
  assert.equal(lock.querySelector('b').textContent, 'Tests never push, open pull requests or change your project.');
  assert.equal(lock.textContent, "Tests never push, open pull requests or change your project. Each try works in Worca's own copy of the project, which is deleted after the checks.");
  assert.equal(doc.querySelector('.wft-safe').hidden, true, 'P13: the lock line takes the shield line\'s place');
  doc.querySelector('#wft-tv-conn-real').checked = true;
  doc.querySelector('#wft-tv-conn-real').dispatchEvent(new doc.defaultView.Event('change'));
  await tick(); await tick();
  assert.match(doc.querySelector('#wft-tv-conn-real').closest('label').querySelector('.hint').textContent, / Pushes, pull requests and issues stay blocked\.$/);
  assert.equal(doc.querySelector('.wft-lock').hidden, false, 'with Real too');
});

test('board 34 aside: too little disk refuses, with Start disabled', async () => {
  const doc = dialog(plan({ project: { names: ['worca-cc'], leftOut: [], setupCmd: null, setupMs: null,
    disk: { needBytes: 1.2 * GB, freeBytes: 0.9 * GB, enough: false, text: 'Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples.' } } }));
  await tick(); await tick();
  const refuse = doc.querySelector('.wft-refuse');
  assert.equal(refuse.getAttribute('role'), 'alert');
  assert.equal(refuse.textContent, 'Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples.');
  const ok = doc.querySelector('.wft-dlg-ok');
  assert.deepEqual([ok.textContent, ok.disabled], ['Start 30 tries', true]);
});

const progress = (over = {}) => ({
  run: { id: 9, kind: 'compare', status: 'running', stopReason: null, stopDetail: null, tries: 3, a: 2, b: 'draft', exampleIds: [1, 2] },
  title: 'Testing your v3 draft', done: 7, total: 30, costUsd: 7.2, estimateUsd: 31, capUsd: 40, minutesLeft: 55, takenMs: null,
  quick: { status: 'passed' },
  rows: [
    { exampleId: 1, name: 'Ticket 482', label: 'v2', dots: ['passed', 'running', 'waiting'], summary: 'Trying 2 of 3',
      now: { tryNo: 2, phase: 'checking', checking: 'npm test', setupCmd: 'npm ci', startedMs: Date.now() - 60000 } },
    { exampleId: 1, name: 'Ticket 482', label: 'v3 draft', dots: ['running', 'waiting', 'waiting'], summary: 'Trying 1 of 3',
      now: { tryNo: 1, phase: 'working', checking: null, setupCmd: 'npm ci', startedMs: Date.now() - 6 * 60000 } },
    { exampleId: 2, name: 'Ticket 471', label: 'v2', dots: ['running', 'waiting', 'waiting'], summary: 'Trying 1 of 3',
      now: { tryNo: 1, phase: 'setup', checking: null, setupCmd: 'npm ci', startedMs: Date.now() } },
    { exampleId: 2, name: 'Ticket 471', label: 'v3 draft', dots: ['waiting', 'waiting', 'waiting'], summary: 'Waiting', now: null },
  ],
  project: { phases: { exampleName: 'Ticket 482', label: 'v3 draft', tryNo: 1, phase: 'working', start: { ref: 'main', short: 'abc1234', at: '2026-10-28T09:00:00.000Z' }, setupCmd: 'npm ci' },
    disk: { inUseBytes: 0.9 * GB, needBytes: 1.2 * GB, freeBytes: 47 * GB }, setupStop: null },
  ...over,
});
function page(p = progress(), actions = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const calls = [];
  renderTestProgress(root, p, { back() {}, stop() {}, continue: (c) => calls.push(['continue', c]), open() {}, editExample: (id) => calls.push(['edit', id]), ...actions },
    { doc: window.document, dateText: () => '28 Oct' });
  return { root, calls, doc: window.document };
}

test('board 35: disk in use, what happens in each try, the Now column', () => {
  const { root } = page();
  const disk = [...root.querySelectorAll('.wft-fact')].find((f) => f.firstChild.textContent === 'Disk in use');
  assert.deepEqual(texts(disk, 'span, b'), ['Disk in use', '0.9 GB', 'of about 1.2 GB · 47.0 GB free']);
  assert.equal(root.querySelector('.wft-phases h2').textContent, 'What happens in each try');
  assert.deepEqual(texts(root, '.wft-ph b'), ['Preparing a copy of the project', 'Running setup', 'Working', 'Checking']);
  assert.deepEqual(texts(root, '.wft-ph .s'), ['From main at abc1234 · 28 Oct', 'npm ci', 'The workflow does its work', 'The checks run, then the copy is deleted']);
  assert.deepEqual([...root.querySelectorAll('.wft-ph')].map((li) => li.className), ['wft-ph is-done', 'wft-ph is-done', 'wft-ph is-now', 'wft-ph']);
  assert.equal(root.querySelector('.wft-phases > .hint').textContent, 'Shown for Ticket 482, v3 draft, try 1. Three tries run at once, each in its own copy of the project.');
  assert.equal(root.querySelector('.wft-prow.is-head').lastChild.textContent, 'Now');
  const nows = [...root.querySelectorAll('.wft-prow:not(.is-head)')].map((r) => r.lastChild.textContent);
  assert.deepEqual(nows, ['Try 2 · Checkingrunning npm test', 'Try 1 · Workingfor 6 minutes', 'Try 1 · Running setupnpm ci', 'Waiting']);
});

test('board 35: the test stopped because the setup step failed', () => {
  const p = progress({
    run: { id: 9, kind: 'compare', status: 'stopped', stopReason: 'setup', stopDetail: 'The setup step failed: npm ci ended with an error.', tries: 3, a: 2, b: 'draft', exampleIds: [1] },
    done: 0, costUsd: 0, takenMs: 60000,
    rows: [{ exampleId: 1, name: 'Ticket 482', label: 'v2', dots: ['stopped', 'waiting', 'waiting'], summary: 'Not finished · 0 of 3 tried', now: null }],
    project: { phases: null, disk: null, setupStop: { cmd: 'npm ci', tail: '> npm ci\nnpm error code EUSAGE', exampleId: 1, exampleName: 'Ticket 482', label: 'v2', tryNo: 1 } },
  });
  const { root, calls } = page(p);
  assert.equal(root.querySelector('.wft-pill').textContent, 'Stopped · 0 of 30 tries done');
  assert.deepEqual(texts(root, '.wft-acts button'), ['Edit the example', 'Try again']);
  const box = root.querySelector('.wft-stopbox');
  assert.equal(box.getAttribute('role'), 'alert');
  assert.equal(box.textContent, 'The setup step failed: npm ci ended with an error. The test stopped, and no try counts as failed.');
  assert.equal(box.querySelector('b .code').textContent, 'npm ci');
  assert.equal(root.querySelector('.wft-setup-hint').textContent, "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: $0.00.");
  const see = [...root.querySelectorAll('button')].find((b) => b.textContent === 'See the setup output');
  assert.equal(see.getAttribute('aria-expanded'), 'false');
  assert.equal(root.querySelector('.wft-outlog').hidden, true);
  click(see);
  assert.equal(root.querySelector('.wft-outlog').hidden, false);
  assert.equal(root.querySelector('.wft-outlog').textContent, '> npm ci\nnpm error code EUSAGE');
  assert.equal(root.querySelector('.wft-setup-where').textContent, 'Ticket 482, v2, try 1');
  assert.equal(root.querySelector('.wft-setup-fix').textContent, 'Fix the setup in the example, or in the project, then try again.');
  click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Edit the example'));
  click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again'));
  assert.deepEqual(calls, [['edit', 1], ['continue', null]]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-test-project-run.test.mjs`
Expected: FAIL. The first option still reads "All 6", and `.wft-tv-left` is missing.

- [ ] **Step 3: Test a version (`ui/public/workflows/test-dialogs.mjs`)**

Add to the imports:
```js
import { allOnProject, leftOutText, LOCK_LEAD, LOCK_REST, REAL_BLOCKED_HINT, DISK_KEY, TIME_KEY, diskRow, aboutDuration, SETUP_TAKES_LEAD, setupTakesRest }
  from '../../../src/shared/workflow-tests/project-text.mjs';
```
In `openTestVersionDialog`:
- Make the examples readiness-aware (D62). Replace the `allOpt`/`for (const e of examples)` lines and `chosen` with:
```js
  const ready = examples.filter((e) => e.ready !== false);
  const oneProject = ready.length && ready.every((e) => e.projectName && e.projectName === ready[0].projectName) ? ready[0].projectName : null;
  const allOpt = el(doc, 'option', '', oneProject ? allOnProject(ready.length, oneProject) : `All ${ready.length}`);   // P14
  allOpt.value = 'all';
  pickEx.append(allOpt);
  for (const e of examples) { const x = el(doc, 'option', '', e.name); x.value = String(e.id); x.disabled = e.ready === false; pickEx.append(x); }
  if (Array.isArray(exampleIds) && exampleIds.length === 1) pickEx.value = String(exampleIds[0]);
  const chosen = () => (pickEx.value === 'all' ? ready : ready.filter((e) => String(e.id) === pickEx.value));
  const leftHint = el(doc, 'p', 'hint wft-tv-left');
  leftHint.setAttribute('aria-live', 'polite');
```
- After `const row2 = …` and its `append`, put the hint under the Examples field: `row2.firstChild.append(leftHint);`.
- Build the lock line after the `safe` line:
```js
  // Board 34 (P13): a test with a project example says it never pushes, in both modes.
  const lock = el(doc, 'div', 'wft-lock');
  const lockWords = el(doc, 'span');
  lockWords.append(el(doc, 'b', '', LOCK_LEAD), doc.createTextNode(LOCK_REST));
  lock.append(icon(doc, 'lock', 16), lockWords);
  lock.hidden = true;
  const refuse = el(doc, 'p', 'wft-refuse');
  refuse.setAttribute('role', 'alert');
  refuse.hidden = true;
```
  Add `lock` and `refuse` to the dialog body after `safe` (`body: [vs, reuse, row2, conn, quickRow, safe, lock, est, refuse, capField, note]`).
- Add `const projectTest = () => !!(plan && plan.project && plan.project.names && plan.project.names.length);`.
- In `paint()`, at the start of the estimate (`if (e) {`), add the two rows. Label the total row "Total" when the time row shows:
```js
      const pj = projectTest() ? plan.project : null;
      if (pj && pj.disk) {
        const r = el(doc, 'div', 'wft-est-row is-disk');
        r.append(el(doc, 'span', 'wft-est-k', DISK_KEY), el(doc, 'span', '', diskRow(pj.disk.needBytes, pj.disk.freeBytes)));
        est.append(r);
      }
      const timeShown = !!(pj && e.minutes);
      if (timeShown) {
        const r = el(doc, 'div', 'wft-est-row is-time');
        const v = el(doc, 'span', '', aboutDuration(e.minutes * 60000));
        if (pj.setupCmd && pj.setupMs) v.append(doc.createTextNode(SETUP_TAKES_LEAD), el(doc, 'span', 'code', pj.setupCmd), doc.createTextNode(setupTakesRest(pj.setupMs)));
        r.append(el(doc, 'span', 'wft-est-k', TIME_KEY), v);
        est.append(r);
      }
```
  Change the total line to `line(timeShown ? 'Total' : e.minutes ? `Total · ready in about ${e.minutes} minutes` : 'Total', …)`. `timeShown` must be declared in `paint`'s scope before it: write `let timeShown = false;` at the top of `paint` and assign it inside.
- In `paint()`, after the okButton lines:
```js
    const disk = projectTest() && plan.project.disk ? plan.project.disk : null;
    refuse.replaceChildren();
    refuse.hidden = !(disk && disk.enough === false);
    if (!refuse.hidden) refuse.append(icon(doc, 'alert', 14), el(doc, 'span', '', disk.text));
    if (!refuse.hidden) dlg.okButton.disabled = true;   // board 34: "Start 30 tries", disabled
    const leftNames = plan && plan.project ? plan.project.leftOut : examples.filter((x) => x.ready === false).map((x) => x.name);
    leftHint.textContent = leftNames.length ? leftOutText(leftNames) : '';
    leftHint.hidden = !leftNames.length;
```
- In `paintConnectors(e)`, add `REAL_BLOCKED_HINT` to the Real sentence when `projectTest()`:
```js
    realOpt.hint.textContent = `Tries use your real connectors. If the workflow posts or sends something, it does it in every try${!n ? '' : n === 1 ? ': once in this test' : `: ${n} times in this test`}.${projectTest() ? REAL_BLOCKED_HINT : ''}`;
```
  and replace its last line `safe.hidden = mode !== 'pretend';` with:
```js
    lock.hidden = !projectTest();
    safe.hidden = mode !== 'pretend' || projectTest();   // P13
```
- `onConfirm` sends `exampleIds: chosen().map((e) => e.id)`. Since `chosen()` holds only ready examples, nothing more changes there.

- [ ] **Step 4: While the test runs (`ui/public/workflows/test-progress.mjs`)**

Imports:
```js
import { icon } from '../icons.mjs';
import { DISK_IN_USE, diskInUseSub, fmtGb, PHASES, PHASE_SUB, PHASES_TITLE, phasesShownFor, nowText, forMinutes, RUNNING_LEAD, FROM_LEAD,
  SETUP_STOP_REST, SETUP_STOP_HINT, SEE_SETUP_OUTPUT, setupWhere, SETUP_FIX_HINT, EDIT_EXAMPLE, TRY_AGAIN } from '../../../src/shared/workflow-tests/project-text.mjs';
```
Add `setup: (p) => full(p.run.stopDetail || 'the setup step failed'),` to `STOPPED`. Change the signature to `renderTestProgress(root, p, actions, { doc, dateText = (s) => s })`.

The setup stop's buttons. In the `else if (p.run.stopReason !== 'changed')` branch, put this first:
```js
  } else if (p.run.stopReason === 'setup') {   // board 35: the setup failed: edit the example or try again; no cost limit to change
    const where = p.project && p.project.setupStop;
    if (where) acts.append(act(EDIT_EXAMPLE, () => actions.editExample(where.exampleId), 'btn', 'wft-pg-edit'));
    acts.append(act(TRY_AGAIN, () => actions.continue(null), 'btn btn-primary', 'wft-pg-finish'));
  } else if (p.run.stopReason !== 'changed') {
```
In the facts, after `quickFact`, add:
```js
  const dk = p.project && p.project.disk;
  const diskFact = dk && dk.inUseBytes != null ? fact(doc, DISK_IN_USE, fmtGb(dk.inUseBytes), dk.needBytes != null ? diskInUseSub(dk.needBytes, dk.freeBytes) : null) : null;
```
and change the facts line to `facts.append(timeFact, fact(doc, 'Cost so far', fmtUsd(p.costUsd), costLine), ...(diskFact ? [diskFact] : []), quickFact);` (board 35's order: time, cost, disk, quick check).

The setup stop's box. Replace `stopped = stoppedText(p); prog.append(el(doc, 'p', 'wft-stopped', stopped));` with:
```js
    stopped = stoppedText(p);
    const ss = p.run.stopReason === 'setup' && p.project ? p.project.setupStop : null;
    if (ss) prog.append(...setupStopBox(doc, ss, p.costUsd));
    else prog.append(el(doc, 'p', 'wft-stopped', stopped));
```
Add the two builders above `renderTestProgress`:
```js
/** Board 35: why the test stopped when a setup failed (D55), its output on request, and where it ran. */
function setupStopBox(doc, ss, costUsd) {
  const box = el(doc, 'p', 'wft-stopbox');
  box.setAttribute('role', 'alert');
  const b = el(doc, 'b');
  b.append(doc.createTextNode('The setup step failed: '), el(doc, 'span', 'code', ss.cmd), doc.createTextNode(' ended with an error.'));
  const words = el(doc, 'span');
  words.append(b, doc.createTextNode(SETUP_STOP_REST));
  box.append(icon(doc, 'alert', 16), words);
  const hint = el(doc, 'p', 'hint wft-setup-hint', SETUP_STOP_HINT);
  hint.append(el(doc, 'span', 'code', fmtUsd(costUsd)), doc.createTextNode('.'));
  const log = el(doc, 'pre', 'wft-outlog', ss.tail || '');
  log.hidden = true;
  log.id = 'wft-pg-setup-log';
  const see = btn(doc, SEE_SETUP_OUTPUT, () => { log.hidden = !log.hidden; see.setAttribute('aria-expanded', log.hidden ? 'false' : 'true'); }, 'wft-linkbtn');
  see.setAttribute('aria-expanded', 'false');
  see.setAttribute('aria-controls', log.id);
  see.dataset.focusKey = 'wft-pg-setup-see';
  const line = el(doc, 'div', 'wft-setup-line');
  line.append(see, el(doc, 'span', 'hint wft-setup-where', setupWhere(ss.exampleName, ss.label, ss.tryNo)));
  return [box, hint, line, log, el(doc, 'p', 'hint wft-setup-fix', SETUP_FIX_HINT)];
}

/** Board 35: what one try goes through, for the first try that runs (D55, D61). Setup only when the example has one. */
function phasesCard(doc, ph, dateText) {
  const c = el(doc, 'section', 'card wft-phases');
  const h = el(doc, 'h2', '', PHASES_TITLE);
  h.id = 'wft-pg-phases';
  c.setAttribute('aria-labelledby', h.id);
  const list = el(doc, 'ol', 'wft-ph-list');
  const steps = PHASES.filter(([k]) => k !== 'setup' || ph.setupCmd);
  const at = Math.max(0, steps.findIndex(([k]) => k === ph.phase));
  steps.forEach(([k, label], i) => {
    const li = el(doc, 'li', `wft-ph${i < at ? ' is-done' : i === at ? ' is-now' : ''}`);
    const n = el(doc, 'span', 'wft-ph-n', String(i + 1));
    n.setAttribute('aria-hidden', 'true');
    const words = el(doc, 'span');
    const sub = el(doc, 'span', 's');
    if (k === 'preparing') sub.append(doc.createTextNode(`${FROM_LEAD}${ph.start.ref || ph.start.short} at `), el(doc, 'span', 'code', ph.start.short), doc.createTextNode(` · ${dateText(ph.start.at)}`));
    else if (k === 'setup') sub.append(el(doc, 'span', 'code', ph.setupCmd));
    else sub.textContent = PHASE_SUB[k];
    words.append(el(doc, 'b', '', label), sub);
    li.append(n, words);
    list.append(li);
  });
  c.append(h, list, el(doc, 'p', 'hint', phasesShownFor(ph.exampleName, ph.label, ph.tryNo)));
  return c;
}
```
After `page.append(prog);`, add `if (st === 'running' && p.project && p.project.phases) page.append(phasesCard(doc, p.project.phases, dateText));`.

The rows. Change the head's third label to `st === 'done' ? 'Result' : p.rows.some((r) => r.now) ? 'Now' : 'So far'`. Replace the row's last cell `el(doc, 'span', tried ? '' : 'wft-prow-quiet', r.summary)` with `nowCell(doc, r, tried, over)`, defined above `renderTestProgress`:
```js
/** Board 35's Now column: a running project try's phase and what it is doing; any other row its Part 2 summary. */
function nowCell(doc, r, tried, over) {
  if (!r.now || over) return el(doc, 'span', tried ? '' : 'wft-prow-quiet', r.summary);
  const cell = el(doc, 'span', 'wft-now');
  const sub = el(doc, 'span', 's');
  if (r.now.phase === 'checking' && r.now.checking) sub.append(doc.createTextNode(RUNNING_LEAD), el(doc, 'span', 'code', r.now.checking));
  else if (r.now.phase === 'setup' && r.now.setupCmd) sub.append(el(doc, 'span', 'code', r.now.setupCmd));
  else if (r.now.phase === 'working' && r.now.startedMs) sub.textContent = forMinutes(Date.now() - r.now.startedMs);
  cell.append(el(doc, 'span', '', nowText(r.now)), sub);
  return cell;
}
```

- [ ] **Step 5: Try it once now's disk card (`example-editor.mjs`, `app.js`, `routes.mjs`)**

In `routes.mjs`, wrap the try-once route's `runner.start` so that a `NO_DISK` refusal carries the plan:
```js
  route('POST', `${W}/examples/:ex/try-once`, async (req, res) => {
    testable(req);
    const ex = example(req);
    try {
      res.status(201).json({ run: await runner.start({ workflowId: wid(req), kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: false,
        connectors: 'pretend', by: by(req) }) });   // D35: Try it once now always pretends
    } catch (e) {
      if (e && e.code !== 'NO_DISK') throw e;
      const d = await service.diskPlanOf([ex], { tries: 1, sides: 1 });   // board 39: the editor shows its own card
      res.status(422).json({ error: d && d.once ? d.once : e.message, code: 'NO_DISK', disk: d ? { needBytes: d.needBytes, freeBytes: d.freeBytes } : null });
    }
  });
```
In `app.js`, change `wftCall`'s failure result to keep the body: `{ ok: false, status: res.status, error: …, body: d }`. In `wftEditorActions.tryOnce`, return `r` as it is (it now carries `body`).

In `example-editor.mjs`, import `DISK_TITLE, DISK_KEY, diskRow` from project-text. After the `UNSUPPORTED_TITLE` notice code in `run`, add:
```js
    if (r && !r.ok && r.body && r.body.code === 'NO_DISK' && r.body.disk) {   // board 39: Try it once now, not enough free disk
      const card = el(doc, 'section', 'card wft-refusal');
      const h = el(doc, 'h2', '', DISK_TITLE);
      h.id = 'wft-ex-disk-h';
      card.setAttribute('aria-labelledby', h.id);
      const est = el(doc, 'div', 'wft-est');
      const row = el(doc, 'div', 'wft-est-row is-disk');
      row.append(el(doc, 'span', 'wft-est-k', DISK_KEY), el(doc, 'span', '', diskRow(r.body.disk.needBytes, r.body.disk.freeBytes)));
      est.append(row);
      card.append(h, est, el(doc, 'p', 'hint', r.error));
      error.textContent = '';
      page.querySelector('.wft-refusal')?.remove();
      error.after(card);
    }
```
(`r` is the result `run` keeps from Task 10's change.) Add a test to `test/ui-workflow-example-project.test.mjs`:
```js
test('board 39: Try it once now with too little free disk shows its card', async () => {
  const GB = 2 ** 30;
  const { root } = boot(example(), { over: { tryOnce: async () => ({ ok: false, status: 422, error: 'One try needs about 0.4 GB free, and this computer has 0.2 GB free. Free up at least 0.2 GB and try again. Nothing was tried and nothing was charged.',
    body: { code: 'NO_DISK', disk: { needBytes: 0.4 * GB, freeBytes: 0.2 * GB } } }) } });
  click(byText(root, '.wft-acts button', 'Try it once now'));
  await tick(); await tick();
  const card = root.querySelector('.wft-refusal');
  assert.equal(card.querySelector('h2').textContent, 'Not enough free disk');
  assert.equal(card.querySelector('.wft-est-row').textContent, 'DiskNeeds about 0.4 GB free while it runs · 0.2 GB free');
  assert.equal(card.querySelector('.hint').textContent, 'One try needs about 0.4 GB free, and this computer has 0.2 GB free. Free up at least 0.2 GB and try again. Nothing was tried and nothing was charged.');
});
```

- [ ] **Step 6: Wire it (`ui/public/app.js`)**

In `wftTestVersion`, pass readiness and the project's name:
```js
    examples: o.examples.map((e) => ({ id: e.id, name: e.name, tries: e.tries, ready: e.ready !== false, projectName: e.project ? e.project.name : null })),
```
In `wftProgressActions`, add `editExample: (exampleId) => void wftOpenExample(exampleId),`. In `wftRenderView`, pass `dateText: wftDate` to `renderTestProgress`.

- [ ] **Step 7: The CSS (`ui/public/style.css`, the 3a block)**

```css
.wft-lock{display:flex;gap:10px;align-items:flex-start;margin-top:10px;padding:11px 13px;border-radius:var(--r-sm);background:var(--blue-wash);border:1px solid var(--blue-line);font-size:var(--fs-body);line-height:1.45;color:var(--ink);}
.wft-lock .ic{flex:0 0 auto;margin-top:2px;color:var(--blue-ink);}
.wft-lock b{font-weight:600;}
.wft-est-k{font-weight:600;color:var(--ink-2);min-width:44px;}
.wft-est-row.is-disk,.wft-est-row.is-time{justify-content:flex-start;gap:12px;}
.wft-refuse{display:flex;gap:8px;align-items:flex-start;margin:0;padding:10px 12px;border-radius:var(--r-sm);background:var(--amber-wash);border:1px solid var(--amber-line);color:var(--ink);font-size:var(--fs-body);line-height:1.45;}
.wft-refuse .ic{flex:0 0 auto;margin-top:2px;color:var(--amber-ink-strong);}
.wft-tv-left{margin:6px 0 0;}
.wft-phases{padding:18px 22px;display:flex;flex-direction:column;gap:12px;}
.wft-phases h2{margin:0;font-size:var(--fs-section);}
.wft-ph-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px;}
.wft-ph{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line-2);border-radius:var(--r-sm);font-size:var(--fs-body);color:var(--ink-2);}
.wft-ph b{display:block;font-weight:600;color:var(--ink);}
.wft-ph .s{display:block;font-size:var(--fs-meta);color:var(--ink-2);}
.wft-ph-n{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:var(--r-xs);background:var(--field);font-size:var(--fs-meta);font-weight:600;color:var(--ink-2);}
.wft-ph.is-done .wft-ph-n{background:var(--green-bg);color:var(--green-ink);}
.wft-ph.is-now{border-color:var(--peach);}
.wft-ph.is-now .wft-ph-n{background:var(--peach-bg);color:var(--peach-ink);}
.wft-now{display:flex;flex-direction:column;gap:2px;}
.wft-now .s{font-size:var(--fs-meta);color:var(--ink-2);}
.wft-stopbox{display:flex;gap:10px;align-items:flex-start;margin:0;padding:12px 14px;border-radius:var(--r-sm);background:var(--red-bg);color:var(--red-ink);font-size:var(--fs-body);line-height:1.45;}
.wft-stopbox .ic{flex:0 0 auto;margin-top:2px;}
.wft-setup-line{display:flex;flex-wrap:wrap;gap:12px;align-items:center;}
.wft-outlog{margin:0;padding:10px 12px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--canvas-2);font-family:var(--mono);font-size:var(--fs-meta);line-height:1.5;white-space:pre-wrap;overflow-x:auto;}
```
Check that every token used exists before committing: `Select-String -Path ui\public\style.css -Pattern "--blue-line:|--blue-ink:|--peach-ink:|--peach-bg:|--red-ink:"`. Use only the ones it finds. If `--blue-ink` is missing, use `--ink-2` for the lock icon.

- [ ] **Step 8: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-test-project-run.test.mjs test/ui-workflow-example-project.test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-progress.test.mjs test/api-workflow-tests-projects.test.mjs`
Expected: PASS. Part 2's dialog test still reads "All N" (its examples carry no `projectName`) and "Total · ready in about N minutes" (no project, so no time row).

Run the design guards and the slicing tests as in Task 10. Expected: no new failure.

- [ ] **Step 9: Commit**

```bash
git add ui/public/workflows/test-dialogs.mjs ui/public/workflows/test-progress.mjs ui/public/workflows/example-editor.mjs ui/public/app.js ui/public/style.css src/core/workflow-tests/routes.mjs test/ui-workflow-test-project-run.test.mjs test/ui-workflow-example-project.test.mjs
git commit -m "Workflow tests 3a: Test a version on a project (disk, time, lock line) and the running page (phases, Now, setup stop) (boards 34, 35, 39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: UI: one example side by side: what changed in the project, and what it would have sent (boards 36, 37)

**Precondition:** the controller confirms boards 36 and 37 are approved. Re-read `P3SideBySide.dc.html` and `P3WouldHaveSent.dc.html`, and apply any copy change first.

**Match board 36:**
- the header hint "v2 passed 3 of 3 tries · v3 draft passed 1 of 3 · both started from main at `abc1234` · 28 Oct" (" · started from " for Try it once now, which has one version);
- per column, a card "What changed in the project · v2" with its count ("3 changed" / "1 added, 2 changed, 1 removed"). It has the file list, each file a button with its badge ("Changed" plain, "Added" green, "Removed" dark, "Renamed" plain), and the picked file's diff below it (`+`/`-`/context lines, add green and del red);
- "Read all the changes" (aria-label "Read all the changes, v2");
- in What was checked, the command's value ("213 passed" / "212 passed, 1 failed"). A command not met gets the line "**Not met for v3 draft:** the command ended with an error." and "See the command output";
- the dashed card "For developers": its hint, then "Start point: main at `abc1234` · 28 Oct", "Setup: `npm ci` · 1 min 50 s", "v2: 3 files, 14 lines added, 3 removed" and "v3 draft: 4 files, 22 lines added, 31 removed".
- Not built: the "Failed: …" line (P6) and the Part 3b and Your criteria rows.

**Match board 37:**
- at the top, beside Part 2's "Connectors: pretend. Nothing was posted or sent.", the lock note "**The changes stayed in Worca's own copy of the project: nothing was pushed.**". With Real it adds " Pushes, pull requests and issues stay blocked in every test, also with Real connectors.";
- per column, under its change card, the "Would have sent" card:
  - the count "1 push, 1 pull request, 1 issue comment";
  - rows "**git** · push · Send the changes to the branch fix-ticket-482", whose open text is "Not sent · stopped by Worca", the sentence and the command;
  - "**GitHub CLI** · open a pull request · Open a pull request: …", whose caption is "Full text · from fix-ticket-482 into main";
  - the footer "Each one answered "Not sent: this is a test."";
  - with nothing: "Nothing would have been sent. The changes stayed in Worca's own copy of the project: nothing was pushed.".
- A project try's "What <v> wrote" card shows only when the try left a result (P7).

**Files:**
- Modify `ui/public/workflows/test-compare.mjs`:
  - `sentCard` (:77-111);
  - `renderSideBySide` (:276-408): the header, the notes, the columns, the why lines and the dev card;
  - new `changesCard` and `devCard`.
- Modify `ui/public/app.js`:
  - `wftRenderView`'s detail branch (:3663);
  - `wftDetailActions` (:3694-3711);
  - `wftCompareActions.open` (:3675).
- Modify: `ui/public/style.css`.
- Test: `test/ui-workflow-test-project-compare.test.mjs`

**Interfaces:**
- Consumes:
  - the side-by-side JSON (Task 8): `start`, `nothingPushed`, `tries[].{a,b}.project.changes`, `wouldHaveSent` guard rows (Task 5's `guardCall` shape);
  - `GET …/tries/:try/changes` → `{ patch }`;
  - `splitPatchSections`, `parseFileSection` (ui/public/diff-view.mjs:37, :113);
  - `fmtDuration` (compare.mjs:187).
- Produces:
  - `renderSideBySide(root, s, actions, { doc, tryIndex, renderMarkdown, patches, picked, dateText })`, where `patches` is a `Map<tryId, string|undefined>` and `picked` is `{ a?: path, b?: path }`;
  - its actions gain `loadChanges(tryId)`, `pickFile(side, path)`, `readChanges(tryId, title)` and `commandOutput(title, output)`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-project-compare.test.mjs`:

```js
// test/ui-workflow-test-project-compare.test.mjs — workflow tests 3a: one example side by side for a project example (canvas
// boards 36, 37): what changed in the project, the picked file's diff, the command check, what the guard stopped, and the
// "For developers" facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const PATCH = ['diff --git a/src/core/billing/round.mjs b/src/core/billing/round.mjs', '--- a/src/core/billing/round.mjs', '+++ b/src/core/billing/round.mjs',
  '@@ -1,3 +1,4 @@', "+import { toCents } from './money.mjs';", ' export function roundCents(value) {', '-  return Math.round(value * 100) / 100;',
  '+  return toCents(value) / 100;', ' }', ''].join('\n');
const changes = (counts, files, added, removed) => ({ counts, files, total: files.length, added, removed });
const A = { tryId: 11, status: 'passed', connectors: 'pretend', text: null, name: null, truncated: false, answeredReads: [], wouldHaveSent: [],
  verdict: { basics: [], checks: [{ id: 'c_1', label: 'The command npm test passes', met: true, value: '213 passed', output: 'ℹ pass 213' }] },
  project: { changes: changes({ added: 0, changed: 3, removed: 0 }, [
    { status: 'changed', path: 'src/core/billing/round.mjs', added: 2, removed: 1 }, { status: 'changed', path: 'src/core/billing/invoice-totals.mjs', added: 6, removed: 1 },
    { status: 'changed', path: 'test/billing/invoice-totals.test.mjs', added: 6, removed: 1 }], 14, 3), setup: { cmd: 'npm ci', ms: 110000 } } };
const B = { ...A, tryId: 12, status: 'failed',
  verdict: { basics: [], checks: [{ id: 'c_1', label: 'The command npm test passes', met: false, value: '212 passed, 1 failed', output: 'ℹ pass 212\nℹ fail 1' }] },
  project: { changes: changes({ added: 1, changed: 2, removed: 1 }, [
    { status: 'changed', path: 'src/core/billing/round.mjs', added: 2, removed: 1 }, { status: 'added', path: 'src/core/billing/money.mjs', added: 12, removed: 0 },
    { status: 'removed', path: 'src/core/billing/legacy-round.mjs', added: 0, removed: 30 }, { status: 'changed', path: 'test/billing/invoice-totals.test.mjs', added: 8, removed: 0 }], 22, 31),
  setup: { cmd: 'npm ci', ms: 110000 } },
  wouldHaveSent: [
    { guard: true, server: 'git', tool: 'push', noun: 'push', to: null, preview: 'Send the changes to the branch fix-ticket-482', cap: 'Not sent · stopped by Worca',
      full: 'This try tried to send its changes to the branch fix-ticket-482 on GitHub.', cmd: 'git push origin fix-ticket-482' },
    { guard: true, server: 'GitHub CLI', tool: 'open a pull request', noun: 'pull request', to: null, preview: 'Open a pull request: Fix rounding in invoice totals',
      cap: 'Full text · from fix-ticket-482 into main', full: 'Title: Fix rounding in invoice totals', cmd: 'gh pr create --title "Fix rounding in invoice totals" --base main' }] };
const side = (over = {}) => ({
  run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482: invoice totals round wrong' },
  labels: { a: 'v2', b: 'v3 draft' }, row: { result: 'worse', a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 } }, connectors: 'pretend',
  tries: [{ n: 1, a: A, b: B }], start: { ref: 'main', short: 'abc1234', at: '2026-10-28T09:00:00.000Z', setupCmd: 'npm ci', setupMs: 110000 },
  nothingPushed: true, ...over,
});
function boot(s = side(), { patches = new Map([[12, PATCH]]) } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const calls = [];
  const actions = { back() {}, pick() {}, readWhole() {}, loadChanges: (id) => calls.push(['load', id]), pickFile: (k, p) => calls.push(['pick', k, p]),
    readChanges: (id, t) => calls.push(['all', id, t]), commandOutput: (t, o) => calls.push(['out', t, o]) };
  renderSideBySide(root, s, actions, { doc: window.document, tryIndex: 0, patches, picked: {}, dateText: () => '28 Oct' });
  return { root, calls };
}

test('board 36: the start in the header, what changed per version, the picked file\'s diff', () => {
  const { root, calls } = boot();
  assert.equal(root.querySelector('.wft-pg-head .hint').textContent, 'v2 passed 3 of 3 tries · v3 draft passed 1 of 3 · both started from main at abc1234 · 28 Oct');
  assert.deepEqual(texts(root, '.wft-chg h2'), ['What changed in the project · v2', 'What changed in the project · v3 draft']);
  assert.deepEqual(texts(root, '.wft-chg-head .hint'), ['3 changed', '1 added, 2 changed, 1 removed']);
  const b = root.querySelectorAll('.wft-chg')[1];
  assert.deepEqual([...b.querySelectorAll('.wft-fbtn .badge')].map((x) => [x.textContent, x.className]),
    [['Changed', 'badge'], ['Added', 'badge green'], ['Removed', 'badge wft-badge-rm'], ['Changed', 'badge']]);
  assert.deepEqual([...b.querySelectorAll('.wft-fbtn')].map((x) => x.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false']);
  const region = b.querySelector('.wft-diff');
  assert.equal(region.getAttribute('aria-label'), 'Changes in src/core/billing/round.mjs, v3 draft');
  assert.deepEqual([...region.querySelectorAll('.wft-dl')].map((l) => [l.className, l.textContent]), [
    ['wft-dl add', "+ import { toCents } from './money.mjs';"], ['wft-dl ctx', '  export function roundCents(value) {'],
    ['wft-dl del', '-   return Math.round(value * 100) / 100;'], ['wft-dl add', '+   return toCents(value) / 100;'], ['wft-dl ctx', '  }']]);
  assert.deepEqual(calls.filter((c) => c[0] === 'load'), [['load', 11]], 'the v2 try\'s diff is read; v3 draft\'s is already here');
  click(b.querySelectorAll('.wft-fbtn')[1]);
  assert.deepEqual(calls.at(-1), ['pick', 'b', 'src/core/billing/money.mjs']);
  const all = [...b.querySelectorAll('button')].find((x) => x.textContent === 'Read all the changes');
  assert.equal(all.getAttribute('aria-label'), 'Read all the changes, v3 draft');
  click(all);
  assert.deepEqual(calls.at(-1), ['all', 12, 'What changed in the project · v3 draft']);
});

test('board 36: the command check not met, and its output; the For developers facts', () => {
  const { root, calls } = boot();
  const why = root.querySelector('.wft-why');
  assert.equal(why.querySelector('span').textContent, 'Not met for v3 draft: the command ended with an error.');
  assert.equal(why.querySelector('b').textContent, 'Not met for v3 draft:');
  click([...why.querySelectorAll('button')].find((x) => x.textContent === 'See the command output'));
  assert.deepEqual(calls.at(-1), ['out', 'The command npm test passes · v3 draft', 'ℹ pass 212\nℹ fail 1']);
  const dev = root.querySelector('.wft-dev-card');
  assert.equal(dev.querySelector('h2').textContent, 'For developers');
  assert.equal(dev.querySelector('.hint').textContent, "Each try worked in Worca's own copy of the project, which was deleted after the checks. The list of changes and the full diff of each try are kept here.");
  assert.deepEqual(texts(dev, '.wft-dev-facts > span'), ['Start point: main at abc1234 · 28 Oct', 'Setup: npm ci · 1 min 50 s',
    'v2: 3 files, 14 lines added, 3 removed', 'v3 draft: 4 files, 22 lines added, 31 removed']);
});

test('board 37: the lock note; what the guard stopped, per version; nothing for the other', () => {
  const { root } = boot();
  assert.deepEqual(texts(root, '.wft-mode > span'), ['Connectors: pretend. Nothing was posted or sent.', "The changes stayed in Worca's own copy of the project: nothing was pushed."]);
  const [a, b] = root.querySelectorAll('.wft-sent');
  assert.equal(a.querySelector('.wft-sent-foot').textContent, "Nothing would have been sent. The changes stayed in Worca's own copy of the project: nothing was pushed.");
  assert.equal(b.querySelector('.wft-sent-head .hint').textContent, '1 push, 1 pull request');
  assert.deepEqual(texts(b, '.wft-call-line'), ['git · push · Send the changes to the branch fix-ticket-482',
    'GitHub CLI · open a pull request · Open a pull request: Fix rounding in invoice totals']);
  const first = b.querySelector('.wft-call-full');
  assert.equal(first.querySelector('.wft-call-cap').textContent, 'Not sent · stopped by Worca');
  assert.equal(first.querySelector('.wft-call-cmd').textContent, 'git push origin fix-ticket-482');
  assert.equal(b.querySelectorAll('.wft-call-cap')[1].textContent, 'Full text · from fix-ticket-482 into main');
  assert.equal([...b.querySelectorAll('.wft-sent-foot')].at(-1).textContent, 'Each one answered "Not sent: this is a test."');
});

test('board 37 with Real: the lock note says pushes stay blocked; a real try still lists what the guard stopped', () => {
  const real = side({ connectors: 'real', tries: [{ n: 1, a: { ...A, connectors: 'real' }, b: { ...B, connectors: 'real' } }] });
  const { root } = boot(real);
  const lock = [...root.querySelectorAll('.wft-mode > span')].at(-1);
  assert.equal(lock.textContent, "The changes stayed in Worca's own copy of the project: nothing was pushed. Pushes, pull requests and issues stay blocked in every test, also with Real connectors.");
  assert.equal(root.querySelectorAll('.wft-sent').length, 1, 'only the column whose try the guard stopped');
  assert.ok(root.querySelector('.wft-sent-real'), 'the other keeps Part 2\'s real note');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-test-project-compare.test.mjs`
Expected: FAIL. `.wft-chg` is missing.

- [ ] **Step 3: The side by side (`ui/public/workflows/test-compare.mjs`)**

Imports:
```js
import { splitPatchSections, parseFileSection } from '../diff-view.mjs';
import { changesTitle, changeCountText, FILE_BADGE, READ_ALL_CHANGES, BOTH_STARTED_FROM, DEV_CAPTION, DEV_SBS_HINT, DEV_START_LEAD, DEV_SETUP_LEAD,
  changesLine, notMetFor, COMMAND_ENDED, SEE_COMMAND_OUTPUT, NOTHING_PUSHED_TEXT, REAL_BLOCKED_TEXT, EACH_ANSWERED_TEXT } from '../../../src/shared/workflow-tests/project-text.mjs';
```
(`fmtDuration` is already imported from compare.mjs, for `timeOr`.) Add:
```js
const STARTED_FROM = ' · started from ';   // one version (Try it once now): "both" would be wrong
const DIFF_LINES_MAX = 400;
const BADGE_CLASS = { added: 'badge green', removed: 'badge wft-badge-rm' };
/** "main at <code>abc1234</code> · 28 Oct" into `node`. */
function startInto(doc, node, st, dateText) {
  node.append(doc.createTextNode(`${st.ref || st.short} at `), el(doc, 'span', 'code', st.short), doc.createTextNode(` · ${dateText(st.at)}`));
  return node;
}
```
Change `sentCard(doc, v, key)` to `sentCard(doc, v, key, { project = false } = {})`. Its first branch becomes:
```js
  if (!v) return null;
  const sent = v.wouldHaveSent || [];
  if (v.connectors === 'real' && !sent.length) {   // a real try that the guard never had to stop: Part 2's note
    const c = el(doc, 'section', 'card wft-sent-real');
    c.append(modeNote(doc, 'plug', 'Connectors: real. This try used your real connectors.'));
    return c;
  }
```
Remove its later `const sent = v.wouldHaveSent || [];`. In the rows loop, render a guard row in board 37's shape:
```js
    if (call.guard) {   // 3a D68: what the outward guard stopped
      line.append(el(doc, 'b', '', call.server), el(doc, 'span', 'wft-call-what', ` · ${call.tool} · `), el(doc, 'span', 'wft-call-prev', call.preview));
      sum.append(chev, line);
      const full = el(doc, 'div', 'wft-call-full');
      full.append(el(doc, 'span', 'wft-call-cap', call.cap), doc.createTextNode(call.full));
      if (call.cmd) full.append(el(doc, 'span', 'wft-call-cmd', call.cmd));
      d.append(sum, full);
      c.append(d);
      continue;
    }
```
(placed right after `const line = …`, before Part 2's `line.append(…)`). Replace the "nothing" line with:
```js
  if (!sent.length) c.append(el(doc, 'p', 'wft-sent-foot', project ? `Nothing would have been sent. ${NOTHING_PUSHED_TEXT}` : 'Nothing would have been sent.'));
  else if (project) c.append(el(doc, 'p', 'wft-sent-foot', EACH_ANSWERED_TEXT));   // board 37
```
In `renderSideBySide`:
- Change the signature to `(root, s, actions, { doc, tryIndex = 0, renderMarkdown = null, patches = new Map(), picked = {}, dateText = (x) => x })`.
- The header hint: replace `name, el(doc, 'span', 'hint', counts)` with `name, countsEl` where:
```js
  const countsEl = el(doc, 'span', 'hint', counts);
  if (s.start) startInto(doc, (countsEl.append(doc.createTextNode(once ? STARTED_FROM : BOTH_STARTED_FROM)), countsEl), s.start, dateText);
```
- After the pretend note line, add the lock note:
```js
  if (s.nothingPushed) {   // board 37: a project try never pushes, in either mode
    const p = el(doc, 'p', 'wft-mode');
    const words = el(doc, 'span');
    words.append(el(doc, 'b', '', NOTHING_PUSHED_TEXT));
    if (s.connectors === 'real') words.append(doc.createTextNode(REAL_BLOCKED_TEXT));
    p.append(icon(doc, 'lock', 14), words);
    page.append(p);
  }
```
- Replace `column` with:
```js
  // Board 36/37: a project try's column is what it changed, then what it wrote (only when it wrote something, P7), then
  // what it would have sent; any other try's is Part 2's (what it wrote, what it would have sent).
  const column = (label, v, key) => {
    const col = el(doc, 'div', 'wft-outcol');
    if (v && v.project) col.append(changesCard(label, v, key));
    if (!(v && v.project) || v.text) col.append(out(label, v, key));
    const sent = sentCard(doc, v, key, { project: !!s.nothingPushed });
    if (sent) col.append(sent);
    return col;
  };
  const changesCard = (label, v, key) => {
    const c = el(doc, 'section', 'card wft-card wft-chg');
    const h = el(doc, 'h2', '', changesTitle(label));
    h.id = `wft-chg-${key}`;
    c.setAttribute('aria-labelledby', h.id);
    const ch = v.project.changes || { files: [], counts: { added: 0, changed: 0, removed: 0 } };
    const head = el(doc, 'div', 'wft-chg-head');
    head.append(h, el(doc, 'span', 'hint', changeCountText(ch.counts)));
    c.append(head);
    const files = Array.isArray(ch.files) ? ch.files : [];
    if (!files.length) { c.append(el(doc, 'p', 'hint', 'This try changed no file.')); return c; }
    const sel = picked[key] && files.some((f) => f.path === picked[key]) ? picked[key] : files[0].path;
    const ul = el(doc, 'ul', 'wft-files-list');
    ul.setAttribute('aria-label', `Files ${label} changed`);
    for (const f of files) {
      const li = el(doc, 'li');
      const b = btn(doc, null, () => actions.pickFile(key, f.path), `wft-fbtn${f.path === sel ? ' is-sel' : ''}`);
      b.setAttribute('aria-pressed', f.path === sel ? 'true' : 'false');
      b.dataset.focusKey = `wft-f-${key}-${f.path}`;
      b.append(el(doc, 'span', BADGE_CLASS[f.status] || 'badge', FILE_BADGE[f.status] || FILE_BADGE.changed), el(doc, 'span', 'p', f.path));
      li.append(b);
      ul.append(li);
    }
    const patch = patches.get(v.tryId);
    if (patch === undefined) actions.loadChanges(v.tryId);   // read once; the page repaints when it lands
    const region = el(doc, 'div', 'wft-diff');
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', `Changes in ${sel}, ${label}`);
    region.append(el(doc, 'span', 'wft-diff-cap', sel));
    const section = typeof patch === 'string' ? splitPatchSections(patch).find((x) => x.path === sel) : null;
    const parsed = section ? parseFileSection(section.raw) : null;
    if (parsed && parsed.binary) region.append(el(doc, 'span', 'wft-dl ctx', 'A binary file.'));
    else if (parsed) {
      let n = 0;
      for (const hk of parsed.hunks) {
        for (const line of hk.lines) {
          if (n++ >= DIFF_LINES_MAX) break;
          region.append(el(doc, 'span', `wft-dl ${line.kind}`, `${line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}${line.text}`));
        }
      }
    } else region.append(el(doc, 'span', 'hint', patch === undefined ? 'Reading the changes…' : 'No changes to show for this file.'));
    const all = act(doc, root, runId, READ_ALL_CHANGES, () => actions.readChanges(v.tryId, changesTitle(label)), 'wft-linkbtn', `wft-chg-all-${key}`,
      { busy: true, busyKey: `wft-chg-all-${key}-${v.tryId}` });
    all.setAttribute('aria-label', `${READ_ALL_CHANGES}, ${label}`);
    const foot = el(doc, 'div', 'wft-chg-foot');
    foot.append(all);
    c.append(ul, region, foot);
    return c;
  };
```
  (`changesCard` is declared with `const` before `column` runs, since both are defined before `outs.append(column(…))`.)
- After the Part 2 loop that appends the basics' "why" lines, add the command's:
```js
  // Board 36: a command not met says so and opens its output.
  for (const [label, v] of [[s.labels.a, cur.a], [s.labels.b, cur.b]]) {
    for (const it of (v && v.verdict && v.verdict.checks) || []) {
      if (it.met || typeof it.output !== 'string') continue;
      const why = el(doc, 'div', 'wft-why');
      const words = el(doc, 'span');
      words.append(el(doc, 'b', '', notMetFor(label)), doc.createTextNode(COMMAND_ENDED));
      why.append(words, act(doc, root, runId, SEE_COMMAND_OUTPUT, () => actions.commandOutput(`${it.label} · ${label}`, it.output), 'btn btn-sm', `wft-cmd-out-${label}-${it.id}`));
      page.append(why);
    }
  }
  if (s.start) page.append(devCard(doc, s, cur, once, dateText));
```
  Add `devCard` above `renderSideBySide`:
```js
/** Board 36's "For developers": the start, the setup, and how big each version's change was. */
function devCard(doc, s, cur, once, dateText) {
  const c = el(doc, 'section', 'card wft-dev-card');
  const h = el(doc, 'h2', '', DEV_CAPTION);
  h.id = 'wft-sbs-dev';
  c.setAttribute('aria-labelledby', h.id);
  const facts = el(doc, 'div', 'wft-dev-facts');
  facts.append(startInto(doc, el(doc, 'span', '', DEV_START_LEAD), s.start, dateText));
  if (s.start.setupCmd) {
    const su = el(doc, 'span', '', DEV_SETUP_LEAD);
    su.append(el(doc, 'span', 'code', s.start.setupCmd));
    if (s.start.setupMs) su.append(doc.createTextNode(` · ${fmtDuration(s.start.setupMs)}`));
    facts.append(su);
  }
  for (const [label, v] of once ? [[s.labels.b, cur.b]] : [[s.labels.a, cur.a], [s.labels.b, cur.b]]) {
    if (v && v.project && v.project.changes) facts.append(el(doc, 'span', '', changesLine(label, v.project.changes)));
  }
  c.append(h, el(doc, 'p', 'hint', DEV_SBS_HINT), facts);
  return c;
}
```

- [ ] **Step 4: Wire it (`ui/public/app.js`)**

Add `const wftPatchLoading = new Set();` beside `wftEditorSeq`. In `wftRenderView`'s detail branch, pass the extra context:
```js
    renderSideBySide(root, wft.data, wftDetailActions(), { doc: document, tryIndex: wft.tryIndex || 0, renderMarkdown: wftMarkdown,
      patches: wft.patches || (wft.patches = new Map()), picked: wft.picked || {}, dateText: wftDate });
```
In `wftDetailActions`, add:
```js
    loadChanges: async (tryId) => {
      const cache = wft.patches || (wft.patches = new Map());
      if (cache.has(tryId) || wftPatchLoading.has(tryId)) return;
      wftPatchLoading.add(tryId);
      const r = await wftCall('GET', `${wftBase(id)}/runs/${s.run.id}/tries/${tryId}/changes`);
      wftPatchLoading.delete(tryId);
      cache.set(tryId, r.ok ? r.data.patch : '');
      if (still()) wftRender();
    },
    pickFile: (side, path) => { if (!still()) return; wft.picked = { ...(wft.picked || {}), [side]: path }; wftRender(); },
    readChanges: async (tryId, title) => {
      const cache = wft.patches || (wft.patches = new Map());
      let patch = cache.get(tryId);
      if (typeof patch !== 'string') {
        const r = await wftCall('GET', `${wftBase(id)}/runs/${s.run.id}/tries/${tryId}/changes`);
        if (!r.ok) { notify({ tone: 'err', title: 'Could not read the changes', detail: r.error }); return; }
        patch = r.data.patch;
        cache.set(tryId, patch);
      }
      if (still()) openWholeResult({ doc: document, win: window, title, text: patch || 'No changes.' });
    },
    commandOutput: (title, output) => openWholeResult({ doc: document, win: window, title, text: output || '' }),
```
In `wftCompareActions.open`, reset the picked files: `open: (exampleId) => wftShow('detail', { runId: run.id, exampleId, tryIndex: 0, picked: {} }),`.

- [ ] **Step 5: The CSS (`ui/public/style.css`, the 3a block)**

```css
.wft-chg-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px;}
.wft-chg-head h2{margin:0;font-size:var(--fs-section);}
.wft-files-list{list-style:none;margin:0 0 12px;padding:0;border:1px solid var(--line-2);border-radius:var(--r-sm);overflow:hidden;}
.wft-files-list li + li{border-top:1px solid var(--line);}
.wft-fbtn{display:grid;grid-template-columns:76px minmax(0,1fr);gap:10px;align-items:center;width:100%;padding:8px 12px;border:0;background:none;color:var(--ink);text-align:left;font:inherit;font-size:var(--fs-meta);cursor:pointer;}
.wft-fbtn:hover{background:var(--hover);}
.wft-fbtn.is-sel{background:var(--field);font-weight:600;}
.wft-fbtn .p{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:var(--fs-meta);}
.badge.wft-badge-rm{background:var(--ink-2);color:var(--panel);}
.wft-diff{display:flex;flex-direction:column;margin:0;border:1px solid var(--line-2);border-radius:var(--r-sm);overflow-x:auto;font-family:var(--mono);font-size:var(--fs-meta);line-height:1.6;}
.wft-diff-cap{padding:6px 10px;border-bottom:1px solid var(--line);color:var(--ink-2);}
.wft-dl{padding:0 10px;white-space:pre;}
.wft-dl.add{background:var(--green-bg);}
.wft-dl.del{background:var(--red-bg);}
.wft-dl.ctx{color:var(--ink-2);}
.wft-chg-foot{margin-top:12px;}
.wft-call-cmd{display:block;margin-top:8px;padding:6px 8px;border-radius:var(--r-xs);background:var(--canvas-2);font-family:var(--mono);font-size:var(--fs-meta);white-space:pre-wrap;}
.wft-why{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:8px 0 0;padding:10px 12px;border-radius:var(--r-sm);background:var(--red-bg);font-size:var(--fs-body);}
.wft-dev-card{padding:18px 22px;border-style:dashed;}
.wft-dev-card h2{margin:0 0 4px;font-size:var(--fs-section);}
.wft-dev-facts{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:var(--fs-body);}
```

- [ ] **Step 6: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-test-project-compare.test.mjs test/ui-workflow-test-compare.test.mjs`
Expected: PASS. Part 2's compare test is unchanged: no `start`, no `project`, and pretend tries list connector rows as before. A real Part 2 try with no guard rows keeps its real note.

Run the design guards and the style.css slicing tests. Expected: no new failure.

- [ ] **Step 7: Commit**

```bash
git add ui/public/workflows/test-compare.mjs ui/public/app.js ui/public/style.css test/ui-workflow-test-project-compare.test.mjs
git commit -m "Workflow tests 3a: one example side by side: what changed in the project, the diff, the command, what the guard stopped (boards 36, 37)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: UI: the Tests list, a past project run, first use, and the D20 state removed (boards 38, 39)

**Precondition:** the controller confirms boards 38 and 39 are approved. Re-read `P3PastRun.dc.html` and `P3Empty.dc.html`, and apply any copy change first.

**Match board 38, the Tests list:**
- a project example's hint "Request · worca-cc · from `abc1234`", with " · with changes not committed yet" when it keeps changes;
- under it, when the branch moved on, the amber badge "Moved on" and "The project has moved on: 14 newer commits on main since this start point.";
- an example a test leaves out: "Request only · no project yet, so it is left out of tests", and "Pick a project first" in each result column;
- below the table, when an example has a project: "Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.".

**Match board 38, the dialogs:**
- in "Add from a past run", a project run's row shows its title and badge on top and "worca-cc · 28 Oct" below;
- "Use this run as a test example" for a project run:
  - the intro "Worca keeps the request and where the run started, so every new version of <workflow> can be tried on exactly the same thing.";
  - the box "Where it starts" with "Starts from where this run started: **main** at `abc1234` · 28 Oct", and "Project: worca-cc · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project.";
  - the dashed "For developers" box with "Before each try, run" ("Filled in from the project's setup.").
- Part 2's "What should a good result have?" note stays. Board 38's third keep row ("What this run changed, as a result you liked") is a later part.

**Match board 39:**
- in the picker, a Folder run and a workspace run are disabled, each with its sentence ("This run worked on a Folder project. Folder projects can't be tested yet." / "This run worked on several projects. Workflows on several projects can't be tested yet.");
- first use of a workflow that changes a project, with no run: "Worca found no runs of Fix a bug from a ticket yet. Run the workflow once on a project, or write an example yourself." (P16).
- The Part 2 empty state "Tests are for workflows without a project, for now" is removed (D62).

**Files:**
- Modify `ui/public/workflows/tests-view.mjs`:
  - a new `exampleHintEl`;
  - `table` (:90-116);
  - `list`'s foot (:151-153);
  - `firstUse` (:156-212);
  - `renderTestsPage` (:214-236), where the `!o.testable` branch goes.
- Modify `ui/public/workflows/test-dialogs.mjs`: `canUseAsExample` (:16-19), `openPickRunDialog` (:22-53), `openFromRunDialog` (:66-111).
- Modify `ui/public/app.js`: `wftPickRun` (:3796-3804), `wftAddFromRun` (:3806-3822), `wftRunMenuItems` (:3824-3832).
- Modify: `ui/public/style.css`.
- Modify `test/ui-workflow-tests-view.test.mjs` (:148-158) and `test/ui-workflow-test-dialogs.test.mjs` (:80, :84-91): the D20 state and the "without a project" sentences.
- Test: `test/ui-workflow-tests-project-list.test.mjs`

**Interfaces:**
- Consumes:
  - the overview's `needsProject`, `examples[].{project, ready, reason}` and `pastRuns[].{project, refusal, refusalText}` (Task 8);
  - the past-run summary's `project` (Task 8);
  - `POST …/examples/from-run`'s `setupCmd`.
- Produces:
  - `exampleHintEl(doc, e, { dateText }) → HTMLElement`;
  - `canUseAsExample({ flag, noProject, projectRun, status, templateId, reserved })`;
  - `openPickRunDialog({ …, needsProject })`;
  - `openFromRunDialog({ …, dateText })`, whose submit body gains `setupCmd`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-tests-project-list.test.mjs`:

```js
// test/ui-workflow-tests-project-list.test.mjs — workflow tests 3a: the Tests list with project examples (board 38), a past
// project run (board 38), first use and the refused rows (board 39), and the run page's ⋯ for a project run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestsPage } from '../ui/public/workflows/tests-view.mjs';
import { openPickRunDialog, openFromRunDialog, canUseAsExample } from '../ui/public/workflows/test-dialogs.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const proj = (over = {}) => ({ key: 'worca-cc-1a2b3c4d', name: 'worca-cc', path: '/code/worca-cc', state: 'ok', startSha: 'abc1234'.padEnd(40, '0'),
  short: 'abc1234', startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', changes: false, setupCmd: 'npm ci', behind: 0, ...over });
const ex = (id, name, over = {}) => ({ id, name, hasRequest: true, files: [], fromAt: null, note: null, tries: 3, basics: 4, checks: 1,
  cells: { 2: { passed: 3, total: 3, stale: false, past: null }, draft: { passed: 1, total: 3, stale: false, past: null } },
  project: proj(), ready: true, reason: null, readyText: null, ...over });
const overview = (over = {}) => ({
  workflowId: 'wf_fix', name: 'Fix a bug from a ticket', testable: true, reason: null, needsProject: true, ctx: { liveVersionNo: 2, latestVersionNo: 2 },
  columns: [{ use: 2, label: 'v2 · the team uses it' }, { use: 'draft', label: 'v3 draft · yours' }],
  examples: [
    ex(1, 'Ticket 482: invoice totals round wrong', { project: proj({ behind: 14 }) }),
    ex(2, 'Ticket 471: date filter ignores the time zone', { project: proj({ short: 'e9f2c47', changes: true }) }),
    ex(3, 'Ticket 497: export button does nothing', { project: null, ready: false, reason: 'pick-project', readyText: 'Ticket 497 is left out: pick its project first.', cells: { 2: null, draft: null } }),
  ],
  running: null, latest: null, pastRuns: [], ...over,
});
function boot(o) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const actions = new Proxy({}, { get: () => () => {} });
  const root = window.document.getElementById('root');
  renderTestsPage(root, o, actions, { doc: window.document, dateText: () => '28 Oct', now: Date.parse('2026-10-28T12:00:00Z') });
  return { root, doc: window.document };
}

test('board 38: project examples in the list, the moved-on line, an example left out, the foot', () => {
  const { root } = boot(overview());
  const rows = [...root.querySelectorAll('.wft-row:not(.wft-row-head)')];
  assert.equal(rows[0].querySelector('.wft-ex > .hint').textContent, 'Request · worca-cc · from abc1234');
  assert.equal(rows[0].querySelector('.wft-ex > .hint .code').textContent, 'abc1234');
  const moved = rows[0].querySelector('.wft-moved-line');
  assert.deepEqual([moved.querySelector('.badge').textContent, moved.querySelector('.badge').className], ['Moved on', 'badge amber']);
  assert.equal(moved.lastChild.textContent, 'The project has moved on: 14 newer commits on main since this start point.');
  assert.equal(rows[1].querySelector('.wft-ex > .hint').textContent, 'Request · worca-cc · from e9f2c47 · with changes not committed yet');
  assert.equal(rows[2].querySelector('.wft-ex > .hint').textContent, 'Request only · no project yet, so it is left out of tests');
  assert.deepEqual(texts(rows[2], '.wft-res'), ['Pick a project first', 'Pick a project first']);
  assert.equal(root.querySelector('.wft-foot-start').textContent, 'Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.');
  assert.equal(root.querySelector('.wft-not-testable'), null, 'the D20 state is gone (D62)');
});

test('board 39: first use of a workflow that changes a project; a Folder and a workspace run are listed, disabled', () => {
  const none = boot(overview({ examples: [], pastRuns: [] }));
  assert.equal(none.root.querySelector('.wft-pick > .hint').textContent, 'Worca found no runs of Fix a bug from a ticket yet. Run the workflow once on a project, or write an example yourself.');
  const some = boot(overview({ examples: [], pastRuns: [
    { pipelineId: 'aaaa0001', title: 'Fix: invoice totals round wrong', at: '2026-10-28T09:00:00Z', status: 'done', files: 0, sameAs: null, project: 'worca-cc', refusal: null, refusalText: null },
    { pipelineId: 'aaaa0002', title: 'Fix: broken link on the help page', at: '2026-10-18T09:00:00Z', status: 'done', files: 0, sameAs: null, project: 'docs-site', refusal: 'folder',
      refusalText: "This run worked on a Folder project. Folder projects can't be tested yet." }] }));
  const boxes = [...some.root.querySelectorAll('.wft-pick-box')];
  assert.deepEqual(boxes.map((b) => [b.checked, b.disabled]), [[true, false], [false, true]]);
  assert.equal(some.root.querySelector('.wft-pick-why').textContent, "This run worked on a Folder project. Folder projects can't be tested yet.");
  assert.match(some.root.querySelectorAll('.wft-pick-row')[0].textContent, /worca-cc · 28 Oct/);
});

test('board 38/39: the picker: a project run\'s title, badge and sub-line; refused runs disabled with why; none', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const picked = [];
  openPickRunDialog({ doc, win: window, workflowName: 'Fix a bug from a ticket', needsProject: true, dateText: () => '28 Oct', onPick: (id) => picked.push(id), runs: [
    { pipelineId: 'aaaa0001', title: 'Fix: invoice totals round wrong', at: 'x', status: 'done', project: 'worca-cc', refusal: null },
    { pipelineId: 'aaaa0003', title: 'Fix: login fails in the app and the API', at: 'x', status: 'done', project: 'mobile-app, api', refusal: 'workspace',
      refusalText: "This run worked on several projects. Workflows on several projects can't be tested yet." }] });
  const rows = [...doc.querySelectorAll('.wft-pick-row')];
  assert.deepEqual(texts(rows[0], '.wft-pick-top b, .wft-pick-top .badge, .wft-pick-sub'), ['Fix: invoice totals round wrong', 'Finished', 'worca-cc · 28 Oct']);
  assert.equal(rows[1].querySelector('input').disabled, true);
  assert.equal(rows[1].querySelector('.wft-pick-why').textContent, "This run worked on several projects. Workflows on several projects can't be tested yet.");
  rows[0].querySelector('input').checked = true;
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Next'));
  await tick();
  assert.deepEqual(picked, ['aaaa0001']);
  const { window: w2 } = new JSDOM('<!doctype html><body></body>');
  openPickRunDialog({ doc: w2.document, win: w2, workflowName: 'Fix a bug from a ticket', needsProject: true, runs: [], dateText: () => '', onPick() {} });
  assert.equal(w2.document.querySelector('.mk-dialog-body > .hint').textContent, 'Worca found no runs of Fix a bug from a ticket yet. Run the workflow once on a project, or write an example yourself.');
});

test('board 38: use a project run as a test example: where it starts, its setup, and what is sent', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const sent = [];
  const past = { pipelineId: 'aaaa0001', workflowId: 'wf_fix', workflowName: 'Fix a bug from a ticket', title: 'Ticket 482: invoice totals round wrong',
    request: 'Ticket 482', files: [], qa: [{ question: 'Should old invoices change too?', answer: 'No.' }], use: 2, useLabel: 'v2', testable: true, reason: null,
    project: { key: 'worca-cc-1a2b3c4d', name: 'worca-cc', startSha: 'abc1234'.padEnd(40, '0'), short: 'abc1234', startRef: 'main', startAt: '2026-10-28T09:00:00Z', setupCmd: 'npm ci' } };
  openFromRunDialog({ doc, win: window, past, dateText: () => '28 Oct', onSubmit: async (b) => { sent.push(b); return { ok: true }; } });
  assert.equal(doc.querySelector('.wft-fr-intro').textContent, 'Worca keeps the request and where the run started, so every new version of Fix a bug from a ticket can be tried on exactly the same thing.');
  const box = doc.querySelector('.wft-startbox');
  assert.deepEqual(texts(box, ':scope > span'), ['Where it starts', 'Starts from where this run started: main at abc1234 · 28 Oct',
    "Project: worca-cc · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project."]);
  assert.equal(box.querySelector('b').textContent, 'main');
  assert.equal(doc.querySelector('#wft-fr-setup').value, 'npm ci');
  assert.equal(doc.querySelector('#wft-fr-setup').closest('.field').querySelector('.hint').textContent, "Filled in from the project's setup.");
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Add example'));
  await tick();
  assert.equal(sent[0].setupCmd, 'npm ci');
});

test('the run page ⋯ offers Use as test example for a single-project git run too, never a workspace run', () => {
  const base = { flag: true, status: 'done', templateId: 'wf_fix', reserved: false };
  assert.equal(canUseAsExample({ ...base, noProject: false, projectRun: true }), true);
  assert.equal(canUseAsExample({ ...base, noProject: false, projectRun: false }), false);
  assert.equal(canUseAsExample({ ...base, noProject: true }), true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-tests-project-list.test.mjs`
Expected: FAIL. The first row's hint reads `Request only` (no project hint yet).

- [ ] **Step 3: The list and first use (`ui/public/workflows/tests-view.mjs`)**

Add:
```js
import { NO_PROJECT_YET_HINT, WITH_CHANGES_HINT, MOVED_BADGE, behindText, PICK_FIRST_TEXT, LIST_FOOT_HINT, firstUseNoneText }
  from '../../../src/shared/workflow-tests/project-text.mjs';

/** Board 38: the hint under an example's name, with its project and start point; an example left out says so. */
export function exampleHintEl(doc, e, { dateText = defaultDate } = {}) {
  const h = el(doc, 'span', 'hint');
  if (e.reason === 'pick-project') { h.textContent = NO_PROJECT_YET_HINT; return h; }
  if (!e.project) { h.textContent = exampleHint(e, { dateText }); return h; }
  const lead = !e.hasRequest ? 'No request yet' : e.files && e.files.length ? `Request + ${e.files.join(', ')}` : 'Request';
  h.append(doc.createTextNode(`${lead} · ${e.project.name} · from `), el(doc, 'span', 'code', e.project.short));
  if (e.project.changes) h.append(doc.createTextNode(WITH_CHANGES_HINT));
  return h;
}
```
In `table`, replace `name.append(btn(…), el(doc, 'span', 'hint', exampleHint(e, { dateText })));` with:
```js
    name.append(btn(doc, e.name, () => actions.openExample(e.id), 'wft-ex-open'), exampleHintEl(doc, e, { dateText }));
    if (e.project && e.project.behind > 0 && e.project.startRef) {   // board 38: the branch moved on (D63)
      const moved = el(doc, 'span', 'wft-moved-line');
      moved.append(el(doc, 'span', 'badge amber', MOVED_BADGE), el(doc, 'span', '', behindText(e.project.behind, e.project.startRef)));
      name.append(moved);
    }
```
and the results line with:
```js
    const results = o.columns.map((c) => {
      const v = e.ready === false ? el(doc, 'span', 'wft-res is-none', PICK_FIRST_TEXT) : cellView(doc, e.cells[String(c.use)] || null);   // D62, board 38
      v.dataset.label = c.label;
      return v;
    });
```
In `list`, after the "Why 3 tries?" foot, add:
```js
  if (o.examples.some((e) => e.project)) page.append(el(doc, 'p', 'hint wft-foot-start', LIST_FOOT_HINT));   // board 38
```
In `firstUse`:
- replace the "no runs" sentence with `firstUseNoneText(o.name, { needsProject: !!o.needsProject })`;
- in the rows loop, a refused run is listed but cannot be picked:
```js
    box.disabled = !!r.refusal;
    box.checked = !r.refusal && !r.sameAs && ticked < 3;
```
- the detail gains the project: `const detail = [r.project, dateText(r.at), r.files ? … : null, r.sameAs ? … : null].filter(Boolean).join(' · ');`;
- after `text.append(…)`, add `if (r.refusalText) text.append(el(doc, 'span', 'wft-pick-why', r.refusalText));`.
- `picked()` reads only enabled, checked boxes: `boxes.filter((b) => b.checked && !b.disabled)`.

In `renderTestsPage`, delete the `else if (!o.testable) { … }` branch (D62: every workflow can be tested).

- [ ] **Step 4: The dialogs (`ui/public/workflows/test-dialogs.mjs`)**

Add:
```js
import { pickerNoneText, fromRunIntro, WHERE_TITLE, STARTS_FROM_RUN, pastRunProjectNote, DEV_CAPTION, SETUP_LABEL, SETUP_HINT_PAST }
  from '../../../src/shared/workflow-tests/project-text.mjs';
```
`canUseAsExample`:
```js
/** G6 (3a: a project run too): the run page's More menu offers "Use as test example" for a finished run without a project or
 *  a finished single-project git run (D65) of a saved user workflow. Folder and workspace runs are refused by the server. */
export function canUseAsExample({ flag, noProject, projectRun = false, status, templateId, reserved }) {
  return !!flag && (!!noProject || !!projectRun) && ['done', 'stopped', 'error'].includes(String(status || '')) && !!templateId && !reserved
    && templateId !== AUTO_WORKFLOW_ID && !/^wfp_/.test(String(templateId));
}
```
`openPickRunDialog({ doc, win, workflowName, runs = [], dateText, onPick, needsProject = false })`:
- the empty sentence becomes `pickerNoneText(workflowName, { needsProject })`;
- in the rows loop, a row with a project or a refusal uses board 38's two lines, and a refusal disables it:
```js
      if (r.project || r.refusal) {
        const top = el(doc, 'span', 'wft-pick-top');
        top.append(el(doc, 'b', '', r.title), runStatusBadge(doc, r));
        text.append(top, el(doc, 'span', 'wft-pick-sub', [r.project, dateText(r.at)].filter(Boolean).join(' · ')));
        if (r.refusalText) text.append(el(doc, 'span', 'wft-pick-why', r.refusalText));
        radio.disabled = !!r.refusal;
      } else {
        text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${dateText(r.at)} · `), runStatusBadge(doc, r));   // Part 2 (C11)
      }
```
  (replacing the single `text.append(…)` line);
- `onConfirm` finds `.find((x) => x.checked && !x.disabled)`.

`openFromRunDialog({ doc, win, past, onSubmit, dateText = (s) => s })`. Before `return testDialog(…)`, add:
```js
  // Board 38 (D65): a project run's example starts where the run started; its setup is filled in from the project's.
  let startBox = null;
  let setup = null;
  let devBox = null;
  if (past.project) {
    startBox = el(doc, 'div', 'wft-startbox');
    const where = el(doc, 'span');
    where.append(doc.createTextNode(STARTS_FROM_RUN), el(doc, 'b', '', past.project.startRef || past.project.short), doc.createTextNode(' at '),
      el(doc, 'span', 'code', past.project.short), doc.createTextNode(` · ${dateText(past.project.startAt)}`));
    startBox.append(el(doc, 'span', 'label', WHERE_TITLE), where, el(doc, 'span', 'hint', pastRunProjectNote(past.project.name)));
    setup = el(doc, 'input');
    setup.type = 'text'; setup.id = 'wft-fr-setup'; setup.className = 'wft-mono'; setup.maxLength = 4000; setup.value = past.project.setupCmd || '';
    devBox = el(doc, 'div', 'wft-dev');
    devBox.append(el(doc, 'span', 'wft-dev-cap', DEV_CAPTION), field(doc, SETUP_LABEL, setup, { id: setup.id, hint: SETUP_HINT_PAST }));
  }
```
In the `testDialog` call, change the intro to `past.project ? fromRunIntro(past.workflowName) : <Part 2's sentence>`. Make the body `[intro, nameField, ...(startBox ? [startBox] : []), keep, ...(devBox ? [devBox] : []), howField, noteField, hint]`. Add `...(setup ? { setupCmd: setup.value.trim() || null } : {})` to the `onSubmit` object.

- [ ] **Step 5: Wire it (`ui/public/app.js`)**

- In `wftPickRun`, pass `needsProject: !!o.needsProject` to `openPickRunDialog`.
- In `wftAddFromRun`, pass `dateText: wftDate` to `openFromRunDialog`.
- In `wftRunMenuItems`, compute whether the run is a single-project git run:
```js
  const noProject = !!st && isNoProjectRun({ ...record, state: st });
  const projectRun = !!st && !noProject && st.target !== 'workspace' && (!st.workMode || st.workMode === 'git');   // D65
  const ok = !!record && canUseAsExample({ flag: flagOn('workflowTests'), noProject, projectRun,
    status: st && st.status, templateId: tpl && tpl.id, reserved: !!(tpl && tpl.id && isReservedWorkflowId(tpl.id)) });
```

- [ ] **Step 6: The CSS (`ui/public/style.css`, the 3a block)**

```css
.wft-moved-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--fs-meta);color:var(--ink-2);}
.wft-foot-start{margin:0;}
.wft-pick-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.wft-pick-sub{display:block;font-size:var(--fs-meta);color:var(--ink-2);}
.wft-pick-why{display:block;font-size:var(--fs-meta);color:var(--ink-2);}
.wft-pick-row:has(input:disabled){opacity:.7;}
.wft-startbox{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--canvas-2);font-size:var(--fs-body);}
```

- [ ] **Step 7: Update the Part 2 tests that pinned D20**

- `test/ui-workflow-tests-view.test.mjs:148-150`: replace the C8 block with the D62 one. A workflow that needs a project shows the list, not a refusal:
```js
  const np = boot(overview({ needsProject: true }));
  assert.equal(np.root.querySelector('.wft-not-testable'), null, 'D62: a workflow that needs a project is testable');
```
- `test/ui-workflow-tests-view.test.mjs:158`: `'Worca found no runs of Product brief writer yet. Write an example yourself, or run the workflow once and come back.'`.
- `test/ui-workflow-test-dialogs.test.mjs:80`: `'Worca found no runs of Product brief writer yet. Run the workflow once, or write an example yourself.'`.
- `test/ui-workflow-test-dialogs.test.mjs` "G6" test (:84-91): keep its cases. A project run without `projectRun` is still refused, so they pass unchanged; add `projectRun: true` → `true`.

- [ ] **Step 8: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-tests-project-list.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflow-test-dialogs.test.mjs`
Expected: PASS.

Run the design guards and the style.css slicing tests. Expected: no new failure. `:has()` is a selector feature, not a property, so the CSS guards do not object. If `css-rules` refuses `:has`, drop that rule: the disabled radio is enough.

- [ ] **Step 9: Commit**

```bash
git add ui/public/workflows/tests-view.mjs ui/public/workflows/test-dialogs.mjs ui/public/app.js ui/public/style.css test/ui-workflow-tests-project-list.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflow-test-dialogs.test.mjs
git commit -m "Workflow tests 3a: the Tests list with project examples, past project runs, first use; the D20 state removed (boards 38, 39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Docs, UI levels, the flag, the changelog, and the final verification

**Files:**
- Modify: `docs/storage.md`: a "Workflow tests on a project (v81)" section after "Workflow tests (v78)", before "Run groups (v65)" (:222).
- Modify: `docs/ui-levels.md`: a row after the Part 2 row (:295).
- Modify: `docs/feature-flags.md`: the `workflowTests` row (:35).
- Modify: `docs/changelog/unreleased.md`: a "(Part 3a)" entry after "Workflow tests (Labs)" (:22-41), and that entry's "without a project" bullet.
- Modify: `plans/workflow-tests-plan.md` (the overview): Part 3 is project workflows; the later parts move up by one.

- [ ] **Step 1: Write the docs**

**`docs/storage.md`.** Insert after the v78 section:
```markdown
### Workflow tests on a project (v81)

Behind the flag `workflowTests`, like v78. FK-free like the v78 tables.

- `wf_test_example_projects`: one row per example that works on a project:
  - the project's key, the commit the example starts from (`start_sha`), the branch it was taken from (`start_ref`) and that
    commit's date;
  - the person's uncommitted changes at save time, as a binary patch (`changes`, at most 5 MB, with its sha256), when they
    chose to keep them;
  - `start_commit`: the commit tries start from. It is `start_sha` itself, or, with changes, Worca's own commit of `start_sha`
    plus the patch, made in Worca's copy with a fixed identity and date so it is the same every time;
  - the "Before each try, run" command (`setup_cmd`).
- `wf_test_tries` gains `start_commit`, `disk_bytes` (the checkout's size after its setup, measured once per example and start),
  `setup` (JSON: the command, ok, exit code, time and the last 40 lines of its output) and `changes` (JSON: the first 50
  changed files with their status and line counts, and the totals).
- **Worca's copy of a project** (`<worcaHome>/workflow-tests/repos/<projectKey>`): a `git clone --local --no-checkout` of
  the project with no remote, `core.longpaths` on and automatic gc off. Start points are pinned as `refs/worca-tests/<sha>`.
  Each try is a worktree of it under its run folder (`<worcaHome>/runs/<pipelineId>/repos/<projectKey>`), on its own branch
  (`worca-cc/…`). Worca removes the checkout, the branch and the run folder after the try's checks. At boot, it also removes
  what a restart left. `projectKey()` answers the real project's key for the copy and its worktrees, so a try reads the
  real project's settings and its row carries the real key. The person's own repository is only ever read.
- A try's pipeline folder keeps `results.json` and `diff-patch.patch` (what it changed), `try-setup.json` (its setup run),
  and in `connector-calls.ndjson` every push, pull request, issue, publish or web request the outward guard stopped
  (`guard: true`), beside a pretend try's connector calls.
- `<worcaHome>/workflow-tests/bin`: the `gh`, `glab` and `az` stand-ins a try finds first on its PATH (sh and `.cmd`).
  `<worcaHome>/workflow-tests/no-auth/{gh,glab,az}`: empty config folders, so those CLIs have no sign-in in a try.
```

**`docs/ui-levels.md`.** Add a row after the Part 2 `workflowTests` row:
```markdown
| Behind the flag `workflowTests`, Simple (Part 3a: the same people test workflows that change a project): in the example editor, Where it starts (the project, the start point and Change, the moved-on note with Start from the latest, the uncommitted-changes box, For developers › Before each try, run), the project checks (The command passes; text checks that read a file), the board 39 notes; in Test a version the Disk and Time rows, the lock line and the not-enough-disk refusal; the phases and Disk in use while it runs, and the setup-failed stop; What changed in the project and what a try would have sent on one example side by side; project runs in Add from a past run and in a run's More menu | all |
```

**`docs/feature-flags.md`.** In the `workflowTests` row, replace "Tries are hidden runs without a project; their cost counts in the spending limit." with:

"Tries are hidden runs, without a project or, for an example that names one, in Worca's own copy of a git project from a fixed start point (your folder and branches are never touched). Their cost counts in the spending limit. No try ever pushes, opens a pull request or files an issue, also with Real connectors: what it tried is listed under Would have sent."

**`docs/changelog/unreleased.md`.** In the "Workflow tests (Labs)" entry, change the bullet "Tests work for workflows without a project for now. Their runs stay out of the Runs list, Statistics and team metrics, but count in the spending limit." to "Their runs stay out of the Runs list, Statistics and team metrics, but count in the spending limit.". Then add after that entry:
```markdown
## Workflow tests on a project (Labs, Part 3a)

**Test workflows that change a project's code, without touching your folder.**

- An example can name a Git project and a start point: a commit, kept the same until you change it, so two versions start
  from exactly the same code. Keep your changes that are not committed yet with it if you want. Worca says when the project
  has moved on, and Start from the latest moves the example.
- Each try works in Worca's own copy of the project. Your folder and your branches are never touched, and the copy of each
  try is deleted after its checks. The list of changes and the full diff stay to look at.
- Before each try, Worca can run a setup command (filled in from the project's setup, such as `npm ci`). If it fails, the
  test stops and no try counts as failed.
- A new automatic check: The command passes (such as `npm test`), with its summary line. Text checks can read a file of the
  project.
- Tests never push, open pull requests or change your project, also with Real connectors: what a try tried to send is listed
  under Would have sent.
- Test a version says how much disk and time a test needs, and refuses to start when the disk is too full.
- Add from a past run takes project runs too: the example starts where the run started.

Chips: Tests · Where it starts · The command passes · experimental: turn it on in Settings › Labs

Read it: [Where Worca keeps its state](../storage.md)

Pull requests (add each number when it opens):

- Workflow tests on a project (#<PR>)
```
Replace `#<PR>` when the PR opens.

**`plans/workflow-tests-plan.md`** (the overview, brief "Renumbering"). Before "### Part 3 — Your criteria" (:2163), add:
```markdown
### Part 3 — Project workflows: the detailed plans are [workflow-tests-part3a-plan.md](workflow-tests-part3a-plan.md) (3a: git projects, Worca's copy, the outward guard, the command check) and the 3b plan to come (plugins off in Pretend, the file-scope checks)
```
Then renumber the old parts by one: "### Part 3 — Your criteria" becomes "### Part 4 — Your criteria", Part 4 becomes Part 5 and Part 5 becomes Part 6. Change any "Part 3"/"Part 4"/"Part 5" reference to those parts in the same file to match (`Select-String -Path plans\workflow-tests-plan.md -Pattern "Part [345]"`). Part 2's plan keeps its own wording: it is history.

- [ ] **Step 2: Run the docs guards**

Run: `node tools/test.mjs test/ui-levels.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/storage.md docs/ui-levels.md docs/feature-flags.md docs/changelog/unreleased.md plans/workflow-tests-plan.md
git commit -m "Workflow tests 3a: docs (storage v81, UI levels, flag, changelog Part 3a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: The final verification**
  1. **Every test file this part touched.**
     - Run `node tools/test.mjs <files>` with the list from `git diff --name-only 25d1d5233 -- test`. Pass each file by name; PowerShell does not expand a `*`.
     - All must pass. The spawn-args POSIX-shim tests skip on Windows, as in the baseline.
  2. **The full suite against the Task 0 baseline.**
     - Run `node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs C:\Users\BRT1BG\worca-cc\worca-cc-tests3 C:\Users\BRT1BG\worca-cc\worca-cc-tests3\.superpowers\sdd\final-3a 4 300`.
     - Compare its failing files with `.superpowers\sdd\baseline-3a-failing.txt`.
     - A file that fails now and is not on the list is this part's until `node tools/test.mjs <file>` on 25d1d5233 and on the branch, back to back under the same load, shows otherwise.
  3. **Smoke:** `npm run smoke`. Use WSL with portable Node 22 if the engine path needs POSIX.
  4. **A mock end-to-end run in the browser.** Start the UI with `WORCA_FLAGS=workflowTests` and `WORCA_MOCK=1`, with a scratch git project registered (a `README.md`, a `package.json` whose `test` script prints `# pass 3` and `# fail 0`, and `node_modules/` ignored).
     - On a coding workflow (task → Implementation → end):
       - save version 1 and edit the draft;
       - add an example on the project, with "Include my changes that are not committed yet" ticked over one edited file, the setup `node -e "require('fs').mkdirSync('node_modules/x',{recursive:true})"` and the check "The command `npm test` passes";
       - add a second example from a past project run (it starts where the run started);
       - make a commit in the project: the list shows "Moved on" and the editor shows Start from the latest; use it once.
     - Test v1 against the draft with 1 try. While it runs, check:
       - the phases card, the Now column and Disk in use;
       - nothing in Runs, History or Statistics;
       - `git -C <project> worktree list` and `git -C <project> branch` are unchanged.
     - Open one example side by side, and check:
       - What changed in the project with the diff of a picked file;
       - Read all the changes;
       - the command's value;
       - Would have sent ("Nothing would have been sent. The changes stayed in Worca's own copy of the project: nothing was pushed.");
       - For developers.
     - Set the setup to `node -e "process.exit(1)"` and start again: the setup-failed stop, See the setup output, Edit the example and Try again.
     - Check light and dark at 1440 px and 390 px, and compare with boards 32–39.
     - After the test, check that `<home>\workflow-tests\repos\<key>` has no `worca-cc/*` branch and no extra worktree, and that `<home>\runs\` has no folder of a finished try.
  5. **The proofs:** Task 9's `real-call-proof-3a.md` holds the free proof and, only if the user said yes to it, the paid proof.
  6. **Not covered by 3a, stated in the PR:**
     - plugins, skills, agents and hooks of the person stay on in Pretend tries (3b, D46);
     - "Changes only files under…", "Leaves these files unchanged" and "Changes at most N files" are 3b;
     - Folder projects and workspaces are a later part;
     - a hand-made web call with a typed token is not blocked (no network block yet);
     - a setup that edits tracked files shows those edits as changes.

- [ ] **Step 5: Before the PR (needs the user's go)**
  - **PR body:**
    - the `npm test` comparison numbers and the smoke result;
    - UI level Simple, flag `workflowTests`;
    - screenshots of boards 32–39's screens, light, dark and 390 px;
    - the proofs' results;
    - "Part 3a of the workflow tests issue; stacked on Part 2".
  - **Schema:** if `dev` or another PR took 81 meanwhile, renumber per the Global Constraints before the PR.

---

## Later (3b and beyond)

- **3b: plugins off in Pretend (D46, Q7, Q8).**
  - Pretend tries spawn with `settingSources: ['project', 'local']`.
  - Only the sign-in is carried over from user settings (`userClaudeSignIn`).
  - The copy's committed `.claude/settings.json` loses its `hooks` and `enabledPlugins`, and that path is kept out of the diff.
  - Board 34's two "Part 3b" lines ("Your personal Claude Code plugins, skills and hooks are switched off." / "The project's own instructions stay on. Its hooks and plugins are switched off.").
  - The brief §6 plugins-off proofs, free (a sandbox `CLAUDE_CONFIG_DIR` with a plugin and marker hooks) and paid (a user `PreToolUse` hook does not fire; sign-in works under `project,local`), plus a security review of the sign-in carry-over.
- **3b: the file-scope checks (Q10).** "Changes only files under …", "Leaves these files unchanged" and "Changes at most N files". They are pure, in `src/shared/workflow-tests/checks.mjs`, read the try's change list (Task 6's `project.files` / `paths`), and have the board 33 fields and the board 36 rows marked "Part 3b".
- **3b: the before-and-after command run** (approved 2026-10-29; SWE-bench FAIL_TO_PASS / PASS_TO_PASS, see [workflow-tests-eval-frameworks.md](workflow-tests-eval-frameworks.md)). "The command passes" also runs once on the start commit, cached per start point; the result separates "tests the change made pass", "tests that passed before and still pass" and "tests it broke".
- Folder (non-git) projects as examples (Q1 b): a kept copy per example, up to 1 GB.
- Workspace / several-project workflows.
- "The test Worca did not see passes" (hidden test files, board 6) and "A result you liked" (boards 32, 38).
- Your criteria (the old "Part 3", now Part 4), and the later parts shifted by one.
- A network-level block for tries (the egress proxy), which closes D56's stated limit.
- Git LFS and submodules in Worca's copy.
- Trying one at a time when copies are large (Q12 b).
- Parsing a failing test's name from the command output (P6).
- A setup that changes tracked files: commit its changes as part of the start, so they are not the try's.

---

## Self-review (done while writing; kept for the reviewer)

- **Brief coverage (3a scope):**
  - D41 → Tasks 2, 3, 8, 10. D42 → Tasks 1, 3, 4. D43 → Tasks 4, 7. D44/D55 → Tasks 4, 7, 11. D45/D56 → Tasks 5, 9, 12. D47 → Tasks 6, 8, 12. D48/D63/D64 → Tasks 2, 3, 8, 10, 13. D49/D60 → Tasks 3, 7, 8, 11. D50/D65 → Tasks 8, 13. D51/D62 → Tasks 7, 8, 10, 13. D52 → Task 1. D53, D54 → Task 3. D57–D59 → Task 6. D61 → Tasks 3, 7. D66 → Tasks 10–14. D67 → Tasks 6, 8, 12. D68 → Tasks 5, 8, 12. D69 → stated (no task).
  - Q2 → Tasks 3, 10. Q3 → Tasks 4, 10, 13. Q4 → Tasks 1, 3. Q5 → Tasks 5, 9, 11, 12. Q6 → Tasks 7, 11. Q9 → Tasks 8, 10, 13. Q10 (command only) → Tasks 6, 10. Q11 → Tasks 6, 10. Q12 → Tasks 7, 11. Q13 → Tasks 7, 12.
  - Q1, Q7, Q8 and the rest of Q10 are 3b or later (see "Later").
  - Boards: 32 → Task 10; 33 → Task 10; 34 → Task 11; 35 → Task 11; 36, 37 → Task 12; 38 → Task 13; 39 → Tasks 10 (editor states), 11 (disk), 13 (list, picker, first use).
  - The brief's §4 screens 1–9 each map to those tasks. Screen 9's "Workflows on several projects can't be tested yet" is built for past runs only (correction 11).
  - The brief's §6 free proofs for 3a are Task 5's tests and Task 9 Steps 1–5. The paid proof is Task 9 Step 7, controller only.
  - The brief's §7 risks:
    - the project key → Task 1 (the prototype, with its stop rule);
    - `keepCheckout`/setup leaving normal runs unchanged → Task 4's last test and Task 5's byte-identical tests;
    - Windows → Task 3's junction, `EPERM` and long-path tests, Task 5's `Path`/`.cmd` tests, Task 7's restart test, Task 9 Step 5;
    - disk/time honesty → Tasks 7, 8, 11;
    - the sign-in carry-over → 3b.
- **Placeholders.** None remain. Three things are decided at execution time by a named rule, not left open:
  - Task 9 Step 4 sets `TRY_DENY` to `[]` if the real CLI checks deny rules before hooks;
  - Task 2 Step 0's schema number follows the Global Constraints' merge-or-stop rule;
  - Task 1's stop-and-report rule.
- **Names across tasks.**
  - `testCopiesRoot`, `testCopyDirFor` and `testCopyKeyOf` are Task 1's. Tasks 3, 4, 7 and 8 use them.
  - `repoSnapshot` is Task 1's. Tasks 3, 4 and 8 use it.
  - The pin shape `{ key, startSha, startRef, startAt, startCommit, changes, setupCmd }` is Task 2's and Task 3's (`pinStart`). Task 8 makes it (`resolveProjectInput`, `exampleFromRun`).
  - `createExample(…, { project })`, `updateExample(…, { project })`, `readExampleChanges`, `lastDiskBytes` and `avgSetupMs` are Task 2's. Tasks 7 and 8 use them.
  - `ensureTestCopy`, `pinStart`, `ensureStartCommit`, `behindCount`, `treeBytes`, `freeDiskBytes`, `dirBytes`, `listBranches`, `removeTree`, `removeTryCheckout` and `sweepTestCopies` are Task 3's. `headOf`, `commitExists` and `commitDate` are Task 8's additions to the same file.
  - `runShellStep`, `tryShellEnv`, `readTrySetup`/`writeTrySetup`, `TRY_SETUP_STAGE` and `SETUP_TIMEOUT_MS` are Task 4's. Task 5 changes `tryShellEnv`'s body only. Tasks 6 and 7 use it.
  - `withTryGuardEnv`, `tryGuardHookEntry`, `withTryDeny`, `TRY_DENY`, `guardDecision`, `guardCall`, `NOT_SENT_TEXT` and `TRY_GUARD_LOG_ENV` are Task 5's. Tasks 6, 9 and 12 use them.
  - `isProjectRow`, `projectChanges`, `readCheckFile`, `runCommandCheck` and `checkTry(…, { onCommand })` are Task 6's. `projectOutcome` gains `key` in Task 7.
  - `testTargetOf` (now `{ testable: true, reason: null, needsProject }`) and `exampleReadiness` are Task 7's. So are `projectStateOf`, `readinessText`, `targetFor`, `diskPlanOf`, `prepareProject` and `cleanupTry` (service), and `phaseOf`/`diskOf` (runner). Task 8 uses them.
  - The route JSON shapes are Task 8's Interfaces. Tasks 10–13 read them by those names (`project`, `ready`, `reason`, `readyText`, `needsProject`, `pastRuns[].project/refusal/refusalText`, the plan's `project.{names, leftOut, disk, setupCmd, setupMs}`, the progress `project.{phases, disk, setupStop}` and `rows[].now`, the side by side's `start`, `nothingPushed` and `tries[].x.project`).
  - Every sentence is a `project-text.mjs` export. Tasks 3, 4, 5 and 7 add the server's, and Task 8 adds the rest. Tasks 10–13 import them, and each UI test pins the literal.
- **Constraints.**
  - No new identifier is called `version`.
  - The CSS uses existing tokens only. Each UI task checks the few it is unsure of (`--blue-line`, `--blue-ink`, `--peach-ink`) with `Select-String` and falls back to `--ink-2`.
  - The font sizes are `--fs-*` steps, and the radii `--r-*`.
  - `50%` appears nowhere new. The phase numbers are `--r-xs` squares, not circles, so no `ROUND` name is needed.
  - The one new checkbox (`wft-changes-box`) has its `JS_CHECKBOX_OK` row.
  - New icons come from `icons.mjs` (`lock`).
  - Every route is behind the flag, and the flag-off test counts the four new ones.
  - Tests read no `plans/` file and use the mock engine. The one real-CLI script lives outside `test/` and calls no model.
