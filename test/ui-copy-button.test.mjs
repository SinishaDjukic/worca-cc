// test/ui-copy-button.test.mjs — the one copy button (docs/design-system.md › Copy button): copy-button.mjs's look and
// feedback, and a scan that keeps every clipboard button on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { copyButton, copyFromButton, flashCopy, COPIED_MS } from '../ui/public/copy-button.mjs';
import { createUpdateUi } from '../ui/public/update-view.mjs';
import { renderCopilotSignIn } from '../ui/public/bridge-view.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI = join(ROOT, 'ui/public');

/** A jsdom window whose timers are held, so a test fires the 1200 ms reset by hand. */
function page() {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const timers = [];
  window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  window.clearTimeout = () => {};
  return { window, doc: window.document, fire: () => { const t = timers.pop(); assert.equal(t.ms, COPIED_MS); t.fn(); } };
}
const clipboard = (window, writeText) => Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });

test('without a label it is a quiet icon square named by aria-label and title', () => {
  const { doc } = page();
  const b = copyButton(doc, { name: 'Copy the visible log lines', cls: 'log-copy' });
  assert.equal(b.type, 'button');
  assert.deepEqual([...b.classList], ['btn', 'btn-sm', 'btn-quiet', 'copy-btn', 'btn-icon', 'log-copy']);
  assert.equal(b.getAttribute('aria-label'), 'Copy the visible log lines');
  assert.equal(b.title, 'Copy the visible log lines');
  assert.equal(b.textContent, '', 'no typed label');
  assert.deepEqual([...b.querySelectorAll('.ic')].map((i) => i.classList[1]), ['ico-copy', 'ico-check', 'ico-x']);
});

test('with a label the copied text is the mono label; title may carry the full text', () => {
  const { doc } = page();
  const b = copyButton(doc, { name: 'Copy worktree path', label: '…/a/b/c', title: '/x/a/b/c' });
  assert.ok(b.classList.contains('mono') && !b.classList.contains('btn-icon'));
  assert.equal(b.querySelector('.copy-btn-text').textContent, '…/a/b/c');
  assert.equal(b.title, '/x/a/b/c');
});

test('a copy shows the tick and a "Copied" caption, then rests; the label never changes', async () => {
  const { window, doc, fire } = page();
  const writes = [];
  clipboard(window, async (t) => { writes.push(t); });
  const b = copyButton(doc, { name: 'Copy branch name', label: 'feat/x' });
  assert.equal(await copyFromButton(b, 'feat/x'), true);
  assert.deepEqual(writes, ['feat/x']);
  assert.ok(b.classList.contains('copied'));
  assert.equal(b.title, 'Copied');
  assert.equal(b.querySelector(':scope > .copy-btn-msg').textContent, 'Copied', 'the caption, as the branch name has it');
  assert.equal(b.querySelectorAll('.copy-btn-msg').length, 1);
  assert.equal(b.querySelector('.copy-btn-text').textContent, 'feat/x');
  fire();
  assert.ok(!b.classList.contains('copied'));
  assert.equal(b.title, 'Copy branch name');
});

test('empty text copies nothing and shows the × with the reason; a refused write says Copy failed', async () => {
  const { window, doc, fire } = page();
  const writes = [];
  clipboard(window, async (t) => { writes.push(t); });
  const b = copyButton(doc, { name: 'Copy the visible log lines' });
  assert.equal(await copyFromButton(b, ''), false);
  assert.deepEqual(writes, [], 'clipboard untouched');
  assert.ok(b.classList.contains('copy-miss'));
  assert.equal(b.title, 'Nothing to copy');
  assert.equal(b.querySelector('.copy-btn-msg').textContent, 'Nothing to copy');
  fire();
  assert.equal(b.title, 'Copy the visible log lines');

  clipboard(window, async () => { throw new Error('denied'); });
  assert.equal(await copyFromButton(b, 'x'), false, 'no clipboard and no execCommand in jsdom');
  assert.equal(b.title, 'Copy failed');
});

test('a second click inside the window never makes a flash the resting title', () => {
  const { doc } = page();
  const b = copyButton(doc, { name: 'Copy path' });
  flashCopy(b, true);
  flashCopy(b, true);
  assert.equal(b.dataset.copyTitle, 'Copy path');
  assert.equal(b.querySelectorAll('.copy-btn-msg').length, 1, 'one caption, reused');
});

// The scan: a button whose visible words are "Copy…" must be a .copy-btn. Menu items and these labelled dialog
// footer actions are not copy buttons (design-system.md › Copy button, item 4).
const LABELLED_ACTIONS = ['report-copy', 'tp-copy-json'];
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (/\.(mjs|js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(UI);
  return out;
}
const TYPED_COPY = [
  /<button\b[^>]*>\s*copy\b[^<]*<\/button>/gi,                          // markup: <button …>Copy…</button>
  /\(\s*doc(?:ument)?\s*,\s*'button'\s*,\s*'([^']*)'\s*,\s*'copy\b[^']*'/gi, // h(doc, 'button', 'cls', 'Copy…')
  /make\(\s*'button'\s*,\s*'([^']*)'\s*,\s*'copy\b[^']*'/gi,             // make('button', 'cls', 'Copy…')
  /\bbtn\(\s*doc\s*,\s*'([^']*)'\s*,\s*'copy\b[^']*'/gi,                // script-wizard's btn(doc, 'cls', 'Copy')
  /\.textContent\s*=\s*'(?:copy|copied)'/gi,                            // a label flashed to "Copied" and back
  /classList\.(?:toggle|add)\(\s*'copied'/g,                              // a hand-rolled tick outside copy-button.mjs
  /\bbtn\(\s*doc\s*,\s*'copy\b[^']*'/gi,                                  // a view's btn(doc, 'Copy…', …) (label first)
  /setAttribute\(\s*'aria-label'\s*,\s*'copy\b[^']*'/gi,                    // a hand-built icon copy (Run Actions had one)
];

test('every Copy-labelled button is the one copy button', () => {
  const hits = [];
  for (const f of sources()) {
    if (f.endsWith('copy-button.mjs')) continue;
    const src = readFileSync(f, 'utf8');
    for (const re of TYPED_COPY) {
      for (const m of src.matchAll(re)) {
        if (LABELLED_ACTIONS.some((c) => m[0].includes(c))) continue;
        hits.push(`${f.slice(ROOT.length)}:${src.slice(0, m.index).split('\n').length} ${m[0].slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(hits, [], 'build it with copyButton() (ui/public/copy-button.mjs)');
});

test('every static copy button carries .copy-btn and the three glyphs', () => {
  const html = readFileSync(join(UI, 'index.html'), 'utf8');
  const copies = [...html.matchAll(/<button\b[^>]*aria-label="Copy[^"]*"[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.ok(copies.length >= 8, `found ${copies.length}`);
  for (const b of copies) {
    const head = b.slice(0, 160);
    assert.match(b, /class="[^"]*\bcopy-btn\b/, head);
    for (const g of ['ico-copy', 'ico-check', 'ico-x']) assert.ok(b.includes(g), `${g}: ${head}`);
  }
});

test('the caption CSS: green Copied, red reason, an icon square widens for it; no per-feature caption', () => {
  const css = readFileSync(join(UI, 'style.css'), 'utf8');
  assert.match(css, /\.copy-btn\.copied \.copy-btn-msg\{display:inline;color:var\(--green-ink\);\}/);
  assert.match(css, /\.copy-btn\.copy-miss \.copy-btn-msg\{display:inline;color:var\(--red-ink-strong\);\}/);
  assert.match(css, /\.copy-btn\.btn-icon:is\(\.copied,\.copy-miss\)\{width:auto;/);
  assert.doesNotMatch(css + readFileSync(join(UI, 'index.html'), 'utf8'), /(?:hd|rd)-copied/, 'the branch caption is the shared one now');
});

test('screen readers hear the outcome: one polite status region, re-said on every flash', async () => {
  const { window, doc } = page();
  clipboard(window, async () => {});
  const a = copyButton(doc, { name: 'Copy path' });
  const b = copyButton(doc, { name: 'Copy command' });
  await copyFromButton(a, 'x');
  const live = doc.getElementById('copy-live');
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.ok(live.classList.contains('sr-only'), 'visually hidden: the caption is what sighted users see');
  assert.equal(live.textContent, 'Copied');
  await copyFromButton(b, '');
  assert.equal(doc.querySelectorAll('#copy-live').length, 1, 'one region for every button');
  assert.equal(live.textContent, 'Nothing to copy');
});

test('createUpdateUi hands every command copy to the injected copyFromButton; a miss is reported', async () => {
  const { doc } = page();
  doc.body.innerHTML = `
    <code id="aboutUpdateCmd">npm i -g @worca/app@1.15.0</code><button id="aboutUpdateCopy"></button>
    <code id="aboutUpdateFailedCmd">npm i -g @worca/app@1.15.0</code><button id="aboutUpdateFailedCopy"></button>
    <code id="updateConfirmStartCmd">worca ui</code><button id="updateConfirmCopy"></button>
    <code id="updateOverlayStartCmd">worca ui --port 4400</code><button id="updateOverlayCopy"></button>`;
  const calls = [];
  const reports = [];
  let ok = true;
  const ui = createUpdateUi({ doc, fetchImpl: async () => ({ ok: false }), report: (m, tone) => reports.push([m, tone]),
    copyFromButton: async (btn, text) => { calls.push([btn.id, text]); return ok; } });
  ui.wire();
  const press = async (id) => { doc.getElementById(id).click(); await new Promise((r) => setImmediate(r)); };
  for (const id of ['aboutUpdateCopy', 'aboutUpdateFailedCopy', 'updateConfirmCopy', 'updateOverlayCopy']) await press(id);
  assert.deepEqual(calls, [
    ['aboutUpdateCopy', 'npm i -g @worca/app@1.15.0'], ['aboutUpdateFailedCopy', 'npm i -g @worca/app@1.15.0'],
    ['updateConfirmCopy', 'worca ui'], ['updateOverlayCopy', 'worca ui --port 4400']]);
  assert.deepEqual(reports, [], 'a copy that landed says nothing more');
  ok = false;
  await press('updateOverlayCopy');
  assert.deepEqual(reports, [['Could not copy the command: select it and copy it by hand.', 'err']]);
  const app = readFileSync(join(UI, 'app.js'), 'utf8');
  assert.match(app, /createUpdateUi\(\{[^}]*\bcopyFromButton\b/, 'app.js passes the shared copyFromButton in');
});

test('the Copilot device code is its own copy button; a miss stays in the status line with the code to type', async () => {
  const { window, doc } = page();
  const box = renderCopilotSignIn({ userCode: 'ABCD-1234', status: 'Waiting for approval…' }, { doc });
  const btn = box.querySelector('.mv-cp-copy');
  assert.ok(btn.classList.contains('copy-btn') && btn.classList.contains('mono') && !btn.classList.contains('btn-icon'));
  assert.equal(btn.querySelector('.copy-btn-text.mv-cp-code').textContent, 'ABCD-1234', 'the code is the label');
  assert.equal(btn.getAttribute('aria-label'), 'Copy code ABCD-1234');
  clipboard(window, async () => { throw new Error('denied'); });
  btn.click();
  await new Promise((r) => setImmediate(r));
  const status = box.querySelector('.mv-cp-status');
  assert.equal(status.textContent, 'Could not copy the code. Type ABCD-1234 on GitHub instead.');
  assert.ok(status.classList.contains('err'));
});
