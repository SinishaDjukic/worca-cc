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
async function setup() {
  const mod = await load();
  const dom = trackDom(new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }));
  const doc = dom.window.document;
  const host = doc.body.appendChild(doc.createElement('ol'));
  const log = { painted: [], released: [], bound: [], disposed: [], resumed: [] };
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
  };
  const paint = (asks) => mod.paintStopList(doc, host, mod.stopLinesOf(view(asks)), deps);
  const rows = () => [...host.querySelectorAll('li.chat-rc-stop')];
  const row = (run) => rows().find((li) => li.dataset.run === String(run));
  const runs = () => rows().map((li) => Number(li.dataset.run));
  /** The question host paintQuestion got for run `run`. */
  const qHostOf = (run) => log.painted.find((p) => p.ref.pipelineId === `p${run}`)?.host;
  return { dom, doc, host, log, deps, paint, rows, row, runs, qHostOf, answer: (r) => answer(r) };
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

test('paintStopList: each open line\'s own host gets paintQuestion with its ref and bindQuestion once; never run 5', async () => {
  const c = await setup();
  c.paint();
  assert.deepEqual(c.log.painted.map((p) => p.ref), [{ runId: 'r2', pipelineId: 'p2' }, { runId: 'r4', pipelineId: 'p4' }, { runId: 'r11', pipelineId: 'p11' }]);
  for (const [i, run] of [2, 4, 11].entries()) {
    const p = c.log.painted[i];
    assert.ok(c.row(run).contains(p.host), `run ${run}'s host is inside its row`);
    assert.ok(p.host.closest('.chat-rc-stop-q'), `run ${run}`);
    assert.deepEqual([p.panel, p.hidden], [true, true], `run ${run}: a hidden .qpanel for paintQuestion to fill`);
  }
  assert.equal(new Set(c.log.painted.map((p) => p.host)).size, 3, 'one host per line');
  assert.deepEqual(c.log.bound.map((b) => b.index), [2, 4, 11]);
  for (const b of c.log.bound) assert.equal(b.host, c.qHostOf(b.index));
  c.paint();
  assert.equal(c.log.bound.length, 3, 'a repaint binds no kept host again');
});

// Slice 13 (R-ux-5): the host takes the card question's class, so the `.chat-rc-q` rules draw the line's step card.
test('paintStopList: an open line\'s question host is a div.chat-rc-q.chat-rc-stop-q with no heading of its own', async () => {
  const c = await setup();
  c.paint();
  for (const run of [2, 4, 11]) {
    const host = c.qHostOf(run);
    assert.equal(host.tagName, 'DIV', `run ${run}: not a section, the card's slot stays its only one`);
    assert.deepEqual([host.classList.contains('chat-rc-q'), host.classList.contains('chat-rc-stop-q')], [true, true], `run ${run}: ${host.className}`);
    assert.equal(host.querySelector('.chat-rc-q-head'), null, `run ${run}: the stop line is the head`);
    assert.equal(host.querySelector('.chat-rc-qbody'), null, `run ${run}`);
    assert.equal(host.closest('.chat-rc-q'), host, `run ${run}`);
  }
});

test('paintStopList: a repaint keeps the rows, their typed text and focus; a gone line releases its host and disposes once', async () => {
  const c = await setup();
  c.paint();
  const [two, eleven, host4] = [c.row(2), c.row(11), c.qHostOf(4)];
  const input = two.querySelector('input');
  input.value = 'half typed';
  input.focus();
  c.paint([E2, E5, E11]);
  assert.deepEqual(c.runs(), [2, 5, 11]);
  assert.equal(c.row(2), two);
  assert.equal(c.row(11), eleven);
  assert.equal(two.querySelector('input'), input);
  assert.equal(input.value, 'half typed');
  assert.equal(c.doc.activeElement, input);
  assert.deepEqual(c.log.released, [host4]);
  assert.deepEqual(c.log.disposed, [4]);
  c.paint([E2, E5, E11]);
  assert.deepEqual(c.log.disposed, [4], 'disposed once');
  c.paint([E2, E5, E9, E11]);
  assert.deepEqual(c.runs(), [2, 5, 9, 11], 'a new line lands in run order');
  assert.equal(c.row(2), two);
});

test('paintStopList: a new ask id on the same run repaints that line\'s own host', async () => {
  const c = await setup();
  c.paint();
  const [two, host2] = [c.row(2), c.qHostOf(2)];
  const from = c.log.painted.length;
  c.paint([{ ...E2, id: 'q2b' }, E4, E5, E11]);
  assert.equal(c.row(2), two, 'the row is kept');
  assert.ok(c.log.painted.slice(from).some((p) => p.host === host2 && p.ref.pipelineId === 'p2'));
});

test('paintStopList: a listed run that fails swaps its question for Resume and releases its host', async () => {
  const c = await setup();
  c.paint();
  const host2 = c.qHostOf(2);
  c.paint([failed(2, [7, 8, 12, 15, 16]), E4, E5, E11]);
  assert.deepEqual(c.runs(), [2, 4, 5, 11]);
  assert.equal(c.row(2).querySelector('.chat-rc-stop-text').textContent, 'Run 2 failed · holds up 7, 8, 12, 15, 16');
  assert.equal(c.row(2).querySelector('.status-dot').dataset.symbol, 'alert');
  assert.equal(c.row(2).querySelector('.chat-rc-stop-resume')?.getAttribute('aria-label'), 'Resume run 2');
  assert.equal(c.row(2).querySelector('.qpanel'), null);
  assert.deepEqual(c.log.released, [host2]);
  assert.deepEqual(c.log.disposed, [2]);
});

test('paintStopList: no lines hides the host and releases every open line', async () => {
  const c = await setup();
  c.paint([]);
  assert.equal(c.host.hidden, true);
  assert.equal(c.host.children.length, 0);
  c.paint();
  assert.equal(c.host.hidden, false);
  c.paint([]);
  assert.equal(c.host.hidden, true);
  assert.equal(c.rows().length, 0);
  assert.equal(c.log.released.length, 3);
  assert.deepEqual([...c.log.disposed].sort((a, b) => a - b), [2, 4, 11]);
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
