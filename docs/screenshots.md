# Screenshots — how they are made

The UI shots in `docs/screenshots/` come from one script, `tools/readme-screenshots.mjs`. It
boots a sandboxed Worca with believable demo data and captures every view in headless Chrome,
so the whole set can be re-shot after a UI change.

## Recipe

```bash
npm ci                                   # the server needs node_modules
node tools/readme-screenshots.mjs        # all shots into docs/screenshots/, about 30 s
node tools/readme-screenshots.mjs --only running,clarify    # just these
```

| Flag / variable | What it does |
| --- | --- |
| `--only a,b` | Shoot only these names (without `.png`). |
| `--out DIR` | Write the PNGs to `DIR` instead of `docs/screenshots/`. |
| `--port N` | The sandbox server's port (default 4399). The script stops when the port is taken; pick another. |
| `--keep` | Keep the sandbox home and print its path, for debugging. |
| `CDP_PORT` | Chrome's debugging port (default 9350). |
| `CHROME_BIN` | The Chrome binary, when it is not in a standard macOS or Linux location. |

It is not part of `npm test`. It never touches a Worca you already run (on 4317 or anywhere
else), stops only the server and Chrome it started, and removes only the temp dirs it created.

**Viewport.** A 16-inch MacBook Pro at its default "looks like" resolution:
`Emulation.setDeviceMetricsOverride` with 1728×1117 CSS pixels at device scale 2, so every PNG
is **3456×2234**. Light theme (stored setting plus `prefers-color-scheme: light` emulation,
since headless Chrome on macOS defaults to dark). Whole viewport, sidebar included, no
cropping. Each shot uses the lowest interface mode that shows its view (see
[UI levels](ui-levels.md)).

## Sandbox

- **`HOME`, `USERPROFILE` and `WORCA_HOME` all point at one temp dir.** `WORCA_HOME` alone is
  not enough: it moves the database and store, but `settings.json` lives under
  `HOME`/`USERPROFILE` (`settingsFile()` in `src/core/settings.mjs`). That file holds the theme,
  the interface mode, the model catalog, budgets and provider tokens. `~/.claude.json` and
  `~/.claude/skills` sit under `HOME` too.
- **Demo identity.** Every demo repo gets a local `user.name`/`user.email`, and the sandbox
  `~/.gitconfig` carries the same demo identity for commits the app makes. Team metrics and
  run branches would otherwise show the real user.
- **No server mock mode.** `WORCA_MOCK` paints a MOCK pill next to the logo. Runs use the
  per-run `mock: true` body flag of `POST /api/run` instead: offline and free.
- The server is imported in-process (`ui/server.mjs`) and listens on the sandbox port. Chrome
  gets the real `HOME` back (a Chrome with a fresh `HOME` never answers `Page.navigate` on
  macOS), its own temp profile and `--use-mock-keychain`.

## Seed

- **Demo repos** under the sandbox, each with a few back-dated commits by four demo people
  and a bare `origin`: `nimbus-crm` (a small Express contacts API), `lumen-docs` (a Markdown
  site generator), `nimbus-web` (a Vue app on the CRM API) and `nimbus-jobs` (a queue worker).
- **Finished runs.** 24 mock `wf_default` runs with realistic titles and prompts, answered at
  their clarify question (two stopped there instead). The mock blemishes are then fixed in the
  database: the `[mock] …` title is replaced, and each run gets a plausible cost, active time,
  human-hours credit and start time spread over the past weeks, per step and in `cost_ledger`.
  Dates are relative to the day you run the script.
- **Believable diff.** The mock implementer writes a generic file. For "CSV export for
  contacts" the run branch gets a real change instead (a CSV module, a route and a test), and
  `results.json` and the stored patch are rebuilt from it with the app's own diff helpers.
- **Actions.** `nimbus-crm` gets Run and Test actions; the CSV run is checked out and its
  Test action really runs `npm test` once.
- **Live runs.** Three mock runs are held at their clarify question. Their questions are
  rewritten in place to read as real decisions, their titles replace the mock ones, and the
  Task and Clarify steps get plausible time and cost.
- **Ask Worca.** A stored conversation built with the real proposal validator: a run card for
  the "Paginate the search endpoint" run, linked to it, plus three shorter chats and their
  Ask spend.
- **Schedules.** Three repeating series and one one-off ticket, created through
  `POST /api/run` with `repeat` / `scheduledFor`. The scheduler does not tick in-process, so
  nothing fires.
- **Team metrics.** Enabled on `nimbus-crm`; 26 run records written through the real metrics
  sync onto its `worca-metrics` branch (mock runs are never recorded, so they are seeded).
- **Workspace.** A `Nimbus` workspace (`nimbus-crm`, `nimbus-web`, `nimbus-jobs`) with a
  stored interconnection map: REST, queue and shared-DB edges with file evidence.
- Not seeded: pull requests. The sandbox has no GitHub remote, so Statistics shows
  "PRs merged 0 / 0".

## Leak guard

Before anything is sandboxed, the script builds a denylist from the real environment: the OS
user name, the home path, the global git `user.name`/`user.email`, and the ids, labels and
endpoint hosts of the custom models in the real `settings.json` catalog. Before each capture it
reads the page text (plus input values) over CDP. The shot fails on any denylist hit, printing
only the entry's number, never its value, and also fails on a leftover `[mock]`. The denylist
is held in memory and never written anywhere.

## Current set

| File | View | UI level | How it is staged |
| --- | --- | --- | --- |
| `running.png` | Runs, three live runs under "Needs you", a finished run's summary open | Simple | live mock runs held at clarify |
| `clarify.png` | A live run waiting on its two clarify questions | Simple | live mock run, questions rewritten in place |
| `run-detail.png` | A finished run's Diff tab (`src/routes/contacts.js`) | Advanced | mock run with a real change on its branch |
| `history.png` | Runs with finished runs, one run's summary open | Simple | 24 mock runs, restaged |
| `composer.png` | Workflows (`#workflows`), the Default workflow on the canvas beside the Library | Advanced | built-in workflow, opened from the Library's Workflows tab |
| `stats.png` | Statistics, "This week" | Advanced | restaged costs, time and Ask spend |
| `ask-worca.png` | The Ask Worca sheet with a run card | Simple | stored conversation |
| `schedules.png` | Schedules, Repeating tab | Advanced | three series and a ticket via `POST /api/run` |
| `team-metrics.png` | Team metrics for `nimbus-crm`, "Last month" | Expert | records on the `worca-metrics` branch |
| `workspace-map.png` | The `Nimbus` workspace's Map tab | Advanced | stored scan result |
| `actions.png` | A finished run's Actions tab after a Test run | Advanced | project actions, checkout, real `npm test` |
| `scripts.png` | Workflows (`#workflows/scripts`), the Library's Scripts tab with the built-in script rows | Expert | built-in scripts |

Statistics uses "This week" from Wednesday on, "This month" early in a week from the 8th, and
"All time" otherwise, so the charts always have several days of data.

`architecture.png` is a diagram, not a UI shot, and the script does not produce it; see
[ARCHITECTURE.md](ARCHITECTURE.md) for how to regenerate it.
