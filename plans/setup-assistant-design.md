# Setup assistant — Design

A first-run **setup assistant** in the Worca UI. It asks about the network, where models come
from, which models do which work, and how hands-on the person wants to be. Then it writes every
setting, signs in, imports models and tests them. It can be run again from Settings, and a team
can publish shared defaults for it.

UI mockup: [`setup-assistant-mockups.html`](setup-assistant-mockups.html) — the clickable
prototype (three example machines, first start and re-run), the step table, the model roles
table, the live proxy design and the team setup tables. Open it in a browser. The live copy is at
<https://claude.ai/artifact/5g2ZifcSHKvhLd4CbLp72h>. The mockup's colours mirror
`ui/public/style.css` by value only; build with the real tokens and components
(`docs/design-system.md`), never by copying its CSS.

## 1. Problem

Setting Worca up for a real environment takes many pages, a mode switch and a restart.

**Corporate proxy, today (~15 clicks and fields, 2 pages, 1 restart):** Settings › Labs → turn on
Corporate proxy → switch the interface to Advanced (the card is hidden at Simple) → Settings ›
Runs › Network proxy (host, port, login mode, direct hosts, three timeouts, local port) → Save →
domain, user, password → Log in → restart Worca from a terminal (host, port, mode and timeouts are
read at startup, `docs/network-proxy.md`) → Test. Each restart with a wrong password spends one
attempt against the account lockout limit.

**GitHub Copilot models, today (~45 clicks, 4 pages, ~17 model slots):** switch to Expert →
Providers › Copilot › Sign in → notice → device code → account type → Import models… → Models ›
Engines › Step models (one row per step) → Helper jobs (titles, Auto classifier, PR description,
memory defragment, agent generation, requirements interview) → then the slots that live elsewhere
(Chat's model, smart naming, command summaries, workspace scan models, the Away mode decider).

**There is no default model.** Each empty slot falls back its own way: steps pass no `--model`
and get the CLI's default (`src/core/run-harness.mjs`), titles fall back to `claude-haiku-4-5`
(`src/core/title.mjs`), naming to the cheapest ready Claude model (`src/core/naming.mjs`), Chat
to `claude-opus-5-5` (`src/core/ask/limits.mjs`), workspace scan to
`WORKSPACE_SCAN_DEFAULT_MODELS` (`src/core/graph/builtin-workflows.mjs`). With only Copilot set
up, every one of them fails.

## 2. Goals

- A new user on a corporate laptop with Copilot is set up in one dialog, with no mode switch, no
  Labs visit, no restart and no page outside the assistant.
- One place holds "which model does which kind of work"; changing it once changes every slot on
  that kind of work.
- The proxy can be set, changed and turned on or off while Worca runs.
- A team lead can publish model roles, limits and conventions once for the whole team.

## 3. Non-goals

- PAC/WPAD or Kerberos proxies (unchanged from `docs/network-proxy.md`).
- New providers. The assistant uses the existing three (`copilot`, `openai`, `anthropic`,
  `src/core/model-env.mjs`) and the harness sign-ins.
- Network or model-access settings in a team setup (D12).
- Replacing the Getting started checklist. The assistant ends on the welcome dialog's three doors.
- A local proxy that runs even when no corporate proxy is set up (D8).

## 4. Decisions

| # | Decision |
|---|---|
| D1 | Add **model roles**: `modelRoles.<harness>.{deep, everyday, quick}`, each `{ model, effort }`, stored in `settings.json` and accepted by `POST /api/settings` (`SETTINGS_POST_KEYS` in `src/core/settings.mjs`). |
| D2 | Roles are named after the work, not a model family: **Deep thinking** (`deep`), **Everyday coding** (`everyday`), **Quick jobs** (`quick`). Any model may fill any role. |
| D3 | Roles sit in the resolution order between a slot's own setting and today's per-slot fallback: per-node or per-run pick → project override or team policy → the slot's own setting → **its role** → today's fallback. The assistant writes only roles and clears no slot. A slot set by hand keeps winning. |
| D4 | The role of each slot follows `MODEL_PICK_POLICY` (`src/core/model-tiers.mjs`). **deep**: Plan, Plan review, Refine plan, Review implementation, Bug root cause, Deck review, the Away mode decider (`nightMode.deciderModel`). **everyday**: Implementation, Bug fix, Clarify and every other step, Chat (`askModels.<engine>`), `agentGenModel`, `requirementsInterview`, `autoWorkflowModel`. **quick**: `titleModel`, `namingModel`, `commandSummaryModel`, `prDescriptionModel`, `memoryDefrag`, `workspaceScan`, the Auto classifier and overview (`utilityModels.<engine>.*`). |
| D5 | Roles are keyed per harness like `stepModels` (`modelRoles.claude`, `modelRoles.codex`). A harness without roles keeps today's fallbacks. |
| D6 | **Corporate proxy leaves Labs.** The `corporateProxy` flag (`src/shared/flags/registry.mjs`) is removed; `networkProxy.enabled` (boolean) replaces it. On first start after the upgrade, an install with the flag on gets `enabled: true` and the flag key is dropped. Every `flagEnabled('corporateProxy')` / `requireFlag('corporateProxy')` reads `networkProxy.enabled` instead. The Settings › Network proxy card moves to **Simple** level; timeouts and the local port fold under "More". |
| D7 | **The proxy changes without a restart.** `createProxy()` (`src/core/egress-proxy.mjs`) takes a replaceable connector: `server.useConnector(next, limits)`. New connections use the new connector; open tunnels finish on the old one, which closes when idle. Children never see a change because they only know `HTTPS_PROXY=http://127.0.0.1:<port>`. |
| D8 | Turning the proxy **on** at runtime starts the local proxy, writes its address into `process.env` for later spawns and re-installs Worca's own fetch dispatcher (`useEnvProxy()` in `src/core/env-proxy.mjs` returns `restore`). Agents already running keep their direct route until their next step. Turning it **off** swaps in no connector: everything goes direct through the same local address. The local proxy is **not** started when no proxy was ever on (no always-on proxy in this version). |
| D9 | **Test before swap.** `checkUpstream()` (`src/core/upstream-proxy.mjs`) already builds its own connector for the values it is given. `POST /api/proxy/test` accepts the candidate settings in its body, tests them, and only a passing test lets Apply swap them in. This replaces the `RESTART_NEEDED` refusal in `src/core/proxy-host.mjs`. The NT hash is still sent only to a host the person typed and tested. |
| D10 | Other Worca processes (a `worca run` started from a shell) watch `networkProxy` in `settings.json` the way `reloadLogin()` watches `proxy-login.json` today (`src/core/egress-policy.mjs`) and swap within a few seconds. Only a new `fixedPort` waits for the next start; the UI says "Applies at the next start" on that field. Chat's proxy card (`src/core/ask/proxy-proposal.mjs`) uses the same live path. |
| D11 | The assistant has seven steps: Check this machine → Network → Model access → Models → How you work → Review → Apply. Every step has a working default, so Skip is always safe. A detected answer collapses to a one-line confirmation. |
| D12 | **Team setup** records only what is the same for the whole team: model roles, `runEngine`, `hideBuiltinModels`, `uiLevel`, `autoGeneratePrDescription`, `smartNaming` (including `pattern` and `types`), spend limits, and optionally `tagDimensions`, `enforceTags`, `sync`, `networkWait` and enabled feature `flags`. It **never** records network or proxy settings, model sources, provider addresses, plan types or keys, tokens, passwords, the Copilot notice acceptance, machine paths, editor or terminal commands, ports, theme, alerts or Getting started progress. |
| D13 | A team setup's roles name an **upstream model** and effort (`claude-opus-5-5` · `high`), never a catalog entry. Each machine maps it to a catalog entry served by one of its own sources (the Claude sign-in, a Copilot import `copilot-<id>`, an API-key or OpenRouter entry with that upstream id). When none serves it, the assistant says so and keeps that person's pick for that role. |
| D14 | Team setup is a **field group in the existing team policy registry** (`src/core/policy/registry.mjs`), named **Setup**, using its kinds (`default`, `soft`). New fields: `models.roles` (`default`, `soft`), `setup.uiLevel`, `setup.autoPrDescription`, `setup.smartNaming`, `setup.runEngine`, `setup.tags`, `setup.sync`, `setup.networkWait`, `setup.flags` (all `default`). Existing fields are reused for limits (`cost.*`) and `models.hideBuiltins`. The Team policy editor gets the Setup tab from its one-tab-per-group rule. |
| D15 | `models.roles` in a policy applies through the effective policy layer like `models.steps` does, for runs on that repository, without writing user settings. The other Setup fields are user-level: when a project with such a policy is added, or the policy changes, the account menu offers "Your team has a recommended setup · Review", which opens the assistant on Review with the team's rows marked Team. Nothing is applied before Apply. |
| D16 | A team setup also exists as a **standalone file**: a policy document limited to Setup-group and `cost.*` fields, read by the same validator. Sources: a link or file on the assistant's first screen; `~/.worca-cc/team-setup.json` or `WORCA_TEAM_SETUP` (found by the machine check); `worca setup --from <url|file>`. |
| D17 | **Share as team setup** at the end of the assistant writes a draft of that file from the person's answers: network and model access left out, role picks turned into upstream model names. Save as a file, or open it in the Team policy editor's Setup tab. |
| D18 | Entry points: a fresh install (`effectiveUiLevel`'s "fresh" test in `ui/server.mjs`) opens the assistant before the welcome dialog; **Settings › General › Setup assistant** (Simple level) with **Run setup again**; fix-it links open it on one step (a "proxy needs login" stop, a Copilot "needs sign-in" pill, a role model that fails its test); `worca setup` in the CLI asks the same questions. |
| D19 | On a re-run the assistant opens with the current values, never with detection results that would undo them. Rows that differ from what is saved get a **Changed** chip; Review lists only those; Apply writes only those. A slot set by hand that disagrees with its new role shows once: "Implement uses GPT-5.5 · Copilot, set on the Models page. Keep it / Use Everyday coding". |
| D20 | One apply call: `POST /api/setup/apply` validates every patch first, writes settings in one `persistSettings`, then runs side effects in order (proxy swap, proxy login, provider sign-in, model import, role test calls) and streams each result over the WebSocket. A failed step leaves earlier writes in place and names the step to retry. |
| D21 | The Getting started tile "Connect Claude Code" (`src/core/onboarding.mjs`) and the assistant's machine check use the same detection, so they never disagree. |

## 5. Settings and routes

| Key or route | Status |
|---|---|
| `modelRoles.<harness>.{deep,everyday,quick}` | (new), D1 |
| `networkProxy.enabled` | (new), replaces the `corporateProxy` flag, D6 |
| `networkProxy.{upstream,auth,noProxy,timeouts,fixedPort}` | existing (`setNetworkProxy`, `src/core/settings.mjs`) |
| `providers.copilot.{githubToken,accountType,acknowledgedTerms,termsVersion,maxConcurrent}`, `providers.openai.{baseUrl,apiKey}`, `providers.anthropic.{baseUrl,apiKey}` | existing (`updateProvider`, `src/core/settings.mjs`; `src/core/bridge/provider-ops.mjs`) |
| `uiLevel`, `pipelineCostLimitUsd`, `totalCostLimitUsd`, `costLimitResetPeriod`, `autoGeneratePrDescription`, `smartNaming`, `runEngine` | existing |
| `GET /api/setup/detect` | (new): `claude` on PATH and signed in (`probeClaudeAuth`, `src/core/preflight.mjs`), git, `HTTPS_PROXY`/`NO_PROXY` from the source env, a direct probe to api.anthropic.com, installed harness CLIs (`GET /api/engines` facts), a local Ollama on `localhost:11434`, `ANTHROPIC_API_KEY`, a team setup file |
| `POST /api/setup/apply` | (new), D20 |
| `POST /api/proxy/test` | existing, now accepts candidate settings, D9 |
| `PUT /api/proxy/settings` | existing, now swaps live and returns `restartNeeded: false` except for `fixedPort`, D7, D10 |
| `/api/providers/copilot/…`, `/api/providers/openai/…`, `/api/models` | existing, called by apply |
| `worca setup [--from <url\|file>]` | (new), `src/cli/setup.mjs` (new) |

## 6. Files

- `src/core/settings.mjs`, `src/core/config.mjs` (`resolveStepModels`), `src/core/title.mjs`,
  `src/core/naming.mjs`, `src/core/ask/limits.mjs`, `src/core/memory-defrag-model.mjs`: read roles.
- `src/core/model-roles.mjs` (new): the one resolver, `roleOf(slot)` and `resolveRoleModel(engine, role)`.
- `ui/public/models-view.mjs`, `ui/public/engine-settings-view.mjs`: a Roles card at the top of the Models page; slots without their own value show "From Everyday coding".
- `src/core/egress-proxy.mjs`, `src/core/egress-policy.mjs`, `src/core/upstream-proxy.mjs`, `src/core/proxy-host.mjs`, `src/core/env-proxy.mjs`, `src/cli/proxy.mjs`: live proxy.
- `src/shared/flags/registry.mjs`, `ui/public/settings-network-proxy.mjs`, `ui/public/index.html`, `ui/server.mjs`: flag removal and the card at Simple level.
- `src/core/setup/detect.mjs` (new), `src/core/setup/apply.mjs` (new), `src/core/setup/team-file.mjs` (new): backend.
- `ui/public/setup-assistant.mjs` (new): the dialog, using `layoutDialog` (`ui/public/dialog-layout.mjs`) and `guardModal` (`ui/public/modal-guard.mjs`).
- `ui/public/getting-started.mjs`, `ui/public/app.js`: first-start hand-off and entry points.
- `src/core/policy/registry.mjs`, `src/core/policy/effective.mjs`, `ui/public/team-policy-view.mjs`: the Setup group.
- Docs: `docs/setup-assistant.md` (new), `docs/network-proxy.md`, `docs/feature-flags.md`, `docs/models.md`, `docs/team-policy.md`, `docs/ui-levels.md`, `docs/getting-started.md`.

## 7. Slices

Each slice builds, reviews and ships on its own, in this order.

### Slice 1 — Model roles

The setting, the resolver, and a Roles card on the Models page. Useful with no assistant.

- AC-1.1 With `modelRoles.claude.quick = { model: 'claude-haiku-5-5', effort: 'low' }` and no `titleModel`, run titles use `claude-haiku-5-5`.
- AC-1.2 With `titleModel` set, the title uses `titleModel`, not the role (D3).
- AC-1.3 A pipeline step with no step model, no project override and no policy step default runs with its role's model and effort, per D4.
- AC-1.4 With no `modelRoles` at all, every slot resolves exactly as today (existing tests unchanged).
- AC-1.5 The Models page shows the three roles; changing Everyday coding changes the shown model of every slot on that role that has no value of its own.
- AC-1.6 `modelRoles.codex` applies only to Codex runs; a Claude run never reads it.

### Slice 2 — The proxy leaves Labs and changes live

- AC-2.1 An install with `flags.corporateProxy: true` starts with `networkProxy.enabled: true` and no `corporateProxy` flag; one without it starts with the proxy off.
- AC-2.2 Changing the proxy host while a run is active applies to new connections without a restart; an open tunnel finishes on the old upstream.
- AC-2.3 Turning the proxy on in a Worca that started with it off makes the next spawned agent and Worca's own fetch go through the local proxy, without a restart.
- AC-2.4 Turning it off sends every new connection direct; children keep the same `HTTPS_PROXY`.
- AC-2.5 `POST /api/proxy/test` with candidate settings tests them without changing the running proxy; saving untested upstream changes through the assistant is refused.
- AC-2.6 A `worca run` started from a shell switches upstream within 5 seconds of a settings change.
- AC-2.7 Changing `fixedPort` returns "Applies at the next start" and keeps the old port listening.
- AC-2.8 The Network proxy card shows at Simple level, with timeouts and the local port under "More".

### Slice 3 — Setup backend

- AC-3.1 `GET /api/setup/detect` returns each check in D18's list with a state (`ok`, `warn`, `no`) and a plain-words line, in under 3 seconds with mock probes.
- AC-3.2 `POST /api/setup/apply` with an invalid field in any group writes nothing and names the field.
- AC-3.3 A valid apply writes settings once and streams one result per side effect, in order.
- AC-3.4 A failing side effect (Copilot sign-in refused) leaves earlier writes in place and returns the step to retry.
- AC-3.5 A re-run apply that changes only the per-run limit writes only `pipelineCostLimitUsd`.
- AC-3.6 With the credential broker on, provider keys are refused with the broker's pointer (`src/core/bridge/provider-ops.mjs`), and the rest of the apply continues.

### Slice 4 — Setup assistant UI

- AC-4.1 A fresh install opens the assistant before the welcome dialog; **Set up later** closes it and the welcome dialog follows.
- AC-4.2 The corporate Copilot path (proxy test, Copilot notice, device sign-in, roles, limits, Apply) completes without leaving the dialog and without changing the interface mode.
- AC-4.3 Next on Network stays disabled until the shown proxy values pass a test.
- AC-4.4 Settings › General › Setup assistant reopens it with the current values; Review lists only changed rows (D19).
- AC-4.5 A "proxy needs login" stop and a Copilot "needs sign-in" pill open the assistant on that step.
- AC-4.6 Apply shows one row per side effect with its result and ends on the welcome dialog's three doors.
- AC-4.7 The dialog follows the dialog anatomy and the design system checks (`test/ui-design-language.test.mjs`) and works at 290px wide.

### Slice 5 — Team setup

- AC-5.1 A policy with a Setup group validates with the existing reader; a malformed Setup field is dropped with a warning and never fails the page.
- AC-5.2 `models.roles` in a project's policy applies to runs on that project for roles the person has not set, without writing `settings.json`.
- AC-5.3 A role naming `claude-opus-5-5` resolves to `copilot-claude-opus-5-5` on a machine with only Copilot, and reports "none of your sources offer it" when no entry serves it.
- AC-5.4 `~/.worca-cc/team-setup.json` is found by the machine check and pre-fills the assistant with Team chips on its rows.
- AC-5.5 A team setup file containing a network, provider, key or token field is refused with the field named.
- AC-5.6 **Share as team setup** produces a file with no network, provider or secret field, and roles as upstream model names.
- AC-5.7 A changed policy Setup group shows "Your team updated the recommended setup · Review" once; Review lists only the changed rows; nothing changes before Apply.
- AC-5.8 `worca setup --from <file>` applies the file and asks only for what it leaves out.

## 8. Testing

Node tests beside the existing ones: `test/model-roles.test.mjs` (new) for D3–D5 resolution;
`test/egress-policy.test.mjs` and `test/api-proxy.test.mjs` extended for the live swap, test
before swap and the flag migration; `test/setup-detect.test.mjs` (new) and
`test/setup-apply.test.mjs` (new) with mock probes; `test/ui-setup-assistant.test.mjs` (new) in
jsdom for steps, skip rules and re-run diffing; `test/policy-registry.test.mjs` extended for the
Setup group and the standalone file. Proxy tests use the existing fake upstream; no test reaches a
real network. Settings writes in tests need a temporary HOME as well as `WORCA_HOME`.

## 9. Open questions

None. Every decision above is settled.
