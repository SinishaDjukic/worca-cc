# Run progress: one bar for every run

Date: 2026-10-14. Base branch: `dev`. Branch: `feat/run-progress`. Independent of Shape it first
(#707): it works for every run and every "Run after" chain on `dev` today, and Plan in slices
reuses it later.
Mock: the "Specs in Chat" design canvas, board 10 "Run progress: one bar for every run",
https://claude.ai/artifact/MJk8bfs2cK4YsKTBta5Z2q

## 1. Goal

**At a glance, where is a run, and does it need me?** Today the run page says "Step: Refine Plan"
and the run list says "Running · Refine Plan". The step names are internal (a run can have 15 of
them), and nothing shows how far along the run is.

**Success:**
1. Every live run shows one bar with four stages, **Plan · Build · Review · Ready**, on the run page,
   and a thin line in the run list. A person who has never seen the workflow can tell the stage.
2. The bar **never moves backwards**, also through review loops.
3. A run that waits for a person is amber everywhere it's shown, within one second of the question.
4. A chain of runs ("Run after") shows one overall bar and is one expandable row in the run list.
5. No new tiles, no percentages, no ETA, no cost forecast. The time and cost tiles stay as they are.

## 2. Decisions

| # | Decision |
|---|---|
| P1 | **Four fixed stages.** Plan, Build, Review, Ready. Each agent's metadata gains an optional `progressStage: 'plan' \| 'build' \| 'review'` (`agents/*.meta.json`). Set it on the shipped agents: clarify, planner, refiner, planReviewer, architect, architectSetup → `plan`; decomposer, implementer → `build`; reviewer, workspaceReviewer, manualTestsChecklist, manualWebUiTesting → `review`. Ready is the run reaching End. Script cards and agents without the field don't change the stage. |
| P2 | **Moves on real sub-steps, never on time.** Each stage is a quarter of the bar. Inside a stage the fill advances by what is known: Plan by its finished agents out of the Plan agents in the graph; Build by finished tasks out of the decomposer's tasks (or finished Build agents when there is no decomposer); Review by passes, each pass adding a small fixed step and capped below the stage's end until the review passes. The fill animates between positions (CSS transition), so it glides. |
| P3 | **Monotonic.** The fill is the maximum it has reached. A review that sends work back to the implementer stays in Review ("Review · 2nd pass, fixing 2 issues"); it never goes back to Build. |
| P4 | **Three colours, the existing families.** Blue while working, amber when the run waits for a person (any `pendingQuestion`, or paused), green when done. Red stays for stopped and error, shown as today. The same mapping as `runStatusMeta`. |
| P5 | **One line of text** above the bar on the run page replaces "Step: …": `<Stage> · <what is happening>`, for example "Build · task 2 of 4", "Review · 2nd pass", "Plan · needs you: answer 3 questions". |
| P6 | **Workflows the stages don't fit.** If no node in the graph has a `progressStage` (a deck workflow, Memory defragment, a custom workflow of custom agents), the bar has no stage marks: it fills by finished nodes out of all nodes (monotonic), and the text is the current node's label. Nothing is ever shown that the run can't back up. |
| P7 | **Run list (left pane).** A 3 px line under the existing row text, only while the run is live, in the P4 colour, plus the P5 text in the row's status line. Finished rows are unchanged. |
| P8 | **Chains.** A run that waits for or follows another ("Run after", `after` + `afterPolicy`) belongs to a chain. The chain is one row in the run list, titled by its first run, with "Run 2 of 3 · Build", one overall line, and an expander listing its runs (✓ done with its PR if any, ● current, ○ waiting). The run page of any chain member shows an **overall** bar above the run bar: one equal part per run, finished parts green, the current part filling with that run's progress. A single run has no overall bar. |
| P9 | **The Chat run card** (`ui/public/chat/run-card.mjs`) shows the same bar and text, compact. |
| P10 | **No flag.** It replaces the step text in place and changes no behaviour. The interface mode is respected: the bar and the stage text are Simple; the hover breakdown (P11) is Advanced. |
| P11 | **Hover detail.** Hovering the bar lists the stages with their agents and states (done, current, waiting), and the review pass count. No times. |
| P12 | **Supersedes the node-graph v2 "no progress bar" rule (D15).** That rule existed because a bar over graph nodes moves backwards in loops and reads as a promise. P2, P3 and P6 address both: stages, not nodes; monotonic; no time. `progressText` ("3/6 done") is replaced by the P5 text. |

## 3. Code

| File | Change |
|---|---|
| `agents/*.meta.json`, `src/shared/graph/agent-meta.mjs` | `progressStage` (validated, optional) |
| `src/shared/run-progress.mjs` (new) | Pure: `runProgress(state) → { stage, fraction, text, tone, stages[] }` from the graph, node states, decomposition task counts, review passes, pending question and status. Keeps the monotonic maximum in the state it is given. Shared by the server and the client. |
| `ui/public/app.js` | `runDecorFor` exposes `progress` from `runProgress`; the run header paints the bar and text where "Step: …" is (`paintRdHeader`); the run list rows (`histStatusMeta` / `runStatusMeta`) get the thin line; chain grouping in the run list; the overall bar on chain members |
| `src/core/scheduler.mjs` | A read helper for a run's chain (first run, members in order, each one's state), built on the existing `after` links (`predecessorState`, chain walk) |
| `ui/server.mjs` | The chain summary on the runs list payload |
| `ui/public/chat/run-card.mjs` | The compact bar |
| `ui/public/style.css` | Bar, thin line, colours from the existing families, transition, light and dark |
| `docs/ui-levels.md` | Catalogue entries (P10) |

## 4. Tests

- `runProgress`: each shipped workflow (Default, Auto's recipes, Shape it first if present) maps to
  the four stages; a custom graph without `progressStage` uses P6; Build fraction from task counts;
  a review loop never lowers the fraction; a pending question gives amber; End gives Ready.
- Run page: the bar and text replace "Step: …"; amber on a question; green on done; red unchanged.
- Run list: a live row has the thin line; a finished row has none; a chain of three is one row with
  "Run 2 of 3" and expands to its runs.
- Chain overall bar: equal parts, finished green, current filling; absent for a single run.
- Chat run card shows the compact bar.
- Interface mode: the bar shows in Simple; the hover detail only from Advanced.
- Dark and light screenshots in the PR.

## 5. Out of scope

ETA and cost forecasts (dropped: not accurate enough to show). Slice-specific wording ("Slice 2 of
3"): Plan in slices (#707, slice 4) reuses the chain view and only renames it.
