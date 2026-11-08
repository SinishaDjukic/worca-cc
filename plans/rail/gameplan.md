# Rail: the gameplan

Emil, 8 Nov. One order, from where we are to Rail in the product. `wave-3.md` keeps the history; this says what is next.

## The points this plan holds to

1. **Read after 5 seconds.** A card that needs you, focused, is marked as read after 5 seconds (not 3).
2. **Alerts breathe like questions.** A `!` (failed, a problem) follows the same logic as a `?`: the whole row or card breathes
   in its own colour, not only its round mark.
3. **Chat is the only place to type to Worca.** No composer on any other page.
4. **Manual creation elsewhere is the "legacy approach".** Every other page may keep it, under exactly that wording.
5. **Stay in the chat.** Unless you are in Expert, or a mode that turns a feature on, you stay in the context of the chat,
   represented by the card: links lead to the card, not to a page.
6. **Pages outside Chat are centers.** Mostly what you land on: a center for that thing, with the same or similar sidebar
   logic, adapted to the case.
7. **The bar is 8.0.** Every screen is challenged by the UX/UI reviewer, the new user and the daily user, same rule for
   all. Anything under 8.0 from any of them is revised, then challenged again.

## How every step runs

Mock, or build, then the three reviewers, then fix, until all three give 8.0 or more; only then does Emil see it. After three
rounds still under 8.0, it goes to Emil with the reason. A persona's wish never overrides points 1 to 6. Every rule goes into
`docs/rail/`, the library, the catalog, a test and the gallery. Each step ends with the gates, a commit and push on
`docs/rail-shaping`, and a rebuilt prototype. The full suite runs before each commit that changes the library.

## The order

| # | Step | What changes | Done when |
|---|---|---|---|
| 0 | **Finish what is in flight** | Insights with playable charts; one sidebar model; the Projects tree; default labels and tags | Built, gates green, committed, prototype sent |
| 1 | **Attention and marks** (points 1, 2) | 5 seconds, Settings' Breathing list follows; alerts breathe whole in their colour, rows and cards; smaller stage icons everywhere (Emil, 8 Nov: a card's stages, the task page, Workflows), one size in the library; a click on the empty area of the stages folds them and on the stage line opens them, never when the click is on a control, a link, a row's own action or selected text (Emil, 8 Nov), with keyboard still on Show its stages | Seen on every bar and card, in light and dark |
| 2 | **One input** (point 3) | Composers leave Projects, Workspaces, Workflows, Insights and the rest; Change it in a chat opens Chat, with its words and scope | No composer outside Chat; a gate test holds it |
| 3 | **Legacy approach** (point 4) | "By hand" becomes "Legacy approach" everywhere: the + menus, Edit, Add; rule and wording test | The old words are gone |
| 4 | **Stay in the chat** (point 5) | By mode: links, search, Pulse and bars lead to the card in its chat; full pages only in Expert or the mode that turns them on | Walked in each mode; the sweep holds it |
| 5 | **Centers** (point 6) | One center model in the library, then each place: Tasks, Schedules, Workflows, Projects, Marketplace, Insights, Requirements; each with its sidebar adapted | Each place 8.0 from all three |
| 6 | **Full challenge** (point 7) | Every screen, every mode, three reviewers; a scorecard in this file; under 8.0 revised | Every line on the scorecard 8.0 or more |
| 7 | **The rest of the prototype** | Schedules' Activity; Pinpoint; Settings' leftovers; Actions; the script editor, with drafts; Requirements' audit; edges | Each through the loop to 8.0 |
| 8 | **Known gaps** | Task card and page menus alike; Saved in Pulse and Insights; Pulse's Scheduled count; Tasks' Round line; Marketplace's Install check; Projects' drag, picker search and Sync preview | The list is empty |
| 9 | **Onboarding, redesigned completely** | The last design step: from first open to a first finished task, built on what Rail has become; mock first, then the loop | 8.0 from the new user and the UX/UI reviewer |
| 10 | **Boss round: independent validation** | Three fresh reviewers (new user, existing user, UX/UI) on each of 14 areas at the same time: Chat, the task card and page, Tasks, Schedules, Workflows and the canvas, Requirements, Marketplace, Projects and Workspaces, Insights, Settings, Pulse, the sidebars, colours, icons and themes (do they fit and match across light, dark and each background; can they be calmer), the whole experience end to end. 42 agents a round, none sharing a session or seeing another's result or any earlier score; each drives the real prototype. Findings merged and fixed, then a second full round and fixes | After two rounds with fixes: average 7.5 or more per area, no reviewer under 7.0 on any area, no critical finding open |
| 11 | **Final validation** | Final audit against Rail; the design system and the prototype agree; all gates and the full suite; retire what is left of the old prototype; the Shaping page matches | Emil's yes on the whole |
| 12 | **Into the product** | Agreed into dev by PR, on Emil's yes; then the real build, wave by wave behind the rail flag: dev's graph in Rail's skin, the storyboard by Haiku, the workspace suggestion, default labels and tags, drafts and fold motion in the app and its data | Emil's yes at each PR; never pushed or merged without it |

## Scorecard

Filled at step 6. A number is the lowest of the three reviewers. The scores so far are from earlier rounds, before their fixes.

| Screen | New user | Daily user | UX/UI |
|---|---|---|---|
| Workflows browse, page, canvas | 7, 5, 4 | 6, 7, 5 | not yet |
| Projects home, project, workspace | 6, 5, 6 | 6, n/a, 6 | not yet |
| Insights Spend, Why, Tag, Review | 7, 8, 7, 4 | 7, 8, 7, 5 | not yet |
| Every other place | not yet | not yet | not yet |

## Decided: ⌘J

**Ask Worca beside a page** goes: a second place to type breaks point 3. Its use stays: ⌘J (and the top bar's Ask) takes you to
Chat, with the page you were on attached as a chip you can remove and its questions offered; Back returns you. Done in step 2.
