# Feature flags — turning experimental features on and off

Worca ships unfinished features behind **feature flags**, so they can land on `dev` early and be
tried by whoever opts in, without changing the product for everyone else.

## What a flag is

A flag is a **machine-wide boolean** with a name, listed in one file:
[`src/shared/flags/registry.mjs`](../src/shared/flags/registry.mjs). The server, the web UI, the
tests and this page all read that same list. Nothing is a flag unless it is listed there.

A flag is **not a level** and **not a permission**:

- An element with `data-flag` shows when its flag is on, at any [interface mode](ui-levels.md).
  With `data-min-level` as well, both must allow it.
- A flag is never a security boundary. Code that must not run while a flag is off checks
  `flagEnabled` itself.

Flags apply to everyone using this Worca. There are no per-user, per-project, percentage or
remote flags.

## Flags today

| Key | Stage | What it gates |
|---|---|---|
| `flagsDemo` | experimental, default off | A note in Settings › Labs that proves the system end to end. |
| `keepAwake` | beta, default on | Stops the OS sleeping on its idle timer while a run has agents working; the display may still turn off. Also a switch in the account menu (the profile corner); no effect on a container or hosted worca. A run waiting on a question, paused or ended does not count, and nothing is held on a container or hosted worca. The UI server holds one child tied to its pid: `caffeinate -i -w <pid>` on macOS, `systemd-inhibit --what=idle` wrapping `tail --pid <pid>` on Linux, a PowerShell child holding `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` on Windows. A missing tool logs one warning and never affects a run. |
| `shapeFirst` | beta, default on | [Shaper](shape-it-first.md): a run can stop after its plan is refined and wait for a person to approve, revise or stop it; the `wf_shape` workflows, the plan answer route and the Chat surfaces (the Shaper tile, the nudge on a run card, the Plans tab). Off (Settings › Labs or `worca flags off shapeFirst`), those surfaces are hidden, the `/api/shape/…` routes and the plan answer route answer 404, `POST /api/run` refuses `shape`, the CLI refuses the workflows and a Watch PR fix run gets its own chat card instead of a round. |
| `runTags` | experimental, default off | Cost tags: the cost tag field on the New run form, tag chips and the tag filter on the Runs list, a Cost tags row under the run page's time, cost and changes tiles (editing on finished runs), the tag field on Chat run cards, the tag filter and tag Group by options on Statistics. Tag dimensions (team policy `runs.tagDimensions`, or Settings › Runs › Tag dimensions): the New run slots and their required-key warning, the dimension labels in the Statistics Group by and the Runs list filter's optgroups. Team metrics: the tag Group by options and the tag filter. Tags set through the API or CLI are stored whatever the flag. |
| `runLabels` | experimental, default off | Free-word labels on runs (`hotfix`, `needs demo`): chips after the title on the Runs list (2, then +N), under the status on run pages, read-only on chat run cards; the Runs list label filter (any of the chosen labels), chosen from the top search ("Runs labelled hotfix", or type `label:hotfix`); the selection bar's Label action. Labels never reach Statistics, Team metrics, CSV or policy. Off, `/api/labels`, `PUT /api/runs/:id/labels` and `POST /api/runs/bulk/labels` answer 404. |
| `smartRunNaming` | experimental, default off | Smart run naming: one cheap model call reads the task and suggests the run title and a branch name (`feat/…`, `fix/…`) on the New run form, with a Suggested chip, a type select and Suggest again / clear buttons. Off, nothing changes: no model call, no chip, same `worca-cc/words-id` branches, and `/api/naming/*` answers 404. See [Smart run naming](#smart-run-naming). |
| `runPresets` | beta, default on | [Run presets](run-presets.md): the Preset ▾ button on the New run form, the Settings › Presets tab, schedules that follow a preset, `worca run --preset` and Chat's `list_presets` / `propose_run` `presetId`. Off, every `/api/presets` route answers 404 and `POST /api/run` refuses a `presetId` with 400. |
| `requirements` | experimental, default off | The Requirements page (feature specs through a short interview, Ready and Start in Worca, product briefs), the Requirements interview row on Models › Engines › Claude › Helper jobs, the Requirements tile on Statistics. Off, money already spent on the page stays in Spent and keeps its Requirements row in Group by and the Cost report; every `/api/requirements` route answers 404 and no `requirements-changed` frame is sent ([docs](requirements.md)). |

## Smart run naming

Flag `smartRunNaming`, with a card in Settings › Runs.

- **What the model sees:** the task text only, capped at 2000 characters, plus a title the person already typed. It replies with a title, a branch type, a slug and a short reason.
- **Pattern:** `{type}/{slug}` by default. Placeholders: `{type}`, `{slug}`, `{ticket}` (the task source id, e.g. `proj-123`) and `{id}` (the short run id). "Add the run id to the branch" appends `-` plus the id only when the pattern has no `{id}`. The form preview omits the id; Worca adds it at start.
- **Types:** the list the model may pick from (default `feat fix chore docs refactor test`). A type outside the list becomes the first type, the fallback.
- **Model:** Models › Engines › Helper jobs › Run naming; unset, the cheapest ready Claude model at its lowest effort.
- **Starts without the form** (chat run cards, `worca run` without `--branch`, presets, task-source runs) never call the model: they use the pattern with the first type.
- **Collision rule:** a branch Worca derived gets `-` plus the short id when it already exists locally; a branch the person typed is kept verbatim and may reuse an existing branch.
- **Title rule:** while the flag is on, a title that is given (typed or suggested) is kept; an empty title still gets today's generated title.
- **Fallback:** when the model is unavailable the title stays empty and the branch shows today's name.
- **Cost:** recorded as a utility cost and shown in Statistics as "Naming". It is never billed to a run and does not count toward budgets.
- **Project override:** Project › Settings › Runs can override the pattern and the types.

## Add a flag

### 1. The registry entry

```js
entry({
  key: 'customDashboard',            // camelCase, 3 to 41 letters and digits
  title: 'Custom dashboard',         // shown in Settings › Labs
  description: 'Build your own dashboard from charts.',   // one line
  stage: 'experimental',             // experimental | beta | retiring
  default: false,                    // experimental: always false; beta: may be true
  owner: 'your-github-handle',
  since: '1.12.0',                   // the version it first ships in
  added: '2026-11-02',               // YYYY-MM-DD
  reviewBy: '2027-01-31',            // at most 90 days after `added`
  docs: 'docs/custom-dashboard.md',  // optional: "How it works" in Settings links here
  requires: [],                      // optional: other flag keys that must be on
}),
```

| Field | Meaning |
|---|---|
| `stage` | `experimental` (shown as **Labs**): may change or break, always off by default. `beta`: nearly done, may default **on** (opt-out). `retiring`: about to be removed; forced to its `default`, hidden from Settings, refused by the API. |
| `added` / `reviewBy` | The review window. `reviewBy` is at most 90 days after `added`. Past it, CI fails until the owner decides (see [Lifecycle](#lifecycle)). |
| `requires` | Flags this one depends on. Turning it on turns them on; turning one of them off turns it off. A flag whose prerequisite is off is reported off, whatever is stored. No cycles. |

### 2. Mark the UI

In markup, put `data-flag` on the element. It is hidden from the first paint while the flag is
off, and shown or hidden live when the flag changes:

```html
<section class="card" data-flag="customDashboard" data-flag-chip>…</section>
```

`data-flag-chip` adds the **Labs** / **Beta** chip, which links to the flag's row in
Settings › Labs. A tab (`[role="tab"]`, `.tab`, or a button in `.tabs` / `.seg`) and a sidebar row (a
button in `.nav`) get the chip inside, after the label, as plain text, never a link. `data-flag-chip="KEY"` names the flag without
gating the host, so its host shows the chip while the flag is off.

In JS (`ui/public/flags.mjs`):

```js
import { flagOn, onFlagChange, chip } from './flags.mjs';

if (flagOn('customDashboard')) mountDashboard();          // read at the point of use
onFlagChange('customDashboard', (on) => (on ? mountDashboard() : unmountDashboard()));
chip(el);                                                  // DOM built in JS gets its chip this way
```

Every change also fires a `worca:flags` event on `document` (`detail: { flags, changed }`).

### 3. Gate the server

```js
import { requireFlag, flagEnabled } from '../src/core/flags.mjs';

app.get('/api/dashboard/charts', requireFlag('customDashboard'), handler);   // 404 while off
if (flagEnabled('customDashboard')) broadcast(frame);                         // WS frames
if (flagEnabled('customDashboard')) defs.push(tool);                          // Chat tools, in createAskTools
```

`requireFlag` answers `404 { error: 'not found' }` while the flag is off: a disabled feature
looks exactly like an absent one. Always write the key as a literal, so the usage scan can see it.

## Turn one on

Three ways:

- **Settings › Labs**, at every interface mode. A switch applies at once, in every open
  tab. **Reset all** puts every unlocked flag back to its default.
- **`worca flags`** on the command line:

  ```sh
  worca flags                 # list: key, on/off, stage, where the value comes from
  worca flags on <key>
  worca flags off <key>
  worca flags reset [<key>]   # back to the default; no key = every unlocked flag
  ```

  The CLI writes `settings.json`, so the server sees the change on its next check. Open tabs pick
  it up on their next load or reconnect (the CLI is a different process and does not broadcast).
- **`WORCA_FLAGS`** in the server's environment: `WORCA_FLAGS="customDashboard,-autoCostChips"`.
  A key turns a flag on, `-key` turns it off. A flag set this way is **locked**: Settings shows
  its switch disabled, and the API and the CLI refuse to change it.

## Resolution

For each flag, the first of these that applies wins:

1. `retiring` stage: the registry `default`, locked.
2. `WORCA_FLAGS`: locked.
3. `settings.json` `flags: { key: true|false }`. Only values that differ from the default are
   stored.
4. The registry `default`.

Then `requires` is applied: a flag is on only when everything it requires is on.

Unknown keys in `WORCA_FLAGS` or `settings.json` are ignored, with one warning per key. A
non-boolean stored value is ignored. A key removed from the registry drops out of `settings.json`
on the next write.

The API: `GET /api/flags` lists every flag that is not retiring. `PATCH /api/flags` takes
`{ key: true | false | null }` (`null` = back to the default), applies `requires`, and answers
400 for an unknown key or a bad value, and 409 `{ code: 'locked' }` for a `WORCA_FLAGS` key.

## Lifecycle

Every flag ends. When `reviewBy` passes, `test/flags-registry.test.mjs` fails until the owner:

- **graduates** it: deletes the registry entry and every `data-flag`, `flagOn`, `onFlagChange`,
  `flagEnabled` and `requireFlag` use of it, **in one PR**. The feature is now simply on;
- **moves it on** a stage (`experimental` → `beta`, or → `retiring` before removal), with a new
  review date;
- **extends** it: sets `extendedOn: 'YYYY-MM-DD'` and a non-empty `extendReason`. The 90-day window
  then runs from `extendedOn`;
- **removes** it, feature and all.

What CI checks:

- `test/flags-registry.test.mjs`: every entry is well formed, inside its review window and not
  past it, and `requires` is acyclic.
- `test/flags-usage.test.mjs`: every key named in `ui/public/**` and `src/**` (`data-flag="…"`,
  `flagOn('…')`, `flagEnabled('…')`, `requireFlag('…')`, `onFlagChange('…')`) is in the registry,
  and every registry key is used somewhere. Keep literal keys out of comments in those trees: the
  scan counts them.

## Testing a flagged feature

- **Unit**: `createFlags({ registry, env: () => 'key', read, write })` from `src/core/flags.mjs`
  takes an injected environment and store. Or set `process.env.WORCA_FLAGS`, which is read on every
  call.
- **jsdom**: render the shell with the flag on or off:
  `renderIndexHtml(html, theme, level, { key: true })` (`src/core/index-html.mjs`).
- **CDP**: `window.__np.flags.set(key, on)` flips a flag through the real API. See
  `tools/verify-flags-cdp.mjs`.

The suite never sees your own flags: `tools/test.mjs` drops `WORCA_FLAGS`, and under the test
runner `settings.json` flags read as empty unless the test sandboxes `HOME` and sets
`WORCA_TEST_ALLOW_HOME_FALLBACK=1`.
