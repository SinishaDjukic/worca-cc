---
name: deleted-test-coverage-claims
description: When a plan deletes or moves a test because "the new module's tests cover it" — check each assertion it held is really pinned elsewhere before deleting.
updated: 2026-11-27T06:59:17.003Z
author: Denislav Prinov
---

A plan step that deletes a test with the reason "the grid's and the start's tests cover them" left two guards with no
test at all (design start grid, 2026-11-26, review M1): the load-order guard `if (destroyed || my !== seq) return;`
and the error-line clear on a good answer. Both had been pinned only by the tail of the deleted test
(`an older failure does not paint over the newer list`, `Try again loads the list again`). The ported tests looked
equivalent by name and did not exercise either. Mutating either guard left every remaining test green.

Ported test names lie too: the ported `a failure: … a later answer clears it` never sent a later good answer; it
re-opened with the list still failing. Its name was already wrong at the base, where another test happened to cover
the case.

How to apply:
- Before deleting a test, list each of its assertions and the guard or branch it pins. For each one, name the test
  that covers it after the change, then mutate that guard and run only the surviving tests: it must go red.
- Race guards (`my !== seq`, a `destroyed` check after an await) need a fetch fake that HOLDS one answer: the older
  load is asked, a newer one answers, then the older one is released. `test/ui-design-grid.test.mjs` rig `hold()` is
  the pattern: the held GET answers what was set when it was asked.
- Read a ported test's body against its name; a name claiming "a later answer clears it" must send that answer.
