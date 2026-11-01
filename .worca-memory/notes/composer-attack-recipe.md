---
name: composer-attack-recipe
description: Fuzz, base-vs-branch differential and one-shot real-Chrome probes for Composer selection and gesture work, plus the harness traps that give false reds.
paths: ui/public/graph/composer.mjs, ui/public/graph/view.mjs, ui/public/workflows/shell.mjs, src/shared/graph/sessions.mjs, src/shared/graph/canvas-ops.mjs
updated: 2026-11-01T16:42:01.637Z
author: Denislav Prinov
---

Recipes that found real gaps cheaply on the Shift+click picks work (2026-11-01). Mutant and fuzz runs are fast: the seven session test files take about 1.6 s through `tools/test.mjs`, so 200 mutants fit in 5 minutes.

## Seeded fuzz over the real Composer
Copy `bootShell` from `test/helpers/workflows-shell.mjs` into a probe under `.worca-cc-test/` so the toolbar runs, and extend the fixture's `portsFn` (`or` and `combine` have no outputs there). At rest, add a JSON snapshot of the template to a `seen` set. At the end of each run, undo to depth 0 and redo back, checking each state is in `seen`.

False reds to expect:
- `UNDO_LIMIT` is 50. A depth check on a long run reds at the cap, so guard it with `d0 < 50`.
- A plain card drag or a strip drag with a commit key held is a listed base bug. Skip those keys unless the press is on picks.
- A toolbar painted with the flag off holds no flagged button until the next paint. The fuzz has to repaint when it flips the flag on.
- `state in seen` alone misses a drag that loses its rewind: undo then lands on the final position, which was also at rest. Also assert that undo right after one press equals the snapshot from before that press.

## Base-vs-branch differential
Export the base with `git archive <checkpoint> | tar -x -C <dir>` and symlink `node_modules`. Import both composers by path and drive the same action stream through both. Seed `Math.random` before every call on each side, because `mintId` uses it. Run with the flag off plus Shift, and with the flag on and no Shift. This proves "flag off behaves exactly as before" without pinning the base's own bugs in a test. Allow only stated wording changes in the comparison.

## Real-Chrome focus probes in 15 s
`:focus-visible` is not visible in jsdom. In a scratch clone, splice a block into `tools/verify-composer-cdp.mjs` right after `check(21, …)`, where `mid`, `shiftClick` and `press` are in scope. Log the results with `log(JSON.stringify(out))`, then run `env -u WORCA_HOST_PID HOME=<tmp> CDP_PORT=94xx node --disable-warning=ExperimentalWarning tools/verify-composer-cdp.mjs`.

Seen in real Chrome: a refused Shift+click does not move the focus (`preventDefault` on pointerdown holds it), and an `aria-disabled` toolbar button still takes it.

## Mutant traps
- `const isAgent = (id) => g.byId.get(id)?.kind === 'agent';` appears twice in `sessions.mjs`, and the first is in `sessionCandidates`. Anchor on the line before it. Have the runner warn when an anchor matches more than once.
- Run mutants in one clone and the fuzz in another, because the fuzz imports the mutated files.
- A regex for `hang` also matches test names containing "change". Compare the exact status.
