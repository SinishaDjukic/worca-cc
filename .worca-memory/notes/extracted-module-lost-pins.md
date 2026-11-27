---
name: extracted-module-lost-pins
description: A component lifted out of a page that is being removed loses the race guards that the page's own test file pinned; worth reading when a plan deletes a view's te
updated: 2026-11-27T06:59:17.883Z
author: Denislav Prinov
---
When a change lifts a component out of a page it removes, the component's guards can be pinned in TWO test files:
the component's own file, which gets ported, and the host page's view test, which gets deleted with the page. A plan
line such as "delete these view tests: the new module's tests cover them" is usually not checked, and it is wrong
for the race and recovery cases.

Seen on 2026-11-26: the design Library's grid became `ui/public/design/designs-grid.mjs`. The deleted
`test/ui-design-view.test.mjs` "the library: … an older answer paints nothing" was the only pin of two guards:
- the load seq guard (`if (destroyed || my !== seq) return;`);
- clearing the error line when a later answer is good.

Both mutants stayed green, which cost a review cycle. The ported `a failure: … a later answer clears it` test never
sends a later answer: its name was already wrong at the base.

What to check:
- **Before deleting a host test**, grep it for guard phrases (`older answer`, `Try again`, `destroy`) and move each one
  into the new module's tests.
- **When reviewing**, run every surviving mutant against the checkpoint code too (a `git archive <checkpoint>` copy).
  - Red at the checkpoint but green now: a pin was lost, and that is this change's defect.
  - Green in both: the gap was already there before this change.
