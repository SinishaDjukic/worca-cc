---
name: real-browser-view-probe
description: Read before proving a ui/public change in headless Chrome (CDP or static pages) or touching a verify-*-cdp tool — harness, measuring, probe servers, seeding
paths: ui/public/app.js, ui/public/style.css, ui/public/index.html, ui/public/*-view.mjs, ui/public/graph/*.mjs, ui/public/ask-panel.mjs, tools/verify-*-cdp.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

A green `npm test` is ZERO coverage for `tools/verify-*-cdp.mjs`, yet CI's `cdp` job runs them on each push: a change MODIFYING one runs its `npm run verify:<x>` (temp home, in-process server, own Chrome; `CDP_PORT` default 9338), one at a time. `verify:scripts` (≈3 s) ends "no page errors or exceptions": the cheapest live wiring proof. What to check: [[ui-cdp-audit-traps]].

Playwright MCP is not permitted in pipelines (never retry): lift ≈60 lines from `tools/verify-scripts-cdp.mjs` — Chrome path list, `--headless=new --remote-debugging-port=<p> --user-data-dir=<mktemp>`, the `/json/list` poll, `cdp()`/`waitEvent()`, `Runtime.evaluate` `returnByValue`, `exceptionThrown` + console errors as the last check.

## Measuring
- `--virtual-time-budget` advances no CSS animation or transition: `getAnimations().forEach((a) => a.finish())` or inject `transition:none!important` (`FREEZE_CSS`); in `--dump-dom` read styles in a `setTimeout(…,1500)`. A mid-transition shot: `getAnimations({subtree:true})` → `pause()`, set `currentTime`, clip capture, `finish()`.
- `--window-size` clamps below 500 px in `--headless=new`: `Emulation.setDeviceMetricsOverride` or iframes.
- `scrollWidth > clientWidth` misses sub-pixel overflow: compare a Range's `selectNodeContents(el)` rect width with the box. Prove webfonts with `CSS.getPlatformFontsForNode`; measure EVERY label variant.
- A screenshot shows the viewport only (`scrollIntoView` first); backdrop-filter cards can stop painting after many navigations (re-check with a `clip` shot before reporting "invisible"); never pump tiny clip captures (they leak into the PNG).
- Headless Chrome follows the host's OS dark mode (fresh home = theme `system`): `Emulation.setEmulatedMedia` `prefers-color-scheme: light`; compare against a token resolved on a scratch div. A `dataset.theme` set after boot is reset by ANY `POST /api/settings`: POST `{theme}` instead.
- A fresh home shows "Getting started n/9" between New and Runs: no defect.

## Static probe pages (CSS-only, ≈2-3 s, no server, no app.js)
- In a mktemp scratch, never the reviewed tree. Copy style.css with every `url('/fonts/` rewritten to `file://<tree>/ui/public/fonts/` (else fallback fonts drift widths); measure inside `document.fonts.ready` + 300 ms.
- Build pages in node with jsdom from `index.html`: clone `section.view[data-view="X"]`, drop `hidden`/`.hidden` and `<template>`s, wrap as `<html data-level="expert">` → `.app > aside.sidebar + .main-col > header.app-head + main.main`, set `body.view-<x>`; append rows from the real renderers (`renderScriptsList`, `renderSyncChip`). Assert `display === 'grid'` first (stylesheet loaded).
- Run `spawnSync(chrome, ['--headless=new','--no-first-run','--use-mock-keychain','--password-store=basic','--allow-file-access-from-files','--user-data-dir=<mktemp>','--virtual-time-budget=4000','--dump-dom','file://…'], {timeout:25000})`; write results into `<pre id="out">RESULT …</pre>`, await `setTimeout` (never rAF: dumps empty), match `/<pre id="out">RESULT (.*?)<\/pre>/`; remove only that profile.
- jsdom page dumps lie: the serialized `checked` is the attribute, not the live property (mirror `i.checked` with `setAttribute('checked','')`); in headless Chrome `el.focus()` matches `:focus-visible` only after a key event (send Tab first). Realistic shell: boot index.html + app.js like `test/ui-marketplace-installed.test.mjs` `boot()`, drive the UI, dump, strip scripts, serve `ui/public` over `http.createServer` (fonts resolve, no rewriting).
- Many widths in ONE spawn: an outer page with one `<iframe width=W>` per scenario (media queries follow the iframe, no 500 px clamp); inner pages `parent.postMessage` their numbers; `--virtual-time-budget=8000`.

## Servers and runs for a probe
- Background Bash ending `exec env -u WORCA_HOST_PID WORCA_HOME="$(mktemp -d)" WORCA_MOCK=1 PORT="$PORT" node ui/server.mjs`, printing `SERVER_PID=$$` first (then `kill <literal pid>`); free port via `net.createServer().listen(0)`. `WORCA_HOME` is the PARENT of `.worca-cc`: for board-like `~/.worca-cc/…` paths set HOME = WORCA_HOME = one mkdtemp. Seed chat cards from a separate `node <tree>/.probe/x.mjs` with the same homes (SQLite is read per request).
- Track runs by the POST's `runId`, never the launch title (re-titled within ms); to prove a card SHOWED a title arm a `MutationObserver` before the click. Probe from `.worca-cc-test/<tag>probe/`, `SHOT_DIR` outside temp homes, own `CDP_PORT` (9339).
- Git-missing walk: seed with `WORCA_GIT` unset, re-import with `WORCA_GIT=0` on the same home; live flip: `git-available.mjs` `_testing.set({available:false})` in the server process (`GET /api/git` re-probes after 60 s).
- "Manual browser check" tables run headless in ~2 min: in-process server (homes set BEFORE import) + CDP `Fetch.enable` (`getResponseBody` + patch + `fulfillRequest`; `failRequest` = blocked). Navigating to the SAME `url#hash` is a fragment nav with no load event: add `?p=<n>`, or `Page.reload`.
- Long-lived audit driver: a background `node driver.mjs` (in-process server, Chrome, `/eval /shot /cdp /errors /quit`, cleans only its own child) with `run_in_background` + `timeout: 3600000`; steps run in the DRIVER process (pass args via a file, cache-bust imports `?t=`). `ws://…/ws` 404s come from `http.createServer(app)` without upgrade: listen on the exported `server`. Wait for chat turns by COUNT. `Input.insertText` with a non-editable focus types into the last-focused field: use `dispatchKeyEvent`; Enter needs `text:'\r'`.

## Seeding surfaces without a model turn
- Chat cards: `ask/store.mjs` `createThread()` + `appendMessage(tid, {role:'assistant', status:'done', blocks:[{kind:'card', id:'card_0000ab01', state, card}]})` — workflow `card:{type:'workflow', …proposalFor()}` (`test/helpers/auto-proposal-fixture.mjs`); run card `state:'started'`, `{type:'progress', pipelineId, runId, projectKey}` + `linkRun(tid, {runId, cardId, pipelineId, status})`. There is NO `.ask-pill` (1.11): Ask is the Chat page — `Page.navigate` to `/?r=<now>#chat/<tid>`, POST `/api/onboarding {welcomeSeen:true}` first. A proposal card's Start = `[data-ask-card-start]`; run pills live on `#history/<key>/<pid>/details/agents`.
- Composer draft cards: `createThread({mode:'composer'})`, `card:{type:'agent-draft', sessionId, docToken, draft, then}`, `localStorage['worca-cc.composer.thread']`; session (per page load) and docToken (per workflow) make pre-reload cards "not mine": open the workflow, `store.updateCardBlock(…)`, `await __wfv.chat().client.resync()`.
- Auto pop-up: `POST /api/run {workflowId:'wf_auto', humanInLoop:true, mock:true}` holds at a workflow question; `#run-detail .wf-preview` opens `.wf-pop`. No mock run stays running: wait for `pendingQuestion`, then `window.__np.getRun(id).pendingQuestion = null` (re-apply after reload). A gate question without a model: wrap `WebSocket` via `Page.addScriptToEvaluateOnNewDocument`, dispatch a `question` `MessageEvent`.
- The open Ask sheet survives hash changes and covers later shots: check `[data-ask-sheet]` width is 0. Wait >= 200 ms after toggling a node's `is-error`/`is-active` (box-shadow transition).
