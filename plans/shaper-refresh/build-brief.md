# Shaper, small runs: build brief

The one document to build from. It holds only final decisions. The slices are in
`development-breakdown.md`; the clickable reference is `prototype.html` (open it in a browser; screens are
named by their `#id`).

## Goal

A large feature is built as **small, well-checked runs**. The enemy is missing pieces and wrong behaviour,
which come from big chunks of work. Speed is not the goal: runs go one after another.

## Out of scope (do not build)

- **The link between the Requirements page and Shaper.** The prototype shows it in the group
  "Concept · later" (`#req-link`, `#from-requirements`, `#spec-changed`), marked as a potential direction.
  Nothing there is built. The Requirements page is not changed at all.
- The prototype's first screen (`#intro`) and its Back / Next line are the prototype's own; not product.
- Parallel runs, two Planners, a team minimum for Care, a Care setting per run.

## Ground rules

- **One flag, `shaperSmallRuns`** (experimental, default off). With it off, Shaper behaves exactly as on
  dev today; every slice proves that with a test.
- **Step on dev's Shaper**: extend `src/shared/shape/`, `src/core/shape/`, `ui/public/shape/`,
  `src/core/scheduler.mjs`. No second Shaper beside the first.
- **Dev's current design only**: its tokens, components, card markup and the design-system library. Shared
  components, never page-only ones.
- Requirements live on the feature in Shaper, as on dev today, each with a stable id.
- No people's names in repo files.

## The model

Two elements only: **a feature and its runs** (a slice is a run). One feature is one group on the Runs list
and **one card in Chat for its whole life**. Up to 20 runs; each run owns 1–3 requirements.

### The steps of the card

0. **Start.** The feature's size, the Care dial, one button "Start requirements" (`#start`).
1. **Requirements.** The person asks as one role; the picked roles (Product, Engineering, Design, DevOps,
   Security, Compliance, QA) add and challenge. Every requirement has an example. A disagreement between
   roles is one question **on the card** (dev's decision pattern: options, Worca's pick preselected, who
   wants what and why); never a popup. The list is one expand/collapse row per role: a green mark and what
   the role did when nothing is open; a question mark, open, when it has a question (`#requirements`).
2. **Prototype.** Only when there are design / UX / UI requirements (and Care allows). Design's agents build
   it; while they build, the card is animated (the screens assemble piece by piece, one agent per screen;
   still with reduced motion). A remark changes a requirement. The person confirms (`#prototype`).
3. **Split.** A Planner proposes the runs; fixed rules check them; the same roles and a Challenger challenge
   the cut; a refiner resolves, bounded; the person approves once (`#split`).
4. **Build**, run by run: Planner → the run's roles review the plan → a Test writer (separate from the
   Implementer, per Care) → Implementer → reviewers check against that run's requirements and examples
   (`#build`, `#run-panel`).
5. **Verifier.** One check of every requirement at the end of the feature; a gap becomes a small run
   (`#verifier`).
6. **Ship.** One PR per run, stacked in the order runs finished (`#ship`).

### Rules that always hold

- Every requirement is **owned by exactly one run, or confirmed by a person** (no run owns it; a named
  role marks it; Ship is blocked until then).
- **No agent approves its own work.** At every level one agent writes, independent agents check, a refiner
  resolves, fixed rules referee, loops are bounded, then the person decides.
- **A run stops for the person only** when a check fails, a role's objection cannot be resolved, or an
  agreed requirement would have to change (`#run-stops`).
- **Runs start from the latest finished work.** The next run starts from the last finished run of the
  feature, not the run numbered before it. A failed or waiting run does not block runs that do not build
  on it. On resume it merges the latest finished work first (dev: `mergeBaseBeforeRun`). A run that builds
  on an unfinished run waits for it.
- **Finished work is never rewritten; a change arrives as a new small run.** Owner run not started: it
  plans from the new text. Running: it stops, re-plans from the new text, continues; the person is told,
  not asked. Finished: a new small change run takes the next turn; the finished run and its PR stay
  (`#req-change`). Same path for a request in chat, a run saying a requirement must change (the person
  decides first) and a gap found by the Verifier.

### Care

One dial for the whole process: **Lean · Balanced · Thorough**. Chosen at the Start step; Worca's pick
(from what the feature touches) is preselected with its reason; each position shows an estimate from
recorded step costs.

| What it sets | Lean | Balanced | Thorough |
|---|---|---|---|
| Requirements | the asker role plus one challenge round | all picked roles add and challenge once | roles challenge until no objection, at most 3 rounds |
| Prototype | only when asked for | when there are screen requirements | when there are screen requirements, reviewed by Design and Product |
| Run size | up to 3 requirements | up to 3 requirements | up to 2 requirements |
| Build approach | tests first, by the Implementer | tests first, by a separate Test writer | tests first, by a separate Test writer |
| Reviewers | Product and one more role | the run's roles | the run's roles, each on its own |
| Challenger | off | at the split | at the split and on each plan |
| Models | the everyday model for every agent | the strong model plans and reviews, the everyday model builds | the strong model plans and reviews; Product reviews on a second model |
| Fix cycles | 1 | 2 | 3 |

Model names come from the install's model settings, never hard-coded.

**Any position may be picked for any feature: it is a stated tradeoff.** Below Worca's pick the card says
in concrete words what is given up and records it as the person's choice ("Worca recommended …"); nothing
blocks. The recorded choice shows on the feature page, on Ship and in the PR description, with the outcome
once the feature is finished.

### Measurement (from the first slice that runs)

Per feature: Care position, cost per step, requirements met, gaps found at the end, review findings,
first-pass rate, fix rounds, changes after ship. Figures per position are shown from the project's own
history, and the card says "not enough history yet" until there is some.

### Rows and alignment (design)

A row's mark sits on its first line in one left column; ids share one column; a detail sits beside the
title only when it fits whole, otherwise it takes its own line; a key-value block has one label column;
rows are one line where they can be; one primary button per card.

## For every run of this work

- Run the related tests and the design-system and flag gates; skip the in-run full suite (CI runs it).
- Commit locally only: no git push, no pull request, no GitHub writes.
- Prove the flag-off path is unchanged.
