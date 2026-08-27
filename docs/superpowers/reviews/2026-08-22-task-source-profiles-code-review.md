# Code review — Task-source profiles, project/workspace bindings, jira-source plugin

**Branch:** `feat/task-source-profiles` (7 commits on top of `33d0be12` "worca 1.0 initial")
**Commits:** `c099f081` feat(core): per-profile plugin task-source config + bindings · `28b04ec6` feat(ui): profile roster, binding gate, Connect flow · `b24cd2c4` feat(examples): jira-source plugin · `a621fad8` docs(skill) · `00a9077c` feat(jira-source): per-run write-back · `fcffbf6f` fix(ui): New Pipeline gate understands SSO-pending · `55e20c35` fix: address 8 code-review findings
**Diff reviewed:** `git diff 33d0be12...HEAD` — 38 files, +3815 / −173
**Verdict:** NOT MERGEABLE AS-IS — 1 critical (stored token echoed into UI/doctor error text), 14 major, ~20 minor. No crash path found; two data-corruption paths (sibling-source config wipe via a profile named `default`; duplicate Jira comments on write-back retry).

Note: `master` is far behind (`master..HEAD` is the whole 1.0 restructure, 1896 files). The review base is the branch's own root commit `33d0be12`, which is also the merge-base with `origin/feat/task-source-profiles`.

## Method

Ten independent finder angles over the diff (line-by-line, removed-behaviour, cross-file tracing, JS/Node pitfalls, wrapper/adapter contracts, reuse, simplification, efficiency, altitude, conventions — the last empty by construction: the only CLAUDE.md in effect is `~/.claude/CLAUDE.md`, which defines a `/graphify` trigger and nothing else). 72 raw candidates → 30 deduplicated correctness mechanisms → one verifier agent each (27 CONFIRMED, 3 PLAUSIBLE, 0 REFUTED), with reproductions against the real modules: the real `callSource` + shim child + connector driven by a fake `jtr` on PATH, the real Express routes on a temp `WORCA_HOME`, and the real `app.js`/`source-pane.mjs` booted in jsdom. A final sweep added 6 more (1 promoted into the list). Pure cleanup candidates (duplicated poll loops/option builders, double file reads, bundle-before-probe ordering, etc.) were held back because correctness findings already exceed the 15-item cap; they are listed at the end.

Severity scale: **critical** = crash, data loss, security hole; **major** = user-visible defect on realistic input; **minor** = real but narrow, latent, or cosmetic.

---

## CRITICAL

### c1 — Stored PAT / API token is echoed into the Connect error shown in the browser and by `worca plugin doctor`

**File:** `examples/plugins/jira-source/connector/jtr-cli.mjs:160` (`jtr ${args.join(' ')} exited …`), `connector/index.mjs:402` (`authArgs` puts `--pat <token>` / `--token <token>` on argv), `connector/index.mjs:489` (`message: e.message` into the field error)

Any non-JSON jtr failure during a pat/token Connect (EACCES on a non-executable `jtrPath`, a Python traceback, an argparse usage error) produces the message `jtr auth pat --pat SUPERSECRET123 --json exited 1`, which `validateConfig` returns as `errors[0].message`. That string is rendered verbatim by the Settings Connect slot (`plugins-view.mjs:295`), the New Pipeline failBox, and `doctorPlugin`'s `JSON.stringify(r.errors)` — undoing the §7.6 "secret values never reach the browser after save" redaction. Reproduced with a fake `0644` `jtr`.

**Fix:** never interpolate argv into the error; redact the value of `--pat`/`--token` (and anything after a secret flag) before building the message, or report `jtr auth exited N` with stderr only.

---

## MAJOR

### M1 — A fetch failure during a project/target/workspace switch leaves the old pane and profile in place; the next Start runs the new project against the old profile

**File:** `ui/public/app.js:3589` (`await resolveSourceProfile(src)` with no catch; first `host.replaceChildren` and `state.activePluginProfile = …` come after it), `app.js:5772` (`pluginApi` has no try/catch around `fetch`)

`mountPluginSourcePane` is fire-and-forget from `onProjectChanged`, `setRunTarget`, the workspace select and `selectPluginSource`. If the server is restarting when the user switches project A → B, `GET /api/source-bindings` throws, the promise rejects unhandled, nothing is repainted, and `state.activePluginProfile` keeps A's profile while A's pane (picked task, "bound to A" bar) stays on screen. Start then posts `{projectDir: B, source: {profile: 'work', taskId: 'work-1'}}`; `/api/run` only checks that a profile is present (`ui/server.mjs:671`), never the binding. Reproduced in jsdom against the real `app.js`. The same hole ends the Settings Connect poll loop mid-SSO, freezing the slot on "Browser opening…".

**Fix:** catch in `pluginApi` (return `{ok:false, status:0, data:{error}}`), clear the host and reset `state.activePluginProfile = null` before the first `await`, paint `failBox` on rejection; optionally have `/api/run` cross-check `source.profile` against the scope's binding.

### M2 — Deleted or typo'd profile ids are accepted at submit and run against an empty or dead bucket

**File:** `ui/server.mjs:671` (POST /api/run), `ui/server.mjs:2505` (POST /api/sources/call), `src/cli/worca-cc.mjs:1157` (`plugin exec`)

All three check only that a multiProfile source has *some* valid-looking profile id; `PUT /api/source-bindings`, `GET /config` and `DELETE /profiles` check roster membership. Tab A resolves `work`, tab B deletes it, tab A presses Start → 200 (reproduced against the real routes) → `getTask` runs with default config and `JTR_CONFIG_DIR=jtr-home/work` (left intact, see M6) → `jtr view` succeeds on the deleted profile's cookies, the connector's `ctx.state.set` resurrects a phantom `work` state bucket no roster lists, and with writeBack=yes the result is commented onto the deleted instance. A never-existing id creates `jtr-home/nope` and dies mid-pipeline instead of 400ing; `worca plugin exec` without `--profile` runs a multiProfile source against the empty `default` bucket.

**Fix:** enforce "multiProfile ⇒ profile must be in `listProfileIds(plugin)`" once in `callSource` (it already has the normalized manifest) and let the routes/CLI inherit it.

### M3 — One 30 s shim budget is shared by up to four chained jtr calls; overrun loses all state, orphans jtr, and the retry posts duplicate Jira comments

**File:** `examples/plugins/jira-source/connector/jtr-cli.mjs:75` (20 s per call; comment claims it "stays under the shim's 30 s SIGKILL"), `src/core/plugin-shim.mjs:167` (pid-only `SIGKILL`, no process group), `plugin-shim-child.mjs:79` (stateDelta only in the final frame), `connector/index.mjs:609-612` (comment then transition)

`validateConfig` on a first pat Connect runs `--version` → `init` → `whoami` → `auth` (80 s envelope); `reportResult` runs `comment` → `transition` (40 s). Reproduced with the real `callSource` + connector and a 12 s/call fake jtr: whoami cut at 30.0 s, `state.json` left `{}` (so every retry re-runs `--version` + `init --force` + `whoami` and never converges), and the orphaned whoami finished with `ppid 1`. For write-back: comment lands at 18 s, the op is reported failed, the orphaned transition still completes, and each "Report result" click posts another comment (3 attempts → 3 comments). The duplicate-comment half does not even need latency: any failing `transitionOnComplete` name (the README's own example) reproduces it.

**Fix:** pass a deadline through `execJtr` so the chain fits the op budget (or raise `timeoutMs` per op); spawn the shim child detached and kill `-pid`; persist a per-task "commented" marker so retry only re-attempts the transition (and include `stateDelta` in error frames).

### M4 — The "fail-closed" capability probe still fails open when an implemented `capabilities()` throws

**File:** `src/core/sources.mjs:211-214`

The child maps every connector-thrown error to kind `plugin` (`plugin-shim-child.mjs:71`), the same kind used for "op not implemented", so `writeBack` defaults to `true`, `reportResult` runs against a per-run opt-out (`inputs.writeBack:'no'`), and the caller gets a bare `{ok:true}`. Verified through the real shim child: plain throw, `TypeError` and explicit `kind:'plugin'` all ran `reportResult`; `kind:'network'` did not. Only jira-source's own re-check inside `reportResult` masks it for the shipped plugin; third-party connectors following SKILL.md are exposed.

**Fix:** have the child emit a distinct kind/code for "op not implemented" and default to `writeBack:true` only on that.

### M5 — `default` straddles the implicit single-profile bucket and the roster: flipping a source to multiProfile strands its config, and a profile named `default` reads/overwrites/wipes a sibling single-profile source

**File:** `src/core/plugin-config.mjs:107` (`listProfiles` reads only `profiles.json`), `:30` (`PROFILE_ID_RE` accepts `default`), `:145` (`deleteProfile` wipes the per-plugin bucket), `ui/server.mjs:2385` (single-profile saves never enrol the roster)

Reproduced against the real routes: after a single-profile source gains `multiProfile:true`, `GET /config` → `{profile:null, profiles:[], values:{}}`, the gate says "add one", `POST /doctor` says `config:main ok` (fallback to the hidden bucket), `POST /api/run` → 400; `POST /profiles {id:'default'}` makes the old token reappear. With sources `main` (single) + `prof` (multi) sharing key `token`: creating `default` on `prof` echoes `main`'s secret as `{set:true}`, saving overwrites it, and `DELETE /profiles/default?sourceId=prof` passes the roster guard and empties `main`'s config, secrets and state.

**Fix:** reserve `DEFAULT_PROFILE` (reject it in `POST /profiles`), and seed the roster from a populated `default` bucket when a multiProfile source's roster is empty (or surface a "migrate existing settings" action).

### M6 — Deleting a profile leaves jtr's credentials and cookies on disk; a re-created profile silently inherits the old session

**File:** `src/core/plugin-config.mjs:145` (`deleteProfile` only drops JSON buckets), `examples/plugins/jira-source/connector/jtr-cli.mjs:50` (`jtrHome` under `os.homedir()/.worca-cc` regardless of `WORCA_HOME`), `ui/public/app.js:5865` (confirm text promises "Its settings, token … are removed")

After Remove, `jtr-home/<profile>/.env` (PAT) and the cookie jar remain. Re-create `work` for a different instance → state bucket is empty so `jtr init --force --no-auth` re-runs in the same dir, then `whoami` is trusted before `credentialErrors` → Connect reports `ok:true` as the OLD identity (fake-jtr probe). With `WORCA_HOME=/x` host data lives under `/x` while jtr-home lives under `~/.worca-cc`, so `uninstall --purge` never removes the credentials.

**Fix:** give connectors a host-owned per-profile data dir (`ctx.dataDir` under `pluginDataDir(name)`) that `deleteProfile`/purge own; until then, jira-source should `rmSync` its jtr-home on a `deleteProfile` hook or the host should expose one.

### M7 — `doctor` launches a detached browser SSO login per unauthenticated profile and reports `{pending}` as FAIL

**File:** `src/core/plugin-store.mjs:419`

`validateConfig` is documented as a check (SKILL.md:90) but jira-source implements the Connect state machine in it. Doctor (UI button or `worca plugin doctor`, which with no name runs every plugin) calls it per roster profile: each expired sso profile runs `jtr init`/`whoami`, spawns `jtr auth sso --force`, persists `ssoStartedAt` (stateDelta is persisted even for an `ok:false` result) and returns `{ok:false, pending:true}` which doctor renders as FAIL with raw JSON. Reproduced end-to-end with a fake jtr: two browser windows, both profiles stamped, and a Connect click in the next 5 minutes only says "Waiting…". `pending` is not part of the documented envelope.

**Fix:** move the login launch into an explicit `connect` op (or pass `{probe:true}` to validateConfig from doctor) and add `pending` to the contract so doctor renders it as "pending", not FAIL.

### M8 — A dead SSO login stays "Waiting for the browser login…" for the full 5-minute window; Connect and the browser dropdown are inert

**File:** `examples/plugins/jira-source/connector/index.mjs:496`

Inside the window the branch consults only `ssoStartedAt` + clock: `readLog` is reached only after expiry (`:502`) and `startSso` only when `ssoStartedAt` is falsy (`:509`). `startSsoLogin` drops the child handle (`jtr-cli.mjs:107-113`), so liveness cannot be checked. Probe with the real module: after jtr exits in ~1 s writing "No installed browser found", polls at +5 s/+60 s/+299 s return pending with `readLog` called 0 times, a Connect with `browser: 'firefox'` at +90 s does not relaunch, and each poll still spawns `jtr whoami` first. The README's troubleshooting advice ("Press Connect — it re-runs the sign-in", "pick a browser") is inert for the whole window.

**Fix:** record the child's pid in state and probe `process.kill(pid, 0)` per poll (or read `sso.log` for a terminal line inside the window); clear `ssoStartedAt` when a user-initiated Connect changed `browser`/`jtrPath`.

### M9 — Every project-list reload remounts the pane, wiping the picked ticket, JQL and search, and re-running validateConfig/listTasks in the background

**File:** `ui/public/app.js:3855` (`onProjectChanged` → `mountPluginSourcePane` unconditionally), reached from `renderProjectOptions` on Projects nav, `projects-changed` broadcast, Projects-view add/remove, Settings save, inline add-cancel/save/delete

Reproduced in jsdom for all six paths: the hidden pane is replaced with "Checking…", the same project's binding + validateConfig + listTasks fire again, and back on New Pipeline the hidden task id is `''` (Start fails with "Pick a task from the list first."). With an expired SSO session the hidden validateConfig launches a detached browser login and polls every 5 s from another view. `loadTaskSources`' own value-equality guard (`:3480-3489`) shows pane persistence was the intent.

**Fix:** resolve the binding first and only tear down/remount when the resolved profile (or source) actually changed; otherwise just refresh the bar's scope label.

### M10 — An ORDER BY-only JQL yields invalid `()` JQL with a search term, and an unscoped instance-wide listing without one

**File:** `examples/plugins/jira-source/connector/index.mjs:188` (`jqlWithSearch` wraps an empty `core`), `:78` (`withProject` bails on `!core`)

With `jql = 'ORDER BY created DESC'` and search `login`: `project = PROJ AND (() AND text ~ "login") ORDER BY created DESC` → parse error → "search failed". With empty search: `ORDER BY created DESC` is sent with `--all` → every issue in every project the user can browse, presented as project-scoped (real `createTaskSource` + fake exec). `ORDER BY project ASC` also trips `mentionsProject` and disables scoping.

**Fix:** treat an empty `core` as "no filter" (scope to `project = PROJ` and append the order), and test `mentionsProject` against the core only.

### M11 — Hyphenated search words (`utf-8`, `sha-256`, `login-2`) are sent as `key = UTF-8` and fail

**File:** `examples/plugins/jira-source/connector/index.mjs:520` (`ticketKeyFrom(search)`), `:43` (`KEY_RE` case-insensitive)

Any single `word-digits` token takes the paste-a-key fast path: `jtr search 'key = UTF-8 ORDER BY updated DESC' --all` (verified), which Jira rejects with a 400 for an unknown issue key, surfaced as "search failed: …" instead of the documented `text ~` search; it also flashes while typing a longer query through such a token.

**Fix:** on a plugin-kind (not auth/timeout) failure of the `key =` query, retry as the normal text search; optionally restrict the fast path to uppercase tokens or a prefix equal to the configured project.

### M12 — Two overlapping `validateConfig` calls both launch a detached SSO login into the same cookie jar

**File:** `examples/plugins/jira-source/connector/index.mjs:509`, `src/core/plugin-shim.mjs:151/197` (state read at spawn, delta written after the frame)

The Connect button is never disabled; a second click within the ~1-2.5 s the first child spends in `--version`/`init`/`whoami` gets a snapshot without `ssoStartedAt`, so both children spawn `jtr auth sso --force` — two browser windows, two writers to `sso.log`, last `ssoStartedAt` wins (reproduced through the real shim+child+connector: two launches, distinct pids, same `JTR_CONFIG_DIR`). The New Pipeline gate's own poll can collide the same way.

**Fix:** disable Connect while in flight and/or take an `O_EXCL` lock file in the profile's jtr-home before launching.

### M13 — First switch to the Workspace target mounts the pane before the workspace select is populated and never recovers

**File:** `ui/public/app.js:4152-4157` (`ensureWorkspaceOptions()` not awaited before `mountPluginSourcePane`)

Cold path (Workspaces view not visited): `bindingScopeRef()` reads an empty `#workspaceSelect` → "Select a project first — the source profile is bound to it." (project-mode wording) while the select is then restored programmatically without a `change` event; no `GET /api/source-bindings?workspaceId=` is issued until the user manually re-picks the workspace (jsdom probe; the warm path works).

**Fix:** `await ensureWorkspaceOptions()` (or remount from its completion) before mounting in workspace mode.

### M14 — The shim's scrubbed env (PATH+HOME) strips proxy/CA/DISPLAY from jtr and the SSO browser launch

**File:** `examples/plugins/jira-source/connector/jtr-cli.mjs:55` (`jtrEnv` spreads the child's env), `src/core/plugin-shim.mjs` (`scrubbedEnv`)

Verified through the real shim: `HTTPS_PROXY`, `NO_PROXY`, `REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE`, `DISPLAY`/`WAYLAND_DISPLAY` are all dropped, while worca's own claude/git children inherit the full env. For the plugin's stated target (corporate Server/DC Jira behind gateways) `jtr whoami` works in the terminal and Connect fails with an opaque connection/SSL error; on a Linux desktop the detached `jtr auth sso` has no DISPLAY and fails immediately, yet validateConfig reports pending for 5 minutes (M8). The README's PATH+HOME note covers only `jtrPath` resolution.

**Fix:** forward a documented allow-list of network/display variables from the host (or let the plugin declare config fields defaulting to `{"$env": "HTTPS_PROXY"}` and map them into `jtrEnv`), and document it.

---

## MINOR (verified, below the cap)

- **PUT /api/plugins/:name/config creates roster entries for unknown profile ids** — `ui/server.mjs:2385` calls `createProfile` unconditionally; a typo'd id or a stale form saved after the profile was deleted in another tab resurrects it as a zombie (label degraded, token gone, bindings not restored). Contradicts the GET guard's "must not quietly create the typo as a real profile".
- **execJtr error classification** — `jtr-cli.mjs:82`: only ENOENT is recognised; EACCES (directory / non-executable jtrPath) and maxBuffer collapse to a blank `exited 1` pinned on the *ticketUrl* field; any signal death is reported as `timed out` with stderr discarded.
- **Stale listTasks response overwrites a newer one** — `source-pane.mjs:170`: no request sequencing; a slow mount-time or filter-change listing landing after a narrower search repaints the rows and drops `.sel` (hidden taskId and preview survive).
- **Stale gate binds the previous project** — `app.js:3597`: during a remount's `await resolveSourceProfile`, the old project's gate is still clickable and its `onPick` PUTs the captured `resolved.ref` (reproduced by deferring the GET).
- **In-flight op resurrects a just-deleted profile's state bucket** — `plugin-shim.mjs:197` writes `stateDelta` unconditionally; a profile re-created under the same id inherits stale `ssoStartedAt`/`baseUrl`.
- **CLI remove/purge and orphan purge leave `source_bindings` rows** — `worca-cc.mjs:1054`; after purge + reinstall a same-id profile is silently re-bound `via:'binding'`, bypassing the gate. Cleanup lives only in the HTTP routes.
- **Legacy flat file with a key literally named `profiles`** — `plugin-config.mjs:58`: misread as the envelope (siblings dropped, phantom profile ids) or discarded via the `_garbage` destructure; first write persists the loss. Needs that key name; flat format shipped in @worca/app 1.0.0.
- **writeBucket cross-process lost update** (PLAUSIBLE) — `plugin-config.mjs:79`: unlocked whole-envelope RMW; two processes (server + `plugin exec`/`doctor`) writing different profiles within ~0.2 ms drop each other's bucket (25-35 % loss under a tight loop; state is a re-derivable cache).
- **Connect renders HTTP-level errors as "connection failed"** — `plugins-view.mjs:291` reads `error.message` but non-2xx bodies carry a string `error` (404 plugin not found, 400 profile required, 500).
- **Untrimmed `jtrPath` and `pat`** — `index.mjs:275/402`: a trailing space yields an invisible ENOENT / a 401 with no hint.
- **`writeBack` select re-runs listTasks and drops the picked row's highlight** — `source-pane.mjs:216`: every non-browser input re-runs the listing, including one `listTasks` never reads.
- **"Type to search." is unreachable** — `source-pane.mjs:176`: select defaults (`filter='none'`, `writeBack='no'`) count as user input.
- **bindingScope skips `normalizeProjectPath`** (PLAUSIBLE, API-only) — `ui/server.mjs:2407`: a `~/…` projectDir is keyed under a phantom project.
- **Non-boolean `multiProfile` silently coerced to false** (PLAUSIBLE) — `plugin-manifest.mjs:171`, even under `--strict`; consistent with the validator's lax booleans.
- **Fail-closed probe now skips write-back for github-source on one transient probe error** — `sources.mjs:211`; deliberate per `55e20c35`, but no test pins it and only a manual "Report result" recovers.
- Sweep lows: `versionOk` cached without a `jtrPath` key (`index.mjs:407`); `wikiToMarkdown` rewrites `h1.`/links inside `{code}` fences and takes `title=…` as a fence language (`index.mjs:232`); the PAT on argv is visible in `ps` (`index.mjs:402`); every profile picker shows `work (work)` when label == id (`source-pane.mjs:230`); no test covers the v14 `source_bindings` step (`test/db.test.mjs:120`).

## Cleanup candidates (not verified; correctness items filled the cap)

- Two hand-rolled validateConfig poll loops (`app.js:3650` and `:5882`) with already-divergent timeout text and error shapes — extract one `pollValidateConfig` + `claimRun`.
- `profileOptions` (`source-pane.mjs:226`) duplicated inside `profileBar` (`plugins-view.mjs:171`); identical CSS rules for `.sp-profile-bar` / `.pl-profile-bar`.
- Profile-id / roster guards written three ways across four routes (`ui/server.mjs:2282/2347/2377/2455/2503`) — one `requireSourceProfile` helper.
- `resolveSourceProfile` returns four shapes; `onPick`/`onChange` duplicate the rebind PUT (`app.js:3548-3621`).
- `applySchemaV14` is the third identical `repairSchemaGaps(db, schemaGaps(db))`; the `sqlite_master` statement is re-prepared per table (`db.mjs:592/665`).
- `writeBucket` re-reads the file `readBucket` just read; `PUT /config` calls `createProfile` even when the id exists (`plugin-config.mjs:78`, `server.mjs:2385`).
- `retryWriteback` builds the results bundle (results.json + `gh pr list` spawn) before the capability probe that, for the now-default opted-out Jira run, discards it (`sources.mjs:262`).
- Stale comments: `reportResult`'s "belt-and-braces" note claims the host defaults to writeBack:true on transport errors (false since `55e20c35`); `runJtr`'s docblock says `jtr init` has no `--json` while `index.mjs` passes it.
- `listBindingsForScope` / `clearBinding` / the `profile:null` PUT branch have no consumer.
- `memState`/`makeCtx` test fakes copied from `test/github-source-connector.test.mjs`; neither gained `ctx.profile`.
