# Shaper role reviews + Project fit — design spec (2026-10-18)

Third feature, after "Runs redesign" and "Shaper as chat cards". Mostly engine; its screens follow the runs spec
(`plans/run-redesign-design-spec.md`: visual language §1, status line §3.3a, buttons, corners, colours, known bugs,
customer perspective) and the Shaper spec (`plans/shaper-cards-design-spec.md`: step cards, one check-row component,
the feature card's log). Mock: canvas "Runs redesign + Shaper as cards", board L.

## 1. Problem

- One planner writes the plan through every picked perspective, and one refiner reviews it through all of them at
  once (`perspectivesBlock`, `n_refine`). Same model, same context, self-review: the roles never really challenge
  the plan. The deterministic shape check only proves sections and checklists exist, not that they are right.
- Plans miss the project's own context (existing components, design rules, known bugs, open specs). Today a person
  pastes it into each request; the 17 Oct UI bugs came mostly from that gap.

## 2. Goal

- **One writer, independent reviewers.** The planner writes once. Each picked perspective gets its own reviewer:
  a fresh context, one role, told to find what is wrong, not to rewrite. The refiner then fixes the plan from their
  findings.
- **A Project fit perspective** that knows the project's world and checks the plan reuses it.
- Same engine, same cards: findings show on the Plan step card; no new ask kind.

## 3. Role reviews

- **Graph:** `n_plan` → **role reviews** (one `planReviewer` agent per picked perspective, run in parallel under the
  existing semaphore) → `n_refine` (merges findings into plan vN+1) → plan approval as today. The existing
  `planReviewer` agent key and its severity output (critical / major / minor / suggestion) are reused, with a
  role brief per perspective.
- **Each reviewer gets:** the request, the plan, the Clarify answers, its role brief (the perspective's `help` plus
  its checklist rules), the repo, and for Project fit the house brief (§4). It does not see the other reviewers.
- **Output per reviewer:** findings with severity, the plan section, and one concrete fix each; and a verdict
  per checklist item (`R-ux-3: unmet — no 375px state for the Split card`).
- **Loop:** if any critical or major finding remains after the refiner, run the reviews again on vN+1; at most 2
  rounds (config), then the person decides with the findings shown.
- **Cost:** reviewers default to the step's cheaper model lane; a role whose checklist is fully met and has no
  critical/major finding is skipped in round 2.
- **On the Plan step card:** the check rows become one row per role: `UX · 2 major fixed · 1 minor open`; `Show`
  unfolds the findings. The approve button stays primary; open majors make it read `Approve with 1 open issue`.

## 4. Project fit perspective

- **Key** `fit`, label "Project fit", default on when the project has a house brief; off otherwise.
- **House brief:** one short generated file per project (target ≤ 2,000 words), refreshed when its sources change:
  - project memory (existing memory store) and `CLAUDE.md`;
  - the design rules and tokens (design spec, `style.css` tokens);
  - the index of existing components, card types, endpoints and workflows, with one line each;
  - open specs in `plans/` (title + one line) and the known-bug list.
  The person can read and edit it in Settings → Project; edits survive refreshes (pinned lines).
- **Plan section** "Fit": what the plan reuses (component, endpoint, card) and what it adds new, each with a reason.
- **Checklist `R-fit-n`:** no second component where one exists; no new engine state unless named in a spec; UI
  wording matches existing surfaces; no known bug repeated; no conflict with an open spec.

## 4a. Screens (board L)

- **Proposal card:** `Project fit` is one more perspective chip, on by default when the project has a house brief;
  untick it per run like any chip.
- **While reviewing:** no new stage; it is part of Plan. The feature card's status line reads
  `Running · Plan · role reviews` (round 2: `Running · Plan · role reviews, round 2`); the stepper and progress stay
  on Plan (runs spec §2.3).
- **Who is challenging, live (decided 2026-10-19):** under the status line, one row per picked role while reviews
  run: dot + role + state — `reviewing` (pulsing dot), `no findings`, `1 major` (done, worst severity and count),
  `skipped: nothing open` (round 2). During Refine: `Refine · fixing 3 findings from UX and Architect`. Same rows on the
  run page and the group page (one renderer); they become the Plan card's per-role rows when the plan stops. Built from
  the existing role-review slices and stored findings; no new engine state.
- **Plan step card** (the Shaper spec's one layout): the folded check line becomes `Reviewed by 5 roles · 1 open`;
  unfolded, one row per role through the single check-row component: `✓ Product`, `✓ Architect · 1 major fixed`,
  `! UX · 1 minor open`, `✓ QA`, `! Project fit · 1 major open`. Each row's `Show` unfolds its findings: severity chip
  (2px corners; critical red, major amber, minor and suggestion grey), the plan section, the one-line fix, and
  `fixed in v3` or `open`. Primary reads `Approve and build`, or `Approve with 1 open issue` when a critical or major
  finding is open; `Ask for changes` stays.
- **Receipt / log line:** `Plan approved · 5 roles reviewed · 1 open issue accepted`.
- **Settings → Project → House brief:** a page with the generated brief (read-only sections), its sources with
  when each was read, pinned lines (editable, kept on refresh), `Refresh now` (secondary) and the word count against
  the budget. Same buttons, corners and dividers as everywhere.
- **Cost:** reviews add cost; the Split step card's estimate and the feature's total (runs spec §2.4) include them.

## 5. Tests

1. Graph: a shaped run with Product + UX + QA runs 3 reviewers in parallel, each with only its own brief (prompt
   snapshot), then the refiner with all findings.
2. Loop: a critical finding triggers round 2; none → no round 2; a 3rd round never runs.
3. Findings on the card: per-role rows, `Approve with 1 open issue`, `Show` unfolds the findings.
4. House brief: generated from fixture sources within the word budget; a pinned line survives a refresh.
5. Fit: a plan adding a second check-row renderer gets an `R-fit` unmet + a major finding (real 17 Oct fixture).
6. Cost: a skipped role in round 2 makes no agent call; review cost is in the feature total.
7. Consistency: the Plan step card renders the same in chat, run page and group page (Shaper spec test 1); the
   status line follows the one pattern; the known-bug list of the runs spec applies (one button style, aligned rows,
   each fact once, light and dark, 375px).
8. Customer: a run with Project fit unticked runs no fit reviewer; a project with no brief shows no Project fit chip
   and no error; the brief never leaves the machine except inside the prompts of the user's own runs.

## 6. Decisions (2026-10-18)

1. Reviewers use the cheaper model lane.
2. At most 2 review rounds.
3. Project fit is on by default for a project with a house brief.

## 7. Delivery

Its own Shaper feature from `dev`, stacked PRs, tests in every run. Engine runs first (role reviews, loop, house
brief, Project fit perspective); the Plan step card UI last, built on the one check-row component — it lands after
"Shaper as chat cards" run 1 (step cards) is on `dev`, or rebases onto it.
