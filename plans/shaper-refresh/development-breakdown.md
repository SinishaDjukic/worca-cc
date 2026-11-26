# Revised Shaper: development breakdown

How the revised Shaper is built. Read `build-brief.md` first. The clickable
reference is `prototype.html` (dev's classic look; the screens are named below by their `#id`).

## Rules for every slice

- **One flag, `shaperSmallRuns`** (experimental, default off). With it off, today's Shaper
  behaves exactly as on dev: every slice re-checks that.
- **Step on dev.** Extend the existing modules (`src/shared/shape/`, `src/core/shape/`,
  `ui/public/shape/`, `src/core/scheduler.mjs`, `src/core/requirements/`); no parallel second Shaper.
- **Classic design only.** Dev's tokens, components and card markup; shared components, not page-only ones.
- **Each slice is a behaviour** a person can see or a test can prove, with its tests, and ships as one small PR.
- **Slices run one after another,** each starting from the one before it.
- **Measurement from day one** (slice A4): a feature built with the flag on records its Care position, cost and outcomes.
- No names of people in files; the owner is "the owner".

## How it is dispatched

Four Shaper features from Chat, one after another, each with 4–5 slices (dev allows at most 8 per
feature). The next feature is dispatched only when the previous one is merged and looked at.
The branch the runs start from holds `build-brief.md`, this file and `prototype.html`.

## Feature A: foundation (nothing visible changes)

| # | Slice | Done when |
|---|---|---|
| A1 | **The flag.** `shaperSmallRuns` in the registry, the flags doc, the flag tests. | Flag listed, off by default; tests prove nothing changes with it off. |
| A2 | **Feature record.** A feature stores its Care position, who chose it, Worca's pick, and each requirement's kind: owned by one run, or confirmed by a person (with the role that confirms). Requirements live on the feature in Shaper, as on dev, each with a stable R-id. | Stored, read back, migrated; every requirement has a stable id. |
| A3 | **Split rules.** Up to 20 runs; 1–3 requirements per run (the Care position sets the cap); the coverage rule "every requirement is owned by one run or confirmed by a person"; "builds on" only points to earlier runs. | The outline check passes and fails the right cases; dev's 8-slice rule unchanged with the flag off. |
| A4 | **Measurement.** Per feature: position, cost per step, requirements met, gaps found at the end, review findings, first-pass rate, fix rounds, changes after ship. | Figures are recorded for a finished feature and readable per position; "not enough history yet" below a threshold. |
| A5 | **Runs start from the latest finished work.** The next run starts from the last finished run of the feature, not the run numbered before it; a failed or waiting run does not block runs that do not build on it; on resume it merges the latest finished work first; a run that builds on an unfinished run waits. | Chain tests: stop run 3 of 5, runs 4–5 finish, run 3 resumes on top of 5; a dependent run waits. Dev's chain unchanged with the flag off. |

## Feature B: from the ask to approved runs

| # | Slice | Prototype | Done when |
|---|---|---|---|
| B1 | **One card per feature.** One card for the feature's whole life: a state line, one open question, finished steps as one line each, the runs as a flat list. Questions use dev's decision pattern on the card, never a popup. | `#requirements`, `#build` | The card renders every step from one model; no second card appears for the same feature. |
| B2 | **Start step and Care.** Size, the Care dial (Lean · Balanced · Thorough) with Worca's pick from what the feature touches, an estimate per position from recorded step costs, what each position does, "Start requirements". A position below the pick shows the stated tradeoff and is recorded as the owner's choice. | `#start` | The position is stored (A2) and drives the later steps; the tradeoff line names concrete things given up. |
| B3 | **Requirements level.** The owner asks as one role; the picked roles add and challenge to the depth Care sets; every requirement has an example; a disagreement between roles is one question on the card. | `#requirements` | No requirement without an example can be agreed; the round count follows Care; loops are bounded. |
| B4 | **Split.** A Planner proposes the runs; the rules (A3) check them; the same roles and a Challenger challenge the cut; a refiner resolves, bounded; the owner approves once. | `#split` | An approved split satisfies every rule; the Challenger's objections are answered or shown; one approval starts run 1. |

## Feature C: prototype, build and the end

| # | Slice | Prototype | Done when |
|---|---|---|---|
| C1 | **Prototype level.** Only when there are design, UX or UI requirements (and Care allows): Design agents build it, and while they build the card is animated (the screens assemble piece by piece, one agent per screen; still with reduced motion); the owner's remarks change the requirements, the owner confirms. | `#prototype` | Skipped with a reason when no screen requirement exists; a remark edits a requirement on the spec. |
| C2 | **Agents per run.** Planner, the run's roles review the plan, a Test writer separate from the Implementer (per Care), the Implementer, reviewers check against that run's requirements and examples. No agent approves its own work. | `#build`, `#run-panel` | Each run's steps follow the Care table; a reviewer never reviews what it wrote. |
| C3 | **When a run stops.** Only when a check fails, a role's objection cannot be resolved, or an agreed requirement would have to change. It is one question on the card; the other runs continue (A5). | `#run-stops` | No other stop reaches the owner; the question carries the options and Worca's pick. |
| C4 | **Changes mid-build.** Finished work is never rewritten. Owner run not started: it plans from the new text. Running: it stops, re-plans, continues. Finished: a new small change run takes the next turn. Same path from chat and a run's proposal. | `#req-change` | The three cases are tested for each source; a finished run's PR is untouched. |
| C5 | **Verifier.** One check at the end of the feature against every requirement; a gap becomes a small run (C4's path). | `#verifier` | A seeded gap is found and closed by a gap run; the figures feed A4. |

## Feature D: ship and the places

| # | Slice | Prototype | Done when |
|---|---|---|---|
| D1 | **Ship.** One PR per run, stacked in the order runs finished. Requirements confirmed by a person block Ship until the named role marks them. The Care choice and its outcome are on Ship and in the PR description. | `#ship` | Ship is blocked with the reason until marked; PR text carries the recorded choice. |
| D2 | **Runs list and run panel.** A feature is one group row with its runs under it; the panel and the run page show what a run owns, what it starts from and its agents. | `#runs-list`, `#run-panel`, `#run-page` | A 10-run feature is one group; every run shows "starts from". |
| D3 | **Feature page.** Runs, Requirements (each with its owning run or confirming role and status), Decisions (every answer and the Care choice). | `#feature` | Every requirement is traceable to its run or its confirmation. |
| D4 | **Docs and the whole-flow proof.** `docs/shape-it-first.md`, `docs/requirements.md`, the flags doc; one test walks the email example end to end with the flag on; one proves the classic flow with it off. | all | Both walks pass; the docs describe what was built. |

## Not in this version

**The link between the Requirements page and Shaper** (start from a spec by reference, requirements written back, a spec edit becoming a change run). It is shown in the prototype as a concept only (`#req-link`, `#from-requirements`, `#spec-changed`, marked "Concept only"); do not build it. Stable R-ids (A2) keep it possible later.

Also: Parallel runs, two Planners at Thorough, a team minimum for Care (kept as an option), per-run Care.
