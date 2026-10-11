// test/ask-away-switch.test.mjs — the parent's half of set_away_now / set_run_away_mode
// (createAwaySwitch): it re-checks the child's request, writes the toggle or the run switch, and
// returns the chat line (wording §3.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAwaySwitch } from '../src/core/ask/away-deps.mjs';
import { resolveNightConfig } from '../src/core/night/config.mjs';
import { checkRows } from './helpers/rows.mjs';

const T15 = Date.parse('2026-09-28T15:00:00Z');
function setup({ now = T15 } = {}) {
  let toggle = 'auto'; let hereSince = null;
  const emitted = [];
  const live = { id: 'u1', projectDir: '/p', title: 'Fix login',
    orch: { state: { status: 'running', night: { optIn: true, override: 'auto' } },
      setNightOverride(m, by) { this.state.night.override = m; this.by = by; },
      nightConfigChanged() { this.changed = (this.changed || 0) + 1; } } };
  const done = { id: 'u2', projectDir: '/p', title: 'Old',
    orch: { state: { status: 'done', night: { optIn: false, override: 'auto' } },
      setNightOverride() { throw Object.assign(new Error('x'), { code: 'NIGHT_NOT_LIVE' }); }, nightConfigChanged() {} } };
  const runs = new Map([['u1', live], ['u2', done]]);
  const sw = createAwaySwitch({ liveRun: (id) => runs.get(id) || null, runs, emitChanged: (e) => emitted.push(e), now: () => now,
    setToggle: async (t, o) => { toggle = t === 'here' ? 'auto' : t; hereSince = t === 'here' ? o.now : null; }, readToggle: () => toggle, readHereSince: () => hereSince,
    userLayer: () => ({ window: '22:00-07:00', timeZone: 'UTC' }), effective: () => resolveNightConfig({}) });
  return { sw, live, emitted, toggle: () => toggle };
}

test('global switch: sets the toggle, tells every surface; "I\'m back" inside the hours counts as here', async () => {
  await checkRows([
    { name: 'global: sets the toggle, tells every surface and every run, and returns the new status line', run: async () => {
      const s = setup();
      const r = await s.sw({ kind: 'global', toggle: 'on' });
      assert.equal(r.ok, true);
      assert.equal(s.toggle(), 'on');
      assert.deepEqual(s.emitted, ['settings-changed']);
      assert.equal(s.live.orch.changed, 1);
      assert.match(r.line, /^Right now you count as away because you said "I'm away now"\./);
      assert.match(r.line, /until you click "I'm back" in Settings › Away mode\.$/, 'said in chat: the button is named where it is');
    } },
    { name: 'global "here" ("I\'m back") inside the away hours: counts as here until the next stretch', run: async () => {
      const s = setup({ now: Date.parse('2026-09-28T23:00:00Z') });
      await s.sw({ kind: 'global', toggle: 'on' });
      const r = await s.sw({ kind: 'global', toggle: 'here' });
      assert.equal(r.ok, true);
      // The zone is named only when it differs from this machine's (a UTC CI runner shows none).
      const tag = Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC' ? '' : ' UTC';
      assert.equal(r.line, `Right now it is 23:00${tag}. You count as here because you said "I'm back". Your away hours apply again from 22:00.`);
      assert.equal(s.live.orch.changed, 2, 'every run re-checks');
    } },
  ]);
});

test('run: sets the switch as the actor and says what happens now', async () => {
  const s = setup();
  assert.deepEqual(await s.sw({ kind: 'run', runId: 'u1', mode: 'off' }, { actor: 'mara' }), { ok: true, line: 'on run Fix login: never' });
  assert.equal(s.live.orch.by, 'mara');
  assert.deepEqual(await s.sw({ kind: 'run', runId: 'u1', mode: 'on' }), { ok: true, line: 'on run Fix login: answering now' });
});

test('run: a finished run, a missing run and a bogus request are refused, and nothing is written', async () => {
  const s = setup();
  assert.deepEqual(await s.sw({ kind: 'run', runId: 'u2', mode: 'on' }), { ok: false, error: 'the run is done' });
  assert.deepEqual(await s.sw({ kind: 'run', runId: 'aaaa0001', status: 'done', mode: 'on' }), { ok: false, error: 'the run is done' });
  assert.deepEqual(await s.sw({ kind: 'run', runId: 'nope' }), { ok: false, error: 'unknown mode "undefined"' });
  assert.deepEqual(await s.sw({ kind: 'run', runId: 'nope', mode: 'on' }), { ok: false, error: 'the run is not running on this machine' });
  const bad = await s.sw({ kind: 'global', toggle: 'bogus' });
  assert.equal(bad.ok, false);
  assert.equal(s.toggle(), 'auto');
  assert.deepEqual(s.emitted, []);
});
