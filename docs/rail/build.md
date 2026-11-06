# Building a page

| Rule | What | Why | Held by |
|---|---|---|---|
| `build.pattern-first` | A page is built from a pattern and the lookup | Nobody invents a layout | by hand |
| `build.teach` | What a page needed goes into the design system first: rule, catalog, component, test, gallery | A lesson taught once reaches every page | rail-docs |
| `build.logic` | States, actions, the step flow and where the work goes come from the library | Chat rebuilt them once and lost two states | rail-gate |

The lookup says which component meets a need; a pattern says where it sits. A page is one of these patterns, or a
pattern of each part; a spec names the pattern and the needs, and the place follows. When a part fits no pattern,
propose one here before building it.

**Building a page from a spec.** 1. Pick the page's pattern. 2. For each thing the person must see or do, find
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
