# Blue `@file` Mention Highlighting Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the New Pipeline prompt textareas, render an `@mention` blue when — and only when — it names a file currently attached as an extra, and keep that state correct through typing, pasting, popup completion, `.md` loads, and files being added or removed.

**Architecture:** A textarea cannot colour part of its own text, so each of the two textareas is wrapped at runtime in `div.ta-hl` and given a sibling `div.ta-hl-back` positioned `inset:0` behind it. The textarea keeps its own text but renders it transparent; the backdrop mirrors the same characters and paints valid mentions with `span.mention-ok`. Because the backdrop is out of flow, the wrapper is sized by the textarea alone, so resize-drag and reflow need no observer to keep the two **boxes** aligned — but the scrollbar gutter does need one, because a scrollbar appearing or vanishing changes the textarea's content width without changing its border box. Validity comes from a name index rebuilt only when the attachment set changes; the per-keystroke path is one `indexOf('@')` scan plus a comparison that skips the DOM entirely when nothing changed.

**Tech Stack:** Vanilla ES-module browser JS (`ui/public/app.js`, 10.8k lines, no framework), plain CSS (`ui/public/style.css`, no preprocessor, no dark theme), `node:test` + `jsdom` for tests.

**Spec:** `docs/superpowers/specs/2026-08-20-mention-highlight-design.md`

**Supersedes:** `docs/superpowers/plans/2026-08-20-mention-highlight.md` (v1). Review that produced this revision: `docs/superpowers/plans/2026-08-20-mention-highlight-review-cycle1.md`.

## What changed from v1

| # | v1 defect | v2 fix |
|---|---|---|
| M1 | The wrapper's margin transfer **deleted the 11px gap** above the prompt and left the backdrop **6px taller** than the textarea. A textarea is `display:inline-block`, so its inline `margin-top:11px` never collapses today; moving it to a *block* wrapper made it a collapsible block margin that escaped through `.source-pane` and `.field` and merged with the preceding `margin-bottom:18px`. The inline-block textarea inside a block wrapper also added a ~6px strut descender, so the backdrop's field fill spilled past the rounded border. Measured in Chrome 151: pane→textarea gap `11px → 0px`, pane height `171 → 160`, backdrop height `+6px`. | The wrapper is `display:inline-block; width:100%; vertical-align:top` (inline-block margins do not collapse) and the textarea becomes `display:block` inside it (no strut). Measured: gap back to `11px`, backdrop−textarea height delta `0`. Task 1 Steps 3–4. |
| M2 | The **scrollbar gutter went stale** on any geometry change that fires no `input` — resize-grip drag, window resize, the Poppins webfont swapping in. Measured impact: `ta.scrollHeight 404` vs `back.scrollHeight 383`, a full 21px line of wrap divergence, so every mention past that point painted on the wrong characters. | A `typeof`-guarded `ResizeObserver` per textarea plus a `document.fonts.ready` hook, both calling a geometry-only refresh that never rescans. Task 4 Step 5. |
| M3 | **Forced-colors / Windows High Contrast** forced the textarea's `color:transparent` back to `CanvasText` while its background stayed transparent, so both layers' glyphs painted at once and `--blue-ink` flattened to black — the feature's only signal gone, in the app's primary input. | An `@media (forced-colors: active)` block hides the backdrop and restores `CanvasText`/`Canvas` on the textarea. Task 1 Step 3. |
| — | The right-boundary class treated punctuation as an unconditional terminator, so with only `a.txt` attached the text `@a.txt.bak` wrongly painted `@a.txt` blue — the exact false claim the feature exists to prevent. | `mentionEndsCleanly()` — trailing punctuation counts as a boundary only when it is itself followed by end-of-text, whitespace, or more punctuation. Verified against 21 cases with zero regressions. Task 2 Step 3, with a test. |
| m4 | Two of the four TDD "verify it fails" states were wrong (negative-assertion tests are green before the feature exists). | Corrected counts, with the already-green tests named. Task 2 Step 2, Task 3 Step 2. |
| m5 | `attachMentionHighlight`'s idempotency guard was untested, and the Self-Review claimed full coverage of spec test 19 while silently substituting a different assertion. | Idempotency test added to Task 1; the spec-19 deviation is declared in the Self-Review. |
| s6 | `sig` concatenated the whole prompt on every repaint, including the ones that short-circuit — a full-prompt allocation to decide to do nothing, in a feature whose headline requirement is performance. | `st.text` and `st.marksKey` compared separately; no concatenation. Task 1 Step 4. |
| s8 | `mentionIndex.maxLen` was dead weight, read only as "are any files attached". | Dropped; the guard is `byFirstChar.size`. Task 2 Step 3. |

Confirmed sound in v1 and carried over unchanged: every `file:line` citation, the initialisation ordering (no TDZ risk), the closed `.value` surface, all 19 text-metric properties measured identical on both layers, the popup's `mentionAnchor` being unaffected by wrapping, and the scanner's cost — **0.85 ms worst case** at the 20k cap with 50 same-first-letter names, coalesced to once per frame.

## Global Constraints

- **Never commit `docs/superpowers/**`.** Plans and specs stay untracked in this repo. `git add` explicit paths only — never `git add -A` or `git add .`.
- **No new dependencies.** `ui/public/app.js` is served raw to the browser; no bundler, no imports beyond what is already there.
- **`innerHTML` is banned in this feature.** File names are user-controlled and may contain `<`. Build DOM with `document.createElement` / `document.createTextNode` / `textContent` only.
- **The two layers must agree on every property that affects text layout.** Do not treat this as a checklist of named properties — the real set is about twenty (`font-family`, `font-size`, `font-weight`, `font-style`, `font-variant`, `line-height`, `letter-spacing`, `word-spacing`, `tab-size`, `text-indent`, `text-align`, `direction`, `hyphens`, `white-space`, `overflow-wrap`, `word-break`, `padding`, `border-width`, `box-sizing`, plus the scrollbar's share of the content width). Parity comes from the shared rule at `style.css:276` and a shared inheritance chain, not from enumeration. The single reliable detector is **`ta.scrollHeight === back.scrollHeight` on wrapped text** — it reads `404` vs `383` the moment one property diverges. `.mention-ok` therefore sets **`color` only**.
- **The submit payload must stay byte-identical.** No code in this feature may read or write `textarea.value` outside the paths listed here. `ui/public/app.js:6523` (`el.prompt.value.trim()`) and `:6524` (`el.promptMarkdown.value.trim()`) must be untouched.
- **jsdom has no `requestAnimationFrame` and no `ResizeObserver`, and every geometry read returns `0` without throwing.** Guards must be value-based (`typeof x === 'function'`, `parseFloat(v) || 0`), never `try/catch`. Every scheduler needs a `setTimeout(fn, 0)` fallback.
- **Case-sensitive** name matching for the blue state (spec D4). The completion popup keeps its existing case-insensitive filtering — do not change it.
- Palette tokens: `--blue-ink:#3782A8`, `--ink:#19191B`, `--field:#F6F6F4`, `--r-ctrl:14px`. Single `:root` block, no theme switching — which is unrelated to `forced-colors`, handled separately.
- Run the full suite with `npm test` (this is `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/*.mjs`). A single file runs as `node --test test/<file>.test.mjs`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ui/public/style.css` | Presentation of the wrapper, backdrop, transparent textarea, blue span, and the forced-colors opt-out. | Add `.ta-hl-back` to the shared control-metrics selector at `:276`; append a new block after the existing `.mention-item.sel` rule at `:381`. |
| `ui/public/app.js` | The highlighter: attach, scan, paint, schedule, geometry sync. One new section placed immediately after `attachMentionAutocomplete(el.promptMarkdown);` (`:4723`), plus five one-line hooks at existing call sites. | ~135 new lines + 5 hooks. |
| `test/ui-newpipeline-mention-highlight.test.mjs` | jsdom coverage of structure, validity rules, reactivity, and the no-churn short-circuit. | Create. |
| `ui/public/index.html` | — | **No change.** The wrapper and backdrop are created in JS so both textareas, and any future one, are served by a single `attachMentionHighlight(ta)` call. |

**Why the new section goes after `:4723`:** two hook sites run at module init — `syncSourceToggle()` at `ui/public/app.js:10811` and `showView(...)` at `:10821`, which reaches the Task 3 Step 4(e) hook. Both are far past `:4724`, so the section's module-level `let mentionIndex` and `const` declarations are initialised before either fires. Placing the section later than `:10811` would break both. Verified against the real file, not assumed.

**What jsdom cannot test, and where it is covered instead.** Every geometry read is `0` under jsdom, so glyph alignment, the 11px gap, the scrollbar gutter, scroll sync, the `ResizeObserver`/font-swap refreshes, and the forced-colors opt-out are **all** browser-only. They are covered by the mandatory measured checks in Task 4 Step 7, which is not optional polish — it is the only place three of this plan's four hardest defects are observable.

---

### Task 1: Backdrop scaffolding — the mirror, with no highlighting yet

Establishes the two-layer structure and proves the backdrop tracks `.value` exactly. Nothing turns blue in this task.

**Files:**
- Modify: `ui/public/style.css:276-277` (add `.ta-hl-back` to the selector list), `ui/public/style.css:381` (append new block after)
- Modify: `ui/public/app.js:4723` (append new section after this line)
- Create: `test/ui-newpipeline-mention-highlight.test.mjs`

**Interfaces:**
- Consumes: `el.prompt`, `el.promptMarkdown` (`ui/public/app.js:110-111`).
- Produces:
  - `attachMentionHighlight(ta: HTMLTextAreaElement): void` — idempotent; wraps `ta`, creates its backdrop, stores state on `ta._mentionHl`.
  - `scheduleMentionHighlight(ta: HTMLTextAreaElement): void` — coalesced repaint request; safe to call on an unattached element (no-op).
  - `repaintMentionHighlight(ta): void`, `paintMentionBackdrop(back: HTMLElement, text: string, marks: number[]): void`, `syncMentionScroll(ta): void`.
  - `ta._mentionHl = { back, queued, text, marksKey, gutter, padRight, borderX }`.
  - Task 2 replaces the `marks` argument (empty in this task) with real scan output; Task 3 calls `scheduleMentionHighlight`; Task 4 adds `syncMentionGutter(ta)`, `syncMentionMetrics(ta)` and the length cap.

---

- [ ] **Step 1: Write the failing test file**

Create `test/ui-newpipeline-mention-highlight.test.mjs`. The `boot()` / `pickFiles` harness is copied from `test/ui-newpipeline-extras.test.mjs:9-45` — the canonical jsdom boot in this repo. Do not try to share it; every UI test file in `test/` duplicates it.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    }
    if (String(url).includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

// Simulate the OS file picker returning `names` (a FileList is read-only).
function pickFiles(window, names) {
  const input = window.document.querySelector('#extras');
  const files = names.map((n) => new window.File(['x'], n, { type: 'text/plain' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// The highlighter defers its repaint one turn (rAF in a browser, setTimeout
// under jsdom), so every assertion is preceded by a flush.
const flush = () => new Promise((r) => setTimeout(r, 0));

const backOf = (window, sel = '#prompt') =>
  window.document.querySelector(sel).parentNode.querySelector('.ta-hl-back');

const blues = (window, sel = '#prompt') =>
  [...backOf(window, sel).querySelectorAll('.mention-ok')].map((n) => n.textContent);

function typeIn(window, sel, text) {
  const ta = window.document.querySelector(sel);
  ta.value = text;
  ta.selectionStart = ta.selectionEnd = text.length;
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  return ta;
}

test('each prompt textarea is wrapped in a highlight layer', async () => {
  const { window } = await boot();
  for (const sel of ['#prompt', '#promptMarkdown']) {
    const ta = window.document.querySelector(sel);
    assert.equal(ta.parentNode.className, 'ta-hl', `${sel} is not wrapped`);
    const back = backOf(window, sel);
    assert.ok(back, `${sel} has no backdrop`);
    // Backdrop is painted first so the textarea stacks on top of it.
    assert.equal(back.nextElementSibling, ta);
    assert.equal(back.getAttribute('aria-hidden'), 'true');
  }
});

test('the backdrop mirrors the textarea text exactly', async () => {
  const { window } = await boot();
  const text = 'line one\n\nline three with  double  spaces\ttab\n';
  typeIn(window, '#prompt', text);
  await flush();
  assert.equal(backOf(window).textContent, text);
});

test('the textarea margin rides on the wrapper so both layers share an origin', async () => {
  const { window } = await boot();
  const ta = window.document.querySelector('#prompt');
  // index.html:226 ships style="margin-top:11px" on the textarea itself. Left
  // there it would push the textarea 11px below the backdrop's top edge.
  // NOTE: this asserts the mechanism only. That the 11px of layout SURVIVES the
  // move is invisible to jsdom and is measured in Task 4 Step 7.
  assert.equal(ta.style.marginTop, '0px');
  assert.equal(ta.parentNode.style.marginTop, '11px');
});

test('attaching twice does not double-wrap', async () => {
  const { window } = await boot();
  const ta = window.document.querySelector('#prompt');
  const wrap = ta.parentNode;
  // app.js calls attachMentionHighlight(el.prompt) at module scope; re-running
  // it must be a no-op, not a second wrapper and a second backdrop.
  assert.equal(wrap.querySelectorAll('.ta-hl-back').length, 1);
  assert.equal(wrap.parentNode.id, 'prompt-pane');
  assert.equal(window.document.querySelectorAll('.ta-hl').length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: 0 PASS / 4 FAIL. The first three fail on `#prompt is not wrapped` (`ta.parentNode.className` is `source-pane`); the fourth fails on `.ta-hl-back` being absent.

- [ ] **Step 3: Add the CSS**

Edit `ui/public/style.css:276`. The shared metrics rule currently reads:

```css
.input,.select,.textarea,
input[type="text"],input[type="number"],textarea,select{
```

Change the first line to include the backdrop, so its padding, border width, font and box-sizing can never drift from the textarea's:

```css
.input,.select,.textarea,.ta-hl-back,
input[type="text"],input[type="number"],textarea,select{
```

Then append this block immediately after `.mention-item.sel{...}` at `ui/public/style.css:381`:

```css

/* @-mention highlighting: a textarea cannot colour part of its own text, so a
   backdrop mirrors the text underneath it and paints the valid mentions. The
   textarea keeps its glyphs (and its caret, selection, spellcheck and undo
   stack) but renders them transparent; the backdrop carries the field fill it
   gave up. .mention-ok sets COLOUR ONLY — any metric-affecting property would
   advance the backdrop's glyphs differently and drift the two layers apart.

   The wrapper is inline-block on purpose. A textarea is inline-block by UA
   default, so the inline margin-top:11px on #prompt/#promptMarkdown does not
   collapse today; a block wrapper would turn it into a collapsible block margin
   that escapes through .source-pane and .field and merges with the preceding
   margin-bottom:18px, deleting the gap. Making the textarea display:block
   inside removes the line-box strut that would otherwise leave the backdrop
   ~6px taller than the textarea. */
.ta-hl{position:relative;display:inline-block;width:100%;vertical-align:top;}
.ta-hl > textarea.textarea,
.ta-hl > textarea.textarea:focus{display:block;position:relative;z-index:1;
  background:transparent;color:transparent;caret-color:var(--ink);}
.ta-hl > textarea.textarea::selection{background:rgba(25,25,27,.16);}
.ta-hl-back{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  line-height:1.5;white-space:pre-wrap;overflow-wrap:break-word;border-color:transparent;}
.ta-hl:focus-within .ta-hl-back{background:#fff;}
.mention-ok{color:var(--blue-ink);}

/* High Contrast forces the textarea's transparent text back to CanvasText while
   its background stays transparent, so both layers' glyphs would paint at once,
   and it flattens --blue-ink to black anyway. Opt the whole trick out. */
@media (forced-colors: active){
  .ta-hl-back{display:none;}
  .ta-hl > textarea.textarea,
  .ta-hl > textarea.textarea:focus{color:CanvasText;background:Canvas;}
}
```

Three notes, all deliberate:
- `.textarea:focus` at `style.css:284` is `(0,2,0)` and sets `background:#fff`. `.ta-hl > textarea.textarea:focus` is `(0,3,1)` and beats it, which is why the selector is written that way rather than as a bare `.ta-hl > textarea`.
- The backdrop inherits `border:1.5px solid transparent` and `border-radius:var(--r-ctrl)` from the shared rule. It is never focused, so its border stays transparent; `border-color:transparent` is restated only as a guard against future `:focus-within` rules.
- `line-height:1.5` is restated on the backdrop because it comes from `.textarea,textarea{...}` at `style.css:288`, which the backdrop is deliberately *not* added to (that rule also carries `resize` and `min-height`, neither of which belongs on an absolutely positioned layer).

- [ ] **Step 4: Add the highlighter section**

Append to `ui/public/app.js` immediately after line 4723 (`attachMentionAutocomplete(el.promptMarkdown);`):

```js

// ---------------------------------------------------------------------------
// @-mention highlighting: a mention that names a currently-attached extra file
// renders blue; everything else stays normal ink. A textarea cannot colour part
// of its own text, so each one is wrapped in a `.ta-hl` and given a `.ta-hl-back`
// backdrop that mirrors the same characters. The textarea sits on top with
// transparent glyphs — it keeps the caret, selection, spellcheck, undo stack and
// `.value` semantics; only the colour comes from underneath.
// ---------------------------------------------------------------------------

// jsdom has no requestAnimationFrame (JSDOM is constructed without
// pretendToBeVisual), so the scheduler degrades to a macrotask.
const mentionRaf = (fn) =>
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0));

// One repaint per frame per textarea, at most.
function scheduleMentionHighlight(ta) {
  const st = ta && ta._mentionHl;
  if (!st || st.queued) return;
  st.queued = true;
  mentionRaf(() => { st.queued = false; repaintMentionHighlight(ta); });
}

// `marks` is a flat [start, end, start, end, ...] list of ranges to paint blue,
// each range including its leading "@". Task 2 fills it in; here it is empty.
function paintMentionBackdrop(back, text, marks) {
  const nodes = [];
  let at = 0;
  for (let k = 0; k < marks.length; k += 2) {
    if (marks[k] > at) nodes.push(document.createTextNode(text.slice(at, marks[k])));
    const span = document.createElement('span');
    span.className = 'mention-ok';
    span.textContent = text.slice(marks[k], marks[k + 1]);   // textContent, never innerHTML
    nodes.push(span);
    at = marks[k + 1];
  }
  nodes.push(document.createTextNode(text.slice(at)));
  // A trailing newline opens a line box in a textarea but not reliably in a div,
  // so the last row would be short by one. <br> forces it and contributes
  // nothing to textContent, keeping `back.textContent === ta.value` exactly true.
  nodes.push(document.createElement('br'));
  back.replaceChildren(...nodes);
}

// The backdrop is `overflow:hidden`, which is still programmatically scrollable.
function syncMentionScroll(ta) {
  const st = ta._mentionHl;
  if (st.back.scrollTop !== ta.scrollTop) st.back.scrollTop = ta.scrollTop;
  if (st.back.scrollLeft !== ta.scrollLeft) st.back.scrollLeft = ta.scrollLeft;
}

function repaintMentionHighlight(ta) {
  const st = ta._mentionHl;
  if (!st) return;
  const text = ta.value;
  const marks = [];
  const marksKey = marks.length ? marks.join(',') : '';
  // Compared, never concatenated: a redundant trigger (a pane revealed, extras
  // re-rendered with an unchanged set) must not allocate a copy of the prompt
  // just to decide to do nothing.
  if (text !== st.text || marksKey !== st.marksKey) {
    paintMentionBackdrop(st.back, text, marks);
    st.text = text;
    st.marksKey = marksKey;
  }
  syncMentionScroll(ta);
}

function attachMentionHighlight(ta) {
  if (!ta || ta._mentionHl) return;                       // idempotent
  const cs = window.getComputedStyle(ta);
  const num = (v) => parseFloat(v) || 0;                  // jsdom returns "" / "medium"
  const wrap = document.createElement('div');
  wrap.className = 'ta-hl';
  const back = document.createElement('div');
  back.className = 'ta-hl-back';
  back.setAttribute('aria-hidden', 'true');               // the textarea is the accessible copy
  // The margin must ride on the wrapper, or the textarea starts 11px below the
  // backdrop's top edge. The wrapper is inline-block (see the CSS block), so
  // this margin does not collapse away the way a block wrapper's would.
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    wrap.style[`margin${side}`] = cs[`margin${side}`] || '0px';
  }
  ta.parentNode.insertBefore(wrap, ta);
  wrap.append(back, ta);                                  // backdrop first: it stacks below
  ta.style.margin = '0px';
  ta._mentionHl = {
    back,
    queued: false,
    text: null,
    marksKey: null,
    gutter: 0,
    padRight: num(cs.paddingRight),
    borderX: num(cs.borderLeftWidth) + num(cs.borderRightWidth),
  };
  ta.addEventListener('input', () => scheduleMentionHighlight(ta));
  ta.addEventListener('scroll', () => syncMentionScroll(ta));
  scheduleMentionHighlight(ta);
}

attachMentionHighlight(el.prompt);
attachMentionHighlight(el.promptMarkdown);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: PASS — 4/4.

- [ ] **Step 6: Run the two neighbouring suites for regressions**

Run: `node --test test/ui-newpipeline-extras.test.mjs test/ui-agents-accordion.test.mjs`
Expected: PASS. `ui-agents-accordion.test.mjs:571` asserts no `#prompt` leaks into an agent row and `:581` asserts New-Pipeline field ordering — both must survive the re-parenting.

- [ ] **Step 7: Commit**

```bash
git add ui/public/app.js ui/public/style.css test/ui-newpipeline-mention-highlight.test.mjs
git commit -m "feat(ui): backdrop mirror layer behind the prompt textareas"
```

---

### Task 2: The validity engine — index, scanner, blue spans

Turns the mirror into a highlighter. This is where every rule from spec §4 lands.

**Files:**
- Modify: `ui/public/app.js` (the section added in Task 1), `ui/public/app.js:4566-4568` (`renderExtrasPills` tail)
- Modify: `test/ui-newpipeline-mention-highlight.test.mjs`

**Interfaces:**
- Consumes: `extrasFiles` (`ui/public/app.js:4542`, a module-level `let` that is **reassigned** on removal — always read the live binding), `paintMentionBackdrop`, `repaintMentionHighlight` from Task 1.
- Produces:
  - `rebuildMentionIndex(): void` — refreshes the module-level `mentionIndex`.
  - `mentionEndsCleanly(text: string, end: number): boolean`.
  - `scanMentions(text: string): number[]` — flat `[start, end, ...]` ranges, each including the leading `@`.
  - `mentionIndex: { byFirstChar: Map<string, string[]> }` — buckets sorted longest-first.
  - Task 3 calls `rebuildMentionIndex()`; Task 4 gates `scanMentions` behind a length cap.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-newpipeline-mention-highlight.test.mjs`:

```js
test('a mention naming an attached file turns blue; an unknown one does not', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  typeIn(window, '#prompt', 'read @a.txt then @nope.txt please');
  await flush();
  assert.deepEqual(blues(window), ['@a.txt']);
});

test('a hand-typed mention counts — the popup is not involved', async () => {
  const { window } = await boot();
  pickFiles(window, ['spec.md']);
  typeIn(window, '#prompt', '@spec.md');
  await flush();
  assert.deepEqual(blues(window), ['@spec.md']);
  assert.equal(backOf(window).textContent, '@spec.md');
});

test('greedy longest-match spans a file name containing spaces', async () => {
  const { window } = await boot();
  pickFiles(window, ['my report.pdf']);
  typeIn(window, '#prompt', 'see @my report.pdf and then stop');
  await flush();
  assert.deepEqual(blues(window), ['@my report.pdf']);
});

test('the longest of two overlapping names wins', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt', 'a.txt.bak']);
  typeIn(window, '#prompt', 'diff @a.txt.bak against @a.txt');
  await flush();
  assert.deepEqual(blues(window), ['@a.txt.bak', '@a.txt']);
});

test('a longer name that is NOT attached does not light up its attached prefix', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);                  // note: a.txt.bak is NOT attached
  typeIn(window, '#prompt', 'restore @a.txt.bak now');
  await flush();
  assert.deepEqual(blues(window), []);
});

test('an @ that does not start a word is not a mention', async () => {
  const { window } = await boot();
  pickFiles(window, ['example.com']);
  typeIn(window, '#prompt', 'mail me at bob@example.com ok');
  await flush();
  assert.deepEqual(blues(window), []);
});

test('a mention must end on a boundary', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  typeIn(window, '#prompt', 'open @a.txt2 now');
  await flush();
  assert.deepEqual(blues(window), []);
});

test('trailing sentence punctuation still leaves the mention blue', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  typeIn(window, '#prompt', 'open @a.txt. Then @a.txt, and @a.txt');
  await flush();
  assert.deepEqual(blues(window), ['@a.txt', '@a.txt', '@a.txt']);
});

test('matching is case-sensitive — a blue mention must resolve on disk', async () => {
  const { window } = await boot();
  pickFiles(window, ['readme.md']);
  typeIn(window, '#prompt', 'check @README.MD');
  await flush();
  assert.deepEqual(blues(window), []);
});

test('with no attached files nothing is highlighted', async () => {
  const { window } = await boot();
  typeIn(window, '#prompt', 'a prompt mentioning @anything.txt at all');
  await flush();
  assert.deepEqual(blues(window), []);
  assert.equal(backOf(window).textContent, 'a prompt mentioning @anything.txt at all');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: **9 PASS / 5 FAIL** (not 14/0 and not 4/10). With `const marks = []` still hard-coded in `repaintMentionHighlight`, five of the ten new tests assert `deepEqual(blues(window), [])` and are therefore green before the feature exists: *a longer name that is NOT attached…*, *an @ that does not start a word…*, *a mention must end on a boundary*, *matching is case-sensitive…*, *with no attached files…*. That is expected — a negative assertion can never be red-first. They are still falsifiable: a too-greedy scanner breaks every one of them. The five that must be red are the positive ones.

- [ ] **Step 3: Add the index and the scanner**

Insert into the highlighter section of `ui/public/app.js`, immediately **above** `const mentionRaf = ...`:

```js
// Same left-boundary class mentionTokenAt uses, so "bob@example.com" is never a
// mention.
const MENTION_LEFT_BOUNDARY = /[\s([{'"`,;:]/;
// Punctuation that may TRAIL a mention — but only when it is itself terminal.
const MENTION_RIGHT_PUNCT = /[)\]}'"`,;:.!?]/;

// A mention ends cleanly at end-of-text, at whitespace, or at trailing
// punctuation that is followed by end-of-text, whitespace, or more punctuation.
// Punctuation glued to more name characters belongs to a LONGER name, so with
// only "a.txt" attached, "@a.txt.bak" must light up nothing at all — it names a
// file that is not here, and painting its prefix blue is exactly the false claim
// this feature exists to prevent. The same test keeps "@a.txt.", "@a.txt,",
// "@a.txt...", "(@a.txt)" and '"@a.txt".' blue.
function mentionEndsCleanly(text, end) {
  if (end >= text.length) return true;
  const c = text[end];
  if (/\s/.test(c)) return true;
  if (!MENTION_RIGHT_PUNCT.test(c)) return false;
  const n = text[end + 1];
  return n === undefined || /\s/.test(n) || MENTION_RIGHT_PUNCT.test(n);
}

// Rebuilt only when the attachment set changes — never on the keystroke path.
// Buckets are keyed by first character and sorted longest-first so the greedy
// match is the first hit, not a search.
let mentionIndex = { byFirstChar: new Map() };

function rebuildMentionIndex() {
  const byFirstChar = new Map();
  for (const f of extrasFiles) {
    const n = f && f.name;
    if (!n) continue;
    const bucket = byFirstChar.get(n[0]);
    if (bucket) bucket.push(n); else byFirstChar.set(n[0], [n]);
  }
  for (const bucket of byFirstChar.values()) bucket.sort((a, b) => b.length - a.length);
  mentionIndex = { byFirstChar };
}

// Flat [start, end, start, end, ...] ranges of valid mentions, each including
// the leading "@". One left-to-right pass: indexOf skips ordinary text at native
// speed and real work happens only at an "@", bounded by the number of attached
// names sharing the next character.
function scanMentions(text) {
  const marks = [];
  const { byFirstChar } = mentionIndex;
  if (!byFirstChar.size || !text) return marks;
  let i = text.indexOf('@');
  while (i >= 0) {
    if (i === 0 || MENTION_LEFT_BOUNDARY.test(text[i - 1])) {
      const bucket = byFirstChar.get(text[i + 1]);       // undefined when "@" is last
      if (bucket) {
        for (const name of bucket) {                    // longest first
          const end = i + 1 + name.length;
          if (text.startsWith(name, i + 1) && mentionEndsCleanly(text, end)) {
            marks.push(i, end);
            i = end - 1;                                // resume past the match
            break;
          }
        }
      }
    }
    i = text.indexOf('@', i + 1);
  }
  return marks;
}
```

- [ ] **Step 4: Wire the scanner into the repaint**

In `repaintMentionHighlight`, replace:

```js
  const marks = [];
```

with:

```js
  const marks = scanMentions(text);
```

- [ ] **Step 5: Rebuild the index whenever the attachment set changes**

The three `extrasFiles` mutation sites (`ui/public/app.js:4560`, `:4575`, `:4576`) all funnel through `renderExtrasPills()`, so one hook covers all of them. `rebuildMentionIndex` is a hoisted function declaration, so calling it from a function defined earlier in the file is fine.

Append at the very end of `renderExtrasPills()` — after the `el.extrasNote.textContent = ...` assignment that closes the function (`ui/public/app.js:4566-4568`):

```js
  rebuildMentionIndex();
```

(The repaint that makes this visible is added in Task 3; this task's tests pass because `pickFiles` runs before the text is typed.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: PASS — 14/14.

- [ ] **Step 7: Commit**

```bash
git add ui/public/app.js test/ui-newpipeline-mention-highlight.test.mjs
git commit -m "feat(ui): blue-highlight @mentions that name an attached extra file"
```

---

### Task 3: Reactivity — every way the text or the attachment set can change

Task 2 only repaints on `input`. Four other things change the answer and fire no `input` event.

**Files:**
- Modify: `ui/public/app.js:4533` (`.md` load), `:4566-4568` (`renderExtrasPills` tail), `:4680` (`applyMention` tail), `:4377` (`syncSourceToggle` tail), `:10741` (`showView` `'new'` branch)
- Modify: `test/ui-newpipeline-mention-highlight.test.mjs`

**Interfaces:**
- Consumes: `scheduleMentionHighlight`, `rebuildMentionIndex`.
- Produces: `refreshMentionHighlights(): void` — rebuild-free repaint request for both textareas; called from the reveal hooks.

**Verified non-gaps** (do not add hooks for these — checked against the real code): browser autofill does not apply to textareas; undo, redo, cut, dragging text into the textarea, and IME commit all fire `input`; the `#source-seg` plugin buttons wrapping and `<details id="advanced-config">` opening change vertical position only, never the textarea's width; both programmatic `.value` writers are hooked below. Geometry-only changes (resize-grip drag, window resize, webfont swap) are real gaps but need no *rescan* — they are handled in Task 4 Step 5.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-newpipeline-mention-highlight.test.mjs`:

```js
test('removing a file turns its mention black again, leaving the text intact', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  const text = 'please read @a.txt carefully';
  typeIn(window, '#prompt', text);
  await flush();
  assert.deepEqual(blues(window), ['@a.txt']);

  window.document.querySelector('#extrasPills .extra-pill-x').click();
  await flush();
  assert.deepEqual(blues(window), []);
  assert.equal(backOf(window).textContent, text);          // text untouched
  assert.equal(window.document.querySelector('#prompt').value, text);
});

test('removing one of two files only de-highlights that one', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt', 'b.txt']);
  typeIn(window, '#prompt', '@a.txt and @b.txt');
  await flush();
  assert.deepEqual(blues(window), ['@a.txt', '@b.txt']);

  const pills = [...window.document.querySelectorAll('#extrasPills .extra-pill')];
  const aRow = pills.find((p) => p.querySelector('.extra-pill-name').textContent === 'a.txt');
  aRow.querySelector('.extra-pill-x').click();
  await flush();
  assert.deepEqual(blues(window), ['@b.txt']);
});

test('attaching a file lights up a mention already in the prompt', async () => {
  const { window } = await boot();
  typeIn(window, '#prompt', 'compare @late.csv with the notes');
  await flush();
  assert.deepEqual(blues(window), []);

  pickFiles(window, ['late.csv']);
  await flush();
  assert.deepEqual(blues(window), ['@late.csv']);
});

test('a pasted prompt is validated on arrival', async () => {
  const { window } = await boot();
  pickFiles(window, ['design.md']);
  // jsdom cannot mutate a textarea from a ClipboardEvent, so a value-set plus
  // `input` is the honest model of a paste — which is exactly the path a real
  // paste takes: it reaches the textarea natively and fires `input`.
  typeIn(window, '#prompt', 'Context from a chat log:\n\n@design.md is the spec, @gone.md is not.\n');
  await flush();
  assert.deepEqual(blues(window), ['@design.md']);
});

test('picking from the completion popup leaves the inserted mention blue', async () => {
  const { window } = await boot();
  pickFiles(window, ['notes.txt']);
  const ta = typeIn(window, '#prompt', 'see @not');
  await flush();
  assert.deepEqual([...window.document.querySelectorAll('#mention-popup .mention-item')]
    .map((n) => n.textContent), ['notes.txt']);
  ta.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  await flush();
  assert.equal(ta.value, 'see @notes.txt ');
  assert.deepEqual(blues(window), ['@notes.txt']);
});

test('loading a .md file repaints the markdown backdrop', async () => {
  const { window } = await boot();
  pickFiles(window, ['data.csv']);
  const input = window.document.querySelector('#mdFile');
  const md = new window.File(['# Spec\n\nUse @data.csv here.\n'], 'spec.md', { type: 'text/markdown' });
  Object.defineProperty(input, 'files', { value: [md], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  // The handler awaits File.text(); give it a couple of turns before flushing.
  await new Promise((r) => setTimeout(r, 0));
  await flush();
  assert.equal(backOf(window, '#promptMarkdown').textContent,
    window.document.querySelector('#promptMarkdown').value);
  assert.deepEqual(blues(window, '#promptMarkdown'), ['@data.csv']);
});

test('the markdown textarea highlights on its own input too', async () => {
  const { window } = await boot();
  pickFiles(window, ['x.json']);
  typeIn(window, '#promptMarkdown', '## Task\n\nParse @x.json.\n');
  await flush();
  assert.deepEqual(blues(window, '#promptMarkdown'), ['@x.json']);
  assert.deepEqual(blues(window, '#prompt'), []);          // panes are independent
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: **16 PASS / 5 FAIL**. Two of the seven new tests are already green: *a pasted prompt is validated on arrival* and *the markdown textarea highlights on its own input too* — both are driven by `input`, wired in Task 1, with the index wired in Task 2. The five that must be red are the two pill-removal tests, the attach-lights-up test, the popup-completion test, and the `.md`-load test.

- [ ] **Step 3: Add the shared refresh helper**

Append to the highlighter section in `ui/public/app.js`, just above `attachMentionHighlight(el.prompt);`:

```js
// Both textareas at once: called whenever the answer changed for reasons other
// than typing — files added or removed, a pane or the view revealed.
function refreshMentionHighlights() {
  scheduleMentionHighlight(el.prompt);
  scheduleMentionHighlight(el.promptMarkdown);
}
```

- [ ] **Step 4: Hook the five sites**

**(a)** `renderExtrasPills()` — extend the line added in Task 2 Step 5, at the end of the function:

```js
  rebuildMentionIndex();
  refreshMentionHighlights();
```

**(b)** `applyMention(name)` — `ui/public/app.js:4670-4681` writes `ta.value` directly and therefore fires no `input`. Add as the last statement of the function, after `ta.focus();`:

```js
  scheduleMentionHighlight(ta);
```

**(c)** The `.md` load — `ui/public/app.js:4527-4536` also assigns `.value` directly. Change:

```js
    const text = await f.text();
    el.promptMarkdown.value = text;
```

to:

```js
    const text = await f.text();
    el.promptMarkdown.value = text;
    scheduleMentionHighlight(el.promptMarkdown);
```

**(d)** `syncSourceToggle()` — `ui/public/app.js:4372-4378`. A pane revealed from `display:none` had no geometry while hidden, so its scrollbar gutter (Task 4) is stale. Add as the last statement of the function:

```js
  refreshMentionHighlights();
```

**(e)** `showView` — `ui/public/app.js:10741`. Change:

```js
  if (name === 'new') { loadTaskSources(); applyBudgetToNewView(); }
```

to:

```js
  if (name === 'new') { loadTaskSources(); applyBudgetToNewView(); refreshMentionHighlights(); }
```

`refreshMentionHighlights` is a hoisted function declaration, so both `syncSourceToggle` (defined at `:4372`) and `showView` (defined at `:10668`) can call it regardless of file order. Both module-init callers — `syncSourceToggle()` at `:10811` and `showView(...)` at `:10821` — run after the highlighter's `let mentionIndex` has been initialised. Verified against the real file.

**Hooks (d) and (e) are deliberately untested in jsdom.** Because the plan does *not* gate repaints on visibility (see the Self-Review's declared deviation), a revealed pane's *colouring* is already correct without them; their only job is to re-measure the scrollbar gutter once the pane becomes measurable, and every geometry read is `0` under jsdom. A jsdom test for them would assert the call, not the behaviour. They are covered by Task 4 Step 7 check 8.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: PASS — 21/21.

- [ ] **Step 6: Commit**

```bash
git add ui/public/app.js test/ui-newpipeline-mention-highlight.test.mjs
git commit -m "feat(ui): revalidate mention highlighting on every attachment and text change"
```

---

### Task 4: Hardening — gutter, geometry observers, paste-a-novel cap, XSS

The three defects that only appear in a real browser, plus the assertions that prove the no-churn short-circuit and the length cap.

**Files:**
- Modify: `ui/public/app.js` (highlighter section)
- Modify: `test/ui-newpipeline-mention-highlight.test.mjs`

**Interfaces:**
- Consumes: `repaintMentionHighlight`, `syncMentionScroll`, `ta._mentionHl.{padRight, borderX, gutter}` from Task 1.
- Produces: `syncMentionGutter(ta): void`, `syncMentionMetrics(ta): void`, `MENTION_HL_MAX_CHARS` constant.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-newpipeline-mention-highlight.test.mjs`:

```js
test('a hostile file name cannot inject markup into the backdrop', async () => {
  const { window } = await boot();
  const evil = '<img src=x onerror=alert(1)>.txt';
  pickFiles(window, [evil]);
  typeIn(window, '#prompt', `look at @${evil} now`);
  await flush();
  const back = backOf(window);
  assert.equal(back.querySelectorAll('img').length, 0);
  // Only the mention span and the trailing <br> guard are element children.
  const tags = [...back.children].map((n) => n.tagName.toLowerCase());
  assert.deepEqual(tags, ['span', 'br']);
  assert.deepEqual(blues(window), [`@${evil}`]);
});

test('a repaint that changes nothing does not touch the backdrop DOM', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  typeIn(window, '#prompt', 'read @a.txt');
  await flush();
  const before = [...backOf(window).childNodes];

  // Re-picking the same name replaces the File but leaves the name set equal,
  // so renderExtrasPills -> refreshMentionHighlights runs with nothing to change.
  pickFiles(window, ['a.txt']);
  await flush();
  const after = [...backOf(window).childNodes];
  assert.equal(after.length, before.length);
  after.forEach((n, i) => assert.equal(n, before[i], `child ${i} was replaced`));
});

test('an oversized prompt stops being scanned', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  const filler = 'x'.repeat(20001);
  typeIn(window, '#prompt', `${filler} @a.txt`);
  await flush();
  assert.deepEqual(blues(window), []);
  // Still a faithful mirror — only the colouring is dropped.
  assert.equal(backOf(window).textContent, `${filler} @a.txt`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: **23 PASS / 1 FAIL** — only *an oversized prompt stops being scanned* is red (`['@a.txt'] !== []`). The XSS and no-churn tests pass already, because Task 1's `textContent`-only rendering and Task 1's `text`/`marksKey` comparison were both built correctly the first time; they are regression locks, not drivers. If either is red, the implementation deviated from the plan — fix the implementation, not the test.

- [ ] **Step 3: Add the length cap**

Insert into the highlighter section of `ui/public/app.js`, next to the boundary regexes:

```js
// Past this, colouring is dropped and the backdrop becomes a plain mirror: a
// pasted novel must not turn every keystroke into a full re-layout.
const MENTION_HL_MAX_CHARS = 20000;
```

In `repaintMentionHighlight`, change:

```js
  const marks = scanMentions(text);
```

to:

```js
  const marks = text.length > MENTION_HL_MAX_CHARS ? [] : scanMentions(text);
```

- [ ] **Step 4: Add the scrollbar gutter sync**

Append to the highlighter section, above `repaintMentionHighlight`:

```js
// An overflowing textarea grows a scrollbar out of its own content width
// (::-webkit-scrollbar is 10px here, style.css:769). The backdrop does not
// scroll and so keeps that strip, wrapping a column later than the textarea —
// measured as a full 21px line of divergence, not a nudge. Hand it back the
// same width. Under jsdom every geometry read is 0, so the gutter stays 0 and
// nothing is written.
function syncMentionGutter(ta) {
  const st = ta._mentionHl;
  const gutter = Math.max(0, ta.offsetWidth - ta.clientWidth - st.borderX);
  if (gutter !== st.gutter) {
    st.gutter = gutter;
    st.back.style.paddingRight = `${st.padRight + gutter}px`;
  }
}
```

Then add the call as the last statement of `repaintMentionHighlight`, after `syncMentionScroll(ta);`:

```js
  syncMentionGutter(ta);
```

- [ ] **Step 5: Keep the gutter fresh when geometry changes without typing**

`repaintMentionHighlight` runs from `input` and the six hooks — none of which fire when the user drags the resize grip, resizes the window, or when the Poppins webfont swaps in and changes the line count. Append to the highlighter section, above `attachMentionHighlight`:

```js
// Geometry-only refresh: no scan, no DOM rebuild. The metrics can change with
// no `input` and no hook — dragging the resize grip, a window resize (including
// crossing the max-width:1080px breakpoint where the sidebar disappears and the
// column widens), browser zoom, or Poppins swapping in and changing the line
// count enough to add or remove the scrollbar.
function syncMentionMetrics(ta) {
  if (!ta || !ta._mentionHl) return;
  syncMentionGutter(ta);
  syncMentionScroll(ta);
}
```

Inside `attachMentionHighlight`, after the two `addEventListener` calls, add:

```js
  // A ResizeObserver on the textarea covers the grip drag and every reflow that
  // changes its border box; the typeof guard is value-based, which jsdom needs.
  if (typeof ResizeObserver === 'function') {
    st.ro = new ResizeObserver(() => syncMentionMetrics(ta));
    st.ro.observe(ta);
  }
```

This requires naming the state object, so change:

```js
  ta._mentionHl = {
```

to:

```js
  const st = ta._mentionHl = {
```

Finally, add once at the end of the highlighter section, after the two `attachMentionHighlight(...)` calls:

```js
// A webfont swap changes the line count without changing the textarea's box, so
// no ResizeObserver fires — but a scrollbar can appear or vanish.
if (document.fonts && typeof document.fonts.ready?.then === 'function') {
  document.fonts.ready.then(() => {
    syncMentionMetrics(el.prompt);
    syncMentionMetrics(el.promptMarkdown);
  }).catch(() => { /* font loading is best-effort; the next keystroke re-syncs */ });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: PASS — 24/24.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all green. Per the project baseline the suite is fully green, so any failure is caused by this branch. Pay particular attention to the 79 jsdom files that import `ui/public/app.js`; the ones that set `#prompt.value` directly and then submit are the regression net proving the submit payload is unchanged: `test/ui-budget-indicator.test.mjs`, `test/ui-running-nav.test.mjs`, `test/newpipeline-config.test.mjs`, `test/ui-workspace-source-branches.test.mjs`, `test/ui-target-selector.test.mjs`.

- [ ] **Step 8: Verify in a real browser — MANDATORY, not polish**

jsdom pins every geometry read to `0`, so three of this plan's four hardest defects are invisible to it. These checks are the only coverage they have.

```bash
npm start
```

Open New Pipeline. Checks 1–3 are **measurements**, not eyeballing — run them in DevTools:

1. **The 11px gap survived.** In the console:
   ```js
   const ta = document.querySelector('#prompt');
   const pane = document.querySelector('#prompt-pane');
   ta.getBoundingClientRect().top - pane.getBoundingClientRect().top   // must be 11
   ```
   Compare the whole New Pipeline column against `master`. The pane may end up
   **up to 6px shorter** — today's baseline-aligned inline-block textarea leaves
   a strut descender below itself that `vertical-align:top` removes, and nothing
   is drawn in it. Any other shift, and especially any change to the 11px above
   the prompt, is a regression.
2. **The backdrop is exactly the textarea's box.**
   ```js
   const back = ta.parentNode.querySelector('.ta-hl-back');
   const a = ta.getBoundingClientRect(), b = back.getBoundingClientRect();
   [b.top - a.top, b.left - a.left, b.height - a.height, b.width - a.width]  // must be [0,0,0,0]
   ```
   A non-zero height delta means the strut is back and the field fill spills past the rounded border.
3. **No metric drift.** Type enough to wrap several lines, then:
   ```js
   ta.scrollHeight === back.scrollHeight    // must be true
   ```
   This is the single reliable detector for every layout property the two layers could disagree on. Re-run it after check 4.
4. **The scrollbar gutter.** Type past the bottom so a scrollbar appears; re-run check 3. Then drag the resize grip shorter until a scrollbar appears, and shorter still — re-run check 3 each time. Then narrow the window past 1080px and past 760px and re-run it. Any `false` means the `ResizeObserver` wiring is wrong.
5. **Alignment by eye.** Attach two files, one with a space in its name. Type a prompt mentioning both plus one unknown name. The two real ones are blue, the unknown one is ink-black, and the blue characters sit exactly on the caret's characters.
6. **Focus and selection.** Click in and out: the field background still goes `#F6F6F4` → `#fff` and the border still darkens. Select across a mention: the band is visible and the text under it stays readable.
7. **Scrolling.** Scroll the overflowing textarea: the colours scroll with the text.
8. **Reveal.** With an overflowing prompt, switch the source segment to Markdown and back, and route away to Running and back to New Pipeline. Re-run check 3 each time — this is the only coverage hooks (d) and (e) have.
9. **Removal.** Remove a pill: that mention goes black immediately.
10. **Forced colors.** DevTools → Rendering → *Emulate CSS media feature forced-colors: active*. The prompt text must render **once**, in `CanvasText`, with no doubled glyphs and no coloured mention. Type a character to confirm the textarea is still fully usable.

- [ ] **Step 9: Commit**

```bash
git add ui/public/app.js test/ui-newpipeline-mention-highlight.test.mjs
git commit -m "fix(ui): gutter sync, geometry observers, oversize cap and XSS coverage for mention highlighting"
```

---

## Self-Review

**Spec coverage.**

| Spec | Task |
|---|---|
| D1 attached-extras truth source | 2 (`rebuildMentionIndex` reads `extrasFiles`) |
| D2 greedy longest-match | 2 (buckets sorted longest-first; two tests) |
| D3 both textareas | 1 (`attachMentionHighlight` on both), 3 (`refreshMentionHighlights`) |
| D4 case-sensitive | 2 (`startsWith`, no lowering; dedicated test) |
| D5 invalid gets no styling | 2 (only `.mention-ok` is emitted) |
| D6 backdrop approach | 1 |
| D7 no `index.html` change | 1 (wrapper built in JS) |
| §3.1 margin transfer | 1 Steps 3–4 (inline-block wrapper), 4 Step 8 checks 1–2 |
| §3.2 visual contract | 1 Step 3 |
| §4 validity rules 1–4 | 2 (seven boundary/greedy/case tests, incl. the dot rule) |
| §5 L1 index rebuild on change only | 2 Step 5 + 3 Step 4a |
| §5 L2 single-pass scan | 2 Step 3 |
| §5 L3 rAF coalescing + no-op short-circuit | 1 (`scheduleMentionHighlight`, `text`/`marksKey`); asserted in 4 |
| §5 degradation cap | 4 Step 3 |
| §5 scroll sync | 1 (`syncMentionScroll`), 4 Step 8 check 7 |
| §5 scrollbar gutter | 4 Steps 4–5, checks 3–4 |
| §6 all eight triggers | 1 (`input`, `scroll`), 3 (the other five), 4 Step 5 (geometry) |
| §7 security | 4 Step 1 (XSS test), enforced by the `innerHTML` ban in Global Constraints |
| §8 invariant 1 (`textContent === value`) | 1, 3, 4 (asserted in four separate tests) |
| §8 invariant 2 (submit unchanged) | 4 Step 7 (full suite) |
| §8 invariant 3 (no throw without geometry) | 1 (`parseFloat(v) \|\| 0`), 4 (`Math.max(0, …)`, `typeof ResizeObserver`) |
| §8 invariant 4 (inert with zero files) | 2 (`if (!byFirstChar.size) return marks`; dedicated test) |
| §10 tests 1–18 | Distributed across 1–4 |
| §10 test 19 | **Deviation — see below** |

**Declared deviations from the spec.**

1. **Hidden panes are not skipped.** Spec §5 (as amended) already records this. The natural gate (`ta.offsetParent === null`) is hard-coded to `null` under jsdom and would silently disable the feature in every test. The saving was one paint of an invisible textarea; the `text`/`marksKey` comparison already makes those repaints nearly free. Hooks (d) and (e) still refresh the gutter once a pane becomes measurable.
2. **Spec test 19 is weakened.** The spec asks that a zero-attachment backdrop be "a single text node". The mandatory trailing `<br>` guard makes that false by construction. The plan's test asserts the observable property instead — zero `.mention-ok` and an exact `textContent` mirror. Amend spec §10 test 19 to say "one text node plus the `<br>` guard".
3. **Hooks (d) and (e) have no jsdom test.** Their only observable effect is the scrollbar gutter, which jsdom cannot see. Covered by Task 4 Step 8 check 8. Asserting the call instead would test the implementation, not the behaviour.

**Placeholder scan.** No `TBD`, no `TODO`, no "similar to Task N", no "add error handling". Every code step carries the literal code.

**Type consistency.** `attachMentionHighlight` / `scheduleMentionHighlight` / `repaintMentionHighlight` / `paintMentionBackdrop` / `syncMentionScroll` / `syncMentionGutter` / `syncMentionMetrics` / `refreshMentionHighlights` / `rebuildMentionIndex` / `scanMentions` / `mentionEndsCleanly` are each defined once and referenced with the same name and arity throughout. `ta._mentionHl` is created in Task 1 with `back`, `queued`, `text`, `marksKey`, `gutter`, `padRight`, `borderX`, and gains `ro` in Task 4 Step 5 (which also introduces the `const st =` binding the observer wiring needs). `marks` is a flat `number[]` everywhere. `mentionIndex` has exactly one field, `byFirstChar`, at every use.
