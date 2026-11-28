// test/ui-run-links.test.mjs — Shaper small runs s8 (R-ux-2): link marks on pointing. Pointing at a run row marks the
// rows it directly builds on (data-link="on", the solid bar) and the rows that directly build on it (data-link="by",
// the dashed bar); click, Enter or Space keeps the marks, Esc lets go. First the shared module (ui/public/run-links.mjs)
// over hand-built rows, then the real Chat card and feature page over the 16-run feature.
import { test, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';
import { walked, walkWorld, cardHost, pageHost } from './helpers/shape-surfaces.mjs';

useTempHome(after, 'worca-run-links-');
const trackDom = useDomRelease(afterEach);
const root = mkdtempSync(join(tmpdir(), 'worca-run-links-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

const links = () => import('../ui/public/run-links.mjs');
const ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const ROWS = SIXTEEN_RUN_LINKS.map((l) => ({ run: l.run, buildsOn: [...l.dependsOn] }));
const RUNS = ROWS.map((r) => r.run);
/** Pointing at run 12: it builds on 1, 7 and 10 (solid); only run 16 lists 12 (dashed). */
const TWELVE = { on: [1, 7, 10], by: [16] };
const SIXTEEN = { on: [9, 11, 12, 13, 14, 15], by: [] };
const NONE = { on: [], by: [] };

// ---- events --------------------------------------------------------------------------------------------------------
const winOf = (el) => el.ownerDocument.defaultView;
function fire(el, Type, name, init = {}) {
  const e = new (winOf(el)[Type])(name, { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}
const over = (el) => fire(el, 'PointerEvent', 'pointerover');
const out = (el, relatedTarget = null) => fire(el, 'PointerEvent', 'pointerout', { relatedTarget });
const focusIn = (el) => fire(el, 'FocusEvent', 'focusin');
const focusOut = (el, relatedTarget = null) => fire(el, 'FocusEvent', 'focusout', { relatedTarget });
const click = (el) => fire(el, 'MouseEvent', 'click', { button: 0 });
const press = (el, key) => fire(el, 'KeyboardEvent', 'keydown', { key });
const esc = (el) => press(el, 'Escape');

// ---- reading the marks ---------------------------------------------------------------------------------------------
const numberOf = (li) => Number(li.querySelector('.run-member-num').textContent);
const rowOf = (host, run) => {
  const li = [...host.querySelectorAll('.run-member:not([data-key="planning"])')].find((x) => numberOf(x) === run);
  assert.ok(li, `the row of run ${run}`);
  return li;
};
const numbered = (host, sel) => [...host.querySelectorAll(sel)].map(numberOf).sort((a, b) => a - b);
const marks = (host) => ({ on: numbered(host, '[data-link="on"]'), by: numbered(host, '[data-link="by"]') });
const kept = (host) => numbered(host, '[data-link-kept]');
/** Nothing at all is marked or kept under `host`. */
function assertClear(host, why) {
  assert.equal(host.querySelectorAll('[data-link]').length, 0, `${why}: no data-link`);
  assert.equal(host.querySelectorAll('[data-link-kept]').length, 0, `${why}: no data-link-kept`);
  assert.equal(host.querySelectorAll('.run-member[aria-current]').length, 0, `${why}: no aria-current`);
}
/** Run `run` is the one kept row: data-link-kept and aria-current="true". */
function assertKept(host, run, why) {
  assert.deepEqual(kept(host), [run], `${why}: the kept row`);
  assert.deepEqual(numbered(host, '.run-member[aria-current]'), [run], `${why}: aria-current`);
  assert.equal(rowOf(host, run).getAttribute('aria-current'), 'true', `${why}: aria-current="true"`);
}

// ---- a hand-built list ---------------------------------------------------------------------------------------------
/** The rows as renderMemberRows shapes them: a planning row without data-run, then one link row per run, each with a
 *  title link, a PR chip link and a button inside it. `plain` leaves the link attributes off. */
function list(doc, rows = ROWS, { plain = false } = {}) {
  const ol = doc.createElement('ol');
  ol.className = 'run-members is-table is-one-line';
  ol.innerHTML = '<li class="run-member" data-key="planning"><span class="status-dot"></span><span class="run-member-num"></span>'
    + '<span class="run-member-main"><a class="run-member-title" href="#r0">Planning</a></span></li>'
    + rows.map((r) => `<li class="run-member"${plain ? '' : ` data-run="${r.run}" data-builds-on="${r.buildsOn.join(' ')}" tabindex="0"`}>`
      + `<span class="status-dot"></span><span class="run-member-num">${r.run}</span>`
      + `<span class="run-member-main"><a class="run-member-title" href="#r${r.run}">Run ${r.run}</a><button type="button" class="plan-check-line">Requirements</button></span>`
      + `<span class="run-member-pr"><a class="runs-pr" href="https://example.test/pull/${r.run}"><span class="runs-pr-word">PR</span></a></span></li>`).join('');
  return ol;
}

/** A page with the list's host and some controls outside it, the binder not yet bound. */
function page(rows = ROWS, opts = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><body><div id="host"></div><input id="field"><textarea id="area"></textarea>'
    + '<select id="pick"><option>a</option></select><div id="edit" contenteditable="true">text</div>'
    + '<dialog open><button type="button" id="in-dialog">Close</button></dialog><button type="button" id="outside">Outside</button></body>'));
  const doc = dom.window.document;
  const host = doc.getElementById('host');
  host.append(list(doc, rows, opts));
  return { doc, host, body: doc.body, byId: (id) => doc.getElementById(id), row: (n) => rowOf(host, n) };
}
async function bound(rows = ROWS, opts = {}) {
  const { bindRunLinks } = await links();
  const p = page(rows, opts);
  return { ...p, links: bindRunLinks(p.host) };
}
/** Keep run `run` by click, then leave the list, so only the kept row holds the marks. */
function keep(p, run) {
  click(p.row(run).querySelector('.run-member-num'));
  assertKept(p.host, run, `keep ${run}`);
}

// ---- linkMarksOf ---------------------------------------------------------------------------------------------------
test('linkMarksOf: run 12 of the 16-run feature gives on for 1, 7, 10 and by for 16, and nothing else', async () => {
  const { linkMarksOf } = await links();
  const got = linkMarksOf(ROWS, 12);
  assert.ok(got instanceof Map);
  assert.deepEqual([...got].sort((a, b) => a[0] - b[0]), [[1, 'on'], [7, 'on'], [10, 'on'], [16, 'by']]);
  assert.equal(got.size, 4);
});

test('linkMarksOf: a null or unknown run gives an empty map, and the pointed run is never in it', async () => {
  const { linkMarksOf } = await links();
  assert.equal(linkMarksOf(ROWS, null).size, 0);
  assert.equal(linkMarksOf(ROWS, 99).size, 0);
  for (const run of RUNS) assert.equal(linkMarksOf(ROWS, run).has(run), false, `run ${run}`);
  assert.equal(linkMarksOf([{ run: 1, buildsOn: [1] }], 1).size, 0, 'a row that lists itself');
});

test('linkMarksOf: a row that qualifies both ways reads on, and a buildsOn entry with no row is ignored', async () => {
  const { linkMarksOf } = await links();
  assert.deepEqual([...linkMarksOf([{ run: 1, buildsOn: [2] }, { run: 2, buildsOn: [1] }], 1)], [[2, 'on']]);
  assert.deepEqual([...linkMarksOf([{ run: 1, buildsOn: [] }, { run: 2, buildsOn: [1, 99] }], 2)], [[1, 'on']]);
});

// ---- bindRunLinks: pointing ----------------------------------------------------------------------------------------
test('bindRunLinks: hovering run 12 marks 1, 7, 10 solid and 16 dashed; leaving the list removes every mark', async () => {
  const p = await bound();
  over(p.row(12).querySelector('.status-dot'));
  assert.deepEqual(marks(p.host), TWELVE);
  assert.equal(p.host.querySelectorAll('[data-link]').length, 4, 'the other 12 rows, the pointed one included, carry none');
  assert.deepEqual(kept(p.host), [], 'a hover keeps nothing');
  out(p.row(12), p.byId('outside'));
  assertClear(p.host, 'pointer left');
});

test('bindRunLinks: moving to another row shows that row\'s links; moving inside a row keeps them', async () => {
  const p = await bound();
  over(p.row(12));
  out(p.row(12), p.row(12).querySelector('.run-member-title'));
  assert.deepEqual(marks(p.host), TWELVE, 'still inside the row');
  out(p.row(12), p.row(16));
  over(p.row(16));
  assert.deepEqual(marks(p.host), SIXTEEN);
  out(p.row(16), null);
  assertClear(p.host, 'pointer left the window');
});

test('bindRunLinks: focusing a row (or its title link) marks the links; focus leaving the list removes them', async () => {
  const p = await bound();
  p.row(12).focus();
  assert.deepEqual(marks(p.host), TWELVE, 'row focus');
  p.byId('outside').focus();
  assertClear(p.host, 'focus left');
  focusIn(p.row(16).querySelector('.run-member-title'));
  assert.deepEqual(marks(p.host), SIXTEEN, 'title link focus');
  focusOut(p.row(16).querySelector('.run-member-title'), p.byId('outside'));
  assertClear(p.host, 'focusout');
});

// ---- bindRunLinks: keeping -----------------------------------------------------------------------------------------
test('bindRunLinks: a click on the row keeps the marks after the pointer leaves; a second click lets go', async () => {
  const p = await bound();
  over(p.row(12));
  click(p.row(12).querySelector('.run-member-num'));
  assertKept(p.host, 12, 'click');
  out(p.row(12), p.byId('outside'));
  assert.deepEqual(marks(p.host), TWELVE, 'kept after pointerout');
  assertKept(p.host, 12, 'kept after pointerout');
  click(p.row(12));
  assert.deepEqual(kept(p.host), []);
  assert.equal(p.host.querySelectorAll('[aria-current]').length, 0);
  out(p.row(12), p.byId('outside'));
  assertClear(p.host, 'after the second click');
});

test('bindRunLinks: while 12 is kept, pointing at 16 shows 16; leaving the list falls back to 12; a click moves the keep', async () => {
  const p = await bound();
  keep(p, 12);
  over(p.row(16));
  assert.deepEqual(marks(p.host), SIXTEEN, 'the pointed run is shown');
  assertKept(p.host, 12, 'the keep stays');
  out(p.row(16), p.byId('outside'));
  assert.deepEqual(marks(p.host), TWELVE, 'back to the kept run');
  click(p.row(16));
  assertKept(p.host, 16, 'one kept run at a time');
  assert.deepEqual(marks(p.host), SIXTEEN);
});

test('bindRunLinks: Enter keeps after focusout, pointerout and focus on the body; a second Enter lets go', async () => {
  const p = await bound();
  p.row(12).focus();
  const e = press(p.row(12), 'Enter');
  assert.equal(e.defaultPrevented, true);
  focusOut(p.row(12), null);
  out(p.row(12), null);
  p.row(12).blur();
  assert.equal(p.doc.activeElement, p.body);
  assert.deepEqual(marks(p.host), TWELVE);
  assertKept(p.host, 12, 'Enter');
  p.row(12).focus();
  press(p.row(12), 'Enter');
  assert.deepEqual(kept(p.host), []);
  p.row(12).blur();
  assertClear(p.host, 'let go');
});

test('bindRunLinks: Space keeps like Enter and is default-prevented', async () => {
  const p = await bound();
  p.row(12).focus();
  const e = press(p.row(12), ' ');
  assert.equal(e.defaultPrevented, true, 'no page scroll');
  p.row(12).blur();
  assert.deepEqual(marks(p.host), TWELVE);
  assertKept(p.host, 12, 'Space');
});

test('bindRunLinks: a click or Enter on the title link, the PR chip or a button does not toggle keep and is not default-prevented', async () => {
  const p = await bound();
  for (const sel of ['.run-member-title', '.runs-pr', '.runs-pr-word', '.plan-check-line']) {
    const e = click(p.row(12).querySelector(sel));
    assert.equal(e.defaultPrevented, false, `click ${sel}`);
    assert.deepEqual(kept(p.host), [], `click ${sel}`);
  }
  for (const sel of ['.run-member-title', '.runs-pr', '.plan-check-line']) {
    const e = press(p.row(12).querySelector(sel), 'Enter');
    assert.equal(e.defaultPrevented, false, `Enter on ${sel}`);
    assert.deepEqual(kept(p.host), [], `Enter on ${sel}`);
  }
  keep(p, 12);   // the binder is live: the row itself keeps
});

test('bindRunLinks: a click or Enter another handler already default-prevented keeps nothing', async () => {
  const p = await bound();
  const stop = (e) => e.preventDefault();
  const num = p.row(12).querySelector('.run-member-num');
  num.addEventListener('click', stop);
  p.row(12).addEventListener('keydown', stop);
  click(num);
  press(p.row(12), 'Enter');
  assert.deepEqual(kept(p.host), []);
  num.removeEventListener('click', stop);
  keep(p, 12);
});

// ---- bindRunLinks: Esc ---------------------------------------------------------------------------------------------
test('bindRunLinks: Escape inside the list clears every mark and the keep, and calls preventDefault only then', async () => {
  const p = await bound();
  assert.equal(esc(p.row(3)).defaultPrevented, false, 'nothing shown');
  keep(p, 12);
  over(p.row(16));
  const e = esc(p.row(3));
  assert.equal(e.defaultPrevented, true);
  assertClear(p.host, 'Escape on the host');
  assert.equal(esc(p.row(3)).defaultPrevented, false, 'nothing left to clear');
  over(p.row(12));
  assert.equal(esc(p.row(12)).defaultPrevented, true, 'a pointed mark counts');
  assertClear(p.host, 'Escape on pointed marks');
});

test('bindRunLinks: with a row kept and focus on the body, Escape on the body clears every mark', async () => {
  const p = await bound();
  p.row(12).focus();
  press(p.row(12), 'Enter');
  p.row(12).blur();
  assert.equal(p.doc.activeElement, p.body);
  const e = esc(p.body);
  assert.equal(e.defaultPrevented, true);
  assertClear(p.host, 'Escape on the body');
  assert.equal(esc(p.body).defaultPrevented, false, 'after let-go the page Escape is left alone');
});

test('bindRunLinks: Escape anywhere on the page lets go too, and only while a run is kept', async () => {
  const p = await bound();
  over(p.row(12));
  assert.equal(esc(p.body).defaultPrevented, false, 'hover only: no page listener');
  assert.deepEqual(marks(p.host), TWELVE);
  out(p.row(12), p.byId('outside'));
  keep(p, 12);
  assert.equal(esc(p.byId('outside')).defaultPrevented, true);
  assertClear(p.host, 'Escape on a button outside');
  keep(p, 12);
  click(p.row(12));   // let go by click
  assert.equal(esc(p.body).defaultPrevented, false, 'no page listener after a click let-go');
});

test('bindRunLinks: Escape in a text field, a select, an editable box or an open dialog clears nothing', async () => {
  const p = await bound();
  keep(p, 12);
  for (const id of ['field', 'area', 'pick', 'edit', 'in-dialog']) {
    const e = esc(p.byId(id));
    assert.equal(e.defaultPrevented, false, id);
    assertKept(p.host, 12, id);
    assert.deepEqual(marks(p.host), TWELVE, id);
  }
});

test('bindRunLinks: an Escape already default-prevented clears nothing; the next one does', async () => {
  const { bindRunLinks } = await links();
  const p = page();
  let first = true;
  const earlier = (e) => { if (first && e.key === 'Escape') { first = false; e.preventDefault(); } };   // the app's own Escape
  p.doc.addEventListener('keydown', earlier);
  bindRunLinks(p.host);
  keep(p, 12);
  esc(p.body);
  assertKept(p.host, 12, 'the first press is taken');
  esc(p.body);
  assertClear(p.host, 'the second press');
  keep(p, 12);
  p.row(3).addEventListener('keydown', (e) => e.preventDefault());
  esc(p.row(3));
  assertKept(p.host, 12, 'a prevented Escape inside the list');
});

// ---- bindRunLinks: inert hosts, rebuilds, detach --------------------------------------------------------------------
test('bindRunLinks: a host with no data-run rows sets nothing and never calls preventDefault', async () => {
  const p = await bound(ROWS, { plain: true });
  over(p.row(12));
  focusIn(p.row(12));
  click(p.row(12));
  for (const e of [press(p.row(12), 'Enter'), press(p.row(12), ' '), esc(p.row(12)), esc(p.body)]) assert.equal(e.defaultPrevented, false, e.key);
  assertClear(p.host, 'inert');
});

test('bindRunLinks: the planning row has no links, and a buildsOn entry with no row is ignored', async () => {
  const p = await bound([{ run: 1, buildsOn: [] }, { run: 2, buildsOn: [1, 99] }]);
  over(p.host.querySelector('.run-member[data-key="planning"]'));
  assertClear(p.host, 'planning row');
  over(p.row(2));
  assert.equal(p.host.querySelectorAll('[data-link]').length, 1);
  assert.equal(p.row(1).dataset.link, 'on');
});

test('bindRunLinks: repaint keeps kept marks and the focused row, and returns what build returns', async () => {
  const p = await bound();
  assert.equal(p.links.repaint('f1', () => 'built'), 'built');
  p.row(12).focus();
  press(p.row(12), 'Enter');
  const old = p.row(12);
  p.links.repaint('f1', () => p.host.replaceChildren(list(p.doc)));
  assert.notEqual(p.row(12), old, 'the rows were rebuilt');
  assert.deepEqual(marks(p.host), TWELVE);
  assertKept(p.host, 12, 'after the rebuild');
  assert.equal(p.doc.activeElement, p.row(12), 'the row keeps the focus');
});

test('bindRunLinks: repaint re-applies the pointed run, and never takes focus from elsewhere', async () => {
  const p = await bound();
  p.links.repaint('f1', () => {});
  over(p.row(12));
  p.byId('field').focus();
  p.links.repaint('f1', () => p.host.replaceChildren(list(p.doc)));
  assert.deepEqual(marks(p.host), TWELVE, 'the pointer still rests there');
  assert.deepEqual(kept(p.host), []);
  assert.equal(p.doc.activeElement, p.byId('field'));
});

test('bindRunLinks: a live repaint restores the focus without scrolling, and the hovered row keeps the marks', async () => {
  const p = await bound();
  p.links.repaint('f1', () => {});
  const proto = p.doc.defaultView.HTMLElement.prototype;
  const native = proto.focus;
  const calls = [];
  proto.focus = function (opts) { calls.push(opts); return native.call(this, opts); };
  try {
    p.row(12).focus();
    over(p.row(16));
    assert.deepEqual(marks(p.host), SIXTEEN, 'the pointer wins over the focus');
    calls.length = 0;
    p.links.repaint('f1', () => p.host.replaceChildren(list(p.doc)));
    assert.equal(p.doc.activeElement, p.row(12), 'the focus is restored');
    assert.deepEqual(calls, [{ preventScroll: true }], 'the restore does not scroll');
    assert.deepEqual(marks(p.host), SIXTEEN, 'the hovered row survives the restore');
    out(p.row(16), p.byId('outside'));
    assert.deepEqual(marks(p.host), TWELVE, 'the pointer left: the focused row points');
  } finally { proto.focus = native; }
});

test('bindRunLinks: the pointer leaving falls back to the focused row, and focus leaving to the hovered row', async () => {
  const p = await bound();
  p.row(12).focus();
  over(p.row(16));
  out(p.row(16), p.byId('outside'));
  assert.deepEqual(marks(p.host), TWELVE, 'still focused on 12');
  over(p.row(16));
  p.byId('outside').focus();
  assert.deepEqual(marks(p.host), SIXTEEN, 'still hovering 16');
  out(p.row(16), p.byId('outside'));
  assertClear(p.host, 'neither');
});

test('bindRunLinks: a click inside an opened Requirements fold does not toggle keep', async () => {
  const p = await bound();
  const fold = p.doc.createElement('div');
  fold.className = 'plan-checks';
  fold.innerHTML = '<span class="srow">A requirement</span>';
  p.row(12).querySelector('.run-member-main').append(fold);
  click(fold.querySelector('.srow'));
  assert.deepEqual(kept(p.host), []);
});

test('bindRunLinks: a hidden or detached host does not take the page Escape', async () => {
  const p = await bound();
  keep(p, 12);
  p.host.hidden = true;
  assert.equal(esc(p.body).defaultPrevented, false, 'hidden');
  assertKept(p.host, 12, 'hidden');
  p.host.hidden = false;
  p.host.classList.add('hidden');
  assert.equal(esc(p.body).defaultPrevented, false, '.hidden');
  p.host.classList.remove('hidden');
  const parent = p.host.parentNode;
  p.host.remove();
  assert.equal(esc(p.body).defaultPrevented, false, 'detached');
  parent.append(p.host);
  assert.equal(esc(p.body).defaultPrevented, true, 'shown again');
});

test('bindRunLinks: a new scope drops the kept run, the pointed run and the page Escape listener', async () => {
  const p = await bound();
  p.links.repaint('f1', () => {});
  keep(p, 12);
  over(p.row(16));
  p.links.repaint('f2', () => p.host.replaceChildren(list(p.doc)));
  assertClear(p.host, 'another feature');
  assert.equal(esc(p.body).defaultPrevented, false);
});

test('bindRunLinks: detach removes the host listeners and the page Escape listener; a null host is a no-op', async () => {
  const p = await bound();
  keep(p, 12);
  p.links.detach();
  assert.equal(esc(p.body).defaultPrevented, false, 'page Escape');
  p.host.replaceChildren(list(p.doc));
  over(p.row(12));
  focusIn(p.row(12));
  click(p.row(12));
  assert.equal(press(p.row(12), 'Enter').defaultPrevented, false);
  assert.equal(esc(p.row(12)).defaultPrevented, false);
  assertClear(p.host, 'detached');
  const { bindRunLinks } = await links();
  const none = bindRunLinks(null);
  assert.doesNotThrow(() => { none.repaint('f1', () => {}); none.detach(); });
});

// ---- R-ux-6: the run the marks are shown for (onShow, shown), which the run order map follows ---------------------
test('onShow gets the pointed run, then the kept run after the pointer leaves, then null after Esc', async () => {
  const { bindRunLinks } = await links();
  const p = page();
  const seen = [];   // each call with the row marks already painted when it came
  const binder = bindRunLinks(p.host, { onShow: (run) => seen.push({ run, marks: marks(p.host) }) });
  const last = () => seen.at(-1);
  binder.repaint('f1', () => {});
  assert.equal(last()?.run, null, 'a repaint with nothing pointed or kept');
  over(p.row(12));
  assert.deepEqual(last(), { run: 12, marks: TWELVE }, 'called after the marks are painted');
  out(p.row(12), p.body);
  assert.deepEqual(last(), { run: null, marks: NONE });
  keep(p, 3);
  over(p.row(12));
  assert.equal(last().run, 12, 'pointing wins over the kept run');
  out(p.row(12), p.body);
  assert.equal(last().run, 3, 'the kept run after the pointer leaves');
  const calls = seen.length;
  binder.repaint('f1', () => {});
  assert.ok(seen.length > calls, 'a rebuild calls it again');
  assert.equal(last().run, 3);
  esc(p.body);
  assert.equal(last().run, null, 'null after Esc');
  keep(p, 3);
  binder.repaint('f2', () => {});
  assert.equal(last().run, null, 'another scope drops the kept run');
});

test('shown() equals the last onShow value', async () => {
  const { bindRunLinks } = await links();
  const p = page();
  let told = null;
  const binder = bindRunLinks(p.host, { onShow: (run) => { told = run; } });
  assert.equal(typeof binder.shown, 'function', 'the binder says which run it shows');
  const check = (want, why) => assert.deepEqual([binder.shown(), told], [want, want], why);
  check(null, 'at first');
  over(p.row(12));
  check(12, 'pointed');
  click(p.row(12));
  out(p.row(12), p.body);
  check(12, 'kept');
  focusIn(p.row(3));
  check(3, 'focus points');
  focusOut(p.row(3), p.body);
  check(12, 'back to the kept run');
  esc(p.body);
  check(null, 'let go');
  // Without onShow it still answers, and the null host's stub shows nothing.
  const q = page();
  const plain = bindRunLinks(q.host);
  over(q.row(12));
  assert.equal(plain.shown(), 12);
  assert.equal(bindRunLinks(null).shown(), null);
});

test('an onShow that throws leaves the row marks painted', async () => {
  const { bindRunLinks } = await links();
  const p = page();
  let calls = 0;
  const errors = [];
  p.doc.defaultView.addEventListener('error', (e) => { errors.push(e.message); e.preventDefault(); });
  const binder = bindRunLinks(p.host, { onShow: () => { calls += 1; throw new Error('the map broke'); } });
  assert.equal(binder.repaint('f1', () => 'built'), 'built', 'repaint still answers with what was built');
  over(p.row(12));
  assert.ok(calls >= 2, `onShow was called (${calls})`);
  assert.deepEqual(marks(p.host), TWELVE);
  click(p.row(12));
  out(p.row(12), p.body);
  assertKept(p.host, 12, 'kept');
  assert.equal(esc(p.body).defaultPrevented, true, 'Esc still lets go');
  assertClear(p.host, 'after Esc');
  assert.deepEqual(errors, [], 'the throw is caught');
});

// ---- one module owns the marks --------------------------------------------------------------------------------------
test('the Chat card and the feature page bind the shared module and hold no data-link logic of their own', () => {
  for (const file of ['../ui/public/chat/run-card.mjs', '../ui/public/group-page.mjs']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /import \{[^}]*\bbindRunLinks\b[^}]*\} from '[^']*run-links\.mjs'/, `${file} imports bindRunLinks`);
    assert.doesNotMatch(src, /data-link|dataset\.link|linkMarksOf/, `${file} paints no marks itself`);
  }
});

// ---- the real surfaces over the 16-run feature ----------------------------------------------------------------------
/** The `base` world through the real builder of `surface`, flag on in the server environment. `opts`: {flag, marked}. */
async function surfaceOf(surface, opts = {}) {
  const w = await withEnv(ON, () => walkWorld(root, walked('stop-open')));
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const host = surface === 'card' ? cardHost(doc, w.slices, w.snaps, opts) : pageHost(doc, w.members, opts);
  const q = () => host.root.querySelector(surface === 'card' ? '.chat-rc-members' : '.gpage-runs');
  return { doc, ...host, list: q, row: (n) => rowOf(q(), n) };
}
const unmarkedHtml = (el) => { const c = el.cloneNode(true); for (const n of c.querySelectorAll('[data-link]')) n.removeAttribute('data-link'); return c.outerHTML; };

for (const [surface, name] of [['card', 'Chat card'], ['page', 'feature page']]) {
  test(`acceptance, ${name}: pointing at run 12 puts a solid bar on rows 1, 7, 10 and a dashed bar on row 16, and nothing else`, async () => {
    const s = await surfaceOf(surface);
    try {
      assert.equal(s.list().querySelectorAll('.run-member[data-run]').length, 16, 'every run row is a link row');
      const before = s.root.outerHTML;
      over(s.row(12).querySelector('.run-member-num'));
      assert.deepEqual(marks(s.list()), TWELVE);
      assert.equal(s.root.querySelectorAll('[data-link]').length, 4, 'no other element is marked');
      assert.equal(unmarkedHtml(s.root), before, 'pointing changes data-link only: no caption, no other change');
      out(s.row(12), s.doc.body);
      assert.equal(s.root.outerHTML, before, 'leaving restores the surface');
    } finally { s.dispose(); }
  });

  test(`acceptance, ${name}: every row's attributes name its direct builds-on runs, done ones included`, async () => {
    const s = await surfaceOf(surface);
    try {
      for (const { run, buildsOn } of ROWS) {
        const li = s.row(run);
        assert.deepEqual([li.dataset.run, li.dataset.buildsOn, li.getAttribute('tabindex')], [String(run), buildsOn.join(' '), '0'], `run ${run}`);
      }
      assert.equal(s.list().querySelector('.run-member[data-key="planning"][data-run]'), null);
    } finally { s.dispose(); }
  });

  test(`acceptance, ${name}: Enter keeps the marks, Esc clears them`, async () => {
    const s = await surfaceOf(surface);
    try {
      s.row(12).focus();
      press(s.row(12), 'Enter');
      out(s.row(12), s.doc.body);
      s.row(12).blur();
      assert.equal(s.doc.activeElement, s.doc.body);
      assert.deepEqual(marks(s.list()), TWELVE);
      assertKept(s.list(), 12, 'kept');
      esc(s.doc.body);
      assertClear(s.root, 'Escape on the body');
      s.row(12).focus();
      press(s.row(12), 'Enter');
      esc(s.row(12));
      assertClear(s.root, 'Escape inside the list');
    } finally { s.dispose(); }
  });

  test(`flag off, ${name}: no row is a link row and pointing at run 12 marks nothing`, async () => {
    const s = await surfaceOf(surface, { flag: false });
    try {
      assert.equal(s.root.querySelector('[data-run], [data-builds-on], .run-member[tabindex]'), null);
      over(s.row(12));
      focusIn(s.row(12));
      click(s.row(12));
      assertClear(s.root, 'flag off');
    } finally { s.dispose(); }
  });

  test(`flag on, unmarked feature, ${name}: no row is a link row and pointing marks nothing`, async () => {
    const s = await surfaceOf(surface, { marked: false });
    try {
      assert.equal(s.root.querySelector('[data-run], [data-builds-on], .run-member[tabindex]'), null);
      over(s.row(12));
      focusIn(s.row(12));
      click(s.row(12));
      assertClear(s.root, 'unmarked');
    } finally { s.dispose(); }
  });
}

test('Chat card update: the rebuilt rows keep the kept marks, aria-current and the focused row', async () => {
  const s = await surfaceOf('card');
  try {
    s.row(12).focus();
    press(s.row(12), 'Enter');
    const old = s.row(12);
    s.update();
    assert.notEqual(s.row(12), old, 'the card rebuilt its rows');
    assert.deepEqual(marks(s.list()), TWELVE);
    assertKept(s.list(), 12, 'after update');
    assert.equal(s.doc.activeElement, s.row(12));
  } finally { s.dispose(); }
});

test('Chat card destroy: a kept row no longer takes the page\'s Escape', async () => {
  const s = await surfaceOf('card');
  try {
    s.row(12).focus();
    press(s.row(12), 'Enter');
    assertKept(s.list(), 12, 'kept');
    s.row(12).blur();
    s.destroy();
    assert.equal(esc(s.doc.body).defaultPrevented, false);
  } finally { s.dispose(); }
});

test('feature page repaint: the same feature keeps the kept marks and focus on a changed table; another feature clears them', async () => {
  const s = await surfaceOf('page');
  try {
    s.row(12).focus();
    press(s.row(12), 'Enter');
    const old = s.row(12);
    s.repaint({ rename: { 3: 'Run 3 renamed' } });
    assert.notEqual(s.row(12), old, 'the table was replaced');
    assert.equal(s.row(3).querySelector('.run-member-title').textContent, 'Run 3 renamed');
    assert.deepEqual(marks(s.list()), TWELVE);
    assertKept(s.list(), 12, 'same feature');
    assert.equal(s.doc.activeElement, s.row(12));
    s.row(12).blur();   // leave the list: only the keep holds the marks now
    assertKept(s.list(), 12, 'before the other feature');
    s.repaint({ groupId: 'feat_2', rename: { 3: 'Another feature' } });
    assertClear(s.root, 'another feature');
    assert.equal(esc(s.doc.body).defaultPrevented, false);
  } finally { s.dispose(); }
});
