# Gaps: what the prototype lacks compared with classic

Classic is the code on `dev`. Sources: the inventory of classic's controls (`plans/stillhet/coverage/COVERAGE.md`: 1,869
controls, 953 offered in Stillhet, 444 in places not built yet, 472 with no home), and a classic user's side-by-side
walk of classic and the prototype (baseline round, [assessment.md](assessment.md)).

Each row is a function people need, not a control. **Must** means the full build is not done without it. **Later** means
it is designed and built after the first full build, and until then Stillhet says where to do it in classic. **Drop**
means Stillhet does not offer it, by a decision, with the reason. A row marked **(E)** is a call I made that Emil should
confirm ([assessment.md](assessment.md), Decisions).

## The shell

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Start a task from any page | A New run button in the top bar on every page | Only from Chat, or Tasks › + › Legacy approach › New task… | **Must**: a New task button in the top bar, on every page |
| See the places and go to one | A sidebar that lists every place, with counts on Runs and Schedules | A small chevron beside the place's name opens the list; no counts | **Must**: the place's name and chevron are one button that opens the list, each place with its count |
| What is scheduled next | Activity › Scheduled, with a Schedule… shortcut | Pulse › Now lists Scheduled; no shortcut | **Must** (in Pulse): keep, add New schedule |
| Know it is a mock or test instance | A MOCK badge | Nothing | **Must**: one quiet word in the top bar |
| Your level and the team-setup notice | "Curious → Runner", "the team updated the recommended setup · Review" | The Review row is in the profile menu; no level | Level: **Drop (E)** (a game layer; nothing depends on it). Team-setup notice: **Must** |
| Getting started with a step count | A checklist with "2 of 5 done" | A chat that walks you through, no count | **Must**: the count on the Getting started row |
| Browser push sign-up; sign in again when the session ends | Yes | The session case is drawn; no push sign-up | **Must** |
| The Design page (web page, deck, video, document builds) | A whole page, beta | Nothing | **Later (E)**: Stillhet says "Not in Stillhet yet" and opens classic's page |
| The Profile page | A page | The profile menu holds what matters | **Drop (E)**: the menu and Settings cover it |
| Text size | Nothing | Nothing | **Must** (new, from user feedback): Settings › Appearance › Text size |

## Chat

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Pick the workflow before sending | Workflow thumbnails under the composer; a workflow picker | The workflow appears only in the proposal after Send | **Must**: a Workflow picker in the composer |
| See a proposal's attached files | On the card | Only inside Customise | **Must** |
| Switch a chat's engine; attach a file | Yes | The model picker is there; no attachment | **Must** |
| Plans under the composer | A Plans tab | Nothing | **Must**: plans are reached from the task (Decisions › The plan) and from search; no tab |
| A reply landed in another chat | An unread mark | Nothing | **Must** |
| Propose a fix task from a failed one; Resume on / Switch model from a task link | Yes | Retry and Restart Build only | **Must** |
| Send a direction straight to a running task | Yes | Nothing | **Drop**: a task does not change while it runs; steering is a message in its chat (`nav.task-like-chat`) |
| Pinpoint: select text, then Explain, Alternatives, Discuss, Use this | Yes | Nothing | **Later** |
| Voice: speak and hands-free | Clear icons per way of talking | Two icons, voice and hands-free | **Must**: one Voice button whose menu holds the ways |
| Engine status and Send test message for a chat channel; edit a channel | Test and enable; no edit | Test and enable; no edit | **Must** (edit is server work, [server.md](server.md)) |

## New task

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| A form with a label over each field | Yes | One sentence whose bold words are menus | **Must**: labelled fields (Project, Workflow, Engine and model, Source branch, Base branch) |
| Presets: apply, check, duplicate, update, manage; saved defaults; a workflow's defaults | Yes | Apply, Update, Duplicate | **Must** |
| A ticket as the source, with Test connection and a profile | Yes | Drawn for the demo only | **Must** |
| Sync before start; engine check; team policy notes | Yes | Drawn for the demo only | **Must** |
| Guardrails | A picker | Listed twice in More options | **Must**: once |
| Run on the source branch; create a draft PR; one PR or a PR per slice (Shaper) | Yes | Not in the dialog | **Must** |
| Human in the loop; "Worca may answer for me" before start | Yes | Only after start, in the task's menu | **Must** |
| Run without memory | Yes | Nothing | **Must** |
| Mock mode | A switch | Nothing | **Must** on a mock instance only, as a quiet row |

## Tasks and a task's page

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Open a task from the list and keep the list | The list and the run side by side | A click moves to Chat and shows a card; the page is two more clicks | **Must**: a row opens the task's page; the bar keeps Tasks and its filters |
| Filter, sort and group with named controls | A View menu: filter, sort, group | A sentence | **Must**: tabs with counts plus labelled pickers. Group by Topic and None come back |
| Rows that say what they are | Project, state, time, PR on the row | A title and one mark; the rest in a tooltip | **Must**: project and state on the row at list width |
| A live view of what runs now | A Live switch | Nothing | **Must** as the Running tab |
| The diff, whole and side by side | Yes | "Would open…" | **Must** |
| Labels on a task and in bulk; labels admin (rename, delete) | Yes | Labels on a task | Labels: **Must**. Admin: **Later** |
| PR: remotes, cross-link, mergeable, auto setting, link a remote on a finished task | Yes | Create, Merge, Fix checks | **Must** |
| A moved base: resolve in a terminal or with a pipeline | Yes | Nothing | **Must** |
| Restore an archived task; report a task | Yes | Archive and Restore; no Report | Restore: **Must**. Report: **Later** |
| Away decisions; guardrail details; dismiss a team memory note; open in editor, terminal, files | Yes | Decisions says who decided | Away decisions and the launchers: **Must**. The rest: **Later** |
| A workspace task: comments, diff and log per member | Yes | The group page | **Must** |
| A list of pull requests that need someone | The Runs list shows PR state per row | Nothing | **Must** (also asked by the team lead): a Pull requests tab in Tasks |

## Schedules

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| A form with labelled fields | Yes | A sentence | **Must** |
| A one-off schedule, with a date | Once and Repeating tabs | Repeating only; a one-off has a time and no date | **Must**: Repeats: Once, with a date |
| Change a schedule's time or instruction afterwards | Edit | From its page in Advanced; nothing in Simple | **Must** |
| See its prompt and workflow | On the row | Not shown | **Must** |
| Its activity and problems | An Activity feed with Mark all read and a Problems filter | Pulse › Updates | **Drop** the separate feed: Pulse holds it, filtered to the schedule from its page |

## Workflows

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Edit a workflow in the graph editor | Opens in the editor | Only behind "Edit a copy by hand" | **Must**: Edit on the workflow's page, a draft until saved |
| Filter by category (built-in, coding, shared) | Chips | For you, Your team's, Marketplace | **Must**: tabs with counts |
| Write agents and scripts: new, duplicate, source, generate an agent, runtimes, the test bench | Yes | Nothing | **Later** |
| Export to a marketplace; import Claude Code skills | Yes | Export as a plugin | **Later** |

## Marketplace

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Search plugins on the page; hide installed | A field and a switch | The top bar's search only | Search: **Drop** (one search, `set.search`); it must find plugins by name. Hide installed: **Must**, as the Installed and Not installed tabs |
| Manage an installed plugin: all its settings, Test connection, health, enable, purge | Yes | Set it up | **Must** |

## Projects

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| A project's parts as tabs | Tabs: Settings, Memory, Sets, Actions, Automations, Readiness, Team | One long page; Memory, Sets and Actions are missing | **Must**: tabs on the project's page |
| Memory: the files, New file, Defragment, History | Yes | Only which notes are read | **Must** |
| Sets (guardrails, MCP) per project; approve a project's `.mcp.json` | Yes | Nothing | **Must** |
| Actions: add, edit, open the editor, terminal and files; a project terminal | Yes | Nothing | **Must** |
| Automations: add a rule, turn off, delete, check now | Yes | Nothing | **Must** |
| Readiness: Recheck, Ignore, tool choice | Yes | A summary line | **Must** |
| Per-project step and helper models, chat turn limit, context size, skill delivery | Yes | Nothing | **Must**, under the project's Settings tab |
| Link a remote, copy the path, open a terminal | Yes | Link a repository… | **Must** |
| Add a project: one folder, a new folder, several folders, the folder browser, clone | Yes | One folder and clone; the rest drawn | **Must** |
| A workspace's settings; what removing a member does | Yes | Edit by hand | **Later** |

## Insights

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Statistics and Team metrics | Two pages | One place with more views | Covered |
| Team metrics: Timeline, discover repositories, Check now, Push now | Yes | Not seen | **Later** |
| Open a number to the tasks behind it, by person or model | Not in classic either | Rows look clickable and do nothing | **Must**: a row that cannot open is not drawn as one |

## Requirements

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| The whole page: brief, helper chat, assumptions, answers, attachments, import and export, start, finish, revert; the Shaper answerer (Fix all, Ask for changes, Agree and plan) | A Labs feature | Behind its Labs switch, mostly not drawn | **Later (E)**: it is a Labs feature in classic too; until designed, Stillhet opens classic's page |

## Settings

| Function | Classic has | The prototype | Mark |
|---|---|---|---|
| Models and providers: sign-ins (GitHub Copilot and the rest), OpenAI-compatible lists and import, credentials, picture and voice keys, Share as plugin | Models and Providers pages | Models › Sign-ins; search does not know "providers"; picture and voice keys missing | **Must** |
| The helper models (title, naming, PR text, command summary, second opinion and more), the Chat engine | Yes | Roles, partly | **Must** |
| Connectors: MCP sets, validate a server, run preview, team members | Yes | A list | **Must** |
| Team policy and guardrails: edit a rule, which models the team may use | Yes | Read-only in places | **Must** |
| The setup assistant: detect, apply, share the team setup | Yes | Run setup | **Must** |
| Version and updates: check now, channel, choose a version | Yes | A version line | **Must** |
| Smart naming: suggest on rename, the branch pattern | Yes | Nothing | **Later** |
| Ticket sources: test a connection, profiles | Yes | In New task only | **Must** |
| Task limits: archive after, longest wait, tasks at once | Yes | Limits | **Must** |

## Counts, to track the build

| | Controls |
|---|---|
| Offered in Stillhet today | 953 |
| In a place not built yet (most of Settings, Models, Connectors, Team policy, Requirements, Design, Onboarding) | 444 |
| No home yet | 472 |

`tools/classic-inventory.mjs` regenerates the inventory. For the build it is run against `dev`, and its report is
generated, never edited ([gate.md](gate.md)).
