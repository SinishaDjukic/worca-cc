# Ask Worca on Copilot (and Copilot catalog models)

Status: implemented, 2026-10-20. Branch `claude/multi-engine-chat-bd042d`. Built-in ids are `copilot/<id>` (see Part 1).

## Goal

Ask Worca chats run on Claude and Codex today (`ASK_ENGINES`, src/core/model-env.mjs). Add Copilot. Cursor stays out:
no switch turns off its shell or file tools (`CURSOR_ASK_LOCKDOWN = null`), and a chat reads untrusted text next to the
user's secrets.

Copilot has no catalog models today (`ENGINES.copilot.models = false`): every Copilot run runs on Copilot's default
model. A chat needs a model picker, so Copilot gets catalog models first.

## Part 1 — Copilot catalog models

Mirror Cursor (sign-in models, user-added rows, no endpoint):

- `engine-switch.mjs`: `copilot.models = true`. `MODEL_ENGINES`, `SWITCH_ENGINES` and `CONNECTION_ENGINES` gain
  Copilot. So a paused run can now switch to Copilot, and `/resume` offers it.
- Built-ins: a short `COPILOT_BUILTIN_MODELS` list (ids Copilot's `--model` takes), with **Copilot default** as the
  fallback. The ids must be confirmed against the installed `copilot --help`. Without that, the list stays empty, and
  the user adds rows in Models (engine Copilot), as with Cursor.
- Efforts: `COPILOT_EFFORTS` (`none … max`) goes into `model-env.mjs` (`effortsForEngine`), `HARNESS_EFFORTS` and the
  `effortOn` rank (`none`), plus the UI effort maps (models-view, engine-settings-view, team-policy-view, `/api/models`).
- Validation, matching Cursor in each place: no `env` or `upstream` on a Copilot row; the id must not be a Claude or
  Codex built-in id; settings.mjs, plugin-manifest.mjs, policy/registry.mjs (which today would drop `engine:'copilot'`),
  bridge/registry.mjs.
- Step slots: `models.copilot.steps.*`. The hard-coded regexes `STEP_RE`, `MODEL_ID_RE` and `ASK_MODEL_RE`, plus the
  UI's `askPatchToSettingsBody`, take `copilot`. `resolveStepModels` drops its Copilot early return.
- Runs: `_engineModel` keeps a catalog id that runs on Copilot (today it drops every catalog id on Copilot).
- Helper jobs: unchanged. Copilot runs them on its default model, with no helper slots (`HELPER_ENGINES` stays
  `claude, codex`).
- Models view: Copilot in the sign-in choices, with pricing hidden (cost unknown) and efforts kept. Engine settings
  gets a Copilot card. The New-pipeline model picker lists Copilot rows next to "(default model)".

## Part 2 — Ask on Copilot

Lockdown, built on the adapter's existing read-only path (engines/copilot.mjs):

- `--available-tools=<the worca Ask MCP server>`: no shell, no write, no built-in file tools, no `task`.
- `--disable-builtin-mcps`, no project `.mcp.json` servers, no `--add-dir` beyond the scratch agent folder,
  `--disallow-temp-dir`, the environment scrubbed with `envAllowlist` as for Codex.
- `runCopilotProcess({askLockdown})` takes this path instead of throwing.
- `copilotAskSupport()`: checks that the installed copilot has every flag (`--available-tools`,
  `--disable-builtin-mcps`, `--disallow-temp-dir`) and meets a minimum version, as `codexAskSupport` does.
- Like Codex, the chat reads memory and attachments through worca's `read_file`/`grep`/`glob` MCP tools (`file-deps.mjs`
  turns them on for `WORCA_ASK_ENGINE` copilot).
- The `_watch` watchdog runs, as on Codex: any shell or non-worca tool, or a sub-agent, ends the turn.
- Registry MCP servers: none, as on Codex (one notice per chat).

Engine plumbing: `ASK_ENGINES = ['claude','codex','copilot']`. Every `engine === 'codex' ? 'codex' : 'claude'` collapse
widens (turn.mjs, ui/server.mjs, ask-engine.mjs, ask-panel.mjs). `ENGINE_LABEL`, `chatEngine`, `defaultAskPrefs`, the
picker groups, Settings › Ask engine, the `models.copilot.ask` slot, the `askEngine` validation, `buildCopilotAskOptions`
in ask/spawn.mjs, a Copilot system-rules variant in prompt.mjs, resume-not-found fallback (`copilotResumeNotFound`),
title on the chat's model, follow-up suggestions on Copilot's default model (or none).

Cost: Copilot reports no dollar cost. With a per-turn cost cap set, a Copilot turn is refused. This is the rule a
Codex model with no known price follows (D14), and the message points to the cap setting. With no cap, the turn runs,
and its cost shows as unknown.

Images and PDFs: not attached on Copilot (the adapter takes no images). The composer refuses them, as it refuses PDFs
on Codex.

Broker: `brokerEngineRefusal('copilot')` hides Copilot rows while the credential broker is on, as for Codex.

## Verified on the real binary (GitHub Copilot CLI 1.0.100)

The signed-in account here has no Copilot CLI access ("organization has restricted Copilot access"), so the checks ran
in offline BYOK mode (`COPILOT_OFFLINE=true`, `COPILOT_PROVIDER_BASE_URL`) against a local stub endpoint that logs each
request's tool list and scripts the model's tool calls.

1. `--available-tools=<server>` offers the model that server's tools only: no shell, no file tools, no `task`. Confirmed
   with a probe server, and again with a real Ask turn: 83 tools, all `worca-*`, `read_file`/`grep`/`glob` among them.
2. A local MCP server inherits copilot's whole process env (a probe tool returned it, including an unrelated variable).
   So the Ask spawn scrubs copilot's env, and the command token rides that env on purpose.
3. `copilot help config` lists the `--model` ids. They are the built-ins, as `copilot/<id>`; the adapter strips the prefix
   (the stub saw `gpt-5.4`).
4. `--no-custom-instructions` keeps AGENTS.md and the `~/.copilot` instructions out, and the `--agent` body (worca's
   system prompt) still reaches the model.
5. A real end-to-end Ask turn (`createAskTurn` → adapter → copilot → worca's MCP child) called `list_projects`, finished
   `done`, and stored its `copilot:<uuid>` session. Resume and real models were not exercised (no Copilot access here).

## Tests

Mirror the Codex-Ask suites (`ask-spawn-codex`, `ask-turn-codex`, `codex-ask-adapter`, `ask-prompt-codex`,
`ask-engine-ui`, `ask-api-codex-turn`). Update the tests that pin the engine lists (engine-switch-pause,
engine-models, ui-settings-engines, engine-settings-validators, ask-chat-engine, copilot-adapter,
copilot-engine-gate, ui-engine-picker, ui-engine-default-prefill).
