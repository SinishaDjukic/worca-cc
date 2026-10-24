// test/dialog-layout.test.mjs — the shared dialog anatomy: the helper, cardAlert placement, every migrated
// dialog's head/body/foot (index.html and the JS builders), and the CSS that makes .dlg-body the one scroller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { layoutDialog, syncDialogEdges, watchDialogEdges } from '../ui/public/dialog-layout.mjs';
import { cardAlert } from '../ui/public/feedback.mjs';
import { cssRules } from './helpers/css-rules.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('ui/public/style.css');
const page = new JSDOM(read('ui/public/index.html')).window.document;
const ALL = cssRules(css);
const has = (sel, re) => ALL.some((r) => r.sel === sel && re.test(r.body));

const MIGRATED = ['#shipit-modal', '#publish-modal', '#export-modal', '#report-modal', '#confirm-modal',
  '#scan-model-modal', '#stop-modal', '#mode-modal', '#welcome-modal', '#claude-setup-modal',
  '#project-add-modal', '#project-git-modal', '#project-bulk-modal', '#plugin-modal', '#viewer-card'];
const NO_FOOT = new Set(['#viewer-card']);
// Bordered, deliberately bounded boxes that may scroll inside a body (design-system.md › Modals).
// If the census below names another bordered, bounded box on first run (e.g. a textarea rule), add it here
// only after checking it is a framed widget; an unframed list (like .shipit-repos was) loses its cap instead.
const INNER_OK = ['.export-plan', '.export-pr-preview > pre', '.proj-bulk-list', '.report-modal #report-preview', '.viewer', '.artifact-view'];

// The JS builders' modal and column classes, as they build them (branch-sync.mjs:432/530, folder-changes.mjs:123,
// schedule-sheet.mjs:267, modal-guard.mjs:152, app.js openModelEditorDialog → #mv-editor-host), so the CSS census
// covers the JS-built dialogs too. The builders' real output is pinned by the extended suites below.
const REGIONS = '<div class="dlg-head"></div><div class="dlg-body"></div><div class="dlg-foot"></div>';
page.body.insertAdjacentHTML('beforeend', `
  <div class="viewer-modal confirm-modal sync-modal"><div class="card sync-card dlg" data-js="sync">${REGIONS}</div></div>
  <div class="viewer-modal confirm-modal sync-modal"><div class="card" data-js="refusal-card"><div class="qpanel dlg" data-js="refusal">${REGIONS}</div></div></div>
  <div class="viewer-modal confirm-modal fc-modal"><div class="card fc-dlg dlg" data-js="apply">${REGIONS}</div></div>
  <div class="viewer-modal confirm-modal sched-modal"><div class="card sched-card dlg" data-js="schedule">${REGIONS}</div></div>
  <dialog class="viewer-modal confirm-modal discard-modal"><div class="card dlg" data-js="discard">${REGIONS}</div></dialog>`);
page.getElementById('mv-editor-host').innerHTML = `<section class="card mv-editor dlg" data-js="model-editor">${REGIONS}</section>`;
const JS_CARDS = [...page.querySelectorAll('[data-js]')];

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const node = (d, tag, cls) => { const n = d.createElement(tag); if (cls) n.className = cls; return n; };

test('layoutDialog wraps head, body and foot in order and keeps every node and hook', () => {
  const d = doc();
  const card = node(d, 'div', 'card x-card');
  const h2 = node(d, 'h2'); h2.id = 'x-title';
  const sub = node(d, 'p', 'x-sub');
  const a = node(d, 'div', 'x-a'); const b = node(d, 'ul', 'x-b');
  const err = node(d, 'p', 'x-err');
  const row = node(d, 'div', 'confirm-actions'); row.setAttribute('data-card-actions', '');
  card.append(h2, sub, a, b, err, row);
  layoutDialog(card, { head: [h2, sub, null], foot: [err, row] });
  assert.ok(card.classList.contains('dlg'));
  assert.deepEqual([...card.children].map((c) => c.className), ['dlg-head', 'dlg-body', 'dlg-foot']);
  assert.deepEqual([...card.children[0].children], [h2, sub]);
  assert.deepEqual([...card.children[1].children], [a, b]);
  assert.deepEqual([...card.children[2].children], [err, row]);
  assert.equal(card.querySelector('#x-title'), h2);
  assert.ok(card.querySelector('.dlg-foot > [data-card-actions]'));
});

test('layoutDialog is idempotent, skips non-children and omits an empty head or foot', () => {
  const d = doc();
  const card = node(d, 'div', 'card');
  const p = node(d, 'p'); card.append(p);
  const stranger = node(d, 'div');
  layoutDialog(card, { head: [stranger], foot: [] });
  assert.deepEqual([...card.children].map((c) => c.className), ['dlg-body']);
  layoutDialog(card, { head: [p] });           // second call: no-op
  assert.equal(card.children.length, 1);
  assert.equal(card.querySelector('.dlg-body > p'), p);
});

test('syncDialogEdges flags content under the head and below the foot', () => {
  const d = doc();
  const card = node(d, 'div', 'card'); card.append(node(d, 'p'));
  layoutDialog(card, {});
  const body = card.querySelector('.dlg-body');
  const metrics = (top, client, scroll) => {
    Object.defineProperty(body, 'scrollTop', { value: top, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: client, configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: scroll, configurable: true });
    syncDialogEdges(body);
    return [card.hasAttribute('data-under-head'), card.hasAttribute('data-under-foot')];
  };
  assert.deepEqual(metrics(0, 300, 300), [false, false], 'fits: no divider');
  assert.deepEqual(metrics(0, 300, 900), [false, true], 'at top: foot divider only');
  assert.deepEqual(metrics(200, 300, 900), [true, true], 'mid-way: both');
  assert.deepEqual(metrics(600, 300, 900), [true, false], 'at the end: head divider only');
  assert.deepEqual(metrics(1, 300, 900), [false, true], 'scrollTop 1 is still "at top" (EDGE_PX)');
});

test('watchDialogEdges adds one capture scroll listener per document and reacts to a body scroll', () => {
  const d = doc();
  const calls = [];
  const orig = d.addEventListener.bind(d);
  d.addEventListener = (type, fn, opts) => { calls.push([type, opts]); return orig(type, fn, opts); };
  const card = node(d, 'div', 'card'); card.append(node(d, 'p'));
  d.body.append(card);
  layoutDialog(card, {});                       // watches the card's document once
  watchDialogEdges(d); watchDialogEdges(d);     // and again, twice: still one listener
  assert.deepEqual(calls, [['scroll', true]]);
  const body = card.querySelector('.dlg-body');
  Object.defineProperty(body, 'scrollTop', { value: 40, configurable: true });
  Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true });
  body.dispatchEvent(new d.defaultView.Event('scroll'));
  assert.ok(card.hasAttribute('data-under-head'));
});

test('cardAlert stays inside a .dlg card: above the action row in the foot, else at the end of the foot', () => {
  const d = doc();
  const withRow = node(d, 'div', 'card');
  const row = node(d, 'div', 'confirm-actions'); row.setAttribute('data-card-actions', '');
  withRow.append(node(d, 'h2'), node(d, 'p'), row);
  layoutDialog(withRow, { head: [withRow.firstChild], foot: [row] });
  const a = cardAlert(withRow, { title: 'Not saved', detail: 'x' });
  assert.equal(a.parentElement.className, 'dlg-foot');
  assert.equal(a.nextElementSibling, row);
  const noRow = node(d, 'section', 'card mv-editor');
  const btns = node(d, 'div', 'mv-editor-btns');
  noRow.append(node(d, 'h3'), node(d, 'div'), btns);
  layoutDialog(noRow, { head: [noRow.firstChild], foot: [btns] });
  const b = cardAlert(noRow, { title: 'Not saved', detail: 'y' });
  assert.equal(b.parentElement.className, 'dlg-foot');
  assert.deepEqual([...noRow.children].map((c) => c.className), ['dlg-head', 'dlg-body', 'dlg-foot']);
});

test('CSS: the .dlg card is a clipping column, the body is the one scroller, seams, dividers, short windows', () => {
  assert.ok(has('.viewer-modal .card.dlg', /display:flex;flex-direction:column;overflow:hidden;/));
  assert.ok(has('.dlg', /--dlg-gap-head:18px;--dlg-gap-foot:14px;/));
  assert.ok(has('.dlg-head,.dlg-foot', /flex:none;min-width:0;position:relative;z-index:1;margin-inline:calc\(-1 \* var\(--pad-card\)\);padding-inline:var\(--pad-card\);/));
  assert.ok(has('.dlg-body', /flex:1 1 auto;min-height:0;overflow:auto;margin-inline:calc\(-1 \* var\(--pad-card\)\);padding:var\(--dlg-gap-head\) var\(--pad-card\) var\(--dlg-gap-foot\);/));
  assert.ok(ALL.some((r) => /^\.dlg-body > :nth-child\(1 of/.test(r.sel) && /margin-top:0;/.test(r.body)), 'body/foot leading margins zeroed');
  assert.ok(ALL.some((r) => /^\.dlg-head > :nth-last-child\(1 of/.test(r.sel) && /margin-bottom:0;/.test(r.body)), 'head/body trailing margins zeroed');
  assert.ok(has('.dlg-head::after,.dlg-foot::before', /background:var\(--line\);opacity:0;/));
  assert.ok(has('.dlg[data-under-head] > .dlg-head::after,.dlg[data-under-foot] > .dlg-foot::before', /opacity:1;/));
  assert.ok(!ALL.some((r) => /\.dlg/.test(r.sel) && /box-shadow/.test(r.body)), 'the divider is not a resting shadow');
  assert.ok(has('.viewer-modal .shipit-card.dlg', /--dlg-gap-head:0px;--dlg-gap-foot:14px;/), 'Create PR: the zones carry the spacing');
  assert.ok(has('.shipit-card.dlg > .dlg-head::after,.shipit-card.dlg > .dlg-foot::before', /display:none;/), 'its title and footer rules are the dividers');
  // Add project's foot gap is 0 (the last .field brings 18px), so a trailing switch row needs its own 14px.
  assert.ok(has('#scan-model-modal .card.dlg,#project-add-modal .card.dlg', /--dlg-gap-foot:0px;/));
  assert.ok(has('#project-add-modal .dlg-body > .proj-add-git', /margin-bottom:14px;/), 'the Use git row keeps the 14px above the foot');
  assert.ok(has('.viewer-modal .dlg-body .card', /max-height:none;overflow:visible;/), 'a nested card never scrolls');
  const short = ALL.filter((r) => /max-height:\s*640px/.test(r.media));
  assert.ok(short.some((r) => r.sel === '.viewer-modal .card.dlg' && /max-height:calc\(100dvh - 24px\)/.test(r.body)));
  assert.ok(short.some((r) => r.sel === '.viewer-modal .dlg' && /--dlg-gap-head:10px;/.test(r.body)));
  assert.ok(short.some((r) => r.sel === '.dlg .ob-hero' && /max-height:88px;/.test(r.body)));
  const phone = ALL.filter((r) => /max-width:\s*760px/.test(r.media));
  assert.ok(phone.some((r) => r.sel === '.viewer-modal .card.dlg.ob-welcome' && /max-height:calc\(100dvh - 24px\);/.test(r.body)));
  assert.ok(phone.some((r) => r.sel === '.dlg .ob-hero' && /max-height:30vh;/.test(r.body)));
  assert.ok(ALL.some((r) => /\.dlg-head::after/.test(r.sel) && /prefers-reduced-motion/.test(r.media) && /transition:none/.test(r.body)));
  assert.doesNotMatch(css, /top:-24px/, 'the sticky report-top hack is gone');
  assert.doesNotMatch(css, /margin:-24px -24px 16px/);
});

test('every migrated index.html dialog is .card.dlg > .dlg-head, .dlg-body[, .dlg-foot] and nothing else', () => {
  for (const id of MIGRATED) {
    const card = page.querySelector(`${id} .card`);
    assert.ok(card?.classList.contains('dlg'), `${id} card has .dlg`);
    const want = NO_FOOT.has(id) ? ['dlg-head', 'dlg-body'] : ['dlg-head', 'dlg-body', 'dlg-foot'];
    assert.deepEqual([...card.children].map((c) => [...c.classList].find((k) => k.startsWith('dlg-'))), want, id);
    if (!NO_FOOT.has(id)) assert.ok(card.querySelector(':scope > .dlg-foot .btn, :scope > .dlg-foot .confirm-actions'), `${id}: the actions live in the foot`);
  }
  // The reported case: the title is head content, the zones are body content.
  assert.ok(page.querySelector('#shipit-modal .dlg-head > h2.shipit-title:only-child'));
  assert.ok(page.querySelector('#shipit-modal .dlg-body > .shipit-into + .shipit-prs + #shipit-repos + .shipit-desc + .shipit-slice-note + .shipit-after'));
  // Status lines sit in the foot, above the actions, so a save error stays in view.
  for (const sel of ['#mode-msg', '#proj-add-msg', '#proj-git-msg', '#proj-bulk-msg']) {
    const s = page.querySelector(sel);
    assert.ok(s?.parentElement?.classList.contains('dlg-foot'), `${sel} is in .dlg-foot`);
    assert.ok(s.nextElementSibling, `${sel} comes before the action row`);
  }
  // Hooks JS and tests use survive the wrap.
  for (const sel of ['#shipit-modal .shipit-ok', '#shipit-modal .shipit-cancel', '#shipit-desc-input', '#shipit-modal [data-card-actions]',
    '#confirm-ok', '#confirm-cancel', '#report-create-issue', '#viewer-full', '#viewer-close', '#plugin-modal-body', '#plugin-modal-actions'])
    assert.ok(page.querySelector(sel), sel);
});

test('no rule re-enables card scrolling (static and JS-built), and only bounded boxes scroll inside a body', () => {
  const cards = [...MIGRATED.map((id) => page.querySelector(`${id} .card`)), ...JS_CARDS, page.getElementById('mv-editor-host')];
  const scrolls = (r) => /(?:^|;)\s*overflow(?:-y)?\s*:\s*(auto|scroll)/.test(r.body);
  const matchesAny = (els, sel) => { try { return els.some((e) => e.matches(sel)); } catch { return false; } };
  const offenders = ALL.filter((r) => scrolls(r) && r.sel !== '.viewer-modal .card' && matchesAny(cards, r.sel));
  assert.deepEqual(offenders.map((r) => r.sel), [], 'a card rule sets overflow');
  const inner = MIGRATED.flatMap((id) => [...page.querySelectorAll(`${id} .dlg-body *`)]);
  const nested = ALL.filter((r) => scrolls(r) && /max-height/.test(r.body) && !INNER_OK.includes(r.sel) && matchesAny(inner, r.sel));
  assert.deepEqual(nested.map((r) => r.sel), [], 'an unbounded second scroller inside a body');
});

test('already-pinned dialogs keep their own head outside their scroller', () => {
  assert.ok(page.querySelector('#model-import-modal .mimp > #mimp-body'));
  assert.ok(has('#mimp-body', /min-height:0;overflow:auto;/));
  assert.ok(has('.folder-modal .card', /display:flex;flex-direction:column;overflow:hidden;/));
  assert.ok(has('.apv-body', /min-height:0;overflow:auto;/));
  assert.ok(has('.mk-dialog-body', /min-height:0;overflow:auto;/));
});

test('JS builders route through the shared helper', () => {
  for (const f of ['ui/public/schedule-sheet.mjs', 'ui/public/branch-sync.mjs', 'ui/public/folder-changes.mjs', 'ui/public/modal-guard.mjs', 'ui/public/app.js'])
    assert.match(read(f), /import \{[^}]*\blayoutDialog\b[^}]*\} from '\.\/dialog-layout\.mjs';/, f);
  assert.equal((read('ui/public/branch-sync.mjs').match(/layoutDialog\(/g) || []).length, 2, 'sync dialog + sync refusal');
  assert.match(read('ui/public/app.js'), /watchDialogEdges\(document\)/);
});

test('the team memory seeding review is no second scroller inside #plugin-modal\'s body (only its bounded preview boxes are)', () => {
  const seed = ALL.filter((r) => r.sel === '.mem-seed');
  assert.equal(seed.length, 1);
  assert.doesNotMatch(seed[0].body, /overflow|max-height/);
});
