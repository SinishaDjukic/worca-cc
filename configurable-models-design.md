# Configurable Models — Design

Status: draft
Scope decided: **editable global catalog** + **per-model env routing**. Explicitly out of scope: named profile indirection, a worca-level default model, and the native `/orchestrate` skill path (see §8).

## 1. Problem

The model catalog is a hardcoded array (`PREDEFINED_MODELS`, `src/core/config.mjs:59-71`). The only escape hatch is per-project custom models — bare `{id, label}` pairs stored in the project's DB row, granted the full effort set unconditionally, re-entered per repo via a `window.prompt()` flow. There is no way to:

1. define a model once and use it across all projects,
2. declare which efforts a custom model actually supports,
3. route a model to an alternative endpoint (proxy, gateway, fine-tune host) — the entire integration surface is `--model <id>` on the spawned `claude` CLI, which reads its endpoint/auth from ambient `ANTHROPIC_*` env that worca never sets.

## 2. Goals

- A **global model catalog** persisted in worca settings, editable from the UI, that supersedes per-project custom models as the way to add models.
- **Per-model env injection**: a catalog entry may carry an `env` map (e.g. `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) that worca merges into the spawned `claude` process's environment whenever that model is dispatched.
- A **reserved-key policy** so injected env cannot subvert worca's own runtime knobs.
- Consistent **write-time validation** of model selections (today `setStep` validates, `setNodeModel` does not — `src/core/config.mjs:219-227` vs `:404`, acknowledged at `ui/server.mjs:1864-1866`).

## 3. Non-goals

- **Named profiles** ("fast" → id indirection). Workflows keep referencing concrete model ids.
- **A worca-level default model.** When nothing is configured, no `--model` flag is passed and the installed CLI's default applies — unchanged. We only make the resolved model *visible* (§4.7).
- **The `/orchestrate` skill's native path.** Its tier table and duplicated catalog (`.claude/skills/orchestrate/references/models.md`) stay as-is; drift is accepted and documented there.
- **Provider abstraction.** No provider field, no non-CLI transport. Env routing works with anything the `claude` CLI itself can reach (Anthropic API, OpenAI-compatible gateways via `ANTHROPIC_BASE_URL`, Bedrock/Vertex via their documented env).
- **Per-model pricing.** Cost stays whatever the CLI's `result` events report; §4.6 covers the honesty measures.

## 4. Design

### 4.1 Storage: `models` key in global settings

The catalog lives in `~/.worca-cc/settings.json` under a new `models` key, read/written through `src/core/settings.mjs`'s existing read-modify-write + atomic temp/rename machinery (new keys need no migration by that file's contract, `settings.mjs:17-19`).

```jsonc
{
  "models": [
    {
      "id": "glm-4.7",                       // what is passed to `claude --model`
      "label": "GLM 4.7 (proxy)",            // display name; defaults to id
      "efforts": ["medium", "high"],         // subset of EFFORTS; defaults to all
      "env": {                                // optional; merged into the spawn env
        "ANTHROPIC_BASE_URL": "https://proxy.example/v1",
        "ANTHROPIC_AUTH_TOKEN": "sk-…"
      }
    }
  ]
}
```

Reader contract mirrors the module's house style: missing/corrupt → `[]`, per-entry sanitization is loud-and-lenient (drop malformed entries with a `console.warn` naming them), setters throw on invalid input. Sanitization rules:

- `id`: non-empty trimmed string, unique case-insensitively within `models`.
- `efforts`: intersection with `EFFORTS`; empty/absent → full `EFFORTS` set.
- `env`: object of string→string; keys filtered through the reserved-key policy (§4.4) **at write time** (reject, with the offending key named) and again defensively at spawn time (drop + warn).

**Shadowing is allowed and is the override mechanism**: a global entry whose `id` matches a `PREDEFINED_MODELS` id *overrides* that entry (label, efforts, env). This is deliberate — it is the only way to attach routing env or correct the effort matrix of a built-in model without a code change. (`sanitizeCustom`'s current drop-shadowing rule, `config.mjs:106-111`, applies to legacy per-project entries only.)

**Secrets stance:** `settings.json` is per-user, under `$HOME`, outside any repo, and never copied into run worktrees. Env values are stored literally. Mitigations rather than a secrets subsystem: (a) the settings API returns env values **masked** (`"ANTHROPIC_AUTH_TOKEN": "•••…f3a"`) and the UI edits them write-only; (b) a value of the form `${VARNAME}` is resolved from worca's own `process.env` at spawn time, so users who refuse tokens-on-disk can keep them in their shell environment. A dedicated `settings.local.json`/keychain split (W-051's answer for an in-repo settings file) is not needed here and is explicitly rejected.

### 4.2 Catalog composition and `listModels`

Effective catalog = `PREDEFINED_MODELS` ⊕ global `models` (global wins on id collision) ⊕ legacy per-project custom models (lowest precedence, kept for compatibility — §4.9).

`listModels(projectDir)` (`config.mjs:165-170`) keeps its signature and remains the single catalog API; entries gain:

- `custom: false | 'global' | 'project'` (the existing boolean widens),
- `hasEnv: boolean` (never the env values themselves — this response feeds the UI dropdowns),
- `efforts` now honest for global entries instead of the unconditional full set.

### 4.3 Selection precedence — unchanged

Per-node > per-role (default workflow only) > global `--model` flag > CLI default. No new tier. The design deliberately does not add a worca default model (decision log, §7).

### 4.4 Env injection

**Resolution point.** One new helper, `resolveModelEnv(modelId) -> Record<string,string> | undefined` in `config.mjs`, consulted wherever a model id has just been resolved for dispatch: `_phaseCtx` / `_nodeCtx` in `orchestrator.mjs` (`:2615`, `:2696`), and the auxiliary call sites (§4.8). Lookup is by exact id against the effective catalog; `${VAR}` values are expanded here (unset var → drop the key + warn).

**Transport.** `runClaude`/`runReal` gain a `modelEnv` option (named in both the destructure and the `runReal` call — the gate contract at `claude-runner.mjs:214-218` — and covered by `test/spawn-args.test.mjs`'s end-to-end forwarding assertions). Spawn env becomes:

| Guardrail state | Spawn env |
|---|---|
| scrub off, no modelEnv | `undefined` (inherit `process.env`) — byte-identical to today |
| scrub off, modelEnv | `{ ...process.env, ...safeModelEnv }` |
| scrub on | `{ ...buildSpawnEnv(envScrub, envAllowlist), ...safeModelEnv }` |

Model env **wins over** inherited/allowlisted values and **survives scrub**: it is explicit operator configuration, not ambient environment, so the scrub guardrail (whose job is to withhold ambient secrets) does not strip it. `envAllowlist` does not gate it. This resolves the guardrail-interaction question in favor of "config beats guardrail, except reserved keys".

**Reserved keys** (rejected at write, dropped with a warning at spawn):

- Exact: `PATH`, `HOME`, `TMPDIR`, `SHELL`, `USER`, `LOGNAME`, `TERM`, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `CLAUDECODE`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (the CLI-2.1.220 permission-mode landmine documented at `claude-runner.mjs:150-154`).
- Prefix: `WORCA_` — protects `WORCA_MOCK`, `WORCA_CLAUDE_BIN`, `WORCA_EFFORT_FLAG`, `WORCA_SUBAGENT_HOOKS`, `WORCA_RUN_ROOT`, all of which the runner reads from `process.env` and any of which injection could otherwise subvert (mock mode, binary path).
- Everything else — including all `ANTHROPIC_*` / `CLAUDE_*` — is allowed: routing them is the point.

The list lives in one exported constant in `claude-runner.mjs` next to `SPAWN_ENV_BASE`, used by both the settings validator and the spawn-time filter.

### 4.5 Validation

- `setNodeModel` (`config.mjs:404-437`) gains the same catalog validation `setStep` already has; the `ui/server.mjs:1864-1866` caveat comment is deleted. Unknown model or unsupported effort → throw, surfaced as a 400.
- Catalog **removal follows the `removeCustomModel` precedent** (`config.mjs:303-306`): deleting a global entry clears dangling per-node refs in every project and dangling `steps` refs, after a UI confirmation that names the affected projects/nodes. Removing an entry that shadows a predefined id merely reverts to the built-in entry — no refs dangle.
- Runtime stays pass-through: a bad id fails as a non-zero `claude` exit with the CLI's own error, unchanged.

### 4.6 Cost honesty

`costUnreliable` is **observed at runtime, not assumed**: an env-routed endpoint that reports real costs is treated as trustworthy. Detection rule, evaluated when a node's `result` event arrives:

- Applies **only** to nodes whose resolved model has routing env (an effective `ANTHROPIC_BASE_URL`, directly or via `${VAR}`) — the direct Anthropic path is never flagged.
- **Never in mock mode** (mock runs always report zero).
- Triggers when the reported cost is absent, `null`, or `0` while the event shows tokens were consumed.

On a trigger: the orchestrator logs one warning line naming the model and node (so an endpoint silently starving `cost-budget.mjs`'s USD caps is visible in the transcript), and records a global per-model `costUnreliable` observation. That observation is **derived state, not user config**, so it lives in the central DB (a small key-value keyed by model id), not `settings.json`. `listModels` merges it in; the UI shows a "cost not verified" badge in the model dropdown and on affected run-graph nodes only after such an observation exists. A later run of the same model that reports a positive cost clears the observation automatically.

Budget *enforcement* is unchanged. A pricing table is out of scope; this is the documented hole plus an observed flag.

### 4.7 Resolved-model visibility

Per decision: keep the CLI-default fallback but make it observable. The CLI's stream-json `init` event carries the session's actual model; the runner already surfaces raw events. The orchestrator records that value per node (alongside the existing `[init] model=…` log at `orchestrator.mjs:2853`), and `nodeModelLine()` (`ui/public/app.js:800-807`) renders `default (claude-sonnet-4-6)` instead of the opaque `"default"` once the node has started. No behavior change — display only.

### 4.8 Auxiliary call sites

Title generation (`src/core/title.mjs:5-6`), overview, agent-gen, and workspace-scan keep their current model choices (hardcoded haiku + `WORCA_TITLE_MODEL`, or CLI default). The one change: each routes its chosen id through `resolveModelEnv` before spawning, so a catalog entry matching that id carries its routing env everywhere the id is used. No new configuration surface for these.

### 4.9 Migration and deprecation of per-project custom models

No destructive auto-migration. Transition plan:

1. Legacy per-project entries remain readable and selectable (lowest catalog precedence, labeled `project (legacy)` in the UI).
2. The add flow moves entirely to the global Models view; `POST /api/config/models` (per-project add, `ui/server.mjs:1903`) is removed, `DELETE` stays so legacy entries can be cleaned up.
3. The Models view offers **"promote to global"** per legacy entry (copy into settings, delete the project row — node/step refs are by id, so promotion is invisible to them).
4. A later release drops the legacy read path once the UI has stopped showing any `project (legacy)` entries in practice.

### 4.10 UI and API

**API** (global, project-less — the catalog no longer depends on a project):

- `GET /api/models` — effective catalog, env masked to `hasEnv` + masked values for the editor.
- `POST /api/models` / `PATCH /api/models/:id` / `DELETE /api/models/:id` — global CRUD; PATCH accepts partial env updates (write-only values; omitted keys kept, `null` deletes a key).
- `GET/POST /api/config` keeps returning `models` for the run-config strip, now from the effective catalog.

**UI:** a dedicated **Models view** in the sidebar (precedent: Guardrails and Plugins are full views with their own stores — `guardrail-store.mjs`, `plugins-view.mjs`). Per entry: label, id, effort checkboxes, env editor with masked values and reserved-key errors inline, cost-unreliable badge, delete with dangling-ref confirmation. The `+ Add model…` dropdown item in `renderModelEffortPair()` (`app.js:2547-2570`) navigates to this view; the `window.prompt()` flow (`app.js:2997-3120`) is deleted.

## 5. Testing

- **settings.mjs**: catalog reader sanitization (malformed entries dropped loudly), setter rejections (dup id, reserved env key, non-string env value), unknown-key survival on write.
- **config.mjs**: effective-catalog precedence (global shadows predefined; legacy lowest), `resolveModelEnv` (${VAR} expansion, unset-var drop, exact-id lookup), `setNodeModel` validation parity with `setStep`, removal clearing node+step refs across projects.
- **claude-runner.mjs**: spawn-env table in §4.4 (all three rows, byte-identical baseline when absent), reserved-key drop + warn, `modelEnv` forwarding through the `runClaude`→`runReal` gate (extend `test/spawn-args.test.mjs`).
- **server**: masked env in GET, write-only PATCH round-trip, 400 on invalid node model, legacy add endpoint gone.
- **UI smoke** (mock mode): Models view CRUD, promote-to-global, dropdown reflects global entries, resolved-model caption after node start.

## 6. Implementation order

1. `settings.mjs` catalog storage + sanitization + reserved-key constant in `claude-runner.mjs` (pure, fully unit-testable).
2. `config.mjs` effective catalog + `resolveModelEnv` + validation parity + removal semantics.
3. `claude-runner.mjs` `modelEnv` seam + spawn-env merge; orchestrator dispatch wiring + aux call sites.
4. API endpoints + masking.
5. Models view + dropdown rework + resolved-model visibility.
6. Cost-unreliable runtime detection + DB observation store + badges + run-log warning.

Each lands as its own PR against `dev`, tests first, per repo workflow.

## 7. Decision log

| Decision | Choice | Why |
|---|---|---|
| Scope | Editable catalog + env routing; **no named profiles** | Profiles add an id↔name indirection through DB columns and a migration; not wanted now |
| Default model | **Keep CLI-default fallback**, add visibility only | No new tier; the silent fallback becomes observable via the CLI init event |
| Catalog scope | **Global only** (settings.json) | Ends re-add-per-repo; per-project entries deprecated, not force-migrated |
| Native `/orchestrate` path | **Out of scope** | Skill keeps its own table; drift accepted |
| Predefined shadowing | Allowed; global entry overrides by id | Only way to attach env/fix efforts on built-ins without code changes |
| Secrets | Literal values in per-user settings.json + masking + optional `${VAR}` indirection | File is already user-private and outside repos; a secrets subsystem is overkill |
| Scrub interaction | Model env survives scrub, wins collisions, reserved keys excepted | Explicit config outranks ambient-env hygiene |
| Unknown-id failure mode | Validate at write time; pass-through at runtime | Matches setStep precedent; CLI owns runtime resolution |
| Cost reliability | Observed at runtime (zero/absent cost from an env-routed endpoint), not statically assumed | A proxy that reports real costs is not falsely badged; observation is derived state in the DB, auto-cleared on a positive-cost run |

## 8. Out of scope / future

Named profiles (would layer cleanly on this catalog), per-model pricing for budget correctness, `/orchestrate` skill unification, OS-keychain secret storage, per-project catalog overrides.
