// test/retune-gate.test.mjs
// The ONE retune eligibility rule, shared by the engine and the browser. It is
// pinned here rather than only through its two callers, because the whole point
// of the module is that neither side keeps a copy of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_DISPATCH_STATUS, nodeBusy, armFor, retuneArm } from '../src/shared/graph/retune-gate.mjs';

const AGENT = { id: 'n_impl', kind: 'agent' };
const running = (steps = []) => ({ status: 'running', steps });

test('the no-dispatch set is exactly done/stopped/error', () => {
  assert.deepEqual([...NO_DISPATCH_STATUS], ['done', 'stopped', 'error']);
  // 'paused' and 'interrupted' both RESUME, so their nodes stay retunable — the
  // reason this is neither the engine's _setStatus terminal set nor the UI's
  // isTerminalStatus.
  for (const s of ['paused', 'interrupted', 'pausing']) {
    assert.equal(NO_DISPATCH_STATUS.includes(s), false, s);
  }
});

test('a run past its last dispatch has no panel worth opening', () => {
  for (const status of NO_DISPATCH_STATUS) {
    assert.equal(retuneArm({ status, steps: [] }, AGENT), 'dead', status);
  }
  for (const status of ['running', 'starting', 'paused', 'interrupted', 'pausing']) {
    assert.equal(retuneArm({ status, steps: [] }, AGENT), 'edit', status);
  }
});

test('a flow card gets the explanatory arm — it spawns nothing', () => {
  for (const kind of ['end', 'and', 'or', 'combine', 'task']) {
    assert.equal(retuneArm(running(), { id: 'n_x', kind }), 'flow', kind);
    assert.equal(armFor({ id: 'n_x', kind }, false), 'flow', kind);
  }
  assert.equal(retuneArm(running(), null), 'flow');
  assert.equal(armFor(undefined, false), 'flow');
  // The run-level question comes FIRST: a dead run does not open a panel at all,
  // not even to explain a flow card.
  assert.equal(retuneArm({ status: 'done' }, { id: 'n_x', kind: 'end' }), 'dead');
});

test('armFor is the derivation both popover sites share', () => {
  assert.equal(armFor(AGENT, true), 'busy');
  assert.equal(armFor(AGENT, false), 'edit');
});

test("'start' means in flight RIGHT NOW; a finished cycle leaves the node editable", () => {
  const inFlight = [{ nodeId: 'n_impl', status: 'start' }];
  assert.equal(nodeBusy(running(inFlight), 'n_impl'), true);
  assert.equal(retuneArm(running(inFlight), AGENT), 'busy');
  // A node that finished cycle 1 and will be re-fired by a loop is where retuning
  // is worth the most; a pause-killed execution is re-invoked from scratch on
  // resume, so it is editable too.
  for (const status of ['done', 'error', 'paused', 'stopped']) {
    assert.equal(nodeBusy(running([{ nodeId: 'n_impl', status }]), 'n_impl'), false, status);
    assert.equal(retuneArm(running([{ nodeId: 'n_impl', status }]), AGENT), 'edit', status);
  }
  // Another node's execution is not this node's business.
  assert.equal(nodeBusy(running([{ nodeId: 'n_plan', status: 'start' }]), 'n_impl'), false);
});

test('a missing or malformed state does not throw or read as dead', () => {
  assert.equal(nodeBusy(null, 'n_impl'), false);
  assert.equal(nodeBusy({}, 'n_impl'), false);
  assert.equal(nodeBusy({ steps: [null, undefined] }, 'n_impl'), false);
  assert.equal(retuneArm({}, AGENT), 'edit', 'no status reads as still dispatching');
});

test('the engine reads this module rather than keeping a copy', () => {
  // Source pins, but only on the DECLARATIONS — the thing that would actually be
  // re-introduced is a second literal list, and that is what these catch. The
  // browser side is covered behaviourally by the popover and run-hosts suites.
  const orch = readFileSync('src/core/orchestrator.mjs', 'utf8');
  assert.match(orch, /TERMINAL_RUN_STATUS = new Set\(NO_DISPATCH_STATUS\)/);
  assert.doesNotMatch(orch, /\[\s*'done',\s*'stopped',\s*'error'\s*\]/, 'no second literal');
  const app = readFileSync('ui/public/app.js', 'utf8');
  assert.match(app, /RD_TERMINAL = NO_DISPATCH_STATUS/);
  assert.doesNotMatch(app, /RETUNE_DEAD_STATUS/);
});

test('the popover asks this module for its arm, on open AND on sync', async () => {
  // Behavioural, not a source regex: drive the public API and read the rendered
  // arm. A hand-written copy of the derivation in either place would have to keep
  // agreeing with this module to pass, which is the property that matters.
  const { JSDOM } = await import('jsdom');
  const { createRetunePopover } = await import('../ui/public/graph/retune-popover.mjs');
  const dom = new JSDOM('<!doctype html><div class="node" data-node-id="n_impl" tabindex="0">c</div>',
    { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const pop = createRetunePopover({ doc });
  const card = doc.querySelector('.node');
  const models = [{ id: 'm1', label: 'M1', efforts: ['high'] }];
  const armOnScreen = () => (doc.querySelector('.rt-pop [data-field="model"]') ? 'edit'
    : (doc.querySelector('.rt-note') || {}).textContent || '');

  // open() -> armFor
  pop.open(card, { runId: 'r1', node: AGENT, models });
  assert.equal(armOnScreen(), 'edit');
  pop.close();
  pop.open(card, { runId: 'r1', node: { id: 'n_impl', kind: 'end' }, models });
  assert.match(armOnScreen(), /Flow cards spawn nothing/);
  pop.close();
  pop.open(card, { runId: 'r1', node: AGENT, models, busy: true });
  assert.match(armOnScreen(), /execution in flight/);

  // syncNode() -> retuneArm, which adds the run-level answer armFor cannot give
  pop.close();
  pop.open(card, { runId: 'r1', node: AGENT, models });
  pop.syncNode(AGENT, { status: 'done', steps: [] });
  assert.match(armOnScreen(), /nothing will dispatch again/);
  pop.close();
});

// ── which failures are the USER's ──────────────────────────────────────────
import { validateModelSelection } from '../src/core/config.mjs';

test('a selection refusal is TAGGED; anything else travels untagged', async () => {
  // retuneNode maps only the tagged ones to BAD_SELECTION -> HTTP 400.
  // validateModelSelection also reads the config DB and the plugins lock, and a
  // locked or corrupt one throws straight through it: reporting `SQLITE_BUSY`
  // under the model dropdown, as though the user had picked something invalid,
  // lies about whose fault it is and hides a server fault behind a 400.
  await assert.rejects(() => validateModelSelection(process.cwd(), { model: 'no-such-model' }),
    (e) => e.badSelection === true && /unknown model "no-such-model"/.test(e.message));
  await assert.rejects(() => validateModelSelection(process.cwd(), { effort: 'high' }),
    (e) => e.badSelection === true && /select a model before choosing an effort/.test(e.message));
  await assert.rejects(() => validateModelSelection(process.cwd(), { model: 'claude-opus-5', effort: 'nope' }),
    (e) => e.badSelection === true && /unknown effort "nope"/.test(e.message));
  // Haiku 4.5 advertises medium/high only.
  await assert.rejects(() => validateModelSelection(process.cwd(), { model: 'claude-haiku-4-5', effort: 'max' }),
    (e) => e.badSelection === true && /does not support effort "max"/.test(e.message));
});

test('the orchestrator re-throws an untagged validator failure instead of calling it a 400', () => {
  const src = readFileSync('src/core/orchestrator.mjs', 'utf8');
  assert.match(src, /if \(err && err\.badSelection\) throw retuneErr\('BAD_SELECTION', err\.message\);\s*\n\s*throw err;/);
});
