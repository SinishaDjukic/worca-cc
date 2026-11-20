// test/away-per-person.test.mjs
// B4: with WORCA_AWAY_PER_PERSON=1, "I'm here / I'm away" belongs to each signed-in person and a
// run follows its owner's (who last started or resumed it). Unset = the one instance-wide switch.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  setNightMode, setNightModeToggle, nightModeToggle, nightModeToggleFor, nightModeHereSinceFor,
  setPersonNightModeToggle, personAwayStatus, awayPeopleFile,
} from '../src/core/settings.mjs';
import { effectiveNightConfig } from '../src/core/night/effective.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);
let home; const prev = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_AWAY_PER_PERSON', 'WORCA_IDENTITY_HEADER', 'WORCA_MOCK'];
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-away-pp-'));
  for (const k of ENV) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
});
after(async () => {
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});
beforeEach(async () => {
  delete process.env.WORCA_AWAY_PER_PERSON;
  await setNightMode(null); await setNightModeToggle('auto');
  await rm(awayPeopleFile(), { force: true });
});

const ADA = 'ada@example.com';
const BOB = 'bob@example.com';

test('flag unset: per-person writes are refused and everyone follows the instance switch', async () => {
  assert.equal(await setPersonNightModeToggle(ADA, 'on'), false);
  assert.equal(existsSync(awayPeopleFile()), false);
  await setNightModeToggle('on');
  assert.equal(nightModeToggleFor(ADA), 'on');
  assert.equal(nightModeToggleFor(BOB), 'on');
  assert.equal(personAwayStatus(ADA), null);
});

test('flag on: two people are away and here at the same time; nobody in particular follows the instance', async () => {
  process.env.WORCA_AWAY_PER_PERSON = '1';
  const now = Date.parse('2026-10-06T10:00:00Z');
  assert.equal(await setPersonNightModeToggle(ADA, 'on'), true);
  assert.equal(await setPersonNightModeToggle(BOB.toUpperCase(), 'here', { now }), true);   // keys are lowercased
  assert.equal(nightModeToggleFor(ADA), 'on');
  assert.equal(nightModeToggleFor(BOB), 'auto');
  assert.equal(nightModeHereSinceFor(BOB), now);
  assert.equal(nightModeToggle(), 'auto', 'the instance switch is untouched');
  assert.equal(await setPersonNightModeToggle('local', 'on'), false, 'local is nobody in particular');
  await setNightModeToggle('off');
  assert.equal(nightModeToggleFor('carol@example.com'), 'off', 'no record of their own: the instance value');
  assert.equal(nightModeToggleFor(null), 'off');
  assert.equal(nightModeToggleFor(ADA), 'on', 'an own record wins over the instance value');
});

const stateOf = (orch) => orch._nightStateNow(effectiveNightConfig('/tmp/away-pp').config);

test('flag on: each run follows its owner (starter, else the person who last resumed it)', async () => {
  process.env.WORCA_AWAY_PER_PERSON = '1';
  await setNightMode({ enabled: true, window: null });
  await setPersonNightModeToggle(ADA, 'on');
  await setPersonNightModeToggle(BOB, 'off');
  const adaRun = createOrchestrator({ projectDir: '/tmp/away-pp', nightMode: true, startedBy: ADA });
  const bobRun = createOrchestrator({ projectDir: '/tmp/away-pp', nightMode: true, startedBy: BOB });
  assert.equal(stateOf(adaRun).active, true, "ada is away: worca may answer her run's questions");
  assert.equal(stateOf(bobRun).active, false, "bob is here: his run waits for him");
  assert.equal(adaRun.getState().night.owner, ADA);
  assert.equal(adaRun.getState().night.ownerToggle, 'on');
  // A run Bob resumed (saved in the resume point) follows Bob, not its starter.
  const resumed = createOrchestrator({ projectDir: '/tmp/away-pp', startedBy: ADA,
    resume: { row: { started_by: ADA, status: 'paused' }, resumePoint: { night: { optIn: true, override: 'auto', owner: BOB } } } });
  assert.equal(resumed.awayOwner(), BOB);
  assert.equal(stateOf(resumed).active, false);
  // A chat run ("ada via Slack") has no record: the instance default.
  await setNightModeToggle('on');
  const chat = createOrchestrator({ projectDir: '/tmp/away-pp', nightMode: true, startedBy: 'ada via Slack' });
  assert.equal(stateOf(chat).active, true);
});

test('flag unset: runs of different starters share the instance switch, and the snapshot shape is unchanged', async () => {
  await setNightMode({ enabled: true, window: null });
  await setNightModeToggle('on');
  const adaRun = createOrchestrator({ projectDir: '/tmp/away-pp', nightMode: true, startedBy: ADA });
  const bobRun = createOrchestrator({ projectDir: '/tmp/away-pp', nightMode: true, startedBy: BOB });
  assert.equal(stateOf(adaRun).active, true);
  assert.equal(stateOf(bobRun).active, true);
  assert.equal('owner' in adaRun.getState().night, false);
});

test('API: the toggle reads and writes the signed-in person\'s own switch only with the flag on', async () => {
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';   // a per-person sign-in (identity.mjs 'header')
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // X1: the in-process server's callers are loopback
  const mod = await import('../ui/server.mjs');
  const srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = async (method, path, who, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': who }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    // Flag off: one instance-wide switch, whoever sets it.
    assert.equal((await api('POST', '/api/settings', ADA, { nightModeToggle: 'on' })).status, 200);
    assert.equal((await api('GET', '/api/away-mode', BOB)).body.toggle, 'on');
    assert.equal((await api('GET', '/api/away-mode', BOB)).body.perPerson, undefined);
    await setNightModeToggle('auto');

    process.env.WORCA_AWAY_PER_PERSON = '1';
    assert.equal((await api('POST', '/api/settings', ADA, { nightModeToggle: 'on' })).status, 200);
    assert.equal((await api('POST', '/api/settings', BOB, { nightModeToggle: 'off' })).status, 200);
    const a = await api('GET', '/api/away-mode', ADA);
    const b = await api('GET', '/api/away-mode', BOB);
    assert.equal(a.body.toggle, 'on');
    assert.equal(a.body.perPerson, ADA);
    assert.equal(a.body.instanceToggle, 'auto');
    assert.equal(b.body.toggle, 'off');
    assert.equal((await api('GET', '/api/settings', ADA)).body.nightModeToggle, 'on');
    assert.equal((await api('GET', '/api/settings', BOB)).body.nightModeToggle, 'off');
    assert.equal(nightModeToggle(), 'auto', 'the instance switch is untouched');
    assert.equal((await api('POST', '/api/settings', ADA, { nightModeToggle: 'bogus' })).status, 400);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
