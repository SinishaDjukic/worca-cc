// test/shape-prototype-step.test.mjs — Shaper small runs C1 (src/core/shape/prototype-step.mjs): the Prototype step's
// loop with fake effects: the offer per Care position, the skip lines, failures, the Thorough review, remarks,
// confirm and resume. Pure: no database, no Design, no spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrototypeStep, validatePrototypeAnswer, buildFindings, REGISTRY_MISSING } from '../src/core/shape/prototype-step.mjs';
import { autoPrototypeAnswer, skipLine } from '../src/shared/shape/prototype.mjs';

const SCREENS = [{ id: 'R-ux-1', text: 'The template editor shows a preview' }, { id: 'R-po-1', text: 'the preferences page lists channels' }];
const PLAIN = [{ id: 'R-arch-1', text: 'the API returns 404' }];
const DONE = (version = 1, cost = 1.4) => ({ status: 'done', reason: null, costUsd: cost, version,
  sections: [{ id: 'editor', job: 'Template editor [R-ux-1]', status: 'done' }, { id: 'prefs', job: 'Preferences [R-po-1]', status: 'done' }] });
const clock = () => { let n = 0; return () => new Date(Date.UTC(2026, 10, 21, 10, 0, n++)); };

/** A fake run: `answers` per moment (a function of the view, or a list consumed in order); every effect is counted. */
function rig({ position = 'balanced', agreed = SCREENS, designOn = true, registry = true, answers = {}, ends = [], findings = [],
  match = null, rewriteOk = true, freezeOut = null, rec = {}, now = clock() } = {}) {
  const calls = { asks: [], builds: 0, changes: [], awaits: [], reviews: 0, matches: [], rewrites: [], freezes: [], persists: [], audits: [] };
  let nb = 0;
  const left = { ...answers };
  const ask = async (moment, view) => {
    calls.asks.push({ moment, view });
    const a = left[moment];
    if (typeof a === 'function') return a(view);
    if (Array.isArray(a) && a.length) return a.shift();
    return autoPrototypeAnswer({ moment, ...view });
  };
  const queue = [...ends];
  const fx = {
    rec, position, agreed, designOn, registry, ask, now,
    build: async () => { calls.builds += 1; nb += 1; return { designId: 'd_1', buildId: `b_${nb}`, round: nb }; },
    change: async (a) => { calls.changes.push(a); nb += 1; return { buildId: `b_${nb}`, round: nb }; },
    awaitBuild: async (id) => { calls.awaits.push(id); return queue.length ? queue.shift() : DONE(nb, 1); },
    review: async (r) => { calls.reviews += 1; return typeof findings === 'function' ? findings(r) : findings; },
    matchRemark: async (said) => { calls.matches.push(said); return typeof match === 'function' ? match(said) : match; },
    rewrite: async (id, p) => { calls.rewrites.push([id, p]); return rewriteOk; },
    freeze: async (a) => { calls.freezes.push(a); return freezeOut ? freezeOut(a) : { dir: '/run/prototype-confirmed', version: a.shownVersion }; },
    persist: async () => { calls.persists.push(JSON.stringify(rec.prototype)); },
    audit: async (t) => { calls.audits.push(t); },
  };
  return { fx, calls, rec };
}

test('R-qa-7: 3 Care positions × with and without screen requirements, Design off and no registry', async () => {
  for (const position of ['lean', 'balanced', 'thorough']) {
    const off = rig({ position, agreed: PLAIN });
    assert.deepEqual(await runPrototypeStep(off.fx), { state: 'skipped' });
    assert.equal(off.calls.asks.length, 0);
    assert.deepEqual(off.calls.audits, ['Prototype skipped · no screen requirements.']);
    assert.equal(off.rec.prototype.cause, 'no-screens');
    const on = rig({ position, answers: { offered: [{ decision: 'stop' }] } });
    assert.deepEqual(await runPrototypeStep(on.fx), { state: 'stopped' });
    assert.equal(on.calls.asks[0].moment, 'offered');
    assert.deepEqual(on.calls.asks[0].view.offer, position === 'lean' ? { primary: 'skip', menu: 'build', review: false }
      : { primary: 'build', menu: 'skip', review: position === 'thorough' });
    assert.deepEqual(on.calls.asks[0].view.requirements.map((r) => r.id), ['R-ux-1', 'R-po-1']);
  }
  const design = rig({ designOn: false });
  assert.deepEqual(await runPrototypeStep(design.fx), { state: 'skipped' });
  assert.deepEqual(design.calls.audits, ['Prototype skipped · Design is turned off.']);
  const none = rig({ registry: false });
  assert.deepEqual(await runPrototypeStep(none.fx), { state: 'skipped' });
  assert.deepEqual(none.calls.audits, [`${REGISTRY_MISSING}.`, 'Prototype skipped · Design is turned off.']);
  assert.equal(none.calls.asks.length + none.calls.builds, 0);
  // No screens is checked first, also with Design off.
  const both = rig({ agreed: PLAIN, designOn: false });
  await runPrototypeStep(both.fx);
  assert.equal(both.rec.prototype.cause, 'no-screens');
});

test('a skip answer stores cause lean under Lean and person otherwise, with its line', async () => {
  for (const [position, cause] of [['lean', 'lean'], ['balanced', 'person'], ['thorough', 'person']]) {
    const r = rig({ position, answers: { offered: [{ decision: 'skip' }] } });
    assert.deepEqual(await runPrototypeStep(r.fx), { state: 'skipped' });
    assert.equal(r.rec.prototype.cause, cause);
    assert.deepEqual(r.calls.audits, [`${skipLine(cause)}.`]);
    assert.equal(r.calls.builds, 0);
  }
});

test('the main path: offered → build → built → confirm, cost counted once, the ref written', async () => {
  const r = rig({ ends: [DONE(3, 2.8)] });
  assert.deepEqual(await runPrototypeStep(r.fx), { state: 'confirmed' });
  assert.deepEqual(r.calls.asks.map((a) => a.moment), ['offered', 'built']);
  assert.equal(r.calls.builds, 1);
  const built = r.calls.asks[1].view;
  assert.equal(built.version, 3);
  assert.deepEqual(built.screens.map((s) => [s.section, s.name, s.ids]), [['editor', 'Template editor', ['R-ux-1']], ['prefs', 'Preferences', ['R-po-1']]]);
  assert.equal(r.rec.prototype.state, 'confirmed');
  assert.deepEqual(r.rec.prototype.ref, { dir: '/run/prototype-confirmed', version: 3, designId: 'd_1' });
  assert.equal(r.rec.prototype.costUsd, 2.8);
  assert.deepEqual(r.calls.audits, ["Prototype built by Design's agents · 2 screens · $2.80.", 'Prototype confirmed by you.']);
});

test('confirm on a stale version re-asks built with the new version and persists no confirmed state and no ref', async () => {
  let first = true;
  const r = rig({ ends: [DONE(2)], answers: { built: [{ decision: 'confirm' }, { decision: 'stop' }] },
    freezeOut: (a) => { if (first) { first = false; return { stale: 3 }; } return { dir: '/x', version: a.shownVersion }; } });
  assert.deepEqual(await runPrototypeStep(r.fx), { state: 'stopped' });
  assert.deepEqual(r.calls.asks.map((a) => [a.moment, a.view.version]), [['offered', undefined], ['built', 2], ['built', 3]]);
  for (const saved of r.calls.persists) { assert.ok(!saved.includes('"confirmed"')); assert.ok(!saved.includes('"ref"')); }
});

test('R-arch-6: a partial build, 0 screens, 409, 403 and no-dist each raise the failed ask with its findings', async () => {
  const partial = { status: 'done', reason: 'partial', costUsd: 1, version: 1,
    sections: [{ id: 'editor', job: 'Template editor', status: 'done' }, { id: 'prefs', job: 'Email preferences page', status: 'failed' }] };
  const empty = { status: 'done', reason: null, costUsd: 0, version: 1, sections: [] };
  const cases = [
    [{ ends: [partial] }, '1 of 2 screens built: Email preferences page failed'],
    [{ ends: [empty] }, "0 screens built: Design's lead planned no screen"],
  ];
  for (const [opts, text] of cases) {
    const r = rig({ ...opts, answers: { failed: [{ decision: 'stop' }] } });
    assert.deepEqual(await runPrototypeStep(r.fx), { state: 'stopped' });
    const f = r.calls.asks.at(-1);
    assert.equal(f.moment, 'failed');
    assert.deepEqual(f.view.findings.map((x) => x.text), [text]);
  }
  for (const words of ['A build is already open: wait for it, or press Resume or Stop.', 'Total cost limit reached: no build started.']) {
    const r = rig({ answers: { failed: [{ decision: 'stop' }] } });
    r.fx.build = async () => ({ refused: words });
    await runPrototypeStep(r.fx);
    assert.deepEqual(r.calls.asks.at(-1).view.findings.map((x) => x.text), [words]);
  }
  const nd = rig({ answers: { failed: [{ decision: 'stop' }] }, freezeOut: () => { throw Object.assign(new Error('The prototype has no built page to confirm.'), { code: 'no-dist' }); } });
  await runPrototypeStep(nd.fx);
  assert.deepEqual(nd.calls.asks.map((a) => a.moment), ['offered', 'built', 'failed']);
  assert.deepEqual(nd.calls.asks.at(-1).view.findings.map((x) => x.text), ['The prototype has no built page to confirm.']);
  // --yes: Build again once, then Skip (cause person).
  const yes = rig({ ends: [empty, empty] });
  assert.deepEqual(await runPrototypeStep(yes.fx), { state: 'skipped' });
  assert.equal(yes.calls.builds, 2);
  assert.equal(yes.rec.prototype.cause, 'person');
  assert.equal(buildFindings({ status: 'error', reason: 'engine-error', sections: [{ id: 'a', status: 'done' }] })[0], 'The build ended error (engine-error)');
});

test('Thorough: an objection runs 1 change round on its sections and a re-review, and the review stops at 3 rounds', async () => {
  const once = rig({ position: 'thorough', findings: (r) => (r === 1 ? [{ role: 'design', text: 'Preview too small', objection: true, sections: ['editor', 'nope'] }] : [{ role: 'product', text: 'Fine', objection: false }]) });
  assert.deepEqual(await runPrototypeStep(once.fx), { state: 'confirmed' });
  assert.equal(once.calls.reviews, 2);
  assert.equal(once.calls.changes.length, 1);
  assert.deepEqual(once.calls.changes[0].sections, ['editor']);
  assert.equal(once.calls.changes[0].needsLead, false);
  assert.deepEqual(once.calls.asks.find((a) => a.moment === 'built').view.findings, [{ role: 'product', text: 'Fine', objection: false }]);
  const always = rig({ position: 'thorough', findings: [{ role: 'product', text: 'Wrong flow', objection: true, sections: [] }] });
  await runPrototypeStep(always.fx);
  assert.equal(always.calls.reviews, 3);
  assert.equal(always.calls.changes.length, 2);
  assert.equal(always.calls.changes[0].needsLead, true);
  assert.deepEqual(always.calls.asks.find((a) => a.moment === 'built').view.findings, [{ role: 'product', text: 'Wrong flow', objection: true }]);
  assert.equal(rig({ position: 'balanced' }).calls.reviews, 0);
});

test('R-qa-8: a no-match remark leaves the persisted record byte-equal, makes 0 rewrites and re-asks with the reply and the remark', async () => {
  const r = rig({ answers: { built: [{ decision: 'remark', remark: 'make it calmer' }, { decision: 'stop' }] }, match: null });
  await runPrototypeStep(r.fx);
  const builtAt = r.calls.persists.findIndex((s) => s.includes('"state":"built"'));
  const before = r.calls.persists[r.calls.persists.length - 3];
  assert.ok(builtAt >= 0);
  assert.equal(JSON.parse(before).state, 'built');
  assert.equal(JSON.parse(r.calls.persists.at(-2)).state, 'matching');
  assert.equal(r.calls.persists.at(-1), before, 'the matching round-trip writes back the prior bytes');
  assert.equal(JSON.stringify(r.rec.prototype), before);
  assert.equal(r.calls.rewrites.length, 0);
  const again = r.calls.asks.at(-1);
  assert.equal(again.moment, 'built');
  assert.equal(again.view.remarkError, 'no-match');
  assert.equal(again.view.remarkText, 'make it calmer');
});

test('a matched remark: change rewrites only then and runs 1 change round on the screens that carry the id; keep rewrites nothing', async () => {
  const proposal = { id: 'R-ux-1', text: 'The preview follows dark mode', example: 'dark page, dark preview', was: 'The template editor shows a preview' };
  const ch = rig({ match: proposal, answers: { built: [{ decision: 'remark', remark: 'R-ux-1 should show dark mode' }, { decision: 'confirm' }],
    remark: (v) => { assert.equal(ch.calls.rewrites.length, 0, 'no rewrite before change'); assert.deepEqual(v.remark.proposed, { text: proposal.text, example: proposal.example, was: proposal.was }); return { decision: 'change' }; } } });
  assert.deepEqual(await runPrototypeStep(ch.fx), { state: 'confirmed' });
  assert.deepEqual(ch.calls.rewrites, [['R-ux-1', { text: proposal.text, example: proposal.example }]]);
  assert.equal(ch.calls.changes.length, 1);
  assert.deepEqual(ch.calls.changes[0].sections, ['editor']);
  assert.equal(ch.rec.prototype.remarks, 1);
  assert.equal(ch.rec.prototype.rebuilt, true);
  assert.ok(ch.calls.audits.includes('Your remark: “R-ux-1 should show dark mode” → R-ux-1 updated.'));
  const keep = rig({ match: proposal, answers: { built: [{ decision: 'remark', remark: 'darker' }, { decision: 'confirm' }], remark: [{ decision: 'keep' }] } });
  await runPrototypeStep(keep.fx);
  assert.equal(keep.calls.rewrites.length, 0);
  assert.equal(keep.calls.changes.length, 0);
  assert.equal(keep.rec.prototype.remarks, 0);
  // A rewrite the check refuses keeps the requirement and builds nothing.
  const bad = rig({ match: proposal, rewriteOk: false, answers: { built: [{ decision: 'remark', remark: 'x' }, { decision: 'confirm' }], remark: [{ decision: 'change' }] } });
  await runPrototypeStep(bad.fx);
  assert.equal(bad.calls.changes.length, 0);
  assert.ok(bad.calls.audits.some((t) => t.startsWith('Remark not applied: R-ux-1')));
});

test('a remark rebuild audits \'Prototype rebuilt with your remark · …\', never a second \'built by Design\'s agents\'', async () => {
  const proposal = { id: 'R-ux-1', text: 'The preview follows dark mode', example: 'dark page, dark preview', was: 'The template editor shows a preview' };
  const h = rig({ match: proposal, answers: { built: [{ decision: 'remark', remark: 'R-ux-1 should show dark mode' }, { decision: 'confirm' }], remark: [{ decision: 'change' }] } });
  await runPrototypeStep(h.fx);
  const built = h.calls.audits.filter((t) => t.startsWith('Prototype built by'));
  const rebuilt = h.calls.audits.filter((t) => t.startsWith('Prototype rebuilt with your remark · '));
  assert.equal(built.length, 1, h.calls.audits.join('\n'));
  assert.equal(rebuilt.length, 1, h.calls.audits.join('\n'));
  assert.match(rebuilt[0], /^Prototype rebuilt with your remark · 2 screens · \$\d+\.\d{2}\.$/);
});

const saved = (state, extra = {}) => ({ prototype: { v: 1, state, screenIds: ['R-ux-1', 'R-po-1'], designId: 'd_1', round: 1, screens: [],
  costUsd: 1, findings: [], reviewRounds: 0, remarks: 0, rebuilt: false, at: '2026-11-21T09:00:00.000Z', ...extra } });

test('invariant 6: a resume never starts a second build of a recorded one', async () => {
  const built = rig({ rec: saved('built', { buildId: 'b_9', version: 2 }) });
  await runPrototypeStep(built.fx);
  assert.equal(built.calls.builds + built.calls.changes.length, 0);
  assert.deepEqual(built.calls.asks.map((a) => a.moment), ['built']);
  const live = rig({ rec: saved('building', { buildId: 'b_9' }) });
  await runPrototypeStep(live.fx);
  assert.deepEqual(live.calls.awaits, ['b_9']);
  assert.equal(live.calls.builds + live.calls.changes.length, 0);
  assert.equal(live.rec.prototype.costUsd, 2, 'the awaited build\'s cost is added once');
  const lost = { status: 'interrupted', reason: 'restart', costUsd: 0, version: 1,
    sections: [{ id: 'editor', job: 'Editor', status: 'done' }, { id: 'prefs', job: 'Prefs', status: 'writing' }] };
  const withPlan = rig({ rec: saved('building', { buildId: 'b_9' }), ends: [lost] });
  await runPrototypeStep(withPlan.fx);
  assert.equal(withPlan.calls.builds, 0);
  assert.deepEqual(withPlan.calls.changes.map((c) => c.sections), [['prefs']]);
  const noPlan = rig({ rec: saved('building', { buildId: 'b_9' }), ends: [{ status: 'interrupted', reason: 'restart', costUsd: 0, version: 0, sections: [] }] });
  await runPrototypeStep(noPlan.fx);
  assert.equal(noPlan.calls.builds, 1);
  assert.equal(noPlan.calls.changes.length, 0);
  for (const state of ['confirmed', 'skipped']) {
    const done = rig({ rec: saved(state, state === 'skipped' ? { cause: 'person' } : {}) });
    assert.deepEqual(await runPrototypeStep(done.fx), { state });
    assert.equal(done.calls.asks.length + done.calls.builds + done.calls.persists.length, 0);
  }
  const matching = rig({ rec: saved('matching', { buildId: 'b_9', version: 2, remark: { text: 'calmer' } }), answers: { built: [{ decision: 'stop' }] } });
  await runPrototypeStep(matching.fx);
  assert.deepEqual(matching.calls.matches, ['calmer']);
  assert.equal(matching.calls.asks[0].view.remarkText, 'calmer');
  const reviewing = rig({ position: 'thorough', rec: saved('reviewing', { buildId: 'b_9', reviewRounds: 2 }), ends: [DONE(2)] });
  await runPrototypeStep(reviewing.fx);
  assert.equal(reviewing.calls.reviews, 1, 'the open round runs again, nothing else');
  assert.equal(reviewing.calls.builds, 0);
});

test('Thorough: a refused change round fails, and Build again reviews the fresh build from round 1', async () => {
  const rounds = [];
  const r = rig({ position: 'thorough', answers: { failed: [{ decision: 'build' }] },
    findings: (n) => { rounds.push(n); return rounds.length === 1 ? [{ role: 'design', text: 'Too small', objection: true, sections: ['editor'] }] : []; } });
  r.fx.change = async () => ({ refused: 'Total cost limit reached: no build started.' });
  assert.deepEqual(await runPrototypeStep(r.fx), { state: 'confirmed' });
  assert.deepEqual(r.calls.asks.map((a) => a.moment), ['offered', 'failed', 'built']);
  assert.deepEqual(rounds, [1, 1], 'the second build is reviewed from round 1');
  assert.equal(r.rec.prototype.reviewRounds, 1);
});

test('a design is saved the moment the build makes it, so a refused or replayed first round reuses it', async () => {
  const r = rig({ answers: { failed: [{ decision: 'stop' }] } });
  const seen = [];
  r.fx.build = async ({ keep }) => { seen.push(r.rec.prototype.designId); await keep('d_7'); return { refused: 'Design builds are not available.' }; };
  await runPrototypeStep(r.fx);
  assert.deepEqual(seen, [undefined]);
  assert.equal(r.rec.prototype.designId, 'd_7');
  assert.ok(r.calls.persists.some((s) => JSON.parse(s).designId === 'd_7' && JSON.parse(s).state === 'offered'), 'saved before the build answered');
});

test('an interrupted round\'s spend is kept when the step restarts it', async () => {
  const lost = { status: 'interrupted', reason: 'restart', costUsd: 0.5, version: 1,
    sections: [{ id: 'editor', job: 'Editor', status: 'done' }, { id: 'prefs', job: 'Prefs', status: 'writing' }] };
  const r = rig({ rec: saved('building', { buildId: 'b_9' }), ends: [lost, DONE(2, 1)] });
  await runPrototypeStep(r.fx);
  assert.equal(r.rec.prototype.costUsd, 2.5);
});

test('validatePrototypeAnswer: decisions per moment, the remark\'s length, stop anywhere', () => {
  assert.deepEqual(validatePrototypeAnswer({ decision: 'build' }, 'offered'), { ok: true, payload: { decision: 'build' } });
  assert.deepEqual(validatePrototypeAnswer({ decision: 'stop' }, 'built'), { ok: true, payload: { decision: 'stop' } });
  assert.equal(validatePrototypeAnswer({ decision: 'change' }, 'built').errors[0].code, 'bad-decision');
  assert.equal(validatePrototypeAnswer({ decision: 'remark', remark: '' }, 'built').errors[0].code, 'bad-remark');
  assert.equal(validatePrototypeAnswer({ decision: 'remark', remark: 'x'.repeat(1001) }, 'built').errors[0].code, 'bad-remark');
  assert.deepEqual(validatePrototypeAnswer({ decision: 'remark', remark: ' calmer ' }, 'built'), { ok: true, payload: { decision: 'remark', remark: 'calmer' } });
  assert.deepEqual(validatePrototypeAnswer({ decision: 'keep' }, 'remark'), { ok: true, payload: { decision: 'keep' } });
  assert.equal(validatePrototypeAnswer(null, 'failed').ok, false);
});

test('D19: autoPrototypeAnswer takes Worca\'s pick', () => {
  assert.deepEqual(autoPrototypeAnswer({ moment: 'offered', offer: { primary: 'build' } }), { decision: 'build' });
  assert.deepEqual(autoPrototypeAnswer({ moment: 'offered', offer: { primary: 'skip' } }), { decision: 'skip' });
  assert.deepEqual(autoPrototypeAnswer({ moment: 'built' }), { decision: 'confirm' });
  assert.deepEqual(autoPrototypeAnswer({ moment: 'remark' }), { decision: 'keep' });
  assert.deepEqual(autoPrototypeAnswer({ moment: 'failed', attempt: 1 }), { decision: 'build' });
  assert.deepEqual(autoPrototypeAnswer({ moment: 'failed', attempt: 2 }), { decision: 'skip' });
  assert.equal(autoPrototypeAnswer({}), null);
});
