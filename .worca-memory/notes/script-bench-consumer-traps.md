---
name: script-bench-consumer-traps
description: Read before planning, writing or reviewing a caller of runBenchOnce/script-store, a scripts `:key` route, a share channel or a script delete path
paths: src/core/script-bench.mjs, src/core/script-store.mjs, src/core/graph/script-runner.mjs, src/core/plugin-script-cases.mjs, ui/server.mjs, test/api-scripts.test.mjs, test/plugin-*.test.mjs, test/script-*.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Plans written against an earlier PLAN TEXT of the bench/store and run against landed code missed these; a green suite and a byte-identical tested-tree match hid them. Chat tools over the same engine: [[ask-script-tools-traps]].

## Bench (`runBenchOnce` / `Bench`)
- A Run-all with ZERO saved cases REJECTS (`BAD_REQUEST: script "<key>" has no saved cases`): count `readScript(key).cases + userCases` yourself for "no cases = green no-op".
- `request.timeoutMs` under 1000 is silently IGNORED (the script's own timeout stands), over 86400000 clamped: range-check user-typed timeouts.
- `caseId`/`all` resolve through `readScript(key)` — the REAL registry, never `deps.registry`. With a registry override (linting a plugin dir) run each case LOOSE (`params`, `inputs`, `ports`, `timeoutMs`, `cwd: scratch`) and call `evaluateExpect` yourself (`result.expect` is `null` otherwise). A `caseId` run takes cwd AND timeoutMs from the CASE.
- cwd: `Bench._cwd(cwd, dirs)` → `{cwd, checkpointRef}` (exported `resolveBenchCwd`); only the scratch arm `mkdir`s `dirs.cwd`. The server's `createBench(request)` passes NO `deps`: a capability the browser must never have (`allowDirCwd`) goes in `deps`, pinned as never set by `ui/server.mjs`.
- Two conditional outputs may share ONE filename (built-in `shell`: `log` and `fail`): `outputs[port].bytes` can be non-zero for a port that never fired — gate on `result.fired`.
- An expectation naming no verdict (`{fired: []}`) is SATISFIED by a stopped/cut-short/timeout/error run: check `status === 'clean'/'blocking'` BEFORE `expect`.
- `writeBenchInputs` refuses a non-`{text}` shape and undeclared ports, but a NON-object value (`inputs: {plan: '# Plan'}`) is silently UNBOUND (the program throws on `undefined.path`) and a missing `required` input is not refused: check model/user-typed values are objects.
- Ctrl+C: hold the bench via `deps.onBench`, `bench.stop()` from a signal handler → `stopped`, no orphan.

## Store
- `SCRIPT_WIN32_TEMPLATE` is LF in memory; on-disk endings belong to `programText(runtime, text, {win32})` — any writer outside the store (a scaffolder) calls it.
- Keys no host loads (a plugin script keyed like a built-in script/agent, route segments `runtimes`/`bench`/`new`, Windows devices `con`/`nul`/`aux`/`com1`/`lpt1` even with an extension): `validatePluginDir` tolerates them; a scaffolder refuses them with `assertKeyAllowed` against the BUILT-IN layers only (`loadScriptRegistry({userScriptsDir:null, includePlugins:false, agentKeys:null})`, `loadAgentRegistry(undefined, {userAgentsDir:null, includePlugins:false})`).
- A key blacklist beside a `:key` route must be case-INSENSITIVE (express matches segments case-blind: `GET /api/scripts/Runtimes` answered the runtime probe). Probe every reserved name in another case against the real route.
- A route looking a param up in a plain-object registry (`loadScriptRegistry()[key]`): `constructor`, `toString`, `valueOf`, `hasOwnProperty` pass the key regex → 200 where 404 is owed (worse on WRITE routes). `Object.hasOwn(reg, key)`; probe routes AND store functions.
- A byte cap via `String.slice` is no byte cap: `readFile(f,'utf8')` + `slice(0, 262144)` keeps large multi-byte programs whole, can cut mid-character, and pulls a multi-GB file whole (past ~512 MiB "Invalid string length", read by `catch { source = '' }` as "no program" — a meta-only save then DROPS the file). Bounded read: `open()` + `read()` of cap+1 bytes, `new TextDecoder('utf-8', {ignoreBOM:true}).decode(buf, {stream:true})`.
- Recursive removal of a name read off a user-editable file: `deleteScript` removed `platformNames(existing.file)` from the sidecar ON DISK; `plainBasename` admits `"."` and sibling dir names and containment covers only the HOST platform's entry — `{default:"b.sh", win32:"."}` made a recursive `rm` wipe the user scripts folder, answering `{ok:true}`. Recurse only into names the store mints (`<key>.meta.json`, `<key>.tests.json`, `sourceFileFor(key, …)`); remove others non-recursively, swallow `EISDIR`. Probe delete paths with `file:"."`, a sibling dir and a non-host platform entry. Add no delete trigger before that narrowing lands.
- A lenient READ must forgive a declaration that CHANGED, not only one that vanished: `normalizeCases(…, {lenient:true})` failed a case whose enum lost the stored option or whose port was retyped, and the page wrote the list back, deleting it. Enumerate removed, renamed, retyped, re-optioned.

## Share channels and gates
- A security gate on ONE channel: `acceptScripts`/`SCRIPTS_UNCONFIRMED` guards `importGraphWorkflow` only; `importPluginWorkflows` installs a workflow placing the built-in `shell` card with any command, in no receipt. For any gate or receipt list every path writing the same rows (JSON import, plugin import, export-plugin, CLI) and probe each. Settled (P10): `importGraphWorkflow` fails closed for script commands (`SCRIPTS_UNCONFIRMED` unless `acceptScripts === true`) because `POST /api/workflows/import-json` calls it directly.
- A dry run returning before later checks (`importGraphWorkflow` returns at `dryRun` before the reserved-name step) lets the user confirm then fail: probe dry-run vs real with a reserved name.
- Uninstall guard vs export: the exporter bundles a user's script/agent under its OWN key, so a linked plugin's copy collides and is skipped on the author's host — a guard counting every key under `<current>/scripts` blocks `plugin remove` forever. A key whose LIVE registry entry has a different `origin` does not count. Drive export → link on the same home → remove as one flow.
- Other probes that paid off: `express.json` limit vs the spec's maxima; who iterates the shared `runs` Map (`summarizeRuns` → rail badge); `Promise.all` of two saves; case-variant keys (APFS/NTFS); over-cap file then Save; a no-op Save diffed on disk through the REAL store; multi-GB sparse outputs; 200k `console.log` lines; a tab hop mid-run.

## Test fences (a plan's own tests red as written)
One `WORCA_HOME` per test file: two fixture plugins with one script key are both "referenced" by the first test's saved workflow; a fake installer `symlinkSync`ing `current` is `EEXIST` on its second call (per-test keys; install once in `before()`); remove a linked fixture plugin's dir in `after()` (else a `broken` row). `await` inside the sync arrow given to `assert.rejects` is a SyntaxError that stops the WHOLE file (`node --check` every fence). A field added to a row a landed test `deepEqual`s: `grep -rn` the literal in `test/`. "No python" on any host: `WORCA_PYTHON=<missing path>` is the probe's only candidate; in-process also `resetPythonProbe()` before and after (bare `probePython()` caches 60 s).
