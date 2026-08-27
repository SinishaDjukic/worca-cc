# Agent C — Composer canvas engine (normative design, 2026-08-26)

VERDICT: DOM cards + ONE SVG wire layer (ghost in that same layer) inside a single transformed `.gv-world`; one pointer target (the stage) with capture; rAF-coalesced frames; model-driven hit-testing; zero rect reads on the move path; geometry constants injected into CSS; one renderer with `edit | monitor | static` flags.

## 1. Rendering substrate
Cards = `div.node` (absolute, `transform: translate(x,y)`); wires = `<path>` in ONE `<svg class="gv-wires" width=1 height=1>` with overflow:visible + pointer-events:none; both children of `.gv-world` carrying the only pan/zoom transform (`translate(tx,ty) scale(z)`, transform-origin:0 0, will-change:transform).
Rejected: all-SVG (loses native text layout/ellipsis, footer rows = foreignObject hack, focus/aria extra work — cards must be focusable tabindex=0 + aria-label); canvas2d (no DOM, no jsdom, no a11y). Hit-testing model-driven (hitPort r14 → hitNode → hitWire 48-sample cubic at 6px) from world coords — never elementFromPoint. Thumbnails = the one all-SVG surface: thumbnail(template, portsFn) from the SAME geometry module.

## 2. Pointer pipeline
```
.gv-head   (header bar: name, Auto-layout, Save, unsaved marker)   ← OUTSIDE the canvas host
.gv-canvas (dot grid, overflow:hidden, position:relative, touch-action:none, user-select:none)
  .gv-stage (absolute inset:0, tabindex=0)  ← THE pointer target; carries capture
    .gv-world (transform) → svg.gv-wires (paths + ghost) + div.node×N + div.wbadge×N
  .gv-chip  (sibling of the stage, pointer-events:none)
  .gv-ins-rail (floating inspector, sibling of the stage, z-index above it)
```
Header bar + inspector are SIBLINGS of the stage, so pointerdown on their buttons never reaches onDown; capture can never retarget their click.
Listeners (bound in mount(), removed in destroy()): stage pointerdown/pointermove/pointerup/pointercancel/lostpointercapture (if gesture → cancel); window blur → cancel (+ space=false); document keydown/keyup (Escape → cancel; isTyping guard BEFORE any key handling); stage wheel {passive:false}.
onDown: reject if gesture live or button ∉ {0,1}; ONE readRect() (cache stage rect); pt = toWorld(clientX, clientY); classify: middle or space ⇒ pan; hitPort ⇒ wire gesture (ghost shown, one write); hitNode ⇒ node gesture (grab offset, start pos for cancel-revert, moved=false); hitWire ⇒ select wire; else pan + clear selection. Then try { stage.setPointerCapture(pointerId) } catch {} (synthetic ids throw; jsdom lacks it) + preventDefault().
onMove: `pend = {clientX, clientY}; if (!raf) raf = requestAnimationFrame(frame)`. NOTHING else.
frame() (≤1 per animation frame): pan → T.x/T.y + applyT() (one style write); node → nx = snap(pt.x − grab.dx); if unchanged return; update model, placeCard (one transform write), paintWire for incident.get(id) ONLY (d-cache prevents identical writes); wire → target = hitPortAt(pt, origin), verdict = canWire(...) (Map lookup on wired-input set + type check — no classifyLoops), one ghost d write + class, chip show/hide.
onUp: cancel pending rAF, run frame() once with the up position; commit: wire drop → commit() if legal; node drag → one undo entry if moved; finish() = clear gesture/pend/raf, hide ghost+chip, releasePointerCapture (guarded by hasPointerCapture). cancel() reverts moved node to start, hides ghost, finish().
Validation + classifyLoops run once per committed mutation inside commit(label, mutate) (push undo → mutate → dirty → targeted render → scheduleValidate() via setTimeout(0) collapsed). Never per frame.
Rect cache refresh: ResizeObserver(stage) (guarded), window resize, document scroll {capture:true, passive:true}, + one read at gesture start and at fit(). Zero reads per move.

## 3. Ghost cord
Permanent `<path class="wire ghost">` appended LAST in svg.gv-wires; committed wires inserted BEFORE it. Class `on` shows; `legal` (green solid) / `illegal` (red) / none (neutral --ink-3 dashed 5 4).
`fill:none` is a rule on the layer's element selector: `.gv-wires path { fill:none; stroke:var(--seq); stroke-width:2 }` → blob structurally impossible.
Bezier bezierPath(a, b, {mirror, loop}), dx = clamp(48, 160, 0.45·|b.x − a.x|):
- forward: `M a C (a.x+dx, a.y) (b.x−dx, b.y) b`
- mirrored (drag started on INPUT port; cord leaves leftward): `C (a.x−dx, a.y) (b.x+dx, b.y)`
- loop (committed loop wires): both control points at y + bow, bow = 56 + 0.2·|a.y − b.y|.
Committed wires normalised output→input on commit; only the ghost uses mirror.
Snapping: hovered legal port → ghost end = port anchor; else cursor. Reason chip `.gv-chip` positioned in stage px via world→screen `s = w·z + t` (+14px), never a rect read; text from canWire reason ("already connected" V7, "json → md type mismatch", "same node", V8 homogeneity for OR). Hover target row `.drop-ok` (1.35× dot, green ring) / `.drop-bad` (red ring).

## 4. Wheel, zoom, pan, fit, keyboard
Transform math: screen = world·z + t; world = (screen − t)/z; screen = client − rect.leftTop. Zoom about stage point s: t' = s − (s − t)·z'/z.
wheel {passive:false} + preventDefault. deltaMode 1 ⇒ ×16, 2 ⇒ ×rect.height. Plain/two-finger ⇒ pan t −= (dX, dY). ctrlKey||metaKey (pinch sets ctrlKey) ⇒ z' = clamp(z·exp(−dY·0.002), 0.4, 1.6) about cursor. No rounding of z (display rounds).
Pan: space+drag (.gv-stage.space cursor grab), middle-drag, drag on empty canvas. NO on-canvas buttons ever; legend moves to the palette card header row (revisable); Auto-layout in header bar.
Auto-fit: fit({insetRight, pad:60}) from MODEL bounds (nodeSize boxes) into band vw = rect.width − insetRight (280 expanded inspector, 28 collapsed — constants), z = clamp(min(vw/b.w, vh/b.h), 0.4, 1) (FIT CAPS AT 1), t = ((vw − b.w·z)/2 − b.x·z, (vh − b.h·z)/2 − b.y·z). Runs on view entry/re-entry and template load only; never after edits. tpl.canvas viewport persistence dropped.
Keyboard: bound in mount(), unbound in destroy(). showView on dev has no exit hook — add leave-guard at top of showView (ui/public/app.js:15318-15355 pattern: `if (currentShownView === 'composer' && name !== 'composer') composerExit()`); initComposer() (app.js:1991, called from :15416) becomes mount-once + fit() on re-entry. Keys: Delete/Backspace, arrows nudge 11px, ⌘/Ctrl+Z, ⇧⌘Z, Escape, Space (pan modifier, preventDefault). Ignored while isTyping (INPUT/TEXTAREA/SELECT/contentEditable).

## 5. Geometry single source of truth
graph-geometry.mjs frozen constants: NODE_W 220, HEAD_H 34, ROW_H 24, SEP_H 9, PAD_T 8.5, PAD_B 8, BORDER 1.5, DOT 10, FOOT_H 26, EXEC_ROW_H 22, SNAP 11, PORT_HIT_R 14, WIRE_HIT_TOL 6, ZOOM_MIN .4, ZOOM_MAX 1.6, ZOOM_K .002; injectGeometry(stageEl) writes --gv-node-w … --gv-exec-row-h (px) at mount. CSS uses only the variables: .nhead{height:var(--gv-head-h)}, .prow{height:var(--gv-row-h)}, .psep{height:var(--gv-sep-h)}, dot top:calc((var(--gv-row-h) − var(--gv-dot))/2) (=7), left:calc(−1·(var(--gv-dot)/2 + var(--gv-border))) (=−6.5 ⇒ dot centre exactly on node.x). Card height explicit px from nodeSize, width from the variable.
Zones top→bottom, each only when non-empty, separator only BETWEEN emitted zones: inputs → outputs → await (agent only) → caption (task/end/or). ROW0 = BORDER + HEAD_H + PAD_T + ROW_H/2 = 56.
nodeSize(node, ports, {footerRows}) = 2·BORDER + HEAD_H + PAD_T + rows·24 + seps·9 + PAD_B + footer; footer = rows ? FOOT_H + (rows−1)·EXEC_ROW_H : 0. Agent(nIn,nOut) = 95.5 + 24(nIn+nOut); Task/End = 110.5; AND/OR arity N = 3+34+8.5+(N+1)·24+9+8 (+9+24 caption for OR).
Anchors (left edge x, right edge x+220): input i y+56+24i; output j y+65+24·nIn+24j (nIn = META inputs; Task nIn=0 ⇒ y+56+24j); await y+74+24(nIn+nOut); AND/OR/Combine inK y+56+24(K−1), out y+65+24N; End result (x, y+56); Task task (x+220, y+56).
Executions footer: bottom-most box ⇒ anchors top-relative, UNCHANGED when it expands; only height, hit box, fit bounds change. No re-route, no pushing other cards (overlap accepted; auto-layout 40px gap makes it rare). run-decor never sets height — passes footerRows into view.setFooter(nodeId, rows) → nodeSize.

## 6. Incremental view model
createGraphView(host, {mode, portsFn, agents}) keeps nodeEls, wireEls, badgeEls Maps by id, incident: Map<nodeId, Set<wireId>>, dCache: Map<wireId, d>.
render(template, {selection, report, decor}) diffs by id: create missing, remove stale, placeCard (transform), re-paint a card's rows only when its port signature changed (sig = kind|key|portIds|types|when|arity|orType|awaitWired), header only when cls|title|icon changed. Selection/hover/status/bad are classList toggles; pips/badges single-child add/remove.
Fast paths bypassing render: moveNode(id), setGhost(d, cls), setTransform, setSelection, setStatus(nodeId, status), setFooter(nodeId, rows), setWireLive(ids). paintWire writes d only when cached string differs. Loop badges at cubic midpoint (p0+3p1+3p2+p3)/8.

## 7. Modes
edit: everything + palette, inspector, undo, validation. monitor (.rd-graph/.hd-graph, index.html:494,654): pan/zoom/fit, footer expand/collapse + row click (delegated click on .xrow → log filter), no node/wire gestures (pointerdown on card = pan), no keyboard mutation keys, live decor via fast paths. static (Running list card Detailed, index.html:430; saved-pipeline previews): NO listeners at all; fitToWidth(host.clientWidth) once per paint and on ResizeObserver; whole card click → detail is the card's own handler; cards pointer-events:none.

## 8. Palette — click AND drag-to-spawn
Click = spawn(entry, freeSlot(centerWorld())) (24-try diagonal de-stacker). Drag-to-spawn (~60 LOC): pointerdown on .ap pill → capture on the pill → after 4px create fixed-position .gv-drag-ghost (mini card from clientX/Y) → pointerup: inside cached stage rect minus inspector inset ⇒ commit('add', spawn(entry, snap(toWorld(...)))) else cancel; pointercancel/Escape/blur cancel. <4px = click. Task/End pills disabled once placed.

## 9. Floating inspector
.gv-ins-rail absolute over canvas right edge (280px / 28px collapsed, data-inspector on .gv-body, persisted under `worca.composer.inspector`), z above stage and chip; never changes canvas size; fit subtracts expanded width. Contents: agent = model/effort selects, fanOut toggle (iff meta.fanOut), askQuestions (absent/forced per meta), awaitAll, read-only port list; AND/OR = arity stepper (OR shows resolved out type); Combine = arity; loop wire = maxCycles; Task/End informational; run mode End = result chip. Every field change → commit() → undo push → targeted render.

## 10. Undo, dirty, save gating
Undo ring: structural snapshots {nodes, wires} JSON, cap 50, redo cleared on push; drag = one entry; dirty = hash(snapshot) !== savedHash. Validation report (V1–V21 via shared) once per commit: errors ⇒ Save disabled + "N errors" chip in header + red pips + bad wires; toast/pip click ⇒ centerOn(nodeId) (transform write). Server 422 authoritative.

## 11. Test strategy
(a) jsdom 29.1.1: PointerEvent exists (lib/jsdom/living/interfaces.js:178) — dispatch `new win.PointerEvent('pointerdown', {pointerId:1, button:0, clientX, clientY, bubbles:true})`; WheelEvent exists. setPointerCapture/hasPointerCapture DO NOT exist — optional-chained, try-wrapped. ResizeObserver absent — guarded. requestAnimationFrame only with pretendToBeVisual:true — editor takes injectable opts.raf (default requestAnimationFrame); tests use `const q=[]; raf: fn => q.push(fn)` + flush() to assert "60 moves ⇒ 1 queued frame ⇒ 1 ghost d write". getBoundingClientRect returns zeros — opts.viewport injects the cached rect. Assert style.transform/height, d strings (mirrored C first control x < anchor x), classes, chip style.left/top, undo depth, dirty flag, listener removal after destroy(), header-button click counters. Pure modules tested without DOM.
(b) CDP script (Chrome --headless=new --remote-debugging-port --user-data-dir, native WebSocket, Page.enable + Runtime.enable, Page.navigate once then Page.reload, selectors SCOPED to the target world): (1) after Input.dispatchMouseEvent mousePressed on a port anchor, one Runtime.evaluate dispatching 60 synthetic pointermove PointerEvents on the stage then awaiting one rAF ⇒ Δframes === 1 && ΔghostUpdates ≤ 1; (2) ΔrectReads === 0 (+ monkeypatched getBoundingClientRect counter); (3) getComputedStyle(ghost).fill === 'none'; (4) header button click increments after a canvas drag; press-on-canvas → release-over-button ends gesture without spurious click; (5) drag from n_agent.fix (input): ghost d c1.x < a.x; (6) mouseWheel modifiers:2 (ctrl): toWorld(cursor) invariant within 1e-6, zoom within [0.4,1.6]; (7) after load every node's nodeSize corners map inside the stage rect.

## Prototype
/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/b51912d2-042a-4e65-bf01-1da2d7faa640/scratchpad/composer-proto/proto.html — 413 lines, self-contained. Header bar (Auto-layout/Save counters) outside canvas; canvas › stage › world › one SVG; 3 cards (agent `planner` 2 in / 2 out + await gate, Task, End) + 2 wires; card drag (incident wires only), wire drag with ghost + mirrored tangent + legal/illegal + snap-to-anchor + reason chip, pan by space/middle/empty-drag, wheel pan, ⌘/ctrl-wheel zoom about cursor, auto-fit on load (capped at 1), Escape/blur/pointercancel/lostpointercapture cancel, rect cache with ResizeObserver. Geometry by arithmetic: agent card 191.5 = 95.5+24·4; Task/End 110.5; anchors n_agent task (400,136) fix (400,160) plan (620,193) review (620,217) await (400,250); n_task out (280,199); n_end result (760,199); fit at vw 1280 ⇒ z 1, t (120, 104.25). Exposed: window.__proto = { stats:{ghostUpdates, frames, rectReads, pointerMoves, wireDUpdates, headerClicks}, nodes, wires, G, world(), stage(), transform(), toWorld, toScreen, rect(), anchor(nodeId, port, dir), size(nodeId, {footerRows}), bezier, ghost(), ghostD(), fit, render, gesture(), destroy() }.

## How to measure (next agent)
1. Load file://…/proto.html at 1280×800; Page.reload between runs. __proto.rect() + __proto.toScreen(__proto.anchor(...)) give client coords for Input.dispatchMouseEvent.
2. Auto-fit: every node's size() box corners via toScreen within [0, rect.width] × [0, rect.height]; transform().z ≤ 1.
3. Ghost burst: mousePressed at n_agent.plan output anchor; one Runtime.evaluate dispatching 60 `new PointerEvent('pointermove', {pointerId:1, clientX, clientY, bubbles:true})` on #stage, await one rAF; expect Δframes === 1, ΔghostUpdates ≤ 1, ΔrectReads === 0 (also patch Element.prototype.getBoundingClientRect before the burst and assert 0 calls); mouseReleased on empty canvas ⇒ gesture() === null, ghost class `wire ghost`.
4. getComputedStyle(__proto.ghost()).fill === 'none' (also mid-drag).
5. Mirrored tangent: press on n_agent.fix input anchor, move 120px left; parse ghostD() ⇒ first control x < anchor x; move onto n_task.task output ⇒ class contains legal, ghost end == that anchor; release ⇒ wires.length === 3.
6. Illegal: press on n_agent.plan, hover n_end.result ⇒ illegal + chip text `already connected`; hover n_agent.task ⇒ `same node`.
7. Header click: after a full canvas drag, real click on #btn-save ⇒ stats.headerClicks +1; press on canvas → move over #btn-save → release ⇒ gesture() === null and headerClicks unchanged.
8. Zoom invariance: mouseWheel modifiers:2, deltaY:−120 at (600,300): toWorld(600,300) before/after equal (|Δ| < 1e-6), z clamped [0.4,1.6]; plain mouseWheel deltaX/deltaY pans by exactly −delta.
9. Node drag: press on n_agent header, 30 synthetic moves ⇒ ΔwireDUpdates ≤ 2·frames, only w1/w2 d changed, card style.transform snapped to 11px; Escape mid-drag reverts position and d's.
10. Middle-button drag and space+drag pan; window.dispatchEvent(new Event('blur')) mid-gesture ⇒ gesture() === null.
