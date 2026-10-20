// test/ui-artifact-browser.test.mjs — the artifact folder browser over plain data (no app.js): step folders in run
// order with "Run" last, cycle and burst subfolders, open state across live updates, the header search and its flat
// results, keyboard, focus, the open/download callbacks — and the P5 stylesheet section's own rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { createArtifactBrowser, artifactTree } from '../ui/public/artifacts/browser.mjs';

const LABELS = { n_plan: 'Plan', n_impl: 'Implementer', n_rev: 'Review' };
const A = (relPath, nodeId, cycle, extra = {}) => ({ kind: 'plan', relPath, nodeId, cycle, bytes: 1024, ...extra });
const LIST = () => [
  A('plans/plan.md', 'n_plan', 1),
  A('review-cycle1.json', 'n_rev', 1, { kind: 'review' }),
  A('review-cycle2.json', 'n_rev', 2, { kind: 'review' }),
  A('result.diff', 'n_impl', 1, { kind: 'result' }),
  A('prompt.md', null, null, { kind: 'prompt' }),
];

function boot({ list = LIST(), order = ['n_plan', 'n_impl', 'n_rev'], ...rest } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost:4317/' });
  const win = dom.window;
  const doc = win.document;
  const host = doc.getElementById('host');
  const calls = [];
  const b = createArtifactBrowser({
    doc, host, artifacts: list, order: () => order,
    nodeLabel: (id) => LABELS[id] || id,
    onOpen: (a, siblings) => calls.push(['open', a.relPath, siblings.map((x) => x.relPath)]),
    onDownload: (a) => calls.push(['download', a.relPath]),
    ...rest,
  });
  return { win, doc, host, b, calls };
}
const tap = (el, detail = 0) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
const press = (el, key) => el.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const folders = (host) => [...host.querySelectorAll('.afb-folder')].map((f) => [f.dataset.folder, f.querySelector('.afb-fname').textContent, f.querySelector('.afb-fn').textContent, f.getAttribute('aria-expanded')]);
const folderEl = (host, key) => [...host.querySelectorAll('.afb-folder')].find((f) => f.dataset.folder === key);
const names = (host) => [...host.querySelectorAll('.afb-file .afb-name')].map((n) => n.textContent);
const row = (host, name) => [...host.querySelectorAll('.afb-main')].find((m) => m.querySelector('.afb-name').textContent === name);
const type = (s, value) => { const f = s.host.querySelector('.afb-filter'); f.value = value; f.dispatchEvent(new s.win.Event('input', { bubbles: true })); return f; };

test('step folders follow the run order, "Run" comes last, a step that ran twice holds Cycle folders with the latest open', () => {
  const s = boot();
  assert.deepEqual(folders(s.host), [
    ['n:n_plan', 'Plan', '1', 'true'],
    ['n:n_impl', 'Implementer', '1', 'true'],
    ['n:n_rev', 'Review', '2', 'true'],
    ['n:n_rev/c1', 'Cycle 1', '1', 'false'],
    ['n:n_rev/c2', 'Cycle 2', '1', 'true'],
    ['n:__run__', 'Run', '1', 'true'],
  ]);
  assert.deepEqual(names(s.host), ['plan.md', 'result.diff', 'review-cycle2.json', 'prompt.md']);
  assert.equal(s.host.querySelector('.afb-title').textContent, '5 files');
  assert.ok(folderEl(s.host, 'n:n_plan').classList.contains('is-step'));
  assert.ok(folderEl(s.host, 'n:n_rev/c1').classList.contains('is-cycle'));
  assert.equal(s.host.querySelector('.afb-fold[data-fold="n:n_plan"]').getAttribute('role'), 'group');
});

test('a burst of one kind is its own closed folder whose rows are built only when it opens', () => {
  const five = Array.from({ length: 5 }, (_, i) => A(`shots/a${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const flat = boot({ list: [...LIST(), ...five] });
  assert.equal(flat.host.querySelector('.afb-folder.is-bulk'), null, 'exactly at the threshold: no folder');
  const six = Array.from({ length: 6 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const s = boot({ list: [...LIST(), ...six] });
  assert.deepEqual(folders(s.host).find((f) => f[0] === 'n:n_impl/c1/k:deck-shot'), ['n:n_impl/c1/k:deck-shot', 'deck-shot', '6', 'false']);
  assert.equal(names(s.host).filter((n) => n.endsWith('.png')).length, 0, 'closed: no rows built');
  tap(folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
  assert.equal(names(s.host).filter((n) => n.endsWith('.png')).length, 6);
  assert.equal(s.doc.activeElement.dataset.focusKey, 'd:n:n_impl/c1/k:deck-shot', 'focus stays on the folder it toggled');
  assert.equal(s.host.querySelector('.afb-title').textContent, '11 files');
});

test('open state survives live updates; an unchanged list does not repaint; a cycle no longer the latest closes', () => {
  const s = boot();
  tap(folderEl(s.host, 'n:n_rev/c1'));
  tap(folderEl(s.host, 'n:n_plan'));
  const before = s.host.querySelector('.afb-list');
  s.b.update(LIST());
  assert.equal(s.host.querySelector('.afb-list'), before, 'the same list: the same DOM');
  s.b.update([...LIST(), A('review-cycle3.json', 'n_rev', 3, { kind: 'review' })]);
  assert.equal(folderEl(s.host, 'n:n_rev/c1').getAttribute('aria-expanded'), 'true', 'opened by hand: stays open');
  assert.equal(folderEl(s.host, 'n:n_plan').getAttribute('aria-expanded'), 'false', 'closed by hand: stays closed');
  assert.equal(folderEl(s.host, 'n:n_rev/c2').getAttribute('aria-expanded'), 'false', 'no longer the latest');
  assert.equal(folderEl(s.host, 'n:n_rev/c3').getAttribute('aria-expanded'), 'true');
});

test('the header search lists every match flat with where it lives; Escape clears, then folds; the page never sees it', () => {
  const s = boot();
  let seen = 0;
  s.doc.addEventListener('keydown', () => { seen += 1; }, true);   // like the run pages' capture-phase Escape handlers
  tap(s.host.querySelector('.afb-sbtn'));
  assert.ok(s.host.querySelector('.afb-head').classList.contains('is-searching'));
  assert.equal(s.doc.activeElement, s.host.querySelector('.afb-filter'));
  const f = type(s, 'review');
  assert.equal(s.host.querySelectorAll('.afb-folder').length, 0, 'flat: no folders');
  assert.deepEqual([...s.host.querySelectorAll('.afb-file')].map((r) => [r.querySelector('.afb-name').textContent, r.querySelector('.afb-where').textContent]),
    [['review-cycle1.json', 'Review · cycle 1'], ['review-cycle2.json', 'Review · cycle 2']], 'a closed folder is searched too');
  type(s, 'zzz');
  assert.equal(s.host.querySelector('.afb-empty').textContent, 'No artifacts match “zzz”');
  press(f, 'Escape');
  assert.equal(f.value, '');
  assert.ok(s.host.querySelector('.afb-head').classList.contains('is-searching'), 'the first Escape only clears');
  assert.equal(names(s.host).length, 4, 'the folders are back');
  press(f, 'Escape');
  assert.equal(s.host.querySelector('.afb-head').classList.contains('is-searching'), false);
  assert.equal(s.doc.activeElement, s.host.querySelector('.afb-sbtn'), 'focus goes to the search button, never <body>');
  assert.equal(seen, 0, 'Escape in the field never reached a document listener');
});

test('keyboard: ↑/↓ walk folders and rows, ← goes to the folder (then closes it), → opens, Home/End', () => {
  const s = boot();
  folderEl(s.host, 'n:n_plan').focus();
  press(s.doc.activeElement, 'ArrowDown');
  assert.equal(s.doc.activeElement, row(s.host, 'plan.md'));
  press(s.doc.activeElement, 'ArrowLeft');
  assert.equal(s.doc.activeElement.dataset.folder, 'n:n_plan');
  press(s.doc.activeElement, 'ArrowLeft');
  assert.equal(folderEl(s.host, 'n:n_plan').getAttribute('aria-expanded'), 'false');
  assert.equal(s.doc.activeElement.dataset.folder, 'n:n_plan', 'focus survives the repaint');
  press(s.doc.activeElement, 'ArrowRight');
  assert.equal(folderEl(s.host, 'n:n_plan').getAttribute('aria-expanded'), 'true');
  press(s.doc.activeElement, 'End');
  assert.equal(s.doc.activeElement, row(s.host, 'prompt.md'));
  press(s.doc.activeElement, 'Home');
  assert.equal(s.doc.activeElement.dataset.folder, 'n:n_plan');
});

test('a row opens with every file in folder order as its ←/→ list; Download is its own button', () => {
  const s = boot();
  tap(row(s.host, 'result.diff'));
  assert.deepEqual(s.calls[0], ['open', 'result.diff', ['plans/plan.md', 'result.diff', 'review-cycle1.json', 'review-cycle2.json', 'prompt.md']]);
  const dl = row(s.host, 'result.diff').parentElement.querySelector('.afb-dl');
  assert.equal(dl.getAttribute('aria-label'), 'Download result.diff');
  tap(dl);
  assert.deepEqual(s.calls[1], ['download', 'result.diff']);
  assert.equal(boot({ onDownload: null }).host.querySelector('.afb-dl'), null, 'no download callback: no button');
});

test('a row: kind icon, the name cut in the middle with the path as its tooltip, size, a cycle chip outside cycle folders', () => {
  const long = `${'a'.repeat(60)}.md`;
  const s = boot({ list: [
    A(`notes/${long}`, 'n_plan', 3, { bytes: 1536 }),
    A('/Users/me/.worca-cc/store/p/run/x.png', 'n_plan', 3, { kind: 'deck-shot', bytes: 10 }),
  ] });
  const [md, png] = s.host.querySelectorAll('.afb-main');
  const name = md.querySelector('.afb-name').textContent;
  assert.equal(name.length, 44);
  assert.ok(name.includes('…') && name.endsWith('.md'), name);
  assert.equal(md.title, `notes/${long}`);
  assert.equal(md.querySelector('.afb-size').textContent, '1.5 KB');
  assert.equal(md.querySelector('.afb-cyc').textContent, 'cycle 3');
  assert.ok(md.querySelector('.afb-ic').classList.contains('is-doc'));
  assert.equal(png.title, 'x.png', 'an absolute live path never shows the home directory');
  assert.ok(png.querySelector('.afb-ic').classList.contains('is-image'));
});

test('focus survives a live update; a row that went hands focus to its folder', () => {
  const s = boot();
  const r1 = row(s.host, 'result.diff');
  r1.focus();
  s.b.update([...LIST(), A('extra.md', 'n_impl', 1)]);
  assert.equal(s.doc.activeElement.dataset.focusKey, r1.dataset.focusKey);
  assert.notEqual(s.doc.activeElement, r1, 'a repaint built a new row');
  s.b.update([...LIST().filter((a) => a.relPath !== 'result.diff'), A('extra.md', 'n_impl', 1)]);
  assert.equal(s.doc.activeElement.dataset.folder, 'n:n_impl');
});

test('an empty list says so; sources add trailing folders; a double click toggles a folder once; destroy empties the host', async () => {
  await checkRows([
    { name: 'empty', run: () => {
      const s = boot({ list: [], emptyText: 'No artifacts yet' });
      assert.equal(s.host.querySelector('.afb-empty').textContent, 'No artifacts yet');
      assert.equal(s.host.querySelector('.afb-title').textContent, '0 files');
    } },
    { name: 'sources', run: () => {
      const s = boot({ sources: [{ id: 'extra', label: 'Extra', artifacts: [{ kind: 'x', relPath: 'u/brief.pdf', bytes: 5 }] }] });
      assert.deepEqual(folders(s.host).at(-1), ['s:extra', 'Extra', '1', 'true']);
      assert.ok(names(s.host).includes('brief.pdf'));
    } },
    { name: 'double click', run: () => {
      const s = boot();
      tap(folderEl(s.host, 'n:n_plan'), 1);
      tap(folderEl(s.host, 'n:n_plan'), 2);
      assert.equal(folderEl(s.host, 'n:n_plan').getAttribute('aria-expanded'), 'false', 'the second press is swallowed');
    } },
    { name: 'destroy', run: () => {
      const s = boot();
      s.b.destroy();
      assert.equal(s.host.childElementCount, 0);
    } },
  ]);
});

test('the P5 stylesheet section: plain backgrounds, no left-edge accents, focus rings, reduced motion', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* ===== Chat P5: artifacts ===== */');
  assert.ok(at >= 0, 'the bannered section exists');
  const next = css.indexOf('/* ===== Chat P', at + 10);
  const sec = css.slice(at, next < 0 ? undefined : next);
  assert.doesNotMatch(sec, /radial-gradient/, 'no dotted background: dots only behind graphs');
  assert.doesNotMatch(sec, /border-left\s*:/, 'no coloured left-edge accent lines');
  assert.ok(sec.includes(':is(.afb-folder,.afb-main,.afb-dl,.afb-ib):focus-visible'));
  assert.ok(sec.includes('.apv-ib:focus-visible'));
  assert.ok(!sec.includes('.apv-btn'), 'Download is the one .btn: no skin of its own');
  assert.ok(sec.includes('.apv-body:focus-visible'), 'the scrollable preview shows its focus');
  assert.ok(sec.includes('.afb-filter:focus{outline:none;box-shadow:inset 0 -2px 0 var(--ink);}'), 'the search field shows where the focus is');
  assert.ok(sec.includes('.apv.is-full .apv-stage.kind-image img{max-width:100%;max-height:100%;min-height:0;object-fit:contain;}'),
    'full screen fits an image to the screen (the stage is a flex column: unfitted, it stretches to the width, uncapped)');
  assert.doesNotMatch(sec, /\.apv\.is-full \.apv-stage\.kind-image img,/, 'never an uncapped full-screen image');
  assert.match(sec, /prefers-reduced-motion/);
  // U2: a file with no preview opens FULL SCREEN with its facts — the info view fills the window, card or not.
  assert.ok(sec.includes('.apv:is(.is-full,.is-info) .apv-card{width:100vw;max-width:none;height:100vh;max-height:none;'),
    'the info view and full screen fill the window');
  // Keyboard scrolling: the focus sits on .apv-body (the Tab stop), and a browser scrolls the focused box and its
  // ancestors, never a box inside it — so no popup rule but .apv-body may scroll, or a long code line, a wide diff
  // or a tall csv is out of a keyboard user's reach.
  const scrollers = [...sec.matchAll(/([^{}]*\.apv[^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /overflow(-[xy])?\s*:\s*(auto|scroll)/.test(body)).map(([, sel]) => sel.trim());
  assert.deepEqual(scrollers, ['.apv-body'], 'one scroller in the popup');
  assert.ok(sec.includes('.apv-code,.apv-stage .artifact-diff{white-space:pre;overflow-x:visible;'), 'code, json and diff widen the stage instead');
  assert.ok(sec.includes('.apv-stage .artifact-markdown pre{overflow-x:visible;'), 'a markdown code block is no scroller either');
  assert.ok(sec.includes('.apv-csv th{position:sticky;top:-14px;'), 'a csv header sticks at the scroller\'s top edge, over its padding');
  assert.ok(sec.includes('.afb-stem{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre;}'), 'a stem ending in a space keeps it ("CON .txt")');
  assert.ok(sec.includes('@media (max-width:480px){.apv-head{flex-wrap:wrap;'), 'a phone-width header wraps: the whole file name and its step · cycle · size stay readable');
});

// ── refine cycle 2: behaviours the browser claims that the rows above did not pin ──

test('Strings: the count says "1 file"; a row\'s cycle chip shows only in a one-cycle step and only from cycle 2', () => {
  const one = boot({ list: [A('plans/plan.md', 'n_plan', 1)] });
  assert.equal(one.host.querySelector('.afb-title').textContent, '1 file');
  const s = boot();
  assert.equal(row(s.host, 'plan.md').querySelector('.afb-cyc'), null, 'cycle 1: no chip');
  assert.equal(row(s.host, 'review-cycle2.json').querySelector('.afb-cyc'), null, 'inside its Cycle 2 folder the folder says it');
});

test('a cut name keeps its extension in a span of its own, so a narrow row ellipsizes the stem, never `.md`', () => {
  const long = `${'a'.repeat(60)}.md`;
  const s = boot({ list: [A(`notes/${long}`, 'n_plan', 1), A('Makefile', 'n_plan', 1)] });
  const nm = row(s.host, `${'a'.repeat(24)}…${'a'.repeat(16)}.md`).querySelector('.afb-name');
  assert.equal(nm.querySelector('.afb-ext').textContent, '.md');
  assert.equal(nm.querySelector('.afb-stem').textContent, `${'a'.repeat(24)}…${'a'.repeat(16)}`);
  assert.equal(row(s.host, 'Makefile').querySelector('.afb-ext'), null, 'no extension: the stem only');
});

test('the folded search field is no Tab stop; the search button says whether the field is open', () => {
  const s = boot();
  const btn = s.host.querySelector('.afb-sbtn');
  const f = s.host.querySelector('.afb-filter');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(f.tabIndex, -1);
  assert.ok(f.hasAttribute('inert'));
  tap(btn);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(f.tabIndex, 0);
  assert.equal(f.hasAttribute('inert'), false);
});

test('a browser dropped while its search field has the focus lets go of its window listener on the next key', () => {
  const s = boot();
  tap(s.host.querySelector('.afb-sbtn'));
  assert.equal(s.doc.activeElement, s.host.querySelector('.afb-filter'));
  const removed = [];
  const orig = s.win.removeEventListener.bind(s.win);
  s.win.removeEventListener = (t, fn, o) => { removed.push(t); return orig(t, fn, o); };
  s.host.remove();                                          // a screen swap: no destroy(), and no blur for a removed node
  s.win.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'a' }));
  assert.deepEqual(removed, ['keydown']);
});

test('a search hit opens with the hits as its ←/→ list; → on an open folder moves into it', () => {
  const s = boot();
  tap(s.host.querySelector('.afb-sbtn'));
  type(s, 'review');
  tap(row(s.host, 'review-cycle2.json'));
  assert.deepEqual(s.calls[0], ['open', 'review-cycle2.json', ['review-cycle1.json', 'review-cycle2.json']]);
  const k = boot();
  folderEl(k.host, 'n:n_plan').focus();
  press(k.doc.activeElement, 'ArrowRight');
  assert.equal(k.doc.activeElement, row(k.host, 'plan.md'));
  assert.equal(folderEl(k.host, 'n:n_plan').getAttribute('aria-expanded'), 'true');
});

test('a repaint that removes the focused row\'s folders hands focus up the chain, else to the first row — never <body>, never scrolling the page', () => {
  const six = Array.from({ length: 6 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const s = boot({ list: [...LIST(), ...six] });
  tap(folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
  row(s.host, 's0.png').focus();
  const opts = [];
  const focus = s.win.HTMLElement.prototype.focus;
  s.win.HTMLElement.prototype.focus = function (o) { opts.push(o); return focus.call(this, o); };
  s.b.update([...LIST(), ...six.slice(1)]);              // s0 gone, five left: no burst folder, the shots sit in their step
  assert.equal(s.doc.activeElement.dataset.focusKey, 'd:n:n_impl', 'the step folder, up the chain');
  assert.ok(opts.length > 0 && opts.every((o) => o && o.preventScroll === true), 'a live repaint never scrolls the page to the focus');
  s.win.HTMLElement.prototype.focus = focus;
  folderEl(s.host, 'n:__run__').focus();
  s.b.update(LIST().filter((a) => a.nodeId));            // no unattributed file: no "Run" folder
  assert.ok(s.host.contains(s.doc.activeElement), 'never <body>');
  assert.equal(s.doc.activeElement.dataset.folder, 'n:n_plan', 'the first row');
});

test('a live frame that only changes a file\'s size repaints its row; `order` may be a plain array', () => {
  const s = boot();
  s.b.update(LIST().map((a) => (a.relPath === 'plans/plan.md' ? { ...a, bytes: 4096 } : a)));
  assert.equal(row(s.host, 'plan.md').querySelector('.afb-size').textContent, '4.0 KB');
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost:4317/' });
  const host = dom.window.document.getElementById('host');
  createArtifactBrowser({ doc: dom.window.document, host, artifacts: LIST(), order: ['n_rev', 'n_plan'] });
  assert.deepEqual([...host.querySelectorAll('.afb-folder.is-step')].map((f) => f.dataset.folder), ['n:n_rev', 'n:n_plan', 'n:n_impl', 'n:__run__']);
});

test('reduced motion: every transition or animation in the P5 section is switched off under prefers-reduced-motion', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* ===== Chat P5: artifacts ===== */');
  const next = css.indexOf('/* ===== Chat P', at + 10);
  const sec = css.slice(at, next < 0 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = /@(?:media|keyframes)[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g;
  const off = new Set();
  for (const b of sec.match(blocks) || []) {
    if (!b.startsWith('@media (prefers-reduced-motion:reduce)')) continue;
    for (const m of b.slice(b.indexOf('{') + 1).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (/(transition|animation)\s*:\s*none/.test(m[2])) for (const s of m[1].split(',')) off.add(s.trim());
    }
  }
  const moving = [];
  for (const m of sec.replace(blocks, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/(^|;)\s*(transition|animation)\s*:\s*(?!none)/.test(m[2])) for (const s of m[1].split(',')) moving.push(s.trim());
  }
  assert.ok(moving.length >= 4, `the section's moving rules: ${moving.join(' ')}`);
  for (const s of moving) assert.ok(off.has(s), `${s} still moves under reduced motion`);
});

test('a "dot" more than 9 characters from the end is no extension: the whole name is the stem', () => {
  const s = boot({ list: [A('notes/release.v2-final-notes', 'n_plan', 1)] });
  const nm = row(s.host, 'release.v2-final-notes').querySelector('.afb-name');
  assert.equal(nm.querySelector('.afb-ext'), null);
  assert.equal(nm.querySelector('.afb-stem').textContent, 'release.v2-final-notes');
});

test('an arrow, Home or End with Alt, Ctrl, Meta or Shift is the browser\'s (Alt+← is Back), never a list move', () => {
  const s = boot();
  const r = row(s.host, 'plan.md');
  r.focus();
  for (const [key, mod] of [['ArrowLeft', 'altKey'], ['ArrowDown', 'shiftKey'], ['Home', 'ctrlKey'], ['End', 'metaKey']]) {
    const e = new s.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, [mod]: true });
    r.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, `${mod}+${key}`);
    assert.equal(s.doc.activeElement, r, `${mod}+${key}`);
  }
});

test('a double click on a row\'s Download saves the file once', () => {
  const s = boot();
  const dl = row(s.host, 'plan.md').parentElement.querySelector('.afb-dl');
  tap(dl, 1);
  tap(dl, 2);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'download'), [['download', 'plans/plan.md']]);
});

test('a step that starts its second cycle keeps the burst folder the reader opened, and the focused row', () => {
  const shots = Array.from({ length: 7 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const base = [A('plans/plan.md', 'n_plan', 1), A('deck/deck.html', 'n_impl', 1, { kind: 'deck' })];
  const s = boot({ list: [...base, ...shots] });
  tap(folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
  row(s.host, 's3.png').focus();
  s.b.update([...base, ...shots.map((a, i) => (i === 0 ? { ...a, cycle: 2 } : a))]);   // the audit rewrites one shot
  assert.equal(folderEl(s.host, 'n:n_impl/c1').getAttribute('aria-expanded'), 'true', 'no longer the latest, but it holds a folder the reader opened');
  assert.equal(folderEl(s.host, 'n:n_impl/c1/k:deck-shot').getAttribute('aria-expanded'), 'true', 'the opened burst folder is still open');
  assert.equal(folderEl(s.host, 'n:n_impl/c2').getAttribute('aria-expanded'), 'true', 'the new cycle is the latest');
  assert.equal(s.doc.activeElement, row(s.host, 's3.png'), 'the focused row keeps the focus');
  tap(folderEl(s.host, 'n:n_impl/c1'));
  assert.equal(folderEl(s.host, 'n:n_impl/c1').getAttribute('aria-expanded'), 'false', 'closed by hand: the reader\'s choice wins');
});

test('a focused row the repaint moves keeps the focus where its file now sits; moved into a new closed folder, that folder', () => {
  const five = Array.from({ length: 5 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const s = boot({ list: [...LIST(), ...five] });
  row(s.host, 's2.png').focus();
  s.b.update([...LIST(), ...five, A('shots/s5.png', 'n_impl', 1, { kind: 'deck-shot' })]);   // the 6th: a closed burst folder
  assert.equal(s.doc.activeElement, folderEl(s.host, 'n:n_impl/c1/k:deck-shot'), 'the folder that now holds it');
  tap(folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
  row(s.host, 's2.png').focus();
  s.b.update([...LIST(), ...five]);                                                          // five again: out of the folder
  assert.equal(s.doc.activeElement, row(s.host, 's2.png'), 'the row itself, where it sits now');
});

test('a row reads its whole name to a screen reader: the stem and extension spans are hidden, a visually hidden copy is not', () => {
  const long = `${'a'.repeat(60)}.md`;
  const s = boot({ list: [A(`notes/${long}`, 'n_plan', 1), A('Résumé plan.md', 'n_plan', 1)] });
  const [first, second] = s.host.querySelectorAll('.afb-main');
  assert.equal(first.querySelector('.afb-name').getAttribute('aria-hidden'), 'true');
  assert.equal(first.querySelector('.sr-only').textContent, long, 'the full name, not the cut one');
  assert.equal(second.querySelector('.sr-only').textContent, 'Résumé plan.md');
});

// ── refine cycle 4 ──
test('a focused row whose path another step also holds keeps the focus in its own step when its cycle folder closes', () => {
  const base = [A('notes/plan.md', 'n_plan', 1), A('notes/plan.md', 'n_impl', 1)];
  const s = boot({ list: base });
  [...s.host.querySelectorAll('.afb-main')].find((m) => m.dataset.focusKey === 'f:n:n_plan/c1|notes/plan.md').focus();
  s.b.update([...base, A('notes/other.md', 'n_plan', 2)]);         // n_plan's second cycle: its Cycle 1 closes
  assert.equal(s.doc.activeElement.dataset.focusKey, 'd:n:n_plan/c1', 'its own step\'s folder, never the other step\'s plan.md');
});

test('a focused row that moves into a burst folder of its own step goes there, though another step holds the same path', () => {
  const five = Array.from({ length: 5 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const theirs = A('shots/s2.png', 'n_rev', 1, { kind: 'deck-shot' });
  const s = boot({ list: [...LIST(), ...five, theirs] });
  [...s.host.querySelectorAll('.afb-main')].find((m) => m.dataset.focusKey === 'f:n:n_impl/c1|shots/s2.png').focus();
  s.b.update([...LIST(), ...five, A('shots/s5.png', 'n_impl', 1, { kind: 'deck-shot' }), theirs]);
  assert.equal(s.doc.activeElement, folderEl(s.host, 'n:n_impl/c1/k:deck-shot'), 'its own step\'s new burst folder, not the Review row');
});

test('a focused row whose cycle closes keeps the focus on THAT cycle, though an open cycle of the step holds the same path', () => {
  const s = boot({ list: [A('out/plan.md', 'n_impl', 1), A('out/plan.md', 'n_impl', 2)] });
  tap(folderEl(s.host, 'n:n_impl/c1'));                                            // the reader opens Cycle 1 too
  [...s.host.querySelectorAll('.afb-main')].find((m) => m.dataset.focusKey === 'f:n:n_impl/c2|out/plan.md').focus();
  s.b.update([A('out/plan.md', 'n_impl', 1), A('out/plan.md', 'n_impl', 2), A('out/notes.md', 'n_impl', 3)]);   // Cycle 2 closes
  assert.equal(s.doc.activeElement, folderEl(s.host, 'n:n_impl/c2'), 'Cycle 2\'s folder, never Cycle 1\'s copy');
});

test('a burst folder the reader opened and closed again does not hold its cycle open once a later cycle arrives', () => {
  const shots = Array.from({ length: 7 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const base = [A('plans/plan.md', 'n_plan', 1), A('deck/deck.html', 'n_impl', 1, { kind: 'deck' })];
  const s = boot({ list: [...base, ...shots] });
  tap(folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
  tap(folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
  s.b.update([...base, ...shots.map((a, i) => (i === 0 ? { ...a, cycle: 2 } : a))]);
  assert.equal(folderEl(s.host, 'n:n_impl/c1').getAttribute('aria-expanded'), 'false');
});

test('a folder opened inside Cycle 10 does not open Cycle 1 (a key prefix is no parent)', () => {
  const s = boot({ list: [1, 10, 11].map((c) => A(`out/c${c}.md`, 'n_impl', c)) });
  tap(folderEl(s.host, 'n:n_impl/c10'));
  assert.equal(folderEl(s.host, 'n:n_impl/c10').getAttribute('aria-expanded'), 'true');
  assert.equal(folderEl(s.host, 'n:n_impl/c1').getAttribute('aria-expanded'), 'false');
});

test('a focused row Download that the repaint moves into a new closed folder hands the focus to that folder', () => {
  const five = Array.from({ length: 5 }, (_, i) => A(`shots/s${i}.png`, 'n_impl', 1, { kind: 'deck-shot' }));
  const s = boot({ list: [...LIST(), ...five] });
  row(s.host, 's2.png').parentElement.querySelector('.afb-dl').focus();
  s.b.update([...LIST(), ...five, A('shots/s5.png', 'n_impl', 1, { kind: 'deck-shot' })]);
  assert.equal(s.doc.activeElement, folderEl(s.host, 'n:n_impl/c1/k:deck-shot'));
});

test('the Files folder names each work file\'s sub-folder, so two index.html stay apart', () => {
  const W = (relPath) => ({ kind: 'work', relPath, bytes: 1, nodeId: null, cycle: null });
  const s = boot({ list: [W('work/site/index.html'), W('work/docs/index.html'), W('work/deck.html')] });
  const f = folderEl(s.host, 'n:__work__');
  if (f.getAttribute('aria-expanded') !== 'true') tap(f);
  assert.deepEqual([...s.host.querySelectorAll('.afb-file')].map((r) => [r.querySelector('.afb-name').textContent, r.querySelector('.afb-where')?.textContent ?? null]),
    [['index.html', 'site/'], ['index.html', 'docs/'], ['deck.html', null]]);
});

test('artifactTree: a run without a project lists its work files first, in a Files folder', () => {
  assert.deepEqual(artifactTree([{ kind: 'plan', relPath: 'plan.md', nodeId: 'n_plan' }, { kind: 'work', relPath: 'work/deck.html' }], { nodeLabel: () => 'Plan' }).map((f) => f.label), ['Files', 'Plan']);
});
