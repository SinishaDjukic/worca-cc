# Shaper feature card: run order, one status per run, every open stop

Covers issue #1598, the open comment on #1595 (the chat card offers one waiting step only), and the
check of the built screens against `prototype.html`. Mock: `run-order-mock.html` (same folder).

Status: agreed by the owner for the build (list-first version, after challenge round 1).

## What was found

Checked on the 16-run feature "CI as a trusted merge gate, and a faster test suite".

1. **The row names the wrong run.** A run that has not started reads `waits for run N`, where N comes
   from the run's place in the stored chain (`chainWaitWord`, `src/shared/shape/run-agents.mjs:56`),
   not from what it builds on. Run 12 read "waits for run 11". It builds on runs 1, 7 and 10; run 11
   was already done. The scheduler itself decides by the builds-on links (`sliceGateState`,
   `src/core/shape/features.mjs:1092`), so the card and the scheduler disagree.
2. **A run that is free to start says it waits.** Every chained run reads `waits for run N`. The
   prototype shows nothing on such a row, `next` on the one with the next turn, and `waits for run N`
   only when N is held up (prototype line 708).
3. **One open step only.** `featureView` keeps the first ask (`features.mjs:388`), and
   `featureCardModel` keeps one `step` (`ui/public/shape/feature-card.mjs:75`). With runs 2, 9 and 11
   waiting, two had no place on the card. The prototype has the same limit (line 715); it never
   showed two asks at once.
4. **The "?" mark means two things.** An open stop and an answered stop that waits its turn
   (`after run N`) draw the same mark. Only the first has something to answer.
5. **Surfaces use different words.** The chat card's head, the feature page and the rows each derive
   their own text (`run-model.mjs`, `feature-card.mjs`, `run-stops.mjs`).
6. **The numbers read as an order.** Runs start by builds-on links and turns, so 9 and 11 finished
   before 5. Neither the prototype nor the build draws this; the prototype has words only.
7. **To check:** runs 5, 8 and 10 were live together, while the rule is one run at a time
   (`rowGoing`). Find out whether that is intended (a stop does not hold the others) or a fault,
   before the map states "one turn".

## Proposal

### A. One status per run (first, small)

One function in `src/shared` returns a run's state and word; the chat card rows, the feature page
rows, the Runs list and the run page head all read it.

Decided: keep today's words and concept; change only what is wrong.

| State | Word | Mark | Change from today |
|---|---|---|---|
| done | `done` | green dot | none |
| has the turn | `planning`, `reviewing plan`, `writing tests`, `building`, `reviewing` | peach, pulsing | none |
| open stop | `waiting for you` | amber "?" | none |
| answered, waits its turn | `after run N` | dashed ring | the mark loses the "?" |
| free to start, next turn | `next` (`next · small change run`) | ring | was `waits for run N` |
| free to start, later turn | no word | ring | was `waits for run N` |
| builds on an unfinished run | `waits for run 5`, `waits for run 7, 10` | faint ring | the real runs, several by number |

The runs named are the unfinished ones it builds on, with a run left out when another named run
already builds on it (run 7 builds on 1 to 6 and reads "waits for run 2, 6").

Server: `stopWords` sets `waitsFor` for every not-started run from `dependsOn` (a list, not only a
stopped dependency), and a `turn` field (`next` / `ready`). `chainWaitWord` goes.

### B. Every open stop on the card

`featureView` returns `asks` (all open stops, run order) beside `ask`. The card lists each as one
line (`Run 2 · plan approval`), and mounts the same step card (#1599) for the one that is open. A
second answer keeps today's refusal. The head says `3 need you`.

### C. Links in the list, drawing on demand (after challenge round 1)

List first. The rows carry every fact; nothing new is always on screen.

- **Root cause in the word:** a named run that waits for the person or failed says so:
  `waits for run 2 (needs you), 6`, `waits for run 5 (failed)`.
- **What a stop holds up:** each line in the "needs you" list ends with the runs behind it:
  `Run 2 · plan approval · holds up 7, 8, 12, 15, 16`. A failed run is listed there too, with Resume.
- **State line:** `Run 6 reviewing · next: run 9` (the count stays in the head, once).
- **Point at a run** (hover, focus; click or Enter keeps it, Esc lets go): a solid bar marks the rows
  it builds on, a dashed bar the rows that build on it. Direct links only. No dimming, no caption,
  no layout shift.
- **Show order:** feature page only, closed by default. A still drawing: dots with the row's own
  marks (done, working, "?", "!", hollow), a run to the right of everything it builds on, and only
  the links that still hold a run back. A link that skips columns runs in the lane between rows, so
  it never passes through another run's dot. Hidden from screen readers; the rows say the same.
- **Motion:** only the existing pulse on the working run. No travelling dot, no pop, no slide
  (classic Motion rule: nothing runs without a state change).
- **Not on** the chat card or the Runs sidebar. Hidden for a feature with few runs or a plain chain
  (threshold to agree, about 5 runs).

New: the pre/post marks in the shared run rows, `holdsUp` on each ask, and
`ui/public/shape/run-order-map.mjs` (pure layout + painter) with layout tests (depth, implied links,
lane routing, a change run) and a gallery entry.

### D. Prototype gaps (separate, after A to C)

Differences between the build and `prototype.html` that are not owner decisions made during the
build. Each needs a yes or no before work starts.

| # | Gap | Prototype | Build |
|---|---|---|---|
| 1 | Split row "Starts from" | names the runs: `waits for runs 4, 6` | a count: `waits for 6 runs` (`outline-body.mjs:489`) |
| 2 | Run page facts | Why, Owns, Starts from, Waits for, Needed by, Cost of estimate | Starts from, Owns (`run-facts.mjs:46`) |
| 3 | Current run in full on the card | Why / Owns / Starts from / Step line under the current row | rows only |
| 4 | Folding | `Runs 4–10 · 7 to go`, `N runs · all done` | every run always listed |
| 5 | Card foot | Pause or Resume, then ⋯ (Open the feature page, Stop the feature) | Pause + Stop, other ⋯ items |
| 6 | Cost against estimate | `$x used of ≈ $est` in the state line | count of runs only |
| 7 | Feature page tabs | Cost, and Log as the event log | Overview, Logs as links |
| 8 | Row click on the card | opens the run panel beside Chat | link to the run page |
| 9 | "Needs you" row text | amber | grey |

Kept as built (owner directions during the build, or #1599): no bar on the one card, role folds on
Requirements, PR chip, cost and chevron on rows, the stop answered in place on every surface.

Gaps 1 and 2 fall out of A (the same builds-on data). Gap 4 conflicts with C on a long feature and
should be decided together with it.

## Order of work

1. A: one status function, real `waitsFor`, `turn`; tests for the 16-run case (run 12, run 7).
2. B: `asks` on the view, the list on the card, tests with three open stops.
3. C: the row marks and "holds up", then Show order, behind the `shaperSmallRuns` flag.
4. D: the gaps that get a yes.

Each step: related tests, classic flag-off unchanged, a real-browser check of the visible states.

## Challenge round 1 (new user, daily user, UX/UI reviewer)

All three: the row words and the one-line summary answer every question; the map at rest answers none.

- No "waits for" link could be traced from the lines alone. Long links run through unrelated dots
  (2→7 passes 8, 5, 6 and reads as a chain; 9→16 passes 3 and 4), and curves merge near 10, 14, 15.
- The picked-run view lit the whole chain back to dev, read as "run 12 depends on nine runs".
- Orange means both "working" and "waiting for you". Too many dot and line states; the faint ones
  are close to invisible; the legend has 11 entries.
- Left to right reads as time, which is the confusion the map was meant to remove. "dev" reads as a run.
- The travelling dot loops without a state change, against the classic Motion rule, and says
  something untrue (nothing leaves a run until it is done). No failed state is drawn.
- About 175px on the chat card before the first row; scrolls sideways on a deep feature.

Reviewers' smallest version: the corrected row words; the summary line; a blocked row names the
root cause (`waits for run 2 · needs you`); the Approve row says what it holds up; pointing at a
row marks what it waits for and what waits for it, in the list. The map, if kept: feature page
only, on demand, static, only the links that hold something back.

## Decided

- List first: links are shown in the run rows; the drawing is on demand on the feature page only.
- No travelling dot or other looping motion.
- The Runs sidebar keeps today's layout: no map, the stage strips stay. Its row words follow A.
- Today's words stay. Several runs read `waits for run 7, 10`.

## Settled for the build

1. Rows stay in number order (the existing concept).
2. "Show order" appears on a feature with 5 runs or more whose links are not a plain chain.
3. From D, only gaps 1 and 2 are built (they use the same builds-on data). Gaps 3 to 9 wait for the owner.
4. Finding 7 (several runs live at once) is investigated and reported; it is fixed only if it is a fault.
