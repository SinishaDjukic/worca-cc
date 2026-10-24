---
name: promo-scene-build-traps
description: Read in any Promo video workflow step (sandbox, capture, mascot, scenes, review) — offline seeding, plate capture, kit/rig traps, review rulings
paths: assets/promo-kit/**, agents/worca-cc-promo-*.md, promo/**
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

## Sandbox: filming worca with no model call
- Driver: `node --disable-warning=ExperimentalWarning --input-type=module -e <driver>`, cwd repo, HOME=USERPROFILE=WORCA_HOME=`{home}`. Import `ui/server.mjs` in-process (no boot sweep, scheduler never ticks), `WORCA_MOCK=1` + no-real-claude stub on PATH/`WORCA_CLAUDE_BIN`; seed via the HTTP API, answer 503 to all else until done (`server.removeAllListeners('request')` + a gate re-calling saved handlers); write `{home}/promo-demo.json` with every id. Extend run 921af2bf's `promo/runbook.json` driver. Windows caps a command line at 32 767 chars: minify.
- Diff: in `executor.mjs` `_testing.runClaude`, after `await runClaude(o)` for `implementer`, replace the mock's two files in `o.cwd`; register by `pipelineId` after the clarify question, before answering. The Diff tab (worktree vs start commit) freezes at done; open a file via `button.hd-diff-file[data-path]`.
- Comment: `POST /api/history/<key>/<pid>/comments {path, side:'new', line, body}`; backdate `diff_comments.created_at`.
- PR offline: `git-info.mjs` `_testing.setRunner` answering `gh --version`, `gh pr list … --head` (`[]` = Ready to ship; `[{number,state:'OPEN',url}]` = In review), `gh pr view` (+ `mergeable, mergeStateStatus, reviewDecision, isDraft, statusCheckRollup`); delegate the rest to `_testing.defaultRun`; plus a refusing `gh` first on PATH and `GIT_ALLOW_PROTOCOL=file`. Ship it? needs no remote.
- Review text: reviewer cycle 1, after `runClaude(o)` overwrite the `MOCK_JSON:`/`MOCK_OUT:` files named in `o.prompt`. Live runs: hold `runClaude` by `MOCK_ROLE:`/`MOCK_CYCLE:` + the 8-hex `pipelineId` in `o.cwd`; await `o.signal` so Stop works.
- Proposal card: `validateProposal({projectKey, workflowId:'wf_default', guardrailsId:'normal', title, note, brief}, {cardId})`, append `{kind:'card', id, state:'proposed', card:r.card}` to `createThread()`, route `#chat/<tid>`; seed `uiLevel:'advanced'` (Expert adds a ~400 px lane).
- Composer: a `workflow-build` card needs no sessionId/docToken (`createThread({mode:'composer'})`, `localStorage['worca-cc.composer.thread']`, reload `#workflows`). Apply to canvas works ONCE per sandbox: shoot card and graph right after the click.
- Away: `nightMode:{minConfidence:75}`, start with `nightMode:true`, reword `pendingQuestion` in place, `POST /api/run/night {mode:'on'}`. Replace the mock rationale in `night_decisions.record` AND `runs.get(id).events[night-decision].record`, keyed by the `question_id` COLUMN; fail on 0 patched; set `steps[n_clarify].auxCosts.away`. Set `nightMode.window` only after answering (active hours answer first).
- Schedule dates show only in the card's Edit editor (`.sched-sentence`; `.sched-tz` prints the host zone). Run-page questions arrive with Recommended preselected. A scheduled `POST /api/run` returns the ticket id as `runId`. Mock mode shows `#side-mock-pill`, mock sub-agents and temp paths: keep them out of plates.

## Capturing plates (kit `capture/lib.mjs`)
- Playwright trims a clip to the VIEWPORT silently: size the window per plate (run page 1600x1800, canvas 2160x480 + Fit, run graph 2600x1100); pad <= 8 at window edges (Composer dock: 20).
- `#promo-isolate` survives hash routes: `unisolate(page)` before each navigation. Hidden screens keep 0x0 stale copies: measure visible matches, pass an explicit `clip`. `.gv-world` is 0x0: clip the union of `.node, .nlabel, .wbadge, path[data-wire-id]`; toolbars sit outside `#wfv-canvas`; loop wires carry `.loop`; ports are `.prow[data-port][data-dir] > i`. "Mark this run" sits in the closed `<details id="advanced-config">` (click its `summary`). Below ~1100 px the sidebar collapses.

## Mascot rig (`film/mascot.js`)
- Props go on the nose tip: `sign-q`/`flag` (head) and `clipboard`/`blueprint` (side) need `attach:'nose', upright:true` (+`wobble:1`). A hanging clipboard dips below ground in `write`/`stamp`: grip `[9.7,-21.5]`, `scale:0.9`, smaller nod/strike; check a full-res mid-strike frame.
- Dark body: `shade()` mixes toward clay brown and four face strokes are hard-coded `#141416`: per-variant clay overrides + a light feature ink. An asymmetric body mark mirrors facing left: counter-flip it in `render()`.
- `promo/film/mascot-demo.html` hard-codes variant names: use `Mascot.variants` + `VARIANT_ALIAS`; end the last pop >= 0.3 s before scene end. Snap the copy in `promo/film/` (kit `film/` lacks `vendor/`); `--cues out.json` on it = rig regression check. Keep re-skin hooks: variant `pose:{lidT}`, combo props via `equip(…, allow=[combo])`.

## Scenes (`promo/film/scenes/<id>.js`)
- `S.camera.frame(at, plate.anchor(n))` is off by w/2,h/2 (anchor = centre, frame wants top-left): `anchor(n,0,0)` or `S.camera.to` with the centre.
- clip-path px to % jumps open (GSAP takes the end unit): px at both ends, then `'none'`. `m.el` sits at world (0,0): use `m.scale()`. `S.mascot()` spreads opts after its `cue`: override SFX gains via a `cue` wrapper.
- Camera dive into a mascot point: set `S.world.style.transform` in `S.onFrame` from `m.anchor('logo', t)` with log-interpolated zoom; morph the next plate in `S.overlay` on the same zoom.
- Chapter card is gone at local 2.0 but narration starts at 1.2: when the first word names a feature use `S.chapter(0,{dur:0.8})` and start the plate under the card 0.12-0.4 s before the word (`power3.in` is quartic).
- `plate.show(at, state)` crossfades double-print text when layouts differ: hard-cut `show(at, state, 0)` INSIDE a camera move (0.03 still renders a 50/50 frame; a 0 cut on a still camera pops). A click ring after a 0 cut lands on whatever the new state put under the cursor.
- `attention()` and default `hop`/`bounce` landings pop at close zoom: `expr('surprised')` + `m.scale`, `land:`. Rings scale in <= 1.1, ~6 px off glyphs, parented to `plate.el`.
- Hide another run's numbers with two clipped plate instances (`clipPath = 'inset(… round 17px)'`), each in a zero-size wrapper carrying the drop-shadow. Slide exits show only an edge strip of the last frame.
- Tiny UI text needs plate x camera ~3.3 for >= 22 px. Hash frames at `--scale 1`; sub-pixel noise after a deeper zoom is no state leak. Fluency `--from start` flags the cut: use `start + 1/60`. Wrap each scene in an IIFE. No PNG lib: a ~25-line zlib IDAT decoder traces wire colours. Fan-out drafters each work in a mkdtemp copy (film copied, plates symlinked) and snap/fluency their own scenes.

## Review
- Frame list from `promo/timeline.json` (`words[].t0` is relative to `vo.<id>.start`; repeated words need an nth pick): line starts, synced words +-0.5, scene start/mid/end, a 0.5 s grid over changed scenes; one `snap --times … --scale 1` dir + index per scene group. Start fluency in the background first.
- Never rule on +-0.5 s sync from a 0.5 s grid: render `w+0.03,+0.1,+0.2,+0.3` and read them yourself.
- "Under ~20 px" = rendered font size, not cap height; grey meta (~3:1) at >= 24 px is legible.
- Fluency misses ~0.1 s crossfades and zoom pumps: probe every plate hand-off at 0.03-0.05 s steps.
- Cross-run continuity is a defect class (demo runs differ): check tiles, counts, cost across shots narration ties together; fix by framing, not recapture.
- Scene files older than the previous `promo-review-cycle<N>.md` render the same: carry old minors forward.
- Inspectors: 60-80 frames each, one note line per frame, sizes from crops; unchanged scenes need only line starts, @word/+0.3, start/mid/end (sonnet); probe what they could not confirm yourself; wait with a foreground `node -e 'setTimeout(()=>{},120000)'`.
- Mascot noses reading as arms = minor (a major burns a capped fix cycle the scenes step cannot fix).
