// test/ui-design-hud-model.test.mjs — the Design stage model's HUD, agent rows and plan rows
// (ui/public/design/stage-model.mjs): `selectHud`, `selectAgentRows`, `selectPlanRows` and their string helpers, the
// plain objects hud.mjs, agents-panel.mjs and plan-list.mjs paint. Frames come from
// test/helpers/design-stage-frames.mjs, shaped as P2 sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREW_TOKENS, LEAD_TOKEN, initialStage, selectHud, selectAgentRows, selectPlanRows, selectCursors, placeCursors,
  stopWords, agentAction, fmtElapsed, fmtAgentCost,
} from '../ui/public/design/stage-model.mjs';
import {
  DID, A1, A2, LEAD, build, plan, agent, section, applied, rects, run,
} from './helpers/design-stage-frames.mjs';
import { checkRows } from './helpers/rows.mjs';

const S0 = () => initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } });
const hud = (steps) => selectHud(run(S0(), steps).state);
const P = plan(['a', 'b', 'c', 'd']);
const M = (o) => build(o.status ?? 'building', { ...o, stats: { costUsd: 2.84, estimatedUsd: 0.26, costKnown: true, elapsedMs: 374000, agentsTotal: 29, ...o.stats } });

test('M12: the U3 count is cursors; it never reads stats.agentsNow; waiting counts', () => {
  const steps = [M({ stats: { agentsNow: 99 } }), P, agent(A1, 'writing', { sectionId: 'a' }), agent(A2, 'waiting', { sectionId: 'b' })];
  const s = run(S0(), steps).state;
  assert.equal(selectHud(s).agents, 2);
  assert.equal(selectHud(s).agents, selectCursors(s).length);
  assert.equal(selectHud(s).text.startsWith('2 agents · 1 waiting · 0 / 4 sections'), true);
  assert.deepEqual(selectHud(s).dots.map((d) => [d.agentId, d.crew, d.waiting, d.label]), [
    [A1, CREW_TOKENS[0], false, 'Hero: Writing'], [A2, CREW_TOKENS[1], true, 'Hero: Waiting for your answer']], 'a dot per cursor, labelled job: action');
  assert.equal(selectHud(s).stopWord, 'Stop 2 agents?');
});
test('U3: the HUD count equals cursors, parked or not, after every frame of a long build', () => {
  let s = S0();
  const crew = ['a', 'b', 'c'].map((id, i) => [`a_0000000${i}`, id]);
  const frames = [build('planning'), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null }), agent(LEAD, 'done', { role: 'lead', job: 'Lead', sectionId: null }), build(), P,
    rects([['a', 0, 0, 100, 100], ['b', 0, 5000, 100, 100], ['c', 0, 9000, 100, 100], ['d', 0, 12000, 100, 100]]),
    ...crew.map(([id, sec]) => agent(id, 'starting', { sectionId: sec })), ...crew.map(([id, sec]) => agent(id, 'writing', { sectionId: sec })),
    applied('b', { tail: { rect: [1, 5001, 1, 1], tag: 'p' } }), agent('a_00000000', 'waiting', { sectionId: 'a' }), agent('a_00000001', 'error', { sectionId: 'b', error: 'x' }), section('b', 'failed'),
    agent('a_00000000', 'writing', { sectionId: 'a' }), agent('a_00000002', 'done', { sectionId: 'c' }), section('c', 'done'), agent('a_00000000', 'done', { sectionId: 'a' }), build('paused', { reason: 'failed' })];
  const V = { scrollY: 0, s: 1, ox: 0, oy: 0, stageW: 1000, stageH: 900, frameW: 1000 };
  for (const f of frames) {
    s = run(s, [f]).state;
    assert.equal(selectHud(s).agents, placeCursors(selectCursors(s), V).length, f.type ?? f.t);
    assert.equal(selectHud(s).dots.length, selectHud(s).agents);
  }
  assert.equal(selectHud(s).agents, 0);
});
test('the strings', async () => {
  const done2 = [section('a', 'done'), section('b', 'done')];
  await checkRows([
    ['plan', [M({ status: 'planning' }), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })], 'plan', 'Planning…', '$3.10'],
    ['build', [M({}), P, ...done2, agent(A1, 'writing', { sectionId: 'c' }), applied('c', { layers: 123 })], 'build', '1 agent · 2 / 4 sections · 123 layers', '$3.10'],
    ['waiting and failed', [M({}), P, section('a', 'failed'), agent(A1, 'waiting', { sectionId: 'b' }), agent(A2, 'writing', { sectionId: 'c' })], 'build', '2 agents · 1 waiting · 1 failed · 0 / 4 sections · 0 layers', '$3.10'],
    ['one section, one layer', [M({}), plan(['a']), agent(A1, 'writing', { sectionId: 'a' }), applied('a', { layers: 1 })], 'build', '1 agent · 0 / 1 section · 1 layer', '$3.10'],
    ['integrating', [M({ status: 'integrating' })], 'build', 'Integrating…', '$3.10'],
    ['end', [M({ status: 'done' })], 'end', 'Built by 29 agents in 6m 14s · $3.10', ''],
    ['one agent', [M({ status: 'done', stats: { agentsTotal: 1 } })], 'end', 'Built by 1 agent in 6m 14s · $3.10', ''],
    ['M12 partial', [M({ status: 'done', reason: 'partial' }), P, section('b', 'stopped')], 'end', 'Built by 29 agents in 6m 14s · $3.10 · 1 stopped', ''],
    ['change', [M({ status: 'done', kind: 'change', stats: { agentsTotal: 2, elapsedMs: 52000, costUsd: 0.31, estimatedUsd: 0 } })], 'end', 'Changed by 2 agents in 52s · $0.31', ''],
    ['unknown cost', [M({ status: 'done', stats: { agentsTotal: 3, elapsedMs: 40000, costKnown: false } })], 'end', 'Built by 3 agents in 40s · cost unknown', ''],
    ['stopped', [M({ status: 'stopped' }), P, ...done2, applied('a', { layers: 104 })], 'halt', 'Stopped · 2 / 4 sections · 104 layers · $3.10', ''],
    ['paused', [M({ status: 'paused', reason: 'failed' }), P, ...done2, section('c', 'failed'), applied('a', { layers: 156 })], 'halt', 'Paused · 1 failed · 2 / 4 sections · 156 layers · $3.10', ''],
    ['failed', [M({ status: 'error', reason: 'plan-invalid' })], 'halt', 'Failed · 0 / 0 sections · 0 layers · $3.10', ''],
    ['interrupted', [M({ status: 'interrupted' }), P], 'halt', 'Interrupted · 0 / 4 sections · 0 layers · $3.10', ''],
  ].map(([name, steps, phase, text, cost]) => ({ name, run: () => { const h = hud(steps); assert.deepEqual([h.phase, h.text, h.cost], [phase, text, cost]); } })));
});
test('no build means no HUD; pct, the stop words and the state word', () => {
  assert.equal(hud([]).phase, 'none');
  assert.equal(hud([M({}), P, section('a', 'done')]).pct, '25%');
  assert.deepEqual([stopWords(13), stopWords(1)], ['Stop 13 agents?', 'Stop 1 agent?']);
  for (const [steps, word, cls] of [
    [[M({ status: 'planning' })], 'Planning', 'is-work'], [[M({})], 'Building', 'is-work'], [[M({ kind: 'change' })], 'Changing', 'is-work'],
    [[M({}), agent(A1, 'waiting')], 'Needs you', 'is-need'], [[M({}), P, agent(A1, 'waiting'), section('a', 'failed')], '1 failed', 'is-fail'],
    [[M({ status: 'integrating' })], 'Integrating', 'is-work'], [[M({ status: 'done' })], 'Built', 'is-ok'], [[M({ status: 'done', kind: 'change' })], 'Changed', 'is-ok'],
    [[M({ status: 'stopped' })], 'Stopped', 'is-stop'], [[M({ status: 'paused' })], 'Paused', 'is-stop'], [[M({ status: 'paused', reason: 'failed' }), P, section('a', 'failed')], 'Paused', 'is-fail'],
    [[M({ status: 'error' })], 'Failed', 'is-fail'], [[M({ status: 'interrupted' })], 'Interrupted', 'is-stop']]) {
    assert.deepEqual([hud(steps).word, hud(steps).wordClass], [word, cls]);
  }
});
test('Follow shows only while building with the camera off; M13: Resume never asks for a limit', () => {
  const off = run(S0(), [M({})]).state; off.camera = { ...off.camera, on: false };
  assert.equal(selectHud(off).followOff, true);
  assert.equal(hud([M({})]).followOff, false);
  const planning = run(S0(), [M({ status: 'planning' })]).state; planning.camera = { ...planning.camera, on: false };
  assert.equal(selectHud(planning).followOff, false);
  assert.equal(Object.keys(hud([M({ status: 'paused', reason: 'total-limit' })])).some((k) => /budget/i.test(k)), false, 'M13: no limit field; the limit lives in Settings');
  assert.deepEqual([hud([M({ status: 'paused', reason: 'total-limit' })]).canResume, hud([M({ status: 'done' })]).canResume, hud([M({})]).canResume], [true, false, false]);
});
test('agent rows: running first, stop on builders only, finished still listed; words, actions and costs', () => {
  const s = run(S0(), [M({}), P,
    agent(LEAD, 'done', { role: 'lead', job: 'Lead', sectionId: null, costUsd: 0.4 }),
    agent(A1, 'writing', { sectionId: 'a', job: 'Hero', tool: { name: 'Write', path: 'sections/a/index.html' }, estimatedUsd: 0.31 }),
    agent(A2, 'error', { sectionId: 'b', job: 'Price', error: 'Boom', costUsd: 0.2 }),
    agent('a_00000003', 'waiting', { sectionId: 'c', job: 'FAQ', costKnown: false }),
    agent('a_00000004', 'reading', { sectionId: 'd', job: 'CTA', tool: { name: 'Grep', path: 'global.css' } })]).state;
  const { running, rows } = selectAgentRows(s);
  assert.equal(running, 3);
  assert.deepEqual(rows.map((r) => [r.name, r.status, r.statusClass, r.action, r.cost, r.gone, r.canStop]), [
    ['Hero', 'Writing', '', 'Writing index.html', '≥$0.31', false, true],
    ['FAQ', 'Waiting', 'is-need', 'Waiting for your answer', '', false, true],
    ['CTA', 'Reading', '', 'Searching', '≥$0.00', false, true],
    ['Lead', 'Done', '', 'Finished', '$0.40', true, false],
    ['Price', 'Failed', 'is-fail', 'Boom', '$0.20', true, false],
  ]);
  assert.equal(rows.find((r) => r.name === 'FAQ').costTitle, 'cost unknown');
  assert.deepEqual(rows.map((r) => r.crew), [...CREW_TOKENS.slice(0, 3), LEAD_TOKEN, '--ink-3'], 'a finished failed row loses its crew colour');
  const unpriced = selectAgentRows(run(S0(), [M({}), P, agent(A1, 'writing', { sectionId: 'a', job: 'Hero', estimatedUsd: null })]).state).rows[0];
  assert.deepEqual([unpriced.cost, unpriced.costTitle, fmtAgentCost({ costKnown: true, costUsd: null, estimatedUsd: null })], ['', '', { text: '', title: '' }],
    'a model P2 cannot price (cost.mjs:129): no number and no title');
  const lead = run(S0(), [M({ status: 'planning' }), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })]).state;
  assert.equal(selectAgentRows(lead).rows[0].canStop, false, 'no per-agent stop on the lead');
  assert.equal(selectAgentRows(run(S0(), [M({ status: 'stopped' }), agent(A1, 'stopped')]).state).rows[0].canStop, false);
  assert.equal(selectAgentRows(run(S0(), [M({ status: 'paused' }), agent(A1, 'waiting')]).state).rows[0].canStop, false, 'P2 refuses a paused build\'s agent stop');
  assert.equal(agentAction({ status: 'done' }, { summary: 'Hero with a CTA' }), 'Hero with a CTA');
  assert.equal(fmtElapsed(3720000), '1h 2m');
  const act = (status, o = {}) => agentAction({ status, ...o });
  assert.deepEqual([
    act('writing', { tool: { name: 'Edit', path: 'sections/a/style.css' } }), act('reading', { tool: { name: 'Read', path: 'sections\\a\\index.html' } }),
    act('reading', { tool: { name: 'Glob', path: null } }), act('writing', { tool: { name: 'Bash', path: null } }), act('writing', { tool: { name: 'Write', path: null } }),
    act('thinking', { tool: { name: 'Write', path: 'sections/a/index.html' } }), act('retrying'), act('stopped'), act('interrupted'), act('done'),
    act('error', { error: null }), act('error', { error: 'Boom\n  at x' }), act('error', { error: 'x'.repeat(90) }),
  ], [
    'Editing style.css', 'Reading index.html', 'Searching', 'Writing', 'Writing', 'Thinking', 'Retrying', 'Stopped', 'Interrupted by a restart', 'Finished',
    'Failed', 'Boom at x', `${'x'.repeat(79)}…`,
  ], 'P2 sets thinking before it clears the tool; any other tool or no path is the status word; an error is one line of at most 80');
});
test('M5: plan rows group adjacent sections by band, with a count and one dot per real agent; a section with no band is its own row', () => {
  const secs = (o) => ({ id: o[0], job: o[1], status: o[2] ?? 'planned', estHeight: 100, parts: ['html'], agentId: null, ...(o[3] ? { band: o[3] } : {}) });
  const p = plan([secs(['nav', 'Nav', 'done']), secs(['hero-copy', 'Copy', 'writing', 'Hero']), secs(['hero-art', 'Art', 'writing', 'Hero']), secs(['f1', 'One', 'planned', 'Features']), secs(['foot', 'Footer']), secs(['f2', 'Two', 'planned', 'Features'])]);
  const s = run(S0(), [M({}), p, agent(A1, 'writing', { sectionId: 'hero-copy', job: 'Copy' }), agent(A2, 'waiting', { sectionId: 'hero-art', job: 'Art' })]).state;
  const { count, noun, rows } = selectPlanRows(s);
  assert.deepEqual([count, noun], [6, 'sections']);
  assert.deepEqual(rows.map((r) => [r.name, r.n, r.state, r.who.length]), [
    ['Nav', null, 'done', 0], ['Hero', 2, 'waiting', 2], ['Features', 1, 'planned', 0], ['Footer', null, 'planned', 0], ['Features', 1, 'planned', 0]]);
  assert.deepEqual(rows[1].who.map((w) => w.agentId), [A1, A2]);
  assert.ok(rows[1].who.every((w) => CREW_TOKENS.includes(w.crew)));
});
test('plan row states; retry rows only once Retry can work (P2 `continue` rule)', () => {
  const st = (status) => selectPlanRows(run(S0(), [M({}), plan(['a']), section('a', status)]).state).rows[0].state;
  assert.deepEqual(['planned', 'writing', 'done', 'failed', 'stopped'].map(st), ['planned', 'active', 'done', 'failed', 'stopped']);
  assert.equal(selectPlanRows(run(S0(), [M({}), plan(['a']), section('a', 'removed')]).state).count, 0);
  const running = selectPlanRows(run(S0(), [M({}), plan(['a', 'b']), section('a', 'stopped'), section('b', 'failed', { agentId: A2 })]).state);
  assert.deepEqual([running.stopped.length, running.failed.map((f) => [f.id, f.agentId]), running.canRetry], [1, [['b', A2]], false]);
  const partial = selectPlanRows(run(S0(), [M({ status: 'done', reason: 'partial' }), plan(['a']), section('a', 'stopped')]).state);
  assert.deepEqual([partial.stopped, partial.canRetry], [[{ id: 'a', name: 'A' }], true]);
  assert.equal(selectPlanRows(run(S0(), [M({ status: 'paused', reason: 'failed' }), plan(['a']), section('a', 'failed')]).state).canRetry, true);
  const one = selectPlanRows(run(S0(), [M({ status: 'done' }), plan(['a'])]).state);
  assert.deepEqual([one.count, one.noun, one.canRetry], [1, 'section', false], 'a whole round done leaves nothing to retry');
  const band = (id, status) => ({ id, job: id, status, estHeight: 1, parts: ['html'], agentId: null, band: 'Hero' });
  const mixed = selectPlanRows(run(S0(), [M({}), plan([band('h1', 'stopped'), band('h2', 'writing'), 'x', 'y']), agent(A1, 'writing', { sectionId: 'h2' })]).state);
  assert.deepEqual(mixed.rows.map((r) => [r.key, r.name, r.n, r.state]), [['h1', 'Hero', 2, 'active'], ['x', 'X', null, 'planned'], ['y', 'Y', null, 'planned']],
    'a stopped section beside a working agent is at work; band-less neighbours stay apart');
});
