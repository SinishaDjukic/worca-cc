# Navigation: one model

| Rule | What | Why | Held by |
|---|---|---|---|
| `nav.depths` | Place, thing, part, fact, in that order; a panel, a side column, a Dialog and the ConfirmStrip lie over a page without changing where you are | One model of where you are | by hand |
| `nav.frame` | The sidebar and the top bar are drawn from the library's frame parts (`shell-frame.mjs`: BrandRow, NavSection, BarGrip, SidebarFrame, SideToggle, MenuButton, TopBarFrame, BarPlaceHead, PlaceButton, SkipLink), never from a copy of classic's markup | A page names the slots it fills; the ids and classes the stylesheets address are defined once | design-system-shell-frame |
| `nav.one-bar` | One bar for every feature: its head (`list.bar-head`), what the place shows, its list, you. Inside a place everything in the bar is about that place | Learn one bar, know them all | worca-sweep |
| `nav.place-button` | In the bar head the place's name and its chevron are one bordered 32px button that opens the places: the place's own home first, then each place your mode offers with its count, the current one checked (from classic's sidebar, where a place's whole name is the control) | One control, one result: the name that looks clickable is, and any place is two clicks away | design-system-shell-redesign |
| `nav.home` | The W alone goes home: the bar lists every place (Recent, then the places under Work, Build, Manage, Insight, each by mode, and Settings) with Chat's home behind it; there the name is plain text, and a group keeps its head while it shows any place | One way to everything, from anywhere | design-system-shell-redesign |
| `nav.bar-width` | The bar starts at 280px and is dragged between 264 and 420px, and kept; a double-click returns it to 280 | The bar fits your titles, once | worca-sweep |
| `nav.bar-strip` | Hidden (⌘\\, or dragged past its floor) the bar is a strip: the W, one icon per kind of work (Chats, Tasks, Schedules) with how many are open, and you. It opens over the page under a pointer resting there for 150ms or a keyboard focus, and stays open while a menu in it is open | The page gets its width, and the bar is a rest of the pointer away | worca-sweep |
| `nav.bar-toggle` | The button at the bar's head says what a click does (Hide the bar, or Keep the bar open while the pointer opened it); while the bar is hidden the top bar holds Show the bar | A toggle never has to be tried to be understood | worca-sweep |
| `nav.strip-inert` | While the bar is the strip, what it hides is out of the tab order (inert); the pointer on it, or a menu open in it, brings it back | Tab never walks what cannot be seen | by hand |
| `nav.center-home` | A page opened inside a place has one Trail at its top (Projects › billing-api), its first crumb the place's home (PlaceHead `center`) | You see where the page sits and go up in one click | design-system-components |
| `nav.one-back` | The trail is the one way back on screen; where you came from is the browser's back. On a narrow screen the trail is its parent alone | No second Back beside it | worca-sweep |
| `nav.full-page` | A thing opens as a full page, never a pane beside its list | The task page needs its width | worca-sweep |
| `nav.address` | The address holds place, thing, part and fact (`#run/r-412/changes/file:3`), and follows the view | Links, bookmarks and the browser's back just work | worca-sweep |
| `nav.land` | A thing opens on its state, never scrolled; a part opens at its top; a fact comes into view, lights once and takes focus (`land()`) | You see where you landed | design-system-components |
| `nav.to-the-thing` | A way in leads to the thing itself: a row, a Tasks or Schedules card, an In view tab, a search result, a Pulse row and a task named in a message open the thing's own page (`stillhet.work-and-talk`). Opening a chat from its task scrolls to the task's card and lights it once | One target for every way in | worca-sweep |
| `nav.thing-is-not-chat` | No page but Chat has a composer: a thing's page is a reading column whose head offers Ask about it in chat (a task's: `thing.from-chat`), and a task never changes while it runs | Steering belongs to Chat, and a page that is half chat is neither | by hand |
| `nav.top-bar` | The top bar holds the search, In view, Ask worca, Pulse and the Stillhet icon, and nothing that starts work: no New task button | Work starts in Chat (`stillhet.chat-first`), and the bar's icons stay where they are | by hand |
| `nav.in-view` | Keep in view, from a chat's, task's or schedule's ⋯ or the eye on a task's head, puts it in the top bar on every page, like a browser's tab: its mark and its name cut short, five at most, then +N (marks only below 1100px; one on a phone) | You keep an eye on a task without a tab to manage, in one place | worca-sweep |
| `nav.in-view-still` | An In view mark holds still and only says where its thing stands; hovered or focused, a card says what it is with × to take it out, a click opens it, and the tab whose page is open has a thin ink line along its foot | The top bar informs and never calls | worca-sweep |
| `nav.words` | A link names where it goes (Open Models, ‹ worca-cc), never Click here or a bare More; one that leaves Worca says so (View PR ↗) | You know where a click leads before it | by hand |
| `nav.labs` | A Labs feature sits where it will live for good, with one quiet word Labs at the end of its row while it is experimental; Settings › Labs is the only place to turn it on or off | It does not move when it graduates, and you can see it is still being shaped | design-system-components |
| `nav.design-switch` | While Stillhet is opt-in, the top bar carries one grey icon (`stillhet-ui`) after Ask worca and Pulse; a click opens a menu of 2 rows, Try Stillhet and Back to today's UI, the current one checked | Trying it and going back are one click away, so people dare to try it | design-system-stillhet-switch |
| `nav.design-switch-acts` | Picking the other UI acts at once: the icon is busy until the call returns, then the page reloads; a failure puts the icon back and a Toast says why. It is the same setting as Settings › Labs, and a flag locked by WORCA_FLAGS disables both rows and says so | One switch, one truth, and a failed switch changes nothing | design-system-stillhet-switch |
| `nav.stillhet-ask` | Stillhet asks once, for the whole install, in a ConfirmStrip under the top bar that opens on No thanks; Esc asks again on the next load. It is not shown when Stillhet is on or locked, on a fresh install, or while a welcome, setup or dialog is open | A question asked once and never nagged | design-system-components |
| `nav.locked` | What the mode or Labs hides is never a dead end: the search finds it with its lock note, and a deep link or a picked result reaches the place's one line and its one way on (Schedules needs Advanced · Switch to Advanced). One truth per place: the bar's own data decides the menu, the places, the search's note and the lock | Nothing is lost by being in Simple | worca-sweep |
| `nav.old-address` | With Stillhet on, an address of classic (Statistics, Runs, Activity, Connectors, Models, Team policy, Workspaces…) lands on the place that holds it now and is replaced, so Back never loops; classic's names are search words too. One table holds them (`ui/public/stillhet/shell/old-addresses.js`) | Bookmarks, links and old habits keep working | stillhet-old-addresses |
| `nav.not-found` | An address that names nothing here (a removed thing, a mistyped id) says so with NotFound and one way on; it never shows something else | A silent fallback reads as the thing you asked for | design-system-components |
| `nav.not-live` | A place not yet in Stillhet says so, names where it lives today in words, and offers Back to Chat; it never reads as empty and holds no switch | An empty look reads as no data, though classic has it | design-system-components |

## Four depths

| Depth | Is | Example |
|---|---|---|
| Place | What the bar lists | Chat, Tasks, Schedules, Projects, Insights |
| Thing | A row of a place's list, opened as a full page | A task, a schedule, a project, a chat |
| Part | A section of a thing | A task's Changes, Activity and Decisions (`thing.parts-under-train`); a project's tabs (`panel.project-tabs`) |
| Fact | One item in a part | A file, a decision, a question, a setting |

## Five ways to move, each with one job

| Way | Goes | Component |
|---|---|---|
| The bar | to a place | PlaceButton, the home bar; Settings turns the bar into its SideMenu |
| A row or a card | to a thing, as a full page | ListRow, PluginCard |
| The trail | one depth up | Trail |
| The pager | sideways, to a sibling: the next task in a group | Pager |
| A link, a search result, a Pulse row, a notification | straight to a fact, in any place | TextLink, Search, ListRow; `land()` |
