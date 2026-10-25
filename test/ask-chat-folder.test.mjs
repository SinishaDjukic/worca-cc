// test/ask-chat-folder.test.mjs — a locked-down chat's own folder under the shared scratch dir (ask/chat-folder.mjs):
// Goose and OpenCode chats no longer run in tmp/ask itself, where any agent user could plant code they load from their
// cwd, and no level of their folder may be one another user made first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatFolder } from '../src/core/ask/chat-folder.mjs';
import { chatDescriptor } from '../src/core/engines/chat.mjs';
import { buildAskSpawnOptions } from '../src/core/ask/spawn.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'uids and modes' : false };
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-chat-folder-')); dirs.push(d); return d; };
const mode = (p) => statSync(p).mode & 0o777;

test('Goose, OpenCode and Gemini chats run in a folder of their own; the others keep the scratch dir', () => {
  for (const engine of ['goose', 'opencode', 'gemini']) {
    assert.equal(chatDescriptor(engine).ownFolder, true, engine);
    const o = buildAskSpawnOptions({ thread: { id: 'ask_00000007' }, turn: { prompt: 'p' }, mcpConfigPath: '/s/mcp.json', scratchDir: '/s', engine });
    assert.equal(o.cwd, join('/s', engine, 'ask_00000007'), engine);
  }
});

test('chatFolder makes both levels with worca\'s modes and returns the chat\'s folder', POSIX, () => {
  const scratch = tmp();
  const dir = chatFolder(scratch, 'goose', 'ask_00000001');
  assert.equal(dir, join(scratch, 'goose', 'ask_00000001'));
  assert.equal(mode(join(scratch, 'goose')), 0o711, 'others pass through, never list or write');
  assert.equal(mode(dir), 0o700);
  assert.equal(chatFolder(scratch, 'goose', 'ask_00000001'), dir, 'the same folder every turn');
});

test('chatFolder refuses an engine folder another user linked elsewhere first, and writes nothing through it', POSIX, () => {
  const scratch = tmp(); const elsewhere = tmp();
  symlinkSync(elsewhere, join(scratch, 'opencode'));
  assert.throws(() => chatFolder(scratch, 'opencode', 'ask_00000002'), /not a folder worca made/);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test('chatFolder refuses a chat folder that is a link', POSIX, () => {
  const scratch = tmp(); const elsewhere = tmp();
  mkdirSync(join(scratch, 'goose'));
  symlinkSync(elsewhere, join(scratch, 'goose', 'ask_00000003'));
  assert.throws(() => chatFolder(scratch, 'goose', 'ask_00000003'), /not a folder worca made/);
});

test('chatFolder refuses a chat folder holding code goose or opencode would load', POSIX, () => {
  const scratch = tmp();
  mkdirSync(join(scratch, 'opencode', 'ask_00000004', '.opencode', 'plugin'), { recursive: true });
  assert.throws(() => chatFolder(scratch, 'opencode', 'ask_00000004'), /holds \.opencode/);
  mkdirSync(join(scratch, 'goose', 'ask_00000005', '.agents', 'plugins'), { recursive: true });
  assert.throws(() => chatFolder(scratch, 'goose', 'ask_00000005'), /holds \.agents/);
});

test('chatFolder refuses names that are not one path level', () => {
  for (const [engine, name] of [['goose', '../x'], ['goose', ''], ['../goose', 'ask_1'], ['goose', 'a/b']]) {
    assert.throws(() => chatFolder('/s', engine, name), /not a chat folder name/, `${engine}/${name}`);
  }
});
