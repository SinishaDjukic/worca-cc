---
name: app-js-traps
description: Read before editing ui/public/app.js or src/shared — imported helpers, makeRun's fixed fields, capture-phase Escape arms, the purity test's word scans.
paths: ui/public/app.js, ui/public/*.mjs, ui/public/*.js, src/shared/**, test/ui-*.test.mjs, test/helpers/feedback.mjs, test/shared-graph-purity.test.mjs
updated: 2026-10-29T17:04:35.278Z
author: Bulibas
---

**Check the import lines before calling a helper missing.** The toast `notify({ tone, title, detail, key })` is
IMPORTED from `./feedback.mjs` (`app.js:97`, 60+ call sites), so a grep for `function notify` in app.js finds nothing; a
refine cycle (#620) wrongly called it missing. Per-row or per-member results use status text on an element the painter
owns (`paintHdPublish`, `r.statusEl.textContent = …`; a painter that rebuilds its DOM keeps the messages in a Map keyed
by member); `notify` is for errors that concern no single row. jsdom traps (2026-10-18): `feedback.mjs` keeps at most
`TOAST_MAX` (3) toasts and drops the oldest non-error one, so clear `#toasts`
(`doc.getElementById('toasts').replaceChildren()`) before a step and assert exactly one new toast; the test `click()`
helpers dispatch a plain `Event`, which fires on a DISABLED button too, so assert `.disabled === false` after each
refusal (a review found four untested re-enables).

**`makeRun` drops unknown keys.** `upsertRun(partial)` builds an unseen run with `makeRun(partial)`, which destructures
a FIXED parameter list and returns a fixed object; only an EXISTING run gets every defined key copied. A hello field
(e.g. `night: r0.night`) reads as wired but is lost on a run's first hello until the next `state` frame. Add a field to
BOTH `makeRun`'s parameter list and its returned object; verify with a boot test that dispatches a single `hello`
(`test/ui-night-mode.test.mjs` `openRun`).

**Document-level capture-phase Escape arms** navigate whatever the target is: History detail (~:24375), Running detail
(~:24406), Projects detail (~:24427), Workspace wizard (~:9104). Where `ui/public/modal-guard.mjs` exists (PR #774) they
all stand down via `dialogOpen(document)` (an open `.viewer-modal` or `dialog[open]`), and the Scripts page's host-level
arm (`scripts-view.mjs` `onKeyDown`) bails the same way (see [[ui-modal-stacking-traps]]). On an older base without that
file (`ls` it first; absent at 73f99f0b) the project-page arm (~:27031) bails on an explicit list (`#confirm-modal`,
`#plugin-modal`, `#project-add-modal`, `#project-bulk-modal`, `.viewer-modal.sync-modal`): use `pluginModal(title, bodyEl,
actions)` / `closePluginModal()` or extend every arm's list. A body-level surface that takes keys (the terminal pane
`.term-pane`, an editor dock) needs its own `e.target.closest(...)` guard in ALL arms (like `#runs-search-row`,
`.mem-editor`); `stopPropagation` cannot help in capture phase. Ask's Ctrl+K (`ask-panel.mjs` `onDocKeydown`) needs the
same exemption. Prove it in `test/ui-running-detail.test.mjs`: `bootRunning` + `openGlance`, dispatch `keydown` Escape
inside the surface, assert the hash is unchanged.

**`test/shared-graph-purity.test.mjs` matches words, not code.** Over `src/shared/**` (comments stripped)
`/\b(window|document|navigator|localStorage)\b/` also fails `config.window`, `{ window: … }` and `'window'`: moving
`src/core/night/activation.mjs` there broke `npm test` ("activation.mjs: DOM global") while the night tests passed. A
regex that still catches real DOM access: `/(?<![.\w$])(window|document|navigator|localStorage)\b(?!\s*:)/` (a quoted
`'window'` still fails it). Over the RAW source of every ui/public `.js`/`.mjs` (comments and strings too), `IMPORT_RE`
(`:17`, case-sensitive) treats a lowercase `import` right before `'`, `"` or `(` as a specifier that must be relative:
the comments `Merge one import's rows` and `purpose 'import')` and the call `pickFolder('import', …)` turned it red
(2026-10-16; a value cannot be reworded, so that purpose became `'repos'`). `Import`, `import-candidates` and
`importWizardPaths` pass. Run this test after any app.js or src/shared edit; feature test lists rarely include it.
`git mv a/x.mjs src/shared/new-dir/x.mjs` needs `mkdir -p src/shared/new-dir` first.

**The Actions model cache only lives for mounted strips.** On every `actions-changed` frame, `refreshActionsStrips`
deletes the `actionsModelCache` entry of every run that has no mounted `.act-strip[data-run-id]`. That strip is the
Overview tab's, and it is Advanced only. So a new reader of the cache (the run head's Try it step, 2026-10-29 plan) must
add its run to that `mounted` map, and must repaint from `paintActionsStrips`. If it does not, its model disappears on
the first frame.

A checkout's setup state is fresher on History's row (`checkout.members[i].setup`, followed by `pipelines-changed`) than
in the model. The server writes `ok`/`failed` after the setup instance's last `actions-changed`, so a model refetched on
that frame can still show `setupQueued: true`. Read setup from the row. Read services and instances from the model.
