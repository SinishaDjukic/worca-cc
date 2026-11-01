---
name: composer-attack-recipe
description: Fuzz, base-vs-branch differential and one-shot real-Chrome probes for Composer selection and gesture work, plus the harness traps that give false reds.
paths: ui/public/graph/composer.mjs, ui/public/graph/view.mjs, ui/public/workflows/shell.mjs, src/shared/graph/sessions.mjs, src/shared/graph/canvas-ops.mjs
updated: 2026-11-01T18:07:17.552Z
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

## A probe module instead of a splice (1 to 5 s a run, the base too)
Splice into both a clone and a `git archive <checkpoint>` copy, right after `try {\n  await load(true);\n`: `if (process.env.PROBE_FILE) { await (await import(process.env.PROBE_FILE)).default({ ev, cdp, settle, press, mmove, mup, pumped, log, sleep, keyEv, load, errors }); await shutdown(0); }`. Every earlier check is skipped, and one probe file runs on both trees, so "same at the base?" takes one more command. `Input.dispatchMouseEvent` takes `modifiers` and `pointerType: 'pen'`. A real-input fuzz in that hook (Shift+click, drag, keys held mid-press, Delete, undo, redo, Combine) does about 280 actions in 25 s.

False reds that looked like bugs (2026-11-01):
- **A screenshot right after a selection change shows cards blank** (tray and picked cards empty, only wires). The first frame after a `.sel` toggle catches the backdrop blur; the file is visibly smaller (45 KB against 88 KB). The base does the same on a plain click. Wait 1 s and `settle` before judging a picture.
- **`conn-banner` lands about 3.1 s after load** and moves the stage 45 px, so a rect saved before it differs from one after it even though nothing moved. `sleep(3200)` before any before/after comparison of screen rects.
- **The `+` menu opens upward over the lower-left of the stage.** A press there lands on the menu, and a re-seed does not close it, so the next `click` hits a menu item. Seed cards high in the stage, or log `elementFromPoint` first.
- The zoom label stays stale after `v.setTransform`; that does not fire `onZoom`.

## Fuzz runner
`node fuzz.mjs $r` with `r="1 1500 40"` passes one zsh word: the seeds parse as NaN and it prints `failures:0` with `actions:0`. Read the counters, not `failures`, and use `${=r}` or literal arguments.

## Mutant traps
- `const isAgent = (id) => g.byId.get(id)?.kind === 'agent';` appears twice in `sessions.mjs`, and the first is in `sessionCandidates`. Anchor on the line before it. Have the runner warn when an anchor matches more than once.
- Run mutants in one clone and the fuzz in another, because the fuzz imports the mutated files.
- A regex for `hang` also matches test names containing "change". Compare the exact status.
