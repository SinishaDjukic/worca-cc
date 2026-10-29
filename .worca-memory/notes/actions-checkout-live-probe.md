---
name: actions-checkout-live-probe
description: How to live-test Check out / setup / service Start-Open-Stop in real Chrome without a model run (Try it head, Actions tab, strips)
paths: ui/public/run-head.mjs, ui/public/actions-view.mjs, ui/public/app.js
updated: 2026-10-29T17:21:25.270Z
author: Bulibas
---

A mock `POST /api/run` parks on its clarify question and never gives a finished run with a real branch. For a live
check of anything that checks a run out (the head's Try it step, the Actions tab, the Overview strip), seed the run
instead, exactly as `test/api-actions.test.mjs` `before()` does. Worked in ~40 s end to end (2026-10-29, Try it head):

- One node driver outside the tree, env BEFORE imports (HOME = USERPROFILE = WORCA_HOME = one mkdtemp, `WORCA_MOCK=1`,
  `WORCA_GIT=1`, no `WORCA_HOST_PID`); import `test/helpers/git-dir.mjs` `templateRepo`, `test/helpers/db-seed.mjs`
  `seedPipeline`, `src/core/projects.mjs` `addProject` by absolute path.
- Per run: `git branch worca-cc/x` in the repo, `seedPipeline(repo, { status: 'done', branch: { source: 'main', feature,
  runRootMode: 'detached', worktreeRemoved: true, branchKept: true } })`, then the `json_set(branch, '$.worktreeDir', …)`
  UPDATE from that test. Without the branch Check out refuses.
- Import `ui/server.mjs`, `server.listen(0)`; `PUT /api/projects/<key>/actions` `{ setup: 'sleep 2', actions: [{ id: 'web',
  label: 'Web', kind: 'service', cmd: 'python3 -m http.server {PORT} --bind 127.0.0.1', env: [{ name: 'PORT', type:
  'port', value: 'auto' }], openUrl: 'http://localhost:{PORT}', ready: { kind: 'port' } }] }` (setup `false` = a failed
  setup, exit 1). `POST /api/onboarding {welcomeSeen:true}` and `POST /api/settings {uiLevel}`.
- Open `#history/<key>/<id>`; the head is `#hist-detail .hd-glance .rd-head-acts`. Record transient states with a
  MutationObserver on it (pushing each distinct label list to `window.__seen`), since Checking out… lasts milliseconds.
- A seeded finished run has no live runs-map entry, so `#running/<id>` lands on History: the Runs page card head cannot
  be walked this way; its jsdom tests (`test/ui-running-detail.test.mjs` `checkoutGlance`) are the proof.
- Click Stop on every started service before closing the server; then `ps -ax | grep http.server` should be empty.
