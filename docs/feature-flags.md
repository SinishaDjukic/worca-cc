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
| `flagsDemo` | experimental, default off | A note in Settings › Experimental that proves the system end to end. |
| `keepAwake` | experimental, default off | Stops the OS sleeping on its idle timer while a run has agents working; the display may still turn off. A run waiting on a question, paused or ended does not count, and nothing is held on a container or hosted worca. The UI server holds one child tied to its pid: `caffeinate -i -w <pid>` on macOS, `systemd-inhibit --what=idle` wrapping `tail --pid <pid>` on Linux, a PowerShell child holding `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` on Windows. A missing tool logs one warning and never affects a run. |
| `shapeFirst` | experimental, default off | Shape it first (Plan it with me): a run can stop after its plan is refined and wait for a person to approve, revise or stop it; the `wf_shape` workflows, the plan answer route and the Chat surfaces exist only while it is on. Off, those routes answer 404 and the CLI refuses the workflows. |

## Add a flag

### 1. The registry entry

```js
entry({
  key: 'customDashboard',            // camelCase, 3 to 41 letters and digits
  title: 'Custom dashboard',         // shown in Settings › Experimental
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
| `stage` | `experimental`: may change or break, always off by default. `beta`: nearly done, may default **on** (opt-out). `retiring`: about to be removed; forced to its `default`, hidden from Settings, refused by the API. |
| `added` / `reviewBy` | The review window. `reviewBy` is at most 90 days after `added`. Past it, CI fails until the owner decides (see [Lifecycle](#lifecycle)). |
| `requires` | Flags this one depends on. Turning it on turns them on; turning one of them off turns it off. A flag whose prerequisite is off is reported off, whatever is stored. No cycles. |

### 2. Mark the UI

In markup, put `data-flag` on the element. It is hidden from the first paint while the flag is
off, and shown or hidden live when the flag changes:

```html
<section class="card" data-flag="customDashboard" data-flag-chip>…</section>
```

`data-flag-chip` adds the **Experimental** / **Beta** chip, which links to the flag's row in
Settings › Experimental.

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
if (flagEnabled('customDashboard')) defs.push(tool);                          // Ask Worca tools, in createAskTools
```

`requireFlag` answers `404 { error: 'not found' }` while the flag is off: a disabled feature
looks exactly like an absent one. Always write the key as a literal, so the usage scan can see it.

## Turn one on

Three ways:

- **Settings › Experimental**, at every interface mode. A switch applies at once, in every open
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
