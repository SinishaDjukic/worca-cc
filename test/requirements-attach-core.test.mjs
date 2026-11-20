// test/requirements-attach-core.test.mjs — resolveAttachments, searchFeatures, composeAttachedPrompt (FEAT-21 server core).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { createFeature, updateFeature, createStart } from '../src/core/requirements/store.mjs';
import { MAX_ATTACHED, resolveAttachments, searchFeatures, composeAttachedPrompt } from '../src/core/requirements/attach.mjs';

useTempHome(after, 'worca-req-attach-core-');

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
  assert.equal(by[unstarted.seq].status, 'not_started');
  assert.equal(by[unstarted.seq].markdown, null);
  assert.equal(by[unstarted.seq].version, null);
  assert.equal(by[arch.seq].status, 'archived');
  assert.equal(by[99999].status, 'missing');
  assert.equal(by[99999].title, null);
  assert.equal(by[ok.seq].liveRunId, null);
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
  assert.equal(row[c.seq].label, 'Not started yet');
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

test('composeAttachedPrompt is pure and exact', () => {
  const items = [{ markdown: 'M1\n' }, { markdown: 'M2\n' }];
  assert.equal(composeAttachedPrompt(items, 'Do it'), 'Do it\n\n## Attached requirements\n\nM1\n\nM2\n');
  assert.equal(composeAttachedPrompt(items, undefined), '\n\n## Attached requirements\n\nM1\n\nM2\n');
  assert.equal(composeAttachedPrompt([], 'x'), 'x\n\n## Attached requirements\n\n');
  assert.equal(items.length, 2);
});
