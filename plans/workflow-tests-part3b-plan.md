# Workflow tests, Part 3b: plugins off in Pretend, file-scope checks, the command before and after — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Pretend try runs without the person's own Claude Code plugins, skills, agents and hooks (and without the project's hooks and plugins), still signed in and still under the person's own deny rules and sandbox; an example can check which files a try changed; and "The command passes" also runs once on the start commit, so the result says which tests the change made pass, which still pass, and which it broke, and the check can be met when the change breaks nothing that passed before.

**Architecture:**
- **Plugins off (D70–D72).** Every Claude spawn of a Pretend try gets `--setting-sources project,local` (runOpts, from a new node-context flag `pluginsOff`). Worca's own pieces still arrive by flag (`--settings`, `--plugin-dir`, `--agents`, `--mcp-config`). The person's sign-in and their own guards are the only things read from their user settings: the sign-in's env keys join the spawn env, `apiKeyHelper` / `awsAuthRefresh` / `awsCredentialExport` go into the `--settings` payload, and so do their `permissions.deny` rules (after Worca's) and their `sandbox` (D81); that payload then always travels as a file, never on the command line. In a Pretend project try, the checkout's `.claude/settings.json` and `.claude/settings.local.json` lose `hooks` and `enabledPlugins` after the setup and before the first step; the tracked files Worca changed stay out of the try's commit and diff.
- **File-scope checks (D73).** Three pure kinds in `src/shared/workflow-tests/checks.mjs` (`under`, `unchanged`, `max-files`) read the try's change list (`project.touched`, `project.total`), with a small linear glob matcher.
- **Before and after (D74–D76).** After the free quick check and before any try, each project example's command check runs once on its start commit: in its own short-lived clone of Worca's copy (never a checkout registered in the copy), setup first, under the try's outward guard. The result (exit code, summary, and the test names Worca can read from TAP, node:test's spec reporter, pytest, Jest or Vitest output) is kept for a week per start point, setup and command, and dropped when the copy is made again. Each try's command result then carries a classification: tests the change made pass, tests that passed before and still pass, tests it broke (or, when only failures or only the exit code can be read, what can be said honestly). "Met" stays "the command ends without an error" (D57), unless the check is set to "Met when it breaks nothing that passed before" (D82): then it is judged against the before run, level by level.

**Tech Stack:** Node ESM, `node:sqlite` (no schema change), `node:test` + jsdom, Express (`ui/server.mjs`), vanilla DOM modules (`ui/public/workflows/*.mjs`), Claude Code CLI ≥ 2.1.304 (`--setting-sources`), git ≥ 2.38.

**Spec:**
- `.superpowers/sdd/part3-planning-brief.md`: D46, D47 (the three file-scope kinds), Q7, Q8, Q10, §6 (the plugins-off proofs) and §7 (the security review). The user approved each recommendation.
- 3a's plan (`plans/workflow-tests-part3a-plan.md`), "Later (3b and beyond)" (:6768-6790): the 3b scope, and the before-and-after command run (approved 2026-10-29; SWE-bench FAIL_TO_PASS / PASS_TO_PASS, `plans/workflow-tests-eval-frameworks.md` §7, :290-293).
- The evals canvas boards 33 (`P3AddCheck`), 34 (`P3TestVersion`) and 36 (`P3SideBySide`): the elements marked "Part 3b" are built here. Parts marked "Your criteria" or "A result you liked" are not.
- 3a's decisions D52–D69 and copy gaps P1–P40 still hold unless a decision below replaces one.

**Code base and line numbers.** The open items were decided by the user on 2026-11-02 (D81–D85). Every `file:line` here cites commit **`758e9943b`** (3a's final review, round 8). A `dev` merge is landing on 3a while this plan is written: after it, **3a's schema rung becomes v86**, and line numbers move. Task 0 re-finds each cited place before any task starts. **3b adds no schema rung** (D79). If a task finds it needs one, it is **v87**, and the task stops and tells the controller first.

---

## Corrections to the brief (verified at `758e9943b`)

1. **`buildClaudeArgs` emits `--setting-sources` at `engines/claude.mjs:415-418`** (brief: `:387-389`). An empty or non-string list emits nothing. `runClaude` already forwards `settingSources` (`claude-runner.mjs:164, :277`).
2. **`isSignInEnvKey` is private to `requirements/interview.mjs:49`** (with `SIGN_IN_ENV_KEYS` at `:45-48`). 3b moves both, unchanged, to `src/core/engines/claude-sign-in.mjs`; the interview imports them (Task 1).
3. **The interview is no precedent for "carry only the sign-in".** When the user settings hold a sign-in, it keeps *all* user settings (`interview.mjs:287`: `keepUserSettings ? {} : { settingSources: ['project'] }`). And `userClaudeSignIn` answers `true` for a file it cannot read or parse (`:66-74`). A try cannot carry a sign-in out of a file it cannot read, so 3b reads the file itself (`readUserSignIn`, D71) and carries nothing from an unreadable one.
4. **The prompts promise the person's own skills and agents.** `fanOutDirective` (`phases.mjs:347-366`) names `~/.claude/agents` and `~/.claude/skills`, and `taskHeader`'s skills hint (`phases.mjs:995-1011`) names `~/.claude/skills` too (the brief cites only `:348-364`). With plugins off, those sentences would send the agent after skills that are not loaded. Task 2 gives both a plugins-off wording. The two call sites of `fanOutDirective` are `graph/executor.mjs:577` and `phases.mjs:1126`.
5. **An exclude pathspec that names an ignored path fails `git add`** (the `_excludePathspecs` comment, `run-harness.mjs:7205-7207`). `.claude/settings.local.json` is usually ignored. So only the *tracked* settings files Worca changed are excluded (Task 3), not "that path" unconditionally.
6. **The before run cannot use a checkout of Worca's copy.** The copy reset removes every checkout registration when no try row of the project is running (P40: `copyBusy`, `project-copy.mjs:212-219`, reads only `pipelines` and `wf_test_tries`). A before run has no row, so another test's start could remove its checkout mid-run. It runs in its own `git clone --local` of the copy instead (D75).
7. **The command check keeps only the end of its output** (`shell-step.mjs:9-10`: 40 lines, 8 KB). Reading test names needs every line, so `runShellStep` gains a line tap and the parser reads the output as it streams (Task 9).
8. **node:test prints two summaries.** `commandSummary` (`checks.mjs`, end of file) already reads `ℹ pass` (spec reporter) and `# pass` (TAP). Which one a piped `node --test` uses depends on the Node version, so 3b parses both reporters (Task 7).
9. **The sign-in carry-over can be proved for free.** The `system/init` event carries `apiKeySource`, and a fake Anthropic API sees the `x-api-key` header. The brief listed "sign-in works with the sign-in carried over" as paid; it is in the free proof (Task 4).
10. **The paid "user `PreToolUse` hook does not fire" needs a hook in the user settings the CLI reads.** On this laptop that is the person's real `C:\Users\BRT1BG\.claude\settings.json`. Adding a hook there means editing their own settings; pointing `CLAUDE_CONFIG_DIR` at a sandbox means copying their `.credentials.json`, and a token refresh in the sandbox can rotate the refresh token and sign their real Claude Code out. The real CLI with a fake model already calls a tool (Task 4), and whether a hook loads does not depend on the model. So that claim is proved free; the paid proof covers the real sign-in and a real model (Task 4 Step 6). The user accepted this on 2026-11-02 (D83).
11. **Two cases must carry nothing:** with the credential broker on (`brokerEnabled()`, `broker-client.mjs:19`), the broker token is the spawn's only model credential (`engines/claude.mjs:628-630`); and when a spawn runs as another OS user (`agentIdentityFor`, `agent-pool.mjs:54`), handing it the server user's sign-in would move one user's credentials to another. The brief does not name either.
12. **The "Other engines" note** is `engineNoteLine` at `connectors.mjs:31` (and its browser twin at `test-dialogs.mjs:148`). `connectorNotes` (`connectors.mjs:145`) already lists the non-Claude engines a test's steps run on; 3b adds a sibling line and a `personalOff` flag there.
13. **Board 36's "Failed: `<file>` · "<test name>"" line** was not built in 3a (P6: Worca did not parse test output). With the parser it can be built where names were read (P45).
14. **Board 34's two "Part 3b" lines use a circle with a slash.** `icons.mjs` has no such icon (`none` at `:69` is a dashed square). Task 12 adds `off`.
15. **`CLAUDE_CONFIG_DIR` is not a reserved model-env key** (`model-env.mjs:211-215`), so a model profile can move the folder the CLI reads its user settings from. The carry-over reads the sign-in from the same folder the spawn's CLI will use (D71).
16. **`NODE_EXTRA_CA_CERTS` is a reserved model-env key but a sign-in key** (`interview.mjs:46`). The carried env is its own tier in `composeSpawnEnv` (Task 2), so the reserved-key filter of `cleanRunEnv` never drops it.

## Copy and design gaps (decided here)

| # | Where | What this plan builds |
|---|---|---|
| P41 | Board 33's three new fields refuse a value (not drawn) | The dialog's error line, from `normaliseCheck` through `sentence()`: "Name at least one folder.", "Give folders inside the project, such as src/.", "At most 20 folders.", "Name at least one file or pattern.", "Give files or patterns inside the project, such as test/**.", "At most 20 files or patterns.", "The most files must be a whole number from 0 to 10000." |
| P42 | Board 36's scope rows when not met (not drawn) | "Changes only files under …" and "Leaves these files unchanged" show "Met", or "Changed `<first path>`" plus " and N more" (paths in the change list's order, sorted). "Changes at most N files" shows "No files", "1 file" or "N files", met or not (board 36: "3 files"). |
| P43 | Board 34's Pretend list for steps on another engine (not drawn) | "Steps on Codex still use Codex's own plugins and settings. Pretend switches off only Claude Code's." with the alert icon, after Part 2's connector line for that engine. |
| P44 | Board 34's two "Part 3b" lines | "Your personal Claude Code plugins, skills and hooks are switched off." shows in Pretend when a step runs on Claude Code. "The project's own instructions stay on. Its hooks and plugins are switched off." shows only when a chosen example also has a project. Both with the new `off` icon, after the connectors' lines. |
| P45 | Board 36's "Failed: …" line (3a P6) | Built when the after run named failing tests: up to three, "; " between, then " and N more". A name that starts with a test file shows the file in code, " · ", and the rest in quotes; any other name in quotes. No line when no names were read. |
| P46 | Board 33's "Most files" box | A text box (`inputMode="numeric"`), 100 px wide, as drawn. |
| P47 | Board 36's "Leaves these files unchanged" with several patterns | Each pattern in code, ", " between. The folders check: each folder in code, joined as "A, B and C" (board: "`src/` and `test/`"). |
| P48 | The run warning when a project settings file or `.claude` is a link (not drawn; never shown, the try is hidden) | "The project's .claude/settings.json is a link, so Worca left it out of this try." (the path named as found). |

## Decisions

D41–D69 hold. These continue them. The `(technical)` rows are for the reviewer.

| # | Decision |
|---|---|
| D70 | **Plugins off: where.**<br>• Every Claude spawn of a Pretend try's nodes (no-project and project, Test a version and Try it once now) runs with `--setting-sources project,local`. The quick check is a mock run and spawns nothing. A Real try and every other run are unchanged, byte for byte.<br>• Set in one place: the orchestrator's node context gets `pluginsOff: true` when `_testConnectors() === 'pretend'` (`orchestrator.mjs:1888`), and `runOpts` turns it into `settingSources: ['project', 'local']` and `pluginsOff: true` (beside `strictMcpConfig`, `phases.mjs:854`).<br>• Worca's own pieces still come by flag: its hooks and permissions (`--settings`), its set skills (`--plugin-dir`), the investigator (`--agents`), its MCP config. The project's skills mount stays in the project source.<br>• The prompts drop "your personal (`~/.claude`) skills and agents" on these spawns (correction 4).<br>• What else the person's user settings held does not apply in Pretend: their permission rules, their non-sign-in `env` (for example `BASH_DEFAULT_TIMEOUT_MS`), their output style and model choice. Managed (policy) settings still apply. Whether `~/.claude/CLAUDE.md` still loads is recorded by the free proof; board 34's line does not promise it. |
| D70a | **Plugins off follows the run's sources (2026-11-04, after dev #943).**<br>• dev's #943 made normal runs spawn with `--setting-sources project` unless the run loads every source (Settings opt-in, or a sign-in kept in the user settings).<br>• A Pretend try now loads the run's own sources without the user's: `project` for a project-only run, `project,local` for a run that loads every source. Before, it always added `local`, so a try saw `.claude/settings.local.json` when a normal run did not.<br>• The person's and the project's sandbox still reach the try through the carry (D81a), which can only restrict. |
| D71 | **Only the sign-in is carried over.**<br>• Read per spawn, by `runClaudeProcess`, from the user `settings.json` the spawn's CLI would read: `CLAUDE_CONFIG_DIR` (the model profile's value first, then the server's), else `<home>/.claude`.<br>• Carried: the `env` entries `isSignInEnvKey` accepts (Anthropic, Vertex, Bedrock, Foundry, AWS, proxies, CA certs, OAuth token, client certs; text, numbers and yes/no as text), and the strings `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`. Nothing else of the sign-in kind; the person's own guards come along by D81. Never their hooks, plugins, allow or ask rules, or other env.<br>• The env keys join the spawn env as their own tier: over the ambient and run env, and over a model profile's env too, where a normal run puts the user settings' env (D71b, which replaces the first wording "under Worca's model env"). The helpers go into the `--settings` payload, which then always travels as a file in the private staging folder, never inline (`buildClaudeArgs` refuses it inline).<br>• Carried values whose key names a token, key, secret, password or credential are added to the spawn's redactor.<br>• Nothing is carried with the broker on, or when the spawn runs as another OS user (correction 11). Then the spawn is not signed in through user settings, as with any `--setting-sources` without `user`.<br>• A missing or blank file carries nothing. A file Worca cannot read or parse carries nothing either: the CLI cannot use it. If the free proof shows the CLI reads a `settings.json` with comments, Task 4 Step 4 makes `readUserSignIn` read them too.<br>• Never stored: not in run state, the DB, run.json, logs or the UI. |
| D71b | **Where the carried sign-in sits (decided 2026-11-04, Task 5 review finding I3).** The carried env goes OVER a model profile's env, as a normal every-source run lets the user settings' env win (Task 4's proof: `settingsEnvWins: true`). So the person's own gateway credentials (`ANTHROPIC_CUSTOM_HEADERS`, an API key, a helper's key) never go to a model profile's endpoint, which the first order allowed. Worca's in-process bridge is the one exception: a bridged spawn (a loopback `…/m/<id>` base URL) keeps the bridge's env on top, since the bridge forwards no credential upstream (`carryOverModelEnv`, `composeSpawnEnv` `signInOverModel`). |
| D72 | **The project's own Claude Code settings in a Pretend project try.**<br>• After "Before each try, run" (which may write them) and before the first step, `.claude/settings.json` and `.claude/settings.local.json` in the try's checkout lose `hooks` and `enabledPlugins`. Everything else in them stays, and so do the project's CLAUDE.md, agents, skills and commands (Q7 a).<br>• A file that is not JSON, or has neither key, is left as it is (the CLI ignores a file it cannot parse).<br>• A settings file or a `.claude` folder that is a link is removed (the link only) and never followed; a run warning says so (P48).<br>• The tracked files among those Worca changed or removed are kept out of the try's commit, `results.json` and `diff-patch.patch`. Untracked ones are not named in a pathspec (correction 5); git does not list them anyway.<br>• A failure to write ends the try as an error before any step ("Worca could not switch off the project's Claude Code hooks and plugins for this try: …"). If Worca cannot write the checkout, the workflow could not either.<br>• Stated limits: an agent's own edit of a settings file Worca changed is not shown in the try's changes; hooks an agent writes into the project's settings during the try load in its later steps (the outward guard's env still holds for them). |
| D72a | **Hooks in the project's skills, agents and commands (decided 2026-11-04, Task 5 review finding I2).** Claude Code runs hooks declared in the YAML frontmatter of a project skill (probe P3, again on 2.1.318), so D72's strip also takes the frontmatter's top-level `hooks:` key and its indented block out of `.claude/skills/**/SKILL.md`, `.claude/agents/**/*.md` and `.claude/commands/**/*.md`, at the same point and with the same link rule (a link in those folders is removed, never followed). The body and every other key stay byte for byte. A frontmatter Worca cannot change safely (no closing line, two `hooks` keys, a tab in the block, a flow or quoted value over several lines, an anchor used elsewhere, text that is not UTF-8) is left as it is, and the try gets one run warning naming it. Task 5 fix review (2026-11-05): the check fails closed (m4): after the line strip a YAML parser (merge keys on) reads the frontmatter, and a top-level `hooks` key still there (an indented root mapping, a `? hooks` key, a `<<:` merge, a flow-style `{…}` frontmatter, an escaped key) or YAML that does not parse and mentions `hooks` counts as unsafe; a folder too deep to walk (over 32 levels) is named the same way (m13). Nested `.claude` folders (I-2): probe `nested-read-318` showed Claude Code 2.1.318 loads a nested `packages/web/.claude/skills` skill once the agent reads a file in `packages/web/` and fires its frontmatter hook (nested agents and commands were not listed); so the skills, agents and commands of every `.claude` folder below the checkout root (never inside `node_modules` or `.git`, never through a link) are stripped the same way, a nested `.claude` that is a link is removed, and the changed tracked files are kept out of the try like the root's (`nested-after-318`: the skill still loads, its hook no longer fires). The tracked files changed stay out of the try's commit, results and patch, as D72's. With it the strip also drops `extraKnownMarketplaces` and, from the settings' `env`, the keys that would undo the try guard (`PATH`, `GIT_SSH_COMMAND`, `GIT_CONFIG_*`, `GH_CONFIG_DIR`, `GLAB_CONFIG_DIR`, `AZURE_CONFIG_DIR`, `GIT_TERMINAL_PROMPT`, `GCM_INTERACTIVE`, `WSLENV`, `WORCA_*` and the tokens the guard strips): the free probe showed the CLI applies settings env to its Bash tool (M10). Also `NODE_OPTIONS` and `NODE_PATH` (Task 5 fix review concern 3, 2026-11-05): probe `nodeopts-318` showed the CLI hands a project's settings env to Worca's own `node` hooks too, and a project `NODE_OPTIONS=--require …` ran its code inside the hook. Files are replaced through a temp file and a rename (M6). |
| D73 | **The file-scope checks** (Q10; kinds `under`, `unchanged`, `max-files`; only on an example with a project).<br>• They read the try's change list: every path git lists between the start commit and the try's end, minus what 3a keeps out (setup output, Worca's injected paths) and what D72 keeps out.<br>• **"Changes only files under"**: folders, comma-separated, at most 20; each cleaned to `dir/` (backslashes become `/`, `./` and repeated `/` dropped). No wildcard, nothing outside the project. Met when every path starts with one of them.<br>• **"Leaves these files unchanged"**: names or patterns, at most 20. `**` = any folders, `*` / `?` inside one name, a trailing `/` = everything under that folder, `dir/**` = everything inside `dir` (not a file named `dir`), a pattern with no `/` = that name at any depth (as the file check, D59, and `.gitignore`). Case-sensitive, as git is. Met when no path matches.<br>• **"Changes at most N files"**: 0 to 10000. Counts the change list's rows: an added, changed or removed file counts once (board 33's hint), a renamed file counts once.<br>• **Renames:** for the first two kinds, a rename counts both its old and its new path (a file moved out of `lib/` changed `lib/`). A copy counts only its new path (its source is unchanged).<br>• They run with the other pure checks, whatever the try's end. |
| D74 | **What Worca reads from a command's output** (best effort, line by line, ANSI colours removed).<br>• **Every test by name:** TAP (node:test when piped on older Node, tape, mocha `-R tap`; nested `# Subtest:` names joined with " > "); node:test's spec reporter (its "failing tests" repeat at the end is skipped); pytest with `-rA` or `-v`; Jest in verbose mode (one test file, or `--verbose`); Vitest's verbose reporter.<br>• **Only the failing tests by name** (and the counts): pytest's default short summary, Jest's default (`●` headers), Vitest's default (` FAIL ` lines).<br>• **Anything else:** no format; the command is compared by its exit code only, and the result says so (D76).<br>• At most 20000 tests and 300 characters a name are kept; a cut is marked `truncated`. |
| D75 | **The run on the start point.**<br>• **When:** in each test, after the free quick check and before any try, one at a time, for every command check of every project example that still has tries to make. "Finish the rest" goes through it again (kept results make that instant).<br>• **Where:** a `git clone --local --no-checkout --no-tags` of Worca's copy at `<worcaHome>/workflow-tests/before/run-<random>`, origin removed, `core.longpaths` on, gc off, detached at the start commit. Worca's own git there runs with the try's safe git args and `tryGitEnv`, and `GIT_CEILING_DIRECTORIES` at that folder. The person's repository is not touched; the copy is only read (the clone takes the copy's key lock for its own few seconds).<br>• **What:** "Before each try, run" first (the setup's env: `tryShellEnv({ keepRegistryAuth: true })`, 30 minutes), then the command with the try's full guard env (`tryShellEnv()`) and the check's own time limit. The guard writes what it stops to the scratch log (`unbound-calls.ndjson`): a before run is not the workflow's, so it is not in "Would have sent".<br>• **Kept:** for 7 days, per project, start commit, setup command, command and time limit, at `<worcaHome>/workflow-tests/before/cache/<projectKey>/<hash>.json`, with the copy's stamp. A copy made again (a new `.git/worca-copy-made` stamp) or an older result means a fresh run. Not kept: a run its time limit stopped, a setup that failed, a stop, an error.<br>• **Cost and time:** no model money. Time = setup + command per run not yet kept; Test a version shows it (U2). Disk: one more checkout, before any try starts, so the test's peak (D60) does not grow.<br>• **Stop and restart:** a stop aborts the run and removes its clone. Each clone has an owner file (`run-<random>.owner.json`: pid and a heartbeat every 30 s); the boot sweep removes a clone whose owner process is gone or whose heartbeat is older than 30 minutes (never a blind removal: a second UI may share the Worca home), and kept results older than 7 days.<br>• **A before run that fails** (setup, git, an error) is recorded as not run with its reason; the tries go on (their own setup decides whether the test stops, D55). |
| D76 | **What the result shows.** "Met" is unchanged by default: the command ends without an error within its time limit (D57); D82 adds the other choice. Beside it, per version, `before`:<br>• **Tests by name on both sides (same format):** tests the change made pass (failed before, pass now); tests that passed before and still pass (a count); tests it broke (passed before, fail now); and, when not zero, tests that failed before and still fail, new tests (and how many of them fail), tests that no longer run. At most 20 names per group are kept; counts are exact.<br>• **Only failures by name:** tests failing now that did not fail before; tests that failed before and no longer fail; still failing; "Passed: X before, Y now" when both counts were read; and a note that passing tests are counted, not named.<br>• **Exit code only** (no format, different formats, or a time-out on either side): one sentence: it passed before too / it failed before and passes now / it passed before, so the change broke it / it failed before too / before the change it ran longer than its time limit; and a note that Worca could not read test names.<br>• **Not run:** why (setup, stopped, an error line).<br>• A try reused from before 3b, or judged when no before run happened, has no `before`: nothing is shown. |
| D77 | *(technical)* **Reuse.** No fingerprint changes. A Pretend try made before 3b (with the person's plugins on) can still be reused: accepted, the feature is behind a Labs flag and 3a is not released. The before run is not part of a try, so it does not change reuse. |
| D78 | **Other engines.** Steps on Codex, Gemini CLI, Copilot, Cursor or OpenCode get no `--setting-sources`; Test a version says so per engine (P43), beside Part 2's connector note. |
| D79 | *(technical)* **No schema rung.** The new data lives in the try's `verdict` JSON (the command result's `ms`, `failed`, `failedCount`, `before`; the scope checks' kind and parameters) and in files (`before/cache`). `store.lastCommandMs` reads it back from `verdict`. |
| D80 | *(technical)* **Failed names** (P45): the command result keeps the first three failing names (`failed`) and their count (`failedCount`) when the after run's output named them. |
| D81 | **The person's own guards ride along in Pretend** (decided 2026-11-02, was Open item O1).<br>• With plugins off, the person's user-level `permissions.deny` rules and `sandbox` settings would no longer apply. Both only ever block; neither loads code or sends anything. So they are carried, read from the same file as the sign-in (`readUserSafety`): `permissions.deny` (non-empty strings, deduplicated, at most 500) and `sandbox` (a plain object). Never `permissions.allow` or `permissions.ask`.<br>• They go into the `--settings` payload: the deny rules after Worca's own and the try guard's (deduplicated), the `sandbox` object as it is. Such a payload always travels as a file (as D71's helpers).<br>• ~~Unlike the sign-in, they are carried in every case: also with the broker on and into an agent user's spawn (they can only block).~~ Changed by Task 5 (M12, 2026-11-04): with the broker on or into an agent user's spawn nothing is carried, the guards included, so the operator's own rules and paths are not shown to agents; an agent user that cannot be looked up counts as one (M3). Task 5 also anchors a personal `/path` rule at the person's config folder (I1), checks the sandbox against the CLI's schema (C1), and limits the project's layers (D81b).<br>• Nothing from a file Worca cannot read or parse (Task 4 Step 4's comment rule applies here too). |
| D81a | **The carried sandbox keeps Claude Code's order** (decided 2026-11-03, a Task 2 review finding). Carried in `--settings`, the person's `sandbox` would outrank the project's and local's (a user `enabled: false` would turn off a sandbox the project turns on). So `readUserSafety` builds it as the person's sandbox with the try checkout's (the spawn's working directory) `.claude/settings.json` and then `.claude/settings.local.json` sandbox laid on top: scalar keys local > project > user; lists joined, deduplicated, the person's entries first; plain objects merged by the same rules. A project or local file that cannot be read or parsed (or is over 1 MiB) adds nothing. No sandbox of the person's: none is carried (the project's and local's load by themselves). Deny rules are unchanged (they merge across scopes and only add blocks). |
| D81b | **What the project's sandbox layers may carry (decided 2026-11-05).** Worca's `--settings` file is a flag-tier source the CLI trusts fully, so the project and local layers laid into it (D81a) leave out what Claude Code takes only from the user, managed or `--settings` tiers. Source: the sandbox schema of Claude Code 2.1.318 ("Only honored from user, managed/policy, or CLI (--settings) settings — project settings … are ignored", "Only honored from admin-controlled managed settings", "set in managed settings"): `network.strictAllowlist`, `network.tlsTerminate`, `network.allowManagedDomainsOnly`, `filesystem.disabled`, `filesystem.allowManagedReadPathsOnly`, `credentials.allowPlaintextInject`, `credentials.awsPairs`, `credentials.sigv4`, `allowAppleEvents`, `ripgrep`, `bwrapPath`, `socatPath`. Also a project's `true` for `allowUnsandboxedCommands` and `allowNestedUserNamespaces` ("a false in managed, --settings or user settings holds whatever project settings say"; "true from project settings is ignored (false there still applies)"; a project `false` is carried: Task 5 fix review m3), and while the person's `network.strictAllowlist` is on, the project's `network.allowedDomains`, `httpProxyPort` and `socksProxyPort`. Not `excludedCommands` (fix review m1, corrected 2026-11-05): its rule (`Nt`) names only a managed or `--settings` `allowUnsandboxedCommands: false` and managed `allowManagedDomainsOnly`, never strictAllowlist; laid in, the project's excluded commands keep working as in a normal run even when the person's carried `allowUnsandboxedCommands: false` would make the CLI drop the project-tier copy. Relative sandbox paths (`filesystem.*`, `credentials.files[].path`) resolve against their settings file's root (the schema: "~/.claude for user settings, project root for project settings"), so they are written out against the person's config folder or the checkout; relative `ignoreViolations` and `network.allowUnixSockets` entries, whose resolution is not documented, are left out. One run-log line per layer names what was left out. Conditional hardening (Task 5 fix review concern 1, 2026-11-05): the CLI ignores some project values when managed settings or a `--settings` file hold a trigger (`allowUnsandboxedCommands: false`, a `Read(…)` deny, `filesystem.denyRead`, `credentials.files`, `network.deniedDomains`, a `WebFetch(domain:…)` deny). The person's carried values become such triggers only because they move into Worca's file, which is why the project's layers are laid in at all (a normal run, where they are user-tier, does not filter). Worca's OWN rules in that file are triggers in a normal run too (the guardrail presets' `Read(…)` denies are in every normal run's `--settings`), so Worca models them: with a `Read(…)` deny of its own, the project's `filesystem.allowRead` and `allowWrite` are left out of the lay-in; with a `WebFetch(domain:…)` deny of its own, its `httpProxyPort` and `socksProxyPort`. The CLI still reads them from the project file under its own filter, as in a normal run, so nothing is lost and no note is given (`readUserSafety` `ownDeny`, passed from the spawn's permission rules). Stated limit: managed settings, which Worca does not read; a trigger there filters the project-tier copy in both kinds of run but not the copy Worca lays into its file. |
| D82 | **"Met when it breaks nothing that passed before"** (decided 2026-11-02, was Open item O2).<br>• A per-check choice on "The command passes": `metWhen: 'passes' \| 'breaks-nothing'`, default `'passes'`. Stored only when `'breaks-nothing'`, so every existing check and example fingerprint stays byte for byte; switching it changes the example's fingerprint (checks are part of it, D26), so tries judged under the other rule are not reused.<br>• Judged by `commandMet` (Task 8), from the after run and the classified before run:<br>&nbsp;&nbsp;– the command ends without an error within its time limit: met (it passes, so it broke nothing it checks), whatever the before run says;<br>&nbsp;&nbsp;– its time limit stopped it: not met (`timed-out`);<br>&nbsp;&nbsp;– no before run, or it did not run (setup failed, stopped, an error): not met (`no-before`): without the before run nothing can be compared;<br>&nbsp;&nbsp;– **tests by name** (and nothing cut at 20000): met iff no test that passed before fails now (`broke` = 0) **and** none that passed before is missing now (`lostPass` = 0). The second rule is beyond "broke = 0": a test that passed and no longer runs (deleted, skipped, or the run crashed before it) would otherwise hide a breakage. New tests that fail do not count against it: they did not pass before;<br>&nbsp;&nbsp;– **only failures by name**: met iff no test fails now that did not fail before (`failingNow` = 0) **and** both runs' pass counts were read **and** no fewer tests pass now. A newly failing name might be a new test rather than a broken one; it counts against the change, because at this level Worca cannot tell the two apart. The pass counts stand in for `lostPass`; without them Worca cannot tell (`cannot-tell`);<br>&nbsp;&nbsp;– **exit code only** (also when a parse was cut, or the formats differ, or the before run timed out): an exit code says nothing about which tests fail, so "it failed before too" is no evidence that the same tests fail. Not met: `broke-exit` when it passed before, else `cannot-tell`. At this level the choice gives the same answer as `'passes'`, with an honest reason.<br>• The value stays the command's summary line ("212 passed, 1 failed"); the label reads "The command `npm test` breaks nothing that passed before"; a met row whose command ended with an error says so, and each not-met reason has its sentence (U4).<br>• The editor's choice and every wording are undrawn: Task 14 builds them after U4's mock is approved. |
| D83 | **No paid proof of the user hook** (decided 2026-11-02, was Open item O3). The free real-CLI proof shows it (correction 10); nobody edits the person's own `~/.claude/settings.json` or copies their sign-in. |
| D84 | **A separate local clone per try is decided after 3b** (decided 2026-11-02, was Open item O4), with the real clone times and disk figures 3b's before runs record (Task 9 writes `ms` per run; Task 15's final verification notes them). The trade-off, kept for that decision: each try's git would be its own (no shared copy settings, much of P39/P40's reset machinery gone, removal is one folder) against a clone per try (seconds with hardlinks; on another disk or without hardlinks, every object copied, three at a time), a second D52 path rule, and changes to `_setupRunRoot`, D43 and D61. See "Later". |
| D85 | **The project's own command-running keys stay** (decided 2026-11-02, was Open item O5): `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper` in the project's settings are the project's own sign-in and telemetry, and a normal run uses them too. Corrected by Task 5's review (L3): a carried personal sign-in (D71) outranks them only when something is carried; a person signed in by `.credentials.json` (OAuth) has nothing carried, and a project `apiKeyHelper` then outranks it, as in a normal run. A project `otelHeadersHelper` with an `env` that turns on telemetry sends data from the CLI itself, outside the try guard (which covers tools and PATH only), as a normal run does. Both are stated limits. |

## Global Constraints

- **Worktree and branch:** a new worktree `C:\Users\BRT1BG\worca-cc\worca-cc-tests3b`, branch `feat/workflow-tests-part3b`, made from `feat/workflow-tests-part3` **after** the `dev` merge on 3a is committed (Task 0). Its PR targets `dev` after 3a merges; until then, merge `feat/workflow-tests-part3` in when it moves.
- **Commits:** one per task (Task 4 and Task 5 may have none). The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Author email is `tomica.brkovic@yahoo.com` (checked in Task 0).
- **Upstream:**
  - Target `dev`.
  - Merge commits only. Merge `dev` in, never rebase or force-push.
  - State `npm test` and a smoke run in the PR.
  - Name the UI level and update `docs/ui-levels.md`.
- **Never push or open a PR without the user's explicit go.**
- **Run one test file at a time:** `node tools/test.mjs test/<file>.test.mjs` (hermetic home + no-real-claude guard). When you run a test file directly (with `node --test`, not through `tools/test.mjs`), set `WORCA_GIT=1` first (PowerShell: `$env:WORCA_GIT = '1'`). About 170 failures already exist on clean `dev` on this laptop, so compare against the Task 0 baseline before blaming the branch.
- **Test facts from 3a** (the plan's test code follows them; correct a slip in your task, never product code for it):
  - `worcaHome()` is `<WORCA_HOME>/.worca-cc`, not `WORCA_HOME` itself.
  - `invokeStartRun` and `POST /api/run` answer only `{ runId }`; the pipeline id comes from the run entry once it settles.
  - A mock run parks at its clarify gate; a test that waits for a run to settle answers its questions (`runSettled` with `_testing.answerRun`, as `test/api-workflow-test-project-try.test.mjs` does).
- **TDD:** each task writes its failing test first, runs it to see it fail, then writes the code.
- **The person's project is never touched.** Everything runs in Worca's copy or a clone of it. The 3a rule stands: the only git commands on a registered project's folder are `clone` and `fetch` (as the source), the read-only list in 3a's Global Constraints, and `uncommittedPatch(…, { scratchObjects: true })`. `test/helpers/repo-snapshot.mjs` is the test for it.
- **The person's own Claude Code files are only read:** their user `settings.json` (for the sign-in, D71). No task, test or proof writes to `C:\Users\BRT1BG\.claude`, and nothing copies its `.credentials.json`.
- **UI copy is plain words** (the evals copy standard): example, try, version, passed / met / not met, start point; no hashes or internal ids in the UI, except the boards' 7-character start commit (`abc1234`) and the person's own test names and file paths, which are their words.
- **Flag and level:** everything is behind `workflowTests` (routes behind `requireFlag('workflowTests')`, UI behind `data-flag="workflowTests"`), UI level **Simple**.
- **style.css:**
  - Tokens only, never a hex colour.
  - Status colours: green = done, red = failed (a broken test), blue = information, amber only "needs you", grey `--seq` = some passed.
  - New CSS goes in the workflows section, right after 3a's last `.wft-*` rule, before `.wfv-bar .btn`, never after a `/* ── marketplace … ── */` marker.
  - Every CSS block is closed (the brace-balance test).
- **UI follows `docs/design-system.md`** (`test/ui-design-language.test.mjs`, `test/ui-shared-controls.test.mjs`):
  - Type steps only (`var(--fs-caption)` 11, `--fs-meta` 12, `--fs-body` 13, `--fs-section` 15, `--fs-subpage` 18, `--fs-stat` 22).
  - Radius tokens only (`--r-xs`, `--r-sm`, `--r-card`); `50%` only on a selector whose name says it is round.
  - Icons from `icons.mjs` inside a button with an `aria-label`; no glyph strings.
  - On/off is a switch; a checkbox only picks or opts in, with its `JS_CHECKBOX_OK` row.
- **UI tasks start only on approved screens.** Tasks 11 and 12 build boards 33, 34 and 36 ("Part 3b" elements). Tasks 13 and 14 build undrawn UI and start only after the user approved the mocks of U1–U3 (Task 13) and U4 (Task 14) (see "Undrawn UI"). Before a UI task, the controller re-reads its boards (`Artifact` read of `project/P3AddCheck.dc.html`, `P3TestVersion.dc.html`, `P3SideBySide.dc.html` on https://claude.ai/artifact/7kDSH4sKKDz3gV4DnnTABJ) and applies any copy change to the task first. The strings quoted in Tasks 11–14 are the boards' text on 2026-11-02 and this plan's proposals for U1–U4.
- **Every UI task runs the design guards** after its own tests: `node tools/test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`, then the style.css slicing tests (3a's list: `Select-String -Path test\*.test.mjs -SimpleMatch "indexOf('/*" -List | ForEach-Object { $_.Path }`). Compare `ui-design-language` with the Task 0 baseline; any new failure is the task's.
- **Route errors:** `{ error }` with 400 / 404 / 409 / 422 / 500. 3b adds no route.
- **Hidden tries (D21, D22) hold.** No memory, frames, notifier, run tags; never in Runs, History or Statistics; their cost counts in the spending limit.
- **No new identifier may be called `version`** (D7).
- **UI text:** `textContent` only. Dialogs through `testDialog`.
- **Test files must not read `plans/`.** Pin copy literals in the tests.
- **Paid model calls: none in tests** (mock engine; `WORCA_MOCK=1` for API tests). The one paid proof (Task 4 Step 6) is run by the controller only, on Haiku through the user's own Claude sign-in (empty Worca home, `ANTHROPIC_*`, `CLAUDE_*`, `VERTEX_*`, `CLOUD_ML_*` stripped, then `CLAUDE_CONFIG_DIR` set to the real config folder; never the `~/.worca-cc` Vertex routing), capped at **$3**, after the user's explicit OK.
- **Windows:**
  - Hook commands in proofs use forward slashes (`host-guard.mjs:38-47`).
  - Removals use `rm(…, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })` (`removeTree`) and never follow a junction.
  - A test that needs a POSIX shell, or a file symlink (EPERM on this laptop), skips on win32 with a named reason. A directory junction works without admin rights, so junction tests run.
- **Schema:** none. `SCHEMA_VERSION` stays 3a's (v86 after the merge; v87 since the 2026-11-05 dev merge, when dev took 84). No task edits `src/core/db.mjs`.

## Review Focus

1. **Only the sign-in and the person's guards leave their settings** (Tasks 1, 2, 5). Expect `readUserSignIn` to return only allowlisted env keys and the three helpers; a helper never in argv; carried secrets redacted; nothing carried with the broker on or for an agent user.
2. **Everything else is byte-identical** (Tasks 2, 3). Expect `buildClaudeArgs`, `buildSettingsPayload`, `planClaudeInvocation`, `composeSpawnEnv`, `runOpts`, `taskHeader` and `fanOutDirective` without the new inputs to equal today's output; a Real try's spawns have no `settingSources`; a Real project try's `.claude/settings.json` is untouched.
3. **Plugins off on the real CLI** (Task 4). Expect, in the Pretend variant: no marker file from a user hook (SessionStart, UserPromptSubmit, PreToolUse), a plugin hook or a project hook; `system/init` without the user's skill, agent and plugin, with the project's skill and Worca's `--plugin-dir` skill; the carried key at the fake API.
4. **The project settings strip** (Task 3). Expect links removed and never followed; only tracked changed files excluded; the try's commit leaves the file as the start commit had it.
5. **File-scope checks** (Task 6). Expect exact values with renames on both paths, a copy on its new path, and the count once per row.
6. **The parser** (Task 7). Expect each fixture's names and counts; Task 7 Step 5's real outputs recorded and matched.
7. **The before run** (Task 9). Expect no registration in `git -C <copy> worktree list`, the clone removed after every end, kept results reused, and a fresh run after a new stamp, a new setup command or a week.
8. **Stop and restart during the before phase** (Task 10). Expect a stop to abort it with no kept result and no clone left; the boot sweep to remove a dead owner's clone and keep a live one.
9. **Design guards** (Tasks 11–14): no new `ui-design-language` failure.
10. **The person's guards** (Task 2 Step 9): expect their `permissions.deny` after Worca's and the try guard's, their `sandbox` kept, never their allow or ask rules, carried also with the broker on.
11. **"Breaks nothing that passed before"** (Tasks 8, 9, 14): expect met only on the evidence D82 names at each level, never on an exit code alone, and an unchanged fingerprint for every check left on "It passes".

## Undrawn UI (mock before the UI tasks)

No board draws these. Each is mocked on the evals canvas (Worca design system), approved by the user, and only then built (Task 13 for U1–U3, Task 14 for U4). The words below are this plan's proposals; the approved mock wins.

- **U1. One example side by side (board 36): the command before and after.**
  - Where: under the "The command `npm test` passes" row of "What was checked", one block per version column that has a `before` (both columns share the before run but differ after it), after board 36's red "Not met for …" box when there is one. Also one fact in "For developers": "Before the change: `npm test` · it failed · 28 Oct", plus " · kept from an earlier test" when it was.
  - Heading "Before the change". Then one of:
    - **Tests by name:** three lines in this order, each with its count, and up to 5 names for the first and third (then "and N more"): "Tests the change made pass: 1 · "rounds three lines of 0.125 to 0.38"", "Tests that passed before and still pass: 212", "Tests it broke: 0". Below, only when not zero: "Tests that failed before and still fail: 2", "New tests: 3, 1 failing", "Tests that no longer run: 1 · "…"". "Tests it broke" above zero is red (a failure), the block otherwise neutral.
    - **Only failures by name:** "Tests failing now that did not fail before: 1 · "…"", "Tests that failed before and no longer fail: 0", "Passed: 212 before, 212 now", and the hint "This test tool names only the tests that fail, so the tests that pass are counted, not named."
    - **Exit code only:** one sentence ("It passed before the change too." / "It failed before the change, and passes now." / "It passed before the change: the change broke it." / "It failed before the change too." / "Before the change, it ran longer than its time limit."), and the hint "Worca could not read test names in this command's output, so it compares only whether the command passed."
    - **Not run:** "Worca could not run it before the change: the setup step failed." / "Worca did not run it before the change: the test was stopped." / "Worca could not run it before the change: <first line>."
  - Optional, for the mock to decide: a "See the output before the change" button beside "See the command output".
  - States to draw: tests by name with a broken test (red), tests by name all fine, failures only, exit only "failed before too", not run; light, dark and 390 px.
- **U2. Test a version (board 34): the before runs in the Time row.**
  - After board 34's "about 1 hour 10 minutes · setup `npm ci` takes about 2 minutes a try": " · first, `npm test` runs once on 2 start points: about 4 minutes". With several commands: " · first, the command checks run once on 2 start points: about 4 minutes". When the time is not known yet (never measured): the same without ": about …". The total ("about 1 hour 10 minutes") includes the before runs' time when known. Nothing is shown when every before run is kept.
- **U3. While the test runs (board 35): the before phase.**
  - While it runs (before any try), a card above board 35's phase card: title "Before the tries", the line "Running `npm test` on the start point of Ticket 482 · 1 of 2", and its sub-line "Preparing a copy of the project" / "Running setup" / "Running the command". The rows' Now column reads "Waiting" meanwhile. The card goes when the tries start.

- **U4. "Met when it breaks nothing that passed before" (board 33's check dialog, board 36's rows; D82).**
  - **Board 33, Add an automatic check, "The command passes":** below "Stop the command after", a radio group with the legend "Met when" and two options, as 3a's "Read from" radios are drawn (title, then a grey sub-line):
    - "It passes" · "the command ends without an error" (picked by default);
    - "It breaks nothing that passed before" · "Worca runs it once on the start point first and compares".
    - Under the group, the hint "Use this when some tests already fail on the start point."
    - The preview line and the example's card line: "The command `npm test` passes" or "The command `npm test` breaks nothing that passed before" (the command in code).
    - States to draw: the default, the second option picked (preview changed), editing a saved check that uses it.
  - **Board 36, What was checked:** the row's label is the check's line above. The cells keep the command's summary ("212 passed, 1 failed") with a green dot when met, even though tests fail. Under the row, per version, as 3a's red "Not met for …" box (or a neutral box when met):
    - met while the command ended with an error: "**Met for v3 draft:** the command ended with an error, but no test that passed before fails now." (neutral, not red);
    - not met, by reason (red, then 3b's "Failed: …" line and "See the command output" as today):
      - `broke`: "**Not met for v3 draft:** it broke 1 test that passed before." / "… it broke 3 tests that passed before.";
      - `lost`: "**Not met for v3 draft:** 1 test that passed before no longer runs." / "… 2 tests that passed before no longer run.";
      - `failing-now`: "**Not met for v3 draft:** 1 test fails now that did not fail before." / "… 2 tests fail now that did not fail before.";
      - `fewer-pass`: "**Not met for v3 draft:** fewer tests pass now: 212 before, 209 now.";
      - `broke-exit`: "**Not met for v3 draft:** it passed before the change and fails now.";
      - `cannot-tell`: "**Not met for v3 draft:** the command ended with an error, and Worca could not read which tests failed, so it cannot tell whether the change broke something.";
      - `no-before`: "**Not met for v3 draft:** Worca could not run it before the change, so it cannot tell what broke.";
      - `timed-out`: 3a's "**Not met for v3 draft:** the command ran longer than its time limit and was stopped."
    - U1's "Before the change" block follows, as for any command check.
    - States to draw: met with a failing test (two columns: v2 met cleanly, v3 draft met with an error), `broke`, `failing-now`, `cannot-tell`; light, dark and 390 px.

## Open items (decided 2026-11-02)

The user decided every open item on 2026-11-02; each is now a decision: O1 → D81 (carry the person's deny rules and sandbox), O2 → D82 ("Met when it breaks nothing that passed before", in 3b), O3 → D83 (no paid user-hook proof), O4 → D84 (a clone per try is decided after 3b), O5 → D85 (the project's command-running keys stay). Nothing is left open.

---

## File structure

**New files**

| File | Responsibility |
|---|---|
| `src/core/engines/claude-sign-in.mjs` | The sign-in key rule (moved from the interview), `readUserSignIn` (the sign-in in the person's user settings) and `readUserSafety` (their deny rules and sandbox, D81). |
| `src/core/workflow-tests/project-claude-settings.mjs` | D72: the project's `hooks` and `enabledPlugins` out of a checkout's Claude Code settings; links never followed. |
| `src/core/workflow-tests/test-output.mjs` | D74: test names and counts from a command's output, line by line. |
| `src/shared/workflow-tests/before-after.mjs` | D76, D82: before and after, classified, and `commandMet` (pure, browser-safe). |
| `src/core/workflow-tests/before-run.mjs` | D75: the command on the start commit: its clone, setup, command, the kept results, the boot sweep. |
| `.superpowers/sdd/proofs/plugins-off-real-cli.mjs` | Task 4's free proof (a script, not a test: it starts the real CLI). |
| `test/claude-sign-in.test.mjs` | Task 1. |
| `test/workflow-test-plugins-off.test.mjs` | Task 2. |
| `test/workflow-test-project-claude-settings.test.mjs`, `test/api-workflow-test-plugins-off.test.mjs` | Task 3. |
| `test/workflow-test-scope-checks.test.mjs` | Task 6. |
| `test/workflow-test-test-output.test.mjs` | Task 7. |
| `test/workflow-test-before-after.test.mjs` | Task 8. |
| `test/workflow-test-before-run.test.mjs` | Task 9. |
| `test/workflow-test-before-runner.test.mjs` | Task 10. |
| `test/ui-workflow-test-scope-checks.test.mjs` | Task 11. |
| `test/ui-workflow-test-plugins-off-dialog.test.mjs` | Task 12. |
| `test/ui-workflow-test-before-after.test.mjs` | Task 13. |
| `test/ui-workflow-test-met-when.test.mjs` | Task 14. |

**Modified files**

| File | Change |
|---|---|
| `src/core/requirements/interview.mjs` | Imports the moved key rule. |
| `src/core/engines/claude.mjs` | `signInSettings` in the payload (file only), `signInCarry`, `secretValuesOf`, `pluginsOff` in `runClaudeProcess`. |
| `src/core/engines/spawn.mjs` | `composeSpawnEnv({ signInEnv })`. |
| `src/core/claude-runner.mjs` | Forwards `pluginsOff`. |
| `src/core/phases.mjs` | `PLUGINS_OFF_SOURCES`, `runOpts`, `taskHeader` and `fanOutDirective` wording. |
| `src/core/graph/executor.mjs` | `fanOutDirective(…, { personalOff })` at `:577`. |
| `src/core/orchestrator.mjs` | `pluginsOff` in the node context (`:1888`). |
| `src/core/run-harness.mjs` | `_pluginsOffInCheckout`, `_tryPluginPaths` in `_excludePathspecs`. |
| `src/shared/workflow-tests/checks.mjs` | The three scope kinds, `pathMatches`, labels, `runCheck({ changes })`; the command check's `metWhen` (D82). |
| `src/shared/workflow-tests/project-text.mjs` | 3b's sentences (board 33 fields, board 34 lines, Failed line, before and after). |
| `src/core/workflow-tests/{result,shell-step,project-copy,store,runner,service,routes,connectors}.mjs` | `touched`; the line tap; the copy stamp and the before clone; `lastCommandMs`; the before phase; the plan's `before`; `personalOff`. |
| `ui/server.mjs` | The boot sweep of before runs. |
| `ui/public/icons.mjs` | `off`. |
| `ui/public/workflows/{example-editor,test-ui,test-compare,test-dialogs,test-progress}.mjs`, `ui/public/style.css` | Boards 33, 34, 36; U1–U4. |
| `test/workflow-test-project-checks.test.mjs`, `test/ui-workflow-example-editor.test.mjs`, `test/ui-shared-controls.test.mjs` | Only where a pinned list or shape grows. |
| `docs/storage.md`, `docs/ui-levels.md`, `docs/feature-flags.md`, `docs/changelog/unreleased.md`, `plans/workflow-tests-plan.md` | Task 15. |

---

## Task 0: Baseline (no commit)

- [ ] **Step 1: Wait for 3a's dev merge, then make the worktree**

The controller confirms the `dev` merge on `feat/workflow-tests-part3` is committed and its agent is done. Then run (PowerShell):
```powershell
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 status --short --branch
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 log -1 --format=%H feat/workflow-tests-part3
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 show feat/workflow-tests-part3:src/core/db.mjs | Select-String "export const SCHEMA_VERSION"
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3 worktree add C:\Users\BRT1BG\worca-cc\worca-cc-tests3b -b feat/workflow-tests-part3b feat/workflow-tests-part3
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3b config user.email tomica.brkovic@yahoo.com
cmd /c mklink /J C:\Users\BRT1BG\worca-cc\worca-cc-tests3b\node_modules C:\Users\BRT1BG\worca-cc\worca-cc-dev\node_modules
git --version; node --version; claude --version
```
Expected:
- the 3a worktree clean on `## feat/workflow-tests-part3`;
- `SCHEMA_VERSION = 86` (if it is another number, note it: 3b changes no schema, so it only matters for Task 15's docs);
- the new worktree on `feat/workflow-tests-part3b`;
- git ≥ 2.38, Node ≥ 22.13, Claude Code ≥ 2.1.304.

Record the base commit: `git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests3b log -1 --format=%H` → write it to `C:\Users\BRT1BG\worca-cc\worca-cc-tests3b\.superpowers\sdd\base-3b.txt`. Every later "since the base" uses it.

- [ ] **Step 2: Re-find every cited place**

This plan cites `758e9943b`. Run, from the new worktree:
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests3b
git diff --stat 758e9943b HEAD -- src/core/engines src/core/phases.mjs src/core/orchestrator.mjs src/core/run-harness.mjs src/core/claude-runner.mjs src/core/requirements/interview.mjs src/core/workflow-tests src/shared/workflow-tests ui/public/workflows ui/public/icons.mjs src/core/graph/executor.mjs
Select-String -Path src\core\engines\claude.mjs -Pattern "export function buildSettingsPayload|export function buildSettingsArgs|export function buildClaudeArgs|export function planClaudeInvocation|export function stageClaudeInvocation|export function runClaudeProcess|const redactor = "
Select-String -Path src\core\phases.mjs -Pattern "mcpStrict === true \? \{ strictMcpConfig|const skillsHint|export function fanOutDirective|fanOutDirective\(ctxFanOut"
Select-String -Path src\core\run-harness.mjs -Pattern "_runTrySetup\(\);|_excludePathspecs\(projectKey\) \{"
Select-String -Path src\core\orchestrator.mjs -Pattern "mcpStrict: this._testConnectors"
```
Expected: each pattern found once (the `fanOutDirective(ctxFanOut` pattern also in `src/core/graph/executor.mjs`). Write the new line numbers into `.superpowers\sdd\base-3b.txt`. If a cited function changed shape (not only moved), tell the controller before Task 1.

- [ ] **Step 3: Record the full-suite baseline** (about 45–60 minutes; run it in the background)

Run:
```powershell
node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs C:\Users\BRT1BG\worca-cc\worca-cc-tests3b C:\Users\BRT1BG\worca-cc\worca-cc-tests3b\.superpowers\sdd\baseline-3b 4 300
```
Expected: about 170–190 failing tests in a few dozen files (the known Windows failures). Write the failing file names, one per line, to `C:\Users\BRT1BG\worca-cc\worca-cc-tests3b\.superpowers\sdd\baseline-3b-failing.txt`. A file that fails later and is not on it is checked with `node tools/test.mjs <file>` on the base and on the branch, back to back, under the same load.

- [ ] **Step 4: Record a quick baseline of the files this part touches**

Run:
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests3b; node tools/test.mjs test/requirements-interview.test.mjs test/spawn-args.test.mjs test/agent-user.test.mjs test/claude-mcpjson-guard.test.mjs test/directions-prompt.test.mjs test/workflow-test-checks.test.mjs test/workflow-test-project-checks.test.mjs test/workflow-test-shell-step.test.mjs test/workflow-test-project-copy.test.mjs test/workflow-test-project-runner.test.mjs test/workflow-test-connectors.test.mjs test/api-workflow-test-project-try.test.mjs test/api-workflow-test-try.test.mjs test/workflow-test-isolation.test.mjs test/ui-workflow-example-editor.test.mjs test/ui-workflow-example-project.test.mjs test/workflow-test-result.test.mjs test/workflow-test-runner.test.mjs test/ui-workflow-test-compare.test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-project-compare.test.mjs test/ui-workflow-test-project-run.test.mjs test/ui-workflow-test-progress.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs
```
Expected: all pass, except the known `ui-design-language` failures and the `spawn-args` tests that skip on Windows ("fake claude shim is a POSIX shell script"). Note any other failure in `baseline-3b-failing.txt` with "(focused)".

---
## Task 1: The sign-in in the person's own Claude Code settings (D71)

**Files:**
- Create: `src/core/engines/claude-sign-in.mjs`
- Modify: `src/core/requirements/interview.mjs:44-50` (the key rule moves out; nothing else changes)
- Test: `test/claude-sign-in.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `SIGN_IN_ENV_KEYS: Set<string>`, `isSignInEnvKey(key: string): boolean` (moved unchanged);
  - `SIGN_IN_SETTINGS_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']`;
  - `userSettingsFile({ env?, home? }): string`;
  - `readUserSignIn({ env?, home?, read? }): { state: 'none'|'found'|'unreadable', env: Record<string,string>, settings: Record<string,string> }`. Never throws.

- [ ] **Step 1: Write the failing test.** Create `test/claude-sign-in.test.mjs`:

```js
// test/claude-sign-in.test.mjs — workflow tests 3b, Task 1 (D71): the sign-in kept in the person's own Claude Code settings,
// and nothing else from them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUserSignIn, isSignInEnvKey, SIGN_IN_SETTINGS_KEYS, userSettingsFile } from '../src/core/engines/claude-sign-in.mjs';
import { userClaudeSignIn } from '../src/core/requirements/interview.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
/** A home folder with `.claude/settings.json` holding `body` (an object as JSON, a string as it is; undefined: no file). */
function home(body) {
  const h = mkdtempSync(join(tmpdir(), 'worca-cc-signin-'));
  dirs.push(h);
  mkdirSync(join(h, '.claude'), { recursive: true });
  if (body !== undefined) writeFileSync(join(h, '.claude', 'settings.json'), typeof body === 'string' ? body : JSON.stringify(body));
  return h;
}
const NONE = { state: 'none', env: {}, settings: {} };

test('only the sign-in comes out: the env keys that sign in or route traffic, and the three helpers', () => {
  const h = home({
    env: { ANTHROPIC_API_KEY: 'sk-ant-1', CLAUDE_CODE_USE_VERTEX: '1', CLOUD_ML_REGION: 'europe-west4', AWS_PROFILE: 'p', HTTPS_PROXY: 'http://proxy:8080',
      NODE_EXTRA_CA_CERTS: '/ca.pem', BASH_DEFAULT_TIMEOUT_MS: '9000', MY_TOKEN: 'x' },
    apiKeyHelper: 'node key.js', awsAuthRefresh: 'aws sso login', awsCredentialExport: 'aws configure export-credentials',
    hooks: { PreToolUse: [] }, enabledPlugins: { 'p@m': true }, permissions: { allow: ['Bash(npm test:*)'] }, model: 'opus',
  });
  const s = readUserSignIn({ env: {}, home: h });
  assert.equal(s.state, 'found');
  assert.deepEqual(s.env, { ANTHROPIC_API_KEY: 'sk-ant-1', CLAUDE_CODE_USE_VERTEX: '1', CLOUD_ML_REGION: 'europe-west4', AWS_PROFILE: 'p',
    HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/ca.pem' });
  assert.deepEqual(s.settings, { apiKeyHelper: 'node key.js', awsAuthRefresh: 'aws sso login', awsCredentialExport: 'aws configure export-credentials' });
  assert.deepEqual(SIGN_IN_SETTINGS_KEYS, ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']);
});

test('numbers and yes/no in env become text; empty helpers, objects, arrays and null are left out', () => {
  const s = readUserSignIn({ env: {}, home: home({ env: { CLAUDE_CODE_USE_BEDROCK: 1, ANTHROPIC_X: true, ANTHROPIC_Y: { a: 1 }, ANTHROPIC_Z: null, ANTHROPIC_W: [1] },
    apiKeyHelper: '', awsAuthRefresh: 3 }) });
  assert.deepEqual(s, { state: 'found', env: { CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_X: 'true' }, settings: {} });
});

test('nothing to carry: no file, a blank one, no sign-in in it, or not an object', () => {
  for (const [body, why] of [[undefined, 'no file'], ['', 'blank'], ['  \n', 'spaces'], [{ hooks: {} }, 'no sign-in'], ['[1]', 'an array'], ['"x"', 'a string']]) {
    assert.deepEqual(readUserSignIn({ env: {}, home: home(body) }), NONE, why);
  }
  assert.deepEqual(readUserSignIn({ env: {}, home: home({ env: { BASH_DEFAULT_TIMEOUT_MS: '1' } }) }), NONE, 'env without a sign-in key');
});

test('a file Worca cannot read or parse carries nothing (the CLI cannot use it either), and says so', () => {
  assert.deepEqual(readUserSignIn({ env: {}, home: home('{ not json') }), { state: 'unreadable', env: {}, settings: {} });
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('EACCES') }).state, 'unreadable');
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('EISDIR') }).state, 'unreadable');
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('ENOENT') }).state, 'none');
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('ENOTDIR') }).state, 'none');
});

test('a leading BOM is read; CLAUDE_CONFIG_DIR (trimmed) moves the file', () => {
  assert.equal(readUserSignIn({ env: {}, home: home(`﻿${JSON.stringify({ apiKeyHelper: 'x' })}`) }).state, 'found');
  const other = home({ env: { ANTHROPIC_BASE_URL: 'http://gw' } });
  const h = home({});
  assert.equal(userSettingsFile({ env: { CLAUDE_CONFIG_DIR: ` ${join(other, '.claude')} ` }, home: h }), join(other, '.claude', 'settings.json'));
  assert.equal(userSettingsFile({ env: { CLAUDE_CONFIG_DIR: '  ' }, home: h }), join(h, '.claude', 'settings.json'));
  assert.deepEqual(readUserSignIn({ env: { CLAUDE_CONFIG_DIR: join(other, '.claude') }, home: h }).env, { ANTHROPIC_BASE_URL: 'http://gw' });
});

test('the key rule moved here unchanged; the interview still uses it', () => {
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_REGION', 'http_proxy', 'HTTPS_PROXY',
    'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY']) assert.ok(isSignInEnvKey(k), k);
  for (const k of ['GH_TOKEN', 'PATH', 'HOME', 'BASH_DEFAULT_TIMEOUT_MS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'WORCA_HOME']) assert.equal(isSignInEnvKey(k), false, k);
  assert.equal(userClaudeSignIn({ env: {}, home: home({ env: { AWS_PROFILE: 'p' } }) }), true);
  assert.equal(userClaudeSignIn({ env: {}, home: home({ env: { MY_KEY: 'p' } }) }), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/claude-sign-in.test.mjs`
Expected: FAIL, "Cannot find module '…/src/core/engines/claude-sign-in.mjs'".

- [ ] **Step 3: Write the module.** Create `src/core/engines/claude-sign-in.mjs`:

```js
// src/core/engines/claude-sign-in.mjs
// The Claude Code sign-in kept in the person's own user settings (workflow tests 3b, D71). A Pretend try spawns with
// `--setting-sources project,local`, which drops that file; readUserSignIn reads only the sign-in out of it, so the try is
// still signed in and nothing else of the person's setup (hooks, plugins, permissions, other env) comes along. The key rule
// is the requirements interview's (A1.1 D6), moved here unchanged.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Keys of the user settings' `env` block that sign Claude Code in or route its traffic (A1.1 D6). */
export const SIGN_IN_ENV_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
]);
export const isSignInEnvKey = (k) => SIGN_IN_ENV_KEYS.has(k) || /^https?_proxy$/i.test(k) || k.startsWith('ANTHROPIC_')
  || k.startsWith('CLAUDE_CODE_USE_') || k.startsWith('AWS_');
/** The settings keys that sign in by running a command. */
export const SIGN_IN_SETTINGS_KEYS = Object.freeze(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']);

/** The user settings file the CLI reads: `settings.json` in CLAUDE_CONFIG_DIR (trimmed), else in `<home>/.claude`. */
export function userSettingsFile({ env = process.env, home } = {}) {
  const dir = typeof env?.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim()
    ? env.CLAUDE_CONFIG_DIR.trim() : join(home ?? homedir(), '.claude');
  return join(dir, 'settings.json');
}

const none = (state) => ({ state, env: {}, settings: {} });

/**
 * The sign-in in the person's user settings, and nothing else. 'none': no file (ENOENT / ENOTDIR), a blank one, not an
 * object, or no sign-in in it. 'unreadable': a file that exists but cannot be read or parsed; nothing is carried from it
 * (the CLI cannot use it either). Env values that are text, numbers or yes/no are kept as text. Never throws.
 * @returns {{state: 'none'|'found'|'unreadable', env: Record<string,string>, settings: Record<string,string>}}
 */
export function readUserSignIn({ env = process.env, home, read = (p) => readFileSync(p, 'utf8') } = {}) {
  try {
    let raw;
    try { raw = String(read(userSettingsFile({ env, home }))); } catch (err) {
      return none(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 'none' : 'unreadable');
    }
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    if (!text.trim()) return none('none');
    let s;
    try { s = JSON.parse(text); } catch { return none('unreadable'); }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return none('none');
    const settings = {};
    for (const k of SIGN_IN_SETTINGS_KEYS) if (typeof s[k] === 'string' && s[k] !== '') settings[k] = s[k];
    const out = {};
    const e = s.env;
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      for (const [k, v] of Object.entries(e)) {
        if (!isSignInEnvKey(k)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
      }
    }
    return Object.keys(out).length || Object.keys(settings).length ? { state: 'found', env: out, settings } : none('none');
  } catch { return none('none'); }   // homedir() can throw: inside the try
}
```

- [ ] **Step 4: Move the key rule out of the interview.** In `src/core/requirements/interview.mjs`, delete `:44-50` (the comment "Keys of the user settings' `env` block…", `SIGN_IN_ENV_KEYS` and `isSignInEnvKey`) and add to the imports at the top:

```js
import { isSignInEnvKey } from '../engines/claude-sign-in.mjs';
```
`userClaudeSignIn` and everything else stay as they are.

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/claude-sign-in.test.mjs test/requirements-interview.test.mjs`
Expected: PASS (the interview's own sign-in tests, `test/requirements-interview.test.mjs:1072-1117`, pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/core/engines/claude-sign-in.mjs src/core/requirements/interview.mjs test/claude-sign-in.test.mjs
git commit -m "Workflow tests 3b: read only the sign-in from the person's Claude Code user settings (D71)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Plugins off in a Pretend try's spawns, the sign-in and the person's guards carried (D70, D71, D81)

**Files:**
- Modify: `src/core/engines/claude.mjs` (`buildSettingsPayload` :65-108, `buildSettingsArgs` :306-313, `buildClaudeArgs` :343-436, `planClaudeInvocation` :459-484, `runClaudeProcess` :504 with its `redactor` at :507 and its `stageClaudeInvocation` and `composeSpawnEnv` calls); new `signInCarry`, `secretValuesOf`.
- Modify: `src/core/engines/spawn.mjs:101-115` (`composeSpawnEnv`).
- Modify: `src/core/claude-runner.mjs:163` and `:276` (forward `pluginsOff`).
- Modify: `src/core/phases.mjs` (`fanOutDirective` :320-366, `runOpts` :856, `taskHeader` :994-1011, the call at :1126).
- Modify: `src/core/graph/executor.mjs:577`.
- Modify: `src/core/orchestrator.mjs:1888`.
- Modify: `src/core/engines/claude-sign-in.mjs` (Step 9: `readUserSafety`).
- Test: `test/workflow-test-plugins-off.test.mjs`, `test/claude-sign-in.test.mjs` (Step 9)

**Interfaces:**
- Consumes: `readUserSignIn`, `SIGN_IN_SETTINGS_KEYS` (Task 1).
- Produces:
  - node context `pluginsOff: true` (orchestrator) → `runOpts(...)` adds `settingSources: ['project', 'local']` and `pluginsOff: true`;
  - `PLUGINS_OFF_SOURCES` (phases.mjs);
  - `runClaude({ …, pluginsOff })` → `runClaudeProcess({ …, pluginsOff })`;
  - `buildSettingsPayload(rules, { …, signInSettings })` (adds `signIn: true` when it carries one), `buildClaudeArgs({ …, signInSettings })` (throws inline), `planClaudeInvocation` writes a carried helper to `<dir>/settings.json`;
  - `composeSpawnEnv({ …, signInEnv })`;
  - `signInCarry({ modelEnv?, asAgent?, read?, readSafety?, agentUser? }): { env, settings, safety? } | null` (after Step 9, `safety` = `{ deny, sandbox }` when the person has any), `secretValuesOf(env): string[]`;
  - Step 9 (D81): `readUserSafety({ env?, home?, read? }): { deny: string[], sandbox: object|null }`, `SAFETY_DENY_MAX = 500` (claude-sign-in.mjs); `buildSettingsPayload(rules, { …, safetySettings })`, `buildClaudeArgs({ …, safetySettings })`, `planClaudeInvocation` (file only, as the helpers);
  - `fanOutDirective(fanOut, { …, personalOff })`; `taskHeader` reads `ctx.pluginsOff`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-plugins-off.test.mjs`:

```js
// test/workflow-test-plugins-off.test.mjs — workflow tests 3b, Task 2 (D70, D71): a Pretend try's spawns load no user settings,
// carry only the sign-in kept there, and every other spawn stays byte-identical.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettingsPayload, buildClaudeArgs, planClaudeInvocation, signInCarry, secretValuesOf } from '../src/core/engines/claude.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { runOpts, taskHeader, fanOutDirective, PLUGINS_OFF_SOURCES } from '../src/core/phases.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

process.env.WORCA_HOST_GUARD = '0';   // as spawn-args.test.mjs: this file's feature only
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-poff-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const BASE = { prompt: 'p', permissionMode: 'acceptEdits', allowedTools: ['Read'] };
const HELPERS = { apiKeyHelper: 'node key.js', awsAuthRefresh: 'aws sso login', awsCredentialExport: 'aws x' };
const OPTS = { role: 'implementer', prompt: 'x', systemPrompt: 's', allowedTools: [] };

test('the --settings payload: the three sign-in helpers only, and unchanged without them', () => {
  assert.equal(buildSettingsPayload(null, {}), null, 'nothing to carry: no flag');
  const p = buildSettingsPayload(null, { signInSettings: { ...HELPERS, hooks: { x: 1 }, env: { A: 'b' }, apiKeyHelperX: 'y' } });
  assert.deepEqual(p.settings, HELPERS);
  assert.equal(p.signIn, true);
  const rules = { deny: ['Read(.env*)'] };
  assert.deepEqual(buildSettingsPayload(rules, { signInSettings: null }), buildSettingsPayload(rules, {}));
  assert.deepEqual(buildSettingsPayload(rules, { signInSettings: { apiKeyHelper: '' } }), buildSettingsPayload(rules, {}), 'an empty helper is nothing');
  assert.equal(buildSettingsPayload(null, { signInSettings: { apiKeyHelper: '' } }), null);
});

test('a carried helper never rides the command line: buildClaudeArgs refuses it inline, the plan writes it to a file', () => {
  assert.throws(() => buildClaudeArgs({ ...BASE, signInSettings: HELPERS }), /settings file/);
  const dir = tmp();
  const plan = planClaudeInvocation({ ...BASE, signInSettings: HELPERS }, { bin: 'claude', dir });
  const i = plan.args.indexOf('--settings');
  assert.equal(plan.args[i + 1], join(dir, 'settings.json'));
  assert.deepEqual(JSON.parse(plan.files.find((f) => f.path === join(dir, 'settings.json')).content), HELPERS);
  assert.deepEqual(plan.args.slice(0, 2), ['-p', 'p'], 'the prompt stays inline');
  assert.equal(plan.staged, false, 'not the GH #380 staging (no "argv would be N chars" line)');
  assert.equal(plan.stdin, null);
  assert.ok(!plan.args.some((a) => a.includes('node key.js')));
  const without = planClaudeInvocation(BASE, { bin: 'claude', dir: null });
  assert.deepEqual(without.args, buildClaudeArgs(BASE), 'no carry: byte-identical, and no folder is needed');
  assert.deepEqual(without.files, []);
  const long = planClaudeInvocation({ ...BASE, prompt: 'x'.repeat(30000), signInSettings: HELPERS }, { bin: 'claude', dir: tmp() });
  assert.equal(long.staged, true, 'over the limit: the GH #380 staging, with the helper in its settings file');
  assert.deepEqual(JSON.parse(long.files.find((f) => f.path.endsWith('settings.json')).content), HELPERS);
});

test('the carried env sits over the ambient and run env, under the model env; without it the env is unchanged', () => {
  const { env } = composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run', C: 'run' }, signInEnv: { A: 'sign', B: 'sign' }, overlay: { B: 'model' } });
  assert.deepEqual([env.A, env.B, env.C], ['sign', 'model', 'run']);
  const plain = composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run' }, overlay: { B: 'model' } }).env;
  assert.deepEqual(composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run' }, overlay: { B: 'model' }, signInEnv: null }).env, plain);
  assert.equal(composeSpawnEnv({ envScrub: true, envAllowlist: [], signInEnv: { NODE_EXTRA_CA_CERTS: '/ca.pem' } }).env.NODE_EXTRA_CA_CERTS, '/ca.pem',
    'a sign-in key the model env may not set still reaches the spawn');
});

test('what is carried: the person\'s sign-in; nothing with the broker on or into another OS user\'s spawn', () => {
  const found = () => ({ state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'h' } });
  assert.deepEqual(signInCarry({ read: found }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'h' } });
  assert.equal(signInCarry({ read: () => ({ state: 'none', env: {}, settings: {} }) }), null);
  assert.equal(signInCarry({ read: () => ({ state: 'unreadable', env: {}, settings: {} }) }), null);
  assert.equal(signInCarry({ read: () => { throw new Error('x'); } }), null, 'never throws');
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';
  try { assert.equal(signInCarry({ read: found }), null, 'the broker\'s token is the only model credential'); }
  finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
  assert.equal(signInCarry({ read: found, asAgent: true, agentUser: () => ({ user: 'agent1' }) }), null, 'another OS user');
  assert.deepEqual(signInCarry({ read: found, asAgent: true, agentUser: () => null }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'h' } },
    'no agent user set up: the person\'s own spawn');
  let seen = null;
  signInCarry({ read: (o) => { seen = o.env.CLAUDE_CONFIG_DIR; return found(); }, modelEnv: { CLAUDE_CONFIG_DIR: '/cfg/other' } });
  assert.equal(seen, '/cfg/other', 'a model profile that moves the config folder moves where the sign-in is read');
  assert.deepEqual(secretValuesOf({ ANTHROPIC_API_KEY: 'sk-ant-12345678', CLAUDE_CODE_USE_VERTEX: '1', AWS_SECRET_ACCESS_KEY: 'abcdefgh1234',
    ANTHROPIC_AUTH_TOKEN: 'short', AWS_SESSION_TOKEN: 'zzzzzzzzzz' }), ['sk-ant-12345678', 'abcdefgh1234', 'zzzzzzzzzz']);
});

test('runOpts: a Pretend try\'s node gets the sources and pluginsOff; any other node neither', () => {
  const o = runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true }, OPTS);
  assert.deepEqual([o.settingSources, o.pluginsOff], [['project', 'local'], true]);
  assert.deepEqual(PLUGINS_OFF_SOURCES, ['project', 'local']);
  const n = runOpts({ projectDir: '/p', claudeOpts: {} }, OPTS);
  assert.equal('settingSources' in n, false);
  assert.equal('pluginsOff' in n, false);
  assert.equal('settingSources' in runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: 'yes' }, OPTS), false, 'only true');
});

test('the prompts promise no personal skills or agents when they are off; every other prompt is unchanged', () => {
  const on = fanOutDirective(true, {});
  const off = fanOutDirective(true, { personalOff: true });
  assert.match(on, /~\/\.claude\/agents/);
  assert.match(on, /~\/\.claude\/skills/);
  assert.doesNotMatch(off, /~\/\.claude|your personal/);
  assert.match(off, /this project's own agents \(`\.claude\/agents`\) are available by name/);
  assert.match(off, /Skills are available too: this project's skills \(`\.claude\/skills`\) can be invoked via the Skill tool/);
  assert.equal(fanOutDirective(true, { personalOff: false }), on);
  assert.doesNotMatch(fanOutDirective(true, { personalOff: true, omitProjectAgents: true }), /~\/\.claude|your personal/);
  const ctx = { projectDir: '/p', pipelineDir: '/pl', taskPrompt: 'Fix it.', isEntry: true, node: { engine: 'claude' } };
  for (const c of [ctx, { ...ctx, runRoot: '/runs/r1' }]) {
    assert.match(taskHeader(c, 'T'), /~\/\.claude\/skills/, 'today\'s hint');
    const h = taskHeader({ ...c, pluginsOff: true }, 'T');
    assert.doesNotMatch(h, /~\/\.claude|personal/);
    assert.match(h, /skills .*available via the Skill tool/);
  }
});

test('runClaude forwards pluginsOff: --setting-sources project,local, the helper in a settings file, the sign-in in the env', POSIX_SHIM, async () => {
  const dir = tmp();
  const cfg = join(dir, 'cfg');
  mkdirSync(cfg);
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-carried-1' }, apiKeyHelper: 'node key.js', hooks: { PreToolUse: [] } }));
  const argvOut = join(dir, 'argv.txt');
  const envOut = join(dir, 'env.txt');
  const settingsOut = join(dir, 'settings-seen.json');
  const bin = join(dir, 'fake-claude.sh');
  writeFileSync(bin, '#!/bin/sh\n'
    + `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(argvOut)}; case "$a" in */settings.json) cp "$a" ${JSON.stringify(settingsOut)};; esac; done\n`
    + `env > ${JSON.stringify(envOut)}\nexit 0\n`);
  chmodSync(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, cfg: process.env.CLAUDE_CONFIG_DIR };
  delete process.env.WORCA_MOCK;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', allowedTools: ['Bash'], settingSources: [...PLUGINS_OFF_SOURCES], pluginsOff: true });
  } finally {
    if (prev.mock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev.mock;
    if (prev.cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev.cfg;
  }
  const argv = readFileSync(argvOut, 'utf8').split('\0').filter(Boolean);
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'project,local');
  assert.ok(existsSync(settingsOut), 'a --settings file reached the CLI');
  assert.deepEqual(JSON.parse(readFileSync(settingsOut, 'utf8')), { apiKeyHelper: 'node key.js' });
  assert.ok(!argv.some((a) => a.includes('node key.js')), 'never on the command line');
  assert.match(readFileSync(envOut, 'utf8'), /^ANTHROPIC_API_KEY=sk-ant-carried-1$/m);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-plugins-off.test.mjs`
Expected: FAIL: `signInCarry` and `PLUGINS_OFF_SOURCES` are not exported.

- [ ] **Step 3: The settings payload and the argv (engines/claude.mjs)**

Add to the imports:
```js
import { readUserSignIn, SIGN_IN_SETTINGS_KEYS } from './claude-sign-in.mjs';
```

Above `buildSettingsPayload` (:65), add:
```js
/** Workflow tests 3b (D71): the sign-in helpers a Pretend try carries over from the person's user settings (non-empty strings
 *  of SIGN_IN_SETTINGS_KEYS only); null when there are none. */
function signInSettingsOf(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};
  for (const k of SIGN_IN_SETTINGS_KEYS) if (typeof s[k] === 'string' && s[k] !== '') out[k] = s[k];
  return Object.keys(out).length ? out : null;
}
```

In `buildSettingsPayload`, add `signInSettings = null` to the options and change three places (everything else stays):
```js
export function buildSettingsPayload(permissionRules, { hostGuard = false, extraSettings = null, memoryLoadLog = null, readGuard = null, readGuardLog = null, tryGuard = null, signInSettings = null } = {}) {
  // … unchanged down to the `const read = …` line …
  // Workflow tests 3b (D71): a Pretend try's carried sign-in helpers. Absent ⇒ nothing changes.
  const signIn = signInSettingsOf(signInSettings);
  if (!hook && !hasRules && !guard && !extra && !usage && !read && !tg && !signIn) return null;
  const settings = { ...(extra ?? {}), ...(signIn ?? {}) };
  // … unchanged down to `if (hasRules) settings.permissions = rules;` …
  return signIn ? { hook: !!hook, settings, signIn: true } : { hook: !!hook, settings };
}
```
Append to its doc comment: "`signInSettings` (workflow tests 3b D71): a Pretend try's carried `apiKeyHelper` / `awsAuthRefresh` / `awsCredentialExport`; the payload then says `signIn: true`, and it only ever travels as a file (buildSettingsArgs)."

Replace `buildSettingsArgs` (:306-313):
```js
export function buildSettingsArgs(permissionRules, settingsFile = null, { hostGuard = false, extraSettings = null, memoryLoadLog = null, readGuard = null, readGuardLog = null, tryGuard = null, signInSettings = null } = {}) {
  const payload = buildSettingsPayload(permissionRules, { hostGuard, extraSettings, memoryLoadLog, readGuard, readGuardLog, tryGuard, signInSettings });
  if (!payload) return [];
  // Workflow tests 3b (D71): a carried sign-in helper is a command (and maybe a secret): never on the command line.
  if (payload.signIn && !settingsFile) throw new Error('a carried Claude Code sign-in travels in a settings file, never on the command line');
  const args = [];
  if (payload.hook) args.push('--include-hook-events');
  args.push('--settings', settingsFile || JSON.stringify(payload.settings));
  return args;
}
```

In `buildClaudeArgs`, add `signInSettings,` to the destructured options right after `tryGuard,` (:351), and pass it on (:378):
```js
  for (const a of buildSettingsArgs(permissionRules, settingsFile, { hostGuard, extraSettings, memoryLoadLog, readGuard, readGuardLog, tryGuard, signInSettings })) args.push(a);
```

Replace `planClaudeInvocation` (:459-484):
```js
export function planClaudeInvocation(opts, { bin = DEFAULT_BIN, dir = null, limit = ARGV_INLINE_LIMIT } = {}) {
  // Workflow tests 3b (D71): a carried sign-in helper always goes in the settings file, also when the argv fits.
  const fileSettings = !!signInSettingsOf(opts.signInSettings);
  const inline = buildClaudeArgs(fileSettings ? { ...opts, signInSettings: null } : opts);
  const inlineLength = argvLength(bin, inline);
  if (inlineLength <= limit && !fileSettings) return { args: inline, stdin: null, files: [], staged: false, inlineLength };
  if (!dir) throw new Error('planClaudeInvocation: a staging dir is required when the argv is over the limit or carries a sign-in');
  if (typeof dir === 'function') dir = dir();
  const payload = buildSettingsPayload(opts.permissionRules, { hostGuard: opts.hostGuard, extraSettings: opts.extraSettings, memoryLoadLog: opts.memoryLoadLog,
    readGuard: opts.readGuard, readGuardLog: opts.readGuardLog, tryGuard: opts.tryGuard, signInSettings: opts.signInSettings });
  if (inlineLength <= limit) {
    // Only the settings move to a file; the prompt and the system prompt stay inline (not the GH #380 staging).
    const settingsFile = join(dir, 'settings.json');
    return { args: buildClaudeArgs(opts, { settingsFile }), stdin: null, files: [{ path: settingsFile, content: JSON.stringify(payload.settings) }],
      staged: false, inlineLength };
  }
  const files = [];
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';
  const promptViaStdin = prompt.length > 0;             // an empty prompt stays `-p ''` — nothing to pipe
  let systemPromptFile = null;
  if (opts.systemPrompt) {
    systemPromptFile = join(dir, 'system-prompt.md');
    files.push({ path: systemPromptFile, content: opts.systemPrompt });
  }
  let settingsFile = null;
  if (payload) {
    settingsFile = join(dir, 'settings.json');
    files.push({ path: settingsFile, content: JSON.stringify(payload.settings) });
  }
  const args = buildClaudeArgs(opts, { promptViaStdin, systemPromptFile, settingsFile });
  return { args, stdin: promptViaStdin ? prompt : null, files, staged: true, inlineLength };
}
```
(`stageClaudeInvocation` needs no change: it writes every planned file and hands the folder back for cleanup.)

- [ ] **Step 4: What is carried (engines/claude.mjs).** Add, above `runClaudeProcess`:

```js
/**
 * Workflow tests 3b (D71): the sign-in a Pretend try carries over from the person's user settings, or null. Read per spawn
 * from the folder the spawn's CLI will read (a model profile may move CLAUDE_CONFIG_DIR). Nothing with the credential broker
 * on (its token is the spawn's only model credential), and nothing into a spawn that runs as another OS user (agent
 * isolation: one user's sign-in never moves to another). Never throws.
 * @returns {{env: Record<string,string>, settings: Record<string,string>} | null}
 */
export function signInCarry({ modelEnv = null, asAgent = false, read = readUserSignIn, agentUser = () => agentIdentityFor(currentOwner()) } = {}) {
  try {
    if (brokerEnabled()) return null;
    if (asAgent) {
      let id = null;
      try { id = agentUser(); } catch { id = null; }
      if (id) return null;
    }
    const extra = modelEnv && typeof modelEnv === 'object' && Object.keys(modelEnv).length ? prepareModelEnv(modelEnv).env : {};
    const s = read({ env: { ...process.env, ...extra } });
    if (!s || s.state !== 'found') return null;
    return { env: { ...(s.env || {}) }, settings: { ...(s.settings || {}) } };
  } catch { return null; }
}

const SECRET_KEY_RE = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i;
/** The carried values a run must never show (D71): those whose key names a token, key, secret, password or credential. */
export function secretValuesOf(env) {
  return Object.entries(env || {}).filter(([k, v]) => SECRET_KEY_RE.test(k) && typeof v === 'string' && v.length >= 8).map(([, v]) => v);
}
```
(`agentIdentityFor`, `currentOwner`, `brokerEnabled` and `prepareModelEnv` are already imported in this file.)

In `runClaudeProcess` (:504), add `pluginsOff` to the destructured options right after `tryGuard`, and replace the `redactor` line (:507) with:
```js
  // Workflow tests 3b (D71): a Pretend try loads no user settings (runOpts sets --setting-sources project,local); only the
  // sign-in kept there is carried over, and its secret values are redacted like the registry's. Absent on every other spawn:
  // nothing is read and the redactor is as before.
  const carry = pluginsOff === true ? signInCarry({ modelEnv, asAgent }) : null;
  const redactList = [...(Array.isArray(redactValues) ? redactValues : []), ...(carry ? secretValuesOf(carry.env) : [])];
  const redactor = redactList.length ? createRedactor(redactList) : null;
```
In its `stageClaudeInvocation({ … })` call, add after `tryGuard,`:
```js
        signInSettings: carry && Object.keys(carry.settings).length ? carry.settings : null,
```
In its `composeSpawnEnv({ … })` call, add after `tryGuard: tryGuard || null,`:
```js
      signInEnv: carry && Object.keys(carry.env).length ? carry.env : null,
```

- [ ] **Step 5: The env tier (engines/spawn.mjs).** Replace `composeSpawnEnv` (:101-115); add to its doc comment "…the person's carried sign-in (workflow tests 3b, D71) over the run env and under the overlay…":

```js
export function composeSpawnEnv({ envScrub, envAllowlist, prefixes, runEnv, overlay, hostPid, tryGuard = null, signInEnv = null } = {}) {
  const scrubbedEnv = buildSpawnEnv(envScrub, envAllowlist, prefixes);
  let env = scrubbedEnv;
  if (runEnv) env = { ...(env ?? process.env), ...runEnv };
  // Workflow tests 3b (D71): a Pretend try's carried sign-in (string values of sign-in keys only, readUserSignIn): over the
  // ambient and run env, under the model env, so a model's own routing always wins. Absent: byte-identical.
  if (signInEnv && Object.keys(signInEnv).length) env = { ...(env ?? process.env), ...signInEnv };
  if (overlay) env = { ...(env ?? process.env), ...overlay };
  if (hostPid != null) env = { ...(env ?? process.env), WORCA_HOST_PID: String(hostPid) };
  env = stripHostCredentials(env ?? process.env);
  delete env.WORCA_BROKER_SECRET;
  delete env.WORCA_BROKER_SECRET_FILE;
  // Workflow tests 3a (D56): a try's outward guard (PATH stand-ins, git that cannot sign in). Absent: byte-identical.
  if (tryGuard) env = withTryGuardEnv(env, tryGuard);
  env = withNoGitPath(env);
  return { env, scrubbed: !!scrubbedEnv };
}
```

- [ ] **Step 6: The gate (claude-runner.mjs).** `runClaude` names every field twice (its comment at :132-136). Add `pluginsOff,` after `tryGuard,` in the destructure (:163) and after `tryGuard,` in the `engine.run({ … })` call (:276). Add to the JSDoc after the `tryGuard` line (:101):
```js
 * @param {boolean} [o.pluginsOff]           workflow tests 3b: a Pretend try's spawn: carry the person's sign-in only (D71)
```

- [ ] **Step 7: runOpts, the prompts and the node context**

In `src/core/phases.mjs`, above `runOpts`, add:
```js
/** Workflow tests 3b (D70): the setting sources of a Pretend try's spawns: no user settings (the person's plugins, skills,
 *  agents and hooks); the project's and the local ones stay. */
export const PLUGINS_OFF_SOURCES = Object.freeze(['project', 'local']);
```
In `runOpts`, right after the `tryGuard` line (:856), add:
```js
    // Workflow tests 3b (D70, D71): a Pretend try loads no user settings, and the runner carries over only the sign-in kept
    // there. Absent on every other spawn, so its argv and env stay byte-identical.
    ...(ctx.pluginsOff === true ? { settingSources: [...PLUGINS_OFF_SOURCES], pluginsOff: true } : {}),
```

In `fanOutDirective` (:320), add `personalOff = false` to the options and add to its doc comment "`personalOff` (workflow tests 3b, D70): a Pretend try's spawn loads no personal (`~/.claude`) agents or skills, so neither is promised.". Replace the last two branches of `subagentSentence` (from `: omitProjectAgents` at :347 to the end of that expression) with:
```js
      : omitProjectAgents
        ? (personalOff
          ? 'Pick the BEST-FIT `subagent_type`: use `"general-purpose"` (or `"Explore"` for pure code search). This run starts at ' +
            'the worca-cc run root, so no member project\'s own agents are discoverable by name.'
          : 'Pick the BEST-FIT `subagent_type`: your personal agents (`~/.claude/agents`) are available by ' +
            'name — prefer a purpose-built one when it fits the sub-task, else fall back to ' +
            '`"general-purpose"` (or `"Explore"` for pure code search). This run starts at the worca-cc run ' +
            'root, so no member project\'s own agents are discoverable by name.')
        : (personalOff
          ? 'Pick the BEST-FIT `subagent_type`: this project\'s own agents (`.claude/agents`) are available by name — prefer a ' +
            'purpose-built one when it fits the sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).'
          : 'Pick the BEST-FIT `subagent_type`: this project\'s own agents (`.claude/agents`) and your personal ' +
            'agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the ' +
            'sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).');
```
In the returned string, replace the "Skills are available too" lines (:363-365) with:
```js
    (personalOff
      ? 'Skills are available too: this project\'s skills (`.claude/skills`) can be invoked via the Skill tool — by you AND by ' +
        'the sub-agents you spawn — use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.\n\n'
      : 'Skills are available too: this project\'s and your personal skills (`.claude/skills`, ' +
        '`~/.claude/skills`) can be invoked via the Skill tool — by you AND by the sub-agents you spawn — ' +
        'use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.\n\n') +
```
The unchanged strings must stay byte-identical: copy them from the file, not from here, if they differ (the test compares `personalOff: false` with no option).

In `taskHeader`, add `const personalOff = ctx.pluginsOff === true;   // 3b (D70): a Pretend try's spawn has no personal skills` after `const nodeEngine = …` (:994), and replace the last two branches of `skillsHint` (from `: detached` at :1003 to the end) with:
```js
    : detached
    ? (personalOff
      ? `Project and root skills are mounted at .claude/skills for this run and are available via the Skill tool — invoke ` +
        `any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.\n\n`
      : `Project and root skills are mounted at .claude/skills for this run (in addition to your ` +
        `personal ~/.claude/skills) and are available via the Skill tool — invoke any that fit ` +
        `(e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing ` +
        `conventions.\n\n`)
    : (personalOff
      ? `Project skills (.claude/skills in this project) are available via the Skill tool — invoke any that fit (e.g. ` +
        `design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.\n\n`
      : `Project and personal skills (.claude/skills in this project and ~/.claude/skills) are ` +
        `available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or ` +
        `knowledge-graph skills) rather than guessing conventions.\n\n`);
```

Both callers of `fanOutDirective` pass the flag: in `src/core/phases.mjs:1126` and `src/core/graph/executor.mjs:577`, add `personalOff: ctx?.pluginsOff === true` to the options object. (`executor.mjs`'s `headerCtx` spreads `ctx` at :534-539, so `taskHeader` sees `pluginsOff` there too.)

In `src/core/orchestrator.mjs:1888`, replace the workflow-tests line with:
```js
      // Workflow tests (D35): a pretend try loads only its mcp.json; a script step learns it runs in a test. 3b (D70): a pretend
      // try's spawns load no user settings either (runOpts: --setting-sources project,local; the sign-in is carried over).
      ...(this._testConnectors() ? { testConnectors: this._testConnectors(), mcpStrict: this._testConnectors() === 'pretend',
        ...(this._testConnectors() === 'pretend' ? { pluginsOff: true } : {}) } : {}),
```

- [ ] **Step 8: Run the tests**

Run: `node tools/test.mjs test/workflow-test-plugins-off.test.mjs test/spawn-args.test.mjs test/agent-user.test.mjs test/claude-mcpjson-guard.test.mjs test/directions-prompt.test.mjs test/engine-cost.test.mjs test/engine-gate.test.mjs test/requirements-interview.test.mjs`
Expected: PASS (the POSIX-shim tests skip on Windows, as in the baseline). Find every other test that pins prompt text with `Select-String -Path test\*.test.mjs -Pattern "fanOutDirective|taskHeader" -List` and run each listed file too; they pass unchanged (only the `personalOff` branches are new).

- [ ] **Step 9: The person's own guards ride along (D81)**

With `--setting-sources project,local` the person's user-level `permissions.deny` and `sandbox` would no longer apply. They only ever block, so they are carried, in every case.

Add to `test/claude-sign-in.test.mjs` (import `readUserSafety` and `SAFETY_DENY_MAX` too):
```js
test('D81: the person\'s own deny rules and sandbox; never their allow or ask rules; nothing from an unreadable file', () => {
  assert.deepEqual(readUserSafety({ env: {}, home: home({ permissions: { deny: ['Bash(rm -rf:*)', '', 3, 'Bash(rm -rf:*)'], allow: ['Bash(*)'], ask: ['Bash(git push:*)'] },
    sandbox: { enabled: true } }) }), { deny: ['Bash(rm -rf:*)'], sandbox: { enabled: true } });
  for (const [body, why] of [[undefined, 'no file'], ['{ not json', 'unreadable'], [{ sandbox: [1] }, 'a sandbox that is not an object'],
    [{ permissions: { deny: 'Bash(x)' } }, 'deny is not a list'], ['[1]', 'not an object']]) {
    assert.deepEqual(readUserSafety({ env: {}, home: home(body) }), { deny: [], sandbox: null }, why);
  }
  const many = Array.from({ length: 600 }, (_, i) => `Bash(x${i})`);
  assert.equal(readUserSafety({ env: {}, home: home({ permissions: { deny: many } }) }).deny.length, SAFETY_DENY_MAX);
});
```
Add to `test/workflow-test-plugins-off.test.mjs`:
```js
test('D81: the person\'s deny rules after Worca\'s and the try guard\'s, the sandbox kept, and only ever in a file', () => {
  const S = { deny: ['Bash(rm -rf:*)', 'Read(.env*)'], sandbox: { enabled: true } };
  const p = buildSettingsPayload({ deny: ['Read(.env*)'] }, { safetySettings: S });
  assert.deepEqual(p.settings.permissions.deny, ['Read(.env*)', 'Bash(rm -rf:*)']);
  assert.deepEqual(p.settings.sandbox, { enabled: true });
  assert.equal(p.signIn, true, 'a file, never inline');
  const tg = { logFile: '/x/calls.ndjson' };
  const base = (buildSettingsPayload(null, { tryGuard: tg }).settings.permissions || {}).deny || [];
  assert.deepEqual(buildSettingsPayload(null, { tryGuard: tg, safetySettings: S }).settings.permissions.deny, [...new Set([...base, ...S.deny])]);
  assert.equal(buildSettingsPayload(null, { safetySettings: { deny: [], sandbox: null } }), null, 'nothing to carry: no flag');
  assert.throws(() => buildClaudeArgs({ ...BASE, safetySettings: S }), /settings file/);
  const dir = tmp();
  const plan = planClaudeInvocation({ ...BASE, safetySettings: S }, { bin: 'claude', dir });
  assert.equal(plan.args[plan.args.indexOf('--settings') + 1], join(dir, 'settings.json'));
});

test('D81: the guards are carried in every case: with no sign-in, with the broker on, into an agent user\'s spawn', () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  const found = () => ({ state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: {} });
  const safe = () => ({ deny: ['Bash(rm -rf:*)'], sandbox: null });
  const empty = () => ({ deny: [], sandbox: null });
  const G = { deny: ['Bash(rm -rf:*)'], sandbox: null };
  assert.deepEqual(signInCarry({ read: none, readSafety: safe }), { env: {}, settings: {}, safety: G });
  assert.equal(signInCarry({ read: none, readSafety: empty }), null);
  assert.deepEqual(signInCarry({ read: found, readSafety: empty }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: {} }, 'no guards: no safety key');
  assert.deepEqual(signInCarry({ read: found, readSafety: safe, asAgent: true, agentUser: () => ({ user: 'a' }) }), { env: {}, settings: {}, safety: G },
    'the sign-in stays with its user; the guards come along');
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';
  try { assert.deepEqual(signInCarry({ read: found, readSafety: safe }), { env: {}, settings: {}, safety: G }); }
  finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
});
```
Run: `node tools/test.mjs test/claude-sign-in.test.mjs test/workflow-test-plugins-off.test.mjs`
Expected: FAIL: `readUserSafety` is not exported.

In `src/core/engines/claude-sign-in.mjs`, add below `readUserSignIn`:
```js
/** D81: at most this many of the person's own deny rules are carried. */
export const SAFETY_DENY_MAX = 500;
const noSafety = () => ({ deny: [], sandbox: null });

/**
 * Workflow tests 3b (D81): the person's own guards in their user settings, which only ever block: `permissions.deny` (non-empty
 * strings, deduplicated, at most SAFETY_DENY_MAX) and `sandbox` (a plain object). Never their allow or ask rules. Nothing from
 * a file Worca cannot read or parse. Never throws.
 * @returns {{deny: string[], sandbox: object|null}}
 */
export function readUserSafety({ env = process.env, home, read = (p) => readFileSync(p, 'utf8') } = {}) {
  try {
    const raw = String(read(userSettingsFile({ env, home })));
    const s = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return noSafety();
    const d = s.permissions && typeof s.permissions === 'object' && Array.isArray(s.permissions.deny) ? s.permissions.deny : [];
    const deny = [...new Set(d.filter((x) => typeof x === 'string' && x.trim()))].slice(0, SAFETY_DENY_MAX);
    const sandbox = s.sandbox && typeof s.sandbox === 'object' && !Array.isArray(s.sandbox) ? s.sandbox : null;
    return { deny, sandbox };
  } catch { return noSafety(); }
}
```

In `src/core/engines/claude.mjs`, import `readUserSafety` too, and add below `signInSettingsOf`:
```js
/** Workflow tests 3b (D81): the person's own deny rules and sandbox, or null when there are none. */
function safetySettingsOf(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const deny = Array.isArray(s.deny) ? s.deny.filter((x) => typeof x === 'string' && x.trim()) : [];
  const sandbox = s.sandbox && typeof s.sandbox === 'object' && !Array.isArray(s.sandbox) ? s.sandbox : null;
  return deny.length || sandbox ? { deny, sandbox } : null;
}
```
In `buildSettingsPayload`, add `safetySettings = null` to the options; replace `const rules = tg ? withTryDeny(permissionRules) : permissionRules;` with:
```js
  const rules0 = tg ? withTryDeny(permissionRules) : permissionRules;
  // D81: the person's own deny rules, after Worca's and the try guard's (deduplicated): they only add blocks.
  const safety = safetySettingsOf(safetySettings);
  const rules = safety && safety.deny.length
    ? { ...(rules0 && typeof rules0 === 'object' ? rules0 : {}), deny: [...new Set([...(rules0 && Array.isArray(rules0.deny) ? rules0.deny : []), ...safety.deny])] }
    : rules0;
```
and change the three Step 3 lines to:
```js
  if (!hook && !hasRules && !guard && !extra && !usage && !read && !tg && !signIn && !safety) return null;
  const settings = { ...(extra ?? {}), ...(signIn ?? {}), ...(safety && safety.sandbox ? { sandbox: safety.sandbox } : {}) };
  // … unchanged …
  return signIn || safety ? { hook: !!hook, settings, signIn: true } : { hook: !!hook, settings };
```
(`signIn: true` means "the person's settings ride in it: a file only".) Pass `safetySettings` wherever Step 3 passes `signInSettings`: `buildSettingsArgs`'s options and its `buildSettingsPayload` call, `buildClaudeArgs`'s destructure and its `buildSettingsArgs` call, and `planClaudeInvocation` (`const fileSettings = !!(signInSettingsOf(opts.signInSettings) || safetySettingsOf(opts.safetySettings));`, the inline measure with both set to null, and `safetySettings: opts.safetySettings` in its `buildSettingsPayload` call).

Replace `signInCarry` with:
```js
export function signInCarry({ modelEnv = null, asAgent = false, read = readUserSignIn, readSafety = readUserSafety,
  agentUser = () => agentIdentityFor(currentOwner()) } = {}) {
  try {
    const extra = modelEnv && typeof modelEnv === 'object' && Object.keys(modelEnv).length ? prepareModelEnv(modelEnv).env : {};
    const env = { ...process.env, ...extra };
    // D81: the person's own deny rules and sandbox only ever block: carried in every case.
    let safety = null;
    try { const g = readSafety({ env }); if (g && ((Array.isArray(g.deny) && g.deny.length) || g.sandbox)) safety = { deny: g.deny || [], sandbox: g.sandbox || null }; }
    catch { safety = null; }
    // D71: the sign-in never with the broker on, and never into a spawn that runs as another OS user.
    let isolated = false;
    if (asAgent) { try { isolated = !!agentUser(); } catch { isolated = false; } }
    const s = brokerEnabled() || isolated ? null : read({ env });
    const signIn = s && s.state === 'found' ? s : null;
    if (!signIn && !safety) return null;
    return { env: { ...(signIn ? signIn.env || {} : {}) }, settings: { ...(signIn ? signIn.settings || {} : {}) }, ...(safety ? { safety } : {}) };
  } catch { return null; }
}
```
and update its doc comment ("…and the person's own guards (D81), which are carried in every case"). In `runClaudeProcess`'s `stageClaudeInvocation({ … })` call, add after the `signInSettings` line:
```js
        safetySettings: carry && carry.safety ? carry.safety : null,
```
Step 1's broker and agent-user tests still hold: under `tools/test.mjs` the home is empty, so `readUserSafety` finds nothing and `signInCarry` answers null there.

Run Step 8's command again, with `test/claude-sign-in.test.mjs` added. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/core/engines/claude.mjs src/core/engines/spawn.mjs src/core/claude-runner.mjs src/core/phases.mjs src/core/graph/executor.mjs src/core/orchestrator.mjs src/core/engines/claude-sign-in.mjs test/workflow-test-plugins-off.test.mjs test/claude-sign-in.test.mjs
git commit -m "Workflow tests 3b: a Pretend try's spawns load no user settings; the sign-in and the person's own guards ride along (D70, D71, D81)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The project's own hooks and plugins off in a Pretend project try (D72)

**Files:**
- Create: `src/core/workflow-tests/project-claude-settings.mjs`
- Modify: `src/core/run-harness.mjs` (after the setup call at :1670; a new `_pluginsOffInCheckout` below `_untrackedDirs` :2850; `_excludePathspecs` :7212-7222)
- Test: `test/workflow-test-project-claude-settings.test.mjs`, `test/api-workflow-test-plugins-off.test.mjs`

**Interfaces:**
- Consumes: `_testConnectors()` (run-harness.mjs:3911), `this._git`, `_recordRunWarning(text)` (:5377), `appendAudit`, `markTerminal` (all already used by `_runTrySetup`); Task 2's `pluginsOff` node context.
- Produces:
  - `PROJECT_SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json']`, `STRIPPED_SETTINGS_KEYS = ['hooks', 'enabledPlugins']`;
  - `strippedSettingsText(text): string | null`;
  - `stripProjectClaudeSettings(checkoutDir): Promise<{ changed: string[], links: string[] }>`;
  - the harness's `_tryPluginPaths: string[]` (tracked paths Worca changed or removed), part of `_excludePathspecs`.

- [ ] **Step 1: Write the failing unit test.** Create `test/workflow-test-project-claude-settings.test.mjs`:

```js
// test/workflow-test-project-claude-settings.test.mjs — workflow tests 3b, Task 3 (D72): the project's own Claude Code hooks and
// plugins switched off in a Pretend try's checkout; links never followed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strippedSettingsText, stripProjectClaudeSettings, PROJECT_SETTINGS_FILES, STRIPPED_SETTINGS_KEYS }
  from '../src/core/workflow-tests/project-claude-settings.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-pcs-')); dirs.push(d); return d; };
const canLinkFiles = (() => { try { const d = tmp(); writeFileSync(join(d, 't'), 'x'); symlinkSync(join(d, 't'), join(d, 'l')); return true; } catch { return false; } })();
const FILE_LINKS = { skip: canLinkFiles ? false : 'this machine cannot make file symlinks (EPERM on Windows without developer mode)' };

test('the text: hooks and enabledPlugins go, everything else stays; nothing to do is null', () => {
  assert.deepEqual(STRIPPED_SETTINGS_KEYS, ['hooks', 'enabledPlugins']);
  assert.deepEqual(PROJECT_SETTINGS_FILES, ['.claude/settings.json', '.claude/settings.local.json']);
  const t = strippedSettingsText(JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] }, hooks: { SessionStart: [] }, enabledPlugins: { 'p@m': true }, env: { A: '1' } }));
  assert.deepEqual(JSON.parse(t), { permissions: { allow: ['Bash(npm test:*)'] }, env: { A: '1' } });
  assert.ok(t.endsWith('\n'));
  assert.equal(strippedSettingsText(JSON.stringify({ permissions: {} })), null, 'no such key');
  assert.equal(strippedSettingsText('{ not json'), null, 'the CLI cannot read it either');
  assert.equal(strippedSettingsText('[1]'), null);
  assert.equal(strippedSettingsText(''), null);
  assert.deepEqual(JSON.parse(strippedSettingsText(`﻿${JSON.stringify({ hooks: {} })}`)), {});
});

test('in a checkout: both files, what changed is named; agents, skills and CLAUDE.md are not touched', async () => {
  const d = tmp();
  mkdirSync(join(d, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [] }, model: 'x' }));
  writeFileSync(join(d, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { a: true } }));
  writeFileSync(join(d, '.claude', 'agents', 'a.md'), '# a');
  writeFileSync(join(d, 'CLAUDE.md'), '# rules');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: ['.claude/settings.json', '.claude/settings.local.json'], links: [] });
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8')), { model: 'x' });
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.local.json'), 'utf8')), {});
  assert.equal(readFileSync(join(d, '.claude', 'agents', 'a.md'), 'utf8'), '# a');
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '# rules');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: [] }, 'a second pass changes nothing');
  assert.deepEqual(await stripProjectClaudeSettings(tmp()), { changed: [], links: [] }, 'no .claude folder');
});

test('a settings file that is a link is removed, never followed', FILE_LINKS, async () => {
  const d = tmp();
  const outside = tmp();
  const target = join(outside, 'settings.json');
  writeFileSync(target, JSON.stringify({ hooks: { PreToolUse: [] } }));
  mkdirSync(join(d, '.claude'));
  symlinkSync(target, join(d, '.claude', 'settings.json'));
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: ['.claude/settings.json'] });
  assert.equal(existsSync(join(d, '.claude', 'settings.json')), false);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { hooks: { PreToolUse: [] } }, 'the file it pointed at is untouched');
});

test('a .claude folder that is a link (a junction on Windows) is removed, the link only', async () => {
  const d = tmp();
  const outside = tmp();
  writeFileSync(join(outside, 'settings.json'), JSON.stringify({ hooks: {} }));
  symlinkSync(outside, join(d, '.claude'), 'junction');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: ['.claude'] });
  assert.equal(existsSync(join(d, '.claude')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(outside, 'settings.json'), 'utf8')), { hooks: {} }, 'never followed');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-project-claude-settings.test.mjs`
Expected: FAIL, "Cannot find module '…/project-claude-settings.mjs'".

- [ ] **Step 3: Write the module.** Create `src/core/workflow-tests/project-claude-settings.mjs`:

```js
// src/core/workflow-tests/project-claude-settings.mjs — workflow tests 3b (D72): in a Pretend project try's checkout, the
// project's own Claude Code settings lose their hooks and enabled plugins (they can send things); its instructions (CLAUDE.md,
// agents, skills, commands) and its other settings stay (Q7 a). Never follows a link: a settings file or a .claude folder that
// is one is removed (the link only), so nothing outside the checkout is read or written.
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PROJECT_SETTINGS_FILES = Object.freeze(['.claude/settings.json', '.claude/settings.local.json']);
export const STRIPPED_SETTINGS_KEYS = Object.freeze(['hooks', 'enabledPlugins']);

/** The settings text without STRIPPED_SETTINGS_KEYS (2-space JSON and a final newline), or null when nothing changes: no
 *  such key, or not a JSON object (the CLI ignores a file it cannot parse). A leading BOM is read. Pure. */
export function strippedSettingsText(text) {
  const raw = String(text ?? '');
  const body = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  let s;
  try { s = JSON.parse(body); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (!STRIPPED_SETTINGS_KEYS.some((k) => Object.hasOwn(s, k))) return null;
  const out = { ...s };
  for (const k of STRIPPED_SETTINGS_KEYS) delete out[k];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * D72: switch the project's hooks and plugins off in `checkoutDir`. `changed`: the files rewritten; `links`: the links
 * removed (`.claude` itself, or a settings file). Throws only when a file cannot be read or written (the caller ends the try).
 * @returns {Promise<{changed: string[], links: string[]}>}
 */
export async function stripProjectClaudeSettings(checkoutDir) {
  const changed = [];
  const links = [];
  let st = null;
  try { st = await lstat(join(checkoutDir, '.claude')); } catch { return { changed, links }; }
  if (st.isSymbolicLink()) {   // a symlink or, on Windows, a junction: never read through it
    await rm(join(checkoutDir, '.claude'), { force: true });
    links.push('.claude');
    return { changed, links };
  }
  if (!st.isDirectory()) return { changed, links };
  for (const rel of PROJECT_SETTINGS_FILES) {
    const file = join(checkoutDir, ...rel.split('/'));
    let fst = null;
    try { fst = await lstat(file); } catch { continue; }
    if (fst.isSymbolicLink()) { await rm(file, { force: true }); links.push(rel); continue; }
    if (!fst.isFile()) continue;
    const next = strippedSettingsText(await readFile(file, 'utf8'));
    if (next === null) continue;
    await writeFile(file, next, 'utf8');
    changed.push(rel);
  }
  return { changed, links };
}
```

- [ ] **Step 4: Run the unit test**

Run: `node tools/test.mjs test/workflow-test-project-claude-settings.test.mjs`
Expected: PASS (the file-link test skips on this laptop with its reason; the junction test runs).

- [ ] **Step 5: Write the failing API test.** Create `test/api-workflow-test-plugins-off.test.mjs`:

```js
// test/api-workflow-test-plugins-off.test.mjs — workflow tests 3b, Task 3 (D70, D72): through the run handler (mock engine). A
// Pretend try's spawns load no user settings; in a project try the project's own hooks and plugins are off in the checkout,
// its other settings, agents and CLAUDE.md stay, and none of it is in what the try changed. A Real try keeps both.
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
import { runSettled } from './helpers/run-settled.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, runs, _testing, artifacts, real, key, pin, copyDir, settled, executor, realRunClaude;
const extra = [];
const spawns = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const GRAPH = {
  version: 2, id: 'wf_poff', name: 'Fix a bug', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};
const PROJECT_SETTINGS = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] }, enabledPlugins: { 'p@m': true },
  permissions: { allow: ['Bash(npm test:*)'] } };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpoff-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  executor = await import('../src/core/graph/executor.mjs');
  ({ runClaude: realRunClaude } = await import('../src/core/claude-runner.mjs'));
  executor._testing.runClaude = async (o) => { spawns.push(o); return realRunClaude(o); };   // every agent spawn's options
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  settled = runSettled({ runs, answerRun: _testing.answerRun });
  artifacts = await import('../src/core/artifacts.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftpoff', { branch: 'main', user: true, files: { '.gitignore': 'node_modules/\n.claude/settings.local.json\n', 'README.md': '# hi\n',
    '.claude/settings.json': `${JSON.stringify(PROJECT_SETTINGS, null, 2)}\n`, '.claude/agents/helper.md': '# helper\n', 'CLAUDE.md': '# rules\n' } });
  extra.push(real);
  const { insertProject } = await import('../src/core/projects.mjs');
  insertProject({ name: 'tickets', path: real });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(homeDir, '.worca-cc', 'workflow-tests', 'repos', key);   // worcaHome() is <WORCA_HOME>/.worca-cc
  assert.equal((await post('/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (executor) executor._testing.runClaude = null;
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const projectBody = async (title) => {
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  return { ...tryRunBody({ name: 'Ticket 482', request: 'Fix the rounding.' }, [], { workflowId: 'wf_poff', tryNo: 1,
    project: { copyDir, startCommit: pin.startCommit } }), title };
};
async function projectTry(connectors, title) {
  const from = spawns.length;
  const out = await _testing.invokeStartRun(await projectBody(title), null, { workflowTest: { use: 'draft', connectors, project: { key, setupCmd: null } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  const row = artifacts.findPipelineRowById(entry.pipelineId);
  const br = JSON.parse(row.branch);
  return { entry, row, br, mine: spawns.slice(from).filter((o) => String(o.cwd || '').startsWith(br.worktreeDir)) };
}

test('a Pretend project try: no user settings on any spawn; the project\'s hooks and plugins off; the rest stays; none of it is a change', { timeout: 240000 }, async () => {
  const was = repoSnapshot(real);
  const { entry, row, br, mine } = await projectTry('pretend', 'Test: Ticket 482 · try 1');
  assert.equal(row.status, 'done');
  assert.ok(mine.length > 0, 'the try spawned its agent');
  for (const o of mine) {
    assert.deepEqual(o.settingSources, ['project', 'local']);
    assert.equal(o.pluginsOff, true);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(br.worktreeDir, '.claude', 'settings.json'), 'utf8')), { permissions: { allow: ['Bash(npm test:*)'] } });
  assert.ok(existsSync(join(br.worktreeDir, '.claude', 'agents', 'helper.md')), 'the project\'s agents stay');
  assert.equal(readFileSync(join(br.worktreeDir, 'CLAUDE.md'), 'utf8'), '# rules\n', 'and its instructions');
  const results = JSON.parse(readFileSync(join(entry.orch.pipeline.dir, 'results.json'), 'utf8'));
  const paths = [...results.newFiles, ...results.changedFiles].map((f) => f.path);
  assert.ok(paths.includes('src/feature.mjs'), 'the mock implementer\'s work is the change');
  assert.ok(!paths.includes('.claude/settings.json'), 'Worca\'s switch-off is not');
  assert.equal(git(copyDir, 'show', `${br.feature}:.claude/settings.json`), JSON.stringify(PROJECT_SETTINGS, null, 2), 'nor is it committed');
  assert.equal(repoSnapshot(real), was, 'nothing in the person\'s repository changed');
});

test('a Real project try keeps them: user settings load and the project file is untouched', { timeout: 240000 }, async () => {
  const { row, br, mine } = await projectTry('real', 'Test: Ticket 482 · try 2');
  assert.equal(row.status, 'done');
  assert.ok(mine.length > 0);
  for (const o of mine) { assert.equal('settingSources' in o, false); assert.equal('pluginsOff' in o, false); }
  assert.deepEqual(JSON.parse(readFileSync(join(br.worktreeDir, '.claude', 'settings.json'), 'utf8')), PROJECT_SETTINGS);
});

test('a Pretend try without a project: its spawns load no user settings either', { timeout: 240000 }, async () => {
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  const from = spawns.length;
  const out = await _testing.invokeStartRun({ ...tryRunBody({ name: 'Brief', request: 'Write it.' }, [], { workflowId: 'wf_poff', tryNo: 1 }),
    title: 'Test: Brief · try 1' }, null, { workflowTest: { use: 'draft' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  await settled(out.body.runId);
  const mine = spawns.slice(from);
  assert.ok(mine.length > 0);
  for (const o of mine) assert.deepEqual(o.settingSources, ['project', 'local']);
});
```
If the no-project body is refused because `wf_poff` needs a project (D62 lets the server start it; the runner is what refuses), give the third test a workflow with a `producer` agent instead, as `test/api-workflow-test-try.test.mjs` does. Correct the test, not product code.

- [ ] **Step 6: Run it to see it fail**

Run: `node tools/test.mjs test/api-workflow-test-plugins-off.test.mjs`
Expected: the first test FAILS at the checkout's `.claude/settings.json` still holding `hooks` (the spawn assertions already pass after Task 2).

- [ ] **Step 7: The harness.** In `src/core/run-harness.mjs`, add to the imports:

```js
import { stripProjectClaudeSettings } from './workflow-tests/project-claude-settings.mjs';
```

Right after the setup call (:1670), add:
```js
      // Workflow tests 3b (D72): a Pretend project try runs without the project's own Claude Code hooks and plugins (after its
      // setup, which may write them; before any step).
      if (this._testConnectors() === 'pretend' && this.workMode === 'git' && !this.isWorkspace) await this._pluginsOffInCheckout();
```

Below `_untrackedDirs` (:2850), add:
```js
  /** Workflow tests 3b (D72): in a Pretend try's checkout, the project's Claude Code settings lose their hooks and enabled
   *  plugins; links are removed, never followed. The tracked files Worca changed or removed stay out of the try's commit and
   *  diff (_excludePathspecs). Only tracked ones are named: an ignored path in an exclude pathspec fails `git add`. A failure
   *  to write ends the try before any step: the promise of Pretend would not hold. */
  async _pluginsOffInCheckout() {
    const cwd = this.workDirs.get(this.members[0].projectKey) || null;
    if (!cwd) return;
    let r;
    try { r = await stripProjectClaudeSettings(cwd); } catch (e) {
      throw markTerminal(Object.assign(new Error(`Worca could not switch off the project's Claude Code hooks and plugins for this try: ${e && e.message ? e.message : e}`),
        { code: 'TRY_PLUGINS_OFF_FAILED' }));
    }
    const touched = [...r.changed, ...r.links];
    if (!touched.length) return;
    const ls = await this._git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--', ...touched.map((p) => `:(literal)${p}`)], { cwd });
    const tracked = new Set(ls.ok ? ls.stdout.split('\0').filter(Boolean) : []);
    this._tryPluginPaths = touched.filter((p) => tracked.has(p));
    for (const p of r.links) await this._recordRunWarning(`The project's ${p} is a link, so Worca left it out of this try.`);
    await appendAudit(this.pipeline.dir, `Switched off the project's Claude Code hooks and plugins for this try (${touched.join(', ')}).`).catch(() => {});
  }
```

Replace `_excludePathspecs` (:7212-7222):
```js
  _excludePathspecs(projectKey) {
    const entries = this.injectedPaths?.[projectKey] ?? [];
    // Workflow tests 3a (D55): what "Before each try, run" made is not the try's work. Absent on every other run.
    // `literal`: a `*`, `?` or `[` in a path the setup made is that character, never a pattern.
    const setup = Array.isArray(this._trySetupPaths) ? this._trySetupPaths.map((p) => `:(exclude,literal)${p}`) : [];
    // Workflow tests 3b (D72): the project's Claude Code settings Worca switched off (tracked ones only). Absent elsewhere.
    const plugins = Array.isArray(this._tryPluginPaths) ? this._tryPluginPaths.map((p) => `:(exclude,literal)${p}`) : [];
    if ((!Array.isArray(entries) || !entries.length) && !setup.length && !plugins.length) return [];
    return [...(Array.isArray(entries) ? entries : [])
      .filter((e) => e && e.path && e.kind !== 'claudeMdSection' && e.kind !== 'engineConfig')
      .map((e) => `:(exclude)${e.path}`), ...setup, ...plugins];
  }
```

- [ ] **Step 8: Run the tests**

Run: `node tools/test.mjs test/workflow-test-project-claude-settings.test.mjs test/api-workflow-test-plugins-off.test.mjs test/api-workflow-test-project-try.test.mjs test/api-workflow-test-try.test.mjs test/workflow-test-isolation.test.mjs`
Expected: PASS. 3a's project-try test still shows a normal run unchanged and its setup output out of the diff.

- [ ] **Step 9: Commit**

```bash
git add src/core/workflow-tests/project-claude-settings.mjs src/core/run-harness.mjs test/workflow-test-project-claude-settings.test.mjs test/api-workflow-test-plugins-off.test.mjs
git commit -m "Workflow tests 3b: the project's own Claude Code hooks and plugins off in a Pretend try's checkout (D72)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Proofs: plugins off on the real CLI (free), and the one paid proof (controller only)

The brief's §6 plugins-off proofs.
- **Free (no model call):** the real Claude Code CLI, a fake Anthropic API that answers one Bash tool call and then "Done.", and a sandbox `CLAUDE_CONFIG_DIR` that holds what a Pretend try must not load: an installed plugin with a skill and a SessionStart hook, a personal skill, agent and CLAUDE.md, and marker hooks for SessionStart, UserPromptSubmit and PreToolUse. Because the fake model calls a tool, a user PreToolUse hook would fire if it loaded (correction 10). The same run shows the carried sign-in reaching the API (correction 9).
- **Paid (Step 6):** a real Pretend try on Haiku through the person's own Claude sign-in: it signs in under `project,local`, the project's own hooks do not fire, its CLAUDE.md is followed. A Real try is the control. Controller only, capped at $3.

**Files:**
- Create: `.superpowers/sdd/proofs/plugins-off-real-cli.mjs` (a script, not a test: it starts the real CLI, which `tools/test.mjs` forbids)
- Create (by running): `.superpowers/sdd/proofs/plugins-off-real-cli.json`, `.superpowers/sdd/real-call-proof-3b.md`
- Possibly modify: `src/core/engines/claude-sign-in.mjs` and `test/claude-sign-in.test.mjs`, only by Step 4's rule.

**Interfaces:**
- Consumes: `runClaude` (claude-runner.mjs), `stripProjectClaudeSettings` (Task 3), `PLUGINS_OFF_SOURCES` (Task 2).
- Produces: the proof's JSON and markdown records. No product code changes unless Step 4's rule fires.

- [ ] **Step 1: Write the free proof.** Create `.superpowers/sdd/proofs/plugins-off-real-cli.mjs`:

```js
// .superpowers/sdd/proofs/plugins-off-real-cli.mjs — workflow tests 3b, Task 4 (free: no model is called). The real Claude Code
// CLI, a fake Anthropic API, and a sandbox Claude config folder holding what a Pretend try must not load: a plugin (a skill and
// a SessionStart hook), a personal skill, agent and CLAUDE.md, and marker hooks (SessionStart, UserPromptSubmit, PreToolUse).
// The fake API answers one Bash tool call and then "Done.", so a PreToolUse hook would fire if it loaded.
// Variants (each through runClaude, as a try's node spawns):
//   normal  — a normal run (the control): every marker and personal piece should show; also which env wins, the user
//             settings' or the process's
//   pretend — a Pretend project try: the project strip + --setting-sources project,local + pluginsOff
//   helper  — the sign-in is an apiKeyHelper: it reaches the CLI through Worca's settings file
//   none    — no sign-in in the user settings: the process env's key is used, nothing is carried
//   jsonc   — a user settings.json with a // comment (a normal run): does the CLI read it?
// Usage, from the worktree root: node .superpowers/sdd/proofs/plugins-off-real-cli.mjs <path to the claude binary>
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = process.argv[2];
if (!bin || !existsSync(bin)) { console.error('usage: node plugins-off-real-cli.mjs <path to the claude binary>'); process.exit(2); }
const root = mkdtempSync(join(tmpdir(), 'worca-proof-3b-'));
process.env.WORCA_HOME = join(root, 'home');
process.env.WORCA_HOST_GUARD = '0';
delete process.env.WORCA_MOCK;
const STRIP = /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLOUD_ML_|VERTEX_|AWS_BEARER|CLAUDE_CONFIG_DIR$)/;
for (const k of Object.keys(process.env)) if (STRIP.test(k)) delete process.env[k];
Object.assign(process.env, { DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' });

const { runClaude } = await import('../../../src/core/claude-runner.mjs');
const { stripProjectClaudeSettings } = await import('../../../src/core/workflow-tests/project-claude-settings.mjs');
const { PLUGINS_OFF_SOURCES } = await import('../../../src/core/phases.mjs');

const USER_MD = 'PROOF-USER-MEMORY-7731';
const PROJECT_MD = 'PROOF-PROJECT-MEMORY-4402';
const fwd = (p) => p.replace(/\\/g, '/');
const marks = join(root, 'marks');
const markJs = join(root, 'mark.mjs');
writeFileSync(markJs, "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], '1');\n");
const mark = (name) => `"${fwd(process.execPath)}" "${fwd(markJs)}" "${fwd(join(marks, name))}"`;
const hook = (name) => [{ hooks: [{ type: 'command', command: mark(name) }] }];
const toolHook = (name) => [{ matcher: '*', hooks: [{ type: 'command', command: mark(name) }] }];
const write = (p, text) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); };

// ── The fake API: one Bash tool call, then "Done." (3a's Task 9 reply shape) ──
const seen = [];
function reply(res, stream, turn) {
  const msg = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-haiku-proof', usage: { input_tokens: 10, output_tokens: 5 } };
  const block = turn.tool ? { type: 'tool_use', id: `toolu_${Date.now()}`, name: 'Bash', input: turn.tool } : { type: 'text', text: turn.text };
  const stop = turn.tool ? 'tool_use' : 'end_turn';
  if (!stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...msg, content: [block], stop_reason: stop })); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...msg, content: [], stop_reason: null } });
  if (turn.tool) {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: block.id, name: 'Bash', input: {} } });
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
function fakeApi(label) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.split('?')[0].endsWith('/v1/messages')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
      let j = {};
      try { j = JSON.parse(body); } catch { /* keep {} */ }
      const results = (j.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content.filter((c) => c && c.type === 'tool_result') : []));
      const hasBash = Array.isArray(j.tools) && j.tools.some((t) => t && t.name === 'Bash');
      seen.push({ api: label, key: req.headers['x-api-key'] || null, auth: req.headers.authorization ? 'set' : null,
        userMd: body.includes(USER_MD), projectMd: body.includes(PROJECT_MD), toolResults: results.length, hasBash });
      reply(res, j.stream === true, hasBash && results.length === 0 ? { tool: { command: 'echo hi', description: 'Say hi' } } : { text: 'Done.' });
    });
  });
}
const apiA = fakeApi('A');   // the user settings' ANTHROPIC_BASE_URL
const apiB = fakeApi('B');   // the process env's ANTHROPIC_BASE_URL
await new Promise((r) => apiA.listen(0, '127.0.0.1', r));
await new Promise((r) => apiB.listen(0, '127.0.0.1', r));
const urlA = `http://127.0.0.1:${apiA.address().port}`;
const urlB = `http://127.0.0.1:${apiB.address().port}`;

// ── The person's side: a sandbox config folder with a plugin, a skill, an agent, a CLAUDE.md, marker hooks ──
const cfg = join(root, 'cfg');
mkdirSync(cfg, { recursive: true });
write(join(cfg, 'skills', 'user-skill-proof', 'SKILL.md'), '---\nname: user-skill-proof\ndescription: proof\n---\nproof\n');
write(join(cfg, 'agents', 'user-agent-proof.md'), '---\nname: user-agent-proof\ndescription: proof\n---\nproof\n');
write(join(cfg, 'CLAUDE.md'), `Always say ${USER_MD}.\n`);
const mkt = join(root, 'mkt');
write(join(mkt, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'proof-mkt', owner: { name: 'proof' },
  plugins: [{ name: 'proof-plugin', source: './proof-plugin', description: 'proof' }] }));
write(join(mkt, 'proof-plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'proof-plugin', version: '0.0.1', description: 'proof' }));
write(join(mkt, 'proof-plugin', 'skills', 'plugin-skill-proof', 'SKILL.md'), '---\nname: plugin-skill-proof\ndescription: proof\n---\nproof\n');
write(join(mkt, 'proof-plugin', 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: hook('plugin-session') } }));
let pluginInstalled = true;
let pluginNote = null;
try {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
  execFileSync(bin, ['plugin', 'marketplace', 'add', mkt], { env, stdio: 'pipe' });
  execFileSync(bin, ['plugin', 'install', 'proof-plugin@proof-mkt'], { env, stdio: 'pipe' });
} catch (e) { pluginInstalled = false; pluginNote = String(e && (e.stderr || e.message) || e).slice(0, 400); }
const installed = existsSync(join(cfg, 'settings.json')) ? JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8')) : {};
const USER_HOOKS = { SessionStart: hook('user-session'), UserPromptSubmit: hook('user-prompt'), PreToolUse: toolHook('user-pretool') };
const userSettings = (over) => writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ enabledPlugins: installed.enabledPlugins || {}, hooks: USER_HOOKS, ...over }));

// ── The project: its own hook, plugin, skill, agent and CLAUDE.md ──
const projTpl = join(root, 'proj-template');
write(join(projTpl, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: hook('project-session') }, enabledPlugins: { 'proof-plugin@proof-mkt': true } }));
write(join(projTpl, '.claude', 'skills', 'project-skill-proof', 'SKILL.md'), '---\nname: project-skill-proof\ndescription: proof\n---\nproof\n');
write(join(projTpl, '.claude', 'agents', 'project-agent-proof.md'), '---\nname: project-agent-proof\ndescription: proof\n---\nproof\n');
write(join(projTpl, 'CLAUDE.md'), `Always say ${PROJECT_MD}.\n`);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projTpl });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: projTpl });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x'], { cwd: projTpl });
// Worca's own set skills (--plugin-dir), as materializeSkillMount makes them.
const worcaPlug = join(root, 'worca-plugin');
write(join(worcaPlug, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worca-set-proof', version: '0.0.1', description: 'proof' }));
write(join(worcaPlug, 'skills', 'worca-set-skill-proof', 'SKILL.md'), '---\nname: worca-set-skill-proof\ndescription: proof\n---\nproof\n');

const MARKS = ['user-session', 'user-prompt', 'user-pretool', 'plugin-session', 'project-session'];
async function variant(name, { pretend, settings, settingsText = null, env }) {
  rmSync(marks, { recursive: true, force: true });
  mkdirSync(marks, { recursive: true });
  if (settingsText !== null) writeFileSync(join(cfg, 'settings.json'), settingsText); else userSettings(settings);
  const work = join(root, `work-${name}`);
  cpSync(projTpl, work, { recursive: true });
  if (pretend) await stripProjectClaudeSettings(work);
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY']) delete process.env[k];
  Object.assign(process.env, env, { CLAUDE_CONFIG_DIR: cfg });
  const from = seen.length;
  const events = [];
  let error = null;
  try {
    await runClaude({ cwd: work, bin, prompt: 'Run echo hi with the Bash tool, then say Done.', allowedTools: ['Bash'], permissionMode: 'acceptEdits',
      pluginDirs: [worcaPlug], onEvent: (e) => events.push(e), ...(pretend ? { settingSources: [...PLUGINS_OFF_SOURCES], pluginsOff: true } : {}) });
  } catch (e) { error = e && e.message ? e.message.slice(0, 400) : String(e); }
  const init = (events.find((e) => e && e.type === 'system' && e.raw && e.raw.subtype === 'init') || {}).raw || null;
  const listed = (k) => JSON.stringify(init ? init[k] ?? null : null);
  return {
    error,
    marks: Object.fromEntries(MARKS.map((m) => [m, existsSync(join(marks, m))])),
    requests: seen.slice(from),
    init: init ? { apiKeySource: init.apiKeySource ?? null, skills: listed('skills'), slash: listed('slash_commands'), agents: listed('agents'), plugins: listed('plugins') } : null,
  };
}
const has = (s, w) => typeof s === 'string' && s.includes(w);

const normal = await variant('normal', { pretend: false, settings: { env: { ANTHROPIC_BASE_URL: urlA, ANTHROPIC_API_KEY: 'sk-ant-carried-0001' } },
  env: { ANTHROPIC_BASE_URL: urlB, ANTHROPIC_API_KEY: 'sk-ant-process-0002' } });
const pretend = await variant('pretend', { pretend: true, settings: { env: { ANTHROPIC_BASE_URL: urlA, ANTHROPIC_API_KEY: 'sk-ant-carried-0001' } },
  env: { ANTHROPIC_BASE_URL: urlB, ANTHROPIC_API_KEY: 'sk-ant-process-0002' } });
const keyJs = join(root, 'key.mjs');
writeFileSync(keyJs, "console.log('sk-ant-helper-0003');\n");
const helper = await variant('helper', { pretend: true, settings: { apiKeyHelper: `"${fwd(process.execPath)}" "${fwd(keyJs)}"` }, env: { ANTHROPIC_BASE_URL: urlB } });
const none = await variant('none', { pretend: true, settings: {}, env: { ANTHROPIC_BASE_URL: urlB, ANTHROPIC_API_KEY: 'sk-ant-process-0002' } });
const jsonc = await variant('jsonc', { pretend: false,
  settingsText: `// a comment\n${JSON.stringify({ env: { ANTHROPIC_BASE_URL: urlA, ANTHROPIC_API_KEY: 'sk-ant-jsonc-0004' } })}\n`,
  env: { ANTHROPIC_BASE_URL: urlB, ANTHROPIC_API_KEY: 'sk-ant-process-0002' } });
apiA.close(); apiB.close();

const first = (v) => v.requests[0] || {};
const out = {
  at: new Date().toISOString(), bin, cliVersion: execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(), pluginInstalled, pluginNote,
  normal: { marks: normal.marks, init: normal.init, api: first(normal).api, toolCalled: normal.requests.some((r) => r.toolResults > 0), userMd: normal.requests.some((r) => r.userMd) },
  settingsEnvWins: first(normal).api === 'A',
  pretend: {
    noMarker: MARKS.every((m) => !pretend.marks[m]), marks: pretend.marks,
    toolCalled: pretend.requests.some((r) => r.toolResults > 0),
    carriedKeyReachedApi: first(pretend).key === 'sk-ant-carried-0001',
    apiKeySource: pretend.init && pretend.init.apiKeySource,
    noUserSkill: !has(pretend.init && pretend.init.skills, 'user-skill-proof') && !has(pretend.init && pretend.init.slash, 'user-skill-proof'),
    noPluginSkill: !has(pretend.init && pretend.init.skills, 'plugin-skill-proof') && !has(pretend.init && pretend.init.slash, 'plugin-skill-proof'),
    noUserAgent: !has(pretend.init && pretend.init.agents, 'user-agent-proof'),
    noPlugin: !has(pretend.init && pretend.init.plugins, 'proof-plugin'),
    projectSkill: has(pretend.init && pretend.init.skills, 'project-skill-proof') || has(pretend.init && pretend.init.slash, 'project-skill-proof'),
    projectAgent: has(pretend.init && pretend.init.agents, 'project-agent-proof'),
    worcaSkill: has(pretend.init && pretend.init.skills, 'worca-set-skill-proof') || has(pretend.init && pretend.init.slash, 'worca-set-skill-proof'),
    userMemoryLoaded: pretend.requests.some((r) => r.userMd),
    projectMemoryLoaded: pretend.requests.some((r) => r.projectMd),
    error: pretend.error,
  },
  helper: { keyReachedApi: first(helper).key === 'sk-ant-helper-0003', api: first(helper).api, apiKeySource: helper.init && helper.init.apiKeySource, error: helper.error },
  none: { processKeyUsed: first(none).key === 'sk-ant-process-0002', noMarker: MARKS.every((m) => !none.marks[m]), error: none.error },
  cliReadsJsonc: first(jsonc).api === 'A',
};
writeFileSync(join(import.meta.dirname, 'plugins-off-real-cli.json'), `${JSON.stringify({ ...out, raw: { normal, pretend, helper, none, jsonc } }, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const p = out.pretend;
process.exit(p.noMarker && p.toolCalled && p.carriedKeyReachedApi && p.noUserSkill && p.noUserAgent && (p.noPlugin || !pluginInstalled) && p.projectSkill && p.worcaSkill
  && out.helper.keyReachedApi && out.none.processKeyUsed ? 0 : 1);
```

- [ ] **Step 2: Run the free proof**

Run (PowerShell, from the worktree root):
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests3b; node .superpowers\sdd\proofs\plugins-off-real-cli.mjs (Get-Command claude).Source
```
Expected: exit 0, and in the summary:
- `normal.marks` mostly `true` (the control: the hooks load in a normal run; a marker that is `false` here too, for example `user-prompt` if `-p` runs no UserPromptSubmit hook, proves nothing either way and is recorded as such);
- `pretend.noMarker: true`, `pretend.toolCalled: true` (the PreToolUse hook would have had its chance);
- `pretend.carriedKeyReachedApi: true` (the carried env), `helper.keyReachedApi: true` with `helper.api: "B"` (the helper from Worca's settings file), `none.processKeyUsed: true`;
- `pretend.noUserSkill`, `noPluginSkill`, `noUserAgent`, `noPlugin` all `true`; `projectSkill`, `projectAgent`, `worcaSkill` all `true`.

If the CLI refuses the key or the base URL, read `plugins-off-real-cli.json` and the CLI's stderr; the fake API may need one more endpoint (answer it as `test/helpers/fake-model-upstream.mjs` does). If `claude plugin` subcommands do not exist in this CLI (`pluginInstalled: false`), seed the plugin by hand as the CLI's own layout under `cfg/plugins/` shows after a `claude plugin install` on another machine, or record "plugin part not proved: no `claude plugin` command" and go on. If the `init` event lists skills under another key, change only the `listed(...)` names in the script. Make every fix in the script only.

**Stop rule:** if `pretend.noMarker` is `false`, or a personal skill, agent or plugin is listed in the Pretend variant, stop and report to the controller with `plugins-off-real-cli.json`: D70's mechanism does not hold on this CLI, and Tasks 11–14 must not claim it.

- [ ] **Step 3: Record it.** Create `.superpowers/sdd/real-call-proof-3b.md` with a "Free proof (real CLI, fake model)" section: the CLI version, the JSON summary, and one line per claim:
  1. A user SessionStart, UserPromptSubmit and PreToolUse hook does not fire in a Pretend try (and does in a normal run, where it did).
  2. A plugin's hook does not fire, and its skill is not listed.
  3. The project's own hook does not fire after the strip; its skill and agent are listed; its CLAUDE.md reaches the model (`projectMemoryLoaded`).
  4. The person's own skill and agent are not listed.
  5. Worca's `--plugin-dir` skill is listed.
  6. The carried env key and a carried `apiKeyHelper` reach the API; with no sign-in in the user settings, the process env's key is used.
  7. Facts, no claim: `settingsEnvWins` (whether the CLI lets user settings env win over the process env in a normal run; D71 puts the model env over the carried env either way), `userMemoryLoaded` (whether `~/.claude/CLAUDE.md` loads under `project,local`), `cliReadsJsonc`.

- [ ] **Step 4: The JSONC rule (D71)**

If `cliReadsJsonc` is `true`, the CLI reads a `settings.json` with comments, so a sign-in kept in one works in a normal run and must be carried too. Then, in `src/core/engines/claude-sign-in.mjs`, when `JSON.parse` fails, try once more on the text with comments and trailing commas removed by a scanner that skips string contents:
```js
/** `//` and block comments and trailing commas removed, outside strings (the CLI's JSONC). Pure. */
export function stripJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {   // a string, escapes kept
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1; i += 1; }
    else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
```
and in `readUserSignIn`: `try { s = JSON.parse(text); } catch { try { s = JSON.parse(stripJsonc(text)); } catch { return none('unreadable'); } }`; read `readUserSafety`'s file the same way (D81). Add to `test/claude-sign-in.test.mjs`:
```js
test('a settings file with comments and trailing commas is read, as the CLI reads it (Task 4 Step 4)', () => {
  const s = readUserSignIn({ env: {}, home: home('// mine\n{ "env": { "ANTHROPIC_API_KEY": "sk-ant-1", /* x */ }, "apiKeyHelper": "a // b", }\n') });
  assert.deepEqual(s, { state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'a // b' } });
});
```
Change the "a file Worca cannot read or parse" test's first line to a text that is not JSONC either (`'{ not json'` stays unreadable). Run `node tools/test.mjs test/claude-sign-in.test.mjs test/workflow-test-plugins-off.test.mjs`, expect PASS, and commit:
```bash
git add src/core/engines/claude-sign-in.mjs test/claude-sign-in.test.mjs
git commit -m "Workflow tests 3b: read a user settings file with comments, as the CLI does, for the sign-in and the guards (Task 4 proof)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If `false`, change nothing and note "the CLI does not read comments: an unparsable file carries nothing".

- [ ] **Step 5: Commit the free proof**

```bash
git add .superpowers/sdd/proofs/plugins-off-real-cli.mjs .superpowers/sdd/proofs/plugins-off-real-cli.json .superpowers/sdd/real-call-proof-3b.md
git commit -m "Workflow tests 3b: free proof with the real CLI (plugins, skills, agents and hooks off; the sign-in carried over)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(If `.superpowers/` is git-ignored in this worktree, skip the commit and say so in the report: the files stay on disk for the reviewer.)

- [ ] **Step 6: The paid proof. CONTROLLER ONLY, after the user's explicit OK for this run, capped at $3.**

Do not dispatch this step to an implementer. Do it in this order and stop at the first surprise.

1. **Who pays.**
   - Run `claude auth status`. It must show the person's own Claude sign-in (`authMethod: claude.ai`, `apiProvider: firstParty`).
   - Check what a Pretend try would carry from the person's real user settings, printing key names only:
     `node -e "import('./src/core/engines/claude-sign-in.mjs').then((m)=>{const s=m.readUserSignIn();console.log(s.state, Object.keys(s.env), Object.keys(s.settings))})"`.
     If it lists any key that routes elsewhere or signs in another way (`CLAUDE_CODE_USE_*`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_*`, `CLOUD_ML_REGION`, `apiKeyHelper`), **stop** and tell the user which account would pay; go on only on their word.
   - Check Worca's own routing without printing values (`node -e "const s=require(require('os').homedir()+'/.worca-cc/settings.json');console.log(Object.keys(s.models||{}).filter(k=>s.models[k]&&s.models[k].env))"`). The proof never reads that file: start the server with `HOME` and `USERPROFILE` pointed at a fresh empty folder (Worca's settings root), delete every `ANTHROPIC_*`, `CLAUDE_*`, `CLOUD_ML_*`, `VERTEX_*` and `WORCA_MOCK` variable from its env, and then set `CLAUDE_CONFIG_DIR` to the real `C:\Users\BRT1BG\.claude` (the CLI's sign-in; read only).
   - Tell the user, in one line, which account pays: the Claude sign-in's plan, not Vertex.
2. **Money guards.** The sandbox Worca settings are `{"totalCostLimitUsd": 3, "pipelineCostLimitUsd": 1, "debugSpawnEnabled": true}`. Every test's cost cap is $1. The agent's model is `claude-haiku-5-5`. Reuse Part 2's logging shim (`…\scratchpad\proof\shim\claude.exe`, see `C:\Users\BRT1BG\worca-cc\worca-cc-tests2\.superpowers\sdd\real-call-proof.md` "Setup"): it refuses a non-Haiku model and honours a `STOP` file.
3. **The project.** In the scratchpad, make a git project `proof3b` with one commit holding:
   - `.claude/settings.json`: `{ "hooks": { "SessionStart": [<a marker hook writing <scratchpad>\proof3b-marks\project-session>], "PreToolUse": [{ "matcher": "*", "hooks": [<a marker hook writing …\project-pretool>] }] } }` (forward slashes in the command);
   - `CLAUDE.md`: "When you write proof.txt, its only line is PROOF-PROJECT-WORD-5521.";
   - `README.md`.
   Register it as a project. Record `repoSnapshot(proof3b)` (run the helper with `node -e`).
4. **The workflow.** A user agent `proofPlugins` (producer, domain coding), prompt: "Run `echo hi` with the Bash tool. Then write the file proof.txt as the project's instructions say. Do nothing else." The workflow is task → proofPlugins (model `claude-haiku-5-5`) → end. An example on `proof3b` with no setup and the check "A file with this name is added or changed: proof.txt".
5. **Pretend:** **Try it once now** (one try, Pretend). Record in `real-call-proof-3b.md`:
   - the try is `passed` (the real sign-in works under `--setting-sources project,local`; the debug spawn line shows the flag);
   - `proof.txt` in the try's diff holds `PROOF-PROJECT-WORD-5521` (the project's CLAUDE.md stays on);
   - no `project-session` or `project-pretool` marker (the project's hooks are off), though the agent ran Bash;
   - the init event's plugin list holds only Worca's set plugins, if any (none of the person's; record the count of the person's plugins from `claude plugin list` for comparison, not their names);
   - the cost.
6. **The control, Real:** save the workflow as version 1, then **Test a version** v1 against the draft with **Real** connectors and 1 try per example (2 tries). Record: both markers present for each try (Real keeps the project's hooks), and the cost. The total of both steps must stay under $3.
7. Record that `C:\Users\BRT1BG\.claude` was only read (its folder's newest file time before and after) and that `repoSnapshot(proof3b)` is unchanged.
8. **Stop rule.** If a non-Haiku call was attempted, a marker shows in the Pretend try, or the spending meter passes $3, stop. Write down what happened and tell the user before anything else. Do not retry.

---

## Task 5: Security review of the sign-in and guards carry-over (controller dispatches)

The brief (§7) asks for a security review of the carry-over: it touches credential handling.

**Files:**
- Modify: only what a finding needs, each with a test.
- Modify: `.superpowers/sdd/real-call-proof-3b.md` (a "Security review" section).

- [ ] **Step 1: Dispatch the review.** Invoke the `security-review` skill on the branch diff since the base in `.superpowers\sdd\base-3b.txt` (or dispatch a general-purpose reviewer with this list). The reviewer reads `src/core/engines/claude-sign-in.mjs` (`readUserSignIn`, `readUserSafety`), `src/core/engines/claude.mjs` (`signInCarry`, `secretValuesOf`, `safetySettingsOf`, `buildSettingsPayload`, `buildSettingsArgs`, `planClaudeInvocation`, `runClaudeProcess`), `src/core/engines/spawn.mjs` (`composeSpawnEnv`), `src/core/workflow-tests/project-claude-settings.mjs`, the harness's `_pluginsOffInCheckout`, and Task 4's two proofs. Questions, each answered with file:line evidence:
  1. Do only `isSignInEnvKey` env entries and the three helper strings ever leave the person's settings file? Is there any path where hooks, permissions, plugins or other env are copied?
  2. Can a carried value reach the command line, a log (the spawn-debug line, the run stream, `live-log.ndjson`, the audit), run state (`run.json`, the DB, `results.json`), an error message or the UI? Is every secret-looking value redacted?
  3. The settings file: its folder is `mkdtemp` under the OS temp folder (on Windows: the user's `%TEMP%` ACL); is it removed on every end (`cleanupStaged`), including a spawn that fails to start? Can the agent read it while it runs, and is that more than a normal run exposes (where the helper sits in `~/.claude/settings.json`)?
  4. Precedence: the carried env is under the model env and over the ambient and run env. Can a model profile's routing be bypassed, or the person's key be sent to a model profile's endpoint that a normal run would not send it to?
  5. The broker and agent-user cases carry nothing: is that enforced on every spawn path (direct and through the broker, `runViaBroker`)?
  6. The carried env reaches the agent's Bash children (Claude Code passes its env on), as the person's settings env does in a normal run. The outward guard (D56) does not strip sign-in keys (`AWS_*`, `ANTHROPIC_*`), because the CLI needs them. Accept or not? Compare with a normal run.
  7. `CLAUDE_CONFIG_DIR` from a model profile chooses which file is read: can a project or workflow author set it to make Worca read another user's file?
  8. The project settings strip: can a crafted checkout make Worca read or write outside it (links, junctions, `..`, a `.claude` that is a file)?
  9. D85 (decided 2026-11-02): the project's own command-running keys (`apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper`) stay in Pretend. Re-check: is there a reason to remove them after all (for example one that sends something a Pretend try promises not to)?
  10. The proofs: does anything copy, print or keep the person's `.credentials.json` or a sign-in value?
  11. D81, the person's own guards: is only `permissions.deny` and `sandbox` carried (never `allow` or `ask`)? Can their merge weaken Worca's own rules or the try guard's (order, deduplication, a `sandbox` object that turns something off that Worca relies on, a deny rule that blocks a tool Worca itself needs so a try fails in a way that looks like the workflow's)? Is carrying them with the broker on and into an agent user's spawn safe? Do they ever reach argv or a log?

- [ ] **Step 2: Fix each finding with a test.** For each finding the controller accepts as a defect: a failing test in the task's test file (`test/workflow-test-plugins-off.test.mjs`, `test/claude-sign-in.test.mjs` or `test/workflow-test-project-claude-settings.test.mjs`), the fix, the test passing. A finding the controller accepts as a stated limit goes into `real-call-proof-3b.md` and Task 15's changelog "limits" line.

- [ ] **Step 3: Record and commit.** Add the "Security review" section to `real-call-proof-3b.md`: the reviewer, each question's answer, the findings, the fixes (commit ids), the accepted limits. Then:

```bash
git add <the files the fixes touched> .superpowers/sdd/real-call-proof-3b.md
git commit -m "Workflow tests 3b: security review of the sign-in carry-over: <one-line summary of the fixes>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(With no finding to fix, commit only the record, or nothing when `.superpowers/` is ignored.)

---

## Task 6: The file-scope checks (Q10, D73)

**Files:**
- Modify: `src/shared/workflow-tests/checks.mjs` (`CHECK_KINDS` :6, `PROJECT_KINDS` :9, `CHECK_KIND_LABELS` :10-18, `normaliseCheck` :167-229, `checkLabel` :232-245, `runCheck` :259-283); new `SCOPE_KINDS`, `pathMatches`.
- Modify: `src/core/workflow-tests/result.mjs` (`projectChanges` :42-55 adds `touched`; `checkTry` :215-253 passes `changes` and keeps the scope checks' kind and parameters).
- Modify: `src/core/workflow-tests/store.mjs:77-80` (the refusal names the check).
- Test: `test/workflow-test-scope-checks.test.mjs`

**Interfaces:**
- Consumes: 3a's `projectChanges` rows (`{ status, path, from? }`) and `outcome.project` (`result.mjs` `projectOutcome`).
- Produces:
  - kinds `'under'` (`{ dirs: string[] }`, each ending in `/`), `'unchanged'` (`{ patterns: string[] }`), `'max-files'` (`{ max: number }`); `SCOPE_KINDS = ['under', 'unchanged', 'max-files']`, all in `PROJECT_KINDS`;
  - `pathMatches(pattern: string, path: string): boolean`;
  - `runCheck(check, { text, files, changes: { touched: string[], total: number } | null })`;
  - `projectChanges(...)` adds `touched: string[]` (every path, a rename's old one too, sorted, uncapped);
  - a scope check's result in the verdict: `{ id, label, met, value, kind, dirs | patterns | max }`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-scope-checks.test.mjs`:

```js
// test/workflow-test-scope-checks.test.mjs — workflow tests 3b, Task 6 (Q10, D73): "Changes only files under …", "Leaves these
// files unchanged" and "Changes at most N files", counted exactly from a try's change list.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { normaliseCheck, checkLabel, runCheck, pathMatches, CHECK_KINDS, CHECK_KIND_LABELS, PROJECT_KINDS, SCOPE_KINDS } from '../src/shared/workflow-tests/checks.mjs';
import { projectChanges, checkTry } from '../src/core/workflow-tests/result.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const dirs = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'worca-cc-wftscope-')); dirs.push(h); _resetForTests(); process.env.WORCA_HOME = h; });
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const check = (raw) => normaliseCheck(raw).check;
const changes = (touched, total = touched.length) => ({ touched, total });
const errorOf = (raw) => normaliseCheck(raw).error;

test('the kinds, their names, and that they need a project (board 33)', () => {
  assert.deepEqual(SCOPE_KINDS, ['under', 'unchanged', 'max-files']);
  for (const k of SCOPE_KINDS) { assert.ok(CHECK_KINDS.includes(k), k); assert.ok(PROJECT_KINDS.includes(k), k); }
  assert.deepEqual([CHECK_KIND_LABELS.under, CHECK_KIND_LABELS.unchanged, CHECK_KIND_LABELS['max-files']],
    ['Changes only files under …', 'Leaves these files unchanged', 'Changes at most N files']);
  assert.throws(() => store.createExample('wf_s', { name: 'x', request: 'r', checks: [{ kind: 'under', dirs: 'src/' }] }),
    /this check needs a project: pick one under Where it starts/);
  assert.throws(() => store.createExample('wf_s', { name: 'x', request: 'r', checks: [{ kind: 'command', cmd: 'npm test' }] }),
    /the command check needs a project: pick one under Where it starts/, '3a\'s sentence for the command check stays');
});

test('"Changes only files under": folders, cleaned; refused when empty, outside the project or a pattern', () => {
  assert.deepEqual(check({ kind: 'under', dirs: 'src/, test' }), { kind: 'under', dirs: ['src/', 'test/'] });
  assert.deepEqual(check({ kind: 'under', dirs: ['./src//', 'src', 'docs\\guide'] }), { kind: 'under', dirs: ['src/', 'docs/guide/'] });
  for (const bad of ['', ' , ']) assert.equal(errorOf({ kind: 'under', dirs: bad }), 'name at least one folder', JSON.stringify(bad));
  for (const bad of ['/etc', 'C:/x', '../up', 'a/../b', 'src/*', '.', 'a?b']) assert.equal(errorOf({ kind: 'under', dirs: bad }), 'give folders inside the project, such as src/', bad);
  assert.equal(errorOf({ kind: 'under', dirs: Array.from({ length: 21 }, (_, i) => `d${i}`) }), 'at most 20 folders');
  assert.equal(checkLabel(check({ kind: 'under', dirs: 'src/, test/' })), 'Changes only files under src/ and test/');
  assert.equal(checkLabel(check({ kind: 'under', dirs: 'a, b, c' })), 'Changes only files under a/, b/ and c/');
});

test('"Leaves these files unchanged": names and patterns, cleaned; refused when empty or outside the project', () => {
  assert.deepEqual(check({ kind: 'unchanged', patterns: 'test/fixtures/**, package-lock.json' }), { kind: 'unchanged', patterns: ['test/fixtures/**', 'package-lock.json'] });
  assert.deepEqual(check({ kind: 'unchanged', patterns: ['./a.txt', 'a.txt', 'b\\c'] }), { kind: 'unchanged', patterns: ['a.txt', 'b/c'] });
  assert.equal(errorOf({ kind: 'unchanged', patterns: '' }), 'name at least one file or pattern');
  for (const bad of ['/abs', 'C:/x', 'a/../b']) assert.equal(errorOf({ kind: 'unchanged', patterns: bad }), 'give files or patterns inside the project, such as test/**', bad);
  assert.equal(errorOf({ kind: 'unchanged', patterns: Array.from({ length: 21 }, (_, i) => `f${i}`) }), 'at most 20 files or patterns');
  assert.equal(checkLabel(check({ kind: 'unchanged', patterns: 'test/fixtures/**' })), 'Leaves these files unchanged: test/fixtures/**');
  assert.equal(checkLabel(check({ kind: 'unchanged', patterns: 'a, b' })), 'Leaves these files unchanged: a, b');
});

test('"Changes at most N files": a whole number from 0 to 10000', () => {
  assert.deepEqual(check({ kind: 'max-files', max: '6' }), { kind: 'max-files', max: 6 });
  assert.deepEqual(check({ kind: 'max-files', max: 0 }), { kind: 'max-files', max: 0 });
  for (const bad of ['', -1, 1.5, '6 files', 10001, null, undefined]) {
    assert.equal(errorOf({ kind: 'max-files', max: bad }), 'the most files must be a whole number from 0 to 10000', String(bad));
  }
  assert.deepEqual([checkLabel(check({ kind: 'max-files', max: 6 })), checkLabel(check({ kind: 'max-files', max: 1 }))], ['Changes at most 6 files', 'Changes at most 1 file']);
});

test('patterns: ** across folders, * and ? inside a name, a folder with /, a name at any depth; case counts', () => {
  const yes = [['test/**', 'test/a.js'], ['test/**', 'test/x/y/z.js'], ['test/fixtures/', 'test/fixtures/a.json'], ['*.lock', 'yarn.lock'],
    ['package-lock.json', 'package-lock.json'], ['package-lock.json', 'apps/web/package-lock.json'], ['src/**/*.test.mjs', 'src/a.test.mjs'],
    ['src/**/*.test.mjs', 'src/x/y/a.test.mjs'], ['docs/?.md', 'docs/a.md'], ['**', 'any/thing']];
  const no = [['test/**', 'test'], ['test/**', 'tests/a.js'], ['*.lock', 'yarn.lock.bak'], ['src/*.mjs', 'src/x/a.mjs'], ['docs/?.md', 'docs/ab.md'],
    ['README.md', 'readme.md'], ['test/fixtures/', 'test/fixtures-old/a'], ['a/b', 'x/a/b']];
  for (const [p, x] of yes) assert.equal(pathMatches(p, x), true, `${p} ~ ${x}`);
  for (const [p, x] of no) assert.equal(pathMatches(p, x), false, `${p} !~ ${x}`);
  const t0 = Date.now();
  assert.equal(pathMatches(`${'*a'.repeat(40)}b`, 'a'.repeat(200)), false);
  assert.equal(pathMatches(`${'**/'.repeat(20)}x`, `${'d/'.repeat(100)}y`), false);
  assert.ok(Date.now() - t0 < 500, 'no runaway backtracking');
});

test('the values: Met, the first file that broke it, the count', () => {
  const under = check({ kind: 'under', dirs: 'src/, test/' });
  assert.deepEqual(runCheck(under, { changes: changes(['src/a.mjs', 'test/a.test.mjs']) }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(under, { changes: changes(['docs/x.md', 'src/a.mjs', 'z.txt']) }), { met: false, value: 'Changed docs/x.md and 1 more' });
  assert.deepEqual(runCheck(under, { changes: changes([]) }), { met: true, value: 'Met' }, 'nothing changed is inside every folder');
  const keep = check({ kind: 'unchanged', patterns: 'test/fixtures/**' });
  assert.deepEqual(runCheck(keep, { changes: changes(['src/a.mjs']) }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(keep, { changes: changes(['test/fixtures/a.json']) }), { met: false, value: 'Changed test/fixtures/a.json' });
  const most = check({ kind: 'max-files', max: 3 });
  assert.deepEqual(runCheck(most, { changes: changes(['a', 'b', 'c']) }), { met: true, value: '3 files' });
  assert.deepEqual(runCheck(most, { changes: changes(['a', 'b', 'c', 'd']) }), { met: false, value: '4 files' });
  assert.deepEqual(runCheck(check({ kind: 'max-files', max: 0 }), { changes: changes([], 0) }), { met: true, value: 'No files' });
  assert.deepEqual(runCheck(most, { changes: changes(['a'], 1) }), { met: true, value: '1 file' });
  assert.deepEqual(runCheck(under, {}), { met: false, value: 'Not run: the example has no project' });
  const long = `src2/${'x'.repeat(150)}.mjs`;
  assert.equal(runCheck(under, { changes: changes([long]) }).value, `Changed ${long.slice(0, 99)}…`);
});

test('renames count both paths for the folder and unchanged checks, and once for the count; a copy only its new path', () => {
  const c = projectChanges({ summary: {}, newFiles: [{ path: 'src/copy.mjs', status: 'C' }],
    changedFiles: [{ path: 'src/new.mjs', status: 'R', from: 'lib/old.mjs' }, { path: 'src/gone.mjs', status: 'D' }] });
  assert.deepEqual(c.touched, ['lib/old.mjs', 'src/copy.mjs', 'src/gone.mjs', 'src/new.mjs']);
  assert.equal(c.total, 3);
  assert.equal(runCheck(check({ kind: 'under', dirs: 'src/' }), { changes: c }).met, false, 'moved out of lib/: lib/ changed');
  assert.equal(runCheck(check({ kind: 'unchanged', patterns: 'lib/**' }), { changes: c }).met, false);
  assert.deepEqual(runCheck(check({ kind: 'max-files', max: 3 }), { changes: c }), { met: true, value: '3 files' });
});

test('checkTry: scope checks read the try\'s change list, whatever the try did, and carry their kind for the side by side', async () => {
  const ex = { basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'under', dirs: 'src/' }) }, { id: 'c_2', ...check({ kind: 'unchanged', patterns: 'test/**' }) },
    { id: 'c_3', ...check({ kind: 'max-files', max: 1 }) }] };
  const outcome = { pipelineId: null, facts: { status: 'error', costUsd: 0, help: [] }, text: null, files: [],
    project: { touched: ['src/a.mjs', 'test/b.test.mjs'], total: 2, checkoutDir: null } };
  const v = await checkTry(ex, outcome);
  assert.deepEqual(v.checks.map((c) => [c.id, c.met, c.value, c.kind]), [['c_1', false, 'Changed test/b.test.mjs', 'under'],
    ['c_2', false, 'Changed test/b.test.mjs', 'unchanged'], ['c_3', false, '2 files', 'max-files']]);
  assert.deepEqual([v.checks[0].dirs, v.checks[1].patterns, v.checks[2].max], [['src/'], ['test/**'], 1]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-scope-checks.test.mjs`
Expected: FAIL: `pathMatches` and `SCOPE_KINDS` are not exported.

- [ ] **Step 3: The kinds (checks.mjs).** Replace `:6-9` and add the labels:

```js
export const CHECK_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'file', 'script', 'command', 'under', 'unchanged', 'max-files']);
/** The kinds that read the main result's text (D25). */
export const TEXT_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions']);
/** 3b (Q10, D73): the pure project checks; they read the try's change list. */
export const SCOPE_KINDS = Object.freeze(['under', 'unchanged', 'max-files']);
export const PROJECT_KINDS = Object.freeze(['command', ...SCOPE_KINDS]);   // 3a D57, 3b D73: only on an example with a project
```
In `CHECK_KIND_LABELS`, after `command: 'The command passes',` add:
```js
  under: 'Changes only files under …',
  unchanged: 'Leaves these files unchanged',
  'max-files': 'Changes at most N files',
```
Below `CMD_MAX` (:22), add:
```js
const PATHS_MAX = 20;
export const MAX_FILES_LIMIT = 10_000;
const VALUE_PATH_MAX = 100;
/** A comma-separated text or an array, as trimmed non-empty strings. */
const listOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x ?? '').trim()).filter(Boolean);
/** A path a person typed, inside the project: forward slashes, no `./`, no repeated `/`; null when it leaves the project. */
function insidePath(raw) {
  const p = String(raw).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '');
  if (!p || p === '.' || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..') || p.length > TEXT_MAX) return null;
  return p;
}
```

- [ ] **Step 4: Normalise and label (checks.mjs).** In `normaliseCheck`, insert before the script part (`const key = typeof raw.key …`, :214):

```js
  if (kind === 'under') {
    const dirs = [];
    for (const raw1 of listOf(raw.dirs)) {
      const p = insidePath(raw1);
      if (!p || /[*?[\]]/.test(p)) return { check: null, error: 'give folders inside the project, such as src/' };
      const d = `${p.replace(/\/+$/, '')}/`;
      if (d === '/') return { check: null, error: 'give folders inside the project, such as src/' };
      if (!dirs.includes(d)) dirs.push(d);
    }
    if (!dirs.length) return { check: null, error: 'name at least one folder' };
    if (dirs.length > PATHS_MAX) return { check: null, error: `at most ${PATHS_MAX} folders` };
    return done({ dirs });
  }
  if (kind === 'unchanged') {
    const patterns = [];
    for (const raw1 of listOf(raw.patterns)) {
      const p = insidePath(raw1);
      if (!p) return { check: null, error: 'give files or patterns inside the project, such as test/**' };
      if (!patterns.includes(p)) patterns.push(p);
    }
    if (!patterns.length) return { check: null, error: 'name at least one file or pattern' };
    if (patterns.length > PATHS_MAX) return { check: null, error: `at most ${PATHS_MAX} files or patterns` };
    return done({ patterns });
  }
  if (kind === 'max-files') {
    const n = raw.max === '' || raw.max == null || (typeof raw.max === 'string' && !/^\s*\d+\s*$/.test(raw.max)) ? Number.NaN : Number(raw.max);
    if (!Number.isInteger(n) || n < 0 || n > MAX_FILES_LIMIT) return { check: null, error: `the most files must be a whole number from 0 to ${MAX_FILES_LIMIT}` };
    return done({ max: n });
  }
```
In `checkLabel`, after the `command` line add:
```js
  if (c.kind === 'under') return `Changes only files under ${andList(c.dirs)}`;
  if (c.kind === 'unchanged') return `Leaves these files unchanged: ${c.patterns.join(', ')}`;
  if (c.kind === 'max-files') return `Changes at most ${c.max} ${c.max === 1 ? 'file' : 'files'}`;
```

- [ ] **Step 5: The matcher and the values (checks.mjs).** Below `fileMatches` (:250), add:

```js
/** One name against one pattern segment: `*` any characters, `?` one. Greedy with one backtrack point, no regex (a try's
 *  paths and a person's patterns must never be able to stall the server: final review I1's lesson). */
function nameMatches(p, s) {
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && (p[i] === '?' || p[i] === s[j])) { i += 1; j += 1; }
    else if (i < p.length && p[i] === '*') { star = i; i += 1; mark = j; }
    else if (star !== -1) { i = star + 1; mark += 1; j = mark; }
    else return false;
  }
  while (i < p.length && p[i] === '*') i += 1;
  return i === p.length;
}

/**
 * D73: does a changed `path` (relative, forward slashes) match a person's `pattern`? `**` = any folders (also none), `*` and
 * `?` inside one name, a trailing `/` = everything under that folder, `dir/**` = everything inside `dir` (not a file named
 * `dir`), a pattern with no `/` = that name at any depth (as the file check and .gitignore). Case-sensitive, as git is.
 * Segment by segment over a set of positions: linear in the path for a fixed pattern.
 */
export function pathMatches(pattern, path) {
  let pat = String(pattern || '');
  if (pat.endsWith('/')) pat = `${pat}**`;
  if (!pat.includes('/')) pat = `**/${pat}`;
  const ps = pat.split('/');
  const xs = String(path || '').split('/');
  const n = ps.length;
  if (n > 1 && ps[n - 1] === '**' && ps[n - 2] !== '**' && xs.length < n) return false;   // `dir/**` needs something inside dir
  const closure = (set) => {
    const out = new Set();
    const stack = [...set];
    while (stack.length) {
      const i = stack.pop();
      if (out.has(i)) continue;
      out.add(i);
      if (i < n && ps[i] === '**') stack.push(i + 1);
    }
    return out;
  };
  let cur = closure([0]);
  for (const x of xs) {
    const next = new Set();
    for (const i of cur) {
      if (i >= n) continue;
      if (ps[i] === '**') next.add(i);
      else if (nameMatches(ps[i], x)) next.add(i + 1);
    }
    cur = closure(next);
    if (!cur.size) return false;
  }
  return cur.has(n);
}

const clipPath = (p) => (p.length > VALUE_PATH_MAX ? `${p.slice(0, VALUE_PATH_MAX - 1)}…` : p);
const changedValue = (bad) => `Changed ${clipPath(bad[0])}${bad.length > 1 ? ` and ${bad.length - 1} more` : ''}`;
const filesValue = (n) => (n === 0 ? 'No files' : n === 1 ? '1 file' : `${n} files`);
```
In `runCheck`, change the signature to `export function runCheck(check, { text = null, files = [], changes = null } = {})`, update its doc comment ("`changes` (3b D73): the try's change list, `{ touched, total }`, null without a project"), and add before the final `throw`:
```js
  if (SCOPE_KINDS.includes(check.kind)) {
    if (!changes || !Array.isArray(changes.touched)) return { met: false, value: 'Not run: the example has no project' };
    if (check.kind === 'max-files') {
      const n = Number(changes.total || 0);
      return { met: n <= check.max, value: filesValue(n) };
    }
    const bad = check.kind === 'under'
      ? changes.touched.filter((p) => !check.dirs.some((d) => p.startsWith(d)))
      : changes.touched.filter((p) => check.patterns.some((pat) => pathMatches(pat, p)));
    return bad.length ? { met: false, value: changedValue(bad) } : { met: true, value: 'Met' };
  }
```

- [ ] **Step 6: The change list and checkTry (result.mjs).** In `projectChanges` (:42-55), add `touched` to the returned object, right after `paths`:

```js
    // 3b (D73): every path the try touched, a rename's old path too (a copy's source is unchanged), for the scope checks.
    touched: [...new Set(rows.flatMap((f) => (f.from && f.status === 'renamed' ? [f.from, f.path] : [f.path])))].sort(),
```
In `checkTry`'s first loop, replace the two lines that run a pure check:
```js
    const changes = outcome.project ? { touched: Array.isArray(outcome.project.touched) ? outcome.project.touched : [], total: Number(outcome.project.total || 0) } : null;
    const r = runCheck(check, { text, files: outcome.files, changes });
    const scope = SCOPE_KINDS.includes(check.kind)
      ? { kind: check.kind, ...(check.kind === 'under' ? { dirs: check.dirs } : check.kind === 'unchanged' ? { patterns: check.patterns } : { max: check.max }) } : {};
    results[i] = { id: check.id, label, met: r.met, value: r.value, ...scope };
```
and import `SCOPE_KINDS` from `../../shared/workflow-tests/checks.mjs`. (The scope fields travel with the result so the side by side can set folders and patterns in code, as Round 2 M5 did for the command.)

- [ ] **Step 7: The refusal (store.mjs:77-80).** Replace:

```js
      if (raw && PROJECT_KINDS.includes(raw.kind) && !hasProject) {   // 3a D57, 3b D73: it reads or runs in the copy of the project
        errors.push(raw.kind === 'command' ? 'the command check needs a project: pick one under Where it starts'
          : 'this check needs a project: pick one under Where it starts');
        break;
      }
```

- [ ] **Step 8: Run the tests**

Run: `node tools/test.mjs test/workflow-test-scope-checks.test.mjs test/workflow-test-checks.test.mjs test/workflow-test-project-checks.test.mjs test/workflow-test-project-store.test.mjs test/workflow-test-store.test.mjs`
Expected: PASS. If `test/workflow-test-project-checks.test.mjs` deep-compares `projectChanges`' whole answer, or `test/workflow-test-checks.test.mjs` pins `CHECK_KINDS`, add `touched` / the three kinds to their expected values (a pinned list grows; nothing else changes).

- [ ] **Step 9: Commit**

```bash
git add src/shared/workflow-tests/checks.mjs src/core/workflow-tests/result.mjs src/core/workflow-tests/store.mjs test/workflow-test-scope-checks.test.mjs
git commit -m "Workflow tests 3b: Changes only files under, Leaves these files unchanged, Changes at most N files (Q10, D73)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Add the two older test files if Step 8 changed them.)

---

## Task 7: Reading test names from a command's output (D74)

**Files:**
- Create: `src/core/workflow-tests/test-output.mjs`
- Test: `test/workflow-test-test-output.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createTestOutputParser(): { line(text: string): void, result(): TestOutput }`;
  - `parseTestOutput(text: string): TestOutput`;
  - `TestOutput = { format: 'tap'|'node-spec'|'pytest'|'jest'|'vitest'|null, pass: string[], fail: string[], skip: string[], passListed: boolean, counts: { passed, failed, skipped } | null, truncated: boolean }` (names sorted);
  - `TEST_FORMATS`, `MAX_TESTS = 20000`, `NAME_MAX = 300`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-test-output.test.mjs`:

```js
// test/workflow-test-test-output.test.mjs — workflow tests 3b, Task 7 (D74): the test names in a command's output. The fixtures
// are each tool's own output shape (Step 5 checks them against the real tools on this laptop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestOutput, createTestOutputParser, TEST_FORMATS, MAX_TESTS } from '../src/core/workflow-tests/test-output.mjs';

const ROUNDS = 'rounds three lines of 0.125 to 0.38';

const TAP = `TAP version 13
# Subtest: invoice totals
    # Subtest: ${ROUNDS}
    not ok 1 - ${ROUNDS}
      ---
      duration_ms: 1.2
      location: '/p/test/billing/invoice-totals.test.mjs:5:3'
      failureType: 'testCodeFailure'
      error: 'Expected values to be strictly equal'
      ok: false
      ...
    # Subtest: adds lines
    ok 2 - adds lines
      ---
      duration_ms: 0.3
      ...
    1..2
not ok 1 - invoice totals
  ---
  duration_ms: 2.1
  type: 'suite'
  ...
# Subtest: parses dates
ok 2 - parses dates
  ---
  duration_ms: 0.2
  ...
# Subtest: later
ok 3 - later # SKIP not today
1..3
# tests 4
# suites 1
# pass 2
# fail 1
# cancelled 0
# skipped 1
# todo 0
# duration_ms 41.2
`;

const SPEC = `▶ invoice totals
  ✖ ${ROUNDS} (1.2ms)
  ✔ adds lines (0.3ms)
✖ invoice totals (2.1ms)
✔ parses dates (0.2ms)
﹣ later (0.1ms) # SKIP not today
ℹ tests 4
ℹ suites 1
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 41.2

✖ failing tests:

test at test/billing/invoice-totals.test.mjs:5:3
✖ ${ROUNDS} (1.2ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
`;

const PYTEST_RA = `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.3.2, pluggy-1.5.0
collected 3 items

tests/test_dates.py ..F                                                  [100%]

=================================== FAILURES ===================================
_____________________________ test_time_zone[utc] ______________________________
E   assert 1 == 2
==================================== PASSES ====================================
=========================== short test summary info ============================
PASSED tests/test_dates.py::test_parse
PASSED tests/test_dates.py::test_format[a b]
FAILED tests/test_dates.py::test_time_zone[utc] - assert 1 == 2
========================= 1 failed, 2 passed in 0.12s ==========================
`;
const PYTEST_DEFAULT = `============================= test session starts ==============================
collected 3 items

tests/test_dates.py ..F                                                  [100%]

=========================== short test summary info ============================
FAILED tests/test_dates.py::test_time_zone[utc] - assert 1 == 2
========================= 1 failed, 2 passed in 0.12s ==========================
`;

const JEST_DEFAULT = `PASS src/a.test.js
FAIL src/billing/totals.test.js
  ● invoice totals › ${ROUNDS}

    expect(received).toBe(expected) // Object.is equality

  ● Console

    console.log
      hi

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 212 passed, 213 total
Snapshots:   0 total
Time:        3.2 s
`;
const JEST_VERBOSE = `FAIL src/billing/totals.test.js
  invoice totals
    ✕ ${ROUNDS} (3 ms)
    ✓ adds lines (1 ms)
    ○ skipped later

  ● invoice totals › ${ROUNDS}

    expect(received).toBe(expected)

Tests:       1 failed, 1 skipped, 1 passed, 3 total
`;

const VITEST_DEFAULT = ` ✓ src/a.test.ts (3 tests) 5ms
 ❯ src/billing/totals.test.ts (2 tests | 1 failed) 7ms
   × invoice totals > ${ROUNDS} 3ms
     → expected 0.37 to be 0.38

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/billing/totals.test.ts > invoice totals > ${ROUNDS}
AssertionError: expected 0.37 to be 0.38

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 4 passed (5)
`;
const VITEST_VERBOSE = ` ✓ src/a.test.ts > parses dates 1ms
 × src/billing/totals.test.ts > invoice totals > ${ROUNDS} 3ms
 ✓ src/billing/totals.test.ts > invoice totals > adds lines 1ms
 ↓ src/billing/totals.test.ts > later

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 2 passed | 1 skipped (4)
`;

test('the formats', () => {
  assert.deepEqual(TEST_FORMATS, ['tap', 'node-spec', 'pytest', 'jest', 'vitest']);
});

test('TAP (node --test piped): nested names, the YAML blocks skipped, a SKIP, the counts', () => {
  assert.deepEqual(parseTestOutput(TAP), { format: 'tap', pass: ['invoice totals > adds lines', 'parses dates'], fail: [`invoice totals > ${ROUNDS}`],
    skip: ['later'], passListed: true, counts: { passed: 2, failed: 1, skipped: 1 }, truncated: false });
});

test('node:test\'s spec reporter gives the same names; its "failing tests" repeat is skipped', () => {
  const r = parseTestOutput(SPEC);
  assert.equal(r.format, 'node-spec');
  assert.deepEqual([r.pass, r.fail, r.skip, r.passListed, r.counts], [['invoice totals > adds lines', 'parses dates'], [`invoice totals > ${ROUNDS}`], ['later'], true,
    { passed: 2, failed: 1, skipped: 1 }]);
});

test('pytest: -rA names every test; the default names only the failures', () => {
  assert.deepEqual(parseTestOutput(PYTEST_RA), { format: 'pytest', pass: ['tests/test_dates.py::test_format[a b]', 'tests/test_dates.py::test_parse'],
    fail: ['tests/test_dates.py::test_time_zone[utc]'], skip: [], passListed: true, counts: { passed: 2, failed: 1, skipped: 0 }, truncated: false });
  const d = parseTestOutput(PYTEST_DEFAULT);
  assert.deepEqual([d.format, d.pass, d.fail, d.passListed, d.counts], ['pytest', [], ['tests/test_dates.py::test_time_zone[utc]'], false, { passed: 2, failed: 1, skipped: 0 }]);
  assert.deepEqual(parseTestOutput('tests/test_a.py::test_one PASSED  [ 50%]\ntests/test_a.py::test_two FAILED  [100%]\n').pass, ['tests/test_a.py::test_one'], '-v lines');
});

test('Jest: the default names the failures (with their file); verbose names every test', () => {
  const d = parseTestOutput(JEST_DEFAULT);
  assert.deepEqual([d.format, d.pass, d.fail, d.passListed, d.counts], ['jest', [], [`src/billing/totals.test.js › invoice totals › ${ROUNDS}`], false,
    { passed: 212, failed: 1, skipped: 0 }]);
  const v = parseTestOutput(JEST_VERBOSE);
  assert.deepEqual([v.pass, v.fail, v.skip, v.passListed], [['src/billing/totals.test.js › invoice totals › adds lines'],
    [`src/billing/totals.test.js › invoice totals › ${ROUNDS}`], ['src/billing/totals.test.js › invoice totals › later'], true]);
});

test('Vitest: the default names the failures; verbose names every test; both name a test the same way', () => {
  const d = parseTestOutput(VITEST_DEFAULT);
  assert.deepEqual([d.format, d.pass, d.fail, d.passListed, d.counts], ['vitest', [], [`src/billing/totals.test.ts > invoice totals > ${ROUNDS}`], false,
    { passed: 4, failed: 1, skipped: 0 }]);
  const v = parseTestOutput(VITEST_VERBOSE);
  assert.deepEqual([v.pass, v.fail, v.skip, v.passListed, v.counts], [['src/a.test.ts > parses dates', 'src/billing/totals.test.ts > invoice totals > adds lines'],
    [`src/billing/totals.test.ts > invoice totals > ${ROUNDS}`], ['src/billing/totals.test.ts > later'], true, { passed: 2, failed: 1, skipped: 1 }]);
});

test('anything else: no format; colours and Windows line ends are read; line by line equals all at once', () => {
  assert.deepEqual(parseTestOutput('Building…\nAll good.\n'), { format: null, pass: [], fail: [], skip: [], passListed: false, counts: null, truncated: false });
  assert.deepEqual(parseTestOutput(`\u001b[32mTAP version 13\u001b[0m\r\nok 1 - a\r\n\u001b[31mnot ok 2 - b\u001b[0m\r\n`).fail, ['b']);
  const p = createTestOutputParser();
  for (const l of TAP.split('\n')) p.line(l);
  assert.deepEqual(p.result(), parseTestOutput(TAP));
});

test('a huge run keeps at most MAX_TESTS names and says so; a long name is cut', () => {
  const p = createTestOutputParser();
  p.line('TAP version 13');
  for (let i = 0; i <= MAX_TESTS; i += 1) p.line(`ok ${i + 1} - t${i}`);
  const r = p.result();
  assert.equal(r.pass.length, MAX_TESTS);
  assert.equal(r.truncated, true);
  assert.equal(parseTestOutput(`TAP version 13\nok 1 - ${'x'.repeat(400)}\n`).pass[0].length, 300);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-test-output.test.mjs`
Expected: FAIL, "Cannot find module '…/test-output.mjs'".

- [ ] **Step 3: Write the parser.** Create `src/core/workflow-tests/test-output.mjs`:

```js
// src/core/workflow-tests/test-output.mjs — workflow tests 3b (D74): the test names in a command's output, for "The command
// passes" before and after the change. Pure and line by line: a command's output can be large, so only the names are kept.
// Reads TAP (node --test when piped on older Node, tape, mocha -R tap), node:test's spec reporter, pytest (-rA and -v name
// every test; the default names the failures), Jest (verbose names every test; the default the failures) and Vitest
// (likewise). Anything else: no format, and the command is compared by its exit code only. Best effort: no regex here can
// backtrack badly on a long line.

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
export const TEST_FORMATS = Object.freeze(['tap', 'node-spec', 'pytest', 'jest', 'vitest']);
export const MAX_TESTS = 20_000;
export const NAME_MAX = 300;
const PAREN_MS_RE = /\s+\(\d+(?:\.\d+)?\s?m?s\)\s*$/;   // " (1.2ms)", " (3 ms)"
const BARE_MS_RE = /\s+\d+(?:\.\d+)?m?s\s*$/;           // " 3ms" (Vitest)
const TEST_FILE_RE = /^\S+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const DETECT = [
  ['tap', (l) => /^\s*TAP version \d+/.test(l) || /^\s*(?:not ok|ok)\s+\d+\b/.test(l)],
  ['node-spec', (l) => /^\s*▶ \S/.test(l) || /^\s*[✔✖﹣] .*\(\d+(?:\.\d+)?m?s\)/.test(l)],
  ['pytest', (l) => /^=+ (?:test session starts|short test summary info) =+$/.test(l) || /::\S.*\s(?:PASSED|FAILED|ERROR)\b/.test(l)],
  ['jest', (l) => (/^\s*(?:PASS|FAIL)\s+\S+/.test(l) && !/ > /.test(l)) || /^Tests:\s+\d/.test(l)],
  ['vitest', (l) => /^\s*[✓❯×↓]\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?\b/.test(l) || /^\s*FAIL\s+\S+ > /.test(l) || /^\s*Test Files\s+\d/.test(l)],
];

/** "1 failed, 212 passed, 213 total" (Jest) or "1 failed | 4 passed (5)" (Vitest) or pytest's: the three counts. */
function countsOf(text) {
  const c = { passed: 0, failed: 0, skipped: 0 };
  for (const [, n, w] of String(text).matchAll(/(\d+) (passed|failed|skipped|todo|errors?|xfailed|xpassed)\b/g)) {
    const k = w === 'passed' || w === 'xpassed' ? 'passed' : w === 'failed' || w.startsWith('error') ? 'failed' : 'skipped';
    c[k] += Number(n);
  }
  return c;
}

export function createTestOutputParser() {
  const tests = new Map();   // name → 'pass' | 'fail' | 'skip'
  let format = null;
  let truncated = false;
  let counts = null;
  let everyTest = false;     // the output names passing tests too (passListed)
  const st = { stack: [], yaml: false, done: false, file: null, tree: false, verbose: false };
  const put = (name, state) => {
    const n = String(name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!n) return;
    if (tests.has(n)) { if (state === 'fail') tests.set(n, 'fail'); return; }   // a failure listed twice stays one failure
    if (tests.size >= MAX_TESTS) { truncated = true; return; }
    tests.set(n, state);
  };
  const H = {
    tap(l) {
      const t = l.trim();
      if (st.yaml) { if (t === '...') st.yaml = false; return; }
      if (t === '---') { st.yaml = true; return; }
      let m = /^(\s*)# Subtest: (.*)$/.exec(l);
      if (m) {
        const indent = m[1].length;
        while (st.stack.length && st.stack.at(-1).indent >= indent && st.stack.at(-1).open) st.stack.pop();
        const top = st.stack.at(-1);
        if (top && top.indent < indent) top.kids = true;
        st.stack.push({ indent, name: m[2].trim(), kids: false, open: true });
        return;
      }
      m = /^(\s*)(not ok|ok)(?=\s|$)(?:\s+\d+)?(?:\s+-)?\s*(.*)$/.exec(l);
      if (m) {
        const indent = m[1].length;
        let rest = m[3];
        let state = m[2] === 'ok' ? 'pass' : 'fail';
        const d = /\s*#\s*(?:SKIP|TODO)\b.*$/i.exec(rest);
        if (d) { rest = rest.slice(0, d.index); state = 'skip'; }
        const name = rest.trim();
        while (st.stack.length && st.stack.at(-1).indent > indent) st.stack.pop();
        const top = st.stack.at(-1);
        if (top && top.indent === indent && top.name === name) {
          st.stack.pop();
          if (top.kids) return;   // a suite's own line, not a test
        }
        const parent = st.stack.at(-1);
        if (parent && parent.indent < indent) parent.kids = true;
        everyTest = true;
        put([...st.stack.map((f) => f.name), name].join(' > '), state);
        return;
      }
      m = /^# (pass|fail|skipped|skip)\s+(\d+)\s*$/.exec(l);
      if (m) {
        counts = counts || { passed: 0, failed: 0, skipped: 0 };
        counts[m[1] === 'pass' ? 'passed' : m[1] === 'fail' ? 'failed' : 'skipped'] = Number(m[2]);
      }
    },
    'node-spec'(l) {
      if (st.done) return;
      if (/^\s*✖ failing tests:\s*$/.test(l)) { st.done = true; return; }
      const c = /^ℹ (pass|fail|skipped)\s+(\d+)\s*$/.exec(l);
      if (c) {
        counts = counts || { passed: 0, failed: 0, skipped: 0 };
        counts[c[1] === 'pass' ? 'passed' : c[1] === 'fail' ? 'failed' : 'skipped'] = Number(c[2]);
        return;
      }
      const m = /^(\s*)([▶✔✖﹣])\s+(.*)$/.exec(l);
      if (!m) return;
      const indent = m[1].length;
      let rest = m[3];
      let state = m[2] === '✔' ? 'pass' : m[2] === '✖' ? 'fail' : 'skip';
      const d = /\s*#\s*(?:SKIP|TODO)\b.*$/i.exec(rest);
      if (d) { rest = rest.slice(0, d.index); state = 'skip'; }
      const name = rest.replace(PAREN_MS_RE, '').trim();
      while (st.stack.length && st.stack.at(-1).indent > indent) st.stack.pop();
      const top = st.stack.at(-1);
      if (top && top.indent === indent && top.name === name) { st.stack.pop(); return; }   // a suite's closing line
      if (m[2] === '▶') { st.stack.push({ indent, name }); return; }
      everyTest = true;
      put([...st.stack.map((f) => f.name), name].join(' > '), state);
    },
    pytest(l) {
      let m = /^(PASSED|FAILED|ERROR|XPASS|XFAIL|SKIPPED) (.+?::.+?)(?: - .*)?$/.exec(l);
      if (!m) {
        const v = /^(\S.*?::\S.*?) (PASSED|FAILED|ERROR|XPASS|XFAIL|SKIPPED)(?:\s+\[\s*\d+%\])?\s*$/.exec(l);
        if (v) m = [v[0], v[2], v[1]];
      }
      if (m) {
        const state = m[1] === 'PASSED' || m[1] === 'XPASS' ? 'pass' : m[1] === 'FAILED' || m[1] === 'ERROR' ? 'fail' : 'skip';
        if (state === 'pass') everyTest = true;
        put(m[2].trim(), state);
        return;
      }
      const s = /^=+ (.+?) in [\d.]+s(?: \(.*\))? =+$/.exec(l);
      if (s && /\d+ (?:passed|failed|errors?|skipped)/.test(s[1])) counts = countsOf(s[1]);
    },
    jest(l) {
      let m = /^\s*(?:PASS|FAIL)\s+(\S.*?)(?:\s+\(\d+(?:\.\d+)?\s?m?s\))?\s*$/.exec(l);
      if (m && !/ > /.test(l) && !/^\s*(?:PASS|FAIL)\s+\d/.test(l)) { st.file = m[1]; st.stack = []; st.tree = true; return; }
      if (!l.trim()) { st.tree = false; return; }
      const c = /^Tests:\s+(.*)$/.exec(l);
      if (c) { counts = countsOf(c[1]); return; }
      m = /^\s*● (.+)$/.exec(l);
      if (m) {
        const name = m[1].trim();
        if (!st.verbose && !/^(?:Test suite failed to run|Console)\b/.test(name)) put(st.file ? `${st.file} › ${name}` : name, 'fail');
        return;
      }
      if (!st.tree || !st.file) return;
      m = /^(\s+)([✓✕○√×])\s+(.*)$/.exec(l);
      if (m) {
        st.verbose = true;
        const indent = m[1].length;
        while (st.stack.length && st.stack.at(-1).indent >= indent) st.stack.pop();
        const name = m[3].replace(PAREN_MS_RE, '').replace(/^(?:skipped|todo)\s+/, '').trim();
        const state = m[2] === '✓' || m[2] === '√' ? 'pass' : m[2] === '○' ? 'skip' : 'fail';
        if (state === 'pass') everyTest = true;
        put([st.file, ...st.stack.map((f) => f.name), name].join(' › '), state);
        return;
      }
      m = /^(\s+)(\S.*)$/.exec(l);
      if (m) {   // a describe block's title, in the verbose tree
        const indent = m[1].length;
        while (st.stack.length && st.stack.at(-1).indent >= indent) st.stack.pop();
        st.stack.push({ indent, name: m[2].trim() });
      }
    },
    vitest(l) {
      const t = l.replace(/\s+$/, '');
      const c = /^\s*Tests\s+(.*)$/.exec(t);
      if (c && /\d+ (?:passed|failed)/.test(c[1])) { counts = countsOf(c[1]); return; }
      let m = /^\s*FAIL\s+(\S+) > (.+)$/.exec(t);
      if (m) { put(`${m[1]} > ${m[2].trim()}`, 'fail'); return; }
      m = /^\s*[✓❯×↓]\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\(\d+ tests?/.exec(t);
      if (m) { st.file = m[1]; return; }
      m = /^\s*([✓×↓✗])\s+(.+)$/.exec(t);
      if (!m) return;
      const name = m[2].replace(BARE_MS_RE, '').trim();
      const head = name.split(' > ')[0];
      const key = TEST_FILE_RE.test(head) && name.includes(' > ') ? name : st.file ? `${st.file} > ${name}` : null;
      if (!key) return;
      const state = m[1] === '✓' ? 'pass' : m[1] === '↓' ? 'skip' : 'fail';
      if (state === 'pass') everyTest = true;
      put(key, state);
    },
  };
  function line(raw) {
    const l = String(raw ?? '').replace(ANSI_RE, '').replace(/\r$/, '');
    if (!format) {
      for (const [f, ok] of DETECT) if (ok(l)) { format = f; break; }
      if (!format) return;
    }
    H[format](l);
  }
  function result() {
    const pass = [];
    const fail = [];
    const skip = [];
    for (const [n, s] of tests) (s === 'pass' ? pass : s === 'fail' ? fail : skip).push(n);
    const by = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    const any = tests.size > 0 || counts !== null;
    const listsAll = format === 'tap' || format === 'node-spec' ? any : everyTest;
    return { format: any ? format : null, pass: pass.sort(by), fail: fail.sort(by), skip: skip.sort(by), passListed: !!listsAll, counts, truncated };
  }
  return { line, result };
}

/** All of a command's output at once (tests and fixtures). */
export function parseTestOutput(text) {
  const p = createTestOutputParser();
  for (const l of String(text ?? '').split('\n')) p.line(l);
  return p.result();
}
```

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/workflow-test-test-output.test.mjs`
Expected: PASS. If a fixture fails, fix the parser, not the fixture: the fixtures are the tools' shapes.

- [ ] **Step 5: Check the fixtures against real tools on this laptop**

In a scratch folder (not the worktree), make a tiny suite with one passing, one failing and one skipped test in a `describe`, and capture the output of each tool that is installed:
```powershell
node --test --test-reporter=tap  .\t.test.mjs  > tap.txt
node --test --test-reporter=spec .\t.test.mjs  > spec.txt
node --test .\t.test.mjs > default.txt          # which reporter a piped run uses on this Node
npx --yes vitest@2 run --reporter=default  > vitest-default.txt 2>&1
npx --yes vitest@2 run --reporter=verbose  > vitest-verbose.txt 2>&1
npx --yes jest@29 > jest-default.txt 2>&1
npx --yes jest@29 --verbose > jest-verbose.txt 2>&1
python -m pytest -rA > pytest-ra.txt; python -m pytest > pytest-default.txt
```
(Skip a tool that is not installed and cannot be fetched; say so.) For each captured file, run `node -e "import('./src/core/workflow-tests/test-output.mjs').then(m=>console.log(JSON.stringify(m.parseTestOutput(require('fs').readFileSync(process.argv[1],'utf8')),null,1)))" <file>` from the worktree and check the names and counts. Where a real output differs from its fixture in a way the parser misses, add the real shape as a second fixture to the test (trimmed to a few lines, no paths of this machine), fix the parser, and run Step 4 again. Record which tools were checked, with their versions, in `.superpowers/sdd/real-call-proof-3b.md` ("Test output formats").

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow-tests/test-output.mjs test/workflow-test-test-output.test.mjs
git commit -m "Workflow tests 3b: read test names from TAP, node:test, pytest, Jest and Vitest output (D74)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Before and after, classified, its words, and "breaks nothing that passed before" (D76, D82)

**Files:**
- Create: `src/shared/workflow-tests/before-after.mjs`
- Modify: `src/shared/workflow-tests/project-text.mjs` (a "3b: before and after" section at the end)
- Modify: `src/shared/workflow-tests/checks.mjs` (D82: `COMMAND_MET_WHEN` beside `COMMAND_TIMEOUTS` :20; the command branch of `normaliseCheck` :205-211; `checkLabel`'s command line :243)
- Test: `test/workflow-test-before-after.test.mjs`

**Interfaces:**
- Consumes: Task 7's `TestOutput` shape (only its fields; this module imports nothing from core).
- Produces:
  - `beforeAfter(before, after, { max? }): BeforeAfter | null` where `before` is a before run's record (`{ ran: true, ok, exitCode, timedOut, tests, at, cached }` or `{ ran: false, reason, text? }`) or null, and `after` is `{ ok, exitCode, timedOut, tests }`;
  - `BeforeAfter` = `{ ran: false, reason: 'setup'|'error'|'stopped', text? }` | `{ ran: true, level: 'tests'|'failures'|'exit', beforeOk, beforeTimedOut, afterOk, cached, at, … }` with, for `'tests'`: `madePass {n, names}`, `stillPass {n}`, `broke {n, names}`, `stillFailing {n, names}`, `added {n, failing}`, `gone {n, names}`, `lostPass {n}` (passed before, missing now), `truncated?`; for `'failures'`: `failingNow`, `noLongerFail`, `stillFailing` (each `{n, names}`), `counts { before, after }`;
  - `NAMES_MAX = 20`;
  - D82: `commandMet({ metWhen, afterOk, afterTimedOut, ba }): { met: boolean, why: null|'failed'|'timed-out'|'no-before'|'nothing-broke'|'broke'|'lost'|'failing-now'|'fewer-pass'|'broke-exit'|'cannot-tell', n?, before?, after? }` (`ba` = `beforeAfter`'s answer or null);
  - checks.mjs: `COMMAND_MET_WHEN = ['passes', 'breaks-nothing']`; a command check `{ cmd, timeoutMin, metWhen? }` where `metWhen: 'breaks-nothing'` is stored only when chosen; its label "The command <cmd> breaks nothing that passed before";
  - project-text.mjs: `BEFORE_HEADING`, `beforeExitText(r)`, `beforeNotRunText(r)`, `BEFORE_GROUPS`, `FAILURES_ONLY_NOTE`, `EXIT_ONLY_NOTE`, `passedCountsText(b, a)`, `addedText(n, failing)`, `moreNamesText(n)`, `BEFORE_KEPT_TEXT`, `splitTestName(name)`, `FAILED_LEAD`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-before-after.test.mjs`:

```js
// test/workflow-test-before-after.test.mjs — workflow tests 3b, Task 8 (D76): the command before and after the change,
// classified (SWE-bench's FAIL_TO_PASS / PASS_TO_PASS), and the words the side by side uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeAfter, NAMES_MAX, commandMet } from '../src/shared/workflow-tests/before-after.mjs';
import { normaliseCheck, checkLabel, COMMAND_MET_WHEN } from '../src/shared/workflow-tests/checks.mjs';
import { exampleFingerprint } from '../src/core/workflow-tests/store.mjs';
import { BEFORE_HEADING, beforeExitText, beforeNotRunText, BEFORE_GROUPS, FAILURES_ONLY_NOTE, EXIT_ONLY_NOTE, passedCountsText, addedText, moreNamesText,
  BEFORE_KEPT_TEXT, splitTestName, FAILED_LEAD } from '../src/shared/workflow-tests/project-text.mjs';

const T = (format, pass, fail, { skip = [], passListed = true, counts = null, truncated = false } = {}) => ({ format, pass, fail, skip, passListed, counts, truncated });
const B = (ok, tests, over = {}) => ({ ran: true, ok, exitCode: ok ? 0 : 1, timedOut: false, tests, at: '2026-10-28T09:00:00.000Z', cached: false, ...over });
const A = (ok, tests, over = {}) => ({ ok, exitCode: ok ? 0 : 1, timedOut: false, tests, ...over });

test('no before run: nothing; a before run that did not run: why', () => {
  assert.equal(beforeAfter(null, A(true, null)), null);
  assert.deepEqual(beforeAfter({ ran: false, reason: 'setup' }, A(true, null)), { ran: false, reason: 'setup' });
  assert.deepEqual(beforeAfter({ ran: false, reason: 'error', text: 'git failed' }, A(true, null)), { ran: false, reason: 'error', text: 'git failed' });
});

test('every test by name on both sides: made pass, still pass, broke, still failing, new, gone', () => {
  const before = B(false, T('tap', ['a', 'b', 'c', 'gone1'], ['x', 'y']));
  const after = A(false, T('tap', ['a', 'b', 'x', 'n1'], ['c', 'y', 'n2']));
  assert.deepEqual(beforeAfter(before, after), { ran: true, level: 'tests', beforeOk: false, beforeTimedOut: false, afterOk: false, cached: false,
    at: '2026-10-28T09:00:00.000Z',
    madePass: { n: 1, names: ['x'] }, stillPass: { n: 2 }, broke: { n: 1, names: ['c'] }, stillFailing: { n: 1, names: ['y'] },
    added: { n: 2, failing: 1 }, gone: { n: 1, names: ['gone1'] }, lostPass: { n: 1 } });
});

test('names are capped, counts are not; a cut parse is marked', () => {
  const many = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
  const r = beforeAfter(B(true, T('tap', many, [])), A(false, T('tap', [], many, { truncated: true })));
  assert.equal(r.broke.n, 30);
  assert.equal(r.broke.names.length, NAMES_MAX);
  assert.equal(r.truncated, true);
});

test('only failures by name: failing now, no longer failing, still failing, and both counts', () => {
  const r = beforeAfter(B(false, T('jest', [], ['x', 'y'], { passListed: false, counts: { passed: 212, failed: 2, skipped: 0 } })),
    A(false, T('jest', [], ['y', 'z'], { passListed: false, counts: { passed: 212, failed: 2, skipped: 0 } })));
  assert.equal(r.level, 'failures');
  assert.deepEqual([r.failingNow, r.noLongerFail, r.stillFailing], [{ n: 1, names: ['z'] }, { n: 1, names: ['x'] }, { n: 1, names: ['y'] }]);
  assert.deepEqual(r.counts, { before: { passed: 212, failed: 2, skipped: 0 }, after: { passed: 212, failed: 2, skipped: 0 } });
});

test('exit code only: no format, different formats, or a time-out on either side', () => {
  for (const [b, a] of [[B(true, T(null, [], [])), A(false, T(null, [], []))], [B(true, T('tap', ['a'], [])), A(true, T('jest', [], [], { passListed: false }))],
    [B(false, T('tap', ['a'], []), { timedOut: true }), A(true, T('tap', ['a'], []))], [B(true, null), A(true, null)]]) {
    const r = beforeAfter(b, a);
    assert.equal(r.level, 'exit');
    assert.equal(r.madePass, undefined);
  }
});

test('the words (U1 proposals; the approved mock wins)', () => {
  assert.equal(BEFORE_HEADING, 'Before the change');
  const x = (beforeOk, afterOk, beforeTimedOut = false) => beforeExitText({ beforeOk, afterOk, beforeTimedOut });
  assert.deepEqual([x(true, true), x(false, true), x(true, false), x(false, false), x(false, true, true)], [
    'It passed before the change too.', 'It failed before the change, and passes now.', 'It passed before the change: the change broke it.',
    'It failed before the change too.', 'Before the change, it ran longer than its time limit.']);
  assert.deepEqual([beforeNotRunText({ reason: 'setup' }), beforeNotRunText({ reason: 'stopped' }), beforeNotRunText({ reason: 'error', text: 'git failed.' }),
    beforeNotRunText({ reason: 'error' })], ['Worca could not run it before the change: the setup step failed.',
    'Worca did not run it before the change: the test was stopped.', 'Worca could not run it before the change: git failed.',
    'Worca could not run it before the change.']);
  assert.deepEqual(BEFORE_GROUPS, { madePass: 'Tests the change made pass', stillPass: 'Tests that passed before and still pass', broke: 'Tests it broke',
    stillFailing: 'Tests that failed before and still fail', added: 'New tests', gone: 'Tests that no longer run',
    failingNow: 'Tests failing now that did not fail before', noLongerFail: 'Tests that failed before and no longer fail' });
  assert.equal(FAILURES_ONLY_NOTE, 'This test tool names only the tests that fail, so the tests that pass are counted, not named.');
  assert.equal(EXIT_ONLY_NOTE, "Worca could not read test names in this command's output, so it compares only whether the command passed.");
  assert.equal(passedCountsText(212, 213), 'Passed: 212 before, 213 now');
  assert.deepEqual([addedText(3, 1), addedText(1, 0)], ['3, 1 failing', '1']);
  assert.equal(moreNamesText(4), 'and 4 more');
  assert.equal(BEFORE_KEPT_TEXT, ' · kept from an earlier test');
  assert.equal(FAILED_LEAD, 'Failed: ');
});

test('D82: the choice on the command check: stored only when it is "breaks nothing", its label, its fingerprint', () => {
  assert.deepEqual(COMMAND_MET_WHEN, ['passes', 'breaks-nothing']);
  const c = (raw) => normaliseCheck({ kind: 'command', cmd: 'npm test', ...raw }).check;
  assert.deepEqual(c({}), { kind: 'command', cmd: 'npm test', timeoutMin: 10 });
  assert.deepEqual(c({ metWhen: 'passes' }), { kind: 'command', cmd: 'npm test', timeoutMin: 10 }, 'the default is not stored');
  assert.deepEqual(c({ metWhen: 'breaks-nothing' }), { kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' });
  assert.equal(normaliseCheck({ kind: 'command', cmd: 'npm test', metWhen: 'sometimes' }).error,
    'pick when the command is met: it passes, or it breaks nothing that passed before');
  assert.equal(checkLabel(c({ metWhen: 'breaks-nothing' })), 'The command npm test breaks nothing that passed before');
  assert.equal(checkLabel(c({})), 'The command npm test passes');
  const ex = (check) => ({ request: 'r', files: [], answers: [], otherwise: 'pick', basics: {}, checks: [check], project: null });
  assert.equal(exampleFingerprint(ex(c({ metWhen: 'passes' }))), exampleFingerprint(ex(c({}))), 'the default keeps every fingerprint');
  assert.notEqual(exampleFingerprint(ex(c({ metWhen: 'breaks-nothing' }))), exampleFingerprint(ex(c({}))), 'switching it: earlier tries are not reused');
});

test('D82: "breaks nothing that passed before", judged at each level on the evidence that level has', () => {
  const tests = (o) => ({ ran: true, level: 'tests', beforeOk: false, beforeTimedOut: false, afterOk: false, broke: { n: 0, names: [] }, lostPass: { n: 0 }, ...o });
  const BN = (afterOk, ba, afterTimedOut = false) => commandMet({ metWhen: 'breaks-nothing', afterOk, afterTimedOut, ba });
  assert.deepEqual(commandMet({ metWhen: 'passes', afterOk: false, ba: tests() }), { met: false, why: 'failed' }, 'the default: the exit code only');
  assert.deepEqual(commandMet({ afterOk: true, ba: null }), { met: true, why: null });
  assert.deepEqual(BN(true, null), { met: true, why: null }, 'it passes: nothing it checks broke');
  assert.deepEqual(BN(false, tests(), true), { met: false, why: 'timed-out' });
  assert.deepEqual(BN(false, null), { met: false, why: 'no-before' });
  assert.deepEqual(BN(false, { ran: false, reason: 'setup' }), { met: false, why: 'no-before' });
  assert.deepEqual(BN(false, tests()), { met: true, why: 'nothing-broke' });
  assert.deepEqual(BN(false, tests({ broke: { n: 2, names: ['a', 'b'] } })), { met: false, why: 'broke', n: 2 });
  assert.deepEqual(BN(false, tests({ lostPass: { n: 1 } })), { met: false, why: 'lost', n: 1 }, 'a test that passed and no longer runs hides a breakage');
  assert.deepEqual(BN(false, tests({ truncated: true })), { met: false, why: 'cannot-tell' }, 'a cut list proves nothing');
  const counts = (b, a) => ({ before: { passed: b, failed: 1, skipped: 0 }, after: { passed: a, failed: 1, skipped: 0 } });
  const fails = (o) => ({ ran: true, level: 'failures', beforeOk: false, beforeTimedOut: false, afterOk: false, failingNow: { n: 0, names: [] }, counts: counts(212, 212), ...o });
  assert.deepEqual(BN(false, fails()), { met: true, why: 'nothing-broke' });
  assert.deepEqual(BN(false, fails({ failingNow: { n: 1, names: ['x'] } })), { met: false, why: 'failing-now', n: 1 });
  assert.deepEqual(BN(false, fails({ counts: counts(212, 209) })), { met: false, why: 'fewer-pass', before: 212, after: 209 });
  assert.deepEqual(BN(false, fails({ counts: { before: null, after: null } })), { met: false, why: 'cannot-tell' });
  const exit = (beforeOk) => ({ ran: true, level: 'exit', beforeOk, beforeTimedOut: false, afterOk: false });
  assert.deepEqual(BN(false, exit(true)), { met: false, why: 'broke-exit' });
  assert.deepEqual(BN(false, exit(false)), { met: false, why: 'cannot-tell' }, 'failing before too is no evidence that the same tests fail');
  assert.deepEqual(BN(false, { ...exit(false), beforeTimedOut: true }), { met: false, why: 'cannot-tell' });
});

test('a test name split for board 36\'s Failed line: the test file, then the test', () => {
  assert.deepEqual(splitTestName(`test/billing/invoice-totals.test.mjs > invoice totals > rounds`), { file: 'test/billing/invoice-totals.test.mjs', test: 'invoice totals > rounds' });
  assert.deepEqual(splitTestName('src/a.test.js › suite › t'), { file: 'src/a.test.js', test: 'suite › t' });
  assert.deepEqual(splitTestName('tests/test_dates.py::test_time_zone[utc]'), { file: 'tests/test_dates.py', test: 'test_time_zone[utc]' });
  assert.deepEqual(splitTestName('invoice totals > rounds'), { file: null, test: 'invoice totals > rounds' });
  assert.deepEqual(splitTestName('plain'), { file: null, test: 'plain' });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-before-after.test.mjs`
Expected: FAIL, "Cannot find module '…/before-after.mjs'".

- [ ] **Step 3: Write the classifier.** Create `src/shared/workflow-tests/before-after.mjs`:

```js
// src/shared/workflow-tests/before-after.mjs — workflow tests 3b (D76): "The command passes" before and after the change
// (SWE-bench's FAIL_TO_PASS / PASS_TO_PASS). Pure and browser-safe. `before` is the run on the start commit (before-run.mjs);
// `after` is the try's own run. "Met" is not decided here: it stays "the command ends without an error" (D57).

export const NAMES_MAX = 20;
const cap = (list, max) => ({ n: list.length, names: list.slice(0, max) });
const setsOf = (t) => ({ pass: new Set(t.pass || []), fail: new Set(t.fail || []), skip: new Set(t.skip || []) });

/**
 * @param {null|{ran: false, reason: string, text?: string}|{ran: true, ok: boolean, exitCode: number|null, timedOut: boolean, tests: object|null, at?: string, cached?: boolean}} before
 * @param {{ok: boolean, exitCode: number|null, timedOut?: boolean, tests: object|null}} after
 * @returns {null|object} see the Interfaces of Task 8
 */
export function beforeAfter(before, after, { max = NAMES_MAX } = {}) {
  if (!before) return null;
  if (before.ran === false) return { ran: false, reason: before.reason, ...(before.text ? { text: before.text } : {}) };
  const base = { ran: true, beforeOk: !!before.ok, beforeTimedOut: !!before.timedOut, afterOk: !!(after && after.ok), cached: !!before.cached, at: before.at || null };
  const b = before.tests;
  const a = after && after.tests;
  if (!b || !a || !b.format || b.format !== a.format || before.timedOut || (after && after.timedOut)) return { ...base, level: 'exit' };
  const B = setsOf(b);
  const A = setsOf(a);
  const sorted = (s) => [...s].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  if (b.passListed && a.passListed) {
    const inB = (x) => B.pass.has(x) || B.fail.has(x) || B.skip.has(x);
    const inA = (x) => A.pass.has(x) || A.fail.has(x) || A.skip.has(x);
    const newOnes = sorted(new Set([...A.pass, ...A.fail])).filter((x) => !inB(x));
    return { ...base, level: 'tests',
      madePass: cap(sorted(B.fail).filter((x) => A.pass.has(x)), max),
      stillPass: { n: sorted(B.pass).filter((x) => A.pass.has(x)).length },
      broke: cap(sorted(B.pass).filter((x) => A.fail.has(x)), max),
      stillFailing: cap(sorted(B.fail).filter((x) => A.fail.has(x)), max),
      added: { n: newOnes.length, failing: newOnes.filter((x) => A.fail.has(x)).length },
      gone: cap(sorted(new Set([...B.pass, ...B.fail])).filter((x) => !inA(x)), max),
      lostPass: { n: sorted(B.pass).filter((x) => !inA(x)).length },   // D82: passed before, missing now
      ...(b.truncated || a.truncated ? { truncated: true } : {}) };
  }
  return { ...base, level: 'failures',
    failingNow: cap(sorted(A.fail).filter((x) => !B.fail.has(x)), max),
    noLongerFail: cap(sorted(B.fail).filter((x) => !A.fail.has(x)), max),
    stillFailing: cap(sorted(B.fail).filter((x) => A.fail.has(x)), max),
    counts: { before: b.counts || null, after: a.counts || null },
    ...(b.truncated || a.truncated ? { truncated: true } : {}) };
}

/**
 * D82: is "The command passes" met? `metWhen` 'passes' (the default, D57): the command ends without an error within its time
 * limit. 'breaks-nothing': also met when it fails, if the before run (`ba`, beforeAfter's answer) shows that nothing that
 * passed before fails now or went missing, judged only on the evidence its level has: tests by name (broke and lostPass both
 * zero); failures by name (no new failing name, and both pass counts read with no fewer passing now); an exit code alone is
 * never evidence. Pure.
 * @returns {{met: boolean, why: string|null, n?: number, before?: number, after?: number}}
 */
export function commandMet({ metWhen = 'passes', afterOk = false, afterTimedOut = false, ba = null } = {}) {
  if (afterOk) return { met: true, why: null };
  if (afterTimedOut) return { met: false, why: 'timed-out' };
  if (metWhen !== 'breaks-nothing') return { met: false, why: 'failed' };
  if (!ba || !ba.ran) return { met: false, why: 'no-before' };
  if (ba.truncated) return { met: false, why: 'cannot-tell' };
  if (ba.level === 'tests') {
    if (ba.broke && ba.broke.n) return { met: false, why: 'broke', n: ba.broke.n };
    if (ba.lostPass && ba.lostPass.n) return { met: false, why: 'lost', n: ba.lostPass.n };
    return { met: true, why: 'nothing-broke' };
  }
  if (ba.level === 'failures') {
    if (ba.failingNow && ba.failingNow.n) return { met: false, why: 'failing-now', n: ba.failingNow.n };
    const b = ba.counts && ba.counts.before;
    const a = ba.counts && ba.counts.after;
    if (!b || !a) return { met: false, why: 'cannot-tell' };
    if (a.passed < b.passed) return { met: false, why: 'fewer-pass', before: b.passed, after: a.passed };
    return { met: true, why: 'nothing-broke' };
  }
  return { met: false, why: ba.beforeOk && !ba.beforeTimedOut ? 'broke-exit' : 'cannot-tell' };
}
```

In `src/shared/workflow-tests/checks.mjs`, below `COMMAND_TIMEOUTS` (:20), add:
```js
/** D82: when "The command passes" is met: it passes (the default, D57), or it breaks nothing that passed before. */
export const COMMAND_MET_WHEN = Object.freeze(['passes', 'breaks-nothing']);
```
In `normaliseCheck`'s command branch, replace its last line (`return done({ cmd, timeoutMin: t });`) with:
```js
    // D82: stored only when it is not the default, so every check and example fingerprint left on "passes" stays byte for byte.
    const mw = raw.metWhen === undefined || raw.metWhen === null || raw.metWhen === '' ? 'passes' : raw.metWhen;
    if (!COMMAND_MET_WHEN.includes(mw)) return { check: null, error: 'pick when the command is met: it passes, or it breaks nothing that passed before' };
    return done({ cmd, timeoutMin: t, ...(mw === 'breaks-nothing' ? { metWhen: mw } : {}) });
```
In `checkLabel`, replace the command line with:
```js
  if (c.kind === 'command') return c.metWhen === 'breaks-nothing' ? `The command ${c.cmd} breaks nothing that passed before` : `The command ${c.cmd} passes`;
```

- [ ] **Step 4: The words.** Append to `src/shared/workflow-tests/project-text.mjs`:

```js
// ── 3b: the command before and after the change (U1; this plan's proposals until the mock is approved) ─────────────────────
export const BEFORE_HEADING = 'Before the change';
/** The exit-code sentence (D76): passed or failed before, passes or fails now. */
export const beforeExitText = (r) => (r.beforeTimedOut ? 'Before the change, it ran longer than its time limit.'
  : r.beforeOk && r.afterOk ? 'It passed before the change too.'
    : !r.beforeOk && r.afterOk ? 'It failed before the change, and passes now.'
      : r.beforeOk ? 'It passed before the change: the change broke it.'
        : 'It failed before the change too.');
export const beforeNotRunText = (r) => (r.reason === 'setup' ? 'Worca could not run it before the change: the setup step failed.'
  : r.reason === 'stopped' ? 'Worca did not run it before the change: the test was stopped.'
    : `Worca could not run it before the change${r.text ? `: ${String(r.text).replace(/[.\s]+$/, '')}` : ''}.`);
export const BEFORE_GROUPS = Object.freeze({
  madePass: 'Tests the change made pass', stillPass: 'Tests that passed before and still pass', broke: 'Tests it broke',
  stillFailing: 'Tests that failed before and still fail', added: 'New tests', gone: 'Tests that no longer run',
  failingNow: 'Tests failing now that did not fail before', noLongerFail: 'Tests that failed before and no longer fail',
});
export const FAILURES_ONLY_NOTE = 'This test tool names only the tests that fail, so the tests that pass are counted, not named.';
export const EXIT_ONLY_NOTE = "Worca could not read test names in this command's output, so it compares only whether the command passed.";
export const passedCountsText = (b, a) => `Passed: ${b} before, ${a} now`;
export const addedText = (n, failing) => `${n}${failing ? `, ${failing} failing` : ''}`;
export const moreNamesText = (n) => `and ${n} more`;
export const BEFORE_KEPT_TEXT = ' · kept from an earlier test';
// P45: board 36's "Failed: <file> · "<test>"" line.
export const FAILED_LEAD = 'Failed: ';
const TEST_FILE_HEAD_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|\.py)$/;
/** A test name as Task 7 keys it, split at its first separator (" > ", " › ", "::") when the part before is a test file. */
export function splitTestName(name) {
  const s = String(name ?? '');
  for (const sep of [' > ', ' › ', '::']) {
    const i = s.indexOf(sep);
    if (i > 0 && TEST_FILE_HEAD_RE.test(s.slice(0, i))) return { file: s.slice(0, i), test: s.slice(i + sep.length) };
  }
  return { file: null, test: s };
}
```

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-test-before-after.test.mjs test/workflow-test-project-text.test.mjs test/workflow-test-project-checks.test.mjs test/workflow-test-checks.test.mjs test/workflow-test-store.test.mjs`
Expected: PASS (3a's command-check tests still see `{ kind, cmd, timeoutMin }`: the default is not stored).

- [ ] **Step 6: Commit**

```bash
git add src/shared/workflow-tests/before-after.mjs src/shared/workflow-tests/project-text.mjs src/shared/workflow-tests/checks.mjs test/workflow-test-before-after.test.mjs
git commit -m "Workflow tests 3b: the command before and after the change, classified, its words, and Met when it breaks nothing (D76, D82)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: The command on the start point: its clone, its run, the kept results (D74, D75)

**Files:**
- Create: `src/core/workflow-tests/before-run.mjs`
- Modify: `src/core/workflow-tests/project-copy.mjs` (the copy's stamp in `ensureTestCopyLocked`'s create path :335-345; new `COPY_STAMP_FILE`, `copyStamp`, `beforeRoot`, `cloneForBefore`)
- Modify: `src/core/workflow-tests/shell-step.mjs` (`runShellStep` :24-45: an `onLine` tap)
- Modify: `src/core/workflow-tests/result.mjs` (`runCommandCheck` :201-206 reads every line; `checkTry` :215-253 takes `beforeOf` and adds `ms`, `failed`, `failedCount`, `before`)
- Test: `test/workflow-test-before-run.test.mjs`

**Interfaces:**
- Consumes: `createTestOutputParser` (Task 7), `beforeAfter`, `commandMet` (Task 8), 3a's `tryShellEnv`, `SETUP_TIMEOUT_MS`, `withKeyLock`, `removeTree`, `tryGitEnv`, `withSafeGitArgs`, `processAlive` (`src/core/ui-instance.mjs:210`).
- Produces:
  - project-copy.mjs: `COPY_STAMP_FILE = 'worca-copy-made'`, `copyStamp(key): Promise<string>` ('none' for a copy made before 3b), `beforeRoot(home?)`, `cloneForBefore({ key, startCommit, dir }): Promise<void>` (throws NOT_READY);
  - shell-step.mjs: `runShellStep({ …, onLine })`;
  - before-run.mjs: `BEFORE_VERSION`, `BEFORE_MAX_AGE_MS`, `BEFORE_STALE_MS`, `HEARTBEAT_MS`, `beforeSpecOf(example, check, startCommit?)`, `beforeHash(spec)`, `readBefore(spec, { now?, stamp? })`, `beforeRun(spec, { signal?, onPhase?, run?, clone? })` → `{ ran: true, v, key, startCommit, setupCmd, cmd, timeoutMin, stamp, at, ok, exitCode, timedOut, ms, summary, tail, tests, cached }` | `{ ran: false, reason: 'setup'|'stopped'|'error', text? }`, `sweepBeforeRuns({ log?, now?, alive? }): { runs, kept }`;
  - result.mjs: `runCommandCheck` answers `{ met, value, output, exitCode, ms, tests, timedOut? }`; `checkTry(example, outcome, { …, beforeOf })` where `beforeOf(check)` returns a before record or null. A command result's `met` is `commandMet`'s (Task 8; the exit code for the default); a `'breaks-nothing'` check's result also carries `metWhen` and `metWhy: { why, n?, before?, after? }`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-before-run.test.mjs`:

```js
// test/workflow-test-before-run.test.mjs — workflow tests 3b, Task 9 (D74, D75): the command on the start commit, in its own clone
// of Worca's copy; kept per start point, setup and command; made again when the copy is; and a try's own command run reads every
// line of its output.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

let home, real, key, pin, copyDir, mod, pc, shell, result;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// A tiny suite in the project: TAP, "rounds" passes while state.txt says pass.
const CHECK_JS = "const ok=require('fs').readFileSync('state.txt','utf8').trim()==='pass';"
  + "console.log(['TAP version 13','ok 1 - adds',(ok?'ok':'not ok')+' 2 - rounds','1..2','# pass '+(ok?2:1),'# fail '+(ok?0:1)].join('\\n'));"
  + 'process.exitCode=ok?0:1;\n';
const spec = (over = {}) => ({ key, startCommit: pin.startCommit, setupCmd: null, cmd: 'node check.js', timeoutMin: 1, ...over });
const runFolders = () => (existsSync(pc.beforeRoot()) ? readdirSync(pc.beforeRoot()).filter((n) => n.startsWith('run-')) : []);

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-cc-wftbefore-'));
  _resetForTests();
  process.env.WORCA_HOME = home;
  real = templateRepo('wftbefore', { branch: 'main', user: true, files: { 'check.js': CHECK_JS, 'state.txt': 'pass\n', 'README.md': '# hi\n' } });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  pc = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pc.pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(home, '.worca-cc', 'workflow-tests', 'repos', key);   // worcaHome() is <WORCA_HOME>/.worca-cc
  mod = await import('../src/core/workflow-tests/before-run.mjs');
  shell = await import('../src/core/workflow-tests/shell-step.mjs');
  result = await import('../src/core/workflow-tests/result.mjs');
});
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of [home, real]) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('runShellStep hands every line to onLine and still keeps only the tail', async () => {
  const seen = [];
  const r = await shell.runShellStep({ command: 'node -e "for(let i=0;i<100;i++)console.log(\'line \'+i)"', cwd: home, env: shell.tryShellEnv(),
    timeoutMs: 60_000, onLine: (l) => seen.push(l) });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 100);
  assert.equal(r.tail.split('\n').length, shell.TAIL_LINES);
  assert.equal(seen[0], 'line 0');
});

test('runCommandCheck reads the test names in the whole output, with its exit code and time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-wftcmd-'));
  try {
    writeFileSync(join(dir, 'check.js'), CHECK_JS);
    writeFileSync(join(dir, 'state.txt'), 'fail\n');
    const r = await result.runCommandCheck({ cmd: 'node check.js', timeoutMin: 1 }, { cwd: dir });
    assert.deepEqual([r.met, r.exitCode, r.value], [false, 1, '1 passed, 1 failed']);
    assert.equal(typeof r.ms, 'number');
    assert.deepEqual([r.tests.format, r.tests.pass, r.tests.fail], ['tap', ['adds'], ['rounds']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a fresh run: its own clone of the copy at the start commit, no remote, removed after; nothing registered in the copy; the project only read', async () => {
  const was = repoSnapshot(real);
  const wtBefore = git(copyDir, 'worktree', 'list', '--porcelain');
  const phases = [];
  let inClone = null;
  const r = await mod.beforeRun(spec(), { onPhase: (p) => phases.push(p), run: async (o) => {
    inClone = inClone || { cwd: o.cwd, remotes: git(o.cwd, 'remote'), head: git(o.cwd, 'rev-parse', 'HEAD'), ref: git(o.cwd, 'rev-parse', '--abbrev-ref', 'HEAD') };
    return shell.runShellStep(o);
  } });
  assert.deepEqual([r.ran, r.ok, r.exitCode, r.cached, r.timedOut], [true, true, 0, false, false]);
  assert.deepEqual([r.tests.format, r.tests.pass, r.tests.fail], ['tap', ['adds', 'rounds'], []]);
  assert.equal(r.summary, '2 passed');
  assert.deepEqual(phases, ['copy', 'command'], 'no setup to run');
  assert.deepEqual([inClone.remotes, inClone.head, inClone.ref], ['', pin.startCommit, 'HEAD'], 'no remote, detached at the start commit');
  assert.ok(inClone.cwd.startsWith(pc.beforeRoot()), 'under <worcaHome>/workflow-tests/before');
  assert.equal(existsSync(inClone.cwd), false, 'the clone is removed');
  assert.deepEqual(runFolders(), []);
  assert.equal(git(copyDir, 'worktree', 'list', '--porcelain'), wtBefore, 'nothing registered in the copy');
  assert.equal(repoSnapshot(real), was, 'the person\'s repository is only read');
});

test('kept: the same start point, setup and command reuse it; a new setup, a new copy stamp or a week make a fresh run', async () => {
  const again = await mod.beforeRun(spec());
  assert.equal(again.cached, true);
  assert.equal(again.ok, true);
  const phases = [];
  const withSetup = await mod.beforeRun(spec({ setupCmd: 'node -e "require(\'fs\').writeFileSync(\'setup-ran.txt\',\'1\')"' }), { onPhase: (p) => phases.push(p) });
  assert.deepEqual([withSetup.cached, phases], [false, ['copy', 'setup', 'command']]);
  writeFileSync(join(copyDir, '.git', pc.COPY_STAMP_FILE), 'made again\n');
  assert.equal((await mod.beforeRun(spec())).cached, false, 'the copy was made again');
  assert.equal((await mod.beforeRun(spec())).cached, true);
  const kept = join(pc.beforeRoot(), 'cache', key, `${mod.beforeHash(spec())}.json`);
  const rec = JSON.parse(readFileSync(kept, 'utf8'));
  writeFileSync(kept, JSON.stringify({ ...rec, at: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() }));
  assert.equal(await mod.readBefore(spec()), null, 'older than a week');
  assert.equal((await mod.beforeRun(spec())).cached, false);
});

test('not kept: a setup that fails, a time-out, a stop, an error; each leaves no clone', async () => {
  const s1 = spec({ setupCmd: 'node -e "process.exit(3)"' });
  assert.deepEqual(await mod.beforeRun(s1), { ran: false, reason: 'setup' });
  assert.equal(await mod.readBefore(s1), null);
  const s2 = spec({ timeoutMin: 5 });
  const t = await mod.beforeRun(s2, { run: async (o) => (o.command === 'node check.js' ? { ok: false, exitCode: null, timedOut: true, ms: 5, tail: '' } : shell.runShellStep(o)) });
  assert.deepEqual([t.ran, t.timedOut], [true, true]);
  assert.equal(await mod.readBefore(s2), null, 'a run its time limit stopped is not kept');
  const ac = new AbortController();
  ac.abort();
  assert.deepEqual(await mod.beforeRun(spec({ timeoutMin: 10 }), { signal: ac.signal }), { ran: false, reason: 'stopped' });
  assert.deepEqual(await mod.beforeRun(spec({ timeoutMin: 30 }), { clone: async () => { throw new Error('boom\nmore'); } }), { ran: false, reason: 'error', text: 'boom' });
  assert.deepEqual(runFolders(), []);
});

test('the boot sweep: a dead owner\'s clone goes, a live one stays, a stale heartbeat goes, old kept results go', async () => {
  const root = pc.beforeRoot();
  const mk = (name, owner) => { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, 'x.txt'), 'x'); writeFileSync(join(root, `${name}.owner.json`), JSON.stringify(owner)); };
  const now = Date.now();
  mk('run-aaaaaaaaaaaa', { pid: 999_999_999, at: new Date(now).toISOString() });
  mk('run-bbbbbbbbbbbb', { pid: process.pid, at: new Date(now).toISOString() });
  mk('run-cccccccccccc', { pid: process.pid, at: new Date(now - 60 * 60_000).toISOString() });
  const old = join(root, 'cache', key, 'old.json');
  writeFileSync(old, '{}');
  const t = (now - 8 * 24 * 60 * 60_000) / 1000;
  utimesSync(old, t, t);
  const out = await mod.sweepBeforeRuns({ now, alive: (pid) => pid === process.pid });
  assert.deepEqual(out, { runs: 2, kept: 1 });
  assert.deepEqual(runFolders(), ['run-bbbbbbbbbbbb']);
  assert.equal(existsSync(old), false);
  rmSync(join(root, 'run-bbbbbbbbbbbb'), { recursive: true, force: true });
  rmSync(join(root, 'run-bbbbbbbbbbbb.owner.json'), { force: true });
});

test('checkTry: a command result carries the before and after, its time, and the first failing names', async () => {
  const ex = { basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [] }, text: null, files: [], logFile: null,
    project: { touched: [], total: 0, checkoutDir: '/x' } };
  const tap = (pass, fail) => ({ format: 'tap', pass, fail, skip: [], passListed: true, counts: null, truncated: false });
  const v = await result.checkTry(ex, outcome, {
    runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'x', exitCode: 1, ms: 1234, tests: tap(['adds'], ['rounds']) }),
    beforeOf: (c) => (c.id === 'c_1' ? { ran: true, ok: true, exitCode: 0, timedOut: false, tests: tap(['adds', 'rounds'], []), at: '2026-10-28T09:00:00.000Z', cached: true } : null),
  });
  const c = v.checks[0];
  assert.deepEqual([c.ms, c.failed, c.failedCount], [1234, ['rounds'], 1]);
  assert.deepEqual([c.before.level, c.before.broke, c.before.stillPass, c.before.cached], ['tests', { n: 1, names: ['rounds'] }, { n: 1 }, true]);
  const none = await result.checkTry(ex, outcome, { runCommand: async () => ({ met: true, value: 'Met', output: '' }) });
  assert.equal('before' in none.checks[0], false, 'no before run: no before');
  assert.equal('failed' in none.checks[0], false);
});

test('checkTry: "breaks nothing that passed before" is met on the before run\'s evidence, and says why (D82)', async () => {
  const tap = (pass, fail) => ({ format: 'tap', pass, fail, skip: [], passListed: true, counts: null, truncated: false });
  const ex = (metWhen) => ({ basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null },
    checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10, ...(metWhen ? { metWhen } : {}) }] });
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [] }, text: null, files: [], logFile: null,
    project: { touched: [], total: 0, checkoutDir: '/x' } };
  const runCommand = async () => ({ met: false, value: '2 passed, 1 failed', output: 'x', exitCode: 1, ms: 5, tests: tap(['adds', 'rounds'], ['a new test']) });
  const beforeOf = () => ({ ran: true, ok: true, exitCode: 0, timedOut: false, tests: tap(['adds', 'rounds'], []), at: '2026-10-28T09:00:00.000Z', cached: false });
  const met = (await result.checkTry(ex('breaks-nothing'), outcome, { runCommand, beforeOf })).checks[0];
  assert.deepEqual([met.met, met.metWhen, met.metWhy], [true, 'breaks-nothing', { why: 'nothing-broke' }], 'a new test that fails broke nothing that passed before');
  assert.equal(met.label, 'The command npm test breaks nothing that passed before');
  const plain = (await result.checkTry(ex(null), outcome, { runCommand, beforeOf })).checks[0];
  assert.deepEqual([plain.met, 'metWhen' in plain, 'metWhy' in plain], [false, false, false], 'the default: the exit code');
  const noBefore = (await result.checkTry(ex('breaks-nothing'), outcome, { runCommand })).checks[0];
  assert.deepEqual([noBefore.met, noBefore.metWhy], [false, { why: 'no-before' }]);
  const broke = (await result.checkTry(ex('breaks-nothing'), outcome, { beforeOf,
    runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'x', exitCode: 1, ms: 5, tests: tap(['adds'], ['rounds']) }) })).checks[0];
  assert.deepEqual([broke.met, broke.metWhy], [false, { why: 'broke', n: 1 }]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-before-run.test.mjs`
Expected: FAIL, "Cannot find module '…/before-run.mjs'".

- [ ] **Step 3: The line tap (shell-step.mjs).** In `runShellStep`, add `onLine: tap = null` to its options and replace its `onLine` handler:

```js
export async function runShellStep({ command, cwd, env, timeoutMs = SETUP_TIMEOUT_MS, signal = null, spawnImpl = null, onLine: tap = null } = {}) {
  const t0 = Date.now();
  const lines = [];
  let bytes = 0;
  const onLine = (_stream, line) => {
    // 3b (D74): every line, as it comes, to a reader (the test names); the tail is kept as before.
    if (tap) { try { tap(line); } catch { /* a reader's error never stops the command */ } }
    lines.push(line);
    bytes += line.length + 1;
    while (lines.length > TAIL_LINES || (bytes > TAIL_BYTES && lines.length > 1)) bytes -= lines.shift().length + 1;
  };
  // … the rest unchanged …
```
Add to its doc comment: "`onLine(line)`: every output line as it comes (workflow tests 3b)."

- [ ] **Step 4: The copy's stamp and the before clone (project-copy.mjs).** Add `randomBytes` to the imports (`import { randomBytes } from 'node:crypto';`). Below `COPY_SETTINGS` (:70), add:

```js
/** 3b (D75): the copy's stamp, written whenever the copy is made (also when it is made again): a before run kept for another
 *  stamp is not used. A copy made before 3b has none ('none'). */
export const COPY_STAMP_FILE = 'worca-copy-made';
/** 3b (D75): where the before runs' clones and kept results live. */
export const beforeRoot = (home = worcaHome()) => join(home, 'workflow-tests', 'before');
```
In `ensureTestCopyLocked`'s create path, right after `await resetCopyConfig(tmp, key);`, add:
```js
    await writeFile(join(tmp, '.git', COPY_STAMP_FILE), `${new Date().toISOString()} ${randomBytes(6).toString('hex')}\n`, 'utf8');
```
At the end of the file (before `_testing`), add:
```js
/** 3b (D75): the copy's stamp, or 'none'. Never throws. */
export async function copyStamp(key) {
  try { return String(await readFile(join(testCopyDirFor(key), '.git', COPY_STAMP_FILE), 'utf8')).trim() || 'none'; } catch { return 'none'; }
}

/** git in a before run's clone, or in beforeRoot to make one: its walk up stops at beforeRoot; the try's safe args and env. */
function beforeGit(cwd, args) {
  const e = { ...process.env };
  for (const k of GIT_DIR_ENV) delete e[k];
  e.GIT_CEILING_DIRECTORIES = resolve(beforeRoot());
  return git(cwd, withSafeGitArgs(args), { env: tryGitEnv({ env: e }) });
}

/**
 * 3b (D75): a clone of Worca's copy at `dir`, detached at `startCommit`, for the command's run before the change. Not a
 * checkout of the copy: nothing is registered in it, so the copy reset (P40) never meets it. `--local` hardlinks the copy's
 * objects, the pinned start commit's included; if that commit is missing anyway, it is fetched from the copy. Takes the key's
 * lock only for the clone itself. Throws NOT_READY with a sentence.
 */
export async function cloneForBefore({ key, startCommit, dir }) {
  const copyDir = testCopyDirFor(key);
  const fail = (r) => testError(`Worca could not copy the project to run the command before the change: ${firstLine(r.stderr)}`, 'NOT_READY');
  await mkdir(beforeRoot(), { recursive: true });
  const c = await withKeyLock(key, () => beforeGit(beforeRoot(), ['clone', '--quiet', '--local', '--no-checkout', '--no-tags', '--', copyDir, dir]));
  if (!c.ok) throw fail(c);
  for (const args of [['remote', 'remove', 'origin'], ['config', 'core.longpaths', 'true'], ['config', 'gc.auto', '0'], ['config', 'maintenance.auto', 'false']]) {
    const r = await beforeGit(dir, args);
    if (!r.ok) throw fail(r);
  }
  let co = await beforeGit(dir, ['checkout', '--quiet', '--detach', startCommit]);
  if (!co.ok) {
    const f = await beforeGit(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--', copyDir, startCommit]);
    if (!f.ok) throw fail(f);
    co = await beforeGit(dir, ['checkout', '--quiet', '--detach', startCommit]);
    if (!co.ok) throw fail(co);
  }
}
```

- [ ] **Step 5: The before run.** Create `src/core/workflow-tests/before-run.mjs`:

```js
// src/core/workflow-tests/before-run.mjs — workflow tests 3b (D75): "The command passes" run once on the start commit, before
// the workflow changed anything (SWE-bench's FAIL_TO_PASS / PASS_TO_PASS). It runs in its own short-lived clone of Worca's copy
// of the project (never a checkout registered in the copy: the copy reset, P40, only knows tries), the example's setup first,
// under the try's outward guard (D56). The result is kept for a week per project, start commit, setup and command, and dropped
// when the copy is made again (its stamp). Nothing here touches the person's repository.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeRoot, cloneForBefore, copyStamp, removeTree } from './project-copy.mjs';
import { runShellStep, tryShellEnv, SETUP_TIMEOUT_MS } from './shell-step.mjs';
import { createTestOutputParser } from './test-output.mjs';
import { commandSummary } from '../../shared/workflow-tests/checks.mjs';
import { processAlive } from '../ui-instance.mjs';

export const BEFORE_VERSION = 1;
export const BEFORE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const BEFORE_STALE_MS = 30 * 60_000;
export const HEARTBEAT_MS = 30_000;
const KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;
const RUN_RE = /^run-[0-9a-f]{12}$/;
const cacheDir = (key) => join(beforeRoot(), 'cache', key);
const firstLine = (e) => String(e && e.message ? e.message : e || '').trim().split(/\r?\n/)[0].slice(0, 300);

/** What one before run is for: the example's project, start commit and setup, and the command check. */
export const beforeSpecOf = (example, check, startCommit = example.project.startCommit) => ({
  key: example.project.key, startCommit, setupCmd: example.project.setupCmd || null, cmd: check.cmd, timeoutMin: check.timeoutMin,
});
export function beforeHash(spec) {
  return createHash('sha256').update(JSON.stringify([BEFORE_VERSION, spec.key, spec.startCommit, spec.setupCmd || null, spec.cmd, spec.timeoutMin]))
    .digest('hex').slice(0, 32);
}

/** The kept result for `spec`, or null: none, another version, another copy stamp, older than a week, or unreadable. */
export async function readBefore(spec, { now = Date.now(), stamp = null } = {}) {
  if (!KEY_RE.test(String(spec.key || ''))) return null;
  try {
    const rec = JSON.parse(await readFile(join(cacheDir(spec.key), `${beforeHash(spec)}.json`), 'utf8'));
    const s = stamp ?? await copyStamp(spec.key);
    if (!rec || rec.v !== BEFORE_VERSION || rec.stamp !== s || !(now - Date.parse(rec.at) < BEFORE_MAX_AGE_MS)) return null;
    return { ...rec, ran: true, cached: true };
  } catch { return null; }
}

async function keep(spec, rec) {
  const dir = cacheDir(spec.key);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${beforeHash(spec)}.json`);
  const tmp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, `${JSON.stringify(rec)}\n`, 'utf8');
  await rename(tmp, file);
}

const inflight = new Map();
/**
 * The command on the start commit: the kept result, else a fresh run (one at a time per spec in this server). Never throws.
 * @param {{key: string, startCommit: string, setupCmd: string|null, cmd: string, timeoutMin: number}} spec
 * @param {{signal?: AbortSignal|null, onPhase?: (p: 'copy'|'setup'|'command') => void, run?: Function, clone?: Function}} [o]
 */
export function beforeRun(spec, o = {}) {
  const k = `${spec.key}/${beforeHash(spec)}`;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => (await readBefore(spec)) || runFresh(spec, o))().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

async function runFresh(spec, { signal = null, onPhase = () => {}, run = runShellStep, clone = cloneForBefore } = {}) {
  if (!KEY_RE.test(String(spec.key || ''))) return { ran: false, reason: 'error', text: 'the project key is not valid' };
  const stopped = () => !!(signal && signal.aborted);
  const stamp = await copyStamp(spec.key);
  await mkdir(beforeRoot(), { recursive: true });
  const name = `run-${randomBytes(6).toString('hex')}`;
  const dir = join(beforeRoot(), name);
  const owner = join(beforeRoot(), `${name}.owner.json`);
  const beat = () => writeFile(owner, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8').catch(() => {});
  await beat();
  const timer = setInterval(() => { void beat(); }, HEARTBEAT_MS);
  if (timer.unref) timer.unref();
  try {
    if (stopped()) return { ran: false, reason: 'stopped' };
    onPhase('copy');
    await clone({ key: spec.key, startCommit: spec.startCommit, dir });
    if (stopped()) return { ran: false, reason: 'stopped' };
    if (spec.setupCmd) {
      onPhase('setup');
      // The setup's env (3a D56): the person's own command, before any change: it keeps the package-registry tokens.
      const s = await run({ command: spec.setupCmd, cwd: dir, env: tryShellEnv({ keepRegistryAuth: true }), timeoutMs: SETUP_TIMEOUT_MS, signal });
      if (stopped()) return { ran: false, reason: 'stopped' };
      if (!s.ok) return { ran: false, reason: 'setup' };
    }
    onPhase('command');
    const reader = createTestOutputParser();
    // The full guard env (a try's check gets the same): no forge, CI, publish or registry token. What the guard stops goes
    // to the scratch log: a before run is not the workflow's, so it is not "Would have sent".
    const r = await run({ command: spec.cmd, cwd: dir, env: tryShellEnv(), timeoutMs: spec.timeoutMin * 60_000, signal, onLine: (line) => reader.line(line) });
    if (stopped()) return { ran: false, reason: 'stopped' };
    const rec = { v: BEFORE_VERSION, key: spec.key, startCommit: spec.startCommit, setupCmd: spec.setupCmd || null, cmd: spec.cmd, timeoutMin: spec.timeoutMin,
      stamp, at: new Date().toISOString(), ok: !!r.ok, exitCode: r.exitCode ?? null, timedOut: !!r.timedOut, ms: r.ms ?? null,
      summary: commandSummary(r.tail), tail: r.tail || '', tests: reader.result() };
    if (!rec.timedOut) await keep(spec, rec).catch(() => {});   // a run its time limit stopped says nothing worth keeping
    return { ...rec, ran: true, cached: false };
  } catch (e) {
    return { ran: false, reason: 'error', text: firstLine(e) };
  } finally {
    clearInterval(timer);
    if (existsSync(dir)) {
      const why = await removeTree(dir);
      if (why) console.warn(`workflow tests: could not remove the before run's copy ${dir}: ${why}`);
    }
    await rm(owner, { force: true }).catch(() => {});
  }
}

/**
 * D75, at boot: a before run's clone whose owner is gone (its process ended, or no heartbeat for 30 minutes) is removed, and
 * so is an owner file with no clone; a live owner's clone stays (a second UI may share the Worca home). Kept results older
 * than a week go too. Never throws.
 */
export async function sweepBeforeRuns({ log = () => {}, now = Date.now(), alive = processAlive } = {}) {
  const out = { runs: 0, kept: 0 };
  const root = beforeRoot();
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.filter((x) => x.isDirectory() && RUN_RE.test(x.name))) {
    const owner = join(root, `${e.name}.owner.json`);
    let o = null;
    try { o = JSON.parse(await readFile(owner, 'utf8')); } catch { o = null; }
    const fresh = !!o && Number.isFinite(Date.parse(o.at)) && now - Date.parse(o.at) < BEFORE_STALE_MS;
    let live = false;
    if (fresh && Number.isInteger(o.pid)) { try { live = !!alive(o.pid); } catch { live = false; } }
    if (live) continue;
    const why = await removeTree(join(root, e.name));
    if (why) { log('warn', `workflow tests: could not remove the leftover before run ${e.name}: ${why}`); continue; }
    await rm(owner, { force: true }).catch(() => {});
    out.runs += 1;
  }
  for (const e of entries.filter((x) => x.isFile() && /^run-[0-9a-f]{12}\.owner\.json$/.test(x.name))) {
    if (!existsSync(join(root, e.name.replace(/\.owner\.json$/, '')))) await rm(join(root, e.name), { force: true }).catch(() => {});
  }
  let keys = [];
  try { keys = (await readdir(join(root, 'cache'), { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name); } catch { keys = []; }
  for (const k of keys) {
    let files = [];
    try { files = (await readdir(join(root, 'cache', k))).filter((f) => f.endsWith('.json')); } catch { files = []; }
    for (const f of files) {
      const p = join(root, 'cache', k, f);
      try { if (now - (await stat(p)).mtimeMs >= BEFORE_MAX_AGE_MS) { await rm(p, { force: true }); out.kept += 1; } } catch { /* the next one */ }
    }
  }
  if (out.runs || out.kept) log('info', `workflow tests: removed ${out.runs} leftover before run(s) and ${out.kept} old kept result(s)`);
  return out;
}
```
Check `processAlive(pid)` at `src/core/ui-instance.mjs:210` is a plain `(pid) => boolean`; if its module pulls in the server, copy its three lines here instead (`try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }`; Node's signal 0 only tests on Windows too).

- [ ] **Step 6: The try's command run and checkTry (result.mjs).** Add the imports:

```js
import { createTestOutputParser } from './test-output.mjs';
import { beforeAfter, commandMet } from '../../shared/workflow-tests/before-after.mjs';
```
Replace `runCommandCheck` (:201-206):
```js
/** D57: "The command passes": in the checkout, with the try's guard env, within its time limit. 3b (D74): every line is read
 *  for test names (`tests`), and the exit code and time come along. */
export async function runCommandCheck(check, { cwd, logFile = null, run = runShellStep } = {}) {
  const n = check.timeoutMin;
  const reader = createTestOutputParser();
  const r = await run({ command: check.cmd, cwd, env: tryShellEnv({ logFile }), timeoutMs: n * 60_000, onLine: (line) => reader.line(line) });
  const more = { output: r.tail, exitCode: r.exitCode ?? null, ms: r.ms ?? null, tests: reader.result() };
  if (r.timedOut) return { met: false, value: `Stopped after ${n} ${n === 1 ? 'minute' : 'minutes'}`, timedOut: true, ...more };
  return { met: r.ok, value: commandSummary(r.tail) || (r.ok ? 'Met' : 'Ended with an error'), ...more };
}
```
In `checkTry`, add `beforeOf = () => null` to its options (and to its JSDoc: "`beforeOf(check)`: 3b (D75) the command's run on the start commit, or null"), and replace the line that stores a command's result:
```js
      // 3b (D74, D76, D80): its time, the first failing names its output gave, and the run before the change classified.
      const fails = r.tests && r.tests.format && Array.isArray(r.tests.fail) && r.tests.fail.length ? r.tests.fail : null;
      let before = null;
      try { before = beforeOf(check); } catch { before = null; }
      const ba = before ? beforeAfter(before, { ok: !!r.met, exitCode: r.exitCode ?? null, timedOut: !!r.timedOut, tests: r.tests || null }) : null;
      // D82: met by the check's own rule; the default ('passes') is the exit code, as in 3a.
      const judged = commandMet({ metWhen: check.metWhen || 'passes', afterOk: !!r.met, afterTimedOut: !!r.timedOut, ba });
      const byRule = check.metWhen === 'breaks-nothing' ? { metWhen: 'breaks-nothing', ...(judged.why ? { metWhy: { why: judged.why,
        ...(judged.n != null ? { n: judged.n } : {}), ...(judged.before != null ? { before: judged.before, after: judged.after } : {}) } } : {}) } : {};
      results[i] = { id: check.id, kind: 'command', cmd: check.cmd, label, met: judged.met, value: r.value, ...(r.output ? { output: r.output } : {}),
        ...(r.timedOut ? { timedOut: true } : {}), ...(typeof r.ms === 'number' ? { ms: r.ms } : {}),
        ...(fails ? { failed: fails.slice(0, 3), failedCount: fails.length } : {}), ...byRule, ...(ba ? { before: ba } : {}) };
```

- [ ] **Step 7: Run the tests**

Run: `node tools/test.mjs test/workflow-test-before-run.test.mjs test/workflow-test-shell-step.test.mjs test/workflow-test-project-checks.test.mjs test/workflow-test-project-copy.test.mjs test/workflow-test-result.test.mjs`
Expected: PASS. If `test/workflow-test-project-checks.test.mjs` deep-compares `runCommandCheck`'s whole answer, add the new `exitCode`, `ms` and `tests` there (compare `ms` by type). `test/workflow-test-project-copy.test.mjs` still passes: the stamp is one more file in the copy's `.git`, and the copy reset keeps unknown files there (as it keeps `worca-repack-failed`).

- [ ] **Step 8: Commit**

```bash
git add src/core/workflow-tests/before-run.mjs src/core/workflow-tests/project-copy.mjs src/core/workflow-tests/shell-step.mjs src/core/workflow-tests/result.mjs test/workflow-test-before-run.test.mjs
git commit -m "Workflow tests 3b: the command on the start commit, in its own clone of the copy, kept per start point (D74, D75)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: The before phase in a test, the estimate, the progress, the boot sweep (D75, D78)

**Files:**
- Modify: `src/core/workflow-tests/runner.mjs` (`requestStop` :103-108, `drive` :195, `loop` :231, the judge call :384, the returned API :564; new `beforePhase`, `beforeNowOf`)
- Modify: `src/core/workflow-tests/service.mjs` (`testPlan` :548-600: `project.before`; `progressOf` :640: `before`; new `beforePlanOf`)
- Modify: `src/core/workflow-tests/store.mjs` (new `lastCommandMs`, beside `avgSetupMs` :415)
- Modify: `src/core/workflow-tests/connectors.mjs` (`connectorNotes` :145: `personalOff`)
- Modify: `src/core/workflow-tests/routes.mjs` (the runner's deps :45-66; the progress route :160)
- Modify: `ui/server.mjs` (`bootMaintenance`, beside `sweepTestCopies` :18783)
- Test: `test/workflow-test-before-runner.test.mjs`

**Interfaces:**
- Consumes: `beforeRun`, `readBefore`, `beforeSpecOf`, `beforeHash`, `sweepBeforeRuns` (Task 9); `checkTry(…, { beforeOf })` (Task 9).
- Produces:
  - runner deps `beforeRun(spec, { signal, onPhase })`; `deps.judge(example, outcome, { onCommand, beforeOf })`;
  - `runner.beforeNowOf(runId): { exampleId, exampleName, cmd, phase: 'copy'|'setup'|'command', n, of, startedMs } | null`;
  - `service.beforePlanOf(examples, { readKept?, setupMsOf?, commandMsOf? }): { runs, ms: number|null, cmd: string|null } | null`; the plan's `project.before`;
  - `service.progressOf(…, { beforeNowOf })` → the progress's `before`;
  - `store.lastCommandMs(exampleId, checkId): number|null`;
  - `connectorNotes(…)` adds `personalOff: boolean` (Pretend and a step on Claude Code).

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-before-runner.test.mjs`:

```js
// test/workflow-test-before-runner.test.mjs — workflow tests 3b, Task 10 (D75, D78): in a test, each project example's command
// runs once on its start point before any try; its result reaches the judge; a stop aborts it; the plan estimates it; the
// progress page sees it; Test a version knows when personal plugins are off.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { beforePlanOf } from '../src/core/workflow-tests/service.mjs';
import { connectorNotes } from '../src/core/workflow-tests/connectors.mjs';

const WF = 'wf_bprun';
const homes = [];
beforeEach(async () => { const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftbrun-')); homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const SHA = 'a'.repeat(40);
const pin = { key: 'tickets-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: SHA, changes: null, setupCmd: 'npm ci' };
const TESTS = { format: 'tap', pass: ['adds', 'rounds'], fail: [], skip: [], passListed: true, counts: null, truncated: false };
const example = (checks = [{ kind: 'command', cmd: 'npm test' }], project = pin) => store.createExample(WF, { name: 'Ticket 482', request: 'Fix the rounding.', checks }, { project });

function harness({ beforeRun = null } = {}) {
  const entries = new Map();
  const started = []; const prepared = []; const befores = [];
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
      started.push(body.title);
      setImmediate(() => { orch.state.totalCostUsd = 0.5; e.end('done'); });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { entries.get(k)?.end('stopped'); },
    answer: () => true,
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: 0.5, durationMs, sentBack: 0, help, failReason }, text: 'Fixed.', name: null, source: 'end-value',
        files: [], setup: { cmd: 'npm ci', ok: true, exitCode: 0, timedOut: false, ms: 1000, tail: '' }, logFile: null,
        project: { key: pin.key, checkoutDir: `/copy/${pipelineId}`, branch: 'b', runRoot: '/r', files: [], paths: [], touched: [], total: 0,
          counts: { added: 0, changed: 0, removed: 0 }, added: 0, removed: 0 } };
    },
    judge: (ex, outcome, o = {}) => checkTry(ex, outcome, { onCommand: o.onCommand, beforeOf: o.beforeOf,
      runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'x', exitCode: 1, ms: 4321,
        tests: { ...TESTS, pass: ['adds'], fail: ['rounds'] } }) }),
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    prepareProject: async (ex) => { prepared.push(ex.id); return { copyDir: '/copy', startCommit: ex.project.startCommit }; },
    cleanupTry: async () => ({ removed: true, error: null }),
    measureDisk: async () => 1,
    freeDisk: async () => 50 * 2 ** 30,
    mockMode: () => false,
    pollMs: 5,
    beforeRun: beforeRun || (async (spec, { onPhase } = {}) => {
      befores.push(spec);
      if (onPhase) onPhase('command');
      return { ran: true, ok: true, exitCode: 0, timedOut: false, tests: TESTS, at: '2026-10-28T09:00:00.000Z', cached: false, ms: 2000 };
    }),
  };
  return { deps, started, prepared, befores };
}

test('before any try, each project example\'s command runs once on its start point; the judge classifies against it', async () => {
  const ex = example();
  const h = harness();
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3 });
  await runner.idle(run.id);
  assert.equal(h.befores.length, 1, 'once for the example, whatever the tries and versions');
  assert.deepEqual(h.befores[0], { key: pin.key, startCommit: SHA, setupCmd: 'npm ci', cmd: 'npm test', timeoutMin: 10 });
  const tries = store.triesOfRun(run.id);
  assert.equal(tries.length, 6);
  for (const t of tries) {
    const c = t.verdict.checks[0];
    assert.deepEqual([c.before.level, c.before.broke, c.ms, c.failed], ['tests', { n: 1, names: ['rounds'] }, 4321, ['rounds']]);
  }
  assert.equal(store.lastCommandMs(ex.id, ex.checks[0].id), 4321);
  assert.equal(store.lastCommandMs(ex.id, 'c_none'), null);
});

test('no command check, no before run; an example without a project neither', async () => {
  const a = example([]);
  const b = store.createExample(WF, { name: 'Brief', request: 'Write it.' });
  const h = harness();
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [a.id, b.id], tries: 1 });
  await runner.idle(run.id);
  assert.deepEqual(h.befores, []);
});

test('a stop during the before run aborts it; no try starts; the progress page saw it', async () => {
  const ex = example();
  let seenSignal = null;
  let release;
  const held = new Promise((r) => { release = r; });
  const h = harness({ beforeRun: async (_spec, { signal, onPhase }) => {
    seenSignal = signal;
    onPhase('setup');
    await new Promise((r) => { signal.addEventListener('abort', r, { once: true }); held.then(r); });
    return { ran: false, reason: 'stopped' };
  } });
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  for (let i = 0; i < 200 && runner.beforeNowOf(run.id)?.phase !== 'setup'; i += 1) await new Promise((r) => setTimeout(r, 5));
  const now = runner.beforeNowOf(run.id);
  assert.deepEqual([now.exampleName, now.cmd, now.phase, now.n, now.of], ['Ticket 482', 'npm test', 'setup', 1, 1]);
  const stopped = await runner.stop(run.id);
  release();
  assert.equal(seenSignal.aborted, true);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(h.started, [], 'no try started');
  assert.equal(runner.beforeNowOf(run.id), null);
});

test('a project that cannot be used stops the test in the before phase, as a try would', async () => {
  const ex = example();
  const h = harness();
  h.deps.prepareProject = async () => { throw Object.assign(new Error('The project folder is missing.'), { code: 'NOT_READY' }); };
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const r = store.readTestRun(run.id);
  assert.deepEqual([r.status, r.stopReason, r.stopDetail], ['stopped', 'refused', 'The project folder is missing.']);
});

test('the plan: how many start points still need the command, and how long that takes', async () => {
  const ex1 = { id: 1, project: pin, checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const ex2 = { id: 2, project: { ...pin, startCommit: 'b'.repeat(40) }, checks: [{ id: 'c_2', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const ex3 = { id: 3, project: null, checks: [] };
  const plan = (o) => beforePlanOf([ex1, ex2, ex3], { setupMsOf: () => 60_000, commandMsOf: () => 30_000, ...o });
  assert.deepEqual(await plan({ readKept: async () => null }), { runs: 2, ms: 180_000, cmd: 'npm test' });
  assert.deepEqual(await plan({ readKept: async (s) => (s.startCommit === SHA ? { ran: true } : null) }), { runs: 1, ms: 90_000, cmd: 'npm test' });
  assert.equal(await plan({ readKept: async () => ({ ran: true }) }), null, 'every one kept: nothing to say');
  assert.deepEqual(await plan({ readKept: async () => null, commandMsOf: () => null }), { runs: 2, ms: null, cmd: 'npm test' }, 'not measured yet');
  const mixed = await beforePlanOf([ex1, { ...ex2, checks: [{ id: 'c_3', kind: 'command', cmd: 'pytest', timeoutMin: 10 }] }],
    { readKept: async () => null, setupMsOf: () => 0, commandMsOf: () => 1 });
  assert.equal(mixed.cmd, null, 'several commands');
});

test('Test a version knows when the person\'s plugins are off (D70, D78)', () => {
  assert.equal(connectorNotes({ engines: ['claude'], mode: 'pretend' }).personalOff, true);
  assert.equal(connectorNotes({ engines: ['claude'], mode: 'real' }).personalOff, false);
  assert.equal(connectorNotes({ engines: ['codex'], mode: 'pretend' }).personalOff, false);
  assert.deepEqual(connectorNotes({ engines: ['claude', 'codex'], mode: 'pretend' }).engines, ['Codex']);
});
```
(Check `engineLabel('codex')` reads "Codex" in `src/shared/engine-switch.mjs`; use its value if it differs.)

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-before-runner.test.mjs`
Expected: FAIL: `beforePlanOf` is not exported.

- [ ] **Step 3: The runner (runner.mjs).** Add near the top of `createTestRunner`:

```js
  /** 3b (D75): a before run's key in a test: one example's one command check. */
  const beforeKey = (exampleId, checkId) => `${exampleId}|${checkId}`;
```
In `requestStop`, after `st.detail = detail;`, add:
```js
    if (st.beforeAbort) st.beforeAbort.abort();   // 3b (D75): a before run stops with the test
```
In `drive`, give the live state its new fields:
```js
    const st = { stopping: null, detail: null, running: new Map(), done: null, before: null, beforeNow: null, beforeAbort: null };
```
In `loop`, right after the quick-check block and before `const inflight = new Set();`, add:
```js
    // 3b (D75): before any try, each project example's command checks run once on its start point (kept results are reused).
    await beforePhase(run, st);
    if (st.stopping) return;
```
Add the phase below `loop`:
```js
  /**
   * 3b (D75): the command checks of the examples that still have tries to make, one at a time, on their start points. The
   * results stay in `st.before` for the judge (beforeOf). A project that cannot be used stops the test as a try would; a
   * before run that fails is recorded as not run and the tries go on (their own setup decides, D55).
   */
  async function beforePhase(run, st) {
    st.before = new Map();
    if (!deps.beforeRun) return;
    const ids = [...new Set(queueOf(run).map((t) => t.exampleId))];
    const jobs = [];
    for (const id of ids) {
      const ex = store.readExample(run.workflowId, id);
      if (!ex || !ex.project) continue;
      for (const c of ex.checks || []) if (c.kind === 'command') jobs.push({ ex, check: c });
    }
    if (!jobs.length) return;
    st.beforeAbort = new AbortController();
    try {
      for (const [i, { ex, check }] of jobs.entries()) {
        if (st.stopping) return;
        st.beforeNow = { exampleId: ex.id, exampleName: ex.name, cmd: check.cmd, phase: 'copy', n: i + 1, of: jobs.length, startedMs: Date.now() };
        notify(run);
        let project;
        try { project = await deps.prepareProject(ex); } catch (e) {
          requestStop(st, e && e.code === 'NOT_READY' ? 'refused' : 'error', msgOf(e));
          return;
        }
        const spec = { key: ex.project.key, startCommit: project.startCommit, setupCmd: ex.project.setupCmd || null, cmd: check.cmd, timeoutMin: check.timeoutMin };
        let rec;
        try {
          rec = await deps.beforeRun(spec, { signal: st.beforeAbort.signal, onPhase: (p) => { if (st.beforeNow) st.beforeNow.phase = p; } });
        } catch (e) { rec = { ran: false, reason: 'error', text: msgOf(e) }; }
        st.before.set(beforeKey(ex.id, check.id), rec);
      }
    } finally {
      st.beforeNow = null;
      st.beforeAbort = null;
      notify(run);
    }
  }
```
In `runTry`, replace the judge call (:384):
```js
      const verdict = await deps.judge(example, outcome, { onCommand: (cmd) => { rec.checking = cmd; },
        beforeOf: (check) => (st.before ? st.before.get(beforeKey(example.id, check.id)) ?? null : null) });
```
Below `diskOf`, add:
```js
  /** 3b (D75, U3): what the before phase is doing now, or null. */
  function beforeNowOf(runId) { const st = live.get(Number(runId)); return st && st.beforeNow ? { ...st.beforeNow } : null; }
```
and return it: `return { start, stop, continueRun, recover, idle, costOf, phaseOf, diskOf, beforeNowOf };`.

- [ ] **Step 4: The store, the notes, the plan and the progress**

`src/core/workflow-tests/store.mjs`, below `avgSetupMs`:
```js
/** 3b (D75, U2): how long an example's command check `checkId` last ran (the newest judged try that says), or null. */
export function lastCommandMs(exampleId, checkId) {
  getDb();
  const rows = prepare('SELECT verdict FROM wf_test_tries WHERE example_id = ? AND verdict IS NOT NULL ORDER BY id DESC LIMIT 20').all(Number(exampleId));
  for (const r of rows) {
    let v = null;
    try { v = JSON.parse(r.verdict); } catch { v = null; }
    const c = v && Array.isArray(v.checks) ? v.checks.find((x) => x && x.id === checkId && Number.isFinite(x.ms)) : null;
    if (c) return Math.round(c.ms);
  }
  return null;
}
```

`src/core/workflow-tests/connectors.mjs`, in `connectorNotes`'s returned object, after `engines: …`:
```js
    // 3b (D70): a Pretend test's steps on Claude Code load none of the person's own plugins, skills, agents or hooks.
    personalOff: mode !== 'real' && engines.includes('claude'),
```
(Add to its doc comment: "`personalOff`: Pretend and a step runs on Claude Code (board 34's Part 3b line).")

`src/core/workflow-tests/service.mjs`: add to the imports
```js
import { readBefore, beforeSpecOf, beforeHash } from './before-run.mjs';
```
and, above `testPlan`:
```js
/**
 * 3b (D75, U2): the command runs a test still has to make on its start points (none kept), and how long they take (each
 * one's setup plus its command's last time); null when there are none. `ms` is null when one of them was never measured.
 * `cmd` names the command when there is one.
 */
export async function beforePlanOf(examples, { readKept = (s) => readBefore(s), setupMsOf = store.avgSetupMs, commandMsOf = store.lastCommandMs } = {}) {
  const seen = new Set();
  const cmds = new Set();
  let runs = 0;
  let ms = 0;
  let unknown = false;
  for (const ex of examples) {
    if (!ex || !ex.project) continue;
    for (const c of ex.checks || []) {
      if (c.kind !== 'command') continue;
      const spec = beforeSpecOf(ex, c);
      const h = `${spec.key}/${beforeHash(spec)}`;
      if (seen.has(h)) continue;
      seen.add(h);
      if (await readKept(spec)) continue;
      runs += 1;
      cmds.add(c.cmd);
      const s = spec.setupCmd ? setupMsOf(ex.id, ex.project.startCommit) : 0;
      const m = commandMsOf(ex.id, c.id);
      if (s == null || m == null) unknown = true; else ms += s + m;
    }
  }
  return runs ? { runs, ms: unknown ? null : ms, cmd: cmds.size === 1 ? [...cmds][0] : null } : null;
}
```
In `testPlan`, add `before: await beforePlanOf(projEx),` to the `project` object built for `projEx.length`, and `before: null` to the left-out-only one.

In `progressOf`, add `beforeNowOf = null` to its options and `before: beforeNowOf ? beforeNowOf(run.id) : null,` to the returned object (after `quick: run.quick,`).

- [ ] **Step 5: The wiring (routes.mjs, server.mjs)**

`src/core/workflow-tests/routes.mjs`: add `import { beforeRun } from './before-run.mjs';`. In `createTestRunner({ … })`:
```js
    judge: (example, outcome, o = {}) => checkTry(example, outcome, { scriptName, onCommand: o.onCommand, beforeOf: o.beforeOf }),
    // 3b (D75): the command on each project example's start point, before the tries (a test may pass its own).
    beforeRun: deps.beforeRun || ((spec, o) => beforeRun(spec, o)),
```
In the progress route (:160):
```js
    const p = service.progressOf(wid(req), num(req.params.run, 'test'), { costOf: runner.costOf, phaseOf: runner.phaseOf, beforeNowOf: runner.beforeNowOf });
```

`ui/server.mjs`: add `import { sweepBeforeRuns } from '../src/core/workflow-tests/before-run.mjs';` beside the `sweepTestCopies` import (:338), and in `bootMaintenance`, right after the copy sweep's `try { … } catch { … }` (:18782-18786):
```js
  // Workflow tests 3b (D75): before runs a restart left (their owner process is gone), and kept results older than a week.
  try {
    summary.beforeRuns = await sweepBeforeRuns({ log: sink('workflow-tests') });
  } catch (err) {
    console.error(`[worca-ui] workflow tests before-run sweep failed: ${err && err.message ? err.message : err}`);
  }
```

- [ ] **Step 6: Run the tests**

Run: `node tools/test.mjs test/workflow-test-before-runner.test.mjs test/workflow-test-project-runner.test.mjs test/workflow-test-runner.test.mjs test/workflow-test-connectors.test.mjs test/api-workflow-tests-projects.test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs test/workflow-test-routes.test.mjs`
Expected: PASS. If a 3a test deep-compares `progressOf`'s or `testPlan`'s whole answer, or `connectorNotes`', add `before: null` / `project.before` / `personalOff` there (an answer grows; nothing else changes). 3a's runner tests pass `judge` without `beforeOf`: `checkTry`'s default `beforeOf` keeps them as they were, and their harness has no `beforeRun`, so no before phase runs.

- [ ] **Step 7: Commit**

```bash
git add src/core/workflow-tests/runner.mjs src/core/workflow-tests/service.mjs src/core/workflow-tests/store.mjs src/core/workflow-tests/connectors.mjs src/core/workflow-tests/routes.mjs ui/server.mjs test/workflow-test-before-runner.test.mjs
git commit -m "Workflow tests 3b: the before phase in a test, its estimate and progress, the boot sweep (D75, D78)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: UI: the project checks in the check dialog (board 33) and their rows side by side (board 36)

**Precondition:** the controller confirms boards 33 and 36 are approved, re-reads `project/P3AddCheck.dc.html` and `project/P3SideBySide.dc.html`, and applies any copy change to this task first.

**Match board 33** (Add an automatic check, an example with a project):
- "What to check" lists, under "The project": "The command passes", "Changes only files under …", "Leaves these files unchanged", "Changes at most N files". "The result" no longer lists any of them.
- **Changes only files under …:** the field "Folders" (a monospace box, e.g. `src/, test/`), hint "Separate them with commas. Not met when the try changes a file anywhere else."
- **Leaves these files unchanged:** the field "Files" (monospace, e.g. `test/fixtures/**, package-lock.json`), hint "A name, or a pattern such as `test/**` for everything in a folder." (`test/**` in code).
- **Changes at most N files:** the field "Most files" (a 100 px box), hint "Added, changed and removed files all count."
- The preview line: "Changes only files under `src/` and `test/`", "Leaves these files unchanged: `test/fixtures/**`", "Changes at most 6 files" (folders and patterns in code, P47). The example's card lists the check the same way ("Changes at most 6 files" with Edit).
- Refusals: P41's sentences in the dialog's error line.

**Match board 36** (What was checked): the rows "Changes only files under `src/` and `test/`" (Met / Met), "Leaves these files unchanged: `test/fixtures/**`" (Met / Met), "Changes at most 6 files" ("3 files" / "4 files"); not met: P42's values. Under a command not met: "**Not met for v3 draft:** the command ended with an error." and, when names were read, "Failed: `test/billing/invoice-totals.test.mjs` · "rounds three lines of 0.125 to 0.38"" (P45), then "See the command output".

**Files:**
- Modify: `ui/public/workflows/example-editor.mjs` (`openCheckDialog` :91-215)
- Modify: `ui/public/workflows/test-ui.mjs` (`checkWords` :19-24)
- Modify: `ui/public/workflows/test-compare.mjs` (the checks table :520-550)
- Modify: `src/shared/workflow-tests/project-text.mjs` (board 33's field words)
- Modify: `ui/public/style.css`
- Test: `test/ui-workflow-test-scope-checks.test.mjs`

**Interfaces:**
- Consumes: Task 6's kinds and results (`kind`, `dirs`, `patterns`, `max`), Task 9's `failed` / `failedCount`, Task 8's `splitTestName`, `FAILED_LEAD`, `moreNamesText`; `PROJECT_KINDS`.
- Produces: `checkWords` for `under` and `unchanged`; the side by side's `.wft-why-col` and `.wft-failed-line`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-scope-checks.test.mjs`:

```js
// test/ui-workflow-test-scope-checks.test.mjs — workflow tests 3b, Task 11: the project checks in the check dialog (board 33) and
// their rows in one example side by side (board 36), with the command's "Failed:" line (P45).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCheckDialog } from '../ui/public/workflows/example-editor.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (doc, sel, t) => [...doc.querySelectorAll(sel)].find((x) => x.textContent === t);
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
function dialog({ project = true, check = null } = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const saved = [];
  openCheckDialog({ doc: window.document, win: window, scripts: [], project, check, onSave: (c) => saved.push(c) });
  return { doc: window.document, window, saved };
}
const pick = (doc, window, value) => { const k = doc.querySelector('#wft-ck-kind'); k.value = value; k.dispatchEvent(new window.Event('change')); };
const type = (doc, window, sel, v) => { const i = doc.querySelector(sel); i.value = v; i.dispatchEvent(new window.Event('input')); };

test('board 33: the project group lists the four project checks; the result group none of them', () => {
  const { doc } = dialog();
  const [result, proj] = [...doc.querySelectorAll('#wft-ck-kind optgroup')];
  assert.deepEqual([...proj.querySelectorAll('option')].map((o) => o.textContent),
    ['The command passes', 'Changes only files under …', 'Leaves these files unchanged', 'Changes at most N files']);
  assert.ok(![...result.querySelectorAll('option')].some((o) => ['command', 'under', 'unchanged', 'max-files'].includes(o.value)));
  const none = dialog({ project: false }).doc;
  assert.ok(![...none.querySelectorAll('#wft-ck-kind option')].some((o) => ['under', 'unchanged', 'max-files'].includes(o.value)), 'not without a project');
  const kept = dialog({ project: false, check: { id: 'c_1', kind: 'under', dirs: ['src/'] } }).doc;
  assert.equal(kept.querySelector('#wft-ck-kind').value, 'under', 'an edited project check keeps its kind');
});

test('board 33: Changes only files under …: Folders, its hint, the preview in code, and what is saved', async () => {
  const { doc, window, saved } = dialog();
  pick(doc, window, 'under');
  assert.equal(doc.querySelector('label[for="wft-ck-dirs"]').textContent, 'Folders');
  assert.ok(doc.querySelector('#wft-ck-dirs').classList.contains('wft-mono'));
  assert.equal(doc.querySelector('#wft-ck-dirs').closest('.field').querySelector('.hint').textContent,
    'Separate them with commas. Not met when the try changes a file anywhere else.');
  type(doc, window, '#wft-ck-dirs', 'src/, test/');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Changes only files under src/ and test/');
  assert.deepEqual(texts(doc, '.wft-ck-preview .code'), ['src/', 'test/']);
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'under', dirs: ['src/', 'test/'] }]);
});

test('board 33: Leaves these files unchanged: Files, its hint with test/** in code', async () => {
  const { doc, window, saved } = dialog();
  pick(doc, window, 'unchanged');
  assert.equal(doc.querySelector('label[for="wft-ck-keep"]').textContent, 'Files');
  const hint = doc.querySelector('#wft-ck-keep').closest('.field').querySelector('.hint');
  assert.equal(hint.textContent, 'A name, or a pattern such as test/** for everything in a folder.');
  assert.equal(hint.querySelector('.code').textContent, 'test/**');
  type(doc, window, '#wft-ck-keep', 'test/fixtures/**, package-lock.json');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Leaves these files unchanged: test/fixtures/**, package-lock.json');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'unchanged', patterns: ['test/fixtures/**', 'package-lock.json'] }]);
});

test('board 33: Changes at most N files: Most files, a number box, its refusal (P41)', async () => {
  const { doc, window, saved } = dialog();
  pick(doc, window, 'max-files');
  const most = doc.querySelector('#wft-ck-max');
  assert.equal(doc.querySelector('label[for="wft-ck-max"]').textContent, 'Most files');
  assert.equal(most.inputMode, 'numeric');
  assert.ok(most.classList.contains('wft-ck-num'));
  assert.equal(most.closest('.field').querySelector('.hint').textContent, 'Added, changed and removed files all count.');
  type(doc, window, '#wft-ck-max', 'six');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'The most files must be a whole number from 0 to 10000.');
  type(doc, window, '#wft-ck-max', '6');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Changes at most 6 files');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'max-files', max: 6 }]);
});

const verdict = (scope, command) => ({ basics: [], checks: [
  { id: 'c_1', label: 'The command npm test passes', kind: 'command', cmd: 'npm test', ...command },
  { id: 'c_2', label: 'Changes only files under src/ and test/', kind: 'under', dirs: ['src/', 'test/'], met: true, value: 'Met' },
  { id: 'c_3', label: 'Leaves these files unchanged: test/fixtures/**', kind: 'unchanged', patterns: ['test/fixtures/**'], met: true, value: 'Met' },
  { id: 'c_4', label: 'Changes at most 6 files', kind: 'max-files', max: 6, met: scope.met, value: scope.value }] });
function side() {
  const A = { tryId: 11, status: 'passed', connectors: 'pretend', text: null, wouldHaveSent: [], answeredReads: [],
    verdict: verdict({ met: true, value: '3 files' }, { met: true, value: '213 passed', output: 'ℹ pass 213' }), project: null };
  const B = { ...A, tryId: 12, status: 'failed', verdict: verdict({ met: true, value: '4 files' }, { met: false, value: '212 passed, 1 failed', output: 'ℹ pass 212\nℹ fail 1',
    failed: ['test/billing/invoice-totals.test.mjs > rounds three lines of 0.125 to 0.38', 'invoice totals > adds lines', 'x', 'y'], failedCount: 5 }) };
  return { run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482' }, labels: { a: 'v2', b: 'v3 draft' },
    row: { result: 'worse', a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 } }, connectors: 'pretend', tries: [{ n: 1, a: A, b: B }], start: null, nothingPushed: false };
}

test('board 36: the scope rows with folders and patterns in code; the command\'s Failed line (P45)', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderSideBySide(root, side(), { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} },
    { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  const rows = [...root.querySelectorAll('.wft-crow')].filter((r) => !r.classList.contains('is-head'));
  const byLabel = (start) => rows.find((r) => r.firstChild.textContent.startsWith(start));
  const under = byLabel('Changes only files under');
  assert.deepEqual(texts(under.firstChild, '.code'), ['src/', 'test/']);
  assert.equal(under.firstChild.textContent, 'Changes only files under src/ and test/');
  assert.deepEqual(texts(byLabel('Leaves these files unchanged'), '.wft-res'), ['Met', 'Met']);
  assert.deepEqual(texts(byLabel('Leaves these files unchanged').firstChild, '.code'), ['test/fixtures/**']);
  assert.deepEqual(texts(byLabel('Changes at most 6 files'), '.wft-res'), ['3 files', '4 files']);
  const why = root.querySelector('.wft-why-cmd');
  assert.equal(why.querySelector('span').textContent.startsWith('Not met for v3 draft: the command ended with an error.'), true);
  const failed = why.querySelector('.wft-failed-line');
  assert.equal(failed.textContent, 'Failed: test/billing/invoice-totals.test.mjs · "rounds three lines of 0.125 to 0.38"; "invoice totals > adds lines"; "x" and 2 more');
  assert.deepEqual(texts(failed, '.code'), ['test/billing/invoice-totals.test.mjs']);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/ui-workflow-test-scope-checks.test.mjs`
Expected: FAIL: "The project" group lists only "The command passes".

- [ ] **Step 3: The words.** Append to `src/shared/workflow-tests/project-text.mjs`, in the board 33 section:

```js
// 3b, board 33: the file-scope checks' fields.
export const FOLDERS_LABEL = 'Folders';
export const FOLDERS_HINT = 'Separate them with commas. Not met when the try changes a file anywhere else.';
export const FILES_LABEL = 'Files';
export const FILES_HINT_LEAD = 'A name, or a pattern such as ';
export const FILES_HINT_CODE = 'test/**';
export const FILES_HINT_REST = ' for everything in a folder.';
export const MOST_FILES_LABEL = 'Most files';
export const MOST_FILES_HINT = 'Added, changed and removed files all count.';
```

- [ ] **Step 4: The dialog (example-editor.mjs).** Import `PROJECT_KINDS` from checks.mjs and the eight new words from project-text.mjs. In `openCheckDialog`, replace the kinds part (:97-108):

```js
  // An edited script check keeps its kind, also when the Library lists none. The project checks (3a D57, 3b D73) are their own group.
  const resultKinds = CHECK_KINDS.filter((k) => !PROJECT_KINDS.includes(k) && !(k === 'script' && !scripts.length && !(check && check.kind === 'script')));
  if (project) {
    const g1 = el(doc, 'optgroup'); g1.label = GROUP_RESULT;
    for (const k of resultKinds) g1.append(opt(k, k === 'file' ? PROJECT_FILE_KIND_LABEL : undefined));   // D59, board 33
    const g2 = el(doc, 'optgroup'); g2.label = GROUP_PROJECT;
    for (const k of PROJECT_KINDS) g2.append(opt(k));   // board 33's order: the command, then the three file-scope checks
    kind.append(g1, g2);
  } else {
    for (const k of resultKinds) kind.append(opt(k));
    if (check && PROJECT_KINDS.includes(check.kind)) kind.append(opt(check.kind));   // an edited project check keeps its kind
  }
```
In `paintFields`, add before the final `else` (the script branch):
```js
    } else if (kind.value === 'under') {
      const dirs = input('wft-ck-dirs', 'text', Array.isArray(c.dirs) ? c.dirs.join(', ') : '', { maxLength: 2000, className: 'wft-mono' });
      fields.append(field(doc, FOLDERS_LABEL, dirs, { id: dirs.id, hint: FOLDERS_HINT }));
      read = () => ({ kind: 'under', dirs: dirs.value });
    } else if (kind.value === 'unchanged') {
      const pats = input('wft-ck-keep', 'text', Array.isArray(c.patterns) ? c.patterns.join(', ') : '', { maxLength: 2000, className: 'wft-mono' });
      const f = field(doc, FILES_LABEL, pats, { id: pats.id, hint: FILES_HINT_LEAD });
      f.querySelector('.hint').replaceChildren(doc.createTextNode(FILES_HINT_LEAD), el(doc, 'span', 'code', FILES_HINT_CODE), doc.createTextNode(FILES_HINT_REST));
      fields.append(f);
      read = () => ({ kind: 'unchanged', patterns: pats.value });
    } else if (kind.value === 'max-files') {
      const most = input('wft-ck-max', 'text', c.max ?? '', { maxLength: 5, inputMode: 'numeric', className: 'wft-ck-num' });
      fields.append(field(doc, MOST_FILES_LABEL, most, { id: most.id, hint: MOST_FILES_HINT }));
      read = () => ({ kind: 'max-files', max: most.value.trim() });
```
(The branches sit between the `command` branch and the script `else`, in the same `if … else if` chain.)

- [ ] **Step 5: The check's words (test-ui.mjs).** Replace `checkWords`:

```js
/** A check as the editor, the dialog's preview and the side by side write it: the command, folders and patterns in code
 *  (boards 33, 36; P47), any other check as its label. */
export function checkWords(doc, c, label) {
  const s = el(doc, 'span');
  const codes = (list, sep) => list.forEach((x, i) => { if (i) s.append(doc.createTextNode(sep(i, list.length))); s.append(el(doc, 'span', 'code', x)); });
  if (c && c.kind === 'command') s.append(doc.createTextNode('The command '), el(doc, 'span', 'code', c.cmd), doc.createTextNode(' passes'));
  else if (c && c.kind === 'under' && Array.isArray(c.dirs) && c.dirs.length) {
    s.append(doc.createTextNode('Changes only files under '));
    codes(c.dirs, (i, n) => (i === n - 1 ? ' and ' : ', '));
  } else if (c && c.kind === 'unchanged' && Array.isArray(c.patterns) && c.patterns.length) {
    s.append(doc.createTextNode('Leaves these files unchanged: '));
    codes(c.patterns, () => ', ');
  } else s.textContent = label;
  return s;
}
```

- [ ] **Step 6: The side by side (test-compare.mjs).** Import `FAILED_LEAD`, `splitTestName`, `moreNamesText` from project-text.mjs. Replace the `check` lookup (:528-529):

```js
      // Final review M5: a check is set in code, as the editor writes it (checkWords), from the kind and the values its result
      // carries (result.mjs checkTry); 3b adds the folders and patterns of the file-scope checks. An older try shows its label.
      const worded = (x) => x && x.label === label && ((x.kind === 'command' && typeof x.cmd === 'string')
        || (x.kind === 'under' && Array.isArray(x.dirs)) || (x.kind === 'unchanged' && Array.isArray(x.patterns)));
      const check = key === 'checks' ? [cur.a, cur.b].flatMap((v) => (v && v.verdict && v.verdict.checks) || []).find(worded) || null : null;
```
In the not-met block, replace `why.append(words);` with:
```js
          const col = el(doc, 'span', 'wft-why-col');
          col.append(words);
          if (Array.isArray(it.failed) && it.failed.length) col.append(failedLine(doc, it));   // P45
          why.append(col);
```
and add, above `renderSideBySide`:
```js
/** P45: board 36's "Failed: `<file>` · "<test>"" line: up to three names the command's output gave, then "and N more". */
function failedLine(doc, it) {
  const line = el(doc, 'span', 'wft-failed-line');
  line.append(doc.createTextNode(FAILED_LEAD));
  const shown = it.failed.slice(0, 3);
  shown.forEach((name, i) => {
    if (i) line.append(doc.createTextNode('; '));
    const { file, test } = splitTestName(name);
    if (file) line.append(el(doc, 'span', 'code', file), doc.createTextNode(` · "${test}"`));
    else line.append(doc.createTextNode(`"${test}"`));
  });
  const more = Number(it.failedCount || it.failed.length) - shown.length;
  if (more > 0) line.append(doc.createTextNode(` ${moreNamesText(more)}`));
  return line;
}
```

- [ ] **Step 7: Styles.** In `ui/public/style.css`, after 3a's last `.wft-*` rule (before `.wfv-bar .btn`):

```css
/* Workflow tests 3b: board 33's "Most files" box; board 36's Failed line under a command not met. */
.wft-ck-num { max-width: 100px; }
.wft-why-col { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.wft-failed-line { overflow-wrap: anywhere; }
```

- [ ] **Step 8: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-test-scope-checks.test.mjs test/ui-workflow-example-project.test.mjs test/ui-workflow-example-editor.test.mjs test/ui-workflow-test-project-compare.test.mjs test/ui-workflow-test-compare.test.mjs`
Expected: PASS (3a's `.wft-why-cmd` test reads its first `span`, which is now `.wft-why-col` with the same text when no names were read).
Then the design guards and the style.css slicing tests (Global Constraints). Expected: no new failure.

- [ ] **Step 9: Commit**

```bash
git add ui/public/workflows/example-editor.mjs ui/public/workflows/test-ui.mjs ui/public/workflows/test-compare.mjs src/shared/workflow-tests/project-text.mjs ui/public/style.css test/ui-workflow-test-scope-checks.test.mjs
git commit -m "Workflow tests 3b: the file-scope checks in the check dialog and side by side, the Failed line (boards 33, 36)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: UI: Test a version says what Pretend switches off (board 34)

**Precondition:** the controller confirms board 34 is approved and re-reads `project/P3TestVersion.dc.html`.

**Match board 34**, the Pretend option's list (with Pretend picked), after the connectors' lines:
- "Your personal Claude Code plugins, skills and hooks are switched off." when a step runs on Claude Code (P44);
- "The project's own instructions stay on. Its hooks and plugins are switched off." when, also, a chosen example has a project;
- both with a circle-with-a-slash icon (`off`);
- per other engine, after Part 2's connector line for it: "Steps on Codex still use Codex's own plugins and settings. Pretend switches off only Claude Code's." with the alert icon (P43).
- With Real picked, none of these lines.

**Files:**
- Modify: `ui/public/icons.mjs` (a new `off`)
- Modify: `ui/public/workflows/test-dialogs.mjs` (`paintConnectors` :411-450)
- Modify: `src/shared/workflow-tests/project-text.mjs` (board 34's lines)
- Modify: `src/core/workflow-tests/connectors.mjs` (the server's twin of the engine line, beside `engineNoteLine` :31)
- Test: `test/ui-workflow-test-plugins-off-dialog.test.mjs`

**Interfaces:**
- Consumes: the plan's `connectors.personalOff` and `connectors.engines` (Task 10), `projectChosen()` (test-dialogs.mjs).
- Produces: `PLUGINS_OFF_PERSONAL`, `PLUGINS_OFF_PROJECT`, `pluginsEngineNoteLine(label)` (project-text.mjs); the `off` icon.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-plugins-off-dialog.test.mjs`:

```js
// test/ui-workflow-test-plugins-off-dialog.test.mjs — workflow tests 3b, Task 12 (board 34, P43, P44): Test a version says what
// Pretend switches off: the person's own plugins, skills and hooks; the project's hooks and plugins; other engines' own setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openTestVersionDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { icon } from '../ui/public/icons.mjs';
import { PLUGINS_OFF_PERSONAL, PLUGINS_OFF_PROJECT, pluginsEngineNoteLine } from '../src/shared/workflow-tests/project-text.mjs';
import { pluginsEngineNoteLine as serverLine } from '../src/core/workflow-tests/connectors.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const sideOf = (use, short) => ({ use, label: short, short, want: 1, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
function dialog({ projectName = null, connectors = {} } = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const plan = { a: sideOf(2, 'v2'), b: sideOf('draft', 'v3 draft'), examples: 1, tries: 1, perTryMs: null, project: null,
    connectors: { mode: 'pretend', pretend: [], off: [], scripts: [], quickScripts: [], engines: [], personalOff: true, ...connectors } };
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'Ticket 482', tries: 1, ready: true, projectName }], dateText: () => '24 Oct',
    loadPlan: async ({ connectors: mode }) => ({ ...plan, connectors: { ...plan.connectors, mode } }), onStart: async () => ({ ok: true }) });
  return { doc: window.document, window };
}

test('the words, the same on server and browser', () => {
  assert.equal(PLUGINS_OFF_PERSONAL, 'Your personal Claude Code plugins, skills and hooks are switched off.');
  assert.equal(PLUGINS_OFF_PROJECT, "The project's own instructions stay on. Its hooks and plugins are switched off.");
  assert.equal(pluginsEngineNoteLine('Codex'), "Steps on Codex still use Codex's own plugins and settings. Pretend switches off only Claude Code's.");
  assert.equal(serverLine('Codex'), pluginsEngineNoteLine('Codex'));
  assert.match(icon(new JSDOM('').window.document, 'off', 13).innerHTML, /<circle/);
});

test('board 34: Pretend, no project: the personal line only, with the off icon', async () => {
  const { doc } = dialog();
  await tick(); await tick();
  const lines = texts(doc, '.wft-conn-notes li');
  assert.ok(lines.includes(PLUGINS_OFF_PERSONAL));
  assert.ok(!lines.includes(PLUGINS_OFF_PROJECT));
  const li = [...doc.querySelectorAll('.wft-conn-notes li')].find((x) => x.textContent === PLUGINS_OFF_PERSONAL);
  assert.ok(li.querySelector('svg'));
});

test('board 34: Pretend with a project example: both lines, in order; another engine adds its line; Real shows none', async () => {
  const { doc, window } = dialog({ projectName: 'worca-cc', connectors: { engines: ['Codex'] } });
  await tick(); await tick();
  const lines = texts(doc, '.wft-conn-notes li');
  const i = lines.indexOf(PLUGINS_OFF_PERSONAL);
  assert.ok(i >= 0);
  assert.equal(lines[i + 1], PLUGINS_OFF_PROJECT);
  assert.ok(lines.includes(pluginsEngineNoteLine('Codex')));
  const real = doc.querySelector('#wft-tv-conn-real');
  real.checked = true;
  real.dispatchEvent(new window.Event('change'));
  await tick(); await tick();
  assert.ok(!texts(doc, '.wft-conn-notes li').some((t) => t === PLUGINS_OFF_PERSONAL || t === PLUGINS_OFF_PROJECT));
});

test('board 34: Pretend, but no step on Claude Code: no personal line', async () => {
  const { doc } = dialog({ connectors: { personalOff: false, engines: ['Codex'] } });
  await tick(); await tick();
  assert.ok(!texts(doc, '.wft-conn-notes li').includes(PLUGINS_OFF_PERSONAL));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/ui-workflow-test-plugins-off-dialog.test.mjs`
Expected: FAIL: `PLUGINS_OFF_PERSONAL` is not exported.

- [ ] **Step 3: The words and the icon.** Append to `src/shared/workflow-tests/project-text.mjs`, in the board 34 section:

```js
// 3b, board 34 (P43, P44): what Pretend switches off.
export const PLUGINS_OFF_PERSONAL = 'Your personal Claude Code plugins, skills and hooks are switched off.';
export const PLUGINS_OFF_PROJECT = "The project's own instructions stay on. Its hooks and plugins are switched off.";
export const pluginsEngineNoteLine = (label) => `Steps on ${label} still use ${label}'s own plugins and settings. Pretend switches off only Claude Code's.`;
```
In `src/core/workflow-tests/connectors.mjs`, below `engineNoteLine` (:31): `export { pluginsEngineNoteLine } from '../../shared/workflow-tests/project-text.mjs';` (one sentence, two callers).

In `ui/public/icons.mjs`, add beside `none` (:69):
```js
  off: '<circle cx="12" cy="12" r="8.5"></circle><path d="M6 18L18 6"></path>',   // switched off (board 34)
```
If an icons test lists every icon (`Select-String -Path test\*.test.mjs -Pattern "icons.mjs" -List`), add `off` to its list.

- [ ] **Step 4: The lines (test-dialogs.mjs).** Import `PLUGINS_OFF_PERSONAL`, `PLUGINS_OFF_PROJECT`, `pluginsEngineNoteLine` from project-text.mjs. In `paintConnectors`, replace the last line inside `if (c && mode === 'pretend') { … }` (:437, the engines loop) with:

```js
      // 3b (D70, P44): what Pretend switches off in Claude Code, then each other engine's own setup (P43).
      if (c.personalOff) {
        line('off', [PLUGINS_OFF_PERSONAL]);
        if (projectChosen()) line('off', [PLUGINS_OFF_PROJECT]);
      }
      for (const label of c.engines || []) { line('alert', [engineNoteLine(label)]); line('alert', [pluginsEngineNoteLine(label)]); }
```

- [ ] **Step 5: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-test-plugins-off-dialog.test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-project-run.test.mjs`
Expected: PASS. If a 3a dialog test pins the whole list of notes for a plan without `personalOff`, it is unchanged (the flag is absent there); if its plan fixture sets engines, the new plugins line follows each engine line: add it to that expectation.
Then the design guards and the style.css slicing tests. Expected: no new failure.

- [ ] **Step 6: Commit**

```bash
git add ui/public/icons.mjs ui/public/workflows/test-dialogs.mjs src/shared/workflow-tests/project-text.mjs src/core/workflow-tests/connectors.mjs test/ui-workflow-test-plugins-off-dialog.test.mjs
git commit -m "Workflow tests 3b: Test a version says what Pretend switches off (board 34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: UI: before and after side by side, in Test a version and while the test runs (U1–U3, after the mocks are approved)

**Precondition:** the user approved the mocks of U1, U2 and U3 (see "Undrawn UI"). The controller re-reads the mock boards and applies their copy and layout to this task first. The strings below are this plan's proposals.

**Files:**
- Modify: `ui/public/workflows/test-compare.mjs` (the checks table; `devCard` :295-316)
- Modify: `ui/public/workflows/test-dialogs.mjs` (the Time row in `paint`)
- Modify: `ui/public/workflows/test-progress.mjs` (`renderTestProgress` :137, before the phases card :267)
- Modify: `src/shared/workflow-tests/project-text.mjs`
- Modify: `ui/public/style.css`
- Test: `test/ui-workflow-test-before-after.test.mjs`

**Interfaces:**
- Consumes: the command result's `before` (Tasks 8, 9), the plan's `project.before` (Task 10), the progress's `before` (Task 10), Task 8's words.
- Produces: `.wft-before` blocks, the dev card's before fact, the Time row's before clause, `.wft-before-now`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-before-after.test.mjs`:

```js
// test/ui-workflow-test-before-after.test.mjs — workflow tests 3b, Task 13 (U1–U3): the command before and after the change, side
// by side; the before runs in Test a version's Time row; the before phase while the test runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';
import { openTestVersionDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const AT = '2026-10-28T09:00:00.000Z';
const cmd = (over) => ({ id: 'c_1', label: 'The command npm test passes', kind: 'command', cmd: 'npm test', met: false, value: '212 passed, 1 failed', output: 'x', ...over });
function sbs(beforeA, beforeB) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const v = (before, tryId) => ({ tryId, status: 'failed', connectors: 'pretend', text: null, wouldHaveSent: [], answeredReads: [],
    verdict: { basics: [], checks: [cmd(before ? { before } : {})] }, project: { changes: { counts: { added: 0, changed: 0, removed: 0 }, files: [], total: 0, added: 0, removed: 0 }, setup: null } });
  const s = { run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482' }, labels: { a: 'v2', b: 'v3 draft' },
    row: { result: 'worse', a: { passed: 0, total: 1 }, b: { passed: 0, total: 1 } }, connectors: 'pretend', tries: [{ n: 1, a: v(beforeA, 11), b: v(beforeB, 12) }],
    start: { ref: 'main', short: 'abc1234', at: AT, setupCmd: null, setupMs: null }, nothingPushed: true };
  renderSideBySide(root, s, { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} },
    { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  return root;
}

test('U1: tests by name: made pass, still pass, broke (red when above zero), and the rest only when not zero', () => {
  const tests = { ran: true, level: 'tests', beforeOk: false, beforeTimedOut: false, afterOk: false, cached: true, at: AT,
    madePass: { n: 1, names: ['rounds three lines of 0.125 to 0.38'] }, stillPass: { n: 212 }, broke: { n: 1, names: ['adds lines'] },
    stillFailing: { n: 0, names: [] }, added: { n: 3, failing: 1 }, gone: { n: 0, names: [] } };
  const root = sbs(null, tests);
  const box = root.querySelector('.wft-before');
  assert.equal(box.querySelector('.wft-before-h').textContent, 'Before the change · v3 draft');
  assert.deepEqual(texts(box, '.wft-before-row'), ['Tests the change made pass: 1 · "rounds three lines of 0.125 to 0.38"', 'Tests that passed before and still pass: 212',
    'Tests it broke: 1 · "adds lines"', 'New tests: 3, 1 failing']);
  assert.ok(box.classList.contains('is-bad'));
  assert.equal(root.querySelectorAll('.wft-before').length, 1, 'v2\'s try had no before run: nothing for it');
  assert.ok(texts(root, '.wft-dev-facts > span').includes('Before the change: npm test · it failed · 28 Oct · kept from an earlier test'));
});

test('U1: failures only, exit code only, not run', () => {
  const failures = { ran: true, level: 'failures', beforeOk: false, beforeTimedOut: false, afterOk: false, cached: false, at: AT,
    failingNow: { n: 1, names: ['src/a.test.js › t'] }, noLongerFail: { n: 0, names: [] }, stillFailing: { n: 2, names: ['x', 'y'] },
    counts: { before: { passed: 212, failed: 2, skipped: 0 }, after: { passed: 211, failed: 3, skipped: 0 } } };
  const exit = { ran: true, level: 'exit', beforeOk: true, beforeTimedOut: false, afterOk: false, cached: false, at: AT };
  const root = sbs(exit, failures);
  const [a, b] = root.querySelectorAll('.wft-before');
  assert.deepEqual([...a.querySelectorAll(':scope > span')].map((x) => x.textContent), ['It passed before the change: the change broke it.',
    "Worca could not read test names in this command's output, so it compares only whether the command passed."]);
  assert.deepEqual(texts(b, '.wft-before-row'), ['Tests failing now that did not fail before: 1 · "src/a.test.js › t"', 'Tests that failed before and no longer fail: 0',
    'Tests that failed before and still fail: 2 · "x", "y"', 'Passed: 212 before, 211 now']);
  assert.equal(b.querySelector('.hint').textContent, 'This test tool names only the tests that fail, so the tests that pass are counted, not named.');
  const notRun = sbs(null, { ran: false, reason: 'setup' }).querySelector('.wft-before');
  assert.equal(notRun.querySelector(':scope > span').textContent, 'Worca could not run it before the change: the setup step failed.');
});

test('U2: Test a version: the before runs in the Time row, and in its total', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const GB = 2 ** 30;
  const side = (use, short) => ({ use, label: short, short, want: 3, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
  const plan = { a: side(2, 'v2'), b: side('draft', 'v3 draft'), examples: 1, tries: 3, perTryMs: 10 * 60000,
    connectors: { mode: 'pretend', pretend: [], off: [], scripts: [], quickScripts: [], engines: [] },
    project: { names: ['worca-cc'], leftOut: [], disk: { needBytes: GB, freeBytes: 48 * GB, enough: true, text: null }, setupCmd: 'npm ci', setupMs: 2 * 60000,
      before: { runs: 2, ms: 4 * 60000, cmd: 'npm test' } } };
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'Ticket 482', tries: 3, ready: true, projectName: 'worca-cc' }], dateText: () => '24 Oct', loadPlan: async () => plan, onStart: async () => ({ ok: true }) });
  await tick(); await tick();
  const time = window.document.querySelector('.wft-est-row.is-time');
  assert.match(time.textContent, / · first, npm test runs once on 2 start points: about 4 minutes$/);
  assert.deepEqual(texts(time, '.code'), ['npm ci', 'npm test']);
});

test('U3: while the test runs, the before phase card', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const p = { run: { id: 9, kind: 'compare', status: 'running', stopReason: null, stopDetail: null, tries: 1, a: 2, b: 'draft', exampleIds: [1] },
    title: 'Testing your v3 draft', done: 0, total: 2, costUsd: 0, estimateUsd: 2, capUsd: 10, minutesLeft: 20, takenMs: null, quick: null,
    rows: [{ exampleId: 1, name: 'Ticket 482', label: 'v2', dots: ['waiting'], summary: 'Waiting', now: null }],
    project: { phases: null, disk: null, setupStop: null },
    before: { exampleId: 1, exampleName: 'Ticket 482', cmd: 'npm test', phase: 'setup', n: 1, of: 2, startedMs: Date.now() } };
  renderTestProgress(root, p, { back() {}, stop() {}, continue() {}, open() {} }, { doc: window.document, dateText: () => '28 Oct' });
  const card = root.querySelector('.wft-before-now');
  assert.equal(card.querySelector('h3').textContent, 'Before the tries');
  assert.equal(card.querySelector('.wft-before-now-line').textContent, 'Running npm test on the start point of Ticket 482 · 1 of 2');
  assert.equal(card.querySelector('.hint').textContent, 'Running setup');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/ui-workflow-test-before-after.test.mjs`
Expected: FAIL: no `.wft-before` block.

- [ ] **Step 3: The words.** Append to `src/shared/workflow-tests/project-text.mjs`'s 3b section:

```js
// U1's "For developers" fact.
export const DEV_BEFORE_LEAD = 'Before the change: ';
export const devBeforeRest = (b, date) => ` · ${b.beforeOk ? 'it passed' : 'it failed'} · ${date}${b.cached ? BEFORE_KEPT_TEXT : ''}`;
// U2: the Time row.
export const BEFORE_RUNS_LEAD = ' · first, ';
export const BEFORE_RUNS_SEVERAL = 'the command checks';
export const beforeRunsRest = (b) => ` ${b.cmd ? 'runs' : 'run'} once on ${b.runs} ${b.runs === 1 ? 'start point' : 'start points'}${b.ms ? `: ${aboutDuration(b.ms)}` : ''}`;
// U3: the before phase while the test runs.
export const BEFORE_NOW_TITLE = 'Before the tries';
export const BEFORE_NOW_LEAD = 'Running ';
export const beforeNowRest = (b) => ` on the start point of ${b.exampleName} · ${b.n} of ${b.of}`;
export const BEFORE_PHASE = Object.freeze({ copy: 'Preparing a copy of the project', setup: 'Running setup', command: 'Running the command' });
```

- [ ] **Step 4: Side by side (test-compare.mjs).** Import `BEFORE_HEADING`, `beforeExitText`, `beforeNotRunText`, `BEFORE_GROUPS`, `FAILURES_ONLY_NOTE`, `EXIT_ONLY_NOTE`, `passedCountsText`, `addedText`, `moreNamesText`, `DEV_BEFORE_LEAD`, `devBeforeRest` from project-text.mjs. Above `renderSideBySide`, add:

```js
/** U1: the command before and after the change, for one version's try (Task 8's classification). */
function beforeBlock(doc, label, b) {
  const bad = b.ran && ((b.level === 'tests' && b.broke.n > 0) || (b.level === 'failures' && b.failingNow.n > 0));
  const box = el(doc, 'div', `wft-before${bad ? ' is-bad' : ''}`);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `${BEFORE_HEADING} · ${label}`);
  box.append(el(doc, 'b', 'wft-before-h', `${BEFORE_HEADING} · ${label}`));
  if (!b.ran) { box.append(el(doc, 'span', '', beforeNotRunText(b))); return box; }
  const row = (key, n, names = null) => {
    const r = el(doc, 'span', 'wft-before-row');
    r.append(doc.createTextNode(`${BEFORE_GROUPS[key]}: ${n}`));
    if (names && names.length) {
      r.append(doc.createTextNode(' · '));
      names.slice(0, 5).forEach((nm, i) => { if (i) r.append(doc.createTextNode(', ')); r.append(doc.createTextNode(`"${nm}"`)); });
      const more = n - Math.min(5, names.length);
      if (more > 0) r.append(doc.createTextNode(` ${moreNamesText(more)}`));
    }
    return r;
  };
  if (b.level === 'tests') {
    box.append(row('madePass', b.madePass.n, b.madePass.names), row('stillPass', b.stillPass.n), row('broke', b.broke.n, b.broke.names));
    if (b.stillFailing.n) box.append(row('stillFailing', b.stillFailing.n, b.stillFailing.names));
    if (b.added.n) box.append(el(doc, 'span', 'wft-before-row', `${BEFORE_GROUPS.added}: ${addedText(b.added.n, b.added.failing)}`));
    if (b.gone.n) box.append(row('gone', b.gone.n, b.gone.names));
  } else if (b.level === 'failures') {
    box.append(row('failingNow', b.failingNow.n, b.failingNow.names), row('noLongerFail', b.noLongerFail.n, b.noLongerFail.names));
    if (b.stillFailing.n) box.append(row('stillFailing', b.stillFailing.n, b.stillFailing.names));
    if (b.counts && b.counts.before && b.counts.after) box.append(el(doc, 'span', 'wft-before-row', passedCountsText(b.counts.before.passed, b.counts.after.passed)));
    box.append(el(doc, 'span', 'hint', FAILURES_ONLY_NOTE));
  } else {
    box.append(el(doc, 'span', '', beforeExitText(b)), el(doc, 'span', 'hint', EXIT_ONLY_NOTE));
  }
  return box;
}
```
In the checks loop, right after the not-met `for` block (inside `if (key === 'checks') { … }`), add:
```js
        // U1: the command before and after the change, per version.
        for (const [vl, v] of [[s.labels.a, once ? null : cur.a], [s.labels.b, cur.b]]) {
          const it = v && v.verdict ? (v.verdict.checks || []).find((x) => x.label === label) : null;
          if (it && it.kind === 'command' && it.before) row.append(beforeBlock(doc, vl, it.before));
        }
```
In `devCard`, after the setup fact, add:
```js
  // U1: the command's run on the start point (the first command check that has one).
  const withBefore = [cur.b, cur.a].flatMap((v) => (v && v.verdict && v.verdict.checks) || []).find((x) => x && x.kind === 'command' && x.before && x.before.ran);
  if (withBefore) {
    const f = el(doc, 'span');
    f.append(doc.createTextNode(DEV_BEFORE_LEAD), el(doc, 'span', 'code', withBefore.cmd), doc.createTextNode(devBeforeRest(withBefore.before, dateText(withBefore.before.at))));
    facts.append(f);
  }
```
(`facts` is the `.wft-dev-facts` element `devCard` builds at `test-compare.mjs:300`; add the fact before `c.append(h, …, facts)`.)

- [ ] **Step 5: The Time row (test-dialogs.mjs).** Import `BEFORE_RUNS_LEAD`, `BEFORE_RUNS_SEVERAL`, `beforeRunsRest`. In `paint`, replace the Time row's value line and its setup clause:

```js
        const beforeMs = pj.before && pj.before.ms ? pj.before.ms : 0;
        const v = el(doc, 'span', '', aboutDuration(e.minutes * 60000 + beforeMs));
        if (pj.setupCmd && pj.setupMs) v.append(doc.createTextNode(SETUP_TAKES_LEAD), el(doc, 'span', 'code', pj.setupCmd), doc.createTextNode(setupTakesRest(pj.setupMs)));
        // U2: the command checks run once on the start points first (D75).
        if (pj.before) {
          v.append(doc.createTextNode(BEFORE_RUNS_LEAD), pj.before.cmd ? el(doc, 'span', 'code', pj.before.cmd) : doc.createTextNode(BEFORE_RUNS_SEVERAL),
            doc.createTextNode(beforeRunsRest(pj.before)));
        }
```

- [ ] **Step 6: The before phase (test-progress.mjs).** Import `BEFORE_NOW_TITLE`, `BEFORE_NOW_LEAD`, `beforeNowRest`, `BEFORE_PHASE`. Above `renderTestProgress`, add:

```js
/** U3: the before phase (D75): which command runs on which start point, and what it is doing. */
function beforeNowCard(doc, b) {
  const c = el(doc, 'section', 'card wft-before-now');
  c.setAttribute('aria-live', 'polite');
  c.append(el(doc, 'h3', '', BEFORE_NOW_TITLE));
  const line = el(doc, 'p', 'wft-before-now-line');
  line.append(doc.createTextNode(BEFORE_NOW_LEAD), el(doc, 'span', 'code', b.cmd), doc.createTextNode(beforeNowRest(b)));
  c.append(line, el(doc, 'p', 'hint', BEFORE_PHASE[b.phase] || BEFORE_PHASE.command));
  return c;
}
```
and, right before the phases card line (:267):
```js
  if (st === 'running' && p.before) page.append(beforeNowCard(doc, p.before));   // U3
```

- [ ] **Step 7: Styles.** After Task 11's rules in `ui/public/style.css`:

```css
/* Workflow tests 3b, U1 and U3: the command before and after; the before phase. */
.wft-before { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: var(--r-sm);
  background: var(--field); font-size: var(--fs-meta); overflow-wrap: anywhere; }
.wft-before.is-bad { background: var(--red-bg); }
.wft-before-h { font-weight: 600; }
.wft-before-now { display: flex; flex-direction: column; gap: 6px; }
.wft-before-now h3 { margin: 0; font-size: var(--fs-body); }
.wft-before-now-line { margin: 0; }
```
Check `--field` and `--red-bg` exist (`Select-String -Path ui\public\style.css -Pattern "--red-bg:|--field:"`); if one does not, use the token `.wft-why-cmd` uses for its background.

- [ ] **Step 8: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-test-before-after.test.mjs test/ui-workflow-test-project-compare.test.mjs test/ui-workflow-test-project-run.test.mjs test/ui-workflow-test-progress.test.mjs test/ui-workflow-test-dialogs.test.mjs`
Expected: PASS (3a's Time row test has no `before`, so its text is unchanged).
Then the design guards and the style.css slicing tests. Expected: no new failure.

- [ ] **Step 9: Commit**

```bash
git add ui/public/workflows/test-compare.mjs ui/public/workflows/test-dialogs.mjs ui/public/workflows/test-progress.mjs src/shared/workflow-tests/project-text.mjs ui/public/style.css test/ui-workflow-test-before-after.test.mjs
git commit -m "Workflow tests 3b: the command before and after side by side, in Test a version and while it runs (U1-U3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: UI: "Met when it breaks nothing that passed before" in the check dialog and side by side (U4, after the mock is approved)

**Precondition:** the user approved U4's mock (see "Undrawn UI"). The controller re-reads the mock boards and applies their copy and layout to this task first. The strings below are this plan's proposals; the label sentence in `checkLabel` (Task 8) changes with them if the mock changes it.

**Files:**
- Modify: `ui/public/workflows/example-editor.mjs` (`openCheckDialog`'s command branch)
- Modify: `ui/public/workflows/test-ui.mjs` (`checkWords`'s command line, Task 11's version)
- Modify: `ui/public/workflows/test-compare.mjs` (the not-met loop of the checks table, Task 11's version)
- Modify: `src/shared/workflow-tests/project-text.mjs`
- Modify: `ui/public/style.css`
- Test: `test/ui-workflow-test-met-when.test.mjs`

**Interfaces:**
- Consumes: the command check's `metWhen` and its result's `metWhy` (Tasks 8, 9); `COMMAND_TIMED_OUT`, `notMetFor`, `inSentence` (3a's project-text.mjs).
- Produces: `MET_WHEN_LEGEND`, `MET_WHEN_PASSES`, `MET_WHEN_PASSES_SUB`, `MET_WHEN_NOTHING`, `MET_WHEN_NOTHING_SUB`, `MET_WHEN_HINT`, `metFor(label)`, `MET_DESPITE_TEXT`, `metWhyText(metWhy)` (project-text.mjs); `.wft-ck-metwhen`, `.wft-ck-metwhen-hint`, `.wft-met-note`.

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-met-when.test.mjs`:

```js
// test/ui-workflow-test-met-when.test.mjs — workflow tests 3b, Task 14 (U4, D82): "Met when" on the command check (board 33's
// dialog) and the rows it makes in one example side by side (board 36).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCheckDialog } from '../ui/public/workflows/example-editor.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';
import { metWhyText } from '../src/shared/workflow-tests/project-text.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (doc, sel, t) => [...doc.querySelectorAll(sel)].find((x) => x.textContent === t);
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
function dialog(check = null) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const saved = [];
  openCheckDialog({ doc: window.document, win: window, scripts: [], project: true, check, onSave: (c) => saved.push(c) });
  const doc = window.document;
  if (!check) { const k = doc.querySelector('#wft-ck-kind'); k.value = 'command'; k.dispatchEvent(new window.Event('change')); }
  const cmd = doc.querySelector('#wft-ck-cmd');
  if (!check) { cmd.value = 'npm test'; cmd.dispatchEvent(new window.Event('input')); }
  return { doc, window, saved };
}

test('U4, board 33: Met when, under the command; "It passes" by default and not stored; the other choice saved and previewed', async () => {
  const { doc, window, saved } = dialog();
  const fs = doc.querySelector('.wft-ck-metwhen');
  assert.equal(fs.querySelector('legend').textContent, 'Met when');
  assert.deepEqual(texts(fs, '.wft-rad'), ['It passes · the command ends without an error',
    'It breaks nothing that passed before · Worca runs it once on the start point first and compares']);
  assert.equal(fs.querySelector('input[value="passes"]').checked, true);
  assert.equal(doc.querySelector('.wft-ck-metwhen-hint').textContent, 'Use this when some tests already fail on the start point.');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'command', cmd: 'npm test', timeoutMin: 10 }]);
  const two = dialog();
  const r = two.doc.querySelector('.wft-ck-metwhen input[value="breaks-nothing"]');
  r.checked = true;
  r.dispatchEvent(new two.window.Event('change'));
  assert.equal(two.doc.querySelector('.wft-ck-preview').textContent, 'The command npm test breaks nothing that passed before');
  assert.equal(two.doc.querySelector('.wft-ck-preview .code').textContent, 'npm test');
  click(byText(two.doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(two.saved, [{ kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' }]);
  const edit = dialog({ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' });
  assert.equal(edit.doc.querySelector('.wft-ck-metwhen input[value="breaks-nothing"]').checked, true, 'an edited check keeps its choice');
});

const LABEL = 'The command npm test breaks nothing that passed before';
const cmdCheck = (over) => ({ id: 'c_1', label: LABEL, kind: 'command', cmd: 'npm test', metWhen: 'breaks-nothing', output: 'x', ...over });
function side(a, b) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const v = (check, tryId) => ({ tryId, status: check.met ? 'passed' : 'failed', connectors: 'pretend', text: null, wouldHaveSent: [], answeredReads: [],
    verdict: { basics: [], checks: [check] }, project: null });
  renderSideBySide(root, { run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482' },
    labels: { a: 'v2', b: 'v3 draft' }, row: { result: 'worse', a: { passed: 1, total: 1 }, b: { passed: 0, total: 1 } }, connectors: 'pretend',
    tries: [{ n: 1, a: v(a, 11), b: v(b, 12) }], start: null, nothingPushed: false },
  { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} },
  { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  return root;
}

test('U4, board 36: the row reads the choice; met with an error says so; not met says why', () => {
  const root = side(cmdCheck({ met: true, value: '212 passed, 1 failed', metWhy: { why: 'nothing-broke' } }),
    cmdCheck({ met: false, value: '211 passed, 2 failed', metWhy: { why: 'broke', n: 1 } }));
  const row = [...root.querySelectorAll('.wft-crow')].find((r) => r.firstChild.textContent === LABEL);
  assert.deepEqual(texts(row.firstChild, '.code'), ['npm test']);
  assert.deepEqual(texts(row, '.wft-res'), ['212 passed, 1 failed', '211 passed, 2 failed']);
  assert.ok(!row.querySelectorAll('.wft-res')[0].classList.contains('is-bad'), 'met: green, though a test fails');
  assert.equal(row.querySelector('.wft-met-note').textContent, 'Met for v2: the command ended with an error, but no test that passed before fails now.');
  assert.equal(row.querySelector('.wft-why-cmd .wft-why-col').textContent, 'Not met for v3 draft: it broke 1 test that passed before.');
});

test('U4: every not-met reason has its sentence', () => {
  assert.deepEqual([
    metWhyText({ why: 'broke', n: 1 }), metWhyText({ why: 'broke', n: 3 }), metWhyText({ why: 'lost', n: 1 }), metWhyText({ why: 'lost', n: 2 }),
    metWhyText({ why: 'failing-now', n: 1 }), metWhyText({ why: 'failing-now', n: 2 }), metWhyText({ why: 'fewer-pass', before: 212, after: 209 }),
    metWhyText({ why: 'broke-exit' }), metWhyText({ why: 'cannot-tell' }), metWhyText({ why: 'no-before' }), metWhyText({ why: 'timed-out' }),
  ], [
    ' it broke 1 test that passed before.', ' it broke 3 tests that passed before.', ' 1 test that passed before no longer runs.',
    ' 2 tests that passed before no longer run.', ' 1 test fails now that did not fail before.', ' 2 tests fail now that did not fail before.',
    ' fewer tests pass now: 212 before, 209 now.', ' it passed before the change and fails now.',
    ' the command ended with an error, and Worca could not read which tests failed, so it cannot tell whether the change broke something.',
    ' Worca could not run it before the change, so it cannot tell what broke.', ' the command ran longer than its time limit and was stopped.',
  ]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/ui-workflow-test-met-when.test.mjs`
Expected: FAIL: `metWhyText` is not exported.

- [ ] **Step 3: The words.** Append to `src/shared/workflow-tests/project-text.mjs` (after 3a's `COMMAND_TIMED_OUT`, which it uses):

```js
// ── 3b, U4 (D82): "Met when it breaks nothing that passed before" (this plan's proposals until the mock is approved) ───────────
export const MET_WHEN_LEGEND = 'Met when';
export const MET_WHEN_PASSES = 'It passes';
export const MET_WHEN_PASSES_SUB = ' · the command ends without an error';
export const MET_WHEN_NOTHING = 'It breaks nothing that passed before';
export const MET_WHEN_NOTHING_SUB = ' · Worca runs it once on the start point first and compares';
export const MET_WHEN_HINT = 'Use this when some tests already fail on the start point.';
export const metFor = (label) => `Met for ${label}:`;
export const MET_DESPITE_TEXT = ' the command ended with an error, but no test that passed before fails now.';
const nTests = (n) => `${n} ${n === 1 ? 'test' : 'tests'}`;
/** Why a "breaks nothing that passed before" check was not met (commandMet's `why`), after "Not met for <version>:". */
export function metWhyText(w) {
  const n = Number(w && w.n) || 0;
  switch (w && w.why) {
    case 'broke': return ` it broke ${nTests(n)} that passed before.`;
    case 'lost': return ` ${nTests(n)} that passed before ${n === 1 ? 'no longer runs' : 'no longer run'}.`;
    case 'failing-now': return ` ${nTests(n)} ${n === 1 ? 'fails' : 'fail'} now that did not fail before.`;
    case 'fewer-pass': return ` fewer tests pass now: ${w.before} before, ${w.after} now.`;
    case 'broke-exit': return ' it passed before the change and fails now.';
    case 'no-before': return ' Worca could not run it before the change, so it cannot tell what broke.';
    case 'timed-out': return COMMAND_TIMED_OUT;
    default: return ' the command ended with an error, and Worca could not read which tests failed, so it cannot tell whether the change broke something.';
  }
}
```

- [ ] **Step 4: The dialog (example-editor.mjs).** Import the six `MET_WHEN_*` words. In `paintFields`' command branch, replace its `fields.append(…)` and `read = …` lines with:

```js
      // U4 (D82): when the check is met. Radios, as "Read from" (3a P17); the default is not stored (normaliseCheck).
      const mw = el(doc, 'fieldset', 'wft-rads wft-ck-metwhen');
      mw.append(el(doc, 'legend', '', MET_WHEN_LEGEND));
      const pickMw = (value, label, sub) => {
        const l = el(doc, 'label', 'wft-rad');
        const r = el(doc, 'input');
        r.type = 'radio'; r.name = 'wft-ck-metwhen'; r.value = value; r.checked = (c.metWhen || 'passes') === value;
        const words = el(doc, 'span', '', label);
        words.append(el(doc, 'span', 'wft-rad-sub', sub));
        l.append(r, words);
        r.addEventListener('change', paintPreview);
        return l;
      };
      mw.append(pickMw('passes', MET_WHEN_PASSES, MET_WHEN_PASSES_SUB), pickMw('breaks-nothing', MET_WHEN_NOTHING, MET_WHEN_NOTHING_SUB));
      fields.append(field(doc, COMMAND_LABEL, cmd, { id: cmd.id, hint: COMMAND_HINT }), field(doc, TIMEOUT_LABEL, skinned(doc, time, 'wft-ck-time'), { id: time.id, hint: TIMEOUT_HINT }),
        mw, el(doc, 'p', 'hint wft-ck-metwhen-hint', MET_WHEN_HINT));
      read = () => ({ kind: 'command', cmd: cmd.value, timeoutMin: Number(time.value), metWhen: (mw.querySelector('input:checked') || {}).value || 'passes' });
```

- [ ] **Step 5: The line (test-ui.mjs).** In `checkWords`, replace the command line with:

```js
  if (c && c.kind === 'command') s.append(doc.createTextNode('The command '), el(doc, 'span', 'code', c.cmd),
    doc.createTextNode(c.metWhen === 'breaks-nothing' ? ' breaks nothing that passed before' : ' passes'));   // D82, U4
```

- [ ] **Step 6: The rows (test-compare.mjs).** Import `metFor`, `MET_DESPITE_TEXT`, `metWhyText`. In the not-met loop (Task 11's version), replace the loop's first lines up to the `words.append(…)` line with:

```js
        for (const [side, vl, v] of [['a', s.labels.a, once ? null : cur.a], ['b', s.labels.b, cur.b]]) {
          const it = v && v.verdict ? (v.verdict.checks || []).find((x) => x.label === label) : null;
          // U4 (D82): met although the command ended with an error: a neutral note, never the red box.
          if (it && it.met && it.metWhy && it.metWhy.why === 'nothing-broke') {
            const note = el(doc, 'div', 'wft-met-note');
            const w = el(doc, 'span');
            w.append(el(doc, 'b', '', metFor(inSentence(vl))), doc.createTextNode(MET_DESPITE_TEXT));
            note.append(w);
            row.append(note);
            continue;
          }
          if (!it || it.met || (typeof it.output !== 'string' && !it.timedOut && !it.metWhy)) continue;
          const why = el(doc, 'div', 'wft-why-cmd');
          const words = el(doc, 'span');
          words.append(el(doc, 'b', '', notMetFor(inSentence(vl))),
            doc.createTextNode(it.metWhy ? metWhyText(it.metWhy) : it.timedOut ? COMMAND_TIMED_OUT : COMMAND_ENDED));
```
(The rest of the loop, Task 11's `.wft-why-col`, the Failed line and "See the command output", stays.)

- [ ] **Step 7: Styles.** After Task 13's rules:

```css
/* Workflow tests 3b, U4: Met when; a row met although the command ended with an error. */
.wft-ck-metwhen-hint { margin: 0; }
.wft-met-note { grid-column: 1 / -1; padding: 10px 12px; border-radius: var(--r-sm); background: var(--field); font-size: var(--fs-meta); }
```

- [ ] **Step 8: Run the tests and the guards**

Run: `node tools/test.mjs test/ui-workflow-test-met-when.test.mjs test/ui-workflow-test-scope-checks.test.mjs test/ui-workflow-example-project.test.mjs test/ui-workflow-test-project-compare.test.mjs test/ui-workflow-test-before-after.test.mjs`
Expected: PASS (3a's command-check tests save `{ kind, cmd, timeoutMin }` as before: "It passes" is not stored).
Then the design guards and the style.css slicing tests. Expected: no new failure.

- [ ] **Step 9: Commit**

```bash
git add ui/public/workflows/example-editor.mjs ui/public/workflows/test-ui.mjs ui/public/workflows/test-compare.mjs src/shared/workflow-tests/project-text.mjs ui/public/style.css test/ui-workflow-test-met-when.test.mjs
git commit -m "Workflow tests 3b: Met when it breaks nothing that passed before, in the check dialog and side by side (U4, D82)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Docs, the plan, UI levels, the flag, the changelog, and the final verification

**Files:**
- Create: `plans/workflow-tests-part3b-plan.md` (this plan, copied in)
- Modify: `docs/storage.md`: a "Workflow tests 3b (no schema change)" paragraph at the end of 3a's "Workflow tests on a project (v…)" section.
- Modify: `docs/ui-levels.md`: a row after 3a's.
- Modify: `docs/feature-flags.md`: the `workflowTests` row.
- Modify: `docs/changelog/unreleased.md`: a "(Part 3b)" entry after 3a's.
- Modify: `plans/workflow-tests-plan.md` (the overview): the Part 3 line names this plan.

- [ ] **Step 1: Write the docs**

**`docs/storage.md`.** At the end of 3a's section:
```markdown
**Part 3b (no schema change).**

- `<worcaHome>/workflow-tests/before/`: "The command passes" run once on an example's start point, before the workflow
  changed anything.
  - `cache/<projectKey>/<hash>.json`: one kept result per project, start commit, setup command, command and time limit (its
    exit code, its summary line, the end of its output and the test names Worca could read), with the stamp of Worca's copy
    it ran in. Used for 7 days, and not at all once the copy is made again; removed at boot after 7 days.
  - `run-<id>/` and `run-<id>.owner.json`: the clone of Worca's copy one run works in, and who runs it (pid and a heartbeat).
    Removed when the run ends; at boot, when its owner is gone.
- Each copy of a project (`workflow-tests/repos/<projectKey>`) has `.git/worca-copy-made`, written when the copy is made.
- A try's `verdict` (in `wf_test_tries`) gains, on a command check: `ms`, the first failing test names (`failed`,
  `failedCount`) and `before` (what passed and failed before and after the change), and, on a check met when it breaks
  nothing that passed before, `metWhen` and `metWhy` (why it was or was not met); on a file-scope check: its kind and
  folders, patterns or most files.
```

**`docs/ui-levels.md`.** After 3a's row:
```markdown
| Behind the flag `workflowTests`, Simple (Part 3b): in the check dialog, Changes only files under, Leaves these files unchanged, Changes at most N files, and the command check's Met when (it passes, or it breaks nothing that passed before); side by side, their rows, the command's Failed line and the command before and after the change; in Test a version, what Pretend switches off (the person's plugins, skills and hooks; the project's hooks and plugins; other engines) and the before runs in the Time row; while the test runs, the before phase | all |
```

**`docs/feature-flags.md`.** In the `workflowTests` row, after 3a's sentences, add: "With Pretend connectors, a try loads none of your personal Claude Code plugins, skills, agents or hooks (only your sign-in and your own deny rules and sandbox are carried over), and none of the project's own hooks or plugins."

**`docs/changelog/unreleased.md`.** After 3a's entry:
```markdown
## Workflow tests: plugins off, file checks, before and after (Labs, Part 3b)

**Tests of a workflow are no longer shaped by your own Claude Code setup, and they say what a change did to the project's tests.**

- With Pretend connectors, a try loads none of your personal Claude Code plugins, skills, agents or hooks, and none of the
  project's own hooks or plugins. The project's instructions (CLAUDE.md, agents, skills) stay on. Your sign-in and your own deny
  rules and sandbox are carried over, and nothing else from your settings.
- New automatic checks for a project: Changes only files under …, Leaves these files unchanged (names or patterns such as
  `test/**`) and Changes at most N files.
- The command passes now also runs once on the start point, before the change. Side by side shows which tests the change made
  pass, which passed before and still pass, and which it broke (for TAP, node:test, pytest, Jest and Vitest output; other
  commands are compared by whether they passed). Results on a start point are kept for a week.
- The command passes can instead be met when the change breaks nothing that passed before: useful when some tests already
  fail on the start point.
- Not covered yet: hooks an agent writes into the project's settings during a try load in its later steps; steps on other
  engines keep their own plugins and settings.

Chips: Tests · Pretend · The command passes · experimental: turn it on in Settings › Labs

Read it: [Where Worca keeps its state](../storage.md)

Pull requests (add each number when it opens):

- Workflow tests: plugins off, file checks, before and after (#<PR>)
```
Replace `#<PR>` when the PR opens.

**`plans/workflow-tests-plan.md`.** In the Part 3 line 3a added, replace "and the 3b plan to come (plugins off in Pretend, the file-scope checks)" with "and [workflow-tests-part3b-plan.md](workflow-tests-part3b-plan.md) (3b: plugins off in Pretend, the file-scope checks, the command before and after)". Copy this plan to `plans/workflow-tests-part3b-plan.md` (with its checkboxes ticked as the tasks went).

- [ ] **Step 2: Run the docs guards**

Run: `node tools/test.mjs test/ui-levels.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/storage.md docs/ui-levels.md docs/feature-flags.md docs/changelog/unreleased.md plans/workflow-tests-plan.md plans/workflow-tests-part3b-plan.md
git commit -m "Workflow tests 3b: docs (storage, UI levels, flag, changelog Part 3b) and the plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: The final verification**
  1. **Every test file this part touched.** Run `node tools/test.mjs <files>` with the list from `git diff --name-only <base> -- test` (the base in `.superpowers\sdd\base-3b.txt`), each file by name. All must pass; the POSIX-shim tests skip on Windows.
  2. **The full suite against the Task 0 baseline.** Run `node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs C:\Users\BRT1BG\worca-cc\worca-cc-tests3b C:\Users\BRT1BG\worca-cc\worca-cc-tests3b\.superpowers\sdd\final-3b 4 300` and compare its failing files with `baseline-3b-failing.txt`. A new one is this part's until `node tools/test.mjs <file>` on the base and on the branch, back to back, shows otherwise.
  3. **Smoke:** `npm run smoke`.
  4. **A mock end-to-end run in the browser.** Start the UI with `WORCA_FLAGS=workflowTests` and `WORCA_MOCK=1`, a scratch git project registered with a `package.json` whose `test` script prints TAP (`node -e "console.log('TAP version 13\nok 1 - a\n1..1')"`) and a committed `.claude/settings.json` with a `hooks` key.
     - On a coding workflow: an example on the project with "The command `npm test` passes", "Changes only files under `src/`", "Leaves these files unchanged: `test/**`", "Changes at most 3 files".
     - Test a version: the Pretend list shows the two board 34 lines; the Time row shows the before runs (U2). While it runs: the before phase card (U3), then the tries.
     - Side by side: the scope rows (Met / values), the command row's before block (U1), the For developers fact.
     - A second test of the same example: no before run (kept); the Time row has no before clause.
     - Check light and dark at 1440 px and 390 px against boards 33, 34, 36 and the approved U1–U3 mocks.
     - Set the command check to "It breaks nothing that passed before" with the start point's `test` script printing one failing
       test, and a draft that adds a passing test: its row is met, with the U4 note; a draft that breaks the passing test: not met, "it broke 1 test that passed before.".
     - Check U4's screens against its approved mock too.
     - After the test: `<home>\workflow-tests\before\` holds only `cache\`, and the try's checkout is gone (3a).
     - For D84: record the before runs' times (`ms` in `before\cache\*\*.json`) and the size of one before-run clone while it runs (`dirBytes`), in the PR body.
  5. **The proofs:** `real-call-proof-3b.md` holds the free proof, the test-output formats check, the security review, and (only if the user said yes) the paid proof.
  6. **Not covered by 3b, stated in the PR:** hooks an agent writes into the project's settings mid-try load in later steps; other engines keep their own plugins; Pretend tries made before 3b can be reused; test names only from the formats D74 lists; a flaky test can show as broken.

- [ ] **Step 5: Before the PR (needs the user's go)**
  - **PR body:** the `npm test` comparison and smoke; UI level Simple, flag `workflowTests`; screenshots of boards 33, 34, 36 and U1–U3, light, dark and 390 px; the proofs' results; the security review's summary; "Part 3b of the workflow tests issue; stacked on 3a".
  - **Schema:** none (D79). If `dev` changed the schema meanwhile, nothing here moves.

---

## Later (after 3b)

- Strip the project's Claude Code hooks and plugins again before each step of a Pretend try (closes D72's mid-try limit).
- Naming the tests that should now pass (the user's own FAIL_TO_PASS list; `plans/workflow-tests-eval-frameworks.md` §7).
- Flaky tests: run the command on the start point twice, and a failing test again, before calling it broken.
- Exact names from machine-readable reporters (`jest --json`, `vitest --reporter=json`, JUnit XML) when the command writes them.
- "See the output before the change" (U1's optional button), from the kept result's tail.
- A separate local clone per try: decided after 3b (D84), with the before runs' clone times and disk figures Task 15 records.
- Plugins off for other engines (Codex, Gemini CLI, Copilot, Cursor, OpenCode), each by its own mechanism.
- 3a's Later items that are still open: Folder projects (Q1 b), workspace workflows, hidden test files, "A result you liked", Your criteria (Part 4), the egress proxy, Git LFS and submodules, one try at a time for large copies, a setup that changes tracked files.

---

## Self-review (done while writing; kept for the reviewer)

- **Scope coverage:**
  - Plugins off (D46, Q7, Q8): `settingSources: ['project','local']` for Pretend tries, no-project and project → Task 2 (runOpts, orchestrator) and Task 3's API test; only the sign-in carried (`userClaudeSignIn`'s rule, `isSignInEnvKey`, helpers in `--settings`) → Tasks 1, 2; the copy's committed `.claude/settings.json` loses `hooks` and `enabledPlugins`, kept out of the diff → Task 3; project CLAUDE.md, agents and skills stay → Task 3's tests, Task 4's proof; other engines' note → Tasks 10, 12; board 34's two "Part 3b" lines → Task 12; the brief §6 free proof (sandbox `CLAUDE_CONFIG_DIR`, a plugin, marker hooks) → Task 4 Steps 1–3; the paid proof (Haiku, the Claude sign-in, $3, controller only) → Task 4 Step 6, with the user-hook part moved to the free proof (correction 10, O3); the security review of the carry-over → Task 5.
  - File-scope checks (Q10): the three kinds, pure in `src/shared/workflow-tests/checks.mjs`, reading the change list → Task 6; renames decided (both paths for the folder and unchanged checks, once for the count, a copy's new path only: D73) → Task 6's tests; board 33's fields → Task 11; board 36's rows → Task 11.
  - Before and after: runs once on the start commit, cached per start point, setup and command → Tasks 9, 10; the three groups (made pass, still pass, broke) → Task 8; what is parseable (exit code always; names for TAP, node:test spec, pytest -rA / -v, Jest verbose, Vitest verbose; failures only for the defaults; what is shown otherwise) → D74, D76, Tasks 7, 8; where it runs (a clone of Worca's copy at the start commit, the try's guard env and `tryGitEnv`) → D75, Task 9; its cost and time → D75, Task 10's estimate, U2; cache invalidation (start point, setup, command, time limit, the copy made again, 7 days) → D75, Task 9's tests.
  - The user's decisions of 2026-11-02 → D81 (Task 2 Step 9, Task 5 question 11), D82 (`commandMet` and `metWhen` in Task 8, the judging in Task 9, the editor and rows in Task 14; U4), D83 (Task 4, correction 10), D84 ("Later"; Task 15 records the figures), D85 (Task 5 question 9). The "Open items" section only points at them.
  - D82's judging is stated per level (tests by name, failures only, exit code only, not run, time-out), and its fingerprint effect (the default is not stored) is tested in Task 8.
  - Undrawn UI → "Undrawn UI" U1–U4; Task 13 waits for U1–U3, Task 14 for U4.
- **Placeholders.** None. Decided by a named rule at execution time, not left open: Task 4 Step 4 (JSONC follows the CLI), Task 4 Step 2's stop rule, Task 5's fixes (each a test), Task 7 Step 5 (real outputs become fixtures), Tasks 13 and 14's copy (the approved mocks win).
- **Names across tasks.**
  - `readUserSignIn`, `isSignInEnvKey`, `SIGN_IN_SETTINGS_KEYS`, `userSettingsFile` (Task 1) → Task 2 (`signInCarry`), Task 4 Step 6. `readUserSafety`, `SAFETY_DENY_MAX`, `safetySettings`, `signInCarry`'s `safety` (Task 2 Step 9) → Tasks 4 (Step 4), 5.
  - `signInCarry`, `secretValuesOf`, `signInSettings`, `signInEnv`, `pluginsOff`, `PLUGINS_OFF_SOURCES`, `personalOff` (Task 2) → Tasks 3, 4.
  - `stripProjectClaudeSettings`, `strippedSettingsText`, `PROJECT_SETTINGS_FILES`, `_tryPluginPaths` (Task 3) → Task 4's proof.
  - `SCOPE_KINDS`, `pathMatches`, `touched`, the scope results' `kind`/`dirs`/`patterns`/`max` (Task 6) → Task 11.
  - `createTestOutputParser`, `parseTestOutput` (Task 7) → Task 9 (`runCommandCheck`, `beforeRun`).
  - `beforeAfter` (with `lostPass`), `commandMet`, `COMMAND_MET_WHEN`, the check's `metWhen`, the words, `splitTestName`, `FAILED_LEAD`, `moreNamesText` (Task 8) → Tasks 9, 11, 13, 14. The result's `metWhen`/`metWhy` (Task 9) → Task 14 (`metWhyText`).
  - `beforeRun`, `readBefore`, `beforeSpecOf`, `beforeHash`, `sweepBeforeRuns`, `cloneForBefore`, `copyStamp`, `COPY_STAMP_FILE`, `beforeRoot`, `checkTry({ beforeOf })`, the command result's `ms`/`failed`/`failedCount`/`before` (Task 9) → Tasks 10, 11, 13.
  - `beforePlanOf` (`project.before`), `beforeNowOf` (the progress's `before`), `lastCommandMs`, `connectorNotes().personalOff` (Task 10) → Tasks 12, 13.
- **Constraints.** No schema change and no route; no identifier called `version`; tokens and type steps only in the CSS; the one new icon is `off`; no new checkbox; tests read no `plans/` file and call no model; the two real-CLI runs are a script and a controller step outside `test/`; nothing writes to the person's repository or their `~/.claude`.
