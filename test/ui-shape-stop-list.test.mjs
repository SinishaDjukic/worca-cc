// test/ui-shape-stop-list.test.mjs — Shaper small runs slice 6 (R-po-4): the open stop list on the feature card, its
// model (stopLinesOf) and painter (paintStopList). Literal featureView payloads of the busy 16-run state.
// The module is imported inside each test, so each behaviour fails on its own until it exists.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';

const trackDom = useDomRelease(afterEach);
const load = () => import('../ui/public/shape/stop-list.mjs');
const settle = () => new Promise((r) => setTimeout(r, 0));

// ── the busy state as featureView sends it: runs 1, 3 done; 2, 4, 11 at stops; 5 failed; 6 building ──
const STATE = { 1: 'done', 2: 'approval', 3: 'done', 4: 'questions', 5: 'error', 6: 'running', 11: 'questions' };
const STOP = { 2: 'requirement', 4: 'check', 11: 'check' };
const SLICES = SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => ({ index: run, title: `Run ${run}`, state: STATE[run] || 'planned', kind: null,
  pipelineId: STATE[run] ? `p${run}` : null, runId: null, buildsOn: [...dependsOn], ...(STOP[run] ? { stop: { reason: STOP[run], held: false } } : {}) }));
const open = (index, kind, reason, holdsUp, id = `q${index}`) => ({ index, runId: `r${index}`, pipelineId: `p${index}`, id, kind, reason, failed: false, holdsUp });
const failed = (index, holdsUp) => ({ index, runId: null, pipelineId: `p${index}`, id: null, kind: null, reason: null, failed: true, holdsUp });
const E2 = open(2, 'plan', 'requirement', [7, 8, 12, 15, 16]);
const E4 = open(4, 'gate', 'check', [5, 6, 7, 12, 16]);
const E5 = failed(5, [6, 7, 12, 16]);
const E9 = open(9, 'plan', null, [16]);
const E11 = open(11, 'gate', 'check', [13, 14, 15, 16]);
const view = (asks = [E2, E4, E5, E11]) => ({ id: 'feat-1', status: 'active', slices: SLICES, asks, ask: asks[0] || null });
const TEXTS = ['Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 4 · plan approval · holds up 5, 6, 7, 12, 16',
  'Run 5 failed · holds up 6, 7, 12, 16', 'Run 11 · plan approval · holds up 13, 14, 15, 16'];

test('stopLinesOf: one line per ask in order, with its key, text, word, mark and ref', async () => {
  const { stopLinesOf } = await load();
  const lines = stopLinesOf(view());
  assert.deepEqual(lines.map((l) => l.key), ['run-2', 'run-4', 'run-5', 'run-11']);
  assert.deepEqual(lines.map((l) => l.index), [2, 4, 5, 11]);
  assert.deepEqual(lines.map((l) => l.text), TEXTS);
  assert.deepEqual(lines.map((l) => [l.word, l.mark, l.failed]),
    [['waiting for you', 'ask', false], ['waiting for you', 'ask', false], ['failed', 'failed', true], ['waiting for you', 'ask', false]]);
  assert.deepEqual(lines.map((l) => l.ref), [{ runId: 'r2', pipelineId: 'p2' }, { runId: 'r4', pipelineId: 'p4' }, null, { runId: 'r11', pipelineId: 'p11' }]);
  assert.deepEqual(lines.map((l) => [l.id, l.kind]), [['q2', 'plan'], ['q4', 'gate'], [null, null], ['q11', 'gate']]);
  assert.deepEqual(lines[0].holdsUp, [7, 8, 12, 15, 16]);
});

test('stopLinesOf: an open line\'s ref takes the live snapshot\'s runId (a resumed run), else the entry\'s', async () => {
  const { stopLinesOf } = await load();
  const lines = stopLinesOf(view(), { snapOf: (pid) => (pid === 'p2' ? { runId: 'r2-resumed', pipelineId: 'p2', status: 'running' } : null) });
  assert.deepEqual(lines[0].ref, { runId: 'r2-resumed', pipelineId: 'p2' });
  assert.deepEqual(lines[1].ref, { runId: 'r4', pipelineId: 'p4' });
});

test('stopLinesOf: a view without asks (flag off, unmarked, no feature) gives no lines', async () => {
  const { stopLinesOf } = await load();
  const { asks: _asks, ...bare } = view();
  for (const v of [null, undefined, {}, bare, { ...bare, asks: null }]) assert.deepEqual(stopLinesOf(v), []);
});

/** A host plus recording deps. paintQuestion mounts an input per run, as a step card would. */
async function setup({ focusOut = null } = {}) {
  const mod = await load();
  const dom = trackDom(new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }));
  const doc = dom.window.document;
  const host = doc.body.appendChild(doc.createElement('ol'));
  const log = { painted: [], released: [], bound: [], disposed: [], resumed: [], focusedOut: 0 };
  let answer = null;
  const deps = {
    paintQuestion: (ref, qHost) => {
      const panel = qHost.querySelector('.qpanel');
      log.painted.push({ ref, host: qHost, panel: !!panel, hidden: !!panel && panel.classList.contains('hidden') });
      if (panel && !panel.querySelector('input')) { panel.appendChild(doc.createElement('input')); panel.classList.remove('hidden'); }
      return { id: 'q', kind: 'plan' };
    },
    releaseQuestion: (qHost) => log.released.push(qHost),
    bindQuestion: (qHost, line) => { log.bound.push({ host: qHost, index: line.index }); return () => log.disposed.push(line.index); },
    resume: (index) => { log.resumed.push(index); return new Promise((r) => { answer = r; }); },
    ...(focusOut ? { focusOut: () => { log.focusedOut += 1; focusOut(doc); } } : {}),
  };
  const paint = (asks) => mod.paintStopList(doc, host, mod.stopLinesOf(view(asks)), deps);
  const rows = () => [...host.querySelectorAll('li.chat-rc-stop')];
  const row = (run) => rows().find((li) => li.dataset.run === String(run));
  const runs = () => rows().map((li) => Number(li.dataset.run));
  /** The question host paintQuestion last got for run `run`. */
  const qHostOf = (run) => log.painted.findLast((p) => p.ref.pipelineId === `p${run}`)?.host;
  /** An open-stop line's own button. */
  const btn = (run) => row(run)?.querySelector('button.chat-rc-stop-line');
  /** Press run `run`'s line: it opens a closed line and closes the open one. */
  const press = (run) => { const b = btn(run); assert.ok(b, `run ${run}'s line is a button`); b.click(); };
  const cards = () => [...host.querySelectorAll('.chat-rc-stop-q')];
  return { mod, dom, doc, host, log, deps, paint, rows, row, runs, qHostOf, btn, press, cards, answer: (r) => answer(r) };
}

test('paintStopList: four rows in run order, each with a status dot and its text', async () => {
  const c = await setup();
  c.paint();
  assert.equal(c.host.hidden, false);
  assert.deepEqual(c.runs(), [2, 4, 5, 11]);
  assert.deepEqual(c.rows().map((li) => li.dataset.key), ['run-2', 'run-4', 'run-5', 'run-11']);
  assert.deepEqual(c.rows().map((li) => li.querySelector('.chat-rc-stop-line span.chat-rc-stop-text').textContent), TEXTS);
  assert.deepEqual(c.rows().map((li) => li.querySelectorAll('.chat-rc-stop-line .status-dot').length), [1, 1, 1, 1]);
  // Slice 13 (R-qa-9): the row is one line at every width, so its text ellipsises and keeps the whole line as a tooltip.
  assert.deepEqual(c.rows().map((li) => li.querySelector('.chat-rc-stop-text').title), TEXTS);
});

test('shape-it.css: a stop line\'s text stays one line, with an ellipsis (R-qa-9)', () => {
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  const rule = css.match(/\.chat-rc-stop-text\{([^}]*)\}/)?.[1] || '';
  for (const decl of ['white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis']) assert.ok(rule.includes(decl), `${decl} in ${rule}`);
});

test('paintStopList: only run 5 has the red "!" and a Resume named "Resume run 5"; the others the amber "?"', async () => {
  const c = await setup();
  c.paint();
  const dot = c.row(5).querySelector('.status-dot');
  assert.ok(dot.classList.contains('is-red') && dot.classList.contains('has-sym'));
  assert.equal(dot.dataset.symbol, 'alert');
  const resume = c.row(5).querySelector('button.chat-rc-stop-resume');
  assert.ok(resume.classList.contains('btn') && resume.classList.contains('btn-sm'));
  assert.equal(resume.type, 'button');
  assert.equal(resume.textContent, 'Resume');
  assert.equal(resume.getAttribute('aria-label'), 'Resume run 5');
  const err = c.row(5).querySelector('span.chat-rc-stop-err');
  assert.equal(err.getAttribute('role'), 'status');
  assert.equal(err.hidden, true);
  assert.equal(c.row(5).querySelector('.qpanel'), null, 'a failed run has no question');
  for (const r of [2, 4, 11]) {
    const d = c.row(r).querySelector('.status-dot');
    assert.ok(d.classList.contains('is-amber') && d.classList.contains('has-sym'), `run ${r}`);
    assert.equal(d.dataset.symbol, 'question', `run ${r}`);
    assert.equal(c.row(r).querySelector('.chat-rc-stop-resume'), null, `run ${r} has no Resume`);
  }
});

test('paintStopList: an opened line\'s own host gets paintQuestion with its ref and bindQuestion once; never run 5', async () => {
  const c = await setup();
  c.paint();
  const hosts = new Set();
  for (const [i, run] of [2, 4, 11].entries()) {
    const from = c.log.painted.length;
    c.press(run);
    const painted = c.log.painted.slice(from);
    assert.ok(painted.length >= 1, `run ${run}: painted on the press, with no repaint`);
    assert.deepEqual(painted[0].ref, { runId: `r${run}`, pipelineId: `p${run}` });
    const p = painted[0];
    assert.ok(c.row(run).contains(p.host), `run ${run}'s host is inside its row`);
    assert.ok(p.host.closest('.chat-rc-stop-q'), `run ${run}`);
    assert.deepEqual([p.panel, p.hidden], [true, true], `run ${run}: a hidden .qpanel for paintQuestion to fill`);
    assert.equal(c.log.bound.length, i + 1, `run ${run}: bound once`);
    assert.equal(c.log.bound.at(-1).index, run);
    assert.equal(c.log.bound.at(-1).host, p.host);
    hosts.add(p.host);
  }
  assert.equal(hosts.size, 3, 'one host per opened line');
  c.paint();
  assert.equal(c.log.bound.length, 3, 'a repaint binds no kept host again');
  assert.ok(c.log.painted.every((p) => p.ref.pipelineId !== 'p5'), 'a failed run is never painted');
});

// Slice 13 (R-ux-5): the host takes the card question's class, so the `.chat-rc-q` rules draw the line's step card.
test('paintStopList: an open line\'s question host is a div.chat-rc-q.chat-rc-stop-q with no heading of its own', async () => {
  const c = await setup();
  c.paint();
  for (const run of [2, 4, 11]) {
    c.press(run);
    const host = c.qHostOf(run);
    assert.ok(host, `run ${run}: a host was painted`);
    assert.equal(host.tagName, 'DIV', `run ${run}: not a section, the card's slot stays its only one`);
    assert.deepEqual([host.classList.contains('chat-rc-q'), host.classList.contains('chat-rc-stop-q')], [true, true], `run ${run}: ${host.className}`);
    assert.equal(host.querySelector('.chat-rc-q-head'), null, `run ${run}: the stop line is the head`);
    assert.equal(host.querySelector('.chat-rc-qbody'), null, `run ${run}`);
    assert.equal(host.closest('.chat-rc-q'), host, `run ${run}`);
  }
});

test('paintStopList: a repaint keeps the rows, the open line\'s typed text and focus; a closed line that goes releases nothing', async () => {
  const c = await setup();
  c.paint();
  c.press(2);
  const [two, eleven] = [c.row(2), c.row(11)];
  const input = two.querySelector('input');
  input.value = 'half typed';
  input.focus();
  c.paint([E2, E5, E11]);                           // run 4's line was closed: it never had a host
  assert.deepEqual(c.runs(), [2, 5, 11]);
  assert.equal(c.row(2), two);
  assert.equal(c.row(11), eleven);
  assert.equal(two.querySelector('input'), input);
  assert.equal(input.value, 'half typed');
  assert.equal(c.doc.activeElement, input);
  assert.deepEqual(c.log.released, []);
  assert.deepEqual(c.log.disposed, []);
  c.paint([E2, E5, E9, E11]);
  assert.deepEqual(c.runs(), [2, 5, 9, 11], 'a new line lands in run order');
  assert.equal(c.row(2), two);
  assert.equal(c.doc.activeElement, input);
});

test('paintStopList: a gone open line releases its host and disposes once', async () => {
  const c = await setup();
  c.paint();
  c.press(4);
  const host4 = c.qHostOf(4);
  c.paint([E2, E5, E11]);
  assert.deepEqual(c.runs(), [2, 5, 11]);
  assert.deepEqual(c.log.released, [host4]);
  assert.deepEqual(c.log.disposed, [4]);
  c.paint([E2, E5, E11]);
  assert.deepEqual(c.log.released, [host4]);
  assert.deepEqual(c.log.disposed, [4], 'disposed once');
});

test('paintStopList: a new ask id on the open line\'s run repaints that line\'s own host', async () => {
  const c = await setup();
  c.paint();
  c.press(2);
  const [two, host2] = [c.row(2), c.qHostOf(2)];
  const from = c.log.painted.length;
  c.paint([{ ...E2, id: 'q2b' }, E4, E5, E11]);
  assert.equal(c.row(2), two, 'the row is kept');
  assert.ok(c.log.painted.slice(from).some((p) => p.host === host2 && p.ref.pipelineId === 'p2'));
});

test('paintStopList: an open run that fails swaps its question for Resume, releases its host and does not reopen by itself', async () => {
  const c = await setup();
  c.paint();
  c.press(2);
  const host2 = c.qHostOf(2);
  c.paint([failed(2, [7, 8, 12, 15, 16]), E4, E5, E11]);
  assert.deepEqual(c.runs(), [2, 4, 5, 11]);
  assert.equal(c.row(2).querySelector('.chat-rc-stop-text').textContent, 'Run 2 failed · holds up 7, 8, 12, 15, 16');
  assert.equal(c.row(2).querySelector('.status-dot').dataset.symbol, 'alert');
  assert.equal(c.row(2).querySelector('.chat-rc-stop-resume')?.getAttribute('aria-label'), 'Resume run 2');
  assert.equal(c.row(2).querySelector('.qpanel'), null);
  assert.equal(c.btn(2), null, 'a failed line is no button');
  assert.equal(c.row(2).querySelector('.chat-rc-stop-chev'), null);
  assert.deepEqual(c.log.released, [host2]);
  assert.deepEqual(c.log.disposed, [2]);
  c.paint();                                        // run 2 is at a stop again
  assert.equal(c.btn(2)?.getAttribute('aria-expanded'), 'false', 'closed: nothing opens by itself');
  assert.equal(c.cards().length, 0);
});

test('paintStopList: no lines hides the host and releases the open line', async () => {
  const c = await setup();
  c.paint([]);
  assert.equal(c.host.hidden, true);
  assert.equal(c.host.children.length, 0);
  c.paint();
  assert.equal(c.host.hidden, false);
  c.press(2);
  c.paint([]);
  assert.equal(c.host.hidden, true);
  assert.equal(c.rows().length, 0);
  assert.equal(c.log.released.length, 1);
  assert.deepEqual(c.log.disposed, [2]);
});

// Chromium blurs a focused button the moment it is disabled; jsdom does not (rule: focus-after-disable).
function blurOnDisable(win) {
  const proto = win.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get() { return desc.get.call(this); },
    set(v) { if (v) this.blur(); desc.set.call(this, v); } });   // jsdom's blur() skips a disabled button
}
const REFUSAL = 'Slice 6 is still going: resume this one when it finishes';

test('paintStopList: Resume calls resume(5) once, stays off in flight, shows a refusal and gets its focus back', async () => {
  const c = await setup();
  blurOnDisable(c.dom.window);
  c.paint();
  const btn = c.row(5).querySelector('.chat-rc-stop-resume');
  btn.focus();
  btn.click();
  await settle();
  assert.deepEqual(c.log.resumed, [5]);
  assert.equal(btn.disabled, true);
  c.paint();                                        // the card's once-a-second repaint, while in flight
  btn.click();
  assert.equal(c.row(5).querySelector('.chat-rc-stop-resume').disabled, true);
  assert.deepEqual(c.log.resumed, [5], 'one post');
  c.answer({ ok: false, error: REFUSAL });
  await settle(); await settle();
  const err = c.row(5).querySelector('.chat-rc-stop-err');
  assert.equal(err.textContent, REFUSAL);
  assert.equal(err.hidden, false);
  assert.equal(c.row(5).querySelector('.chat-rc-stop-resume').disabled, false);
  c.paint();
  assert.equal(c.doc.activeElement, c.row(5).querySelector('.chat-rc-stop-resume'), 'focus back on the same line\'s Resume');
  assert.equal(c.row(5).querySelector('.chat-rc-stop-err').textContent, REFUSAL, 'the refusal survives a repaint');
  assert.equal(c.row(5).querySelector('.chat-rc-stop-err').hidden, false);
});

test('paintStopList: an accepted Resume shows no error', async () => {
  const c = await setup();
  c.paint();
  c.row(5).querySelector('.chat-rc-stop-resume').click();
  await settle();
  c.answer({ ok: true });
  await settle(); await settle();
  assert.equal(c.row(5).querySelector('.chat-rc-stop-err').hidden, true);
  assert.deepEqual(c.log.resumed, [5]);
});

// ---- Slice 12 (R-ux-5): one line per open stop, closed; one step card, for the opened stop; no line for a paused run --
// The example's feature: runs 2, 3 and 4 wait at a stop, run 5 is paused. The view still lists run 5 (a view that lags
// behind the pause), with its slice and its live snapshot paused.
const EX_STATE = { 1: 'done', 2: 'approval', 3: 'questions', 4: 'questions', 5: 'paused' };
const EX_SLICES = SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => ({ index: run, title: `Run ${run}`, state: EX_STATE[run] || 'planned', kind: null,
  pipelineId: EX_STATE[run] ? `p${run}` : null, runId: null, buildsOn: [...dependsOn] }));
const EX_ASKS = [open(2, 'plan', 'requirement', [7, 8, 12, 15, 16]), open(3, 'gate', 'check', [6]), open(4, 'gate', 'check', [5, 6, 7, 12, 16]),
  open(5, 'gate', 'check', [12])];
const EX_VIEW = { id: 'feat-1', status: 'active', slices: EX_SLICES, asks: EX_ASKS, ask: EX_ASKS[0] };
const exSnapOf = (pid) => (pid === 'p5' ? { runId: 'r5', pipelineId: 'p5', status: 'paused' } : null);
const EX_TEXTS = ['Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 3 · plan approval · holds up 6',
  'Run 4 · plan approval · holds up 5, 6, 7, 12, 16'];
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
/** The example's list, painted. */
async function example(opts) {
  const c = await setup(opts);
  c.paintExample = () => c.mod.paintStopList(c.doc, c.host, c.mod.stopLinesOf(EX_VIEW, { snapOf: exSnapOf }), c.deps);
  c.paintExample();
  return c;
}

test('R-ux-5: 3 stops and 1 paused run give 3 lines, 0 step cards and no line for the paused run', async () => {
  const { stopLineText } = await import('../src/shared/shape/run-status.mjs');
  const c = await example();
  assert.deepEqual(c.runs(), [2, 3, 4]);
  assert.equal(c.cards().length, 0, 'no step card');
  assert.equal(c.host.querySelector('.qpanel'), null);
  assert.equal(c.host.querySelector('li[data-run="5"]'), null, 'a paused run is not a stop');
  assert.deepEqual(c.rows().map((li) => li.querySelector('.chat-rc-stop-text').textContent), EX_TEXTS);
  assert.deepEqual(EX_ASKS.slice(0, 3).map(stopLineText), EX_TEXTS, 'today\'s stop-line words');
  assert.deepEqual([c.log.painted, c.log.bound], [[], []], 'a closed line asks for no question');
  assert.deepEqual([2, 3, 4].map((r) => c.btn(r)?.getAttribute('aria-expanded')), ['false', 'false', 'false']);
  assert.equal(c.host.querySelector(HEADINGS), null, 'no new heading');
});

test('R-ux-5: opening the second line mounts exactly 1 step card, for that stop', async () => {
  const c = await example();
  c.press(c.runs()[1]);
  assert.equal(c.cards().length, 1);
  assert.equal(c.cards()[0].closest('li.chat-rc-stop').dataset.run, '3');
  assert.deepEqual(c.log.bound.map((b) => b.index), [3]);
  assert.ok(c.log.painted.length >= 1, 'painted on the press');
  assert.ok(c.log.painted.every((p) => p.ref.pipelineId === 'p3' && p.host === c.cards()[0]), 'only run 3\'s question');
  const b = c.btn(3);
  const body = c.row(3).querySelector('.chat-rc-stop-body');
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.ok(body.id, 'the open body has an id');
  assert.equal(b.getAttribute('aria-controls'), body.id);
  assert.equal(body.getAttribute('role'), 'region');
  assert.equal(body.getAttribute('aria-labelledby'), b.id);
  assert.equal(body.hidden, false);
  assert.ok(body.contains(c.cards()[0]));
  for (const r of [2, 4]) {
    assert.equal(c.btn(r).getAttribute('aria-expanded'), 'false', `run ${r}`);
    assert.equal(c.btn(r).hasAttribute('aria-controls'), false, `run ${r}`);
  }
  assert.equal(c.host.querySelector(HEADINGS), null, 'no new heading');
});

test('stopLinesOf: an entry whose live snapshot is paused gives no line (the slice payload lags behind)', async () => {
  const { stopLinesOf } = await load();
  const lines = stopLinesOf(view(), { snapOf: (pid) => (pid === 'p4' ? { runId: 'r4', pipelineId: 'p4', status: 'paused' } : null) });
  assert.deepEqual(lines.map((l) => l.index), [2, 5, 11]);
});

test('stopLinesOf: an entry whose slice is paused gives no line (no snapshot)', async () => {
  const { stopLinesOf } = await load();
  const slices = SLICES.map((x) => (x.index === 4 ? { ...x, state: 'paused' } : x));
  assert.deepEqual(stopLinesOf({ ...view(), slices }).map((l) => l.index), [2, 5, 11]);
});

test('a closed line is a Row button with its dot, text and an aria-hidden chevron, over an empty hidden body', async () => {
  const c = await setup();
  c.paint();
  for (const run of [2, 4, 11]) {
    const b = c.btn(run);
    assert.ok(b, `run ${run}'s line is a button`);
    assert.ok(b.classList.contains('row-btn'), b.className);
    assert.equal(b.type, 'button');
    assert.ok(b.id, `run ${run}: an id`);
    assert.equal(b.getAttribute('aria-expanded'), 'false');
    assert.equal(b.hasAttribute('aria-controls'), false, 'aria-controls only while open');
    const kids = [...b.children];
    assert.equal(kids.length, 3, `run ${run}: dot, text, chevron`);
    assert.ok(kids[0].classList.contains('status-dot'));
    assert.ok(kids[1].matches('span.chat-rc-stop-text'));
    assert.ok(kids[2].matches('span.chat-rc-stop-chev[aria-hidden="true"]'));
    const body = c.row(run).querySelector('.chat-rc-stop-body');
    assert.equal(body.children.length, 0, `run ${run}: an empty body`);
    assert.equal(body.hidden, true, `run ${run}`);
  }
  const ids = [2, 4, 11].map((r) => c.btn(r).id);
  c.paint();
  assert.deepEqual([2, 4, 11].map((r) => c.btn(r).id), ids, 'the ids are stable');
});

test('a failed line has no button and no chevron', async () => {
  const c = await setup();
  c.paint();
  assert.ok(c.btn(2), 'an open-stop line is a button');
  const line = c.row(5).querySelector('.chat-rc-stop-line');
  assert.equal(line.tagName, 'DIV');
  assert.equal(c.btn(5), null);
  assert.equal(c.row(5).querySelector('.chat-rc-stop-chev'), null);
});

test('at most one open line: another line closes the first, and the open line closes on a second press', async () => {
  const c = await setup();
  c.paint();
  c.press(2);
  const host2 = c.qHostOf(2);
  c.press(4);
  assert.equal(c.cards().length, 1);
  assert.equal(c.cards()[0].closest('li').dataset.run, '4');
  assert.deepEqual(c.log.released, [host2]);
  assert.deepEqual(c.log.disposed, [2]);
  assert.equal(c.btn(2).getAttribute('aria-expanded'), 'false');
  assert.equal(c.btn(2).hasAttribute('aria-controls'), false);
  assert.equal(c.row(2).querySelector('.chat-rc-stop-body').children.length, 0);
  assert.equal(c.row(2).querySelector('.chat-rc-stop-body').hidden, true);
  const host4 = c.qHostOf(4);
  c.press(4);
  assert.equal(c.cards().length, 0, 'closing the open line leaves no step card');
  assert.equal(c.host.querySelector('.qpanel'), null);
  assert.deepEqual(c.log.released, [host2, host4]);
  assert.deepEqual(c.log.disposed, [2, 4]);
  assert.equal(c.btn(4).getAttribute('aria-expanded'), 'false');
  assert.equal(c.btn(4).hasAttribute('aria-controls'), false);
  const from = c.log.painted.length;
  c.paint();
  assert.equal(c.log.painted.length, from, 'a closed line is not painted on a repaint');
  c.press(4);
  assert.equal(c.cards().length, 1);
  assert.deepEqual(c.log.bound.map((b) => b.index), [2, 4, 4], 'a reopened line binds a new host');
});

test('the open line survives a repaint and keeps typed text and focus', async () => {
  const c = await setup();
  c.paint();
  c.press(4);
  const [four, host4] = [c.row(4), c.qHostOf(4)];
  const input = four.querySelector('input');
  input.value = 'half typed';
  input.focus();
  const from = c.log.painted.length;
  c.paint();
  c.paint();                                        // the card's once-a-second repaint
  assert.equal(c.row(4), four);
  assert.equal(c.btn(4).getAttribute('aria-expanded'), 'true');
  assert.equal(c.cards().length, 1);
  assert.equal(c.cards()[0], host4);
  assert.equal(four.querySelector('input'), input);
  assert.equal(input.value, 'half typed');
  assert.equal(c.doc.activeElement, input);
  assert.deepEqual(c.log.painted.slice(from).map((p) => p.ref.pipelineId), ['p4', 'p4'], 'only the open line is repainted');
  assert.deepEqual(c.log.bound.map((b) => b.index), [4]);
  assert.deepEqual(c.log.released, []);
});

test('the answered open line leaves, and focus lands on the next line\'s button', async () => {
  const c = await setup();
  c.paint([E2, E4, E11]);
  c.press(4);
  c.row(4).querySelector('input').focus();
  c.paint([E2, E11]);
  assert.deepEqual(c.runs(), [2, 11]);
  assert.equal(c.cards().length, 0, 'no other line opens by itself');
  assert.ok(c.btn(11), 'the next line');
  assert.equal(c.doc.activeElement, c.btn(11), 'the line now at that position');
  assert.deepEqual([c.btn(2), c.btn(11)].map((b) => b.getAttribute('aria-expanded')), ['false', 'false']);
  c.paint([E2, E4, E11]);                           // run 4 stops again: its line comes back closed
  assert.equal(c.btn(4).getAttribute('aria-expanded'), 'false');
  assert.equal(c.cards().length, 0);
});

test('the answered last line leaves, and focus lands on the new last line\'s button', async () => {
  const c = await setup();
  c.paint([E2, E4, E11]);
  c.press(11);
  c.btn(11).focus();
  c.paint([E2, E4]);
  assert.ok(c.btn(4));
  assert.equal(c.doc.activeElement, c.btn(4));
  assert.equal(c.cards().length, 0);
});

test('the open line leaves while the focus is elsewhere: the focus stays there and focusOut is not called', async () => {
  const c = await setup({ focusOut: () => {} });
  const outside = c.doc.body.appendChild(c.doc.createElement('textarea'));
  c.paint([E2, E4]);
  c.press(2);
  outside.focus();
  c.paint([E4]);
  assert.equal(c.doc.activeElement, outside);
  c.press(4);
  outside.focus();
  c.paint([]);
  assert.equal(c.doc.activeElement, outside);
  assert.equal(c.log.focusedOut, 0);
});

test('the only open line leaves: the host hides and `focusOut` is called once', async () => {
  const c = await setup({ focusOut: (doc) => doc.getElementById('after').focus() });
  const after = c.doc.body.appendChild(c.doc.createElement('button'));
  after.id = 'after';
  c.paint([E2]);
  c.press(2);
  c.row(2).querySelector('input').focus();
  c.paint([]);
  assert.equal(c.host.hidden, true);
  assert.equal(c.log.focusedOut, 1);
  assert.equal(c.doc.activeElement, after);
  c.paint([]);
  assert.equal(c.log.focusedOut, 1, 'once');
});

test('the only open line leaves and there is no `focusOut`: nothing throws', async () => {
  const c = await setup();
  c.paint([E2]);
  c.press(2);
  c.row(2).querySelector('input').focus();
  c.paint([]);
  assert.equal(c.host.hidden, true);
  assert.deepEqual(c.log.disposed, [2]);
});

test('two hosts in one document give unique line ids', async () => {
  const c = await setup();
  const other = c.doc.body.appendChild(c.doc.createElement('ol'));
  c.paint();
  c.mod.paintStopList(c.doc, other, c.mod.stopLinesOf(view()), c.deps);
  const buttons = [...c.doc.querySelectorAll('button.chat-rc-stop-line')];
  assert.equal(buttons.length, 6, 'three open stops on each host');
  assert.ok(buttons.every((b) => b.id), 'every line has an id');
  assert.equal(new Set(buttons.map((b) => b.id)).size, 6);
  c.press(2);
  other.querySelector('li[data-run="2"] button.chat-rc-stop-line').click();
  assert.equal(c.doc.querySelectorAll('.chat-rc-stop-q').length, 2, 'each host keeps its own open line');
  const controlled = [...c.doc.querySelectorAll('button.chat-rc-stop-line[aria-controls]')].map((b) => b.getAttribute('aria-controls'));
  assert.equal(new Set(controlled).size, 2);
  const ids = [...c.doc.querySelectorAll('[id]')].map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no id twice in the document');
});

test('R-arch-7: the card and the feature page paint their lines through paintStopList only', () => {
  for (const file of ['chat/run-card.mjs', 'group-page.mjs']) {
    const src = readFileSync(new URL(`../ui/public/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(/import \{[^}]*\bpaintStopList\b[^}]*\} from '[./]+(?:shape\/)?stop-list\.mjs'/.test(src), `${file} imports paintStopList`);
    assert.ok(/\bpaintStopList\(/.test(src), `${file} calls it`);
    assert.equal(src.match(/chat-rc-stop-(?:line|text|body|q|chev|resume|err)\b/g), null, `${file} builds no line node of its own`);
  }
});
