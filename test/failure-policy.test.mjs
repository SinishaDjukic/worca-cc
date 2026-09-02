// The failure-policy matrix, one test per cell. This file IS the review surface
// for a policy shift: flipping a cell in src/core/failure-policy.mjs changes
// exactly one row here. The engine tests (orchestrator-recovery,
// orchestrator-error-pause, run-harness-hooks, skills-gate-wiring, …) prove the
// sites ENACT the verdicts; this file pins WHAT the verdicts are.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFailure, FAILURE_POLICY, SITES, REASON, REASON_CODES,
  RECOVERY_MAX_AUTO_ATTEMPTS, promptOptions, giveUpOption, answerFromDecision,
  markTerminal, isTerminal, pauseConsequences, pauseExitCode, describePauseReason,
} from '../src/core/failure-policy.mjs';

const MAX = RECOVERY_MAX_AUTO_ATTEMPTS;
const PAUSE_ERR = { outcome: 'pause', reason: 'error' };

// ── the matrix, cell by cell ────────────────────────────────────────────────────
// [site, cls, auto, attempt, answer] -> expected verdict (options elided)
const ROWS = [
  // node / usage_limit: never retried, pauses with its own reason, both modes
  ['node', 'usage_limit', true,  1, undefined, { outcome: 'pause', reason: 'usage_limit' }],
  ['node', 'usage_limit', false, 1, undefined, { outcome: 'pause', reason: 'usage_limit' }],
  // node / auth, quota: auto pauses on the FIRST hit (no futile backoff); interactive prompts
  ['node', 'auth',  true,  1, undefined, PAUSE_ERR],
  ['node', 'quota', true,  1, undefined, PAUSE_ERR],
  ['node', 'auth',  false, 1, undefined, { outcome: 'prompt' }],
  ['node', 'quota', false, 1, undefined, { outcome: 'prompt' }],
  ['node', 'auth',  false, 1, 'retry',   { outcome: 'retry' }],
  ['node', 'auth',  false, 1, 'giveup',  PAUSE_ERR],
  // node / network, rate_limit: auto retries MAX times, then pauses; interactive prompts
  ['node', 'network',    true, 1,       undefined, { outcome: 'retry' }],
  ['node', 'network',    true, MAX,     undefined, { outcome: 'retry' }],
  ['node', 'network',    true, MAX + 1, undefined, PAUSE_ERR],
  ['node', 'rate_limit', true, 1,       undefined, { outcome: 'retry' }],
  ['node', 'rate_limit', true, MAX + 1, undefined, PAUSE_ERR],
  ['node', 'network',    false, 1, undefined, { outcome: 'prompt' }],
  ['node', 'network',    false, 1, 'retry',   { outcome: 'retry' }],
  ['node', 'network',    false, 1, 'giveup',  PAUSE_ERR],
  ['node', 'rate_limit', false, 1, 'giveup',  PAUSE_ERR],
  // node / unclassified (the contested row): pauses, both modes
  ['node', null, true,  1, undefined, PAUSE_ERR],
  ['node', null, false, 1, undefined, PAUSE_ERR],
  // flow: a flow card / questions loop / _afterExecution / composite-shell throw pauses
  ['flow', null,      true,  1, undefined, PAUSE_ERR],
  ['flow', null,      false, 1, undefined, PAUSE_ERR],
  ['flow', 'network', true,  1, undefined, PAUSE_ERR],
  // budget: a cap pauses with its cost code
  ['budget', 'cost_pipeline', true,  1, undefined, { outcome: 'pause', reason: 'cost_pipeline' }],
  ['budget', 'cost_pipeline', false, 1, undefined, { outcome: 'pause', reason: 'cost_pipeline' }],
  ['budget', 'cost_total',    true,  1, undefined, { outcome: 'pause', reason: 'cost_total' }],
  ['budget', 'cost_total',    false, 1, undefined, { outcome: 'pause', reason: 'cost_total' }],
  // setup: checkout / graph / skills gate failed with the row created -> pause (+ replay on resume)
  ['setup', null,   true,  1, undefined, PAUSE_ERR],
  ['setup', null,   false, 1, undefined, PAUSE_ERR],
  ['setup', 'auth', false, 1, undefined, PAUSE_ERR],
  // launch: no row yet -> the only enactable verdict
  ['launch', null,      true,  1, undefined, { outcome: 'error' }],
  ['launch', null,      false, 1, undefined, { outcome: 'error' }],
  ['launch', 'network', true,  1, undefined, { outcome: 'error' }],
  // shell: escaped the engine after setup -> pause
  ['shell', null,  true,  1, undefined, PAUSE_ERR],
  ['shell', null,  false, 1, undefined, PAUSE_ERR],
  ['shell', 'quota', true, 1, undefined, PAUSE_ERR],
];

for (const [site, cls, auto, attempt, answer, want] of ROWS) {
  const label = `${site}/${cls ?? '*'} ${auto ? 'auto' : 'interactive'} attempt=${attempt}${answer ? ` answer=${answer}` : ''}`;
  test(`matrix: ${label} -> ${want.outcome}${want.reason ? `(${want.reason})` : ''}`, () => {
    const got = resolveFailure({ site, cls, auto, attempt, answer });
    assert.equal(got.outcome, want.outcome);
    assert.equal(got.reason, want.reason);
    if (want.outcome === 'prompt') assert.ok(Array.isArray(got.options) && got.options.length === 2, 'a prompt carries its two options');
    else assert.equal(got.options, undefined);
  });
}

// ── structural guarantees ──────────────────────────────────────────────────────

test('every site has a row for every class the classifier can produce (or a * row)', () => {
  const classes = ['auth', 'usage_limit', 'rate_limit', 'quota', 'network', null];
  for (const site of SITES) {
    assert.ok(FAILURE_POLICY[site], `site ${site} is in the matrix`);
    for (const cls of classes) {
      if (site === 'budget') continue;   // the budget site takes cost codes, not error classes
      assert.doesNotThrow(() => resolveFailure({ site, cls, auto: true }), `${site}/${cls ?? '*'} auto`);
      assert.doesNotThrow(() => resolveFailure({ site, cls, auto: false }), `${site}/${cls ?? '*'} interactive`);
    }
  }
  assert.throws(() => resolveFailure({ site: 'nowhere' }), /unknown site/);
});

test('every pause verdict names a known reason code', () => {
  for (const site of SITES) {
    for (const cls of Object.keys(FAILURE_POLICY[site])) {
      for (const auto of [true, false]) {
        const v = resolveFailure({ site, cls: cls === '*' ? null : cls, auto, attempt: MAX + 1, answer: 'giveup' });
        if (v.outcome === 'pause') assert.ok(REASON_CODES.includes(v.reason), `${site}/${cls}: ${v.reason}`);
      }
    }
  }
});

test('the launch site can only end the run — nothing exists to resume into', () => {
  for (const cls of ['auth', 'network', null]) {
    for (const auto of [true, false]) assert.equal(resolveFailure({ site: 'launch', cls, auto }).outcome, 'error');
  }
});

test('the matrix is frozen: a site cannot be edited at runtime', () => {
  assert.ok(Object.isFrozen(FAILURE_POLICY));
  assert.ok(Object.isFrozen(FAILURE_POLICY.node));
  assert.throws(() => { FAILURE_POLICY.node.auth = null; }, TypeError);
});

// ── the recovery prompt's options ──────────────────────────────────────────────

test('promptOptions: Retry is fixed; the give-up option names the verdict it enacts', () => {
  const p = promptOptions({ outcome: 'pause', reason: 'error' });
  assert.deepEqual(p.map((o) => o.id), ['retry', 'pause']);
  const a = promptOptions({ outcome: 'error' });
  assert.deepEqual(a.map((o) => o.id), ['retry', 'abort']);
  assert.match(a[1].label, /Abort/);
});

test('the interactive rows carry their options through the prompt verdict', () => {
  const v = resolveFailure({ site: 'node', cls: 'network', auto: false });
  assert.equal(v.outcome, 'prompt');
  assert.deepEqual(v.options.map((o) => o.id), ['retry', 'pause']);
});

test('giveUpOption: the non-retry option, or the pause option for a payload without options', () => {
  assert.equal(giveUpOption([{ id: 'retry' }, { id: 'abort' }]).id, 'abort');
  assert.equal(giveUpOption(undefined).id, 'pause');
  assert.equal(giveUpOption([]).id, 'pause');
});

test("answerFromDecision: 'retry' retries; 'pause', 'abort' (legacy) and anything else give up", () => {
  assert.equal(answerFromDecision('retry'), 'retry');
  assert.equal(answerFromDecision('pause'), 'giveup');
  assert.equal(answerFromDecision('abort'), 'giveup');
  assert.equal(answerFromDecision(undefined), 'giveup');
});

// ── the terminal stamp ─────────────────────────────────────────────────────────

test('markTerminal stamps an error in place (identity kept) and isTerminal reads it', () => {
  const err = new Error('boom');
  assert.equal(isTerminal(err), false);
  assert.equal(markTerminal(err), err);
  assert.equal(isTerminal(err), true);
  assert.equal(isTerminal(null), false);
  assert.equal(isTerminal('boom'), false);
  assert.doesNotThrow(() => markTerminal(Object.freeze(new Error('frozen'))));
});

// ── consequences, keyed on the reason ──────────────────────────────────────────

test('consequences: a manual pause is silent; every reasoned pause reports needs-human', () => {
  assert.equal(pauseConsequences(null).reportsToSource, false);
  assert.equal(pauseConsequences('').reportsToSource, false);
  for (const r of REASON_CODES) assert.equal(pauseConsequences(r).reportsToSource, true, r);
});

test('consequences: only an error-pause stages the diff artifact and reads as an error', () => {
  assert.equal(pauseConsequences(REASON.ERROR).stagesResults, true);
  assert.equal(pauseConsequences(REASON.ERROR).severity, 'error');
  assert.equal(pauseConsequences(REASON.ERROR).notifyPref, 'error');
  for (const r of [REASON.USAGE_LIMIT, REASON.COST_PIPELINE, REASON.COST_TOTAL]) {
    assert.equal(pauseConsequences(r).stagesResults, false, r);
    assert.equal(pauseConsequences(r).severity, 'warning', r);
    assert.equal(pauseConsequences(r).notifyPref, 'paused', r);
  }
  assert.equal(pauseConsequences(null).severity, 'info');
});

test('consequences: a legacy free-text reason (a pre-policy usage-limit line) reads as a forced pause', () => {
  const c = pauseConsequences("You've hit your session limit · resets 6pm");
  assert.equal(c.reportsToSource, true);
  assert.equal(c.severity, 'warning');
});

test('exit codes: 3 under --yes for every pause; interactive 0 unless an error forced it', () => {
  for (const r of [null, ...REASON_CODES]) assert.equal(pauseExitCode(r, true), 3, `auto ${r}`);
  assert.equal(pauseExitCode(null, false), 0);
  assert.equal(pauseExitCode(REASON.USAGE_LIMIT, false), 0);
  assert.equal(pauseExitCode(REASON.COST_PIPELINE, false), 0);
  assert.equal(pauseExitCode(REASON.COST_TOTAL, false), 0);
  assert.equal(pauseExitCode(REASON.ERROR, false), 1);
});

test('describePauseReason: a label per code, none for a manual pause', () => {
  assert.equal(describePauseReason(null), null);
  assert.equal(describePauseReason(REASON.ERROR), 'a step failed');
  assert.equal(describePauseReason(REASON.COST_TOTAL), 'total cost limit reached');
  assert.equal(describePauseReason(REASON.USAGE_LIMIT), 'session/usage limit reached');
});
