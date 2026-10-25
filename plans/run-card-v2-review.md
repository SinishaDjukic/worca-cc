# Run card v2: five-way design review

Reviewed on 2026-10-25 against the mock in `plans/mocks/run-card-stepper.html` (model `run-card-model.js`) and the
"Run card redesign" canvas. Five independent reviewers, each given the screenshots, the mock's code and
`docs/design-system.md`, not each other's views: a UX/UI designer, a customer (a tech lead running 5–15 runs a day),
the developer who would build it, a competitive analyst (with sources) and a QA engineer (with Playwright scripts
against the mock).

**Verdict.** All five back the direction: one state word and one step-aware action, the stepper with step durations
and loop counts, the stacked-PR merge order, cost per step and the four tabs. None of them would build it as it is.
Trust (numbers that agree, failures that explain themselves), keyboard and live-update behaviour, and a few breaks of
our own design rules come first.

Already fixed during the review: the detail line printed `[object Object]` in every state (a key clash in the model),
the phone Runs tab wrapped one word per line, and two highlights used a 2px radius instead of a token.

## Status after the review round (2026-10-25, mock and canvas)

| P0 | State |
|---|---|
| 1 Numbers agree | Done: steps add up to the card total, Changes count = files, PR sizes add up to the diff |
| 2 Rebuild loses focus, fade replays | Done in the mock: focus kept or moved on every action, fade only when a stage opens. The real build still has to patch nodes in place |
| 3 Tabs and menus by keyboard | Done: both tab rows are tablists (arrows, Home, End, one Tab stop, wired panels); menus take arrows, Escape and Tab return focus |
| 4 Colour rules | Done: finished cells use `--seq`, review is a hollow cell, checks running shows a working dot, Approved reads Ready to merge. Paused keeps the app's slate dot colour |
| 5 Stop and ⋯ | Done: the page bar shows Pause and Stop while the run's own work is unfinished, ⋯ always |
| 6 Ship choice | Done: a radio group; "What it opens" is not folded yet |
| 7 Light contrast, reduced motion | Done: "8s ago" 6.6:1, the review word 5.9:1; the step-link scroll respects reduced motion |
| 8 320px and 200% zoom | Done: no sideways scroll in any case or tab at 320, 375, 900px or 200% zoom |
| 9 design-system.md | Open: the rule changes ship with the implementation (enrollment plan, phase 1 slice 4) |
| 10 Escaping | Done in the mock; required again in the build |

P1 done: failure evidence in Activity, cost against the budget and the diff size as card figures, Away-mode cost in
Decisions, cost per step only in Activity, the One PR reason corrected. Open: answer in place, Away mark on the card,
"Merge all in order when green". Verified by Playwright on every case and tab (`plans/mocks/run-card-stepper.html`).

## P0: before anything is built

| # | Finding | Raised by | Fix |
|---|---|---|---|
| 1 | Numbers disagree (Changes 14 vs 5 files listed, the live step at $0.00, "1,200 lines" with no source). Users compare them with their bill. | Customer, Competition | Every figure comes from one source per fact; sample data made consistent; cost of the live step shown as "so far" |
| 2 | Every click rebuilds the card: keyboard focus drops to the page, the step list replays its fade, live frames would flicker. | QA, Developer | Patch nodes in place (as `paintRunStatus` and `keepUnchanged` do); no entry animation on repaint; fixed height for the live line |
| 3 | The two tab rows are not real tabs: no arrow keys, no roving tab stop, no `aria-controls`, no labelled panel. Menus cannot be used from the keyboard; Escape does not return focus. | QA, UX | Follow design-system Tabs and Menu: roving tabindex, ←/→/Home/End, focus moves into menus and back to the trigger |
| 4 | Colour rules broken: blue and slate used as bar fills; done cells (`--ink-2`) outshine the live cell; "Checks running" shows a green dot (done) next to a peach bar. | UX, QA | Done cells muted; paused grey like its dot; no review colour on the bar; the headline dot follows the live step; Approved gets its own word ("Ready to merge") |
| 5 | Stop and ⋯ are gone from a Working run; Paused hides Stop in ▾. | UX | Keep the shared head: Stop and ⋯ on the title row. The split button holds only next steps |
| 6 | The ship choice is pick-one but draws checkboxes, says its reason three times and pushes the figures down ~400px. | UX | Radio marks in a `radiogroup`, one reason line, "What it opens" folded |
| 7 | Contrast in light: "8s ago" 2.80:1, the review word 4.27:1 at 12px. Smooth scroll ignores reduced motion. | QA | Use `--ink-2` / the `-ink-strong` shades; instant scroll under reduced motion |
| 8 | At 320px and 200% zoom, step names in Activity shrink to 0px and the row scrolls sideways; stage labels cut to "Revi…". | QA | Name keeps a minimum width; meta wraps under it on narrow cards |
| 9 | The design system was changed without being updated: the Route section, the facts block and stat tiles are gone. | UX, Developer | Rewrite Route, Card head, Patterns and Tabs in `docs/design-system.md` in the same change, or keep the route |
| 10 | Unescaped values in the renderer (figures, stage labels, start time). | QA | Escape every user string in the real build |

## P1: product gaps the card should close

1. **Failures and pauses that explain themselves.** "Tests failed 3 times" is not enough: show the failing test, the
   last 3–5 error lines, a jump to the failing log line, who or what paused it, and "Resume with a note to the agent".
   (Customer, Competition)
2. **Answer the run's own questions in place.** Show a question's options on the card, with Answer as the submit,
   instead of a click that opens them. The competition and customer reviews also asked for steering a run mid-way
   ("Tell Worca…"), as Copilot, Jules and Devin do. **Not adopted:** a Worca run is dispatched with a fixed workflow
   and runs to its end; talking to Worca is Chat's job, not the run page's. That is a deliberate difference from those
   tools, not a gap. Pause and Stop already sit in the page bar.
3. **Cost guardrails.** Show spend against a budget or a finish estimate ("$84 of $120") with a warning near the limit,
   and bring back the Away-mode share the old card had. Keep the rate as a secondary figure: it under-reports while the
   live step's cost is still arriving. (Customer, Competition)
4. **Size on the card.** "+358 −144 · 5 files" next to the figures, and each PR's own size in the stack, so a person can
   judge reviewability before Create PR. (Customer, Competition)
5. **Away mode is invisible on the card.** An answer given for you shows only in Decisions; the card needs a mark.
   (QA, Customer)
6. **Stack finishing.** "Merge all in order when green" beside "Merge PR 1 of 3" (as Graphite and GitHub do), and who
   approved on each PR row. (Competition, Customer)
7. **Say each thing once, in the tabs too.** Cost by step sits in Summary and in Activity: keep it in Activity, and show
   the total with a link in Summary. (Competition, Customer)
8. **The "One PR not possible" reason is wrong.** Runs that build on each other overlap by design and still combine on
   one branch. One PR is blocked when runs do not build on each other and their changes conflict. Rewrite the rule and
   its text. (Customer)

## P2: states to decide before build (QA)

Loop back (Review sends work back to Build: does the cursor move left, cells reset, a stage counter?); a question while
paused, during PR, and a failure inside PR (which word, dot and action win); PR closed without merge, checks re-run
after a push, approval dismissed by a new commit; a partly merged stack (PR 1 merged, PR 2 in conflict after rebase);
One PR chosen, then a run added; two live stages at once (workspace); stale live data (a WebSocket drop, reconnect,
clock skew, live → finished without reload); scale (0 or 12+ steps, 6+ runs or repos, 10h+ and $1,000+, 999 files);
runs with no branch; RTL; what drops at 320px and 200% zoom.

## Build scope (Developer)

- **Data:** stages with steps, time, loops, cost per step, PR checks and the stack chain exist today
  (`src/shared/run-progress.mjs`, `pipeline_steps`, `prVerdictOf`, `stackedPrBaseOf`). Partial: the live line (only
  script steps today), the model actually used per step (only the configured one), the reviewer count. Missing: the
  One PR vs Stacked recommendation (the `git merge-tree` check in `git-sync.mjs` can be reused).
- **Fallbacks:** workflows with no stage tags and Auto runs still choosing a workflow need a flat step list, or the card
  is empty. Chains have no Plan stage.
- **Where to cut:** branch on the flag in `paintRunHead`, the group head and `initRdTabs` / `initHdTabs`; keep the chat
  run card on v1. v1 and v2 read their actions from the same `headModel`, so they never offer different buttons.
- **Tabs:** old tab links need aliases (diff → changes; workflow, logs, agents → activity; qa → decisions; artifacts →
  summary), and the four tabs drop today's per-level gating, so `docs/ui-levels.md` needs a decision first.
- **Estimate:** core v2 behind the flag about 4 weeks (card and stepper 7–9 days, tabs 5–7, group page and stack card
  5–6, flag, tests and docs 3–4). New actions as separate slices outside the design flag: Fix checks 1–2 days, the
  recommendation 3, Merge PR 4–6, Resume from a stage 8–12 (about 7 weeks for everything). Until then: a link to GitHub
  instead of Merge PR, and "Start a new run" instead of Resume from Build.

## Acceptance tests for the build (QA)

Flag off: today's run page and route unchanged, every run kind. Flag on: all cases render with no console errors in
both themes; no sideways scroll at 320, 375 and 768px or at 200% zoom; both tab rows behave as tabs; focus kept or moved
after every action; menus usable from the keyboard with destructive items `is-danger`; contrast 4.5:1 text and 3:1
cells and dots; no motion under reduced motion; "x ago" ticks and a dropped connection shows stale then recovers; the
scripted state sequences above; every user string escaped and truncated with a tooltip; `test/ui-design-language.test.mjs`,
the button audit and the `docs/INDEX.md` rows pass.

## Where v2 is ahead

Cost per step with the model used (others show tokens or credits), advice on One PR vs Stacked with its reason, loop
counts on each step, "To check" for the person, and Decisions as an audit trail. The 20px rail does align every row,
the state word never truncates, the menu help lines read plainly, and the chain's "Merge in order" list is the clearest
stacked-PR view of the iterations so far.
