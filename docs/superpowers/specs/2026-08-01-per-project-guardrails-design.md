# Per-Project Guardrails — Design

Date: 2026-08-01
Status: Implemented (v3 — preset levels + Projects-view UI; deny-only per-member repo-settings lift)

All file:line references below point at the **implemented** code unless a line is explicitly marked pre-implementation.

## Problem

Worca spawned Claude Code agents with `--permission-mode acceptEdits` and no security policy. Before this work (line refs in this section are pre-implementation):

- A project's committed `.claude/settings.json` was discovered but **dropped with a warning** on workspace runs (`src/core/run-context.mjs:238-266`, warning at `:1212-1226`) — its permission rules and hooks were not in force.
- The spawned `claude` process inherited the **full parent environment** (`src/core/claude-runner.mjs:241` passed no `env`), including any cloud credentials or tokens present in the worca server's environment.
- There was no per-project deny list, protected paths, or any way to constrain what agents may read, write, or execute in a given project.
- Plugin agent frontmatter can only **widen** `--allowedTools` (`src/core/phases.mjs:46-61` is union-only); nothing caps it.

## v1 Scope (approved)

1. **Honor repo `.claude/settings.json`** — per-project toggle, **on by default**.
2. **Env scrub on agent spawn** — per-project toggle, **off by default**, with pass-through allowlist.
3. **Protected paths + raw deny rules** — per-project lists generating Claude Code `permissions.deny` rules.

Explicitly deferred: per-project `permissionMode` selector, network/sandbox config, plugin-declared permissions, PreToolUse policy hooks, tool-cap intersect.

**v3 change:** these three knobs ship as the 5-key `settings` shape *behind* four preset **levels** (Permissive / Normal / Secure++ / Custom) — the levels are the user-facing feature; the knobs are what enforcement consumes.

## Config Model

Stored in `project_config.extra.guardrails` (`src/core/db.mjs:202`). The `extra` blob already round-trips unknown top-level keys through every writer (`src/core/config.mjs:201, 300, 473`, reader at `:382-390`), so older worca versions preserve the key. No migration.

**v3 change — the stored shape is `{ level, custom }`, not a bare settings blob** (`src/core/guardrails.mjs:157-204`):

```json
{
  "guardrails": {
    "level": "secure",
    "custom": {
      "honorProjectSettings": true,
      "envScrub": false,
      "envAllowlist": ["NPM_TOKEN"],
      "protectedPaths": [".env*", "**/secrets/**"],
      "deny": ["Bash(git push)", "Bash(git push:*)"]
    }
  }
}
```

- `level` is one of `permissive` | `normal` | `secure` | `custom` (`GUARDRAIL_LEVELS`, `guardrails.mjs:28`). **Preset levels resolve from code at read time** (`GUARDRAIL_PRESETS`, `guardrails.mjs:64-101`), never from a snapshot — a preset improvement ships with a worca upgrade and applies to every project on that level. `custom` pins the user's settings verbatim.
- `custom` is **persisted alongside a preset level and stays dormant** until `level === 'custom'`, so switching Normal → Secure++ → Custom restores the user's blob instead of losing it. It is replaced **whole** on save (no field patching).
- **v1 upgrade path:** a bare 5-key blob (the v1 storage shape) read by `sanitizeGuardrailsConfig` upgrades losslessly to `{ level: 'custom', custom: <blob> }` (`guardrails.mjs:177`). An unknown/absent level fails open to `permissive`.
- `permissive` **is** `DEFAULT_GUARDRAILS` (the same object, `guardrails.mjs:65`): an unconfigured project and an explicitly-permissive project are indistinguishable, down to byte-identical spawn argv and env. That is the legacy-parity invariant.

The resolved (effective) shape enforcement consumes is always these five keys:

- `protectedPaths` — convenience list. Each entry `p` expands to **`Read(p)` + `Edit(p)` ONLY** (`guardrailsToPermissionRules`, `guardrails.mjs:242-254`). **v3 change:** the v1 `Write(p)` leg is gone — Claude Code never consults `Write(path)` rules for file permissions (`Edit` already covers Write/NotebookEdit) *and* on CLI 2.1.210+ each `Write()` deny prints a stderr warning per rule per spawn, which `runReal` folds into the failure message (one per protected path, per spawn: Normal would emit 7, Secure++ 23). `Read` is the load-bearing secret guard, and a `Read` deny also blocks `Edit` (≥2.1.208). Edit-only protection is expressed via a raw `deny` entry instead.
  **Anchoring rule (unchanged):** a slash-less pattern (`.env*`) matches at any depth; a slash-containing pattern MUST carry a `**/` prefix (`**/secrets/**`, `**/.git/config`) or it anchors to cwd and matches nothing on a detached workspace run, whose cwd is the run root.
- `deny` — raw Claude Code permission rules passed through verbatim (shape-validated, `isPermissionRule`, `guardrails.mjs:109-113`). Power-user escape hatch.
- `envAllowlist` — env var names passed through to the spawned process when `envScrub` is on. Ignored when off. In a workspace union it is unioned **only over members that actually scrub**, so a non-scrubbing member's dormant allowlist can never punch a hole in another member's scrub (`unionGuardrails`, `guardrails.mjs:285-302`).
- `honorProjectSettings` — controls worca's *active* lifting of the repo's `.claude/settings.json` `deny` rules on workspace runs (see Delivery). Honest limitation: on single-project runs where `cwd` is the project worktree, `claude` loads repo settings natively regardless; the toggle cannot un-load them. Off means worca stops lifting; native behavior is untouched.

**Deny-rule spelling convention:** Bash rules are written as an exact + prefix **pair** — `Bash(git push)` + `Bash(git push:*)`, `Bash(curl)` + `Bash(curl:*)` — not the v1 `Bash(git push *)` / `Bash(curl *)` spelling. This is a **legibility / old-CLI convention, not a correctness requirement**: live-verified on `claude` 2.1.220, the `:*` leg already matches the bare command. Writing both makes the intent explicit and stays correct on older CLIs.

Effective settings are resolved at read time by `readGuardrails` → `resolveGuardrails` (`src/core/config.mjs:508-510`, `src/core/guardrails.mjs:211-215`); `readGuardrailsConfig` (`config.mjs:517-521`) additionally returns `{level, custom, effective}` for the UI/API.

## Delivery (Approach C — hybrid)

```
project_config.extra.guardrails  ({level, custom})
  → readGuardrails / resolveGuardrails (config.mjs:508, guardrails.mjs:211) — level → effective 5 keys
  → orchestrator._resolveGuardrails (orchestrator.mjs:1082) — per-member read, deny-safe union
      · called from run() (:472) AND resume() (:756)
  → orchestrator ctx.claudeOpts (:2528, :2609) → runOpts (phases.mjs:396-429) — all pipeline call sites
  → runClaude destructure gate + runReal forwarding (claude-runner.mjs:210-262, 314-327)
  → buildClaudeArgs → buildSettingsArgs: emits --settings '{"permissions":{"deny":[...]}}' when non-empty
  → runReal spawn: env = buildSpawnEnv(scrub, allowlist) when envScrub (claude-runner.mjs:323-327)
```

- **Worca policy always via `--settings`** inline JSON built in `buildSettingsArgs` (`src/core/claude-runner.mjs:103-114`, called from `buildClaudeArgs:302`). The existing telemetry-hook `--settings` seam (`subagentHooksEnabled`, `:72-75`, gated by `WORCA_SUBAGENT_HOOKS`) merges into the **same single payload** — never two `--settings` flags.
- **Repo settings (v3 change — `deny` only, gated per member):** single-project runs (cwd = project worktree) rely on claude's native project-settings loading. On workspace runs, `discoverProjectSettings` (`src/core/run-context.mjs:259-271`) returns each member's file, and `pickPermissions` (`:282-286`) lifts **only its `deny` rules** into the merged payload — gated by **that member's own** `honorProjectSettings` via the `honorByKey` map (`run-context.mjs:1255-1257`, built in `orchestrator._resolveGuardrails:1088-1090`), never by the union's any-true scalar.
  *Why this narrows the v1 spec:* (a) lifting `allow`/`ask` into the CLI `--settings` payload — which is **user scope** — would *widen* a run's capability (a read-only planner could gain auto-approved `Bash`) and bypass Claude Code's own workspace-trust gate, under which committed project-scope `allow` rules are ignored in headless `-p` mode. `deny` is pure restriction, so `deny` alone is safe to lift. (b) An any-true honor gate would let one unconfigured member (default `true`) force-lift a member that explicitly saved `false`, breaking the "a member can never relax another member's policy" invariant.
  The §8.19 warning is preserved for everything still *not* in force; when a member's deny rules were lifted, `permissions` leaves the not-in-force key list and the warning gains the sentence `Its deny rules WERE lifted into this run's --settings.` (`run-context.mjs:1266-1275` — the word "permissions" is deliberately absent from that sentence so the keys-list assertion stays grep-safe). Repo **hooks**/statusline stay warned on workspace runs (relative script paths are unreliable when cwd is not the project dir).
- **Enforcement guarantee**: Claude Code merges `deny` rules across all scopes and lower scopes cannot remove them — repo settings cannot undo worca policy, and plugin-granted tools remain subject to it.
- **Env scrub**: spawn env = minimal base (`PATH`, `HOME`, `TMPDIR`, locale/tty vars) **+ proxy/CA connectivity vars** (`HTTP(S)_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR` — without them a scrubbed run behind a TLS-intercepting corporate proxy fails on every spawn) + claude auth vars (`ANTHROPIC_` / `CLAUDE_` prefixes — the CLI needs its own credentials) + `envAllowlist` (`SPAWN_ENV_BASE` / `buildSpawnEnv`, `src/core/claude-runner.mjs:129-162`). Pattern precedent: `src/core/plugin-shim.mjs:109-115`.
  **v3 change — worca does NOT set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`.** The v1 spec called for it; live verification against `claude` 2.1.220 (2026-08-01) showed a truthy value **forces the child's permission mode to `default`** (stderr: *"Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set…"*), overriding worca's `--permission-mode acceptEdits` and breaking every scrubbed pipeline run. The marker is deliberately omitted; `buildSpawnEnv`'s JSDoc records the reason and the "do not reinstate without re-verifying" caveat. Cloud-provider credentials (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_*`) are intentionally **not** in the base keep-list — a Bedrock/Vertex/Foundry deployment allowlists them per project. Same for `SSH_AUTH_SOCK` / `GIT_*` if a run needs git-over-SSH or an env-supplied git identity.
  **Parent-env passthrough hazard:** not setting the marker is not the same as blocking it — if the *operator's own* environment already exports `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, it survives the scrub via the `CLAUDE_` prefix keep-rule and inflicts exactly the breakage worca avoids (spawned `claude` forced to permission-mode `default`). Unset it in the shell that launches worca, or expect degraded scrubbed runs.
- **Coverage**: all pipeline roles via `runOpts`, in-run **title generation** (`src/core/title.mjs:46-51`, fed from `orchestrator.mjs:3427-3431` — it bypasses `runOpts`, so it forwards the env opts explicitly), plus the workspace scanner (`resolveScanGuardrails`, `src/core/workspace-scan.mjs:56-64`, applied at `:304-306, :332`).
  *Workspace-scan settings asymmetry:* the scanner's cwd is the **primary** member's real checkout, so only that repo's committed `.claude/settings.json` loads natively; the scan path performs **no repo-settings lift** for the other members. The guardrail union (denies + scrub) still applies across all of them.
  Exempt (documented, deliberate): `overview-agent.mjs` and `agent-gen.mjs` (UI-triggered utility agents outside any pipeline run), the `graphify` graph-build subprocess (`src/core/preflight.mjs:225-229`, full parent env), the `claude --help`/`--version` capability probe (`preflight.mjs:337-338`), and the plugin task-source connector (`plugin-shim.mjs` spawns node, not claude, and already scrubs to `PATH`+`HOME`).
- **Resume**: `_resolveGuardrails()` runs in `run()` **and** `resume()` (`orchestrator.mjs:472, :756`), so a run resumed after a guardrails edit enforces the **latest saved policy** — and rewrites the `run.json` audit accordingly.
- **Audit**: the resolved effective policy summary `{envScrub, denyCount, protectedCount}` is written to `run.json` by `_assembleContext` via `updateRunManifest` (`src/core/orchestrator.mjs:1140-1154`) — the one site where both the union and the FINAL post-lift rule set are in scope on `run()` and `resume()`. `denyCount` includes the lifted repo deny rules, whose exact list is persisted alongside as `run.json.projectPermissions`. `run.json` is a detached-run artifact, so legacy runs carry no audit record.

## UI + API

**v3 change:** the UI lives in the **Projects view** as a per-row accordion panel (not a section of the config view), and the write path is a dedicated endpoint.

- **API**:
  - `GET /api/config` (`ui/server.mjs:1693-1725`) serves the preset tables `guardrailPresets` / `guardrailLevels` (from `src/core/guardrails.mjs`) in **both** branches — project-less and project-scoped — so clients never duplicate the tables and can never skew from the server's version. `config.guardrails` is overwritten server-side with the **normalized** `{level, custom, effective}` shape (`readGuardrailsConfig`), so clients never parse a legacy blob.
  - `POST /api/config/guardrails` (`ui/server.mjs:1817-1831`) takes `{ projectDir, guardrails: { level, custom? } }` and returns the normalized record. `resolveProjectDir` is applied to the body's `projectDir` (raw trimming could key a different row for symlinks). Validation (`validateGuardrailsConfig`, `guardrails.mjs:186-204`): `level` must be a known level; `custom` must be the 5-key shape (booleans; arrays of non-empty strings; `deny` entries must additionally match the permission-rule shape — `Tool(pattern)`, a bare tool name (Secure++ itself ships bare `WebFetch`/`WebSearch`), or a glob; `protectedPaths` / `envAllowlist` are plain strings); unknown keys rejected; `level: 'custom'` with neither a payload nor a stored blob is a 400.
- **UI** (`ui/public/app.js:4928-5146`): each project row in the Projects view expands into a guardrails panel — a 4-way `.seg` level selector (Permissive / Normal / Secure++ / Custom), the honor-repo-settings and env-scrub `.switch` toggles, and three row editors with `+ add` / `✕` (env allowlist, protected paths, deny rules). Editing **any** setting flips the draft to Custom (`grMutateSettings` → `grDetectPreset`); Save/Discard are enabled only while dirty. All panel state (open rows, drafts, stored custom) lives in module-level stores keyed by project name, because the WebSocket `projects-changed` path rebuilds the list DOM wholesale.
- **Run-detail badge — DEFERRED (v3, out of scope for this plan).** The `run.json` audit field (see Delivery → Audit) already records the applied policy, so a read-only, non-blocking badge is a purely additive follow-up requiring no enforcement change.
- **CLI**: nothing new; policy is picked up automatically through `readGuardrails` on run start and resume.

## Errors + Edge Cases

- Repo settings unparseable → skip the lift, still warn via the existing `run-context.mjs` warning channel (`discoverProjectSettings` returns `{keys:null}`: we cannot prove an unreadable file carries nothing). Never abort the run.
- Malformed guardrails blob (hand-edited DB) → fall back to Permissive, **silently and intentionally**. This amends the v1 "log a warning" line: `readGuardrails` runs per member on every run *and* resume, so a per-read warning would be pure noise, and fail-open to legacy parity (an unreadable policy behaves exactly like an unconfigured project) is the deliberate priority. The write path is where malformed input is rejected loudly (400). Downgrade consequence: a policy saved at a level a *newer* worca knows and an older one does not reads as unknown on the older version and therefore enforces as **Permissive** — downgrading silently weakens an already-saved policy (the write path stays strict, so the blob itself is never damaged).
- Invalid rule strings rejected at API save (`validateGuardrails`); the read path additionally drops non-string / non-rule entries silently (`sanitizeGuardrails`, defense in depth).
- Empty policy → no `permissions` key and no `--settings` flag emitted; argv and env are byte-identical to a pre-guardrails run, and the existing `spawn-args` assertions keep passing.
- Mock mode → guardrails never reach a spawn (the mock path never spawns `claude`).
- Env scrub breaking a pipeline that needed an unlisted var → run fails visibly (tool errors in the transcript); UI help text points at the allowlist. No silent fallback to the full environment.

## Testing (as implemented)

- `test/guardrails.test.mjs`: the pure policy module — level resolution from code, `{level, custom}` sanitize/validate, v1 bare-blob upgrade, `detectPreset` order-insensitivity, `Read`+`Edit`-only expansion (no `Write`), deny-safe `unionGuardrails` incl. the scrubbers-only allowlist union.
- `test/spawn-args.test.mjs`: `--settings` payload for `deny` + `protectedPaths` expansion; telemetry-hook merge into a **single** flag; flag absent when policy empty; end-to-end forwarding through the `runClaude` destructure gate; `buildSpawnEnv` — scrub off → `undefined` (spawn inherits, byte-identical to pre-guardrails), scrub on → base + `ANTHROPIC_`/`CLAUDE_` + allowlist only.
- `test/config-guardrails.test.mjs`: stored `{level, custom}` round-trip, dormant-custom preservation across level switches, other `extra` keys untouched.
- `test/run-context-guardrails.test.mjs`: `discoverProjectSettings`/`pickPermissions` — `deny` only (strings), `allow`/`ask` dropped; unparseable → `keys:null` + `permissions:null`.
- `test/run-context.test.mjs` (§8.19 v2 tests, `:1124-1192`, next to the unchanged v1 ones at `:1035-1122`): the deny-only lift into `rc.projectPermissions` + `run.json`, the appended warning sentence, a permissions-only file lifting silently (no warning for that member), and the per-member `honorByKey` gate (an opted-out member's rules stay out while its neighbour's are lifted). The pre-existing §8.19 warning assertions are unchanged by design — their fixtures carry `allow`-only `permissions`, which are never lifted.
- `test/orchestrator-guardrails.test.mjs`: resolution at run start **and** on resume (the headline regression: a resumed run must enforce the latest saved policy), and the `run.json` audit record.
- `test/workspace-scan-guardrails.test.mjs`: `resolveScanGuardrails` unions member policies deny-safely (preset + custom mix); an all-permissive workspace leaves every field `undefined` (legacy parity).
- `test/config-api.test.mjs`: `GET /api/config` serves `guardrailPresets`/`guardrailLevels` + normalized `config.guardrails` in both branches; `POST /api/config/guardrails` validation 400s and persisted shape.
- `test/ui-projects-guardrails.test.mjs`: jsdom panel tests — level selection, dirty→Custom auto-switch, row editors, save/discard, error path.

## Decisions Log

- Config home: **both** worca UI (project_config.extra) and repo `.claude/settings.json` honored.
- `honorProjectSettings` default: **on**.
- `envScrub` default: **off** (opt-in; non-breaking for pipelines needing tokens) — turned on by the Secure++ preset.
- v1 batch: env scrub + honor repo settings + protected paths/deny rules. Per-project `permissionMode` deferred.
- Delivery: **Approach C (hybrid)** — native repo-settings loading where cwd allows; permissions merge for workspace runs; worca policy always via `--settings`; env scrub via spawn `env` option.

v3 decisions (each amends a v1 line above):

- **Preset levels are the feature.** Storage is `{level, custom}`; presets resolve from code so upgrades ship policy improvements; `custom` is replaced whole on save and persists dormantly across preset switches.
- **Repo-settings lift is `deny`-only and gated per member.** Lifting `allow`/`ask` would widen capability and bypass the workspace-trust gate; an any-true honor gate would let one member override another's opt-out.
- **`protectedPaths` expand to `Read` + `Edit` only.** `Write(path)` denies are never consulted by Claude Code and emit a stderr warning per rule per spawn.
- **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` is NOT set** (reverses the v1 Delivery line): live-verified on CLI 2.1.220, it forces the child's permission mode to `default` and would break every scrubbed pipeline run.
- **The env keep-list includes proxy/CA connectivity vars**, but never cloud credentials — those are per-project allowlist entries.
- **Guardrails re-resolve on `resume()`**, so a paused run picks up a policy edit; the `run.json` audit is rewritten to match.
- **Malformed stored blob fails open to Permissive, silently** — legacy parity beats a per-read warning on a per-node hot path.
- **Run-detail "policy applied" badge: deferred**, made purely additive by the `run.json` audit field.
