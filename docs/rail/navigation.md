# Navigation: one model

| Rule | What | Why | Held by |
|---|---|---|---|
| `nav.depths` | Place, thing, part, fact, in that order | One model of where you are | by hand |
| `nav.one-back` | The trail is the one way back on screen | No second Back beside it | worca-sweep |
| `nav.full-page` | A thing opens as a full page, never a pane beside its list | The run page needs its width | worca-sweep |
| `nav.address` | The address holds place, thing, part and fact | Links and the browser's back just work | worca-sweep |
| `nav.land` | A fact comes into view, lights once and takes focus | You see where you landed | design-system-components |
| `nav.locked` | What the mode or Labs hides is never a dead end: the search finds it with its lock note, a deep link gets one line and its one way on | Nothing is lost by being in Simple | worca-sweep |

How you move through Worca, the same everywhere. Mocks: `plans/rail/mocks/nav-*.png`.

**Four depths, always in this order.** A **place** (Chat, Runs, Schedules, Statistics…: the sidebar) holds **things** (a
run, a group, a schedule, a chat: its list's rows); a thing has **parts** (its tabs: Overview, Changes, Activity, Decisions); a
part holds **facts** (a file, a decision, a question, a setting). Everything else lays over a page without changing
where you are: a panel (Pulse, the profile menu), a side column (Ask worca), a Dialog, the ConfirmStrip.

**Five ways to move, each with one job.**
| Way | Goes | Component |
|---|---|---|
| The sidebar | to a place | the sidebar; Settings, not a place but with its own sections, turns it into its SideMenu |
| A row | to a thing, as a full page: a thing takes the page, never a pane beside its list (the run page needs its width) | ListRow |
| The trail | one depth up: a thing to its place, a run to its group | Trail, in the top bar |
| The pager | sideways, to a sibling: the next run in a group | Pager, at the top bar's right |
| A link, a search result, a Pulse row, a notification | straight to a fact, in any place | Text link, Search, ListRow; `land()` |

**One way back on screen.** The trail is it: never a second `‹ Back to …` beside it. Where you came from is the
browser's back, which always works, after a jump too (a Pulse row from Settings: the trail goes up to Runs, the
browser's back returns to Settings). On a narrow screen the trail is its parent alone, `‹ Parent`.

**Where you land.** A thing opens on its state (the status line), never scrolled; a part opens at its top; a fact
comes into view, lights once over `flash` and takes the focus (`land()`). Coming back to a place restores what you
left there: its scroll, the list's sentence, the selection.

**The address is the page.** The place, the thing, its part and the fact are in the URL (`#runs/r-412/changes/file:3`),
so a link, a notification or a bookmark lands exactly there, and the browser's back walks the same steps.

**The words.** A link names where it goes (`Open Models`, `Runs`, `‹ worca-cc`), never `Click here` or a bare `More`;
a link that leaves Worca says so (`View PR ↗`). A page changes at once (Motion: no page transition).

**Above your mode, or behind Labs.** The sidebar shows what your mode and Labs show. The search still finds the rest, each
with its note (`Switch to Advanced`, `Turn on Labs`); a pick hands you over: a mode asks in the ConfirmStrip under the top
bar, a flag goes to its row in Settings › Labs, and once nothing locks it you land on the result. A deep link gets
EmptyState's one line and its one way on (`Schedules needs Advanced` · Switch to Advanced), never a banner.
