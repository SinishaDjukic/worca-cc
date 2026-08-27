# Node-graph v2 REBUILD — locked decisions (2026-08-26)

Context: PR #359 (`origin/worca-cc/v2-orchestrator-bfb6a0ed`, base 7c390dc8, 222 files, CONFLICTING, 217 commits behind dev) implemented "Node-Graph Pipelines v2". It is being THROWN AWAY. Concept stays; new plan + new implementation built on top of CURRENT dev (e6968e15, schema v22). Old branch = borrowable source material only (read via `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:<path>`).

Spec (concept, authoritative incl. Amendment f): `docs/superpowers/specs/2026-08-10-node-graph-pipelines-design.md` (untracked, 663 lines). Old plans v1–v4 next to it in docs/superpowers/plans/ (untracked). Old verified seed graphs: `docs/superpowers/plans/2026-08-10-seed-templates/*.v2.json` + old branch `src/core/graph/seed-templates.mjs`.

## User decisions (this session, 2026-08-26)
1. Landing: new plan + new implementation on top of dev. 6–8 plans, 8–15 tasks each, executed one after another (each = one worca orchestrate pipeline run, ALSO runnable by hand → self-contained pipeline format: Task 0 branch setup, npm ci, Clarifications Q&A, no dependence on untracked files). Every plan leaves the suite green and dev shippable; v1 engine stays live until the cut-over plan.
2. Spec Amendment f decisions ALL STAND: single-wire inputs everywhere (V7), AND/OR/End flow cards + Combine + Task, universal bottom-left `await` gate on agent cards, explicit Task node source, fully generic engine (zero agent-key coupling), re-seed the 7 saved templates + wf_default as v2 graphs, A1–A4 v1 trace parity.
3. Canvas navigation: NO on-canvas controls (no zoom buttons, no fullscreen, no fit button). Wheel/trackpad = pan; pinch / ⌘|Ctrl+wheel = zoom 0.4–1.6 about cursor; space+drag / middle-drag = pan; graph AUTO-FITS when composer opens. Auto-layout = button in the composer HEADER BAR (outside canvas).
4. Composer layout = PR #359 final: header bar (name, Auto-layout, Save, unsaved marker) → canvas (constant height, dot grid) with a FLOATING, COLLAPSIBLE inspector over its right edge → always-expanded AGENTS palette card BELOW the canvas (domain chips, filter, agent pills, pinned Flow group Task·End·AND·OR·Combine) → saved pipelines list with thumbnails.
5. Wires: cubic bezier with horizontal tangents (out of the right side of outputs, into the left side of inputs; loop wires bow below). Ghost cord while dragging = same curve from the port anchor to the cursor, rAF-throttled, world-space, must not glitch (PR bugs: no fill:none on ghost, no mirroring for input-origin drags, no rAF, full validate+re-render per pointermove, no pointercancel, capture never released, capture swallowing button clicks).
6. Run-time graph: FULL v2 renderer with live decor in (a) the Running LIST card when density = Detailed (auto-fit to card width, NON-interactive — no wheel capture; click opens detail), (b) Running detail page and (c) History detail page (both with pan/zoom + expandable executions footer). Compact density: no graph. Live indication of what is running (node states, marching ants on trigger wires, executions footer, loop badges, gate pips, End result chip, quiescence-without-End banner).
7. Scope REQUIRED for completeness: engine + composer + run monitor + migration/re-seed + Agents view v2 port editor + agent-gen v2 (LLM drafts agents with ports) + plugin workflow templates as v2 graphs (v1 plugin templates rejected with clear message) + CLI parity (`worca --workflow`, exec rendering instead of phase names).
8. Migration: ARCHIVE non-reseeded v1 template rows (keep in table, hidden, never listed/runnable, audit-log line) — do NOT delete. No v1→v2 converter for arbitrary templates.

## Locked constraints from other landed work (do not re-litigate)
- Running page redesign (2026-08-20, D1–D17 + C1–C16): Running = list + `#running/<runId>` detail (`.rd-*`); Detailed card = header + graph + live log; density default Detailed persisted; `paintRdHeader` repaint must never re-enable a control it did not disable (C16); `RD_TERMINAL` + `wr-*` keyframes declared once; `.rd-pause` is one toggling control.
- History detail redesign (2026-08-19, D1–D8): `#history/<projectKey>/<id>`, `.hd-*`; model display dropped everywhere (D5); Resume only paused+interrupted (D3).
- Product name in user-facing text = "worca" (never "worca-cc").
- Never git push; plans/specs stay untracked (docs/superpowers/).
- Suite is fully offline (fake claude bins / WORCA_MOCK); no live claude in tests.
- Prefer dependency over vendored code; no committed generated blobs; keep tested modules pure/injected.
- Plugin updates are SHA-only (installed plugins run a committed-tree snapshot).
- Marketplace discovery reads the committed tree.
