// test/ask-thread-ownership.test.mjs — 1.4: under the agent pool every person's agent is in worca-share, which could
// write all of ask/. A chat's own folder now belongs to its owner's pool group (store.mjs claimThreadDir), ask/ is
// sticky, and the memory mount every chat loads (ask/memory) is never group-writable, so one person's agent cannot
// edit what another person's chat loads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { askRoot, claimThreadDir, createThread } from '../src/core/ask/store.mjs';
import { defaultMemoryDeps, refreshAskMemoryMount } from '../src/core/ask/memory-deps.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { withBillTo } from '../src/core/billing.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'worca-askown-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const POSIX = { skip: process.platform === 'win32' ? 'POSIX modes' : false };

async function withPool(fn) {
  const own = process.getgid();
  const env = {
    WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: join(dir, 'agent-home'), WORCA_AGENT_GID: String(own),
    WORCA_AGENT_POOL: 'worca-agent-01,worca-agent-02', WORCA_AGENT_HOMES: join(dir, 'agent-homes'),
    WORCA_AGENT_RUN_GIDS: `worca-agent-01:${own},worca-agent-02:${own}`,
  };
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await withBillTo('ada@acme.dev', fn); } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('1.4: a new chat\'s folder is its owner\'s pool group, setgid 2770, and ask/ is sticky; no folder without a pool', POSIX, async () => {
  const plain = createThread();
  assert.equal(existsSync(join(askRoot(), plain.id)), false, 'no pool: nothing made');
  const t = await withPool(() => createThread());
  const st = statSync(join(askRoot(), t.id));
  assert.equal(st.mode & 0o7777, 0o2770);
  assert.equal(st.gid, process.getgid());
  assert.ok(statSync(askRoot()).mode & 0o1000, 'ask/ is sticky');
});

test('1.4: a chat folder an agent planted (a link) is refused, and what it points at is untouched', POSIX, async () => {
  const aimed = mkdtempSync(join(dir, 'aimed-'));
  chmodSync(aimed, 0o700);
  mkdirSync(askRoot(), { recursive: true });
  symlinkSync(aimed, join(askRoot(), 'ask_0badf00d'));
  await withPool(async () => {
    assert.throws(() => claimThreadDir('ask_0badf00d'), /ELOOP|ENOTDIR|link/);
    assert.throws(() => claimThreadDir('../x'), /never minted/);
  });
  assert.equal(statSync(aimed).mode & 0o7777, 0o700);
});

test('1.4: the Ask memory mount is never group-writable: new files and folders, and ones left writable before', POSIX, async () => {
  const prevMask = process.umask(0o007);           // the server's umask under isolation (docker/entrypoint.sh)
  try {
    const th = createThread();
    const tools = createAskTools({ ...defaultToolDeps({ threadId: th.id }), ...defaultMemoryDeps({ threadId: th.id }) });
    await tools.call('remember', { scope: 'global', name: 'style', body: 'Terse commits.\n' });
    const stray = join(worcaHome(), 'ask', 'memory', 'global', 'stray');
    mkdirSync(stray, { recursive: true, mode: 0o777 });
    chmodSync(stray, 0o777);
    writeFileSync(join(stray, 'note.md'), 'x', { mode: 0o666 });
    chmodSync(join(stray, 'note.md'), 0o666);
    const base = await refreshAskMemoryMount({});
    assert.ok(base);
    const writable = [];
    const walk = (p) => {
      const st = lstatSync(p);
      if (st.mode & 0o022) writable.push(`${p} ${(st.mode & 0o7777).toString(8)}`);
      if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
    };
    walk(join(worcaHome(), 'ask', 'memory'));
    assert.deepEqual(writable, []);
    assert.ok(existsSync(join(base, '.claude', 'rules', 'worca', 'global', 'style.md')));
  } finally { process.umask(prevMask); }
});
