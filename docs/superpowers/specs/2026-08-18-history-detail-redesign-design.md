# History Detail Page Redesign — Design Spec

Date: 2026-08-18
Branch context: `feat/history-ux` (current HEAD 997aa083 "History buttons")
Design source: `/Users/denislavprinov/Downloads/History detail page redesign/Worca History.dc.html` (authoritative final; the three screenshots in `uploads/` are current-state references and an earlier row iteration — where they disagree with the .dc.html, the .dc.html wins).

## 1. Summary

Rework the History area from "list of cards with in-place accordion expansion" into two screens:

1. **History list** — same view chrome (title, Refresh, sticky project pills, sticky group headers), redesigned run cards.
2. **Run detail page** — a full-screen second panel, slid in from the right, replacing the current expanded-card detail. Sticky pill tabs (Diff / Overview / Agents / Clarify / Logs) replace the five accordions. Adds a full unified-diff patch viewer, a "Ship it?" PR confirm modal, and an Archive confirm modal via the app's `confirmModal`.

Scope is **History only**. The Running view is untouched; shared internals (pipeline graph, log stack, sub-agent grouping, cost banner) are reused, not modified in behavior.

## 2. Locked decisions (from user Q&A — do not re-litigate)

| # | Decision |
|---|---|
| D1 | **Diff data: done runs only.** The Diff tab is populated exclusively from persisted artifacts (`results.json` + `diff-patch.patch`), which exist only for runs that reached `done`. No backend persistence change for stopped/error runs, no live-branch fallback diff. Non-done runs (or done runs whose artifacts are gone) show a "No diff captured for this run." empty state. |
| D2 | **Archive: fix copy to match behavior.** Archive semantics unchanged (removes local branch, worktree, and all on-disk artifacts; soft-deletes the DB row; remote branch and any PR untouched). The new confirm modal's copy states this honestly. |
| D3 | **Resume: paused + interrupted, hidden otherwise.** The Resume button renders only when `status ∈ {paused, interrupted}` (this fixes the existing gap where `interrupted` runs are API-resumable but had no button). Hidden for done/stopped/error. An interrupted run whose worktree is gone gets the server's clear 400 error surfaced on the button title. |
| D4 | **Diff viewer: full patch viewer, no syntax highlighting.** Client-side unified-diff parser; clickable file list; per-file hunk rendering with +/− line coloring. Vanilla, no new dependencies. |
| D5 | **Models: dropped entirely.** No MODELS stat card, no model column in the Agents tab, no model/effort line on graph nodes beyond what `paintHistStepper` already renders today (history passes `modelUsedOf: undefined`, which stays as-is). No backend model persistence. |
| D6 | **Overview tab: design layout only.** The on-demand LLM "Generate overview" narrative UI is removed from History. The server endpoint `POST /api/runs/:id/overview` and `src/core/overview-agent.mjs` remain untouched (out of scope to remove backend). |
| D7 | **Scope: History only.** Running view keeps its current card and layout. |
| D8 | **Routing: hash deep-link.** Detail page is addressable as `#history/<projectKey>/<id>`; survives refresh; browser Back works; matches the `#running/<runId>` pattern. |

## 3. Current-state anchors (verified by exploration)

- SPA: no framework; views are `<section class="view" data-view=…>` in `ui/public/index.html`; `parseHash()` (`app.js:657`) splits the hash on the **first** `/`, so the param may itself contain slashes; `showView(name, param)` (`app.js:10529`) is the single view switcher; `hashchange` is the single driver (`app.js:10633`) with a `syncingHash` re-entry guard.
- History render chain: `loadHistoryView` (`app.js:8168`, cache-first via localStorage `worca-cc.history.cache.v1`) → `paintHistory` (`app.js:8406`) → `renderHistoryPills` / `renderHistory` → `buildHistCard` (`app.js:8957`) from `#hist-card-tpl` (`index.html:403-495`). Two-phase PR enrichment: `POST /api/history/pr` → WS `history-pr` frames → `patchHistoryPr` patches cards in place; `resetPrCluster` (`app.js:8277`) re-clones `.hist-merge`/`.hist-pr` from the template.
- Detail data: `historyDetailUrl` (`app.js:9071`) routes to `/api/workspaces/:wksId/runs/:id` | `/api/history/:key/:id` | `/api/runs/:id?projectDir=`. Response `{state, results, overview, clarify, stepQuestions, artifacts, auditMarkdown}`. Logs: `historyLogUrl` (`app.js:9082`) → whole NDJSON file; **no** `/api/runs/:id/log` fallback exists.
- Statuses: `created|starting|running|pausing|paused|done|stopped|error|interrupted`. History list suppresses pipelines that are live in-process (lingering/paused live entries render in Running); paused/interrupted rows do appear after restart.
- Diff artifacts: `results.json` shape `{summary:{filesNew,filesChanged,filesDeleted,linesAdded,linesRemoved,blockingIssues,nitpicks}, newFiles[], changedFiles[], keyThingsToCheck[], nitpicks[]}`; workspace runs get `{summary: rollup, perProject:{<projectKey>: results}}`. `diff-patch.patch` = one whole unified diff; workspace runs concatenate per-member patches, each prefixed with a `# <projectKey>` comment line.
- List entry fields: `{id, dir, title, status, startedAt, branch, sourceBranch, guardrailsId, pauseReason, retainedWork, survived, added, removed, totalCostUsd, totalActiveMs, mtime[, pr]}` (+ projectKey/projectName/projectDir; workspace rows have `projectKey:"workspaces/<wk>"`, `target:'workspace'`). `added/removed` are live `git diff --shortstat` values, only while the local branch survives.
- Shared internals reused as-is: `buildRunGraph`/`paintRunGraph`/`paintHistStepper` (graph), `paintSubsBar` + `subsGroupsForRender`/`cycleAwareLabel`/`stepSkillsFromSteps`/`stepGraphifyFromSteps`/`stepStatusByKey` (agents), `buildLogFilterBar`/`log-line.mjs`/`log-filter.mjs`/`appendLogRec`/`copyLogToClipboard`/`MAX_LOG_LINES` (logs), `renderCostPauseBanner` (cost banner), `renderRetainedWork`/`addRecoveryPatchLink`/`setupDiscardWorktreeButton` (retained work), `confirmModal` (`app.js:6015`), `copyBranchToClipboard` (`app.js:3646`).
- Tests: 12 `test/ui-history-*.test.mjs` jsdom suites boot the real `index.html` + `app.js`. Suite is fully green at baseline.

## 4. Screen 1 — History list

Chrome unchanged: H1 "History" + subtitle, Refresh button (busy spinner behavior kept), sticky filter pills (`--hist-toolbar-h` mechanics kept), sticky per-project group headers in All-Projects mode, paused/live suppression rule, sidebar count, localStorage cache, error/empty states.

### 4.1 New card anatomy (replaces current `#hist-card-tpl` head)

```
[icon] [title                                   ] [PR pill] [›]
       [status · day · clock · dur · cost · diff]
       [base → [branch ⧉] Copied]
```

- **Status icon** — 36px circle, `title`/`aria-label` = status:
  - `done` → green check (bg `#E2F3DF`, fg `#2F7A38`)
  - `stopped` → red square (bg `#FBE3E0`, fg `#C5483A`)
  - `error` → red exclamation (same red family)
  - `paused` → amber pause bars (bg `#FCE8C8`, fg `#A66510`)
  - `interrupted` → amber pause family, status word "Interrupted"
  - Any other status (defensive: `running` etc. from stale rows) → amber family, capitalized status word.
- **Title** — one line, ellipsized. Title click still opens the saved-markdown viewer (`viewPipeline`), with `stopPropagation` — feature preserved.
- **Meta line** — status word (colored per family) · start date · start time · duration (bold mono, from `totalActiveMs`; omitted when null) · cost (bold mono, `fmtUsd`, with the existing `estTitle` tooltip) · **diff pill**:
  - PR merged → pill hidden entirely ("merged work is already in the base branch").
  - `survived && (added || removed)` → file icon + `+A` green / `−R` red.
  - `survived && added === 0 && removed === 0` → file icon + "no diff" grey.
  - `!survived` → pill hidden (no data).
- **Branch line** — `base →` grey mono + branch copy pill (branch name ellipsized, copy icon, click = `copyBranchToClipboard`-style copy with "Copied" text feedback for ~1.5s, `stopPropagation`). Hidden when no branch; src+arrow hidden for legacy rows without `sourceBranch` (existing rules kept).
- **Retained-work badge** — kept on the card (amber "Work retained"), placed near the status/meta area.
- **Pause note** — the "paused · cost limit"/"paused · total budget" caption is kept on the card for paused rows.
- **Right cluster** — PR pill + chevron button:
  - PR pill states (existing tri-state logic preserved): `pr === undefined` → hidden (enrichment pending); `pr.state === 'MERGED'` → "Merged" link (muted); `pr.state === 'OPEN'` → "View PR" link; else "Create PR" **navigates to the detail page and opens the "Ship it?" modal** (list card itself never fires the PR call). Create PR eligibility rule unchanged (`ghAvailable && survived && branch && sourceBranch`).
  - The merge pill (`can merge`/`conflicts`/`checking`) is **dropped from the list** (kept in detail).
  - Chevron button + whole-card click → open detail.
- **Removed from the card**: the status `.badge` pill (replaced by icon + status word), `.hist-merge` (moved to detail), `.hist-resume` (moved to detail), `.hist-actions` footer (Archive/Discard move to detail), the whole `.hist-detail` accordion block.
- Plugin provenance `.src-badge` is kept (inline near the meta line).

### 4.2 Interaction

- Card click (anywhere not `stopPropagation`ed) and chevron → `location.hash = 'history/<projectKey>/<id>'`.
- Keyboard: card is focusable (`role=button`, `tabindex=0`), Enter/Space opens detail.
- `patchHistoryPr` continues to patch PR clusters in place; the PR cluster is still re-cloned from the template (`resetPrCluster` pattern kept).

## 5. Screen 2 — Run detail page

### 5.1 Navigation & transition

- Route: `#history/<projectKey>/<id>`. `projectKey` may itself contain a slash for workspace rows (`workspaces/<wk>`), so the detail param is parsed as: strip the trailing `/<id>` segment (last slash); the remainder is the projectKey. Store-key charset (`[a-z0-9-]` + 8-hex suffix) and the fixed `workspaces/` prefix make this unambiguous.
- The history view hosts a 200%-wide two-panel track (list | detail). In-app navigation animates `translateX` over 460ms `cubic-bezier(.65,.02,.28,1)`; `prefers-reduced-motion: reduce` → no transition (existing global rule already covers this; the track must not fight it).
- Back paths: header Back button, Escape (when no modal open), browser Back — all land on `#history` with the list's scroll position preserved (list DOM is kept mounted while detail is open).
- Deep link / refresh on a detail URL: boot straight into detail (no animation), fetch the detail record directly; the list loads lazily behind it. Unknown id → error state on the detail panel with a Back button.
- Leaving the history view entirely (`showView` to another view) resets the track to the list position.

### 5.2 Header (white, bordered)

Row 1: **Back** pill · title (ellipsized) + 30px status icon · **PR button** (black pill, right-aligned).
Row 2 (meta): status word · day · clock · **dur** · **cost** · `+A −R` (from `results.summary.linesAdded/linesRemoved` when results exist; else from the list entry's live `added/removed` when survived; else omitted).
Row 3: `base →` + branch copy pill + "Copied" feedback · spacer · **Resume** (per D3) · **Archive** (red outline).

- **PR button**: `MERGED` → "Merged" link; `OPEN` → "View PR" link; else "Create PR" (eligibility rule as today) → opens the **"Ship it?" modal**. After a successful create, the button swaps to a "View PR" link and the **merge pill** (`can merge` / `conflicts` / `merge: checking…` + 4s recheck via `POST /api/pr/mergeable`) renders next to it — existing `setMergePill`/`scheduleMergeRecheck` logic relocated here.
- **Resume**: visible for `paused` and `interrupted` only. Cost-pause gating preserved: `data-pause-reason` stamped on the detail root, `applyHistResumeGate`/`refreshHistResumeGating` keep working against it. Click → `POST /api/resume {pipelineId}`; success → existing recipe (upsert starting run, seed resumed log, drop superseded entry, `location.hash = 'running/<newRunId>'`). Failure → error on button title, button restored.
- **Archive**: disabled + tooltip when `retainedWork` present (rule unchanged). Click → `confirmModal` (not `window.confirm`) with honest copy:
  - Title: "Archive this pipeline?"
  - Body: "It moves out of History. The local branch, worktree, and run artifacts (logs, results, diff) are removed. The remote branch and any open PR stay untouched."
  - Confirm: "Archive" (destructive styling), Cancel.
  - On confirm → `DELETE /api/runs/:id?<runActionQuery>`; success → navigate back to list (slide), remove row from `state.historyAll`, rewrite cache, repaint. Failure → inline error on the detail header.
- Row 0 (banners, above the graph, when applicable): **cost-pause banner** (with "Continue without cap" → `confirmModal` + `POST /api/resume {ignoreCostCap:true}`, existing flow) and **retained-work banner** (manual-commit instructions, recovery-patch download link, **Discard worktree** button with its existing `window.confirm` — unchanged, explicitly out of scope to migrate).

### 5.3 Pipeline graph

- Panel: dot-grid background (`radial-gradient` dots), rounded, horizontal scroll.
- Rendering: existing `buildRunGraph` + `paintHistStepper` unchanged (activeId null, live false, saved-steps frontier, cycle badges). Only the container styling changes. `showGraph` is always on (the design's `showPipelineGraph` prop is a canvas-editor knob, not a product setting).

### 5.4 Section tabs (sticky)

Pill row, sticky under the header while the detail body scrolls: **Diff** [badge: files changed] · **Overview** · **Agents** [badge: sub-agent count] · **Clarify** [badge: merged Q&A count] · **Logs**.

- Active tab = inverted (ink bg, white text). One section rendered at a time; each section's content is lazy-built on first activation and kept (DOM retained) after.
- Tab visibility: **Clarify** hidden when `clarify.questions` + `stepQuestions` are both empty. **Logs** hidden when no `live-log` artifact. **Diff / Overview / Agents** always visible (Diff shows its empty state per D1; Agents shows "(no sub-agents recorded)" when empty).
- Default tab: **Diff** when diff artifacts exist (`results` non-null), else **Overview**.
- Tab choice is per-visit state (not persisted, not in the URL).

### 5.5 Diff tab (D1, D4)

Layout: 2-column grid — left `minmax(280px,340px)` file list, right patch pane. Narrow viewports stack vertically.

- **File list card**: header "N files changed" + aggregate `+A −R` (from `results.summary`). Rows from `results.newFiles` + `results.changedFiles`: path (mono, ellipsized from the left — RTL trick), per-file `+a` / `−r` (or "binary"). New files get a subtle "new" affordance; deleted files ("D" status) render dimmed. Click selects the file; selected row highlighted. Workspace runs: rows grouped under per-project subheaders (from `results.perProject`).
- **Patch pane**: header = selected path + its `+a −r`; body = parsed hunks of that file from `diff-patch.patch`:
  - Client-side parser splits the patch on `diff --git ` boundaries; reads `---`/`+++` and rename headers to key each file section by its new-side path (`b/<path>`); tolerates and skips non-diff lines between sections (covers the workspace `# <projectKey>` separators; in workspace mode the `# <projectKey>` marker scopes path lookup per project); recognizes "Binary files … differ" and "GIT binary patch".
  - Hunk rendering: `@@ …` header line (grey band), context lines, `+` lines green-tinted, `−` lines red-tinted, mono, rendered `pre` with horizontal scroll inside the pane (the page body never scrolls horizontally). No syntax highlighting. No word-level diffing.
  - A file present in `results` but absent from the patch (or binary) → "(no textual diff for this file)".
  - Very large patches: parse lazily per file (store raw section slices; parse a file's section only when selected). A per-file section larger than 500 KB renders a truncation note with the first 500 KB.
- **Data source**: new endpoint (see §7) serving the `diff-patch` artifact inline. Fetched once per detail visit, on first Diff activation.
- **Empty state** (non-done runs, or missing artifacts): centered "No diff captured for this run." plus, when the run is not `done`, the sub-line "Diffs are captured when a run completes."
- Findings linkage: `results.keyThingsToCheck` entries are NOT rendered in this tab (they live in Overview); no per-line annotations (YAGNI).

### 5.6 Overview tab (D5, D6)

Vertical stack:

1. **Verdict banner**: when `results` exists and `keyThingsToCheck` is empty → green "Clean — no blocking issues flagged." with a "Clean" chip. When findings exist → amber banner "N things to check" and the findings list (`issueList`-style: severity, title, detail, location) rendered beneath it. When `results` is null (non-done) → banner shows a status-family-colored chip (e.g. red "Stopped") + "No review results captured — the run did not complete."
2. **Stat cards grid** (`repeat(auto-fit, minmax(220px,1fr))`):
   - **DURATION** — `fmtDuration(totalActiveMs)`; subtitle "N steps · M cycles" derived from saved `steps[]`.
   - **COST** — `fmtUsd(totalCostUsd)` + `estTitle` tooltip; subtitle "across N steps". (No plan/impl split — the v2 engine is generic; node roles are not fixed.)
   - **WORKTREE** — "retained" (when `retainedWork` or `branch.worktreeDir` exists on a paused run) / "released" otherwise; subtitle = `branch.worktreeDir` path (grey mono) when known.
   - (No MODELS card — D5.)
3. **Task card**: "Task" heading + the run `prompt` (first ~600 chars, expandable "Show more" when longer); chips row: project name, `base` branch, "N sub-agents" (when any).

Removed: the "Generate overview / Regenerate overview" button, `loadOverview`/`paintOverview` wiring, narrative + `diffFindings` merge + truncation note. `mergeFindings` loses its last caller and is dropped from the `results-view.mjs` import; the plain `keyThingsToCheck` list renders via `issueList` directly. The `overview` field of the detail payload is ignored.

### 5.7 Agents tab

- Groups via existing `subsGroupsForRender` projection (per node/cycle, with `cycleAwareLabel`). Each group = card: header "label" + meta "n sub-agents · <group duration> · <group cost>" (duration/cost summed from the rows that have values; omitted when none do).
- Rows: 3-column grid — name (`label`, ellipsized; `subagent_type` as a grey suffix chip when present), duration, cost.
  - Duration: `durationMs` when present; else derived `finishedAt − startedAt` when both exist; else blank.
  - Cost: `fmtUsd4(costUsd)` when present; else blank.
  - No model column (D5). Skills and graphify chips from the existing projection (`stepSkillsFromSteps`, `stepGraphifyFromSteps`) are **kept**, rendered in the group header area as today's subs bar does — no feature loss.
- Status coloring: running/error/stopped rows tinted per existing subs-bar convention.
- Empty: "(no sub-agents recorded)".

### 5.8 Clarify tab

- One card per merged Q&A item, in order: pipeline-level `clarify` first, then `stepQuestions` rounds.
- Card: `ASK` chip + question text; `ANS` chip + answer text ("(none)" when unanswered).
- Step-question cards get a grey caption "`<agentKey>` — round N · cycle M".
- Read-only. Badge count = total questions across both sources.

### 5.9 Logs tab

- Filter bar: **reuse `buildLogFilterBar()` clone verbatim** (single source of markup preserved) — source/level/step/cycle selects, debounced search (120ms), copy-visible button with "copied" feedback. NOTE: the real shared bar has no clear-all button and no "N of M lines" counter (the design canvas shows both; the shared-markup constraint wins — the tail-cap hint inside the log box remains the count affordance). Accepted divergence from the mock.
- Log box: existing pipeline — parse NDJSON once via `projectLogRecord`, facets via `logFacets`, filter via `compileLogFilter`, tail-render capped at `MAX_LOG_LINES` (4000) with the "(showing the last N of M matching lines — copy takes all M)" hint, cycle separators via `cycleSeparatorBefore`/`buildLogSeparator`, rows via `appendLogRec` (sub-agent indent/dim, level colors, stderr stream styling — all preserved).
- Restyle only: white rounded container, min/max heights per design, filter controls styled to match.
- Fetched once per detail visit on first Logs activation, from the existing log endpoints.

### 5.10 "Ship it?" PR modal

- Overlay modal (viewer-modal pattern, z-index above the detail): animated green PR icon (pop + spark ring + rise, all disabled under `prefers-reduced-motion`), title "Ship it?", body "This opens a pull request for <title> and puts it up for review."
- Summary box: "N files · +A −R" (from `results.summary` when present; else the list entry's live `added/removed`; whole line omitted when neither exists) + `branch → base`.
- Buttons: Cancel · "Open pull request" (ink pill). Confirm → existing `POST /api/pr` flow with per-button busy state ("Opening…"); success → close modal, swap header button to "View PR", run merge-pill flow; `existed:true` → same but label "View PR"; failure → inline error in the modal.
- Escape / backdrop click → close. Implemented as a **dedicated modal** using the existing overlay conventions (`.viewer-modal` fixed overlay, backdrop click + Escape close, listener cleanup on done) — `confirmModal` cannot host the animated icon or summary box (its API is title/message/labels only). No new global modal framework.

## 6. Removals (UI)

- `#hist-card-tpl`'s `.hist-detail` accordion block and all five accordion painters as card-level features: `toggleHistCard`, `loadHistDetail`-into-card, `paintDiffBar`/`renderDiffPanel`, `paintOverviewBar`/`buildOverviewPanel`/`loadOverview`/`paintOverview` (history usage), history call sites of `paintSubsBar`/`paintClarifyBar`/`paintLiveLogsBar` (logic relocated to the detail page, shared helpers untouched for Running's sake).
- `.hist-merge`, `.hist-resume`, `.hist-actions` from the list card.
- History-side accordion CSS hooks that become unused (`.diff-bar`, `.overview-bar` etc. remain for Running where shared — only genuinely dead selectors are pruned).
- The `+X/−Y` diff data flow stays (list pill + detail header both use it).

## 7. Server changes (one endpoint family)

Mirror the log routes exactly (same auth/validation posture, same key regex):

- `GET /api/history/:key/:id/diff` → the run's `diff-patch` artifact text, `Content-Type: text/x-diff`, inline (no attachment disposition). 404 `{error:'no diff'}` when the artifact is absent.
- `GET /api/workspaces/:id/runs/:runId/diff` → same for workspace runs (the concatenated multi-project patch).
- No `/api/runs/:id/diff` projectDir fallback (parity with logs, which deliberately have none — the detail page always has a store key or workspace id for persisted-artifact runs).
- Read path: existing `readRunArtifactText(…, 'diff-patch')` helper; no new core logic.

Everything else uses existing endpoints: `/api/history`, `/api/history/pr` (+ WS `history-pr`), detail endpoints, log endpoints, `DELETE /api/runs/:id`, `POST /api/runs/:id/discard-worktree`, `GET /api/runs/:id/recovery-patch`, `POST /api/pr`, `POST /api/pr/mergeable`, `POST /api/resume`.

## 8. Visual language

- Existing palette/typography (Poppins + JetBrains Mono, ink `#19191B`, bg `#F1F1EF`, greens `#2F7A38`/`#E2F3DF`, reds `#C5483A`/`#FBE3E0`, ambers `#A66510`/`#FCE8C8`, blues `#3782A8`/`#DEEFF7`, borders `#ECECEA`/`#E3E3E0`) — all already present in `style.css` variables where defined; new rules reuse existing CSS vars and only add literals the design introduces.
- New CSS namespaced under `.hist-*` (list card v2) and `.hd-*` (history detail) to avoid colliding with Running's shared classes.
- All new animations (slide track, PR modal pop/spark/rise, icon transitions) are no-ops under `prefers-reduced-motion: reduce`. The existing kill-switch at `style.css:756` covers `transition` globally but `animation` only for 4 named selectors — extending it with a global `animation:none` is part of this work.
- Responsive: detail grid columns collapse on narrow widths; wide content (graph, patch pane, log box) scrolls inside its own container.

## 9. Testing

Baseline: full suite green (`npm test`; fresh worktrees need `npm ci` first — see project memory).

- **Rework** the 12 `test/ui-history-*.test.mjs` jsdom suites for the new DOM: pills/cache/boot-count/workspace rows (mostly intact), card anatomy (icon, meta line, diff pill states incl. merged-hidden and "no diff", branch line rules, PR tri-state, copy-doesn't-navigate), sticky header vars.
- **New**: routing (deep-link boot to detail, back/Escape to list, unknown id error, hash round-trip with workspace keys), detail header (Resume visibility matrix incl. `interrupted`, Archive via `confirmModal` + honest copy + disabled-on-retained, PR button states, meta fallbacks), tabs (default-tab rule, lazy build, badge counts, hidden Clarify/Logs), Diff tab (parser unit tests: file splitting, renames, binary, workspace `# key` separators, hunk rendering, truncation; empty state for non-done), Overview tab (verdict states, stat cards, task card, LLM-overview absence), Agents tab (duration fallback, blank cost), Logs tab (filter bar reuse contract), "Ship it?" modal (summary fallbacks, busy/error, existed:true path).
- **Server**: new diff endpoint tests (200 inline text, 404, workspace variant, key validation).
- Keep the exact-byte `−` (U+2212) assertions convention where counts render.

## 10. Non-goals

- Running view changes (D7).
- Diff persistence for stopped/error runs; live-branch diff fallback (D1).
- Model persistence or display (D5).
- LLM overview UI (D6) — backend endpoint and agent stay.
- Log pagination / server-side log tailing.
- Merge pill in the list.
- Migrating the Discard-worktree confirm to `confirmModal`.
- Per-line diff annotations, syntax highlighting, word-level diff.
- Persisting the selected tab or detail scroll position.
- Any change to archive semantics (D2 — copy only).

## 11. Open items for the implementation plan

- Exact template strategy: extend `#hist-card-tpl` vs new `#hist-card-tpl` v2 + `#hist-detail-tpl` (plan decides; tests boot real HTML so templates must ship in `index.html`).
- Where the detail screen's DOM lives (inside `[data-view=history]` as a second panel of the slide track).
- `showView` integration: history param handling, focus management on navigation (focus the Back button on detail open; restore focus to the originating card on return).
- Diff parser module placement: new `ui/public/diff-view.mjs` (pure, testable like `log-line.mjs`/`log-filter.mjs`).
- Cache interaction: detail visits must not fight `paintHistory` full rebuilds (list repaint while detail is open must not tear down the detail panel).
