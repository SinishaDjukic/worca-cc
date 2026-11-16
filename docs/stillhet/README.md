# Stillhet

Stillhet is Worca's design system: classic's functions on one set of parts, every page built from the library
(`ui/public/design-system/components/`), drawn first in the prototype (`plans/stillhet/prototype/`). With the `stillhet`
flag off, Worca is classic and keeps `docs/design-system.md`.

**Building Stillhet now:** start at [plans/stillhet/README.md](../../plans/stillhet/README.md).

**Classic's ideas are welcome.** Where a classic pattern works better than Stillhet's own (tabs, dropdown filters,
labelled fields, bordered buttons, a row that opens on click), Stillhet takes it: drawn in Stillhet's look, added to the
library, written here with where it came from. It is then a Stillhet pattern, never a one-off copy. Classic's screens and
markup are never reused; its data, APIs and logic are.

## Where each concern lives

Each rule lives in one file. Every file opens with its rules: an id, one line, why, and what holds it (a check, or
`by hand`). `test/stillhet-docs.test.mjs` fails a duplicate id or a check that does not exist.

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
