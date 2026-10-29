---
name: extension-css-cut-sections
description: Read before adding Ask/Chat composer CSS the browser extension also renders, or refreshing its Linux Playwright screenshots without docker.
paths: ui/public/style.css, tools/extension-css.mjs, e2e/extension/**
updated: 2026-10-29T14:11:20.958Z
author: Bulibas
---

**The extension's sidebar CSS is CUT from ui/public/style.css by section markers, not copied.** `tools/extension-css.mjs`
`SIDEBAR_PIECES` takes only named slices (the "Ask Worca" section ~5808-6669, "Chat P1: shell" up to "Chat P2: Action
cards", Pinpoint, buttons, form, tokens…). A rule appended anywhere else (e.g. next to `.ask-divider-*` in Chat P2+)
works in the app and in every jsdom pin but never reaches the sidebar. Seen on #943 (PR 982): the new
`.ask-model-btn-engine` base rule and its phone hide sat at ~9231, so the 400px sidebar showed "Claude Opus 5.5" and
`e2e/extension/composer.spec.mjs` failed "scope label fits" (label 19px for 62px of text).
- Put composer rules in the Ask section (base look) or the Chat P1 block (phone `@media (max-width:480px)`); the
  `@container chat-convo` twin is app-only. Pin with `sidebarCss(style, '')` in `test/extension-css.test.mjs`.
- Anything widening the composer row's model button must also hide at <= 480px / the 520px container, like
  `.ask-model-btn-effort`: `verify:theme`'s "scope label: #chat/new at 290px" fails on `rowScroll:false`.
  Fast proof: `npm run verify:theme -- --states layout-widths --out <mktemp>` (~1 min, CDP_PORT of your own).

**Refreshing `__screenshots__/*-linux.png` without docker** (`e2e:extension:update-linux` needs it): the CI job uploads
`extension-playwright-report`; `gh run download <run> -n extension-playwright-report` holds expected (sha = the committed
file), actual and diff PNGs under `data/`. The actual is the CURRENT commit's render: if your fix changes a region,
paste that pixel band from the old baseline (PIL, run outside the download dir) after diffing rows to find the bands.
`npx playwright install chromium` is needed once to run the specs locally. Under a temp HOME also set
`PLAYWRIGHT_BROWSERS_PATH=<real HOME>/Library/Caches/ms-playwright` (else "Executable doesn't exist"). `*-darwin.png`
baselines ARE tracked but CI never gates them, and some are stale (~3%). To check a splice, render darwin into a
scratch copy with `--update-snapshots -g "model popover"` and compare its structure with the linux PNG.
