# Stillhet

Stillhet is Worca's design system: classic's functions on one set of parts, every page built from the library
(`ui/public/design-system/components/`), drawn first in the prototype (`plans/stillhet/prototype/`). With the `stillhet`
flag off, Worca is classic and keeps `docs/design-system.md`.

**Building Stillhet now:** start at [plans/stillhet/README.md](../../plans/stillhet/README.md).

## Where each concern lives

Each rule lives in one file: one line, with why it exists and what holds it (a check, or `by hand`). Every file opens
with its rules; below them it keeps only reference tables and short worked examples. `test/stillhet-docs.test.mjs` fails
a duplicate id or a check that does not exist. A rule taken from classic says so ("from classic's …", `build.classic-ideas`).

| File | Concern |
|---|---|
| [philosophy.md](philosophy.md) | The rules everything follows |
| [look.md](look.md) | Type, the palette, the alert ladder, charts, the background, icons |
| [motion.md](motion.md) | What moves, how, and what never does |
| [components.md](components.md) | Which component meets which need |
| [build.md](build.md) | How to build a page, and how a lesson joins the design system |
| [logic.md](logic.md) | The shared logic: states, actions, the step flow, where the work goes |
| [thing-page.md](thing-page.md) | A thing's page and a task's page: the frame, the train, the folds, the diff |
| [actions.md](actions.md) | Where an action goes, and how a step runs |
| [lists.md](lists.md) | The bar's lists, filters and rows |
| [keyboard.md](keyboard.md) | Keys, focus and Tab order |
| [panels.md](panels.md) | Panels, conversations and their cards, centers and places |
| [settings.md](settings.md) | Settings and a settings row |
| [forms.md](forms.md) | Forms, fields and suggestions |
| [navigation.md](navigation.md) | How you move through Worca |
| [failures.md](failures.md) | When something breaks unexpectedly |
| [small-rules.md](small-rules.md) | Names, words, counts, tooltips |
| [narrow.md](narrow.md) | Narrow screens |
| [gate.md](gate.md) | What every page and every new piece of UI code must pass |

The catalog, `docs/design-system-catalog.json`, is the same system as data for a tool or an agent; these files win when
the two differ, and the difference is fixed in the same change.
