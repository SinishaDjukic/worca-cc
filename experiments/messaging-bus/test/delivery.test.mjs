// T-delivery: lib/hook.mjs and lib/mcp-mailbox.mjs spawned as children against a temp DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createSqliteBus } from '../lib/sqlite-bus.mjs';

const HOOK = fileURLToPath(new URL('../lib/hook.mjs', import.meta.url));
const MCP = fileURLToPath(new URL('../lib/mcp-mailbox.mjs', import.meta.url));
const dirs = [];
const children = [];
test.after(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function freshBus() {
  const d = mkdtempSync(join(tmpdir(), 'bus-deliv-'));
  dirs.push(d);
  const path = join(d, 'bus.db');
  return { path, bus: createSqliteBus({ path, origin: 'h_00000001' }) };
}
const FROM = { kind: 'step', id: 'sib', sub: null };
const pub = (bus, topic, text = 'hello') => bus.publish({ topic, kind: 'note', body: { text } }, { from: FROM }).id;
const ID_RE = /m_[0-9A-HJKMNP-TV-Z]{26}/g;

function hook(db, payload, { topics = 'run.r.team.n', prefix = 'run.r.step.n', startMark, maxChars } = {}) {
  const args = [HOOK, '--db', db, '--consumer-prefix', prefix, '--topics', topics];
  if (startMark) args.push('--start-mark', startMark);
  if (maxChars) args.push('--max-chars', String(maxChars));
  const r = spawnSync(process.execPath, args, { input: JSON.stringify(payload), encoding: 'utf8' });
  const ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ctx, ids: ctx ? ctx.additionalContext.match(ID_RE) ?? [] : [] };
}
const cursorRows = (bus) => bus.db.prepare('SELECT consumer, origin, seq FROM bus_cursors ORDER BY consumer, origin').all();

test('an empty mailbox prints nothing and exits 0', () => {
  const { path, bus } = freshBus();
  const r = hook(path, { session_id: 's', tool_name: 'Bash', tool_use_id: 't1' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  bus.close();
});

test('two messages arrive once as additionalContext', () => {
  const { path, bus } = freshBus();
  const a = pub(bus, 'run.r.team.n'); const b = pub(bus, 'run.r.team.n');
  const r = hook(path, { session_id: 's', tool_name: 'Bash' });
  assert.equal(r.status, 0);
  assert.equal(r.ctx.hookEventName, 'PostToolUse');
  assert.deepEqual(r.ids, [a, b]);
  assert.equal(hook(path, { session_id: 's', tool_name: 'Bash' }).stdout, '');
  bus.close();
});

test('two sub-agents get it once each', () => {
  const { path, bus } = freshBus();
  const id = pub(bus, 'run.r.team.n');
  const seen = { a: [], b: [] };
  for (const who of ['a', 'b', 'a', 'b']) seen[who].push(...hook(path, { session_id: 's', agent_id: who }).ids);
  assert.deepEqual(seen, { a: [id], b: [id] });
  bus.close();
});

test('a message on a sub-agent address reaches only that sub-agent', () => {
  const { path, bus } = freshBus();
  const id = pub(bus, 'agent.s.sub.a');
  assert.deepEqual(hook(path, { session_id: 's', agent_id: 'b' }).ids, []);
  assert.deepEqual(hook(path, { session_id: 's' }).ids, []);
  assert.deepEqual(hook(path, { session_id: 's', agent_id: 'a' }).ids, [id]);
  bus.close();
});

test('overflow is delivered across calls, every id exactly once', async () => {
  const { path, bus } = freshBus();
  const published = Array.from({ length: 10 }, (_, i) => pub(bus, 'run.r.team.n', String(i % 10).repeat(200)));
  const seen = [];
  let first = null;
  for (let i = 0; i < 15; i++) {
    const r = hook(path, { session_id: 's' }, { maxChars: 1000 });
    if (i === 0) first = r;
    if (!r.stdout) break;
    seen.push(...r.ids);
  }
  assert.ok(first.ids.length >= 1 && first.ids.length < 10);
  assert.match(first.ctx.additionalContext, /\+\d+ more \(next tool call or bus_read\)$/);
  assert.deepEqual(seen, published);
  assert.equal(new Set(seen).size, 10);

  // 5 hook calls, then bus_read takes exactly the remainder
  const two = freshBus();
  const pubs = Array.from({ length: 30 }, () => pub(two.bus, 'run.r.team.n', 'w'.repeat(200)));
  const hookSeen = [];
  for (let i = 0; i < 5; i++) hookSeen.push(...hook(two.path, { session_id: 's' }, { maxChars: 1000 }).ids);
  assert.ok(hookSeen.length < 30);
  const mcp = startMcp(two.path, { session: 's' });
  const res = await mcp.call('bus_read', { maxChars: 100000 });
  assert.deepEqual(res.structuredContent.ids, pubs.filter((p) => !hookSeen.includes(p)));
  mcp.close();
  bus.close(); two.bus.close();
});

test('start mark: a new consumer sees only what came after the step started', () => {
  const { path, bus } = freshBus();
  pub(bus, 'run.r.team.n', 'before');
  bus.mark('step:r:n:1');
  const after = pub(bus, 'run.r.team.n', 'after');
  const r = hook(path, { session_id: 's', agent_id: 'late' }, { startMark: 'step:r:n:1' });
  assert.deepEqual(r.ids, [after]);
  assert.equal(r.stderr, '');
  const nope = hook(path, { session_id: 's', agent_id: 'other' }, { startMark: 'nope' });
  assert.equal(nope.ids.length, 2);
  assert.match(nope.stderr, /^BUS_NO_MARK/);
  bus.close();
});

test('a lowercase collision is refused and changes nothing', () => {
  const { path, bus } = freshBus();
  pub(bus, 'run.r.team.n');
  assert.equal(hook(path, { session_id: 's', agent_id: 'A7' }).ids.length, 1);
  const before = cursorRows(bus);
  const r = hook(path, { session_id: 's', agent_id: 'a7' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  assert.match(r.stderr, /^BUS_BAD_CONSUMER/);
  assert.deepEqual(cursorRows(bus), before);
  const next = pub(bus, 'run.r.team.n');
  assert.deepEqual(hook(path, { session_id: 's', agent_id: 'A7' }).ids, [next]);
  bus.close();
});

test('an invalid agent_id or a missing DB never blocks the tool call', () => {
  const { path, bus } = freshBus();
  pub(bus, 'run.r.team.n');
  const before = cursorRows(bus);
  const r = hook(path, { session_id: 's', agent_id: '../x' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  assert.match(r.stderr, /^BUS_BAD_CONSUMER/);
  assert.deepEqual(cursorRows(bus), before);
  const missing = hook(join(dirs[0], 'nope', 'bus.db'), { session_id: 's' });
  assert.deepEqual([missing.status, missing.stdout], [0, '']);
  assert.ok(missing.stderr.trim().length > 0);
  const garbage = spawnSync(process.execPath, [HOOK, '--db', path, '--consumer-prefix', 'p', '--topics', 'run.r.team.n'], { input: 'not json', encoding: 'utf8' });
  assert.deepEqual([garbage.status, garbage.stdout], [0, '']);
  bus.close();
});

function startMcp(db, { session = 's', topics = 'run.r.team.n', prefix = 'run.r.step.n' } = {}) {
  const c = spawn(process.execPath, [MCP, '--db', db, '--consumer-prefix', prefix, '--session', session, '--topics', topics], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(c);
  const waiting = new Map();
  let nextId = 0;
  createInterface({ input: c.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  const rpc = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    rpc,
    call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).result,
    close: () => c.stdin.end(),
  };
}

test('MCP: tools/list, bus_read acks, readers are independent, replay does not move the cursor', async () => {
  const { path, bus } = freshBus();
  const id = pub(bus, 'run.r.team.n');
  const mcp = startMcp(path);
  const init = await mcp.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
  assert.ok(init.result.capabilities.tools);
  const list = await mcp.rpc('tools/list', {});
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['bus_publish', 'bus_read']);
  assert.deepEqual((await mcp.call('bus_read', {})).structuredContent.ids, [id]);
  assert.deepEqual((await mcp.call('bus_read', {})).structuredContent.ids, []);
  assert.deepEqual((await mcp.call('bus_read', { reader: 'b' })).structuredContent.ids, [id]);
  const replay = await mcp.call('bus_read', { replay: 1 });
  assert.deepEqual(replay.structuredContent.ids, [id]);
  assert.ok(replay.content[0].text.includes(id));
  assert.deepEqual((await mcp.call('bus_read', {})).structuredContent.ids, []);
  const bad = await mcp.call('bus_read', { reader: '../x' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /^BUS_BAD_CONSUMER/);
  const unknown = await mcp.rpc('nope/method', {});
  assert.equal(unknown.error.code, -32601);
  mcp.close();
  bus.close();
});

test('MCP: bus_publish stamps from; a reader never reads its own row; bad topics write nothing', async () => {
  const { path, bus } = freshBus();
  const mcp = startMcp(path, { session: 'sess1' });
  const ok = await mcp.call('bus_publish', { topic: 'run.r.team.n', kind: 'note', text: 'hi', from: { kind: 'person', id: 'boss' } });
  assert.equal(ok.isError, undefined);
  const row = bus.read('x:y:z', ['run.r.team.n']).at(-1);
  assert.deepEqual(row.from, { kind: 'agent', id: 'sess1', sub: 'main' });
  await mcp.call('bus_publish', { topic: 'run.r.team.n', kind: 'note', text: 'from b', reader: 'b' });
  const rowB = bus.read('x:y:z', ['run.r.team.n']).at(-1);
  assert.deepEqual(rowB.from, { kind: 'agent', id: 'sess1', sub: 'b' });
  const readB = await mcp.call('bus_read', { reader: 'b' });
  assert.ok(!readB.structuredContent.ids.includes(rowB.id));
  assert.ok(readB.structuredContent.ids.includes(row.id));
  const n = bus.countRows();
  const bad = await mcp.call('bus_publish', { topic: 'Bad..Topic', kind: 'note', text: 'x' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /^BUS_BAD_TOPIC/);
  assert.equal(bus.countRows(), n);
  mcp.close();
  bus.close();
});
