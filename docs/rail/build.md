# Building a page

| Rule | What | Why | Held by |
|---|---|---|---|
| `build.pattern-first` | A page is built from a pattern and the lookup | Nobody invents a layout | by hand |
| `build.teach` | What a page needed goes into the design system first: rule, catalog, component, test, gallery | A lesson taught once reaches every page | rail-docs |
| `build.one-mock` | The prototype's Runs list, Pulse, Usage and costs and the run page's title read one mock per Pulse case: `ui/public/stillhet/shell/world.js` | Each kept its own figures, and the badge said 2 over 11 rows | worca-sweep |
| `build.logic` | States, actions, the step flow and where the work goes come from the library | Chat rebuilt them once and lost two states | rail-gate |
| `build.default` | A feature with no design is built from the default: what it is picks the pattern (the table below), each need picks its component or element from the lookup (`comp.one-per-need`), and every state is drawn; the developer gives only words and data | Nobody decides a look, and no feature waits on a design round | rail-default |

The lookup says which component meets a need; a pattern says where it sits. A page is one of these patterns, or a
pattern of each part; a spec names the pattern and the needs, and the place follows. When a part fits no pattern,
propose one here before building it.

**Which pattern.** What the feature is picks its pattern; the catalog's `featureKinds` lists the same rows.
| The feature is… | Pattern |
|---|---|
| A place: a kind of work you browse, set up and come back to (Marketplace, Workflows, a place to keep prompt snippets) | A place: a bar of ways in, a home, way pages and item pages |
| Things you track one by one (schedules, features) | A list in the bar (`list.bar-model`), each row opening A thing's page |
| How Worca behaves (a new setting, Notifications) | A settings tab, or a SettingsRow in one |
| Something you ask Worca for (Build workflow, Explain this run) | A starter in Chat's composer, never a new page (A conversation) |
| Something you start with a few fields (New run, Create PR) | A form, in a Dialog |
| None of these | a question for a person, then `build.teach` |

Tracked things are "A list", rows in the bar, and not "A list page": a new tracked thing gets bar rows that open its
page, never a page of rows. Its rows open A thing's page, which starts with a PlaceHead (`panel.place-head`); a task (a
run) or a group opens A task's page, the one exception ([thing-page.md](thing-page.md)).

**The default, walked through: Marketplace** (`ui/public/stillhet/marketplace/marketplace.js`, the pattern "A place").
One need per line: what the person sees or does → the need → the component → the slot.
- Sees what the place is and how much it holds → the head of a place → PlaceHead with title and facts → home.
- Sees what Worca suggests for them → a reason before the thing → PluginCard, Worca's reason first → home, For you.
- Browses what there is → things grouped by what you want → CenterShelf of PluginCards, two to a row, each once → home.
- Installs one from its card → the one action of a thing → PluginCard's one action at its foot → the shelf.
- Goes to one way in → a way of the bar → a row of the bar (`listController`) → bar.
- Sorts a way → a choice that changes a step → SentencePicker, `Showing [most used ▾] first` → way page.
- Finds a way empty → nothing here, and what comes next → EmptyState with its next step → way page.
- Confirms an install → a yes or no with a short form → ConfirmStrip (`confirmForm`) under the head → item page.
- Reads what a plugin adds and asks for → what a thing holds → SettingsSections of SettingsRows → item page.
- Opens an id that is gone → not found → NotFound → item page.
- Opens it at 375px → narrow → the same slots stacked by [narrow.md](narrow.md) → every page.

Marketplace is the model for the slots, not for the states: it does not draw three of them yet. A new place draws all
five, whatever its example skips: empty is `emptyState` with its next step; loading is one `emptyState` line
(`Loading snippets…`) after 300ms, never a spinner; could not load is `emptyState({ error: true })` with Reload this
part, in that part only; an id in the address that names nothing is `notFound({ what, name, back })`, never the home
drawn instead; and every page at 375px.

**Elements too.** An element a feature adds (a setting, an action in ⋯, a confirm, a row, a toast and its Undo) comes
from the lookup ([components.md](components.md): a component, or an element found by need) and arrives with its look,
words, states and behaviour. A need with no row is a question for a person, then `build.teach`.

**Building a page from a spec.** 1. Pick the page's pattern from the Which pattern table (`build.default`). 2. For each thing the person must see or do, find
its need in the lookup and its slot in the pattern. 3. Write its words by the rules ([small-rules.md](small-rules.md), [actions.md](actions.md): labels of 1–3 words,
plain words, the status line); a state's dot and colour come from [logic.md](logic.md). 4. Draw every state: empty, loading, could not load, a failed step, an unexpected break, a
lost connection, and 375px (Narrow screens). 5. Pass the gate. The catalog of needs, components and patterns, as data
for a tool or an agent, is `docs/design-system-catalog.json`; these files win when the two differ.

**What a page teaches becomes the design system's.** A pattern, a level, a rule, a motion or a control that a page
needed and the design system did not have is added to it before the page ships: the rule in its file here, its catalog entry, and
its component in `ui/public/design-system/components/` with its test and its gallery example. A page never keeps a
hand-built version of something the design system should own; the gate fails component markup written by hand.

**The components in code.** A component with a `code` entry in the catalog is built in code, in
`ui/public/design-system/components/` (`index.mjs` exports them all): call it, never write its markup. Each returns
an HTML string from plain options (`button({ label, kind })`, `confirmStrip({ text, yes })`), so a page that renders
with innerHTML uses it as is and a page that builds elements takes it through `toElement`. A component brings its look
and its states (working, failed, disabled, the count by exception), so a fix or an upgrade reaches every page at once.
A need with no component in code yet: add the component there first, with its test (`test/design-system-components.test.mjs`)
and its `code` entry, then use it. The gallery (`plans/rail/prototype/components.html`) draws each one from the code;
the gate fails a page that writes a component's markup by hand.
