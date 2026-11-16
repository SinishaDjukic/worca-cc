# Assessment: the feedback and the personas, each item answered

Two sources. **The feedback** is a real user's recorded walk of live Stillhet (Sinisha, 15 November). **The personas**
are six separate agents who each walked today's prototype by clicking, at 1280 and 390, light and dark, without seeing
each other's notes or any plan: the baseline round, before any redesign.

Each item is answered **Fixed** (in the prototype now), **Planned** (in the redesign, step 6, or in the build spec),
or **Declined** with the reason. At this checkpoint nothing is Fixed yet; the column is filled in again after the redesign.

## The baseline scores

| Persona | Score | In one line |
|---|---|---|
| New user (Simple) | 7 | The first ten minutes are very good; then asked to approve what cannot be seen, and insider words |
| Classic user (Expert, beside classic) | 6 | Almost every function is still there, but starting a task and opening a task both got longer |
| Daily power user (Expert) | 6 | Each action is one quick click; the state of all work is split over three lists, and a row throws you into Chat |
| Team lead | 6 | Own spend, limits and notifications are clear; the team's tasks and pull requests cannot be seen |
| UX/UI reviewer | 6 | Calm and consistent on cards; the quiet rules themselves hide what is clickable |
| Keyboard and accessibility | 5 | Names and dialogs are good; focus is dropped all over, and some choices cannot be made by keyboard |

What every persona praised, and the redesign keeps: the task card (a state word, a stage line, one action); the Tasks
board's sentence cards with their one action; the calm look and the state colours in both themes; Settings rows that say
their value in words; Insights; the New schedule dialog's behaviour (focus, Escape, full backdrop).

## The feedback (18 points)

| # | The user said | Seen again by | Answer |
|---|---|---|---|
| 1 | Text looks small; check Windows; add a text size setting | UX (12px carries most pages, buttons are 12px), keyboard (10 and 11px) | **Planned.** The scale moves up one step: body 14, meta 13, caption 12, nothing under 12; buttons 13px in a 32px box. Settings › Appearance › Text size (Small, Default, Large) scales the whole scale. Windows check: in the gate |
| 2 | The place name top-left looks clickable but only its tiny chevron opens the menu | UX, classic, keyboard (20x16 target) | **Planned.** The name and chevron are one button that opens the place list; its first item is the place's home; W alone goes home |
| 3 | Section heads in Settings do not stand out | UX (15px heads over 13px rows, same ink) | **Planned.** A section head leads: a larger role and more space above (mock: Settings after) |
| 4 | Buttons look like labels; you hunt for what is clickable. The biggest flaw | UX (top issue), team lead, classic, new user | **Planned.** Decided: every acting control is a button with a visible border at rest. The borderless grey style stays only for icon buttons |
| 5 | An opened Customise section has no container | UX, team lead | **Planned.** The opened part sits in a container on the row's line (a vertical line at its side), and the trigger keeps its place: the chevron turns, the word does not change |
| 6 | Clicking a row's title does nothing; actions hide behind a small ⋯ | UX, classic, power user | **Planned.** Decided: a row highlights on hover and a click opens its default action; ⋯ holds the full list, visible at rest on list pages, in a 28px target |
| 7 | A dialog's backdrop covers only the panel | UX, team lead, classic, new user | **Planned.** One Dialog: the backdrop covers the whole window, the page under it does not move |
| 8 | Models: things to fix; GitHub Copilot under Sign-ins opens an info dialog, not settings | Classic ("providers" unknown to search) | **Planned** in the spec: Settings › Models is built from classic's Models and Providers functions ([gaps.md](gaps.md)); a sign-in row opens its settings, and a provider not wired says so in words |
| 9 | Add-ons › Plugins › Telegram lands in Settings › Chat with no sign of why | (not walked) | **Planned.** A plugin opens its own page. A chat channel's settings are a section on that page; Settings › Chat links to it and never the other way round |
| 10 | A chat channel can be tested and switched but not edited | (not walked) | **Planned**, as server work: editing a channel has no API ([server.md](server.md)); the control is drawn disabled with its reason until then |
| 11 | Filters written as a sentence shift and wrap | UX, power user (34 to 83px per pick), classic | **Planned.** Decided: tabs or a Segmented with counts, plus labelled pickers of fixed width |
| 12 | The task card in chat is minimal and shows progress by stage: good | All | **Kept.** |
| 13 | The working icon is small and nervous; the old spinning gear was better | UX (a 13px ring pulsing every 1.6s; Pulse's icon shakes) | **Planned.** Running is one slow breath (about 4s) on a mark of at least 16px, and the state word is full ink. Pulse's shake is off by default. **Declined:** bringing back the spinning gear; a breath is the one activity sign in Stillhet, and a spinner would be a second one |
| 14 | Two voice icons could be one | Power user (the sliders icon reads as task options) | **Planned.** One Voice button; its menu holds the ways of talking |
| 15 | A proposed workflow's steps say nothing; no way to judge it; no Run; the project name on top is unclear | Power user (workflow hidden until the proposal; its list differs from Workflows) | **Planned.** A workflow proposal shows the workflow as its story (each stage in plain words, what comes out), offers Run once beside Save, and labels the project. The composer gets a Workflow picker |
| 16 | Saving a workflow then "Not now" gives an error | (live only) | **Planned** as server work: saving a proposal fails on "Not now" ([server.md](server.md)) |
| 17 | What are tasks, and how do they relate to chat? The task page looks half chat, half status; "not in the code" means nothing; buttons do not look like buttons; status ticks at the bottom are unexplained | UX (4 of 10 for the page), power user, classic | **Planned.** Decided: a task is the work, a chat is where you talk about it. The task page says "Started from the chat NAME · Open the chat" and has no chat box; the chat's card says "Task · started from this chat". The page's head is a stage train with names, clickable. "Not in the code" becomes plain words ("Documents, not code") |
| 18 | New schedule: all fields in one sentence; no labels; "Using the default…" is unclear | UX, classic, power user | **Planned.** Decided: labelled fields. "Default" always says what it is ("the Default workflow") |

## What the personas found beyond the feedback

Grouped by what fixes them. "DS" means a change in the design system that reaches every page.

| # | Finding | From | Answer |
|---|---|---|---|
| A1 | **Three counts for "needs you"** (the bar 5, Tasks 3, Pulse 8 or 10 at one moment) | Power, new, UX | **Planned.** One number, one rule: what needs you is counted once, in Pulse's terms, and each place shows its own part of that same list with a label that says so ("3 of 8, tasks") |
| A2 | **A row in Tasks or Schedules opens Chat and loses the list** (three clicks to a task's page; a finished task's chat not scrolled to its card) | Power, classic, UX | **Planned.** A row opens the thing's page; the bar keeps the place and its filters. This changes `nav.to-the-card` and `stillhet.stay-in-chat` (Decisions, 2) |
| A3 | **A thing's title behaves three ways** (opens the chat, opens the page, opens nothing) | UX | **Planned (DS).** One rule: a card or row opens its thing's page on click, everywhere |
| A4 | **No New task from every page** | Classic | **Planned.** A New task button in the top bar |
| A5 | **Asked to approve blind**: the card at "Needs approval" offers only Accept, with nothing to read; a second decision (findings to confirm) hides inside the stages | New | **Planned.** A card that asks shows what it asks about (the review's result, or the plan) and links to it; every open decision is on the folded card |
| A6 | **Tasks › Open on a Working card filters to the project**, then is dead | New | **Planned.** Open opens the task |
| A7 | **List rows say too little**: three "Changelog digest" rows look the same; facts only in a tooltip | Power | **Planned.** A row shows its project and state at list width |
| A8 | **Things move under the pointer**: an inline ⋯ menu pushes the card 150px; Stop asks at the top of the page; cards reorder after Approve; toasts cover the title | Power, UX | **Planned (DS).** A menu floats; a confirm opens at the control; a list reorders only when you leave or reload; a toast has its own corner |
| A9 | **Three text edges on one page; a different page edge per place** | UX | **Planned (DS).** One page frame for every place: one column, one text edge |
| A10 | **No whole or side-by-side diff** | Power | **Planned.** Decided: side by side, unified when narrow |
| A11 | **Narrow**: stage rows wrap one letter per line at 390; Insights drops four columns; the composer starts at another edge; Settings' drawer is empty | New, UX, team lead | **Planned.** |
| A12 | **Insider words where a new user decides** (Shaper, "with Default", Guardrails, Pulse, Stillhet, slice, run and task for one thing; explanations only in hover) | New | **Planned.** "Run" as a noun becomes "task" at the source ([lessons.md](lessons.md) 4). A starter says what it does in its own line. **Declined:** renaming Pulse, Shaper and Stillhet: they are product names; each gets one plain line where it is first met |
| A13 | **"Legacy approach"** reads oddly, and the form people know is filed under it | New, classic, power | **Planned**, if Emil agrees (Decisions, 3): the + menu offers New task… directly; "Legacy approach" goes |
| A14 | **The team lead cannot see the team**: Tasks lists only your own; no list of pull requests; a person's or model's number does not open | Team lead | Pull requests tab in Tasks: **Planned.** A row that cannot open is not drawn as clickable: **Planned.** The team's tasks: **Planned** as a "Whose" picker in Tasks, where the team shares its records; needs server work ([server.md](server.md)) |
| A15 | **Budget numbers do not add up** (four budgets; "71%" that matches none; two "Saved" figures) and resuming past a used-up budget is one click with no warning | Team lead | **Planned.** One mock per fact (`build.one-mock`); a figure names what it measures; Resume past a budget confirms with the amount |
| A16 | **Team policy**: no way to edit a guardrail rule or the allowed models; "blocked" that does not block | Team lead | **Planned** in [gaps.md](gaps.md) (Settings). The wording of "blocked" is classic's and is checked against it |
| A17 | **Sticky filters mislead** (a project filter set from one page stays on Tasks and Insights) | Team lead, new | **Planned.** A filter set by a link applies to that visit; the page says it is narrowed and offers Clear |
| A18 | **Keyboard: answer choices cannot be changed** (radio groups do not take arrows; the bar steals the arrow keys) | Keyboard (blocker) | **Planned (DS).** |
| A19 | **Keyboard: focus dropped to the page** after menus, pickers, switches and page changes; a menu is not next in Tab order after its trigger | Keyboard | **Planned (DS).** Menu, picker, Dialog and drawer own focus in, focus back and Tab order, in the library |
| A20 | **Focus you cannot see** (the top search, menu items, the composer, chart bars) | Keyboard | **Planned (DS).** One focus ring on everything that takes focus |
| A21 | **No skip link; 59 Tab stops before the composer; the bar's list has no role** | Keyboard | **Planned.** Skip to content; a row's fold and ⋯ leave the Tab order (reached from the row); the list gets its role |
| A22 | **Screen reader gaps**: stage states hidden; chart bars inside a hidden plot; search not a combobox; five identical "Run now"; two h1 at 390 | Keyboard | **Planned (DS).** |
| A23 | **Contrast and targets**: placeholder 2.6:1; targets under 24px in the bar at 390 | Keyboard, UX | **Planned (DS).** |
| A24 | **Place menu at 390 and in Simple**: the prototype starts in Simple with 5 places; menus do not say what a mode hides | Classic, team lead | **Planned.** The mode menu says what each mode adds. **Declined:** starting in Expert; Simple is the right start for a new user, and an existing user's mode is kept |
| A25 | **A workflow's graph is clipped; the editor is behind "Edit a copy by hand"** | Power, classic, UX | **Planned.** |
| A26 | **Schedules**: stale "next" dates; after saving a new schedule you stay on another one | New, power | **Planned.** |
| A27 | **Smaller wording and consistency slips** (Retry and Restart Build for one action; "all projects" and "every project"; ✗ for failed checks; green rings on done steps) | UX, power | **Planned.** |
| A28 | **Search**: "providers" and "import models" find nothing; "budget" misses Insights › Budget; results not reachable by arrows | Classic, team lead, keyboard | **Planned.** |

Two reports disagree on one fact: the power user opened the shortcuts sheet with `?`; the keyboard user got nothing.
To be checked in the redesign, not assumed either way.

## Still open from the first build's ledgers

Design issues the first build recorded and left open. All **Planned**, in the place named; the full list with sources is in git history.

| Place | Open |
|---|---|
| Chat | No pair in the prototype for metrics, policy, route and unknown cards; a done card's ⋯ lacks Start a follow-up, Report and Archive, and differs from the page's ⋯ |
| Tasks | Whether a workflow's Open lists fix rounds; the tone of Ready inside Needs you |
| Task page | A long branch cut with no way to read it whole; no cost estimate on buttons that start paid work; a `.json` or `.patch` opens as plain text |
| Schedules | A one-off has a time and no date; the page shows neither prompt nor workflow |
| Workflows | The canvas at 390; empty For you and Your team's say nothing |
| Insights | Six pages have no data behind them (Why it cost, Review, Autonomy, Cache, Start to merge, Waiting on you): each gets its measure, or goes (Decisions, 5) |
| Settings | No Appearance section; unlabelled theme and background swatches |
| Shell | A toast over an open confirm strip; one table of place by mode for navigation, locks and gates |

## Decisions for Emil

Real calls where I chose a direction and want a yes or a change before the redesign builds on them.

| # | The call | What I chose | Why | If no |
|---|---|---|---|---|
| 1 | The name "rail" | The design system, its namespace and the flag are Stillhet. The noun "rail" stays for the 20px line rows sit on (`one rail`, `lr-rail`), and classic keeps its own rails (the side rail, the deck rail) | It is a plain word for a real thing on screen, and renaming it would change classic's files | Say the word you want for the line ("line"?) and I rename it in Stillhet's files |
| 2 | Where a row leads | A task, schedule or project row opens its own page, in every mode; the bar keeps the place. Chat stays the place to talk, and the page links to its chat | The agreed rule "everything leads to its card in its chat" is what four personas and the user tripped on, and it contradicts "a task is the work, a chat is where you talk about it" | Rows keep opening the chat's card outside Expert; I fix only the scroll and the count |
| 3 | "Legacy approach" | The words go. + offers New task… (the form) and Ask in chat, as equals | Three personas read "legacy" as "about to be removed"; the form is what classic users know | Keep the heading; I only put the form one click nearer |
| 4 | Text size | Body 14, meta 13, caption 12, buttons 13 in 32px, as the default; a Text size setting on top | The user and two personas found 12 to 13px small; a setting alone leaves the default small | Keep today's scale and add only the setting |
| 5 | Insights pages with no data (six) | Out of the prototype until a measure exists; listed in [server.md](server.md) as measures to add | A drawn page with no data is the "demo data on live pages" lesson | Keep them drawn, marked "Not in Stillhet yet" |
| 6 | Design, Requirements, Profile, the level | Design and Requirements: later, and Stillhet opens classic's page until then. Profile page and the level ("Curious → Runner"): dropped | Design and Requirements are beta or Labs in classic; the profile menu covers the page; nothing depends on the level | Name the ones that are must-have and I draw them in step 6 |
| 7 | This branch and dev | The branch stays on its own base (130 commits ahead of where dev was before the revert). Classic is read from `dev`; classic's files here are not touched | Rebasing onto dev's revert would delete the live code the build is meant to reuse | I rebase after the spec is done, and the spec names what to bring back |
| 8 | The spinning gear | Not brought back; the running sign becomes larger and slower instead | One activity sign in the whole product | I add a spinner as the busy sign and say where |
