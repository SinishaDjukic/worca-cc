// test/ui-newpipeline-mention-highlight.test.mjs — blue @mention highlighting in
// the New-Pipeline prompt textareas: the backdrop mirror layer, the validity
// rules, and every trigger that can change the answer.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4319/' }));
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

// One boot serves several rows: a row that needs its own file list starts from none.
function clearPills(window) {
  for (let x, i = 0; i < 50 && (x = window.document.querySelector('#extrasPills .extra-pill-x')); i++) x.click();
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

test('mention validity rules (table): attached vs unknown, hand-typed, spaces, longest match, unattached longer name, mid-word @, boundary, punctuation, case-sensitive, no files, oversized prompt', async () => {
  const { window } = await boot();
  const filler = 'x'.repeat(20001);
  await checkRows([
    { name: 'a mention naming an attached file turns blue; an unknown one does not', files: ['a.txt'], text: 'read @a.txt then @nope.txt please', blues: ['@a.txt'] },
    { name: 'a hand-typed mention counts — the popup is not involved', files: ['spec.md'], text: '@spec.md', blues: ['@spec.md'],
      also: () => assert.equal(backOf(window).textContent, '@spec.md') },
    { name: 'greedy longest-match spans a file name containing spaces', files: ['my report.pdf'], text: 'see @my report.pdf and then stop', blues: ['@my report.pdf'] },
    { name: 'the longest of two overlapping names wins', files: ['a.txt', 'a.txt.bak'], text: 'diff @a.txt.bak against @a.txt', blues: ['@a.txt.bak', '@a.txt'] },
    // note: a.txt.bak is NOT attached
    { name: 'a longer name that is NOT attached does not light up its attached prefix', files: ['a.txt'], text: 'restore @a.txt.bak now', blues: [] },
    { name: 'an @ that does not start a word is not a mention', files: ['example.com'], text: 'mail me at bob@example.com ok', blues: [] },
    { name: 'a mention must end on a boundary', files: ['a.txt'], text: 'open @a.txt2 now', blues: [] },
    { name: 'trailing sentence punctuation still leaves the mention blue', files: ['a.txt'], text: 'open @a.txt. Then @a.txt, and (@a.txt)', blues: ['@a.txt', '@a.txt', '@a.txt'] },
    { name: 'matching is case-sensitive — a blue mention must resolve on disk', files: ['readme.md'], text: 'check @README.MD', blues: [] },
    { name: 'with no attached files nothing is highlighted', files: [], text: 'a prompt mentioning @anything.txt at all', blues: [],
      also: () => assert.equal(backOf(window).textContent, 'a prompt mentioning @anything.txt at all') },
    { name: 'an oversized prompt stops being scanned', files: ['a.txt'], text: `${filler} @a.txt`, blues: [],
      // Still a faithful mirror — only the colouring is dropped.
      also: () => assert.equal(backOf(window).textContent, `${filler} @a.txt`) },
  ].map(({ name, files, text, blues: expected, also }) => ({ name, run: async () => {
    clearPills(window);
    if (files.length) pickFiles(window, files);
    typeIn(window, '#prompt', text);
    await flush();
    assert.deepEqual(blues(window), expected);
    also?.();
  } })));
});

test('attaching or removing a file re-validates mentions already in the prompt and leaves the text intact', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'removing a file turns its mention black again, leaving the text intact', run: async () => {
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
    } },
    { name: 'removing one of two files only de-highlights that one', run: async () => {
      clearPills(window);
      pickFiles(window, ['a.txt', 'b.txt']);
      typeIn(window, '#prompt', '@a.txt and @b.txt');
      await flush();
      assert.deepEqual(blues(window), ['@a.txt', '@b.txt']);

      const pills = [...window.document.querySelectorAll('#extrasPills .extra-pill')];
      const aRow = pills.find((p) => p.querySelector('.extra-pill-name').textContent === 'a.txt');
      aRow.querySelector('.extra-pill-x').click();
      await flush();
      assert.deepEqual(blues(window), ['@b.txt']);
    } },
    { name: 'attaching a file lights up a mention already in the prompt', run: async () => {
      clearPills(window);
      typeIn(window, '#prompt', 'compare @late.csv with the notes');
      await flush();
      assert.deepEqual(blues(window), []);

      pickFiles(window, ['late.csv']);
      await flush();
      assert.deepEqual(blues(window), ['@late.csv']);
    } },
  ]);
});

test('every input path repaints: a paste, a popup insert, a loaded .md file, and the markdown textarea on its own input', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'a pasted prompt is validated on arrival', run: async () => {
      pickFiles(window, ['design.md']);
      // jsdom cannot mutate a textarea from a ClipboardEvent, so a value-set plus
      // `input` is the honest model of a paste — which is exactly the path a real
      // paste takes: it reaches the textarea natively and fires `input`.
      typeIn(window, '#prompt', 'Context from a chat log:\n\n@design.md is the spec, @gone.md is not.\n');
      await flush();
      assert.deepEqual(blues(window), ['@design.md']);
    } },
    { name: 'picking from the completion popup leaves the inserted mention blue', run: async () => {
      clearPills(window);
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
    } },
    { name: 'loading a .md file repaints the markdown backdrop', run: async () => {
      clearPills(window);
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
    } },
    { name: 'the markdown textarea highlights on its own input too', run: async () => {
      clearPills(window);
      pickFiles(window, ['x.json']);
      typeIn(window, '#promptMarkdown', '## Task\n\nParse @x.json.\n');
      await flush();
      assert.deepEqual(blues(window, '#promptMarkdown'), ['@x.json']);
      assert.deepEqual(blues(window, '#prompt'), []);          // panes are independent
    } },
  ]);
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
