// test/run-context-guardrails.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProjectSettings } from '../src/core/run-context.mjs';

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-rcg-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

async function writeSettings(dir, obj) {
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(join(dir, '.claude', 'settings.json'),
    typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
}

test('discoverProjectSettings: parses the permissions key — DENY only (strings only), allow/ask dropped', async () => {
  const dir = await tmp();
  await writeSettings(dir, {
    permissions: { deny: ['Read(.env*)', 42], allow: ['Bash(npm:*)'], ask: ['Bash(rm:*)'] },
    hooks: { PreToolUse: [] },
  });
  const s = await discoverProjectSettings(dir);
  assert.deepEqual(s.keys, ['hooks', 'permissions']);
  // allow/ask are NOT lifted: user-scope --settings would apply them past the
  // workspace-trust gate and widen the run beyond --allowedTools.
  assert.deepEqual(s.permissions, { deny: ['Read(.env*)'] });
});

test('discoverProjectSettings: no/allow-only permissions -> null; unparseable -> keys null + permissions null', async () => {
  const a = await tmp();
  await writeSettings(a, { statusline: {} });
  assert.equal((await discoverProjectSettings(a)).permissions, null);
  const b = await tmp();
  await writeSettings(b, { permissions: { allow: ['Bash(npm:*)'], ask: [] } });
  assert.equal((await discoverProjectSettings(b)).permissions, null, 'allow/ask alone lift nothing');
  const c = await tmp();
  await writeSettings(c, '{ not json');
  const s = await discoverProjectSettings(c);
  assert.equal(s.keys, null);
  assert.equal(s.permissions, null);
});
