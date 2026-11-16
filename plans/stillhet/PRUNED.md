# What this branch removed, and why

One commit holds the whole prune, so it can be read or undone in one step (`git revert` it; every file is in history).
A file was kept if it is current truth, folded in if it held a decision that still matters, and deleted otherwise.
Classic, the server and tests that are not Stillhet's were not touched.

## Deleted

| What | Files | Why |
|---|---|---|
| Comparison and audit pictures | `out/stillhet-compare/` (678), `out/stillhet-audit/` (21) | Output of comparing the old live wiring with the prototype, about 54 MB. Generated output does not belong in git: it dirtied every tree and went stale. Both folders are ignored now |
| Mock pictures and mock pages | `plans/stillhet/mocks/` (119), `plans/mocks/stillhet-*` (6), `plans/mocks/panel/` (57) | Each showed a decision that is now a rule and is drawn in the prototype. The prototype is the design; a picture beside it is a second copy that drifts |
| Old plans | `plans/stillhet/history/` (8), `enrollment.md`, `implementation-prompt.md`, the old `README.md` | The wave plans, the old shipping plan and the plan for the first live build. The live build is rebuilt from `spec/`; the decisions that still hold were folded in (below) |
| Reviews and audits | `review.md`, `review-2.md`, `review-agreed.md`, `click-sweep.md`, `audit-feature-1.md` | Rounds of findings on earlier states of the prototype and the first wiring. What still matters is in `spec/lessons.md` (what went wrong, as rules and checks) and `spec/assessment.md` (what is still open) |
| Agreed notes | `agreed/chat-and-runs-decisions.md`, `agreed/decisions-1.5b.md` | Every decision is a rule in `docs/stillhet/`; the one that was not is folded in (below) |
| The Stillhet switch mock | `stillhet-switch.md`, `prototype/stillhet-switch.html`, `prototype/stillhet-switch.js` | A design round for the top-bar icon. The icon is a library component (`stillhet-switch.mjs`) with its rule (`nav.design-switch`), test and gallery example |
| Tests of deleted files | `test/stillhet-instructions.test.mjs`, `test/stillhet-audit-report.test.mjs`, `test/stillhet-switch.test.mjs` | Each only held the shape of a file above. The switch itself stays tested by `test/design-system-stillhet-switch.test.mjs`, the entry points by `test/stillhet-docs.test.mjs` |

## Folded in before deleting

| Decision | From | Now in |
|---|---|---|
| Classic's ideas are welcome, drawn in Stillhet's look and added to the library; classic's screens and markup are never reused | `implementation-prompt.md`, the owner's brief | `docs/stillhet/README.md` |
| One codebase: the prototype on a demo adapter, the app on a live adapter, never a second copy of a page | `implementation-prompt.md` | `docs/stillhet/build.md` (One codebase) |
| With the flag off Worca is classic, exactly | `implementation-prompt.md` | `docs/stillhet/gate.md` `gate.flag-off` |
| "Legacy approach" is only the + menu's heading; the actions keep "by hand" | `implementation-prompt.md` | `docs/stillhet/philosophy.md` `stillhet.chat-first` |
| A message typed in the composer is never read as the answer to a task's question | `agreed/chat-and-runs-decisions.md` C6 | `docs/stillhet/panels.md` `panel.conversation-cards` |
| The prototype is the design and wins; a rule that differs is corrected in the same change | `CLAUDE.md` (the newer wording; the old plan put the concept first) | `plans/stillhet/README.md` |

## Renamed

| From | To | Why |
|---|---|---|
| `tools/stillhet-artifact.mjs` | `tools/stillhet-design-system-page.mjs` | It writes the rules, catalog and gallery as one HTML file. It is never published as an Artifact |

## Replaced by the spec, then deleted

| File | Now in |
|---|---|
| `chat-cards.md` (classic's chat cards to Stillhet's, each starter's fields, the open parity gaps) | `spec/wiring.md` (Chat; the task card and proposals), `spec/gaps.md` |
| `spec.md` (the task page) | `docs/stillhet/thing-page.md` where it is design, `spec/wiring.md` (a task's page) for its functions |
| `pulse.md` | `docs/stillhet/panels.md` and `settings.md` where it is design; `spec/server.md` (S23 to S29, E5 to E8) for the engine rules near a limit, the usage windows and events; `spec/stillhet-features.md` (Pulse) |
| `test-protocol.md` | `spec/gate.md` |

## Kept, and why

| File | Why it stays |
|---|---|
| `stillhet-wiring.md`, `findings.md`, `test-results/PLAN.md`, `test-results/FINDINGS.md` | Read by the gate's tools and their tests in `npm test` (`tools/stillhet-wiring.mjs`, `stillhet-surfaces.mjs`, `stillhet-no-demo.mjs`, `classic-inventory.mjs`, `prototype-pr-check.mjs`). They describe the first wiring, which `spec/wiring.md` replaces for people. Step B2 of `spec/build-order.md` points the tools at one file per place (`spec/places/`), and these four go in that step. Do not add rows to them |
| `task-engine-additions.md` | The three server additions on this branch (raise the cap, Restart Build, pause after a step) are cited from server code this branch does not edit. Its facts are also in `spec/server.md` |
| `coverage/` | The generated inventory of classic's controls (`tools/classic-inventory.mjs`). Regenerated against dev for the build |

## Tests retired with the redesign

Listed here when the test pass is done: host tests of the first wiring that only held a design the redesign replaced.
