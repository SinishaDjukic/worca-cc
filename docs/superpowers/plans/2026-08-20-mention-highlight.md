# Blue `@file` Mention Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the New Pipeline prompt textareas, render an `@mention` blue when — and only when — it names a file currently attached as an extra, and keep that state correct through typing, pasting, popup completion, `.md` loads, and files being added or removed.

**Architecture:** A textarea cannot colour part of its own text, so each of the two textareas is wrapped at runtime in `div.ta-hl` and given a sibling `div.ta-hl-back` positioned `inset:0` behind it. The textarea keeps its own text but renders it transparent; the backdrop mirrors the same characters and paints valid mentions with `span.mention-ok`. Because the backdrop is out of flow, the wrapper is sized by the textarea alone — resize-drag and reflow need no observers. Validity comes from a name index rebuilt only when the attachment set changes; the per-keystroke path is one `indexOf('@')` scan plus a signature check that skips the DOM entirely when nothing changed.

**Tech Stack:** Vanilla ES-module browser JS (`ui/public/app.js`, 10.8k lines, no framework), plain CSS (`ui/public/style.css`, no preprocessor, no dark theme), `node:test` + `jsdom` for tests.

**Spec:** `docs/superpowers/specs/2026-08-20-mention-highlight-design.md`

## Global Constraints

- **Never commit `docs/superpowers/**`.** Plans and specs stay untracked in this repo. `git add` explicit paths only — never `git add -A` or `git add .`.
- **No new dependencies.** `ui/public/app.js` is served raw to the browser; no bundler, no imports beyond what is already there.
- **`innerHTML` is banned in this feature.** File names are user-controlled and may contain `<`. Build DOM with `document.createElement` / `document.createTextNode` / `textContent` only.
- **No property that affects text metrics may differ between the textarea and the backdrop.** `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `padding`, `border-width`, `box-sizing`, `white-space`, `overflow-wrap` must match exactly, or the two layers drift apart character by character. `.mention-ok` therefore sets **`color` only**.
- **The submit payload must stay byte-identical.** No code in this feature may read or write `textarea.value` outside the paths listed here. `ui/public/app.js:6523` (`el.prompt.value.trim()`) and `:6524` (`el.promptMarkdown.value.trim()`) must be untouched.
- **jsdom has no `requestAnimationFrame` and no `ResizeObserver`, and every geometry read returns `0` without throwing.** Guards must be value-based, never `try/catch`. Every scheduler needs a `setTimeout(fn, 0)` fallback.
- **Case-sensitive** name matching for the blue state (spec D4). The completion popup keeps its existing case-insensitive filtering — do not change it.
- Palette tokens: `--blue-ink:#3782A8`, `--ink:#19191B`, `--field:#F6F6F4`, `--r-ctrl:14px`. Single `:root` block, no theme switching.
- Run the full suite with `npm test` (this is `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/*.mjs`). A single file runs as `node --test test/<file>.test.mjs`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ui/public/style.css` | Presentation of the wrapper, backdrop, transparent textarea, and blue span. | Add `.ta-hl-back` to the shared control-metrics selector at `:276`; append a new block after the existing `.mention-item.sel` rule at `:381`. |
| `ui/public/app.js` | The highlighter: attach, scan, paint, schedule. One new section placed immediately after `attachMentionAutocomplete(el.promptMarkdown);` (`:4723`), plus five one-line hooks at existing call sites. | ~110 new lines + 5 hooks. |
| `test/ui-newpipeline-mention-highlight.test.mjs` | jsdom coverage of structure, validity rules, reactivity, and the perf short-circuit. | Create. |
| `ui/public/index.html` | — | **No change.** The wrapper and backdrop are created in JS so both textareas, and any future one, are served by a single `attachMentionHighlight(ta)` call. |

**Why the new section goes after `:4723`:** the only module-init caller of a hook site is `syncSourceToggle()` at `ui/public/app.js:10811`, which runs long after. Placing the section earlier is unnecessary; placing it later than `:10811` would break that call. Anywhere between `:4724` and `:10810` is safe; directly beside the autocomplete section keeps the two mention features together.

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
  - `ta._mentionHl = { back, queued, sig, gutter, padRight, borderX }`.
  - Task 2 replaces the `marks` argument (empty in this task) with real scan output; Task 3 calls `scheduleMentionHighlight`; Task 4 adds `syncMentionGutter(ta)` and the length cap.

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

test('the wrapper carries the textarea margin so both layers share an origin', async () => {
  const { window } = await boot();
  const ta = window.document.querySelector('#prompt');
  // index.html:226 ships style="margin-top:11px" on the textarea itself.
  assert.equal(ta.style.marginTop, '0px');
  assert.equal(ta.parentNode.style.marginTop, '11px');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: FAIL — `#prompt is not wrapped` (`ta.parentNode.className` is `source-pane`, not `ta-hl`).

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
   textarea keeps its glyphs (and its caret, selection and spellcheck) but
   renders them transparent; the backdrop carries the field fill it gave up.
   .mention-ok sets COLOUR ONLY — any metric-affecting property would advance
   the backdrop's glyphs differently and drift the two layers apart. */
.ta-hl{position:relative;}
.ta-hl-back{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  line-height:1.5;white-space:pre-wrap;overflow-wrap:break-word;border-color:transparent;}
.ta-hl:focus-within .ta-hl-back{background:#fff;}
.ta-hl > textarea.textarea,
.ta-hl > textarea.textarea:focus{position:relative;z-index:1;background:transparent;
  color:transparent;caret-color:var(--ink);}
.ta-hl > textarea.textarea::selection{background:rgba(25,25,27,.16);}
.mention-ok{color:var(--blue-ink);}
```

Two specificity notes, both deliberate:
- `.textarea:focus` at `style.css:284` is `(0,2,0)` and sets `background:#fff`. `.ta-hl > textarea.textarea:focus` is `(0,3,1)` and beats it, which is why the selector is written that way rather than as a bare `.ta-hl > textarea`.
- The backdrop inherits `border:1.5px solid transparent` and `border-radius:var(--r-ctrl)` from the shared rule. It is never focused, so its border stays transparent; `border-color:transparent` is restated only as a guard against future `:focus-within` rules.

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
  // A trailing newline opens a line box in a textarea but may not in a div, so
  // the last row would be short by one. <br> forces it and contributes nothing
  // to textContent, keeping `back.textContent === ta.value` exactly true.
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
  // Redundant triggers (a pane revealed, extras re-rendered with an unchanged
  // set) cost one string compare and touch no DOM.
  const sig = `${marks.join(',')}|${text}`;
  if (sig !== st.sig) {
    paintMentionBackdrop(st.back, text, marks);
    st.sig = sig;
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
  // The textarea's own margin must ride on the wrapper. Left in place it would
  // collapse through a wrapper that has no border or padding, and the backdrop's
  // top edge would land above the textarea's first line.
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    wrap.style[`margin${side}`] = cs[`margin${side}`] || '0px';
  }
  ta.parentNode.insertBefore(wrap, ta);
  wrap.append(back, ta);                                  // backdrop first: it stacks below
  ta.style.margin = '0px';
  ta._mentionHl = {
    back,
    queued: false,
    sig: null,
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
Expected: PASS — 3/3.

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
- Modify: `ui/public/app.js` (the section added in Task 1)
- Modify: `test/ui-newpipeline-mention-highlight.test.mjs`

**Interfaces:**
- Consumes: `extrasFiles` (`ui/public/app.js:4542`, a module-level `let` that is **reassigned** on removal — always read the live binding), `paintMentionBackdrop`, `repaintMentionHighlight` from Task 1.
- Produces:
  - `rebuildMentionIndex(): void` — refreshes the module-level `mentionIndex`.
  - `scanMentions(text: string): number[]` — flat `[start, end, ...]` ranges, each including the leading `@`.
  - `mentionIndex: { maxLen: number, byFirstChar: Map<string, string[]> }` — buckets sorted longest-first.
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
Expected: 3 PASS (Task 1's), 9 FAIL — each reporting `[] !== ['@a.txt']` or similar, because `repaintMentionHighlight` still hard-codes `const marks = []`.

- [ ] **Step 3: Add the index and the scanner**

Insert into the highlighter section of `ui/public/app.js`, immediately **above** `const mentionRaf = ...`:

```js
// Same left-boundary class mentionTokenAt uses, so "bob@example.com" is never a
// mention. The right boundary additionally allows sentence punctuation, so
// "@a.txt." highlights "a.txt" but "@a.txt2" matches nothing.
const MENTION_LEFT_BOUNDARY = /[\s([{'"`,;:]/;
const MENTION_RIGHT_BOUNDARY = /[\s)\]}'"`,;:.!?]/;

// Rebuilt only when the attachment set changes — never on the keystroke path.
// Buckets are keyed by first character and sorted longest-first so the greedy
// match is the first hit, not a search.
let mentionIndex = { maxLen: 0, byFirstChar: new Map() };

function rebuildMentionIndex() {
  const byFirstChar = new Map();
  let maxLen = 0;
  for (const f of extrasFiles) {
    const n = f && f.name;
    if (!n) continue;
    const bucket = byFirstChar.get(n[0]);
    if (bucket) bucket.push(n); else byFirstChar.set(n[0], [n]);
    if (n.length > maxLen) maxLen = n.length;
  }
  for (const bucket of byFirstChar.values()) bucket.sort((a, b) => b.length - a.length);
  mentionIndex = { maxLen, byFirstChar };
}

// Flat [start, end, start, end, ...] ranges of valid mentions, each including
// the leading "@". One left-to-right pass: indexOf skips ordinary text at native
// speed and real work happens only at an "@", bounded by the number of attached
// names sharing the next character.
function scanMentions(text) {
  const marks = [];
  const { maxLen, byFirstChar } = mentionIndex;
  if (!maxLen || !text) return marks;
  let i = text.indexOf('@');
  while (i >= 0) {
    if (i === 0 || MENTION_LEFT_BOUNDARY.test(text[i - 1])) {
      const bucket = byFirstChar.get(text[i + 1]);
      if (bucket) {
        for (const name of bucket) {                       // longest first
          const end = i + 1 + name.length;
          if (text.startsWith(name, i + 1) &&
              (end === text.length || MENTION_RIGHT_BOUNDARY.test(text[end]))) {
            marks.push(i, end);
            i = end - 1;                                   // resume past the match
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
Expected: PASS — 12/12.

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

  const xs = [...window.document.querySelectorAll('#extrasPills .extra-pill')];
  const aRow = xs.find((p) => p.querySelector('.extra-pill-name').textContent === 'a.txt');
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
  // Paste reaches a textarea natively and fires `input`, which is what a
  // value-set + input dispatch models here.
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
Expected: 12 PASS, 6 FAIL. `the markdown textarea highlights on its own input too` already passes — its trigger is `input`, which Task 1 wired.

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

**(d)** `syncSourceToggle()` — `ui/public/app.js:4372-4378`. A pane revealed from `display:none` had no geometry while hidden, so its scrollbar gutter (Task 4) may be stale. Add as the last statement of the function:

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

`refreshMentionHighlights` is a hoisted function declaration, so both `syncSourceToggle` (defined at `:4372`) and `showView` (defined at `:10668`) can call it regardless of file order. The only module-init caller is `syncSourceToggle()` at `:10811`, which runs after the highlighter's `let mentionIndex` has been initialised.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: PASS — 19/19.

- [ ] **Step 6: Commit**

```bash
git add ui/public/app.js test/ui-newpipeline-mention-highlight.test.mjs
git commit -m "feat(ui): revalidate mention highlighting on every attachment and text change"
```

---

### Task 4: Hardening — scrollbar gutter, paste-a-novel cap, XSS, no-op churn

Three loose ends that only bite in the real browser or under hostile input, plus the assertion that proves the perf short-circuit works.

**Files:**
- Modify: `ui/public/app.js` (highlighter section)
- Modify: `test/ui-newpipeline-mention-highlight.test.mjs`

**Interfaces:**
- Consumes: `repaintMentionHighlight`, `ta._mentionHl.{padRight, borderX, gutter}` from Task 1.
- Produces: `syncMentionGutter(ta): void`, `MENTION_HL_MAX_CHARS` constant.

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
  // Only the mention spans and the trailing <br> guard are element children.
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
Expected: 19 PASS, 1 FAIL — `an oversized prompt stops being scanned` (`['@a.txt'] !== []`). The XSS and no-churn tests should already pass; if either fails, the implementation deviated from the plan — fix the implementation, not the test.

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
// (::-webkit-scrollbar is 10px here, style.css:768). The backdrop does not
// scroll and so keeps that strip, wrapping a column later than the textarea.
// Hand it back the same width. Under jsdom every geometry read is 0, so the
// gutter stays 0 and nothing is written.
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/ui-newpipeline-mention-highlight.test.mjs`
Expected: PASS — 22/22.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all green. Per the project baseline the suite is fully green, so any failure is caused by this branch. Pay particular attention to the 79 jsdom files that import `ui/public/app.js`; the ones that set `#prompt.value` directly and then submit are the regression net proving the submit payload is unchanged: `test/ui-budget-indicator.test.mjs`, `test/ui-running-nav.test.mjs`, `test/newpipeline-config.test.mjs`, `test/ui-workspace-source-branches.test.mjs`, `test/ui-target-selector.test.mjs`.

- [ ] **Step 7: Verify in a real browser**

jsdom cannot prove alignment — every geometry read there is `0`. Start the app, open New Pipeline, and check by eye:

```bash
npm start
```

1. Attach two files, one with a space in its name. Type a prompt mentioning both plus one unknown name. The two real ones are blue, the unknown one is ink-black, and **the blue characters sit exactly on the caret's characters** — no half-pixel drift, no offset first line.
2. Click into and out of the textarea: the field background still goes `#F6F6F4` → `#fff` on focus, and the border still darkens.
3. Select text across a mention: the selection band is visible and the text under it stays readable.
4. Type past the bottom of the box so a scrollbar appears, then scroll: the colours scroll with the text, and the wrap points do not shift when the scrollbar appears.
5. Drag the resize grip taller and shorter: the backdrop tracks the box.
6. Remove a pill: that mention goes black immediately.
7. Narrow the window past 760px: nothing drifts.

- [ ] **Step 8: Commit**

```bash
git add ui/public/app.js test/ui-newpipeline-mention-highlight.test.mjs
git commit -m "fix(ui): scrollbar gutter, oversize cap and XSS coverage for mention highlighting"
```

---

## Self-Review

**Spec coverage.**

| Spec | Task |
|---|---|
| D1 attached-extras truth source | 2 (`rebuildMentionIndex` reads `extrasFiles`) |
| D2 greedy longest-match | 2 (buckets sorted longest-first; test `the longest of two overlapping names wins`) |
| D3 both textareas | 1 (`attachMentionHighlight` on both), 3 (`refreshMentionHighlights`) |
| D4 case-sensitive | 2 (`startsWith`, no lowering; dedicated test) |
| D5 invalid gets no styling | 2 (only `.mention-ok` is emitted) |
| D6 backdrop approach | 1 |
| D7 no `index.html` change | 1 (wrapper built in JS) |
| §3.1 margin transfer | 1 (Step 4, with a test) |
| §3.2 visual contract | 1 (Step 3 CSS) |
| §4 validity rules 1–4 | 2 (six boundary/greedy/case tests) |
| §5 L1 index rebuild on change only | 2 Step 5 + 3 Step 4a |
| §5 L2 single-pass scan | 2 Step 3 |
| §5 L3 rAF coalescing + signature | 1 (`scheduleMentionHighlight`, `sig`); asserted in 4 |
| §5 degradation cap | 4 Step 3 |
| §5 scroll sync | 1 (`syncMentionScroll`) |
| §5 scrollbar gutter | 4 Step 4 |
| §6 all eight triggers | 1 (`input`, `scroll`), 3 (the other five) |
| §7 security | 4 Step 1 (XSS test), enforced by the `innerHTML` ban in Global Constraints |
| §8 invariant 1 (`textContent === value`) | 1, 3, 4 (asserted in four separate tests) |
| §8 invariant 2 (submit unchanged) | 4 Step 6 (full suite) |
| §8 invariant 3 (no throw without geometry) | 1 (`parseFloat(v) \|\| 0`), 4 (`Math.max(0, …)`) |
| §8 invariant 4 (inert with zero files) | 2 (`if (!maxLen) return marks`; dedicated test) |
| §10 tests 1–19 | Distributed across 1–4; all 19 present |

No gaps.

**Deliberate deviation from the spec.** Spec §5 says a hidden pane is skipped entirely. That gate is **not** implemented: the natural check (`ta.offsetParent === null`) is hard-coded to `null` under jsdom, which would silently disable the highlighter in every test. The saving was one paint of an invisible textarea when the attachment set changes — far below the cost of an untestable code path. The signature short-circuit already makes those repaints nearly free, and the reveal hooks (3 Step 4d/4e) still refresh the gutter after a pane appears. Spec §5's "degradation caps" bullet should be amended to drop the hidden-pane clause.

**Placeholder scan.** No `TBD`, no `TODO`, no "similar to Task N", no "add error handling". Every code step carries the literal code.

**Type consistency.** `attachMentionHighlight` / `scheduleMentionHighlight` / `repaintMentionHighlight` / `paintMentionBackdrop` / `syncMentionScroll` / `syncMentionGutter` / `refreshMentionHighlights` / `rebuildMentionIndex` / `scanMentions` are each defined once and referenced with the same name and arity throughout. `ta._mentionHl` is created in Task 1 with all six fields (`back`, `queued`, `sig`, `gutter`, `padRight`, `borderX`) that Tasks 2–4 read. `marks` is a flat `number[]` everywhere. `mentionIndex` has the same two fields at every use.
