// test/secrets-notice.test.mjs — the pending one-time message about secrets moved into the vault: the record's merge and
// id, the compare-and-delete acknowledgement, a malformed file, and the one wording both surfaces render.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATE_LOCK_FILE, NOTICE_FILE } from '../src/core/secrets/files.mjs';
import { acquireLock } from '../src/core/metrics/lock.mjs';
import { ackNotice, readNotice, recordMoveNotice } from '../src/core/secrets/notice.mjs';
import { keyName, mcpKeyName, noticeLines, pluginKeyName, settingsKeyName } from '../src/shared/secrets-notice.mjs';
import { CANARY } from './helpers/secret-literals.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-notice-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const newHome = () => mkdtempSync(join(ROOT, `h${++n}-`));
const POSIX = process.platform !== 'win32';
const KEYS = [{ store: 'settings', name: 'Provider key: openai' }, { store: 'proxy', name: 'Proxy login' }];

test('record, merge with a new id, compare-and-delete with a stale id, and a malformed file', async () => {
  const home = newHome();
  const a = recordMoveNotice({ home, backend: 'keychain', label: 'macOS Keychain', keys: KEYS, left: 0 });
  assert.match(a.id, /^[0-9a-f]{16}$/);
  if (POSIX) assert.equal(statSync(join(home, NOTICE_FILE)).mode & 0o777, 0o600);
  const b = recordMoveNotice({ home, backend: 'keychain', label: 'macOS Keychain', keys: [KEYS[1], { store: 'mcp', name: 'MCP set General, server github: GITHUB_TOKEN' }], left: 2 });
  assert.notEqual(b.id, a.id);
  assert.deepEqual(readNotice({ home }).keys.map((k) => k.name), ['Provider key: openai', 'Proxy login', 'MCP set General, server github: GITHUB_TOKEN']);
  assert.equal(readNotice({ home }).left, 2);
  assert.equal(await ackNotice({ home, id: a.id }), false, 'a stale id clears nothing');
  assert.ok(existsSync(join(home, NOTICE_FILE)));
  assert.equal(await ackNotice({ home, id: b.id }), true);
  assert.equal(readNotice({ home }), null);
  assert.equal(await ackNotice({ home, id: b.id }), false);
  for (const bad of ['{', JSON.stringify({ format: 2, id: 'a'.repeat(16), keys: [] }), JSON.stringify({ format: 1, id: 'x', keys: [] }),
    JSON.stringify({ format: 1, id: 'a'.repeat(16), keys: [{ store: 'nope', name: 'x' }] })]) {
    writeFileSync(join(home, NOTICE_FILE), bad);
    assert.equal(readNotice({ home }), null, bad);
  }
});

test('ack waits for a migration holding the lock: a notice it records in between survives the stale id', async () => {
  const home = newHome();
  const a = recordMoveNotice({ home, backend: 'fake', label: 'test store', keys: KEYS });
  const release = await acquireLock(join(home, MIGRATE_LOCK_FILE));
  const pending = ackNotice({ home, id: a.id });
  await new Promise((r) => setTimeout(r, 100));
  const b = recordMoveNotice({ home, backend: 'fake', label: 'test store', keys: [{ store: 'proxy', name: 'Proxy login' }] });
  await release();
  assert.equal(await pending, false, 'the read ran after the migration wrote its notice');
  assert.equal(readNotice({ home }).id, b.id);
  const held = await acquireLock(join(home, MIGRATE_LOCK_FILE));
  try {
    assert.equal(await ackNotice({ home, id: b.id, lockWaitMs: 100 }), false, 'a busy lock clears nothing');
    assert.equal(await ackNotice({ home, id: b.id, held: true }), true, 'a caller holding the lock acks at once');
  } finally { await held(); }
});

test('noticeLines: the CLI names every key and the label, holds no value; Settings omits the label and the action', () => {
  const notice = { id: 'a'.repeat(16), label: 'macOS Keychain', keys: [...KEYS, { store: 'plugin', name: pluginKeyName({ name: 'jira', profile: 'default', key: 'apiToken' }) }], left: 1 };
  const cli = noticeLines(notice, { surface: 'cli', settingsReachable: true });
  assert.deepEqual(cli, [
    'Worca moved 3 saved secrets into the vault. Its key is kept in macOS Keychain.',
    'These keys are now in the vault:',
    '  - Provider key: openai', '  - Proxy login', '  - Plugin jira, profile default: apiToken',
    '1 secret was left in the config file (too large, or saved for another Worca home).',
    'Run `worca secrets ack` to dismiss this message, or press Got it in Settings › About.',
  ]);
  assert.ok(!cli.join('\n').includes(CANARY));
  const settings = noticeLines(notice, { surface: 'settings' });
  assert.ok(!settings.join('\n').includes('macOS Keychain'), 'the Secrets row above shows the label');
  assert.ok(!settings.join('\n').includes('worca secrets ack'));
  assert.equal(settings[0], 'Worca moved 3 saved secrets into the vault.');
  const off = noticeLines(notice, { surface: 'cli', settingsReachable: false });
  assert.equal(off.at(-1), 'Run `worca secrets ack` to dismiss this message.');
  assert.equal(noticeLines({ ...notice, label: 'Key\u001b[2Jchain\n' })[0], 'Worca moved 3 saved secrets into the vault. Its key is kept in Key [2Jchain.', 'control characters in the label are spaced out');
  assert.ok(!off.join('\n').includes('Settings'));
});

test('key names: the D11 shapes, and control characters are dropped', () => {
  assert.equal(settingsKeyName({ path: ['providers', 'openai', 'apiKey'] }), 'Provider key: openai');
  assert.equal(settingsKeyName({ path: ['models', 0, 'upstream', 'apiKey'], modelId: 'gpt-4o' }), 'Model gpt-4o: upstream API key');
  assert.equal(settingsKeyName({ path: ['models', 1, 'env', 'OPENAI_API_KEY'], modelId: 'local' }), 'Model local: env OPENAI_API_KEY');
  assert.equal(mcpKeyName({ set: 'Default', server: 'catalog:github', key: 'GITHUB_TOKEN' }), 'MCP set Default, server github: GITHUB_TOKEN');
  assert.equal(pluginKeyName({ name: 'jira', profile: 'default', key: 'apiToken' }), 'Plugin jira, profile default: apiToken');
  assert.equal(keyName({ name: 'a\u0007b' }), 'a b');
});

test('the notice file holds names only, never a canary value', () => {
  const home = newHome();
  recordMoveNotice({ home, backend: 'fake', label: 'test store', keys: KEYS });
  assert.ok(!readFileSync(join(home, NOTICE_FILE), 'utf8').includes(CANARY));
});
