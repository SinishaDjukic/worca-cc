---
name: creating-worca-cc-plugins
description: Use when creating, scaffolding, debugging, reviewing, or extending a Worca CC plugin — anything involving worca-cc-plugin.json, a task-source connector, plugin-shipped agents/skills/workflow templates, the `worca plugin` CLI, or the Plugins view.
---

# Creating Worca CC Plugins

A Worca CC plugin is a **git repo** (or a subdir one level deep) containing `worca-cc-plugin.json`.
It contributes up to four things to the host, and ships **no UI code**.

| Dir | Contributes | Executed? |
|---|---|---|
| `connector/*.mjs` (via `taskSources[].module`) | task-source connector | **Yes** — in an ephemeral child process |
| `agents/<key>.md` + `<key>.meta.json` | pipeline agents | No — prompt text fed to `claude -p` |
| `skills/<name>/SKILL.md` | agent skills | No — copied into the run worktree |
| `workflows/*.json` | pipeline templates | No — validated into DB rows |

**The connector is the only executable seam.** Everything else is data. Internalize this before designing anything.

## Start here — always scaffold

```bash
worca plugin init my-plugin --with task-source,agents,skills,workflows
```

Produces a plugin that already passes `validate --strict`. Edit it; don't hand-roll a manifest.
Drop parts you don't need with `--with` (note: `workflows` requires `agents`).

## Dev loop

```bash
worca plugin link ./my-plugin                                  # current/ -> your working dir
WORCA_MOCK=1 worca plugin exec my-plugin main listTasks        # offline, canned frames
worca plugin exec my-plugin main getTask --args '{"id":"X-1"}' # real call
worca plugin exec my-plugin main listTasks --inspect           # --inspect-brk on the child
worca plugin validate ./my-plugin --strict
worca plugin doctor my-plugin
```

`link` takes a **dir**, not a name — the name comes from the manifest. Linked plugins refuse `update`.
Edits to a linked dir are live: no reinstall, the next op spawns a fresh child.

## Manifest quick reference

Only `name` is required. Unknown fields are warnings (errors under `--strict`).

| Field | Notes |
|---|---|
| `name` | kebab-case, ≤64 chars, machine-unique, used as a dir name |
| `version` | optional — absent means the pinned SHA **is** the version |
| `engines.worca-cc-api` | `">=1 <2"`. Integer host API. Unparseable → fails closed, won't install |
| `setup.node` | `true` → `npm ci --ignore-scripts --omit=dev` at install. **Lockfile mandatory** |
| `setup.python` | only `"pyproject"` → `uv sync`. Worca CC never *runs* python; your JS spawns it |
| `taskSources[].id` | kebab-case |
| `taskSources[].module` | must start `./`, no `..`, no backslashes |
| `taskSources[].configSchema[]` | persistent config — `text` \| `select`, plus `secret`/`required`/`default`/`help`/`options` |
| `taskSources[].inputs[]` | per-run UI — see next table. **Exactly one `task-browser` required** |

## Marketplace manifest (repo-level, optional)

A repo can declare itself a **marketplace** with `worca-cc-marketplace.json` at its root:

```json
{ "name": "My Plugins", "description": "…", "plugins": ["plugins/one", "plugins/two"] }
```

Listed dirs (any depth, no `..`) each contain a `worca-cc-plugin.json`; when the file is
present it is the complete plugin list (the depth 0–1 auto-scan is skipped). Repos without
it still work as implicit marketplaces via the scan. The worca-cc repo itself is a
marketplace (its 5 bundled plugins live under `plugins/`), registered by default.

## UI is schema-driven — pick from these widgets

You declare shapes; the host renders them. There is no way to ship a custom component.

| `inputs[].type` | Widget | Requires |
|---|---|---|
| `text` | text box | — |
| `select` | static dropdown | `options[]` |
| `remote-select` | dropdown, loaded on first focus by calling your connector | `optionsFrom` (a connector op name) |
| `task-browser` | debounced search + result list + preview | exactly one per source |

`configSchema[]` supports only `text` and `select`; `secret: true` renders `type=password` and is
never sent back to the browser (arrives redacted as `{set: true}`).

**`remote-select` + `optionsFrom` is the extensibility hatch.** Naming an op there is also what
allowlists it for the browser — undeclared ops are rejected with 400 at `/api/sources/call`.
The data, filtering, and pagination semantics behind every widget are entirely yours.

## Connector contract (plugin API v1)

Default-export a **factory**, not a class:

```js
export default function createTaskSource(ctx) {
  return { validateConfig, listTasks, getTask, reportResult, capabilities, /* custom ops */ };
}
```

| Op | Signature | Returns |
|---|---|---|
| `validateConfig` | `()` | `{ok:true, identity?}` \| `{ok:false, errors:[{field,message}]}` — gates the whole pane |
| `listTasks` | `({inputs, search, cursor})` | `{tasks:[{id,title,url,state,labels,updatedAt}], cursor?}` |
| `getTask` | `(id)` — **positional** | `{...summary, body /* markdown */, meta}` |
| `reportResult` | `(id, {status, summary, links})` — **positional** | anything |
| `capabilities` | `()` — optional | `{writeBack, incrementalSync}`; missing → `writeBack: true` |
| custom | `(args)` | whatever the widget needs |

`ctx` = `{ apiVersion, config, state: {get, set}, log }`.

- `ctx.config` — `configSchema` values, defaults applied, `{"$env":"VAR"}` already resolved
- `ctx.state.get/set` — a KV bag; `set` only *records*, the **host** persists it after a successful frame
- `ctx.log(level, msg)` — the only legal output channel

Throw `Object.assign(new Error(msg), { kind })` to pick the error kind:
`auth | rate-limit | network | plugin | timeout | protocol`. The UI renders kind-keyed messages.

## Runtime model — design around it

One `node` child process **per op**. No daemon, no reuse. Env is scrubbed to `{PATH, HOME}` only.
Payload arrives on stdin, one JSON frame leaves on stdout, process exits. 30s timeout → SIGKILL.

## Common mistakes

| Mistake | What happens |
|---|---|
| `console.log` anywhere in the connector | Corrupts the stdout frame → `PluginOpError('protocol')`. Use `ctx.log` |
| Reading `process.env.MY_TOKEN` | Always undefined — env is `{PATH, HOME}`. Declare a `configSchema` field; users can point it at `{"$env":"MY_TOKEN"}` |
| Zero or two `task-browser` inputs | Install-blocking validation error |
| Calling a custom op from the pane without `optionsFrom` | 400 — the browser allowlist is derived from `inputs[]` |
| `setup.node: true` with no `package-lock.json` | Install fails; `npm ci` requires a lockfile |
| Relying on a `postinstall` script | Never runs — install uses `--ignore-scripts` |
| Assuming `ctx.state.set` persisted after a throw | It doesn't. The delta is discarded unless the op returns `ok` |
| Agent `.md` with no `.meta.json` sidecar | Registry silently ignores it (warn only) |
| Workflow template referencing an agent key you don't ship | Template skipped at import |
| Non-opaque task ids | `getTask(id)` receives exactly what `listTasks` emitted — keep them round-trippable |
| `getTask().body` not markdown | It becomes the pipeline prompt verbatim |
| Symlinks pointing outside the plugin dir | Deleted during export, reported as a warning |

## The one example worth reading

`plugins/github-source/` — a complete, zero-dependency GitHub Issues source:
ETag revalidation via `ctx.state`, `remote-select` repo picker, a filter micro-syntax,
`{"$env":"GH_TOKEN"}` token config, and write-back that comments and optionally closes the issue.
Copy its shape.

## Where the host logic lives

| Concern | File |
|---|---|
| Manifest schema + validation | `src/core/plugin-manifest.mjs` |
| Install / update / uninstall lifecycle | `src/core/plugin-store.mjs` |
| Child-process protocol | `src/core/plugin-shim.mjs`, `plugin-shim-child.mjs` |
| Config / secrets / state | `src/core/plugin-config.mjs` |
| Widget rendering | `ui/public/source-pane.mjs`, `ui/public/plugins-view.mjs` |
| CLI | `src/cli/worca-cc.mjs` (`worca plugin help`) |

## Before you ship

```bash
worca plugin validate ./my-plugin --strict && worca plugin doctor my-plugin
```

Both clean, plus at least one real (non-mock) `exec` per op.
Then push and let users register the repo as a marketplace:
`worca marketplace add <repo-url>` (or Plugins → Add marketplace in the UI) →
install from the Available list or `worca plugin install <name>`.
Removing a marketplace never removes installed plugins.
Installs are SHA-pinned; users see a consent inventory listing every agent's tools and every
secret you request, so keep both minimal.
