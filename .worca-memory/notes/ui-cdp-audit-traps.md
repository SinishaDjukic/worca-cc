---
name: ui-cdp-audit-traps
description: Read before adding a view, card, dialog, CSS class, colour or layout rule in ui/public, or auditing one in Chrome — cascade, layout, suite guards, theme
paths: ui/public/style.css, ui/public/index.html, ui/public/app.js, ui/public/*-view.mjs, ui/public/topnav.mjs, ui/public/marketplace/*.mjs, ui/public/graph/inspector.mjs, tools/verify-*-cdp.mjs, test/ui-*.test.mjs, docs/ui-primitives/mockup.html
updated: 2026-10-25T02:06:35.113Z
author: Denislav Prinov
---

jsdom has no cascade or layout: these pass every jsdom test and the suite (a rule body can pin `height:34px` while the row renders 38 px). Driving Chrome and static probe pages: [[real-browser-view-probe]].

## Global rules beat component classes
- `.textarea, textarea{min-height:120px}` beats a component's `max-height`: every new textarea sets `min-height`. `input[type="text"]{width:100%}` defeats `field-sizing:content` (`width:auto`; chips `white-space:nowrap; flex:none`).
- `textarea:focus-visible`/`input[type="text"]:focus-visible{outline}` and `:focus{background}` are (0,1,1) and outrank one class: restate under `.x:focus, .x:focus-visible`. `.card h2{margin:0 0 18px}` (0,1,1) beats a one-class margin on an `h2` in a card (scope `.card-root .x-name`); same for `.field{margin-bottom:18px}` in a gap body.
- `[hidden]`: style.css line 4 forces `display:none !important` since `9a0fc0fa` (pinned `ui-functional-css`); only on older branches (`sed -n 4p`) does an author `display:` win.
- Rule-text pins miss layout: a column flex `max-height` shrinks rows unless each is `flex:none`; `overflow-y:auto` clips `outline-offset:2px` rings (use -2px); `line-height:1` + `overflow:hidden` clips g/p/y (use /1.3). Measure N+1 items and screenshot a `:focus-visible` ring.
- Measure a popover only once positioned (`position:fixed` before `offsetWidth`; a `min(anchor, vw - w - 8)` clamp pinned it at `left:8`).
- `overflow-wrap:anywhere` on a FLEX row gives its bare text node a 1-letter min-content ("Fou/nd"): put `min-width:0; overflow-wrap:anywhere` on the value span only. A flex head `h2` holding a user string needs the same (a 90-char name pushed Close 350 px out); probe strings with no hyphens/spaces.
- A request naming N elements of a SHARED class is no licence for a global rule (`index.html` has 16 `.form-msg`): `grep -c`, scope by parent, check later same-specificity rules.
- `.ask-composer-row` is full at the 821 px sheet: measure the worst case (`makePanel` → `outerHTML` in a static `<html data-level="expert">` page at 1440 px) before adding a chip.
- Never pin "no `<p>`" on raw DOM (markdown `<p>` is agent text: `!p.closest('.af-md')`). A parsed-but-invalid def redraws the preview; only unparseable text keeps the last picture.
- Composer inspector: after a palette drop click `#gv-ins-tabs [data-tab="info"]`; every committed edit drops focus to `<body>` (`commit()` → `render()`): update controls in place.
- Focus after a modal: Chrome moves it to `<body>`, jsdom keeps it on the hidden button: assert `activeElement === el`; a stub `confirm` must `blur()`.
- Unsaved-work walks: a `showModal()` dialog stays `:modal` when its view hides (close `dialog[open]` between steps); `beforeunload` hangs `Page.navigate` until `Page.handleJavaScriptDialog`. The Workflows view has NO `beforeunload` and no window `drop` guard. Library drag: `Input.setInterceptDrags` → `dispatchDragEvent`.
- A colour complaint's screenshot may be another build: sample its pixels (`sips -s format bmp`) and `cmp` the served `style.css`.

## Top chrome and re-hosted screens
- Every `position:fixed` overlay with `top:0` paints over a new band (the header has no z-index on purpose): recompute each; stacked sticky bars hide `scrollIntoView` targets (`scroll-margin-top`).
- Top bar grid (settled): `minmax(32px,1fr) minmax(240px,440px) minmax(max-content,1fr)` — never `min-content` left, a one-sided floor starves the other side; phones (≤ 760) `auto auto`. Floor ≈ 534 px: below it the right slot slides under `.term-pane` (z 39). Hit-test every control with 1 px `elementFromPoint` scans at 820, 1100, 1280/1440, terminal 460 and max width.
- Run screens re-hosted narrower: `.rd-questions .gate-actions .btn{flex:0 0 auto}` overflows LEFT under ~350 px (restate `flex:0 1 auto; max-width:100%; white-space:normal`; one-column `.issue`, `align-self:start` on `.issue-sev`). `.rd-bar-end` needs ~670 px with the Away select (paused Resume 137 px > Pause 91 px; only the select may shrink): probe running AND paused, at 360 px too. Viewport media queries never fire for a squeezed column: container query (`inline-size` adds no layout containment). `animation … both` with a transform leaves a containing block: `backwards`.
- A host that slides in from `width:0` (the Ask side column's `askSideIn`) measures everything at open squeezed: `fitInput()` left the empty composer at its 120 px cap on EVERY show for 4 refine cycles (one even recorded the 234 px strip as normal). Refit on a width change (the existing ResizeObserver, keyed on the field's width); in Chrome compare a motion open with a reduced-motion one.
- Graph wells: `mountRunGraph` `'focus'` keeps cards as tab stops (give the host `inert`); an underline at `bottom:-1px` in `overflow-x:auto` clips (`bottom:0` + inset box-shadow). Copying the Library look: `.wfv :is(input,textarea)::placeholder` (0,1,2) beats a copied one outside `.wfv`; compare `getComputedStyle(el, '::placeholder')`.
- `.seg button` keeps UA `line-height:normal` (38 px beside a 34 px `.page-btn`); `flex:1 1 280px` on a short `.sub` wraps actions early.

## Suite guards for a new view, card or class
- `data-min-level` on BOTH nav buttons + `VIEW_MIN_LEVEL` + `VIEW_TITLES`; `ui-levels` fails a nav button/Settings tab/card without a valid `data-min-level` and a `RD_/HD_/PD_/WD_TABS` entry without `level:`; every `VIEW_NAMES` entry needs a `topnav.mjs` `PAGE_TITLES` row.
- Count pins drift: re-grep `test/` for the view name (`ui-onboarding-shell`, `ui-topnav-shell`, `ui-boot`, `ui-topnav`); `ui-id-consistency` needs every literal `#id` app.js looks up in index.html; `ui-theme-tokens` pins `.hd-diff-pane,.ask-md{`.
- Settings cards need `data-min-level`; every `.hint` ships EMPTY; ⓘ = `<button type="button" class="info-tip" aria-label="About …">i<span class="tip-content hidden">`. A Memory card is a plain `.card`. A CDP proof of an Expert view pins `uiLevel:'expert'`.
- Class namespace: grep style.css + index.html first (`ws-`, `hd-`, `pl-`, `gv-`, `ap-`, `ins-` taken; `.chev`, `.seg`, `.mono`, `.sp`, `.switch`, `.chip-select` are app-wide; `.field` is the wrapper).

## Colour tokens and theme census
- `ui-theme-tokens`: every colour `--*` in `:root` is `light-dark(A,B)` except `EQUAL_ARMS`; a new family needs its name, hex in the pinned array and both `PAIRS`/`DARK_ONLY` lists (pick with the test's `contrast`); no raw hex/`rgb(`/`hsl(`/`white`/`black` outside token blocks (masks: `currentColor`). `ui-sidebar-compact` bans `\b298\b|\b76px\b`. A CSS task's Run line names both.
- `--green-ink`/`--red-ink` fail on grey hover in light mode: `--green-ink-strong`; `--ink-2` for muted text (`--ink-3` is baselined). `color-mix()` on `color` is invisible to the verifier.
- `verify:theme` (~200 s) exit code depends on host and checkpoint (it already fails 3 at P6 checkpoint `c9752c84`): run `-- --out <mktemp>` on tree AND a checkpoint clone, diff Sets of `key()` (non-advisory, minus `ALLOW_DRIFT`); only NEW keys count; `--states <id>` ~1 min; never regenerate the baseline; judge a re-recorded baseline as a SET. It renders no chat card/composer chip: probe a seeded scratch copy.
- `verify:scripts` check 9 fails in macOS Dark; `verify:run-monitor` reads the real settings (`HOME=$(mktemp -d)`). CI's `cdp` job runs 7 proofs (composer, run-monitor, theme, memory, scripts, ask-forms, workspace-map).
- Retuning a shared value token: resolve each declaration against both `:root`s in node, list selectors whose resolved value changed, classify by where they render; graphify does not see CSS.
