// test/shape-classic-walk-golden.test.mjs — Shaper small runs D4: the classic Shaper flow (no small-runs marker) from start
// through 3 slices to Ship (one PR) is dev's. The walk drives the server over HTTP with the mock engine; only the ship's
// gh/git calls are stubbed. Its normalized projection equals the fixture with the flag off, and, minus the two
// featureView keys the flag adds on purpose (care, requirementKinds: test/shape-small-runs.test.mjs), also when the flag
// is turned on right after the start, so the feature carries no marker.
//
// The fixture was generated ONCE, from a `git archive` of dev's merge base (which has no shaperSmallRuns at all), never
// from this tree:
//   D=$(mktemp -d "$TMPDIR/classic.XXXXXX"); git archive a0a3730bb | tar -x -C "$D"
//   ln -s "$PWD/node_modules" "$D/node_modules"; cp test/shape-classic-walk-golden.test.mjs "$D/test/"
//   mkdir -p "$D/test/fixtures/shaper"
//   (cd "$D" && UPDATE_CLASSIC_WALK_GOLDEN=1 node --test --test-name-pattern "classic flow, flag off" test/shape-classic-walk-golden.test.mjs)
//   cp "$D/test/fixtures/shaper/classic-walk-golden.json" test/fixtures/shaper/
// Do NOT regenerate it on a later tree: it is the proof that the classic flow never moved. So this file imports only
// what exists at that checkpoint, and sets the flag through the environment only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { ghCalls, git, stubShip, withShip } from './helpers/ship-world.mjs';

const FIXTURE = new URL('./fixtures/shaper/classic-walk-golden.json', import.meta.url);
const CAPTURED_AT = 'a0a3730bb';
const UPDATE = process.env.UPDATE_CLASSIC_WALK_GOLDEN === '1';

useTempHome(after, 'worca-classic-walk-');
// HOME is sandboxed before any src/core import (settings live under HOME), so the run keeps its Clarify questions.
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_FLAGS'];
const prevEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const sandboxHome = mkdtempSync(join(tmpdir(), 'worca-classic-walk-home-'));
Object.assign(process.env, { HOME: sandboxHome, USERPROFILE: sandboxHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_MOCK: '1' });
delete process.env.WORCA_FLAGS;

const { getDb } = await import('../src/core/db.mjs');
const { featureOfPipeline, featureView } = await import('../src/core/shape/features.mjs');
const cardModels = await import('../ui/public/shape/feature-card.mjs');

let srv, base, runs, schedulerTick;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const get = async (p) => { const r = await fetch(`${base}${p}`); const t = await r.text(); assert.equal(r.status, 200, `${p}: ${t}`); return JSON.parse(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const mod = await import('../ui/server.mjs');
  ({ runs, schedulerTick } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  for (const e of runs?.values() || []) {
    if (e?.orch?.stop && !SETTLED.has(String(e.status))) { try { await e.orch.stop(); } catch { /* best effort */ } }
  }
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { setTimeout(r, 500).unref?.(); })]);
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SETTLED = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
const askName = (q) => (q.kind === 'plan' ? (q.plan?.outline ? 'outline' : q.plan?.criteria ? 'requirements' : 'plan') : q.kind);

/** Answer every ask of one run (a plan ask is approved, any other gets no answers) until it settles. → its ask kinds. */
async function driveRun(runId, ms = 90_000) {
  const asked = [];
  const answered = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    // `settled`: its teardown (the run's commit included) is over, which comes after the status.
    if (e && e.settled && SETTLED.has(String(e.status))) { assert.equal(e.status, 'done', `${runId}: ${e.pauseReason || ''} ${e.pauseDetail || ''}`); return asked; }
    const q = e?.pendingQuestion;
    if (q && !answered.has(q.id)) {
      answered.add(q.id);
      asked.push(askName(q));
      const r = q.kind === 'plan' ? await post(`/api/runs/${runId}/answer`, { id: q.id, decision: 'approve' })
        : await post('/api/answer', { runId, id: q.id, payload: { answers: [] } });
      assert.equal(r.status, 200, await r.text());
    }
    await sleep(25);
  }
  throw new Error(`run ${runId} never settled (asked ${asked.join(', ')})`);
}

const parse = (t) => JSON.parse(t || 'null');
const branchOf = (pid) => parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid)?.branch)?.feature;
const sliceRow = (fid, k) => getDb().prepare('SELECT ticket_id, pipeline_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(fid, k);
const ticketRow = (id) => getDb().prepare('SELECT status, pipeline_id, fail_reason FROM scheduled_runs WHERE id = ?').get(id);

/** Tick until slice k's ticket fired, then drive its run to done. → { pid, ticket, asked } */
async function fireSlice(fid, k) {
  const ticket = sliceRow(fid, k).ticket_id;
  const t0 = Date.now();
  while (!(runs.get(ticket) && ticketRow(ticket).status === 'fired')) {
    assert.ok(Date.now() - t0 < 60_000, `slice ${k} never fired: ${JSON.stringify(ticketRow(ticket))}`);
    await schedulerTick();
    await sleep(25);
  }
  const asked = await driveRun(ticket);
  return { pid: ticketRow(ticket).pipeline_id, ticket, asked };
}

/** Every value normalized: the walk's ids, branches and folders become tokens, times, costs and durations placeholders. */
function normalizer(tokens) {
  const pairs = tokens.filter(([from]) => from).sort((a, b) => b[0].length - a[0].length);
  const text = (s) => {
    let t = s;
    for (const [from, to] of pairs) t = t.split(from).join(to);
    return t.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?/g, 'TIME').replace(/\$\d+(\.\d+)?/g, 'COST')
      .replace(/\b\d+(\.\d+)?\s?(ms|s|m|min|h)\b/g, 'DURATION');
  };
  const walkValue = (v, key) => {
    if (typeof v === 'string') return text(v);
    if (typeof v === 'number' && /cost|usd/i.test(key)) return 'COST';
    if (typeof v === 'number' && /ms$|^at$|time/i.test(key)) return 'TIME';
    if (Array.isArray(v)) return v.map((x) => walkValue(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walkValue(x, /cost|usd/i.test(key) ? key : k)]));
    return v;
  };
  return (v) => walkValue(JSON.parse(JSON.stringify(v)), '');
}

/** The classic flow over HTTP: start, 3 slices, Ship as one PR. → its projection. With `flagOnAfterStart` the flag goes
 *  on once the run was created (its planning run is not marked), and stays on to the end. */
const walk = ({ flagOnAfterStart = false } = {}) => withEnv({ WORCA_FLAGS: undefined }, async () => {
  const dir = gitDir('classic-walk');
  git(dir, 'branch', '-M', 'main');   // gitDir takes the host's default branch; the golden holds main
  try {
    git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
    const r = await post('/api/run', { prompt: 'Plan this in 3 slices: charts', projectDir: dir, shape: { perspectives: ['product'] } });
    const started = await r.text();
    assert.equal(r.status, 200, started);
    if (flagOnAfterStart) process.env.WORCA_FLAGS = 'shaperSmallRuns';
    const { runId } = JSON.parse(started);
    const asked = [await driveRun(runId)];
    const p1 = runs.get(runId).pipelineId;
    const stats = parse(getDb().prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(p1).shape_stats);
    assert.ok(stats && !('smallRuns' in stats), 'the planning run carries no small-runs marker');
    const fid = featureOfPipeline(p1)?.featureId;
    assert.ok(fid, 'the split created the feature');
    const s2 = await fireSlice(fid, 2); asked.push(s2.asked);
    const s3 = await fireSlice(fid, 3); asked.push(s3.asked);
    const pids = [p1, s2.pid, s3.pid];
    const branches = pids.map(branchOf);
    assert.equal(new Set(branches).size, 3, branches.join(', '));
    const viewKeys = () => { const v = featureView(fid); return { view: Object.keys(v), slice: v.slices.map((s) => Object.keys(s)), ship: Object.keys(v.ship) }; };
    const cardOf = async () => {
      const card = await get(`/api/shape/pipelines/${p1}/card`);
      const model = cardModels.featureCardModel({ card });
      // The one card draws marked features only (the export does not exist at the checkpoint).
      assert.equal(cardModels.oneCardModel ? cardModels.oneCardModel({ card }) : null, null);
      return { cardKeys: Object.keys(card), keys: Object.keys(model), model, words: card.feature.slices.map((s) => cardModels.SLICE_STATE_LABELS[s.state]) };
    };
    const groupOf = async () => (await get('/api/run-groups')).groups.find((g) => g.id === fid);
    const built = { view: viewKeys(), card: await cardOf(), group: await groupOf(), readiness: featureView(fid).ship.ready };
    const slice = [];
    for (const pid of pids) slice.push(Object.keys(await get(`/api/shape/pipelines/${pid}/slice`)));
    const seen = [];
    let answer;
    await withShip(async () => {
      stubShip(seen);
      const s = await post(`/api/shape/features/${fid}/ship`, { mode: 'one' });
      answer = { status: s.status, body: await s.json() };
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(ghCalls(seen, 'create').length, 1, 'one PR');
    assert.equal(git(dir, 'remote'), '', 'nothing reaches a real remote');
    assert.equal(git(dir, 'for-each-ref', 'refs/remotes'), '');
    const shipped = { view: viewKeys(), card: await cardOf(), group: await groupOf(), ship: featureView(fid).ship };
    for (const x of [built, shipped]) assert.ok(!('smallRuns' in x.group), 'an unmarked run group has no smallRuns key');
    assert.ok(!('smallRuns' in shipped.ship), 'an unmarked feature has no ship.smallRuns');
    const normalize = normalizer([[fid, 'F1'], [runId, 'R1'], ...pids.map((p, i) => [p, `P${i + 1}`]), ...branches.map((b, i) => [b, `BRANCH${i + 1}`]),
      [s2.ticket, 'T2'], [s3.ticket, 'T3'], [realpathSync(dir), 'DIR'], [dir, 'DIR'],
      [featureView(fid).projectKey, 'PROJECT']]);
    return normalize({ asked, built, slice, shipResponse: answer, gh: seen.filter((a) => a[0] === 'gh'), shipped,
      shipMode: getDb().prepare('SELECT ship_mode FROM shape_features WHERE id = ?').get(fid).ship_mode });
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

const golden = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

test('classic flow, flag off: start to Ship equals the golden', { timeout: 240_000 }, async () => {
  const got = await walk();
  if (UPDATE) {
    writeFileSync(FIXTURE, `${JSON.stringify({ checkpoint: CAPTURED_AT, walk: got }, null, 2)}\n`);
    return;
  }
  const want = golden();
  assert.equal(want.checkpoint, CAPTURED_AT, 'the golden is dev\'s, captured at the merge base');
  assert.deepEqual(got, want.walk);
});

test('flag on, no marker: the same walk equals the golden, care and requirementKinds aside', { timeout: 240_000, skip: UPDATE }, async () => {
  const got = await walk({ flagOnAfterStart: true });
  const added = ['care', 'requirementKinds'];
  for (const at of ['built', 'shipped']) {
    assert.deepEqual(got[at].view.view.filter((k) => added.includes(k)), added, 'the two keys the flag adds');
    got[at].view.view = got[at].view.view.filter((k) => !added.includes(k));
  }
  assert.deepEqual(got, golden().walk);
});
