# Setup assistant

The setup assistant checks the machine, then applies every answer at once. This page describes the server
API it uses. The user guide for the dialog lands with the dialog itself.

## Server API

Every route below refuses an agent caller under agent isolation with 403 `SETUP_AGENT_BLOCKED`.

### `GET /api/setup/detect`

Checks the machine and answers within about 3 seconds:

```json
{ "checks": [{ "id": "claude", "label": "Claude Code", "state": "ok", "line": "Claude Code is installed and signed in." }], "ms": 412 }
```

There is one row per check, always in this order: `claude`, `git`, `proxyEnv`, `direct`, `harnesses`,
`ollama`, `apiKey`. `state` is `ok`, `warn` or `no`, and `line` is one plain-words sentence. Some rows also
carry `facts`: the proxy host for `proxyEnv`, the engines for `harnesses`, the model count for `ollama`.

- Each check has 2.5 seconds. A check that takes longer is `warn` with "Couldn't check this in time.", and a
  check that fails is `warn` with "Couldn't check this."
- `proxyEnv` shows `host:port` only, never a proxy login. `apiKey` says whether `ANTHROPIC_API_KEY` is set,
  never its value.
- The `claude` row and the Getting started "Connect Claude Code" tick come from the same detection, so they
  always agree.
- `?recheck=1` skips the remembered answers.

### `POST /api/setup/apply`

The body must be JSON (any other content type gets 415 `JSON_REQUIRED`). Its fields are grouped by
assistant step:

```json
{
  "network": { "networkProxy": { "enabled": true, "upstream": "proxy.acme.example:8080", "auth": "auto" },
               "login": { "domain": "ACME", "user": "jdoe", "password": "…" } },
  "access":  { "copilot": { "acknowledgeTerms": true, "accountType": "individual", "signIn": true, "importModels": ["gpt-5.5"] },
               "openai": { "baseUrl": "http://127.0.0.1:8080/v1", "apiKey": "…", "importModels": ["qwen3"] },
               "anthropic": { "baseUrl": "https://llm.acme.example", "apiKey": "…" } },
  "models":  { "modelRoles": { "claude": { "everyday": { "model": "claude-sonnet-5-5" } } }, "testRoles": true },
  "work":    { "uiLevel": "simple", "pipelineCostLimitUsd": 5, "totalCostLimitUsd": 50, "costLimitResetPeriod": "weekly",
               "autoGeneratePrDescription": true, "smartNaming": { "suggestTitle": true }, "runEngine": "claude" },
  "fromStep": "copilot-signin"
}
```

Every group and field is optional. The apply runs in three phases:

1. **Check.** Every group is checked before anything is saved. An invalid value answers 400
   `{ error, field }`, where `field` is the body path (for example `work.pipelineCostLimitUsd`). Nothing is
   written and nothing runs.
2. **Save.** `settings.json` is written once, and only the settings whose stored value changes are written.
   The 202 answer lists them in `written`. When another tab changed one of those settings since the check,
   the answer is 409 `SETTINGS_CHANGED` and nothing is written.
3. **Run.** The side effects run in this order: `proxy-swap`, `proxy-login`, `copilot-signin`,
   `copilot-import`, `openai-import`, then one `role-test.<engine>.<role>` per role.

The answer to a valid apply is 202 `{ id, written, steps: [{ id, label }] }`. Progress then arrives on the
WebSocket, one frame per step:

```json
{ "type": "setup-apply", "id": "stp_…", "result": { "id": "copilot-signin", "label": "GitHub Copilot sign-in", "state": "ok", "line": "Signed in to GitHub Copilot." } }
```

A final frame `{ "type": "setup-apply", "id": "stp_…", "done": true, "ok": true, "retry": null }` ends the
run. `GET /api/setup/apply/:id` returns the same results for polling (`done`, `ok`, `retry`, `results`)
for an hour after the run.

A result's `state` is `ok`, `failed`, `skipped` or `refused`:

- **failed**: the run stops at the first failed step. That row and the final frame carry `retry` set to the
  step's id, and every later step is `skipped`. Settings saved in phase 2 stay saved.
- **Retry**: send the same body again with `fromStep` set to that id. The steps before it are reported
  `skipped` ("Done before; not run again."). A `fromStep` that names no step in this setup is a 400 on
  `fromStep`.
- **refused**: with the credential broker on (`WORCA_BROKER_URL`), Worca does not store a provider API key
  or a Copilot sign-in. Each one becomes a `refused` row whose line points at the broker's key page, and
  nothing is stored for it. The rest of the apply still saves and runs, and a refusal never sets `retry`.

Only one apply runs at a time. A second POST while one runs answers 409 `SETUP_RUNNING` with the running
apply's `id`.

### `GET /api/setup/team`

The team setup this machine can see, in two parts:

- `file`: the [team setup file](#team-setup). `{ found: false, path }` when there is none;
  `{ found: true, ok: false, path, field, error }` when it was refused; otherwise
  `{ found: true, ok: true, path, source, warnings, hash, values, keys, unmapped }`.
- `homes`: one entry per cached team policy home that sets any team setup field:
  `{ home, hash, values, keys, unmapped }`.

`values` is the part of a `POST /api/setup/apply` body the team setup stands for (`models.modelRoles` and
`work`), with each role mapped to a model this machine can run. `keys` lists the apply-body paths the team
filled. `unmapped` lists the roles no source here offers: `{ harness, role, upstream, line }`, where `line` is
"None of your sources offer it." `hash` changes when, and only when, a team setup field changes.

`GET /api/setup/team?homes=1` answers `{ homes: [{ home, hash, keys }] }` only, where `keys` are the policy
keys present. It reads no model catalog and runs no sign-in check. The account menu uses it.

### `POST /api/setup/team/draft`

Builds a team setup draft from the saved settings and answers `{ doc, text, warnings }`. Only the model roles
and the work settings are read: never `networkProxy`, `providers` or a proxy login. A role on a model that only
this machine knows is left out with a warning, such as
"models.roles.claude.deep: my-local-model is not a model every machine knows — left out".

### Contracts for the dialog

- **A new proxy must pass a test first.** Run `POST /api/proxy/test` on the new proxy upstream; that test
  records the pass. Otherwise Apply answers 400 `{ field: 'network.networkProxy', code: 'UNTESTED' }` and
  saves nothing. When the proxy settings are already saved (a `proxy-swap` retry), the test is not needed
  again.
- **Sign in to Copilot before Apply.** Apply never starts the Copilot device flow. The dialog runs it
  through `/api/providers/copilot/login` first, and Apply's `copilot-signin` step only checks the stored
  token.
- A saved proxy login only works with NTLMv2. A `network.login` while the proxy login is Basic or Digest is a
  400 on `network.login`.

## The dialog

`ui/public/setup-assistant.mjs` builds the dialog. Every open loads the saved values first
(`/api/settings`, `/api/proxy/status`, `/api/providers`, `/api/config`) plus `GET /api/setup/detect`.
Detection fills a field only when the saved value is empty, and only on a first start. The head shows
"Step N of 7", the step's title and a subtitle. The foot holds the status line and the buttons. On steps 2–5,
**Skip** keeps that step's saved values.

| Step | What it asks |
|---|---|
| 1 Check this machine | Nothing. One row per detect check, with OK, Check or No. |
| 2 Network | Direct, or through a corporate proxy: host and port, login mode, account and password (NTLMv2 only), the hosts that go direct, and under **More** the timeouts and the local proxy port. A proxy found in `HTTPS_PROXY` on a first start shows as one "Found in your environment" line with **Change**. |
| 3 Model access | Which sources to use: Claude Code sign-in, GitHub Copilot, OpenAI-compatible, Anthropic-compatible. Copilot shows its notice, the "I understand" switch, the plan, and the device sign-in inside the dialog. With the credential broker on, keys and the Copilot sign-in stay on the broker's key page. |
| 4 Models | The Models page's Roles: Deep thinking, Everyday coding and Quick jobs per harness, plus "Test each model after Apply". Copilot models picked here are imported by Apply. |
| 5 How you work | Interface mode, the per-run and total limits, the reset period, AI-written PR descriptions and smart run names. |
| 6 Review | One row per group. A row that differs from the saved value carries **Changed**, and **Change** jumps back. A re-run lists only the changed rows. |
| 7 Apply | One row per apply step, filled from the `setup-apply` frames (or the poll). |

**The Network gate.** With a corporate proxy picked, **Next** stays disabled until **Test** passes for exactly
the host, port, login mode and direct hosts on screen. A pass counts for 9 minutes, under the server's
10-minute window. This holds for the saved proxy on a re-run too: **Skip** is the way past Network without a
test, and it keeps the saved values. An apply refused with `UNTESTED` returns to Network.

**Re-run.** Settings › General › Setup assistant › **Run setup again** opens the dialog with the saved values
in every field. Only the changed groups and fields are sent, and a cleared role is sent as `null`. With nothing
changed, **Apply changes** is disabled ("Nothing changed."). A first start with nothing to change shows
**Finish** instead and posts nothing.

**Fix-it links.** The Network proxy card's **Fix in setup assistant** (shown while the proxy needs a login) opens
the dialog on Network. A Copilot **Sign in** pill on the Models page opens it on Model access with Copilot
switched on. A fix-it run closes back to the page it came from.

**Apply and Retry.** The first unfinished row shows a spinner. Each finished row shows Done, Failed, Skipped or
Refused and its line. **Continue** closes the dialog. On a first start or a re-run, the welcome's three doors
come next. A failed step that names a retry shows **Retry**, which resends the same answers from that step. The
dialog keeps no secret after the 202, so a retry at `proxy-swap` or `proxy-login` reopens Network and asks for the
proxy password again. A failed job without a retry, or a job Worca lost track of, shows **Back to review**.

## Team setup

A team setup is a team policy document limited to the Setup fields: the model roles (`models.roles`), the
interface level, AI-written PR descriptions, Smart run names, the coding agent, Sync before run and Wait for the
network (`setup.*`), plus the spend limits (`cost.pipelineLimitUsd`, `cost.totalLimitUsd`, `cost.resetPeriod`)
and `models.hideBuiltins`. It comes from a team policy home (see [Team policy](team-policy.md#team-setup)) or
from a file.

**The file.** Worca looks for `~/.worca-cc/team-setup.json`, or the path in `WORCA_TEAM_SETUP`. A URL there is
refused: Worca reads a team setup only from a file on this machine. The file is at most 64 KB. Any other field is
dropped with a warning. Tags are dropped too: they come from the project's team policy (`runs.tagDimensions`,
`runs.enforceTags`).

**Refused files.** A team setup never carries network settings, model sources, keys, tokens or passwords. A
file that carries one, by key name or by a value that looks like a key, is refused whole, with the field named:
"A team setup never carries network settings: “networkProxy”. Remove it and try again." The Check step shows
the refusal on its **Team setup** row.

**In the dialog.** On a first start, the file's values fill only the answers that are blank, and each Review
row they filled carries a **Team** chip. A team role that no source on this machine offers shows "None of your
sources offer it." on Models and on Review.

**The account-menu notice.** When a team policy home's Setup fields change, the account menu shows "Your team
updated the recommended setup · Review". Review lists only the rows that differ from what is saved, and nothing
changes before **Apply changes**. When nothing differs, Review says "Your setup already matches your team's
recommendation." and offers **Finish**. The notice hides once that review ends with Apply then Continue, or with
Finish; **Set up later** keeps it.

**Share as team setup.** After a successful Apply, **Share as team setup** downloads `team-setup.json` from
your saved settings ([`POST /api/setup/team/draft`](#post-apisetupteamdraft)). It has no network settings,
model sources or keys, and its roles name upstream models (`claude-opus-5-5`), so each machine maps them to its
own source.

**`worca setup --from FILE [--yes]`.** Applies a team setup file with one settings write. It asks one question
for each of these that the file leaves out: Interface level, Coding agent, Per-run limit ($), Total limit ($),
Reset, AI-written PR descriptions, and the Deep thinking, Everyday coding and Quick jobs models. Enter keeps the
current value. A role the file names but no source here serves counts as set. Then it prints one line per changed
setting (one per changed sub-key for Sync before run, Wait for the network and Smart run names) and asks
`Apply these changes? [y/N]`; anything but yes exits 1 with "Nothing changed.". `--yes` asks nothing. A
refused file exits 2 and names the field. It never changes the network or model access: use the setup assistant
or `worca proxy` for those.
