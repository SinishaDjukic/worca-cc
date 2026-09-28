// test/settings-ask-web.test.mjs
// The local Ask web settings (docs/guardrails.md "Web access"): off by default, normalized allowlist, a search
// endpoint whose key is only ever a ${VAR} reference, and an explicit off that survives a save.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { askWeb, setAskWeb, addAskWebHost, assertAskWebInput, readSettings, SETTINGS_POST_KEYS } from '../src/core/settings.mjs';

useTempHome(after);
let sandboxHome; let settingsPath; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-settings-ask-web-'));
  settingsPath = join(sandboxHome, '.worca-cc', 'settings.json');
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('askWeb defaults to off / empty / no search', () => {
  assert.deepEqual(askWeb(), { enabled: false, anyHost: false, allowedDomains: [], search: null });
});

test('setAskWeb validates, normalizes and persists', async () => {
  const r = await setAskWeb({ enabled: true, allowedDomains: ['Docs.Python.org', '*.mdn.io'], search: null });
  assert.deepEqual(r.askWeb, { enabled: true, anyHost: false, allowedDomains: ['docs.python.org', '*.mdn.io'], search: null });
  assert.deepEqual(readSettings().askWeb, { enabled: true, allowedDomains: ['docs.python.org', '*.mdn.io'] });
});

test('setAskWeb rejects bad input', () => {
  assert.throws(() => assertAskWebInput({ enabled: 'yes', allowedDomains: [] }), /askWeb.enabled must be true or false/);
  assert.throws(() => assertAskWebInput({ enabled: true, allowedDomains: ['not a host'] }), /"not a host" is not a host name/);
  assert.throws(() => assertAskWebInput({ enabled: true, allowedDomains: [], search: { url: 'http://s.example/?q={query}' } }), /https/);
  assert.throws(() => assertAskWebInput({ enabled: true, allowedDomains: [], search: { url: 'https://s.example/' } }), /\{query\}/);
  assert.throws(() => assertAskWebInput({ enabled: true, allowedDomains: [], search: { url: 'https://s.example/?q={query}', key: 'sk-literal' } }), /\$\{VAR\}/);
  assert.throws(() => assertAskWebInput({ enabled: true, allowedDomains: [], search: { url: 'https://s.example/?q={query}', key: '${ANTHROPIC_API_KEY}' } }), /reserved/);
});

test('an explicit off is stored (opts out of a team default); null clears back to unset', async () => {
  await setAskWeb({ enabled: false, anyHost: false, allowedDomains: [], search: null });
  assert.deepEqual(readSettings().askWeb, { enabled: false, allowedDomains: [] });
  await setAskWeb(null);
  assert.equal(readSettings().askWeb, undefined);
  assert.deepEqual(askWeb(), { enabled: false, anyHost: false, allowedDomains: [], search: null });
});

test('an invalid stored askWeb reads as off and never throws', async () => {
  await setAskWeb({ enabled: true, allowedDomains: ['a.com'], search: null });
  const raw = readSettings(); raw.askWeb.allowedDomains = ['not a host'];
  writeFileSync(settingsPath, JSON.stringify(raw));
  assert.deepEqual(askWeb(), { enabled: false, anyHost: false, allowedDomains: [], search: null });
  const warns = []; const orig = console.warn; console.warn = (m) => warns.push(m);
  try { askWeb(); askWeb(); } finally { console.warn = orig; }
  assert.equal(warns.length, 0, 'the same problem is warned about once, not on every read');
});

test('askWeb exposes keyVar, never a key value', async () => {
  await setAskWeb({ enabled: true, allowedDomains: ['a.com'], search: { url: 'https://api.search.brave.com/res/v1/web/search?q={query}', key: '${BRAVE_API_KEY}', keyHeader: 'X-Subscription-Token' } });
  assert.deepEqual(askWeb().search, { url: 'https://api.search.brave.com/res/v1/web/search?q={query}', key: '${BRAVE_API_KEY}', keyVar: 'BRAVE_API_KEY', keyHeader: 'X-Subscription-Token', keyPrefix: '' });
});

test('SETTINGS_POST_KEYS includes askWeb', () => assert.ok(SETTINGS_POST_KEYS.includes('askWeb')));

test('anyHost is an explicit opt-in, stored only when on', async () => {
  assert.throws(() => assertAskWebInput({ enabled: true, anyHost: 'yes', allowedDomains: [] }), /anyHost must be true or false/);
  const r = await setAskWeb({ enabled: true, anyHost: true, allowedDomains: [], search: null });
  assert.equal(r.askWeb.anyHost, true);
  assert.equal(readSettings().askWeb.anyHost, true);
  await setAskWeb({ enabled: true, allowedDomains: [], search: null });
  assert.equal(readSettings().askWeb.anyHost, undefined, 'absent = off');
});

test('addAskWebHost appends one exact host (the web card\'s "Always allow") and keeps the rest', async () => {
  await setAskWeb({ enabled: true, allowedDomains: ['a.com'], search: { url: 'https://s.example/?q={query}' } });
  const r = await addAskWebHost('Docs.B.org');
  assert.deepEqual(r.askWeb.allowedDomains, ['a.com', 'docs.b.org']);
  assert.equal(r.askWeb.search.url, 'https://s.example/?q={query}');
  await addAskWebHost('docs.b.org');
  assert.deepEqual(askWeb().allowedDomains, ['a.com', 'docs.b.org'], 'idempotent');
  await assert.rejects(() => addAskWebHost('*.b.org'), /exact host/);
});
