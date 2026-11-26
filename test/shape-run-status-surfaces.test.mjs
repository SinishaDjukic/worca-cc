// test/shape-run-status-surfaces.test.mjs — Shaper small runs s5 (R-qa-6, R-arch-1): one server state, four surfaces.
// The real 16-run feature (test/helpers/shape-sixteen-runs.mjs) is walked through six states, and the Chat card rows,
// the feature page rows, the Runs list member rows and the run page head must show the same word and mark for each run
// (test/helpers/shape-surfaces.mjs reads each from its real builder).
import { test, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { getTicket, predecessorState } from '../src/core/scheduler.mjs';
import { listRunGroups } from '../src/core/run-groups.mjs';
import { sliceGateState } from '../src/core/shape/features.mjs';
import { buildRunsModel, groupRow, renderRunsList } from '../ui/public/runs-list.mjs';
import { SIXTEEN_RUN_LINKS, startable } from './helpers/shape-sixteen-runs.mjs';
import { WALKED, walked, walkWorld, groupItem, cardStatus, pageStatus, sidebarStatus, runPageStatus, headRead, NOW } from './helpers/shape-surfaces.mjs';

useTempHome(after, 'worca-shape-surfaces-');
const trackDom = useDomRelease(afterEach);
const root = mkdtempSync(join(tmpdir(), 'worca-shape-surfaces-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

const ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const RUNS = SIXTEEN_RUN_LINKS.map((l) => l.run);
const NEXT = /^next( · small change run)?$/;
const doc = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
const sorted = (m) => [...m.keys()].sort((a, b) => a - b);

/** The three row surfaces carry data-mark; the run page head does not. */
const ROW_SURFACES = ['card', 'page', 'sidebar'];
/** The four surfaces' reads of one walked world: {card, page, sidebar, run}, each Map run → {word, dot, mark, text}. */
function surfaces(w) {
  const card = cardStatus(doc(), w.slices, w.snaps);
  const sidebar = sidebarStatus(doc(), w.group);
  const page = pageStatus(doc(), w.members);
  const d = doc();
  const run = new Map(w.members.map((m) => [m.position, runPageStatus(d, m, w.members)]));
  const out = { card, page, sidebar, run };
  for (const [name, m] of Object.entries(out)) assert.deepEqual(sorted(m), RUNS, `${w.name} ${name}: all 16 runs are read`);
  return out;
}
const isDone = (w, run) => w.slices.find((s) => s.index === run).state === 'done';
/** Every surface shows `word` for `run`; returns the four reads. */
function assertWordEverywhere(s, run, word, where) {
  for (const name of Object.keys(s)) assert.equal(s[name].get(run).word, word, `${where} ${name}: run ${run}'s word`);
}

test('R-qa-6 every walked state: the four surfaces agree on word and mark, with at most one next', () => withEnvVars(ON, () => {
  assert.deepEqual(WALKED.map((w) => w.name), ['none-done', 'some-done', 'going', 'stop-open', 'failed', 'held']);
  let compared = 0;
  for (const state of WALKED) {
    const w = walkWorld(root, state);
    const of = (run) => w.slices.find((x) => x.index === run).state;
    // The walk is as specified.
    if (state.name === 'none-done') assert.equal(of(1), 'running');
    if (state.name === 'some-done') for (const r of [1, 3, 11]) assert.equal(of(r), 'done', `run ${r}`);
    if (state.name === 'going') assert.equal(of(3), 'running');
    if (state.name === 'failed') { assert.equal(of(5), 'error'); assert.equal(of(6), 'running'); }
    const s = surfaces(w);
    for (const run of [5, 7, 9, 12]) assert.equal(typeof s.card.get(run).word, 'string', `${state.name}: run ${run} has a word`);
    for (const run of RUNS) {
      const want = s.card.get(run);
      const names = isDone(w, run) ? ROW_SURFACES : [...ROW_SURFACES, 'run'];   // done on the run page: D9, its own test
      // D12: a string word (empty included) is the shared word on every surface; a null word keeps dev's own words.
      const shared = typeof want.word === 'string';
      for (const name of names) {
        const got = s[name].get(run);
        const where = `${state.name} ${name}: run ${run}`;
        assert.equal(got.dot, want.dot, `${where} dot`);
        if (name !== 'run') assert.equal(got.mark, want.mark, `${where} mark`);
        if (shared) assert.equal(got.word, want.word, `${where} word`);
        else assert.ok(got.word, `${where}: a non-empty dev fallback`);
        compared++;
      }
    }
    for (const [name, m] of Object.entries(s)) {
      const next = [...m].filter(([, r]) => NEXT.test(r.word)).map(([run]) => run);
      assert.ok(next.length <= 1, `${state.name} ${name}: at most one next, got ${next}`);
      for (const run of next) assert.ok(m.get(run).dot.includes('is-ink-ring'), `${state.name} ${name}: next paints the ink ring`);
    }
    if (state.name === 'some-done') {
      for (const name of Object.keys(s)) {
        assert.equal(s[name].get(9).word, '', `some-done ${name}: run 9 is free without the turn`);
        assert.ok(s[name].get(9).dot.includes('is-grey-ring'), `some-done ${name}: run 9 grey ring (${s[name].get(9).dot})`);
        assert.match(s[name].get(2).word, NEXT, `some-done ${name}: run 2 has the turn`);
      }
      for (const name of ROW_SURFACES) assert.equal(s[name].get(9).mark, 'ring', `some-done ${name}: run 9 mark`);
    }
  }
  assert.ok(compared > 300, `compared ${compared} reads`);
}));

test('R-qa-8 busy (run 6 reviewing, run 2 waiting for you): run 9 reads next and run 7 "waits for run 2 (needs you), 6" on all four', () => withEnvVars(ON, () => {
  const s = surfaces(walkWorld(root, walked('failed')));
  assertWordEverywhere(s, 6, 'reviewing', 'busy');
  assertWordEverywhere(s, 2, 'waiting for you', 'busy');
  assertWordEverywhere(s, 9, 'next', 'busy');
  assertWordEverywhere(s, 7, 'waits for run 2 (needs you), 6', 'busy');
  for (const name of Object.keys(s)) {
    assert.ok(s[name].get(9).dot.includes('is-ink-ring'), `${name}: run 9`);
    assert.ok(s[name].get(7).dot.includes('is-grey-ring'), `${name}: run 7`);
  }
}));

test('R-arch-1 the same 16-run state: all four surface builders show run 12 as "waits for run 7, 10" with the same faint ring', () => withEnvVars(ON, () => {
  const s = surfaces(walkWorld(root, walked('stop-open')));
  assertWordEverywhere(s, 12, 'waits for run 7, 10', 'base');
  const dot = s.card.get(12).dot;
  assert.equal(dot, 'is-grey-ring');
  for (const name of Object.keys(s)) assert.equal(s[name].get(12).dot, dot, `${name}: the same faint ring`);
  for (const name of ROW_SURFACES) assert.equal(s[name].get(12).mark, 'faint', name);
}));

// Passes before the change: it reads the Chat card's words (already shared); the walk above carries them to all four.
test('R-qa-6 every not-started run\'s word matches the gate (R-arch-2)', () => withEnvVars(ON, () => {
  let checked = 0;
  for (const state of WALKED) {
    const w = walkWorld(root, state);
    const card = cardStatus(doc(), w.slices, w.snaps);
    const free = new Set(startable(w.fx));
    const rows = getDb().prepare('SELECT idx, ticket_id, pipeline_id FROM shape_feature_slices WHERE feature_id = ?').all(w.fx.featureId);
    const ref = (run) => { const r = rows.find((x) => x.idx === run); return r.ticket_id ? { kind: 'ticket', id: r.ticket_id } : { kind: 'pipeline', id: r.pipeline_id }; };
    for (const { run, dependsOn } of SIXTEEN_RUN_LINKS) {
      const sl = w.slices.find((x) => x.index === run);
      if (w.fx.pipelineOf(run) || !['planned', 'held'].includes(sl.state)) continue;
      const where = `${state.name}: run ${run}`;
      const word = card.get(run).word;
      const holds = dependsOn.filter((d) => { const p = predecessorState(ref(d), { policy: 'done' }); return p.state === 'waiting' || (p.state === 'bad' && ['stopped', 'error', 'interrupted'].includes(p.status)); }).sort((a, b) => a - b);
      assert.deepEqual(sl.waitsFor, holds, `${where} waitsFor`);
      if (free.has(run)) assert.ok(word === '' || NEXT.test(word), `${where} is startable, reads "${word}"`);
      if (sl.waitsFor.length) {
        assert.match(word, /^waits for run /, where);
        assert.ok(!free.has(run), `${where} waits, so the gate holds it`);
        assert.equal(sliceGateState(getTicket(w.fx.ticketOf(run)), { live: w.fx.live })?.state, 'waiting', `${where} gate`);
      }
      checked++;
    }
  }
  assert.ok(checked > 40, `walked ${checked} runs`);
}));

test('R-qa-9 held (owner direction): run 2 carries nextTurn in both payloads, no surface shows next, run 2 reads "after run 3" on the dashed ring', () => withEnvVars(ON, () => {
  const w = walkWorld(root, walked('held'));
  const turns = (list) => list.filter(([, sl]) => sl && sl.nextTurn).map(([run]) => run);
  assert.deepEqual(turns(w.slices.map((sl) => [sl.index, sl])), [2], 'featureView');
  assert.deepEqual(turns(w.raw.members.map((m) => [m.position, m.slice])), [2], 'listRunGroups');
  const s = surfaces(w);
  assertWordEverywhere(s, 2, 'after run 3', 'held');
  for (const [name, m] of Object.entries(s)) {
    assert.ok(m.get(2).dot.includes('is-dashed-ring'), `${name}: run 2 dashed ring (${m.get(2).dot})`);
    assert.deepEqual([...m].filter(([, r]) => /^next/.test(r.word)).map(([run]) => run), [], `${name}: no run reads next`);
  }
  for (const name of ROW_SURFACES) assert.equal(s[name].get(2).mark, 'after', name);
}));

test('D9 done runs: card, page and sidebar read done; the run page keeps dev\'s head and dot', () => withEnvVars(ON, () => {
  const w = walkWorld(root, walked('some-done'));
  const s = surfaces(w);
  for (const run of [1, 3, 11]) {
    for (const name of ROW_SURFACES) {
      assert.equal(s[name].get(run).word, 'done', `${name}: run ${run}`);
      assert.equal(s[name].get(run).mark, 'done', `${name}: run ${run}`);
      assert.equal(s[name].get(run).dot, s.card.get(run).dot, `${name}: run ${run} dot`);
    }
    const member = w.members.find((m) => m.position === run);
    const dev = headRead(doc(), member.model);
    assert.deepEqual(s.run.get(run), dev, `run ${run}: the run page head is dev's`);
    assert.notEqual(dev.word, 'done', 'the head keeps its ship line');
  }
}));

test('acceptance: with the flag off, a marked feature\'s Runs list member rows read as today, with no data-mark', () => withEnvVars(ON, async () => {
  const w = walkWorld(root, walked('stop-open'));
  await withEnvVars({ WORCA_FLAGS: undefined }, () => {
    const raw = listRunGroups({ live: w.fx.live }).find((g) => g.id === w.fx.featureId);
    assert.equal(raw.smallRuns, undefined, 'the server marks no group with the flag off');
    const group = groupItem(raw, { flag: false });
    assert.ok(group.members.every((m) => !m.slice && !m.snap));
    const host = doc().createElement('div');
    const history = group.members.filter((m) => m.pipelineId).map((m) => ({ id: m.pipelineId, projectKey: 'k', title: m.pipelineId, status: m.run.status, run: { status: m.run.status } }));
    host.append(...renderRunsList(host.ownerDocument, buildRunsModel({ history, groups: [group], toggled: new Map([[`chain:${group.id}`, true]]), now: NOW })));
    const items = [...host.querySelectorAll('.runs-members > .runs-item[data-level="member"]')];
    assert.equal(items.length, 16);
    assert.equal(host.querySelector('.runs-item[data-mark]'), null);
    assert.equal(host.querySelector('.runs-members.srows'), null, 'dev\'s member list');
    const row12 = items.find((i) => i.querySelector('.runs-row-title').textContent.startsWith('12 · '));
    const after = groupRow(group, { now: NOW }).members.find((m) => m.position === 12).run.ticket.after.index;
    assert.equal(row12.querySelector('.runs-row-sub').textContent, `Waiting · starts after run ${after}`);
  });
}));
