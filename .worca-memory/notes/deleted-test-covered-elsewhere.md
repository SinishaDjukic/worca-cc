---
name: deleted-test-covered-elsewhere
description: When a plan deletes an old test because "the new module's tests cover it", check the guards it pinned still have a red row
updated: 2026-11-27T06:59:15.896Z
author: Denislav Prinov
---

A plan that moves code into a new module often deletes the old module's tests "because the new tests cover them".
The ported tests copy the happy paths, so a guard that only the deleted test pinned loses its pin.

What happened (designs on the design start page, 2026-11-26):
- The plan deleted `test/ui-design-view.test.mjs` "the library: … an older answer paints nothing".
- That test was the only pin for two guards in `designs-grid.mjs`:
  - the load-order guard, `my !== seq`;
  - the error-line clear on a good answer.
- With either guard removed, all 58 grid, studio and route tests stayed green. That cost a fix cycle.
- A port of "a failure: … a later answer clears it" did not catch it either. That test re-opened with the list still
  failing, and the 300 ms loading line clears the error line on its own.

How to apply:
- For every test the plan deletes as covered elsewhere, list the guards it reaches.
- Mutate each guard in the new module and run the new tests.
- An order guard needs a rig that holds one GET (`hold()` in `test/ui-design-grid.test.mjs`) so an older answer can land after a newer one.
- An "answer clears the error" row must answer before the loading-line timer fires, because that timer clears the error by itself.
