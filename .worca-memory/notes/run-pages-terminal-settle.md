---
name: run-pages-terminal-settle
description: Read before changing the run page, saved-run page, Runs list rows or their consumers — settling when a run ends underneath, CSS traps, sharing the ask card
paths: ui/public/app.js, ui/public/style.css, ui/public/index.html, ui/public/runs-list.mjs, ui/public/global-search.mjs, ui/public/activity-model.mjs, ui/public/activity-menu.mjs, ui/public/chat/run-card.mjs, test/ui-history-detail-tabs.test.mjs, test/ui-running-stop-modal.test.mjs, test/helpers/history-detail-boot.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Retained-work banners and finished-run hand-off: [[run-worktree-hold-traps]]. Detail-tab openers: [[app-js-jsdom-probe-recipe]].

## Settling (checked in jsdom against app.js)
- A paused run is already `_finished`: `done(paused)` runs `finishRun(r, 'paused')`, so a later `done(stopped)` returns at `if (r._finished) return;`; status moves only via the `state` frame and finishRun's effects never run (`loadHistoryView({force})`, `markLingering`, `finishedAtMs`, eviction). History, "Needs you" and the hand-off wait for `pipelines-changed` — meanwhile the stale "Paused" row stays in Needs you. A client-side local finish clears `r._finished = false` first.
- Never re-arm inside finishRun for a non-paused status (`wireRun` broadcasts a stray `error` frame even after `done(paused)`): re-arm in `onDone` only — record `r._finishedAs`, then `if (r._finished && r._finishedAs === 'paused' && RD_TERMINAL.includes(msg.status)) r._finished = false;`. Killer: after `done(paused)` send `error` — still "Paused".
- Stale-boot entries: after a restart `onHello` only marks old entries `staleBoot`; a paused one stays in Runs and Needs you and `hdPipelineRun` skips it, so the saved page stops through `{pipelineId}` only — finish every paused entry with that `pipelineId` after the POST. Simulate: hello `bootId:'b1'` with the run + `done(paused)`, then hello `bootId:'b2'`, `runs:[]`.
- The saved-run page (`#history/<key>/<id>`) never re-reads its detail: status, banners and tabs read `histDetailState.data`; `refreshHdFromRow` swaps only `histDetailState.record`, so logic following a stop reads `record.status`. Fixture `deliverRows(ctx, rows)` changes only `ctx.box.rows` (a re-read test also sets `ctx.box.detail`). A client-side flip repaints the History glance only via `paintHistory()` → `refreshHdFromRow()`; `rdRepaintOpenGlance(id)` repaints the RUNNING page only.
- A reload does NOT clear a stale server entry: every `hello` carries `summarizeRuns()` and `countNeedsYou` prefers a live entry over its History row — after `worca stop`/`resume` elsewhere the entry keeps badge, Stop and Resume until the server settles it (`settleStaleParkedEntries()` before `hello` and on `schedulerTick`). Reach `hello` via `mod.server.listen(0)` + a `ws` client.
- Probe the run page by appending a test to a copy of `test/ui-running-stop-modal.test.mjs`, the saved page via `./helpers/history-detail-boot.mjs`; delete the probe after.

## CSS traps (real Chrome; jsdom and source pins were green)
- Reduced motion: the LAST `prefers-reduced-motion` block's `.run-shell *{animation:none !important;}` (also `.ask-dock *`, `.proj-shell *`) kills every run-page animation, new ones included; JS waiting on a CSS animation with a timer shows a stale frame. `.hist-shell` has no blanket. Branch in JS (`matchMedia`) or add scoped `.run-shell .x{…!important}` exceptions in that block.
- An invisible placeholder holding a control's height must not wrap before the control: `white-space:nowrap` + ellipsis, measure at 320 px. A permanent template child kills a container's `:empty` rule. `.rd-sheet` is a flex column with `gap:16px`: a collapsing last child needs `margin-top:-16px`.
- A `<button>` in a line rebuilt on EVERY frame breaks in Chrome: `paintRdHeader` empties `.rd-meta` on every non-`log` frame of ANY run — `btn.focus()` scrolls back each frame (`focus({preventScroll:true})`) and a click whose press and release straddle a rebuild is DROPPED. Skip the rebuild while the text (minus the ticking `.run-time`) is unchanged, or host the control outside. Probe: CDP mousePressed → `Runtime.evaluate` (rebuild) → mouseReleased, count clicks.

## Sharing the Runs page ask card with another host (chat run card)
- The look is scoped to `.rd-questions`: widen each rule to `:is(.rd-questions,.<host>)` (same weight); never add the `rd-questions` class to the host (app.js queries it: `.crp-head > .rd-questions`, the tour target).
- `.ask-card :is(select,input[type="text"],textarea)` weighs (0,2,1) and beats every (0,2,0) `.rd-questions .af-inp` rule inside an Ask card: scope it out with `:where(:not(.<host> *))`.
- Proving it in jsdom = replay the cascade (`cascaded()` in `test/ui-chat-run-card.test.mjs`): cssstyle expands `border:0`/`background:none` into longhands of the SAME rule, drops `border` when the rule also sets `border-color`, prints `padding:0 4px` as `0px 4px` — count ONE declaration per rule, expect normalized values.
- Wash inside a qpanel also comes from GLOBAL rules (`.qnote`, `.af-grp` `--amber-wash-2`, `.ask-wfcard-warn` `--amber-wash`): put all three in a "no wash" pin's fixtures. A narrower host inherits the recovery `.issue-detail` (mono, `pre-wrap`): give it `overflow-wrap:anywhere`.

## Consumers of runs-list.mjs rows outside `buildRunsModel`
- `liveRow` has no `activityMs` and no finish time (only `sortMs` = startedAt): sorting live and History rows by "activity, else sortMs" ranks a LINGERING finished live row by its START. Treat a live row's time as `now` (as `dateBucket` does) or read the deduped History row's mtime.
- `rowMatches` adds `STATE_TERMS[icon]` and "needs you" to the haystack; a consumer building its own from `[title, groupName, word]` loses them.
- `pipelines-changed` reloads `state.historyAll` only `if (inRunsView())`: off the Runs page a global consumer (top bar search) shows rows archived/retitled elsewhere until the next Runs visit.
- `liveRuns()` minus `overviewRuns()` is only `agentgen` (reaches `runs` only via `hello`, stays `running` until the next hello, reads "(unknown project) · Running"). Probe: hello `{runId:'agen_1', kind:'agentgen', projectDir:null, status:'running'}`. Mapping all History through `runsHistItem` per frame (+0.24 ms per 3000 rows) is no perf finding.

## Repaint signatures that drop a new field
- `paintRunsList` keys groups on `[key, name, count, collapsed, rows]` and `runsRowSig` on fixed row fields: a new group field never repaints; `loadProjects()` repaints no Runs list.
- `paintRdResult` keys on `[status, glance, data?1:0, cost, steps, level]`, not on the values it passes `rdActivityGroups`.
- `chat/run-card.mjs` `resolve()` merges ONLY `results, artifacts, moreArtifacts, pr, branch` from the REST snapshot into a live one: a new REST-only fact stays the live value.
- `ensureRdTabs` builds once (`.rd-tab` guard): a rebuild replaces the guard and `destroyActionsIn`/`destroyGraphMounts` the old `.rd-sections`.
- app.js imports git-gate's `onGitChange` as `onGitFlip`; a finished run gets no frames, so an `onGitFlip` repaint needs `repaintRunDetail(r)` (sections too), not `paintRdGlance` alone.
