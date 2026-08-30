// test/ui-newpipeline-mention-highlight.test.mjs — blue @mention highlighting in
// the New-Pipeline prompt textareas: the backdrop mirror layer, the validity
// rules, and every trigger that can change the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  // Pin the scheduler to a macrotask. jsdom 29.1.1 is constructed without
  // pretendToBeVisual and so ships no requestAnimationFrame (measured) — but
  // that is an environment fact, not a contract, and every gate below depends
  // on one `await flush()` being enough. Stubbing it makes the counts
  // deterministic in any jsdom version. Same two lines as
  // test/ui-composer-hint.test.mjs:19 and :24.
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
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
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator',
    'HTMLInputElement', 'HTMLSelectElement', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

// Simulate the OS file picker returning `names` (a FileList is read-only).
// app.js's #extras change handler (:4571-4580) is synchronous, so a single
// flush() after this is enough — no polling needed.
function pickFiles(window, names) {
  const input = window.document.querySelector('#extras');
  const files = names.map((n) => new window.File(['x'], n, { type: 'text/plain' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// The highlighter defers its repaint one turn, so every assertion is preceded
// by a flush. The repaint's timer is always registered before this one.
const flush = () => new Promise((r) => setTimeout(r, 0));

// For paths that go through an awaited promise chain of unknown length (the
// .md load handler at app.js:4527 is `async` and awaits File.text()), poll
// instead of guessing a turn count.
async function settle(check, turns = 20) {
  for (let i = 0; i < turns; i++) {
    if (check()) return true;
    await flush();
  }
  return check();
}

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
  // index.html:230 is #promptMarkdown and :231 is the ".md file" row AFTER it.
  // Wrapping must be in place, or that row jumps above the textarea.
  const mdPane = window.document.querySelector('#markdown-pane');
  assert.deepEqual([...mdPane.children].map((n) => n.className), ['ta-hl', 'file']);
});

test('the backdrop mirrors the textarea text exactly', async () => {
  const { window } = await boot();
  const text = 'line one\n\nline three with  double  spaces\ttab\n';
  typeIn(window, '#prompt', text);
  await flush();
  assert.equal(backOf(window).textContent, text);
});

test('the backdrop reserves the trailing line box exactly as the textarea does', async () => {
  const { window } = await boot();
  const brs = () => backOf(window).querySelectorAll('br').length;

  typeIn(window, '#prompt', 'one line');
  await flush();
  // An unconditional <br> here would make the backdrop one line-height TALLER
  // than the textarea, breaking ta.scrollHeight === back.scrollHeight — the
  // only reliable metric-drift detector this feature has (Task 4 Step 8).
  assert.equal(brs(), 0, 'no trailing newline: the div must not gain a line the textarea lacks');

  typeIn(window, '#prompt', 'one line\n');
  await flush();
  // A textarea keeps a line box after a trailing newline; a pre-wrap div drops
  // the line box that follows the LAST forced break. One <br> restores exactly
  // one line, for any number of trailing newlines.
  assert.equal(brs(), 1, 'trailing newline: the div must gain the line the textarea keeps');
  assert.equal(backOf(window).textContent, 'one line\n', '<br> must not alter textContent');

  typeIn(window, '#prompt', 'a\n\n\n');
  await flush();
  assert.equal(brs(), 1, 'three trailing newlines still need exactly one <br>, not three');

  typeIn(window, '#prompt', '');
  await flush();
  assert.equal(brs(), 1, 'empty value: a textarea still shows one line box');
  assert.equal(backOf(window).textContent, '');
});

test('the textarea margin rides on the wrapper so both layers share an origin', async () => {
  const { window } = await boot();
  const ta = window.document.querySelector('#prompt');
  // index.html:226 ships style="margin-top:11px" on the textarea itself. Left
  // there it would push the textarea 11px below the backdrop's top edge.
  // Measured: jsdom's getComputedStyle DOES return "11px" here, which is what
  // makes this assertable at all.
  // NOTE: this asserts the mechanism only. That the 11px of layout SURVIVES the
  // move is invisible to jsdom and is measured in Task 4 Step 8.
  assert.equal(parseFloat(ta.style.marginTop) || 0, 0);
  assert.equal(ta.parentNode.style.marginTop, '11px');
});

test('exactly one wrapper and one backdrop are created per textarea', async () => {
  const { window } = await boot();
  const ta = window.document.querySelector('#prompt');
  const wrap = ta.parentNode;
  // The wrapper is inserted IN PLACE: #prompt-pane stays the grandparent, so
  // ui-agents-accordion.test.mjs:571 (#prompt is not a descendant of the
  // task-source .split-row) and its field-order test at :574 keep holding.
  assert.equal(wrap.querySelectorAll('.ta-hl-back').length, 1);
  assert.equal(wrap.parentNode.id, 'prompt-pane');
  assert.equal(window.document.querySelectorAll('.ta-hl').length, 2);
  assert.equal(window.document.querySelectorAll('.ta-hl-back').length, 2);
  // #plugin-source-pane (index.html:237) is a third .source-pane with no
  // textarea, so it is never wrapped — hence 2, not 3.
  assert.equal(window.document.querySelector('#plugin-source-pane').children.length, 0);
  // NOTE: attachMentionHighlight's `if (ta._mentionHl) return` guard is a
  // defensive invariant, NOT covered here — nothing is exported from app.js and
  // every boot() imports into a fresh document, so a second call is unreachable
  // from a test. This asserts the observable outcome instead.
});

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
  typeIn(window, '#prompt', 'open @a.txt. Then @a.txt, and (@a.txt)');
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

test('removing a file turns its mention black again, leaving the text intact', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  const text = 'please read @a.txt carefully';
  typeIn(window, '#prompt', text);
  await flush();
  assert.deepEqual(blues(window), ['@a.txt']);

  // The pill × handler (app.js:4559-4562) is synchronous, so one flush is enough.
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
  // Enter and Tab both apply (app.js:4712); applyMention inserts "@name " with a
  // trailing space (app.js:4675), which is itself a clean right boundary.
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
  // app.js:4527 is an `async` handler that awaits File.text(); poll rather than
  // assume a turn count.
  const ok = await settle(() => blues(window, '#promptMarkdown').length === 1);
  assert.ok(ok, 'the markdown backdrop never picked up the loaded text');
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

test('a hostile file name cannot inject markup into the backdrop', async () => {
  const { window } = await boot();
  const evil = '<img src=x onerror=alert(1)>.txt';
  pickFiles(window, [evil]);
  typeIn(window, '#prompt', `look at @${evil} now`);
  await flush();
  const back = backOf(window);
  assert.equal(back.querySelectorAll('img').length, 0);
  // The text does not end in a newline, so the only element child is the span:
  // no trailing <br> guard here (Task 1 Step 4).
  const tags = [...back.children].map((n) => n.tagName.toLowerCase());
  assert.deepEqual(tags, ['span']);
  assert.deepEqual(blues(window), [`@${evil}`]);
});

test('a repaint that changes nothing does not touch the backdrop DOM', async () => {
  const { window } = await boot();
  pickFiles(window, ['a.txt']);
  typeIn(window, '#prompt', 'read @a.txt');
  await flush();
  const before = [...backOf(window).childNodes];

  // Re-picking the same name replaces the File but leaves the name set equal
  // (app.js:4574-4576 dedupes by name), so renderExtrasPills ->
  // refreshMentionHighlights runs with nothing to change.
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
