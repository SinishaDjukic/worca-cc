# Navigation: one model

| Rule | What | Why | Held by |
|---|---|---|---|
| `nav.depths` | Place, thing, part, fact, in that order | One model of where you are | by hand |
| `nav.center-home` | In the bar head a center's title word goes to that center's home and clears the selected row; the ▾ beside it is the quick menu, W is home and the features menu: separate controls. A page opened inside a center has one Trail at its top (Projects › billing-api), its first crumb the center's home (PlaceHead `center`) | One obvious way to the center's start | design-system-components |
| `nav.one-back` | The trail is the one way back on screen | No second Back beside it | worca-sweep |
| `nav.full-page` | A thing opens as a full page, never a pane beside its list | The run page needs its width | worca-sweep |
| `nav.address` | The address holds place, thing, part and fact | Links and the browser's back just work | worca-sweep |
| `nav.land` | A fact comes into view, lights once and takes focus | You see where you landed | design-system-components |
| `nav.strip-inert` | While the bar is the strip, what it hides is out of the tab order (inert); the pointer on it, or a menu open in it, brings it back | Tab never walks what cannot be seen | by hand |
| `nav.quick` | The ▾ beside a bar's name opens a small menu of the places your mode shows; picking one goes there, and it stays inside the bar. The W beside it only goes home | Home is one click, and any place two | design-system-components |
| `nav.labs` | A Labs feature sits where it will live for good, in its own group, never in a Labs section, with one quiet word Labs at the end of its row while it is experimental; it appears when its switch is on and the word goes when it graduates. Settings › Labs is the only place to turn it on or off (Stillhet alone also has `nav.design-switch`) | It does not move when it graduates, and you can see it is still being shaped | design-system-components |
| `nav.design-switch` | While Stillhet is opt-in, the top bar carries one small switch on the right of Pulse (right of Activity in today's app, before New run), labelled Stillhet UI with a small beta chip; at phone width only the switch stays. Grey only. It shows with the flag off too, is the same setting as Settings › Labs, acts at once, and when the flag is locked it is disabled and says why | Trying it and going back are one click, so people dare to try it | by hand |
| `nav.locked` | What the mode or Labs hides is never a dead end: the search finds it with its lock note, a deep link or a picked result reaches the place's one line and its one way on; a Labs hand-off keeps a way back under the top bar until the switch is on. One truth per place: the bar's own data decides the menu, the quick nav, the search's note and the lock; a locked place shows no list of its own beside its line; a page inside a place that needs more than the place (a place's `needs`) gets the same line, never another page | Nothing is lost by being in Simple | worca-sweep |
| `nav.not-found` | An address that names nothing here (a removed thing, a mistyped id) says so with NotFound and one way on; it never shows something else | A silent fallback reads as the thing you asked for | design-system-components |
| `nav.one-bar` | One bar for every feature: the house, what it shows, its list, you. Worca's W opens the full features menu (Recent, then the places under Work, Build, Manage, Insight, each by mode, and Settings) from anywhere, with Chat's home behind it, its list reset to the default sentence and selecting ended; picking Chat or any place returns the bar to that place's own list; the ▾ is only the quick navigation and never replaces this menu (nav.quick); the ▾ beside the bar's name is the quick navigation (nav.quick); a locked place with no list of its own shows Recent and the places under Settings-like group heads (Work, Build, Manage, Insight), each shown by its mode; a group keeps its head while it shows any place (Work over Chat alone in Simple); Chat's + starts a chat, and a place that makes things has its + (from Advanced up Tasks and Schedules have theirs, Ask in chat then Legacy approach; in Simple they have none: rail.chat-first); hidden (⌘\\, or dragged past its 264px floor), the bar is a strip: the W, one icon per kind of work (Chats, Tasks, Schedules) with how many are open, and you; it opens over the page under a pointer resting there for 150ms (one passing along the edge does not open it; a keyboard focus opens it at once), and stays open while a menu in it is open; over one of its icons it stays a strip, so the icon can be clicked; while it is hidden the top bar holds Show the bar; the button at its head says what a click does: Hide the bar while it is kept open, Keep the bar open while it is opened by the pointer, and a bar just hidden stays a strip until the pointer has left it; inside a feature, everything is about that feature. It starts at 280px and is dragged between 264 and 420px, and kept | Settings' behaviour, everywhere | worca-sweep |
| `nav.to-the-card` | Everything leads to its card in its chat: a row in the bar's tree, a Tasks row, an In view tab, a search result, Pulse, a schedule's runs, a task named in a message; the chat opens, scrolls to the card and flashes it once. A task or schedule with no chat gets one, named after it, holding its card. The task page stays only until the card holds everything it does (its ⋯: Open its page) | Tasks as a place go away; nothing teaches people to need it | worca-sweep |
| `nav.in-view` | Keep in view, from any chat's, task's or schedule's ⋯ or the eye on a task's head, puts it in the top bar on every page, and only there, like a browser's tab: its mark and its name cut short, five at most (marks only below 1100px; one on a phone); every icon in that area, In view's marks, Ask worca and Pulse, is one size, 20px, then +N opens a menu of the rest. A mark holds still and only says where its thing stands: no pulse, no breathing. Hovered or focused, a card says what it is and where it stands, with × to take it out of view; a click opens it. The tab whose page is open has a thin ink line along its foot, grown from the centre; a pressed tab dips. It is not a PR's Watch, which fixes checks | You keep an eye on a run without a tab to manage, in one place | worca-sweep |
| `nav.task-like-chat` | A task or a schedule opens like a conversation: a reading column, a timeline, a composer whose question goes to its chat, or starts one and links it | A task never changes while it runs; steering belongs to Chat | by hand |

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
