// test/engine-sessions-archive.test.mjs
// Archiving a run removes its engine sessions, never the sign-in (catalog `sessions`,
// plans/core-protection-layer-design.md §4.4): every engine's store under a temp HOME holds two runs' sessions and a
// sign-in file; archiving run A removes A's sessions only, leaves B's and the sign-in byte-identical, and a store it
// cannot write is one warning while the archive completes.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { archivePipeline } from '../src/core/pipeline-delete.mjs';
import { removeRunSessions } from '../src/core/engines/index.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { ENGINE_NAMES, ENGINES } from '../src/shared/engine-switch.mjs';
import { gooseSessionsDb } from '../src/core/engines/goose.mjs';
import { removeSessionEntries } from '../src/core/engines/sessions.mjs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX file modes' } : {};
const UA = '11111111-1111-4111-8111-111111111111'; const UB = '22222222-2222-4222-8222-222222222222';
const VARS = ['HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'COPILOT_HOME', 'CURSOR_CONFIG_DIR', 'GEMINI_CLI_HOME', 'QWEN_HOME', 'GOOSE_PATH_ROOT', 'XDG_DATA_HOME'];
let saved; let home;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  home = mkdtempSync(join(tmpdir(), 'worca-sessions-'));
  process.env.HOME = home;
  for (const k of VARS.slice(1)) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { chmodSync(join(home, '.claude', 'projects', 'p'), 0o755); } catch { /* not made read-only */ }
  rmSync(home, { recursive: true, force: true });
});

const put = (p, data = 'x') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, data); return p; };

/** Two runs' sessions and the sign-in, per engine, in the stores the adapters read. */
function seedStores() {
  const managed = join(worcaHome(), 'engines', 'codex', 'homes', 'abc123');
  const f = {
    claude: { a: [put(join(home, '.claude', 'projects', 'p', `${UA}.jsonl`)), put(join(home, '.claude', 'projects', 'p', UA, 'tool-results', 't.txt'))],
      b: [put(join(home, '.claude', 'projects', 'p', `${UB}.jsonl`))], signIn: [put(join(home, '.claude', '.credentials.json'), 'secret-claude')] },
    codex: { a: [put(join(home, '.codex', 'sessions', '2026', '10', '22', `rollout-2026-10-22T10-00-00-${UA}.jsonl`)),
      put(join(managed, 'sessions', '2026', '10', '22', `rollout-2026-10-22T11-00-00-${UA}.jsonl`)), put(join(worcaHome(), 'engines', 'codex', 'usage', `${UA}.json`))],
      b: [put(join(home, '.codex', 'sessions', '2026', '10', '22', `rollout-2026-10-22T12-00-00-${UB}.jsonl`))],
      signIn: [put(join(home, '.codex', 'auth.json'), 'secret-codex'), put(join(managed, 'auth.json'), 'secret-codex-managed')] },
    copilot: { a: [put(join(home, '.copilot', 'session-state', UA, 'events.jsonl'))], b: [put(join(home, '.copilot', 'session-state', UB, 'events.jsonl'))],
      signIn: [put(join(home, '.copilot', 'config.json'), 'secret-copilot')] },
    cursor: { a: [put(join(home, '.cursor', 'chats', 'ws1', 'chat-a', 'store.db'))], b: [put(join(home, '.cursor', 'chats', 'ws1', 'chat-b', 'store.db'))],
      signIn: [put(join(home, '.cursor', 'cli-config.json'), 'secret-cursor')] },
    // Gemini names a chat by the id's first 8 characters and keeps the whole id inside it.
    gemini: { a: [put(join(home, '.gemini', 'tmp', 'proj', 'chats', `session-2026-10-22T10-00-${UA.slice(0, 8)}.json`), JSON.stringify({ sessionId: UA }))],
      b: [put(join(home, '.gemini', 'tmp', 'proj', 'chats', `session-2026-10-22T11-00-${UB.slice(0, 8)}.json`), JSON.stringify({ sessionId: UB }))],
      signIn: [put(join(home, '.gemini', 'oauth_creds.json'), 'secret-gemini'), put(join(home, '.gemini', 'google_accounts.json'), 'secret-gemini-accounts')] },
    qwen: { a: [put(join(home, '.qwen', 'projects', 'proj', 'chats', `${UA}.jsonl`)), put(join(home, '.qwen', 'tmp', 'proj', UA, 'checkpoint.json'))],
      b: [put(join(home, '.qwen', 'projects', 'proj', 'chats', `${UB}.jsonl`))], signIn: [put(join(home, '.qwen', 'oauth_creds.json'), 'secret-qwen')] },
    // Goose: rows of its own database (named by worca), checked by gooseHas.
    goose: { a: [], b: [], signIn: [put(join(home, '.config', 'goose', 'config.yaml'), 'GOOSE_PROVIDER: google\n')] },
  };
  const db = new DatabaseSync(put(gooseSessionsDb(process.env), ''));
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL); CREATE TABLE usage_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL)');
  for (const n of ['worca-run-a', 'worca-run-b']) db.prepare('INSERT INTO sessions VALUES (?, ?)').run(`id-${n}`, n);
  db.close();
  return f;
}
/** Whether goose's database still holds the session named `name`. */
const gooseHas = (name) => { const db = new DatabaseSync(gooseSessionsDb(process.env)); try { return !!db.prepare('SELECT 1 FROM sessions WHERE name = ?').get(name); } finally { db.close(); } };
const RUN_A = [UA, `codex:${UA}`, `copilot:${UA}`, 'cursor:chat-a', `gemini:${UA}`, `qwen:${UA}`, 'goose:worca-run-a'];

test('every engine that keeps sessions can remove them', () => {
  for (const e of ENGINE_NAMES) if (ENGINES[e].sessions !== 'none') assert.ok(ENGINES[e].sessions, e);
});

test('a session folder swapped for a link after the walk is not followed out of the store', POSIX, async () => {
  const store = mkdtempSync(join(tmpdir(), 'worca-store-'));
  const outside = mkdtempSync(join(tmpdir(), 'worca-outside-'));
  try {
    put(join(store, 'p', `${UA}.jsonl`));
    put(join(outside, `${UA}.jsonl`), 'keep');
    // The walk finds p/<id>.jsonl; before the removal, p becomes a link to a folder outside the store.
    const res = await removeSessionEntries(store, (n) => {
      if (n !== `${UA}.jsonl`) return false;
      renameSync(join(store, 'p'), join(store, 'p.old'));
      symlinkSync(outside, join(store, 'p'));
      return true;
    }, { depth: 1 });
    assert.equal(readFileSync(join(outside, `${UA}.jsonl`), 'utf8'), 'keep', 'the file outside the store survives');
    assert.deepEqual([res.removed.length, res.failed.length], [0, 1]);
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a Claude session id that is no uuid removes nothing (a project folder\'s name is not a session)', async () => {
  const f = seedStores();
  const res = await removeRunSessions({ sessionIds: ['p', 'projects', '.credentials.json'] });
  for (const p of [...f.claude.a, ...f.claude.b, ...f.claude.signIn]) assert.equal(existsSync(p), true, p);
  assert.deepEqual(res.find((r) => r.engine === 'claude')?.warnings ?? [], []);
});

test('archive removes this run\'s sessions only, and the sign-in files survive', async () => {
  const f = seedStores();
  const kept = ENGINE_NAMES.filter((e) => ENGINES[e].sessions !== 'none');
  const before = Object.fromEntries(kept.map((e) => [e, f[e].signIn.map((p) => readFileSync(p, 'utf8'))]));
  const res = await removeRunSessions({ sessionIds: RUN_A });
  for (const e of kept) {
    for (const p of f[e].a) assert.equal(existsSync(p), false, `${e}: run A's ${p}`);
    for (const p of f[e].b) assert.equal(existsSync(p), true, `${e}: run B's ${p}`);
    assert.deepEqual(f[e].signIn.map((p) => readFileSync(p, 'utf8')), before[e], `${e}: sign-in byte-identical`);
    assert.deepEqual(res.find((r) => r.engine === e).warnings, [], e);
  }
  assert.equal(gooseHas('worca-run-a'), false, 'goose: run A\'s session row');
  assert.equal(gooseHas('worca-run-b'), true, 'goose: run B\'s session row');
});

test('a link in a session store is removed as a link, never followed out of the store', POSIX, async () => {
  const outside = mkdtempSync(join(tmpdir(), 'worca-outside-'));
  try {
    put(join(outside, 'keep.txt'), 'keep');
    mkdirSync(join(home, '.copilot', 'session-state'), { recursive: true });
    symlinkSync(outside, join(home, '.copilot', 'session-state', UA));
    await removeRunSessions({ sessionIds: [`copilot:${UA}`] });
    assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'keep', 'the link target is untouched');
    assert.equal(existsSync(join(home, '.copilot', 'session-state', UA)), false, 'the link itself is gone');
  } finally { rmSync(outside, { recursive: true, force: true }); }
});

test('archive still succeeds when removal fails: one warning, the archive completes', POSIX, async () => {
  const f = seedStores();
  const { id } = await seedPipeline('/tmp/proj-sessions', { status: 'done', steps: [{ key: 'plan', sessionId: UA }, { key: 'code', sessionId: `codex:${UA}` }] });
  chmodSync(join(home, '.claude', 'projects', 'p'), 0o555);
  const report = await archivePipeline({ projectDir: '/tmp/proj-sessions', id });
  assert.equal(report.archived, true, 'the archive completed');
  const w = report.warnings.filter((x) => /^claude sessions: /.test(x));
  assert.equal(w.length, 1, `one warning: ${JSON.stringify(report.warnings)}`);
  assert.match(w[0], /^claude sessions: 2 not removed \(EACCES\): /);
  assert.equal(existsSync(f.codex.a[0]), false, 'the other engines still removed theirs');
  assert.equal(existsSync(f.claude.b[0]), true);
});
