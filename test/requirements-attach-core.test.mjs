// test/requirements-attach-core.test.mjs — resolveAttachments, searchFeatures, composeAttachedPrompt (FEAT-21 server core).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { createFeature, updateFeature, createStart, appendTurn, listStarts, listTurns } from '../src/core/requirements/store.mjs';
import {
  MAX_ATTACHED, resolveAttachments, searchFeatures, composeAttachedPrompt, unavailableRefusal,
} from '../src/core/requirements/attach.mjs';

useTempHome(after, 'worca-req-attach-core-');

// 'shop' is never registered here, so no 'shop' feature is Ready now; `projKey` is a registered project for the Ready cases.
let projKey; let projDir;
before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-attach-core-proj-'));
  projKey = (await addProject({ name: 'ready-proj', path: projDir })).find((p) => p.name === 'ready-proj').key;
});
after(() => { if (projDir) rmSync(projDir, { recursive: true, force: true }); });

const readySpec = (...texts) => ({ ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' },
  criteria: (texts.length ? texts : ['Cancel while unpaid', 'Refund in 3 days']).map((t, i) => ({ id: `R-po-${i + 1}`, text: t })),
  assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] });
/** A feature that passes all six checks in the registered project (its interview round is done). */
function readyFeature({ title = 'Cancel order', scopeType = 'project', scopeKey = projKey, spec = readySpec() } = {}) {
  const f = createFeature({ scopeType, scopeKey, title, description: 'Before it ships' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', criteriaSeq: spec.criteria.length, assumptionSeq: 1, spec });
}

let n = 0;
const make = (title, scopeType = 'project', scopeKey = 'shop') =>
  createFeature({ scopeType, scopeKey, title, description: `desc ${title}` });
const specWith = (...texts) => ({ ...emptySpec(), goal: { text: 'G', measure: '' }, criteria: texts.map((t, i) => ({ id: `R-po-${i + 1}`, text: t })) });
const start = (f, { version = 1, ready = true, spec = specWith('a', 'b') } = {}) =>
  createStart({ featureSeq: f.seq, version, runId: `run-${f.seq}-${version}-${n++}`, spec, title: f.title, ready });

test('resolve: statuses, latest STARTED spec (not draft), counts', async () => {
  const ok = make('Checkout flow');
  start(ok, { version: 1, spec: specWith('old') });
  start(ok, { version: 2, spec: specWith('x', 'y', 'z'), ready: false });
  updateFeature(ok.seq, { spec: { ...emptySpec(), criteria: [{ id: 'R-po-1', text: 'DRAFT ONLY' }] } });
  const unstarted = make('Not yet');
  const arch = make('Old one'); start(arch); updateFeature(arch.seq, { status: 'archived' });
  const { items } = await resolveAttachments([ok.seq, `FEAT-${unstarted.seq}`, arch.seq, 99999], { withMarkdown: true });
  const by = Object.fromEntries(items.map((i) => [i.seq, i]));
  assert.equal(by[ok.seq].status, 'ok');
  assert.equal(by[ok.seq].version, 2);
  assert.equal(by[ok.seq].ready, false);
  assert.equal(by[ok.seq].criteriaCount, 3);
  assert.equal(by[ok.seq].id, `FEAT-${ok.seq}`);
  assert.match(by[ok.seq].markdown, new RegExp(`^# FEAT-${ok.seq} v2: Checkout flow\n`));
  assert.ok(by[ok.seq].markdown.includes('**R-po-3** z'));
  assert.ok(!by[ok.seq].markdown.includes('DRAFT ONLY'));
  assert.equal(by[unstarted.seq].status, 'not_ready');
  assert.equal(by[unstarted.seq].current, false);
  assert.equal(by[unstarted.seq].markdown, null);
  assert.equal(by[unstarted.seq].version, null);
  assert.equal(by[arch.seq].status, 'archived');
  assert.equal(by[99999].status, 'missing');
  assert.equal(by[99999].title, null);
  assert.equal(by[ok.seq].liveRunId, null);
  assert.equal(by[ok.seq].current, false);
  assert.equal(by[99999].current, null);
});

test('resolve: Ready and never started is ok with the current spec, version null, ready true', async () => {
  const f = readyFeature({ title: 'Ready now', spec: readySpec('one', 'two', 'three') });
  const { items: [i] } = await resolveAttachments([f.seq], { withMarkdown: true, scope: { type: 'project', key: projKey } });
  assert.equal(i.status, 'ok');
  assert.equal(i.version, null);
  assert.equal(i.ready, true);
  assert.equal(i.current, true);
  assert.equal(i.criteriaCount, 3);
  assert.match(i.markdown, new RegExp(`^# FEAT-${f.seq} \\(current spec\\): Ready now\n`));
  assert.ok(i.markdown.includes('**R-po-3** three'));
  const bare = await resolveAttachments([f.seq]);
  assert.equal(bare.items[0].markdown, null);
});

test('resolve: not Ready and never started is not_ready, with no markdown', async () => {
  const f = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Half', description: 'd' });
  updateFeature(f.seq, { spec: { ...readySpec(), openQuestions: ['Who pays?'] } });
  const { items: [i] } = await resolveAttachments([f.seq], { withMarkdown: true });
  assert.equal(i.status, 'not_ready');
  assert.equal(i.markdown, null);
  assert.equal(i.version, null);
  assert.equal(i.ready, false);
  assert.equal(i.criteriaCount, null);
});

test('resolve: started, then edited and Ready again, sends the current spec, not the started version', async () => {
  const f = readyFeature({ title: 'Edited', spec: readySpec('OLD CRITERION') });
  start(f, { version: 1, spec: readySpec('OLD CRITERION') });
  updateFeature(f.seq, { spec: readySpec('NEW ONE', 'NEW TWO') });
  const { items: [i] } = await resolveAttachments([f.seq], { withMarkdown: true });
  assert.equal(i.status, 'ok');
  assert.equal(i.version, null);
  assert.equal(i.current, true);
  assert.equal(i.criteriaCount, 2);
  assert.ok(i.markdown.includes('NEW TWO'));
  assert.ok(!i.markdown.includes('OLD CRITERION'));
  assert.match(i.markdown, new RegExp(`^# FEAT-${f.seq} \\(current spec\\): Edited\n`));
});

test('resolve: started and not Ready now keeps the latest start (version, vN heading, its ready flag)', async () => {
  const f = readyFeature({ title: 'Reopened', spec: readySpec('STARTED TEXT') });
  start(f, { version: 1, spec: readySpec('STARTED TEXT'), ready: true });
  updateFeature(f.seq, { spec: { ...readySpec('DRAFT ONLY'), openQuestions: ['Still open?'] } });
  const { items: [i] } = await resolveAttachments([f.seq], { withMarkdown: true });
  assert.equal(i.status, 'ok');
  assert.equal(i.version, 1);
  assert.equal(i.ready, true);
  assert.equal(i.current, false);
  assert.match(i.markdown, new RegExp(`^# FEAT-${f.seq} v1: Reopened\n`));
  assert.ok(i.markdown.includes('STARTED TEXT'));
  assert.ok(!i.markdown.includes('DRAFT ONLY'));
});

test('resolve: a Ready feature that is archived is archived; Ready in another scope is wrong_scope', async () => {
  const arch = readyFeature({ title: 'Ready but archived' });
  updateFeature(arch.seq, { status: 'archived' });
  const other = readyFeature({ title: 'Ready elsewhere' });
  const { items } = await resolveAttachments([arch.seq, other.seq], { withMarkdown: true, scope: { type: 'project', key: 'else' } });
  assert.deepEqual(items.map((i) => i.status), ['archived', 'wrong_scope']);
  assert.ok(items.every((i) => i.markdown === null));
});

test('resolve: attaching writes no start row and no turn', async () => {
  const f = readyFeature({ title: 'Untouched' });
  const before = [listStarts(f.seq).length, listTurns(f.seq).length];
  await resolveAttachments([f.seq], { withMarkdown: true, scope: { type: 'project', key: projKey } });
  await searchFeatures({ scopeType: 'project', scopeKey: projKey });
  assert.deepEqual([listStarts(f.seq).length, listTurns(f.seq).length], before);
});

test('unavailableRefusal: not_ready is a 409 REQUIREMENTS_UNAVAILABLE with reason "not Ready"', () => {
  const r = unavailableRefusal([{ seq: 4, id: 'FEAT-4', title: 't', status: 'not_ready' }]);
  assert.equal(r.refusal.status, 409);
  assert.equal(r.refusal.body.code, 'REQUIREMENTS_UNAVAILABLE');
  assert.equal(r.refusal.body.features[0].reason, 'not Ready');
  assert.equal(r.refusal.body.error, 'Remove FEAT-4 "t" (not Ready) to continue.');
});

test('resolve: no markdown unless asked; dedupes; bad seq and limit', async () => {
  const f = make('Dup'); start(f);
  const { items } = await resolveAttachments([f.seq, `FEAT-${f.seq}`, String(f.seq)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].markdown, null);
  await assert.rejects(() => resolveAttachments(['nope']), (e) => e.code === 'BAD_REQUEST');
  const many = Array.from({ length: MAX_ATTACHED + 1 }, (_, i) => i + 1);
  await assert.rejects(() => resolveAttachments(many), (e) => e.code === 'BAD_REQUEST' && e.data.code === 'REQUIREMENTS_LIMIT' && /up to 10/.test(e.message));
  assert.equal((await resolveAttachments(many.slice(0, MAX_ATTACHED))).items.length, MAX_ATTACHED);
});

test('resolve: scope mismatch is wrong_scope; workspace needs same type', async () => {
  const p = make('Proj feat', 'project', 'shop'); start(p);
  const w = make('Ws feat', 'workspace', 'shop'); start(w);
  const proj = await resolveAttachments([p.seq, w.seq], { scope: { type: 'project', key: 'shop' } });
  assert.deepEqual(proj.items.map((i) => i.status), ['ok', 'wrong_scope']);
  const ws = await resolveAttachments([p.seq, w.seq], { scope: { type: 'workspace', key: 'shop' } });
  assert.deepEqual(ws.items.map((i) => i.status), ['wrong_scope', 'ok']);
  const other = await resolveAttachments([p.seq], { scope: { type: 'project', key: 'else' } });
  assert.equal(other.items[0].status, 'wrong_scope');
});

test('resolve: liveRunId only with runSummary', async () => {
  const f = make('Live'); const s = start(f);
  const live = await resolveAttachments([f.seq], { runSummary: async () => ({ status: 'running' }) });
  assert.equal(live.items[0].liveRunId, s.runId);
  const idle = await resolveAttachments([f.seq], { runSummary: async () => ({ status: 'completed' }) });
  assert.equal(idle.items[0].liveRunId, null);
});

test('search: scope, archived, exclude, q, sort, startable', async () => {
  const sc = 'srch';
  const a = make('Alpha login', 'project', sc); start(a, { ready: false });
  const b = make('Beta login', 'project', sc); start(b, { ready: true });
  const c = make('Gamma login', 'project', sc);
  const d = make('Delta login', 'project', sc); start(d, { ready: true });
  const gone = make('Archived login', 'project', sc); start(gone); updateFeature(gone.seq, { status: 'archived' });
  const foreign = make('Foreign login', 'workspace', sc); start(foreign);
  const base = { scopeType: 'project', scopeKey: sc };
  const all = (await searchFeatures({ ...base, q: '' })).features;
  assert.deepEqual(all.map((x) => x.seq), [d.seq, b.seq, a.seq, c.seq]);   // ready (seq desc), started-not-ready, not started
  const row = Object.fromEntries(all.map((x) => [x.seq, x]));
  assert.equal(row[c.seq].startable, false);
  assert.equal(row[c.seq].label, 'Not Ready yet');
  assert.equal(row[c.seq].current, false);
  assert.equal(row[c.seq].criteriaCount, null);
  assert.equal(row[c.seq].ready, false);
  assert.equal(row[b.seq].startable, true);
  assert.equal(row[b.seq].label, null);
  assert.equal(row[b.seq].criteriaCount, 2);
  assert.equal(row[b.seq].id, `FEAT-${b.seq}`);
  assert.deepEqual((await searchFeatures({ ...base, exclude: [b.seq, `FEAT-${d.seq}`] })).features.map((x) => x.seq), [a.seq, c.seq]);
  assert.deepEqual((await searchFeatures({ ...base, q: 'GAMMA' })).features.map((x) => x.seq), [c.seq]);
  assert.deepEqual((await searchFeatures({ ...base, q: `FEAT-${a.seq}` })).features.map((x) => x.seq), [a.seq]);
  assert.deepEqual((await searchFeatures({ ...base, q: String(a.seq) })).features.map((x) => x.seq).includes(a.seq), true);
  assert.equal((await searchFeatures({ ...base, limit: 2 })).features.length, 2);
  assert.deepEqual((await searchFeatures({ scopeType: 'workspace', scopeKey: sc })).features.map((x) => x.seq), [foreign.seq]);
});

test('search: Ready never started is attachable and sorts with the Ready group; not Ready never started is last', async () => {
  const base = { scopeType: 'project', scopeKey: projKey };
  const startedReady = readyFeature({ title: 'S1 started ready' }); start(startedReady, { ready: true });
  const startedNot = readyFeature({ title: 'S2 started not ready' }); start(startedNot, { ready: false });
  updateFeature(startedNot.seq, { spec: { ...readySpec(), openQuestions: ['?'] } });
  const fresh = readyFeature({ title: 'S3 ready fresh', spec: readySpec('a', 'b', 'c', 'd') });
  const draft = createFeature({ ...base, title: 'S4 draft', description: 'd' });
  const gone = readyFeature({ title: 'S5 ready archived' }); updateFeature(gone.seq, { status: 'archived' });
  const all = (await searchFeatures({ ...base, q: 'S' })).features.filter((x) => /^S\d/.test(x.title));
  assert.deepEqual(all.map((x) => x.seq), [fresh.seq, startedReady.seq, startedNot.seq, draft.seq]);
  const row = Object.fromEntries(all.map((x) => [x.seq, x]));
  assert.deepEqual([row[fresh.seq].startable, row[fresh.seq].ready, row[fresh.seq].label, row[fresh.seq].current, row[fresh.seq].criteriaCount],
    [true, true, null, true, 4]);
  assert.deepEqual([row[draft.seq].startable, row[draft.seq].ready, row[draft.seq].label, row[draft.seq].current, row[draft.seq].criteriaCount],
    [false, false, 'Not Ready yet', false, null]);
  assert.deepEqual([row[startedNot.seq].startable, row[startedNot.seq].ready, row[startedNot.seq].current], [true, false, false]);
  assert.deepEqual((await searchFeatures({ ...base, q: 'S', exclude: [fresh.seq] })).features.map((x) => x.seq).includes(fresh.seq), false);
  assert.deepEqual((await searchFeatures({ ...base, q: 'ready fresh' })).features.map((x) => x.seq), [fresh.seq]);
});

test('search: a bad scope rejects with BAD_REQUEST', async () => {
  await assert.rejects(() => searchFeatures({ scopeType: 'team', scopeKey: 'x' }), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(() => searchFeatures({ scopeType: 'project', scopeKey: ' ' }), (e) => e.code === 'BAD_REQUEST');
});

test('composeAttachedPrompt is pure and exact', () => {
  const items = [{ markdown: 'M1\n' }, { markdown: 'M2\n' }];
  assert.equal(composeAttachedPrompt(items, 'Do it'), 'Do it\n\n## Attached requirements\n\nM1\n\nM2\n');
  assert.equal(composeAttachedPrompt(items, undefined), '\n\n## Attached requirements\n\nM1\n\nM2\n');
  assert.equal(composeAttachedPrompt([], 'x'), 'x\n\n## Attached requirements\n\n');
  assert.equal(items.length, 2);
});
