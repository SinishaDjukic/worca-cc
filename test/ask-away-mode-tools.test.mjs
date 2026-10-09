// test/ask-away-mode-tools.test.mjs — Ask Worca's Away mode tools: get_away_mode reads it in the
// user's words (the Settings card's own summary lines), with a run line when asked about a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { createAwayReader } from '../src/core/ask/away-deps.mjs';
import { resolveNightConfig } from '../src/core/night/config.mjs';
import { describeAwayMode } from '../src/shared/away-mode/describe.mjs';
import { checkRows } from './helpers/rows.mjs';

const T15 = Date.parse('2026-09-28T15:00:00Z');
const USER = { window: '22:00-07:00', timeZone: 'UTC' };
const reader = (o = {}) => createAwayReader({
  userLayer: () => USER, toggle: () => 'auto', now: () => T15,
  effective: (dir) => resolveNightConfig({ user: USER, project: dir === '/p/shop' ? { enabled: true } : null }),
  projects: async () => [{ key: 'shop-1', name: 'Shop', path: '/p/shop' }], ...o,
});

test('get_away_mode: Settings-card summary lines, "I\'m here" inside the hours, a project\'s layers by key', async () => {
  await checkRows([
    { name: 'get_away_mode returns the same summary lines the Settings card shows', run: async () => {
      const out = await reader()({});
      const card = describeAwayMode({ config: resolveNightConfig({ user: USER }).config, toggle: 'auto', now: T15 });
      assert.deepEqual(out.summary, card.lines);
      assert.equal(out.status, 'here');
      assert.equal(out.sources.window, 'user');
    } },
    { name: 'get_away_mode reads "I\'m here" said inside the away hours', run: async () => {
      const T23 = Date.parse('2026-09-28T23:30:00Z');
      const out = await reader({ now: () => T23, hereSince: () => T23 - 30 * 60_000 })({});
      assert.equal(out.status, 'here-now');
      assert.match(out.summary[0], /You count as here because you said "I'm back"/);
    } },
    { name: 'a project key reads that project\'s layers and names it', run: async () => {
      const out = await reader()({ projectKey: 'shop-1' });
      assert.match(out.summary[0], /^For Shop: /);
      assert.equal(out.summary[1], 'From 22:00 to 07:00, worca answers questions on all runs. (this project)');
      assert.equal(out.config.enabled, true);
      await assert.rejects(reader()({ projectKey: 'nope' }), /unknown project "nope"/);
    } },
  ]);
});

test('the run line: live, finished, paused, and a live run this process cannot see', async () => {
  const live = { status: 'running', projectDir: null, night: { optIn: true, override: 'auto', decisions: 0, flagged: 0, openedAt: '2026-09-28T15:00:00.000Z' } };
  assert.deepEqual((await reader()({ live })).run, { state: 'after', pill: 'answers after 30 min', reason: 'A marked run is answered by day once a question has waited long enough.', answersAfterMin: 30 });
  assert.equal((await reader()({ row: { status: 'done', project_key: 'shop-1' } })).run.state, 'never');
  assert.equal((await reader()({ row: { status: 'paused', project_key: 'shop-1' } })).run.state, 'wait');
  assert.equal((await reader()({ live: { status: null, night: null } })).run.state, 'unknown');
  assert.equal((await reader()({ live: { ...live, status: 'paused' } })).run.state, 'wait', 'a paused live run waits, never "answers after"');
  assert.equal((await reader()({ row: { status: 'interrupted', project_key: 'shop-1' } })).run.state, 'wait');
  const waitingKind = { ...live, waiting: true, night: { ...live.night, openedAt: null } };
  assert.equal((await reader()({ live: waitingKind })).run.pill, 'waiting for you', 'an always-wait question never counts down');
});

test('the tool: validates, resolves the run, prefers the live reader, and is unavailable without deps', async () => {
  const calls = [];
  const rows = { aaaa0001: { id: 'aaaa0001', status: 'done', project_key: 'shop-1' } };
  const base = { limits: ASK_LIMITS, lookupPipelineRow: (_k, id) => rows[id] || null, findPipelineRowById: (id) => rows[id] || null };
  const tools = createAskTools({ ...base, away: { read: async (a) => { calls.push(a); return { summary: ['x'], status: 'here', config: {}, sources: {} }; } },
    readLiveNight: (id) => (id === 'bbbb0002' ? { status: 'running', night: null } : null) });
  await tools.call('get_away_mode', { runId: 'aaaa0001' });
  assert.equal(calls.at(-1).row.id, 'aaaa0001');
  await tools.call('get_away_mode', { runId: 'bbbb0002' });
  assert.equal(calls.at(-1).live.status, 'running');
  await assert.rejects(tools.call('get_away_mode', { runId: 'zzzz9999' }), /get_away_mode: run not found/);
  await assert.rejects(createAskTools(base).call('get_away_mode', {}), (e) => e instanceof AskToolError && /get_away_mode: unavailable/.test(e.message));
});

test('away writers: set_away_now mapping, set_run_away_mode run resolution/refusal, propose_away_mode_change validation + pin', async () => {
  await checkRows([
    // Task 10: the two live switches. The child validates only; the parent applies.
    { name: 'set_away_now: away | back | pause map to the toggle; anything else is an AskToolError', run: async () => {
      const tools = createAskTools({ limits: ASK_LIMITS });
      assert.deepEqual(await tools.call('set_away_now', { mode: 'away' }), { ok: true, requested: { kind: 'global', toggle: 'on' } });
      assert.deepEqual(await tools.call('set_away_now', { mode: 'back' }), { ok: true, requested: { kind: 'global', toggle: 'here' } }, '"back" = here, even inside the away hours');
      assert.deepEqual(await tools.call('set_away_now', { mode: 'pause' }), { ok: true, requested: { kind: 'global', toggle: 'off' } });
      await assert.rejects(tools.call('set_away_now', { mode: 'later' }), (e) => e instanceof AskToolError && /"away", "back" or "pause"/.test(e.message));
    } },
    { name: 'set_run_away_mode: resolves the run, refuses a finished one to the model, passes a live UUID through', run: async () => {
      const rows = { aaaa0001: { id: 'aaaa0001', status: 'done' }, dddd0004: { id: 'dddd0004', status: 'paused' } };
      const tools = createAskTools({ limits: ASK_LIMITS, lookupPipelineRow: (_k, id) => rows[id] || null, findPipelineRowById: (id) => rows[id] || null,
        readLiveNight: (id) => (id === 'cccc0003' ? { status: 'running', night: null } : null) });
      assert.deepEqual(await tools.call('set_run_away_mode', { runId: 'aaaa0001', mode: 'on' }),
        { ok: false, error: 'the run is done', requested: { kind: 'run', runId: 'aaaa0001', status: 'done', mode: 'on' } });
      assert.deepEqual(await tools.call('set_run_away_mode', { runId: 'dddd0004', mode: 'off' }),
        { ok: true, requested: { kind: 'run', runId: 'dddd0004', status: 'paused', mode: 'off' } });
      assert.deepEqual(await tools.call('set_run_away_mode', { runId: 'cccc0003', mode: 'auto' }),
        { ok: true, requested: { kind: 'run', runId: 'cccc0003', status: 'running', mode: 'auto' } });
      const uuid = '12345678-1234-1234-1234-123456789abc';
      assert.deepEqual(await tools.call('set_run_away_mode', { runId: uuid, mode: 'on' }), { ok: true, requested: { kind: 'run', runId: uuid, mode: 'on' } });
      await assert.rejects(tools.call('set_run_away_mode', { runId: 'eeee0005', mode: 'on' }), /set_run_away_mode: run not found/);
      await assert.rejects(tools.call('set_run_away_mode', { runId: 'aaaa0001', mode: 'maybe' }), /"auto", "on" or "off"/);
    } },
    // Task 11: the stored-settings card. The child validates; the parent re-validates and mints the card.
    { name: 'propose_away_mode_change: validates through deps, fills the pinned project, unavailable without deps', run: async () => {
      const seen = [];
      const tools = createAskTools({ limits: ASK_LIMITS, pinnedScope: () => ({ projectKey: 'shop-1' }),
        away: { validateChange: async (i) => { seen.push(i); return { ok: true, card: { type: 'away' } }; } } });
      assert.deepEqual(await tools.call('propose_away_mode_change', { level: 'project', set: { enabled: true } }), { ok: true, card: { type: 'away' } });
      assert.equal(seen[0].projectKey, 'shop-1', 'the pinned project');
      await tools.call('propose_away_mode_change', { level: 'user', set: { enabled: true } });
      assert.equal(seen[1].projectKey, undefined, 'user level: no project');
      await assert.rejects(createAskTools({ limits: ASK_LIMITS }).call('propose_away_mode_change', { level: 'user' }), /propose_away_mode_change: unavailable/);
    } },
  ]);
});
