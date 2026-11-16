# The gate

**Four isolated instances (classic and Stillhet, real and empty, each with its own HOME), walks only in the modes that
offer a place, classic intact, and a full test suite once per batch.**

The gate runs once per batch, outside any agent run ([build-order.md](build-order.md), A batch). It replaces the first
build's browser protocol and fix plan. The rules it holds are in `docs/stillhet/gate.md`.

## 1. What the gate proves, in order

Function before look (lesson 30). A step that fails stops the gate; nothing later is run or scored.

| Cell | Proves | Where |
|---|---|---|
| **G1** | The unit and contract tests of the batch pass, then the full suite once | No instance |
| **G2** | With the flag off the app is classic | The repository, and instances A and C |
| **G3** | Every control the batch touched, and every control that passed before, does what it says on real data | **G3·B** and **G3·D** for Stillhet; **G3·A** and **G3·C** for classic |
| **G4** | The same places by keyboard alone, and by touch with no hover | B and D |
| **G5** | The performance budgets hold on real data | B |
| **G6** | Only now the look: the prototype against the app | B, D and the prototype |
| **G7** | A person's review | The owner |

A step of [build-order.md](build-order.md) names its cells this way: "G3·B" is the walk of its place on instance B.

## 2. The four instances

| | What | HOME | Port | The flag | Agents | For |
|---|---|---|---|---|---|---|
| **A** | Classic on a copy of real data | `ROOT/A` | 4501 | `stillhet` off | Mock | Classic leads on what a place does and shows; proves classic intact on real data |
| **B** | Stillhet on a copy of real data | `ROOT/B` | 4502 | on | Mock (`--no-mock B` for the one real-agent pass) | The real-data walk: long lists, old records, real names |
| **C** | Classic, empty | `ROOT/C` | 4503 | off | Mock | Classic's first run; install-wide writes on classic |
| **D** | Stillhet, empty | `ROOT/D` | 4504 | on | Mock | The empty state of every read; onboarding; install-wide writes; the seeds |

**Start, list, stop** (`tools/stillhet-gate-instances.mjs`; `ROOT` is `--root DIR`, a folder outside the repository
and outside the system's temp folder, which a restart clears):

```
node tools/stillhet-gate-instances.mjs prepare A,B --root DIR          # copy, isolate and verify; no server
node tools/stillhet-gate-instances.mjs start --root DIR --ui-level expert   # all four; or: start B,D
node tools/stillhet-gate-instances.mjs list --root DIR                 # each address, HOME and pid
node tools/stillhet-gate-instances.mjs login-status B --root DIR       # is the Claude CLI signed in under that HOME
node tools/stillhet-gate-instances.mjs stop --root DIR                 # stops only what this tool started
node tools/stillhet-gate-instances.mjs start A,B --root DIR --fresh    # throw the copy away and make it again
```

Other flags: `--port A=4601`, `--mock-env WORCA_MOCK_X=v` (only `WORCA_MOCK_*` keys), `--welcome` (keep the first-run
screen), `login X` (the CLI's own login under X's HOME; its output is never printed or stored).

**What it guarantees.**

- **Its own HOME for each instance.** `settings.json` is read from `$HOME/.worca-cc`, not from `WORCA_HOME` (lesson 27;
  S30 in [server.md](server.md) changes that later). The tool sets `HOME`, `USERPROFILE` and `WORCA_HOME` to the instance folder.
- **A copy that is independent.** For A and B the owner's store is copied (the real one is only read; a filesystem clone
  where possible). Every repository it names is cloned into the instance HOME, and every record and every git link is
  pointed there. A path that cannot be copied points at `HOME/outside/…`, which does not exist.
- **Nothing leaves.** No GitHub token, no SSH agent, no "push as me" broker and no git config in the server's
  environment; `gh` and git read their config inside the instance HOME; every clone pushes to `HOME/outside/no-push`.
- **Nothing fires.** Every copied schedule is paused and every copied waiting start is cancelled; auto-resume is off.
- **The flag is a setting.** `stillhet` is in each instance's own `settings.json`, never in `WORCA_FLAGS`, so the switch stays usable.

**What it refuses, before anything starts:** port 4317 (the owner's own Worca); a HOME that is the real home; a root
inside the real store; a copy that still leads outside its HOME (`copy-not-isolated`, naming the path); a copied
schedule that is on; a push address outside HOME; an environment that could reach the owner's GitHub; a port in use;
a letter already starting. `test/stillhet-gate-instances.test.mjs` and `test/stillhet-gate-instances-isolation.test.mjs` hold each.

**Stop and clean.** `stop` kills only the processes the tool started (a pid file per HOME, checked against the
process's start time). Instances run only while a gate runs. There is no clean command today: `--fresh` deletes only an
instance HOME the tool made; removing `ROOT` after the last batch is by hand. To build in B2: `clean`, and the rewrite
of copied project keys to the clones' keys (S31), without which a project view on A or B may miss copied history.

**Writes on A and B** happen only in a scratch project made in the instance (`git init` in its HOME, added by hand),
never in a copied project. Install-wide writes (plugins, Settings values, Labs, Delete all chats) are done on C and D.
A task is started only where the `hello` frame says `serverMock: true`.

**The seeds** give every card and state a real record, made through the server's own routes, never faked in the browser:

| Seed | Makes | Runs against |
|---|---|---|
| `stillhet-seed-gate.mjs URL` | One mock task held at its review gate, so a real question waits | A running mock instance (D); refuses 4317 and a server that is not mock |
| `stillhet-seed-chat-cards.mjs` | A chat for every card kind: a question, a plan to approve, a proposed change, a failed task and reply, a finished task with its PR, and the rest | Its own sandbox (`PORT=N`, a temp HOME) |
| `stillhet-seed-tasks.mjs` | A task failed for real, one paused at its cap, one at its plan, one stopped with a kept branch, two finished with open PRs behind a stub `gh` | Its own sandbox |
| `stillhet-seed-schedules.mjs` | A schedule in every state: next up, skipped, paused, paused after failures, missed, running, waiting, ended | Its own sandbox |
| `stillhet-seed-projects.mjs URL` | Seven projects in every origin state, and one workspace with a link that carries evidence | A blank instance (D), with that instance's `WORCA_HOME` |
| `stillhet-seed-workflows.mjs URL` | An own, an imported, a branching and a looping workflow, one used by two tasks, an agent, a script | A blank instance |
| `stillhet-seed-marketplace.mjs URL` | A local market of four plugins: installed, has an update, needs setup, refuses to install | A blank instance |
| `stillhet-seed-insights.mjs URL` | Twelve tasks over three projects, two people, two workflows and a cost tag, with a budget | A blank instance, with its `WORCA_HOME` |

A seed's sandbox follows the same rules as A to D: its own HOME, never 4317. D is walked empty first and seeded after.

## 3. Place by mode

A place is walked only in a mode that offers it (lesson 28). This is the table as the code has it today
(`PLACES` in `ui/public/stillhet/shell/shell.js`, `RUN_PAGE_LEVELS` in the library's `levels.mjs`, each section's `min`
and `flag` in `settings/settings-model.js`):

| Place | Simple | Advanced | Expert |
|---|---|---|---|
| Chat; Pulse; the profile menu; the search | Offered | Offered | Offered |
| Tasks | Offered | Offered | Offered |
| A task's page | Offered; no Logs, graph, Sessions, Actions | Offered; no Agents, no log filters | Offered, whole |
| Schedules | Not offered (a schedule made in a chat still opens, with its chat) | Offered | Offered |
| Workflows | Offered | Offered | Offered |
| Marketplace | Not offered | Offered | Offered |
| Projects | Offered | Offered | Offered |
| Projects by workspace; a workspace's page | Not offered | Offered | Offered |
| Insights | Not offered | Offered | Offered |
| Insights: the team pages | Not offered | Not offered | Offered |
| Requirements | Later: one line, opens classic (and behind its Labs flag) | The same | The same |
| Settings: Tasks, General, Appearance, Notifications, Labs | Offered | Offered | Offered |
| Settings: Labels | Offered with its Labs flag | The same | The same |
| Settings: Presets, Chat, Memory, Guardrails, Plugins, Connectors | Not offered | Offered | Offered |
| Settings: Automations | Not offered | Offered with its Labs flag | The same |
| Settings: Team policy | Not offered | Read-only | Offered |
| Settings: Models | Not offered | Not offered | Offered |

**The rule.** A walk opens a place only in a mode that offers it. In the other modes it checks two things and nothing
else: the place's address shows one line that says where it is offered, with its one way on; and the search finds it
with its lock note. A walk **never switches mode mid-walk**: the mode is set when the instance starts
(`--ui-level`), a walk is run per mode, one after another, and a place is walked in the lowest mode that offers it
plus every mode that adds something to it (a read-only cell is walked as read-only: each edit is off and says why).

**One table in code.** Today the places are a literal in `shell.js` and the tabs' modes sit in Settings' model. Step B5
makes them one table, `ui/public/design-system/components/places.mjs`, exported by the library's `index.mjs`: a row per
place, tab and part with its lowest mode, its Labs flag, its read-only mode and its address. The navigation, the locks,
the search, Settings' menu and the gate's walk tool all read it; none keeps a copy. A test fails a place named in page
code that is not in the table.

## 4. The walk

**Which places.** Those the batch touched (from the files of its steps, by the file map), plus the **standing list**:
every row of a place file whose proof is a gate cell. A row that passed before and fails now fails the batch.

**The walk lists replace `test-protocol.md`.** `tools/stillhet-walk.mjs` (to build, B2) writes one list per area from
its rows in [wiring.md](wiring.md), their state in `spec/places/<area>.md` and the place table: for each control, the
modes to open it in, the request it must send and the API read that proves it. Nothing in the list is written by hand.

**Where and how wide.** Stillhet on B (real data) and D (empty, then seeded), at 1280 light and dark and 390 light,
and at 900 where the layout changes there. Classic on A and C at 1280 light, for the pages of section 5.

**Evidence.** A step of the walk records, in `out/stillhet-walk/<batch>/<area>.json` (ignored by git): the control;
the request it sent (method, path, body) from the network log; the API state read afterwards, with the field quoted;
the console errors and failed requests of the page. A screenshot may be added and is never the evidence (lessons 3, 30).
For a count, the API's number is quoted beside the screen's. A control that is disabled records the reason it shows.

**The three states of every read.** Empty (on D, before the seeds); long (on B, more than one page: the count equals
the API's); failed (the request blocked in the browser: the part says it could not load and offers Reload, in that part only).

**The checks.**

| Check | Proves | Command, or how | When | Reads | Today |
|---|---|---|---|---|---|
| Related tests | A run's own change | `node tools/test.mjs --related`, or named files | Inside a run, the only tests there | The working tree against the base | Exists |
| The full suite | G1 | `npm test`, once, with the machine-wide lock | Batch close | Everything | Exists |
| Contract test per live source | A source reads every page, empty and failed (lesson 20) | `test/stillhet-contract-<source>.test.mjs` | In `npm test` | `test/helpers/stillhet-server.mjs` | To build, per step |
| `stillhet-library-gate`, `stillhet-docs` | Pages call the library; rules, catalog, library and gallery agree (lesson 33) | `node --test test/stillhet-library-gate.test.mjs test/stillhet-docs.test.mjs` | In `npm test` | The code, `docs/stillhet/`, the catalog | Exists |
| `stillhet-no-demo` | No demo branch or answer in page code | `node tools/stillhet-no-demo.mjs` | In `npm test` | `ui/public/stillhet/` | Exists as a ratchet; at zero from B2 |
| Wiring | Every action has a row; every `wired` row names its proof (lesson 31) | `npm run stillhet:wiring` | In `npm test` | `wiring.md`, the place files | Exists; moved to the new files in B2 |
| Coverage of classic | Every classic control is offered, Later or dropped | `node tools/classic-inventory.mjs` (`--walk URL` on A, read-only) | In `npm test`; the walk when classic changes | `dev`, [gaps.md](gaps.md), the place files | Exists; its report becomes generated in B2 |
| Surfaces, `prototype-pr-check` | A change to classic's UI is known to Stillhet | `npm run stillhet:surfaces`; `node tools/prototype-pr-check.mjs --base origin/dev` | In `npm test`; CI | `spec/dev-surfaces.md` | Exists; moved in B2 |
| Output is not tracked | No file under `out/`, no built bundle in git (lesson 26) | `test/stillhet-out-untracked.test.mjs` | In `npm test` | `git ls-files` | To build, B2 |
| Instances isolated | Section 2's guarantees | `test/stillhet-gate-instances*.test.mjs` | In `npm test`; and every start refuses otherwise | The tool | Exists |
| Flag off | G2 (section 5) | `test/stillhet-flag-off.test.mjs`; `npm run stillhet:style-diff -- --dev SHA` | In `npm test`; the diff at batch close | The served page; dev's commit | Exists |
| The real-data walk | G3 | Browser agents walk the generated lists, one area each, at most four at once | Batch close | B, D, A, C | The method exists; the list tool is to build |
| Keyboard and touch | G4: Tab reaches every control, Escape returns focus, arrows change a choice; one pass with touch and no hover reaches every action | The same lists, keys only; `test/stillhet-keys-<area>.test.mjs` in `npm test` | Batch close | B, D | To build |
| Performance | G5: an idle page makes 0 mutations; a frame that changes nothing makes 0 draws; the longest real chat opens in under 2 s | `node tools/test.mjs test/stillhet-perf-budgets*.test.mjs`; one 10 s trace on B per touched place | In `npm test`; the trace at batch close | `test/fixtures/stillhet-perf-budgets/` | Exists as one file; per area from B2 |
| Sweeps | No sideways scroll, no clipped text without a tooltip, no overlap, nothing off the design system, colour and contrast | `npm run stillhet:sweeps`; `npm run stillhet:gates` against B | Batch close, as the first part of G6 | The prototype and the app | Exists |
| No control moves; corners | A control keeps its place when another's value changes (lesson 7); a radius is a token and never larger than its parent's (lesson 11) | New checks beside `colour-check` | With the sweeps | The app | To build |
| The pixel comparison | G6: the app draws what the prototype draws | `npm run stillhet:compare` | Batch close, **after G3 to G5 pass**; never inside a run | Demo against demo | Exists; demoted |
| The audit by looking | G6: a person's eye on each touched page | No command | After the comparison | B | Demoted to here; it no longer gives a score that stands for function |
| The personas' walk | The build is done (build-order, section 5) | Six agents, unprompted, on B and D | The last batch | B, D | The method exists |

What goes: `test-protocol.md` and its hand-kept item ids, the shared findings file, the fix plan's ledger rule, the
fidelity audit as a gate of its own, and comparison pictures kept in git.

## 5. Classic intact

With the flag off nothing of Stillhet is loaded, drawn or migrated (`gate.flag-off`). Every batch shows it four ways:

| Check | How | Passes when |
|---|---|---|
| The page bytes | `test/stillhet-flag-off.test.mjs` | The page served with the flag off is dev's golden page but for the flag's own key; an old `rail` flag in settings or `WORCA_FLAGS` is still read as `stillhet`; the raw shell file is never served |
| Nothing of Stillhet loads | The same test, and one request log on A | No request for `/stillhet/`; the page names Stillhet nowhere but in the flag's own rule; classic's `/style.css` gains no rule from a batch (lesson 32) |
| The styles | `npm run stillhet:style-diff -- --dev SHA`, on a quiet machine | 0 differences, but the one accepted Labs row. Under load the diff gives false differences: it is never run beside a suite |
| The classic walk | A and C, the pages the batch could touch: every page for a server step (routes are shared), a change to `ui/public/design-system/*.css` or a new Settings key; otherwise the pages that read a route the batch changed | Each control still sends what it sent on dev, and the state after it is the same |

Classic's own files are never edited by the build ([build-order.md](build-order.md), the file map).

## 6. Tests and time

- **Inside a run:** only `node tools/test.mjs --related` or named test files. Never `npm test`, a sweep, the comparison
  or a browser walk: a full suite takes about 30 minutes on a busy machine and reads as an idle run (lesson 29).
- **The full suite:** once per batch, at the batch close, on a quiet machine: no agent run open, no other suite. It
  takes the machine-wide lock (`tools/test.mjs`; a second suite waits and says so). At most four runs are ever open.
- **A base that is already red:** before the batch starts, the failing files of the integration branch are listed by
  file in `batches/batch-N.md`. The batch is clean when it adds no failing file and no new failing test in a listed one.
  A listed failure is a fix in a batch of its own, never a reason to wave the batch through.
- **The budgets** live in `test/fixtures/stillhet-perf-budgets/<area>.json`. A value only goes down; a measurement
  above it fails. Lowering is the area's step or the batch close, never a second step.
- **Checks that need a pull request's state** run in a quiet hour for the GitHub quota, on the stub `gh` where a seed has one.

## 7. What fails the gate at once

- A control with no request and no stated reason.
- Demo data, a "Would…" answer or a screen-only success on a live page.
- A count that disagrees with the list it opens, or with the API.
- A place reached in a mode that does not offer it, or a walk that switched mode.
- A tracked file under `out/`, or a built bundle in git.
- A test instance on the owner's HOME, store or port 4317, or one that can push.
- Any difference with the flag off.
- A tick with no test or gate cell behind it.

## 8. After the gate

The batch's record (`batches/batch-N.md`) goes to the owner: what was built, each cell with its evidence file, what
stayed open and why. The owner reviews wide and narrow and says yes or no. **Nothing is pushed or merged without that
yes**, and a run never merges itself.

## Lessons 25 to 33: what holds each

| Lesson | Held by |
|---|---|
| 25 Shared ledgers conflicted | build-order R2 to R4, the file map and the ledgers table: a place file per area, generated coverage, baselines lowered only at the batch close |
| 26 Generated output was tracked | `test/stillhet-out-untracked.test.mjs` (B2); evidence under `out/`; fails at once (section 7) |
| 27 Test copies not isolated | Section 2: own HOME, own clones, no tokens, no push, 4317 refused; `test/stillhet-gate-instances*.test.mjs`; S31 and S30 |
| 28 Gates walked modes without the place | Section 3: the one table (`places.mjs`, B5), the walk rule, the mode set at start |
| 29 Full suites inside runs | build-order R7 and R8; section 6 |
| 30 The look scored before the function | Section 1's order: G3 to G5 before G6; evidence is the request and the API state |
| 31 Ticks that did not hold | **Proven by** on every wiring row; the wiring check; the batch record; fails at once |
| 32 Stillhet's styles inside classic's | Section 5; the file map freezes `ui/public/design-system/*.css`; G2 after every step (R10) |
| 33 Rules and code drifted | `test/stillhet-docs.test.mjs`; the L lane changes rule, catalog, component, test and gallery in one run (R6) |
