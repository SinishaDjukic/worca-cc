# Building a page

| Rule | What | Why | Held by |
|---|---|---|---|
| `build.pattern-first` | A page is one of the catalog's patterns, or a pattern for each of its parts; a part that fits none is proposed here before it is built | Nobody invents a layout | by hand |
| `build.default` | A feature with no design is built from the default: what it is picks the pattern (the table below), each need picks its component or element from the lookup (`comp.one-per-need`), and every state is drawn. The developer gives only words and data | Nobody decides a look, and no feature waits on a design round | stillhet-default |
| `build.all-states` | A new page draws every state, whatever its example skips: empty (with its next step), loading (one line after 300ms, never a spinner), could not load (that part only, with Reload this part), not found (never the home instead), a failed step, a lost connection, and 375px | The states nobody drew are the ones people meet | by hand |
| `build.teach` | What a page needed and the design system lacked is added first: the rule in its file here, the catalog entry, the component with its test, its gallery example. A page never keeps a hand-built version | A lesson taught once reaches every page | stillhet-docs |
| `build.logic` | States, actions, the step flow and where the work goes come from the library (`logic.one-source`) | A page that rebuilds them loses states | stillhet-library-gate |
| `build.one-codebase` | The prototype is Stillhet on a demo data adapter, and the app is the same page code on a live adapter: never a second copy of a page. A page reuses classic's data, APIs and logic, never its screens or markup; demo data lives only in the demo adapter (`gate.no-demo`) | Two copies drift, and a wrapped classic screen is not Stillhet | stillhet-no-demo-on-live |
| `build.one-mock` | The prototype's Tasks list, Pulse, Usage and costs and the task page read one store per Pulse case: `ui/public/stillhet/shell/world.js` | Each kept its own figures once, and a badge said 2 over 11 rows | worca-sweep |
| `build.classic-ideas` | Where a classic pattern works better than Stillhet's own, Stillhet takes it: drawn in Stillhet's look, added to the library, and its rule says where it came from | A familiar pattern beats a clever one, and it is then Stillhet's, never a one-off copy | by hand |

## Which pattern

What the feature is picks its pattern; the catalog's `featureKinds` lists the same rows.

| The feature is… | Pattern |
|---|---|
| A place: a kind of work you browse, set up and come back to (Marketplace, Workflows, a place to keep prompt snippets) | A place: a bar of ways in, a home, way pages and item pages |
| Things you track one by one (schedules, features) | A list in the bar (`list.bar-model`), each row opening A thing's page (a task or a group opens A task's page) |
| How Worca behaves (a new setting, Notifications) | A settings tab, or a SettingsRow in one |
| Something you ask Worca for (Build workflow, Explain this task) | A starter in Chat's composer, never a new page (A conversation) |
| Something you start with a few fields (New task, Create PR) | A form, in a Dialog; a form that starts work opens from Chat (`stillhet.chat-first`) |
| None of these | a question for a person, then `build.teach` |

## From a spec to a page

1. Pick the page's pattern from the table above.
2. For each thing the person must see or do, find its need in the lookup ([components.md](components.md)) and its slot in the pattern.
3. Write its words by [small-rules.md](small-rules.md) and [actions.md](actions.md); a state's word, mark and colour come from [logic.md](logic.md).
4. Draw every state (`build.all-states`).
5. Pass the gate ([gate.md](gate.md)).

## The default, walked through: Marketplace

`ui/public/stillhet/marketplace/marketplace.js`, the pattern "A place". What the person sees or does → the component → the slot.

- Sees what the place is and how much it holds → PlaceHead with title and facts → home.
- Sees what Worca suggests for them → PluginCard, Worca's reason first → home, For you.
- Browses what there is → CenterShelf of PluginCards, two to a row, each once → home.
- Opens one → the card's title, a link; the whole card opens its page (`panel.card-opens`) → the shelf.
- Installs one from its card → PluginCard's one bordered action → the shelf.
- Goes to one way in → a row of the bar (`listController`) → bar.
- Narrows or sorts a way → PageFilters: tabs with counts, then Sort by (`list.filters`) → way page.
- Finds a way empty → EmptyState saying why, with its next step → way page.
- Confirms an install → ConfirmStrip (`confirmForm` when it holds a short form) → item page.
- Reads how a plugin is doing, what it adds and asks for → SettingsSections of SettingsRows (`panel.plugin-manage`) → item page.
- Asks about it → one Ask about it in chat in the head; no composer → item page.
- Opens an id that is gone → NotFound → item page.
- Opens it at 375px → the same slots, stacked by [narrow.md](narrow.md) → every page.
