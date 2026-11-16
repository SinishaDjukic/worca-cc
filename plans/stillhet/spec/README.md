# The build spec

What a fresh, full build of live Stillhet needs. A file is listed once it exists.

| File | Holds |
|---|---|
| [gaps.md](gaps.md) | What the prototype lacks compared with classic, by place: must-have, later or drop |
| [lessons.md](lessons.md) | What went wrong in the prototype, the first build and its wiring, each as a rule, a test or a gate check |
| [assessment.md](assessment.md) | The user feedback and the persona findings, each answered, and the decisions the owner agreed to |
| [server.md](server.md) | Every piece of backend work the build needs, as contracts (S1 to S31), what this branch already has that dev lacks, and the engine rules the UI relies on |
| [stillhet-features.md](stillhet-features.md) | The features Stillhet itself introduces: what each is built on, what must not be built again, and the rules for anything new |
| [wiring.md](wiring.md) | For every place and every function a person needs there: the route and payload from today's code, the Stillhet control, the live read, its empty, long and failed states, the proving test, and whether today's live code is reused, adapted or rewritten |
| [build-order.md](build-order.md) | The steps (B1 to B36) in waves: who owns which files so that parallel runs never share one, what each step needs first, and its acceptance tests |
| [gate.md](gate.md) | What proves a batch: four isolated instances, the place-by-mode table, the walk and its evidence, classic intact, and the tests and their time |

Read in this order to build: `build-order.md`, then the place's rows in `wiring.md`, `server.md` for any S id they cite,
`stillhet-features.md` for what to reuse, and `gate.md` before asking for a review.
