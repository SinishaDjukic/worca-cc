# Worca Rail

Worca Rail is the redesign of every Worca page, one page at a time. A page is specified in `plans/rail/`, built first in
the prototype (`plans/rail/prototype/`), and built from the library (`ui/public/design-system/components/`). Until a page
ships, the app's current page keeps the rules in `docs/design-system.md`.

**Building Rail now:** start at [plans/rail/implementation-prompt.md](../../plans/rail/implementation-prompt.md).

**When the app and Rail differ** (the app ships something Rail does not have, or does it another way), one rule
decides, never case by case: 1. Rail is preferred. 2. If the app's way meets a real need, find how Rail takes it in.
3. The result is Rail, upgraded where needed, written here. A dev way is adopted only once it is written into the prototype and `docs/rail`.

## Where each concern lives

Each rule lives in one file. Every file opens with its rules: an id, one line, why, and what holds it (a check, or
`by hand`). `test/rail-docs.test.mjs` fails a duplicate id or a check that does not exist.

| File | Concern |
|---|---|
| [philosophy.md](philosophy.md) | The six rules everything follows |
| [look.md](look.md) | Type roles, the palette, surfaces, violet |
| [motion.md](motion.md) | What moves, how, and what never does |
| [components.md](components.md) | Which component meets which need |
| [build.md](build.md) | How to build a page, and how a lesson joins the design system |
| [logic.md](logic.md) | The shared logic: states, actions, the step flow, where the work goes |
| [thing-page.md](thing-page.md) | A thing's page and the task page's exception: slots, where the work goes, lists on it, what opens |
| [actions.md](actions.md) | Where an action goes, and how a step runs |
| [lists.md](lists.md) | A list page and a list |
| [keyboard.md](keyboard.md) | Keyboard shortcuts and their sheet |
| [panels.md](panels.md) | Panels, side columns, conversations |
| [settings.md](settings.md) | Settings and a settings tab |
| [forms.md](forms.md) | Forms and suggestions |
| [navigation.md](navigation.md) | How you move through Worca |
| [failures.md](failures.md) | When something breaks unexpectedly |
| [small-rules.md](small-rules.md) | Names and the rules that hold everywhere |
| [narrow.md](narrow.md) | Narrow screens |
| [gate.md](gate.md) | What every page and every new piece of UI code must pass |

The catalog, `docs/design-system-catalog.json`, is the same system as data for a tool or an agent; these files win when
the two differ, and the difference is fixed in the same change.
