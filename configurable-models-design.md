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
      "id": "glm-4.7",                       // worca's handle: config refs, cost
                                             // flags, event attribution — and the
                                             // wire id sent to `claude --model`
                                             // UNLESS env.ANTHROPIC_MODEL overrides it (#374)
      "label": "GLM 4.7 (proxy)",            // display name; defaults to id
      "efforts": ["medium", "high"],         // subset of EFFORTS; defaults to all
      "env": {                                // optional; merged into the spawn env.
                                              // ANTHROPIC_MODEL here becomes the wire id
                                              // passed to `--model` (the id stays the handle)
        "ANTHROPIC_BASE_URL": "https://proxy.example/v1",
        "ANTHROPIC_AUTH_TOKEN": "sk-…"
      }
    }
  ]
}
```

> **Upgrade behavior (#374):** an entry's `env.ANTHROPIC_MODEL` was previously
> stored-but-inert (the spawned `--model <id>` outranked the env var in the CLI).
> As of #374 it is the **wire id** passed to `--model`, so a legal-but-dead stored
> value now changes which model the endpoint runs. An unresolvable/empty value
> falls back to the catalog id with a warning.
>
> **Cost-honesty caveat (§4.6):** the cost-unreliable watchdog gates on the
> `ANTHROPIC_BASE_URL` key only. A base-URL-less routing shape — e.g.
> `CLAUDE_CODE_USE_VERTEX=1` + `ANTHROPIC_MODEL` — is the config #374 makes
> functional, but it is currently invisible to `observeModelCost`: no
> cost-unreliable badge, and USD budget may record $0 for real spend. Widening
> the gate is a follow-up.

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

The policy lives in `src/core/model-env.mjs`, a zero-import leaf module, imported by both the settings validator and the runner's spawn-time filter. (It cannot live next to `SPAWN_ENV_BASE` in `claude-runner.mjs` as originally drafted: `settings.mjs` is bound to a no-core-graph-imports contract and must validate against the same list.) `EFFORTS` moves there too, re-exported from `config.mjs` for import-compat, for the same reason.

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

### 4.11 Pricing override (opt-in)

§4.6 flags an endpoint that reports *no* cost, but the harder case is the endpoint that reports none and gets one **invented** for it: the Claude CLI computes `total_cost_usd` from its own price table keyed on the model **name**, so an on-prem or proxied model named like a public one is billed as that public model. worca has no price table of its own, so a free on-prem run was priced at the public rate — and `costUnreliable` cannot see it, because a fabricated positive cost is indistinguishable from a real one.

A catalog entry may therefore carry an optional `cost`:

```json
{ "id": "discreetstack", "env": { "ANTHROPIC_BASE_URL": "…" },
  "cost": { "perMtok": { "input": 0.5, "output": 1.5, "cacheRead": 0.05, "cacheWrite": 0.6, "cacheWrite1h": 1.2 } } }
```

- `{"free": true}` — recorded spend is always $0.
- `{"perMtok": {...}}` — the CLI figure is **discarded** and the cost recomputed from the run's reported token usage (USD per million tokens; the ephemeral 1h/5m cache-write buckets are priced separately, 1h falling back to the `cacheWrite` rate when unset).

**Opt-in**: with no `cost`, the CLI value stands exactly as before. Ported from worca 0.x's `cost_alias` / `worca.pricing.models`.

`resolveModelCost` is the single chokepoint, applied at **every** surface that books spend — they share one windowed budget (`cost-budget.mjs` `combinedWindowedSpendUsd`), so re-pricing only some would leave the phantom spend inflating it from the others: the orchestrator's result intake and sub-agent telemetry, an Ask Worca turn (via a `resolveCost` hook injected into the reducer, keeping `ask/events.mjs` free of config/DB deps), and the overview agent's telemetry row. Two rules keep it honest: only a genuinely cost-bearing terminal `result` may be re-priced (a `{free}` override answers $0 for *any* input, so an ungated call would book a real $0 per stream frame), and a `{perMtok}` model whose result carried **no usage at all** is *unpriceable* — reported, never silently booked at $0. A model with an override is never `costUnreliable`-flagged, and a stale flag is lifted.

**UI**: a *Pricing* section in the model editor — *Trust the CLI* (default) / *Free ($0)* / *Per million tokens* with the five rate inputs — plus a free/priced badge and rate summary on catalog cards. Validation lives server-side only (`assertModelCost`); the form surfaces the API's message. Plugin models carry the same field (§9.1).

## 5. Testing

- **settings.mjs**: catalog reader sanitization (malformed entries dropped loudly), setter rejections (dup id, reserved env key, non-string env value), unknown-key survival on write.
- **config.mjs**: effective-catalog precedence (global shadows predefined; legacy lowest), `resolveModelEnv` (${VAR} expansion, unset-var drop, exact-id lookup), `setNodeModel` validation parity with `setStep`, removal clearing node+step refs across projects.
- **claude-runner.mjs**: spawn-env table in §4.4 (all three rows, byte-identical baseline when absent), reserved-key drop + warn, `modelEnv` forwarding through the `runClaude`→`runReal` gate (extend `test/spawn-args.test.mjs`).
- **server**: masked env in GET, write-only PATCH round-trip, 400 on invalid node model, legacy add endpoint gone.
- **UI smoke** (mock mode): Models view CRUD, promote-to-global, dropdown reflects global entries, resolved-model caption after node start.

## 6. Implementation order

1. `settings.mjs` catalog storage + sanitization + the `model-env.mjs` leaf (reserved-key policy, `${VAR}` refs, spawn-time filter) (pure, fully unit-testable).
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

## 9. Model plugins (team dissemination)

A team member configures a custom model locally, adapts pipelines to it, and wants teammates to reuse it without hand-copying `settings.json` snippets. Distribution rides the **existing plugin subsystem** (spec §4–§9: git repo + `worca-cc-plugin.json`, pinned-SHA install with consent inventory, update diff preview, per-plugin secrets store). Models become a fifth contribution type next to task sources, agents, skills, and workflows. **Git-only** distribution — no zip/tarball import path; the pinned-SHA update/consent trust model is the point.

### 9.1 Manifest: `models` + `modelSecrets`

```json
{
  "name": "discretestack-models",
  "description": "Team routing for the DiscreteStack endpoint",
  "models": [
    { "id": "discretestack-stable", "label": "DiscreteStack Stable",
      "efforts": ["medium", "high"],
      "env": {
        "ANTHROPIC_BASE_URL": "https://api.discretestack.com",
        "API_TIMEOUT_MS": "3000000",
        "ANTHROPIC_AUTH_TOKEN": { "secret": "discretestack-token" }
      },
      "cost": { "perMtok": { "input": 0.5, "output": 1.5 } } }
  ],
  "modelSecrets": [
    { "key": "discretestack-token", "label": "DiscreteStack API token" }
  ]
}
```

Env values take three forms: a **literal** string (travels verbatim — base URLs, timeouts, tier remaps), a whole-value **`${VAR}` ref** (travels as text, expanded from the teammate's process env at spawn resolution — existing `model-env.mjs` semantics), or a **secret placeholder** `{"secret": "<key>"}` referencing a plugin-level `modelSecrets` entry. Secrets are plugin-level, not per-model, so N models sharing one token prompt for it once.

`cost` is the optional per-model **pricing override** (§4.11), in the same shape a global catalog entry uses: `{"free": true}` or `{"perMtok": {...}}` in USD per million tokens. A plugin distributing a model on its own endpoint is precisely the case the Claude CLI prices from its internal table keyed on the model **name**, so the price travels **with** the model rather than having to be re-pinned by hand on every machine that installs the plugin. It is configuration, never a credential: unlike env values it is surfaced unmasked and is carried verbatim by *Share as plugin*.

Validation (`plugin-manifest.mjs`, install fails on error): model ids non-empty + case-insensitively unique within the plugin, efforts a subset of `EFFORTS`, env keys pass `isReservedModelEnvKey` (the same write-time gate as `POST /api/models` — the spawn-time `prepareModelEnv` drop stays as the second gate), every `{"secret"}` ref names a declared `modelSecrets` key, `modelSecrets` keys match the config-field `KEY_RE` and are unique, and `cost` passes `assertModelCost` — the SAME validator `settings.mjs` runs on a global entry, shared from the zero-import leaf `model-env.mjs` so neither catalog layer has to import the other. Unknown fields warn (error under `--strict`), like everything else in the manifest.

Pricing follows the same precedence as the rest of a model's configuration (§9.3): `modelCostConfig` takes the user's **global** entry when one exists, else the winning **plugin** entry's manifest price. A global entry shadows the plugin's price even when it pins none — taking over a model id means owning its pricing too, so the two layers can never half-merge. *Edit a copy* therefore seeds the copy with the plugin's pricing.

### 9.2 Catalog composition: a fourth layer

Precedence: **predefined < plugin < global (user) < — legacy project lowest, unchanged**. Plugin entries come from *enabled* installed plugins' `current/worca-cc-plugin.json` (read fresh per composition, like `listGlobalModels`); a new `src/core/plugin-models.mjs` module owns the read (imports: `plugins-lock.mjs`, `plugin-manifest.mjs`, `plugin-config.mjs` — no cycle; `config.mjs` imports it). Catalog shape: `custom: 'plugin'` (truthy string, so existing `m.custom` checks keep working) plus `plugin: '<name>'`; `hasEnv` as usual.

- A **user global entry with the same id shadows the plugin entry** (badge: `overrides plugin`) — plugin content stays immutable/versioned; local tweaks go through "Edit a copy" (below).
- A plugin entry with a **predefined id** shadows the built-in (same rule as global shadows, `overridden` badge on the built-in card).
- **Two plugins shipping the same id**: alphabetical plugin-name order wins deterministically; the loser is dropped with a warning (doctor/list surface it).
- Disabled/uninstalled plugin → its models leave the catalog; selections referencing them behave like any unknown id (write-time validation, runtime pass-through — §4.5 unchanged).
- Test hermeticity is inherited: `readPluginsLock` resolves through `worcaHome()`, whose `NODE_TEST_CONTEXT` guard already makes plugin reads return empty in unsandboxed tests.

### 9.3 Env resolution and secrets

`resolveModelEnv(modelId)` extends: user global entry first (current behavior); else the winning enabled plugin entry. Placeholders resolve from the plugin's **existing secrets store** (`plugin-config.mjs`: `data/secrets.json`, 0600, atomic, `{"$env":"VAR"}` indirection honored, values never echoed to the browser) via a schema synthesized from `modelSecrets` (`secret: true` fields). An unset secret drops that key with a warning naming the plugin and key — same degradation as an unresolvable `${VAR}`. The assembled map then flows through `prepareModelEnv` unchanged (reserved-key drop + ref expansion).

`modelHasBaseUrlRouting` extends to plugin entries (key presence in any form), so §4.6 cost observation works for plugin models with no further changes.

### 9.4 Lifecycle integration

- **Install consent** (`buildInstallInventory`): a `models` section listing each model's id, label, efforts, env keys, and the `ANTHROPIC_BASE_URL` value **verbatim** (a model env can redirect all API traffic — the reviewer must see where), plus requested `modelSecrets`. The install flow then prompts for secrets (plugins view config panel).
- **Update delta** (`fetchCandidate`/`computeManifestDelta`): `newModels`, `removedModels`, `envChangedModels` (ids whose env map differs — base-URL changes called out explicitly), `newModelSecrets`. Red-highlighted like `newSecrets`, turning a malicious routing change into a human review event.
- **Uninstall guard** — **block-with-list** (decision): `referencedPluginModels(name)` computes, for each of the plugin's model ids, the cross-project step/node refs (reusing `globalModelRefs` machinery) *minus* ids shadowed by a user global entry (those keep resolving after uninstall). Non-empty → `REFERENCED`-code error with the list, same shape as the plugin-agents guard; the user clears selections (or copies the model) first. Disable is not guarded — it is reversible.
- **Doctor**: per `modelSecrets` key, a check whether it is set (unset → failing check naming the key).

### 9.5 Export wizard ("Share as plugin…", Models page)

Three steps, server does the packing:

1. **Pick models** — checkboxes over the user's global entries.
2. **Env policy** — one row per distinct env key across the selection: *Include value* / *Require at install* (→ secret placeholder + `modelSecrets` entry) / *Keep as `${VAR}` ref* (only offered where the stored value already is one). Keys matching `/TOKEN|KEY|SECRET|PASSWORD|AUTH/i` default to *Require at install*; choosing *Include value* on such a key shows a "this value will be committed to a git repo" warning. A key shared by several selected models is decided once.
3. **Metadata + destination** — plugin name (kebab-case, `PLUGIN_NAME_RE`), description, version; a **destination folder path** (must not exist or be empty). Export writes the scaffold: `worca-cc-plugin.json` + a README with `git init`/push and `worca plugin add` instructions. No zip: distribution is git-only, and the scaffold folder is what gets pushed.

The export endpoint reads raw env values server-side (same trust model as `GET /api/models/:id/env-value` — the user's own values, deliberate action); *Require at install* strips the value entirely.

### 9.6 UI

- **Models page**: a read-only **"From plugins"** card section (provenance badge `plugin: <name>`, env summary, secret status, `overrides built-in` / shadowed states) with an **"Edit a copy"** action → create-mode editor prefilled with id/label/efforts and literal/`${VAR}` env values; secret-placeholder keys become empty rows the user must fill. Saving creates the global entry, which shadows the plugin one. Plus the **"Share as plugin…"** toolbar button (wizard above).
- **New Pipeline dropdown**: a third optgroup between the existing two — **Your models / Plugins / Built-in** (one combined group; alphabetical within, per the existing sort). Provenance suffixes stay removed; when the same *label* appears in more than one group (or twice within Plugins), the ambiguous options get ` (<plugin-name>)` appended — collision-only, no steady-state noise. `⚠cost` marker semantics unchanged.
- **Plugins view**: contributions count gains `models`; the config panel gains a "Model secrets" section (masked `{set:true}` markers, write-only — exactly the task-source secret UX).

### 9.7 API

- `GET /api/models` gains `plugin: [...]` entries (read-only; literals masked with the standard masker, `${VAR}` refs readable, placeholders as `{secret: key, set: bool}`).
- `GET /api/plugins/:name/config` gains a `models: {schema, values}` section synthesized from `modelSecrets`; `PUT` accepts `{target: 'modelSecrets', values}` alongside the per-source shape.
- `POST /api/models/export-plugin` `{name, description, version, dest, models: [{id, env: {KEY: 'value'|'ref'|'secret'}}]}` → writes the scaffold, returns the path + next-step instructions.
- Install/update/uninstall/doctor routes are unchanged — richer payloads only (inventory `models`, delta fields, `REFERENCED` list).

### 9.8 Testing

- **plugin-manifest**: models/modelSecrets normalization + every rejection (reserved env key, dup id, unknown effort, dangling secret ref, bad secret key), strict-mode warnings.
- **plugin-models**: composition precedence (all four layers + both shadow directions + two-plugin collision), disabled-plugin exclusion, secret resolution (set / unset-drop / `$env` indirection), refs guard incl. the shadowed-id carve-out.
- **plugin-store**: inventory `models` section, update delta fields, uninstall `REFERENCED` block + success after clearing, doctor secret checks.
- **server**: plugin entries in `GET /api/models`, modelSecrets config round-trip (write-only), export endpoint (scaffold content, value-stripping, dest guards, name validation).
- **UI (jsdom)**: plugin cards read-only + Edit-a-copy prefill, wizard collect (env policy modes, secret defaulting heuristic), dropdown third group + collision-only suffix.

### 9.9 Implementation order (stacked on phases 1–6)

7. Manifest: `models`/`modelSecrets` normalization + `validatePluginDir` checks.
8. `plugin-models.mjs` + catalog composition layer + `resolveModelEnv`/`modelHasBaseUrlRouting` extension.
9. Lifecycle: consent inventory, update delta, uninstall block-with-list, doctor secret checks.
10. API: plugin entries in `/api/models`, modelSecrets config routes, export endpoint.
11. UI: Models-page plugin section + Edit-a-copy + export wizard, plugins-view secrets panel, dropdown grouping.

### 9.10 Decision log

| Decision | Choice | Why |
|---|---|---|
| Distribution | **Git-only** (existing plugin flow) | Pinned-SHA consent/update trust model; zip import has no update story |
| Secrets | **Full placeholder + install-time prompt** (plugin secrets store) | Storage and redaction already exist; strictly better UX than shell-env conventions |
| Uninstall with refs | **Block with references list** | Mirrors the plugin-agents guard; uninstall is rare and the block is actionable |
| Dropdown grouping | **One combined "Plugins" group** | Per-plugin groups add noise for the common one-plugin case; collision-only suffix disambiguates |
| Precedence | predefined < plugin < user global | User sovereignty: a local copy always wins; plugin entries stay immutable |
| Same-label collision | Suffix ` (<plugin-name>)` only when ambiguous | Consistent with the provenance-suffix removal |
