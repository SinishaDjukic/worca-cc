// T-detector: layer 2's detector, net-diff coalescing, caps, loops and secrets (plan §3.3, §4.4, §4.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSqliteBus } from '../lib/sqlite-bus.mjs';
import { openDetectState } from '../lib/detect-state.mjs';
import { surfaceOf } from '../lib/surface.mjs';
import {
  detect, planPublishes, flushPending, runDetect, runFlush, toDraft,
  DEBOUNCE_MS, DEBOUNCE_CALLS, MAX_AUTO, AUTO_MAX_HOP, TEXT_MAX, DATA_MAX, SIG_MAX, SYMBOLS_MAX,
} from '../lib/detector.mjs';

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const TOPIC = 'run.r.siblings';
const TASK_MAP = { v: 1, tasks: {
  a: { title: 'A', file: 'tasks/a.md', files: ['lib.mjs', 'api.mjs', '.env', 'db.sql', 'gen.mjs'], parsed: true },
  b: { title: 'B', file: 'tasks/b.md', files: ['cart.mjs'], parsed: true },
  n: { title: 'N', file: 'tasks/n.md', files: [], parsed: false },
} };

const V1 = 'export function price(item) {\n  return item.cost;\n}\n';
const V2 = 'export function price(item, opts) {\n  return item.cost;\n}\n';

/** A temp git repo + bus + detect state, and helpers that run one tool call the way the hook does. */
function harness({ taskId = 'a', files = { 'lib.mjs': V1 }, from = { kind: 'agent', id: 'a', sub: 'main' }, shown = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bus-det-'));
  dirs.push(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), t); }
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base', '--allow-empty');
  const bus = createSqliteBus({ path: join(root, '.bus.db'), origin: 'h_det' });
  writeFileSync(join(root, '.git', 'info', 'exclude'), '.bus.db*\n');
  const state = openDetectState(bus.db);
  const scope = `mark|${from.id}:${from.sub}`;
  if (shown) state.apply(scope, [{ op: 'counters', row: { lastShown: { ...shown, callNo: 0 } } }]);
  let now = 1_000_000;
  const ctx = {
    root, taskId, taskMap: TASK_MAP,
    siblingsFiles: new Set(Object.entries(TASK_MAP.tasks).filter(([id]) => id !== taskId).flatMap(([, t]) => t.files)),
    readFile: (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; } },
    git: (args) => { try { return git(...args); } catch { return null; } },
  };
  const opts = { topic: TOPIC, debounceMs: DEBOUNCE_MS, debounceCalls: DEBOUNCE_CALLS, maxAuto: MAX_AUTO, maxHop: AUTO_MAX_HOP };
  const published = [];
  const lines = [];
  const call = (c, { advanceMs = 1000 } = {}) => {
    now += advanceMs;
    const r = runDetect({ bus, state, scope, call: { cwd: root, ...c }, ctx, opts: { ...opts, now }, from });
    published.push(...r.published);
    lines.push(...r.lines);
    return r;
  };
  const abs = (f) => join(root, f);
  const h = {
    root, bus, state, scope, published, lines, ctx, call,
    edit(f, oldS, newS, extra = {}) {
      const text = readFileSync(abs(f), 'utf8');
      writeFileSync(abs(f), extra.replace_all ? text.split(oldS).join(newS) : text.replace(oldS, newS));
      return call({ event: 'PostToolUse', tool: 'Edit', input: { file_path: abs(f), old_string: oldS, new_string: newS, ...extra } }, extra.opts);
    },
    write(f, content, response) {
      mkdirSync(dirname(abs(f)), { recursive: true });
      writeFileSync(abs(f), content);
      return call({ event: 'PostToolUse', tool: 'Write', input: { file_path: abs(f), content }, response });
    },
    read(advanceMs) { return call({ event: 'PostToolUse', tool: 'Read', input: { file_path: abs('lib.mjs') } }, { advanceMs }); },
    bash(effect) {
      call({ event: 'PreToolUse', tool: 'Bash', input: { command: 'x' } });
      effect?.();
      return call({ event: 'PostToolUse', tool: 'Bash', input: { command: 'x' } });
    },
    flush() {
      now += 1000;
      const r = runFlush({ bus, state, scope, opts: { ...opts, now }, from });
      published.push(...r.published);
      return r;
    },
    git,
    texts: () => published.map((m) => m.body.text),
    announced: (f) => state.getFiles(scope)[f]?.announced,
    real: (f) => surfaceOf('js', f, readFileSync(abs(f), 'utf8')).surface,
  };
  return h;
}

const fakeCtx = (files, state = { files: {}, outside: [], counters: { calls: 0 }, snap: {} }, extra = {}) => ({
  root: '/r', taskId: 'a', taskMap: TASK_MAP, siblingsFiles: new Set(['cart.mjs']), state,
  readFile: (rel) => files[rel] ?? null, git: () => null, ...extra,
});
const sigOf = (fact) => fact.afterSurface.exports.price;
const beforeSigOf = (fact) => fact.beforeSurface?.exports.price;

// ---------------------------------------------------------------------------------------------
// Seeing the change

test('Edit: before is rebuilt from the file by reversing new_string → old_string', () => {
  const r = detect({ event: 'PostToolUse', tool: 'Edit', cwd: '/r', input: { file_path: '/r/lib.mjs', old_string: 'price(item)', new_string: 'price(item, opts)' } }, fakeCtx({ 'lib.mjs': V2 }));
  assert.equal(r.facts.length, 1);
  assert.deepEqual([beforeSigOf(r.facts[0]), sigOf(r.facts[0])], ['price(item)', 'price(item, opts)']);
});

test('MultiEdit reverses in reverse order; replace_all is honoured', () => {
  const after = 'export function price(item, opts, extra) {}\nexport function tax(x) {}\n';
  const r = detect({ event: 'PostToolUse', tool: 'MultiEdit', cwd: '/r', input: { file_path: '/r/lib.mjs', edits: [
    { old_string: 'price(item)', new_string: 'price(item, opts)' },
    { old_string: 'opts)', new_string: 'opts, extra)' },
  ] } }, fakeCtx({ 'lib.mjs': after }));
  assert.equal(beforeSigOf(r.facts[0]), 'price(item)');
  const all = detect({ event: 'PostToolUse', tool: 'Edit', cwd: '/r', input: { file_path: '/r/lib.mjs', old_string: '(a)', new_string: '(a, b)', replace_all: true } },
    fakeCtx({ 'lib.mjs': 'export function f(a, b) {}\nexport function g(a, b) {}\n' }));
  assert.deepEqual(all.facts[0].beforeSurface.exports, { f: 'f(a)', g: 'g(a)' });
});

test('Edit: a new_string not found exactly once falls back to the snippets', () => {
  const twice = 'export function price(item, opts) {}\n// price(item, opts)\n';
  const r = detect({ event: 'PostToolUse', tool: 'Edit', cwd: '/r', input: { file_path: '/r/lib.mjs', old_string: 'export function price(item) {}', new_string: 'export function price(item, opts) {}' } }, fakeCtx({ 'lib.mjs': twice.replace('// price(item, opts)', 'export function price(item, opts) {}') }));
  assert.deepEqual([beforeSigOf(r.facts[0]), sigOf(r.facts[0])], ['price(item)', 'price(item, opts)']);
});

test('Write: before from originalFile, then the surface cache, then git show HEAD, else created', () => {
  const call = (response) => ({ event: 'PostToolUse', tool: 'Write', cwd: '/r', input: { file_path: '/r/lib.mjs', content: V2 }, response });
  assert.equal(beforeSigOf(detect(call({ originalFile: V1 }), fakeCtx({})).facts[0]), 'price(item)');
  const cached = { files: { 'lib.mjs': { kind: 'js', current: { exports: { price: 'price(cached)' }, sql: {} } } }, outside: [], counters: { calls: 0 }, snap: {} };
  assert.equal(beforeSigOf(detect(call(), fakeCtx({}, cached)).facts[0]), 'price(cached)');
  const viaGit = detect(call(), fakeCtx({}, undefined, { git: (args) => (args[0] === 'show' && args[1] === 'HEAD:lib.mjs' ? V1 : null) }));
  assert.equal(beforeSigOf(viaGit.facts[0]), 'price(item)');
  const created = detect(call(), fakeCtx({}));
  assert.equal(created.facts[0].beforeSurface, null);
});

test('an unparsable file has no surface for that call: skipped, never an error', () => {
  const r = detect({ event: 'PostToolUse', tool: 'Write', cwd: '/r', input: { file_path: '/r/config/x.json', content: '{"a": ' } }, fakeCtx({}));
  assert.ok(r.skipped.includes('parse:config/x.json'));
  assert.ok(r.facts.every((f) => f.outside));
});

// ---------------------------------------------------------------------------------------------
// The file-list rule

test('outside-task: published once per file per step attempt, with the owner', () => {
  const h = harness({ files: { 'lib.mjs': V1, 'cart.mjs': 'export const sites = [];\n// x\n', 'notes.md': 'a\n' } });
  h.edit('cart.mjs', '// x', '// y');
  h.edit('cart.mjs', '// y', '// z');
  h.edit('notes.md', 'a', 'b');
  const out = h.published.filter((m) => m.body.data.reason === 'outside-task');
  assert.deepEqual(out.map((m) => [m.body.data.file, m.body.data.owner]), [['cart.mjs', 'b'], ['notes.md', null]]);
  assert.ok(out.every((m) => m.kind === 'contract.changed' && m.body.data.outsideTask === true && m.corr === `cc:${m.body.data.file}`));
});

test('a task with parsed:false disables the rule and prints one BUS_NO_FILE_LIST; surfaces still run', () => {
  const h = harness({ taskId: 'n' });
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  assert.deepEqual(h.published.map((m) => m.body.data.reason), ['export']);
  assert.equal(h.lines.filter((l) => l.startsWith('BUS_NO_FILE_LIST')).length, 1);
});

test('Bash fallback: the snapshot delta is attributed; a sibling-owned path is ignored', () => {
  const h = harness({ files: { 'lib.mjs': V1, 'cart.mjs': 'export function total(a) {}\n' } });
  h.bash(() => writeFileSync(join(h.root, 'cart.mjs'), 'export function total(a, b) {}\n'));
  assert.equal(h.published.length, 0);
  h.bash(() => writeFileSync(join(h.root, 'lib.mjs'), V2));
  assert.deepEqual(h.texts(), ['lib.mjs: price(item) → price(item, opts) [signature]']);
  assert.equal(h.published[0].body.data.tool, 'Bash');
});

test('Bash fallback: parallel Bash calls each keep their own Pre snapshot (M2)', () => {
  const h = harness({ files: { 'lib.mjs': V1, 'notes.md': 'a\n' } });
  writeFileSync(join(h.root, 'notes.md'), 'dirty before either command\n');
  const bash = (event, toolUseId) => h.call({ event, tool: 'Bash', toolUseId, input: { command: 'x' } });
  bash('PreToolUse', 't1');
  bash('PreToolUse', 't2');
  bash('PostToolUse', 't1');
  writeFileSync(join(h.root, 'lib.mjs'), V2);
  bash('PostToolUse', 't2');
  assert.deepEqual(h.texts(), ['lib.mjs: price(item) → price(item, opts) [signature]']);
  // each snapshot is used once
  bash('PostToolUse', 't2');
  assert.equal(h.published.length, 1);
});

test('Bash fallback: a Post with no Pre snapshot publishes nothing (M2)', () => {
  const h = harness({ files: { 'lib.mjs': V1, 'api.mjs': 'export function o(a) {}\n', 'notes.md': 'a\n' } });
  writeFileSync(join(h.root, 'notes.md'), 'b\n');
  writeFileSync(join(h.root, 'api.mjs'), 'export function o() {}\n');
  h.call({ event: 'PostToolUse', tool: 'Bash', toolUseId: 't1', input: { command: 'x' } });
  assert.deepEqual(h.published, []);
  // a Pre whose git call failed stores nothing, so its Post is skipped too
  const git = h.ctx.git;
  h.ctx.git = () => null;
  h.call({ event: 'PreToolUse', tool: 'Bash', toolUseId: 't2', input: { command: 'x' } });
  h.ctx.git = git;
  h.call({ event: 'PostToolUse', tool: 'Bash', toolUseId: 't2', input: { command: 'x' } });
  assert.deepEqual(h.published, []);
  const r = detect({ event: 'PostToolUse', tool: 'Bash', cwd: '/r', input: {} }, fakeCtx({}, { files: {}, outside: [], counters: { calls: 0 }, snap: null }, { git: () => '' }));
  assert.deepEqual([r.facts, r.skipped], [[], ['no-snapshot']]);
  // an EMPTY snapshot is still a snapshot: a clean tree before, a change after
  const clean = harness();
  clean.bash(() => writeFileSync(join(clean.root, 'lib.mjs'), V2));
  assert.equal(clean.published.length, 1);
});

test('a path outside the worktree is ignored', () => {
  for (const file_path of ['/etc/x.mjs', '../x.mjs', '/r/../x.mjs']) {
    const r = detect({ event: 'PostToolUse', tool: 'Write', cwd: '/r', input: { file_path, content: V2 } }, fakeCtx({}));
    assert.deepEqual([r.facts, r.skipped], [[], []], file_path);
  }
});

test('Bash fallback: git mv of an exported module reports the old path removed', () => {
  const h = harness({ files: { 'lib.mjs': V1, 'api.mjs': 'export function get(id) {}\n' } });
  h.bash(() => h.git('mv', 'api.mjs', 'gen.mjs'));
  const m = h.published.find((x) => x.body.data.file === 'api.mjs');
  assert.ok(m, h.texts().join('\n'));
  assert.deepEqual(m.body.data.changes.map((c) => [c.name, c.change]), [['get', 'removed']]);
});

// ---------------------------------------------------------------------------------------------
// Secrets (m3)

test('secret paths: .env.local OUTSIDE the list and .env inside it publish nothing', () => {
  const h = harness({ files: { 'lib.mjs': V1, '.env': 'A=1\n', '.env.local': 'B=1\n', 'deploy.pem': 'x\n' } });
  h.edit('.env.local', 'B=1', 'B=2');
  h.edit('.env', 'A=1', 'A=2');
  h.edit('deploy.pem', 'x', 'y');
  assert.deepEqual(h.published, []);
  assert.ok(h.lines.every((l) => !l.includes('.env') && !l.includes('pem')));
});

test('secret values are redacted from text and data', () => {
  const key = `sk-ant-${'z'.repeat(30)}`;
  const d = toDraft({ file: 'lib.mjs', reason: 'export', owner: 'a', outsideTask: false, tool: 'Edit', toolUseId: 't',
    changes: [{ name: 'price', change: 'signature', before: 'price(item)', after: `price(item, k = "${key}")` }] }, { topic: TOPIC });
  assert.ok(!JSON.stringify(d).includes(key));
  assert.ok(d.body.text.includes('[redacted]'));
});

test('secret values are masked BEFORE a signature is clipped, and in corr too (M3)', () => {
  const draft = (after, file = 'lib.mjs') => toDraft({ file, reason: 'export', owner: 'a', outsideTask: false, tool: 'Edit', toolUseId: 't',
    changes: [{ name: 'f', change: 'signature', before: 'f(a)', after }] }, { topic: TOPIC });
  // the token straddles the SIG_MAX cut: clipped first, its head would no longer match the pattern
  const tok = `ghp_${'A1b2'.repeat(9)}`;
  for (let pad = SIG_MAX - 45; pad <= SIG_MAX; pad++) {
    const d = draft(`f(${'p'.repeat(pad)}, k = "${tok}")`);
    assert.ok(!JSON.stringify(d).includes('ghp_'), `pad ${pad}: ${d.body.text}`);
  }
  const pem = draft(`f(a, k = "-----BEGIN RSA PRIVATE KEY----- ${'Q'.repeat(300)} -----END RSA PRIVATE KEY-----")`);
  assert.ok(!JSON.stringify(pem).includes('QQQQ'), pem.body.text);
  const kv = draft("f(a, GITHUB_TOKEN = 'abcdef123456')");
  assert.ok(!JSON.stringify(kv).includes('abcdef123456'));
  const key = `sk-ant-${'z'.repeat(30)}`;
  const named = draft('f(a, b)', `keys/${key}.mjs`);
  assert.ok(!JSON.stringify(named).includes(key), named.corr);
  assert.equal(named.corr, `cc:${named.body.data.file}`);
});

test('the data cap holds for a very long path and tool id; a coalesced outside-task flush keeps owner and outsideTask (m3, m4)', () => {
  const d = toDraft({ file: `${'d/'.repeat(550)}x.mjs`, reason: 'export', owner: 'a', outsideTask: false, tool: 'Edit', toolUseId: 'u'.repeat(900),
    changes: [{ name: 'f', change: 'signature', before: 'f(a)', after: 'f(a, b)' }] }, { topic: TOPIC });
  assert.ok(Buffer.byteLength(JSON.stringify(d.body.data)) <= DATA_MAX);
  assert.ok(d.body.text.length <= TEXT_MAX);
  const h = harness({ files: { 'lib.mjs': V1, 'cart.mjs': 'export function total(a) {}\nexport function sum(a) {}\n' } });
  h.edit('cart.mjs', 'total(a)', 'total(a, b)');
  h.edit('cart.mjs', 'sum(a)', 'sum(a, b)');
  h.flush();
  const m = h.published.at(-1).body.data;
  assert.deepEqual([m.coalesced, m.owner, m.outsideTask, m.tool], [true, 'b', true, 'Edit']);
});

// ---------------------------------------------------------------------------------------------
// Net-diff coalescing (M1)

test('net-diff (a): change → revert → reapply in one window, then flush → exactly 1 message, after = final', () => {
  const h = harness();
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  h.edit('lib.mjs', 'price(item, opts)', 'price(item)');
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  h.flush();
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].body.data.changes[0].after, 'price(item, opts)');
  assert.deepEqual(h.announced('lib.mjs'), h.real('lib.mjs'));
});

test('net-diff (b): change → revert in one window, then flush → 2 messages; the second is reverted', () => {
  const h = harness();
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  h.edit('lib.mjs', 'price(item, opts)', 'price(item)');
  h.flush();
  assert.deepEqual(h.texts(), ['lib.mjs: price(item) → price(item, opts) [signature]', 'lib.mjs: price(item, opts) → price(item) [signature]']);
  assert.deepEqual([h.published[1].body.data.coalesced, h.published[1].body.data.reverted], [true, true]);
  assert.deepEqual([h.published[0].body.data.coalesced, h.published[0].body.data.reverted], [false, false]);
  assert.deepEqual(h.announced('lib.mjs'), h.real('lib.mjs'));
});

test('net-diff (c): change; window ends; revert; window ends; reapply → 3 messages, each true at send time', () => {
  const h = harness();
  const sent = [];
  const at = () => sent.push(h.real('lib.mjs').exports.price);
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)'); at();
  for (let i = 0; i < DEBOUNCE_CALLS; i++) h.read();
  h.edit('lib.mjs', 'price(item, opts)', 'price(item)'); at();
  for (let i = 0; i < DEBOUNCE_CALLS; i++) h.read();
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)'); at();
  h.flush();
  assert.equal(h.published.length, 3);
  assert.deepEqual(h.published.map((m) => m.body.data.changes[0].after), sent);
});

test('net-diff (d): two symbols in one window → 1 leading + 1 coalesced naming the second', () => {
  const h = harness({ files: { 'lib.mjs': V1 + 'export function tax(x) {}\n' } });
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  h.edit('lib.mjs', 'tax(x)', 'tax(x, rate)');
  h.flush();
  assert.equal(h.published.length, 2);
  assert.deepEqual(h.published[1].body.data.changes.map((c) => c.name), ['tax']);
  assert.equal(h.published[1].body.data.coalesced, true);
  assert.deepEqual(h.announced('lib.mjs'), h.real('lib.mjs'));
});

test('net-diff (e): a window that ends by time flushes on the next call, even a Read; announced = real after each flush', () => {
  const h = harness({ files: { 'lib.mjs': V1 + 'export function tax(x) {}\n' } });
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  h.edit('lib.mjs', 'tax(x)', 'tax(x, rate)');
  assert.equal(h.published.length, 1);
  const r = h.read(DEBOUNCE_MS);
  assert.equal(r.published.length, 1, 'the Read flushed the ended window');
  assert.deepEqual(h.announced('lib.mjs'), h.real('lib.mjs'));
  h.flush();
  assert.equal(h.published.length, 2);
});

test('net-diff (f): a pending row whose window ended and an edit of the same file in one call → no stale message (M1)', () => {
  const h = harness({ files: { 'lib.mjs': V1 + 'export function tax(x) {}\n' } });
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  h.edit('lib.mjs', 'tax(x)', 'tax(x, rate)');
  // 31 s later the pending change is reverted in the same call that ends its window
  const r = h.edit('lib.mjs', 'tax(x, rate)', 'tax(x)', { opts: { advanceMs: DEBOUNCE_MS + 1000 } });
  assert.deepEqual(r.published, [], 'the reverted pending change was never true for a sibling');
  assert.deepEqual(h.announced('lib.mjs'), h.real('lib.mjs'));
  h.flush();
  assert.equal(h.published.length, 1);
  // the same, but the call changes the pending symbol again: one coalesced message with the state of NOW
  const g = harness({ files: { 'lib.mjs': V1 + 'export function tax(x) {}\n' } });
  g.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  g.edit('lib.mjs', 'tax(x)', 'tax(x, rate)');
  const r2 = g.edit('lib.mjs', 'tax(x, rate)', 'tax(x, rate, year)', { opts: { advanceMs: DEBOUNCE_MS + 1000 } });
  assert.deepEqual(r2.published.map((m) => [m.body.text, m.body.data.coalesced]), [['lib.mjs: tax(x) → tax(x, rate, year) [signature]', true]]);
  assert.deepEqual(g.announced('lib.mjs'), g.real('lib.mjs'));
  g.flush();
  assert.equal(g.published.length, 2);
  assert.equal(g.state.getFiles(g.scope)['lib.mjs'].pending, false);
});

test('Read/Grep create no facts', () => {
  const r = detect({ event: 'PostToolUse', tool: 'Read', cwd: '/r', input: { file_path: '/r/lib.mjs' } }, fakeCtx({ 'lib.mjs': V2 }));
  assert.deepEqual(r.facts, []);
  assert.deepEqual(detect({ event: 'PostToolUse', tool: 'Grep', cwd: '/r', input: { pattern: 'x' } }, fakeCtx({})).facts, []);
});

test('an added export alone publishes nothing', () => {
  const h = harness();
  h.edit('lib.mjs', 'export function price', 'export function extra() {}\nexport function price');
  h.flush();
  assert.deepEqual(h.published, []);
});

// ---------------------------------------------------------------------------------------------
// Caps and loops

test('the cap: 10 auto-publishes, then one auto-cap status, then BUS_AUTO_CAP drops', () => {
  const h = harness();
  let sig = 'item';
  for (let i = 0; i < 13; i++) {
    const next = `${sig}, a${i}`;
    h.edit('lib.mjs', `price(${sig})`, `price(${next})`);
    sig = next;
    for (let k = 0; k < DEBOUNCE_CALLS; k++) h.read();
  }
  h.flush();
  const kinds = h.published.map((m) => m.kind);
  assert.equal(kinds.filter((k) => k === 'contract.changed').length, MAX_AUTO);
  assert.equal(kinds.filter((k) => k === 'status').length, 1);
  assert.deepEqual(h.published.at(-1).body.data, { v: 1, source: 'hook', event: 'auto-cap' });
  assert.ok(h.lines.some((l) => l.startsWith('BUS_AUTO_CAP')));
});

test('hop chain: a publish within DEBOUNCE_CALLS of a shown change replies to it; hop 3 is suppressed and announced still advances', () => {
  const shownId = 'm_00000000000000000000000000';
  const h1 = harness({ shown: { id: shownId, hop: 1 } });
  h1.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  assert.deepEqual([h1.published[0].hop, h1.published[0].replyTo], [2, shownId]);
  const h2 = harness({ shown: { id: shownId, hop: 2 } });
  h2.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  assert.deepEqual(h2.published, []);
  assert.ok(h2.lines.some((l) => l.startsWith('BUS_AUTO_HOP')));
  h2.flush();
  assert.deepEqual(h2.published, [], 'no re-emit at flush');
  assert.deepEqual(h2.announced('lib.mjs'), h2.real('lib.mjs'));
});

test('hop chain: a show older than DEBOUNCE_CALLS calls starts a new chain (hop 1, no replyTo)', () => {
  const h = harness({ shown: { id: 'm_00000000000000000000000000', hop: 2 } });
  for (let i = 0; i < DEBOUNCE_CALLS; i++) h.read();
  h.edit('lib.mjs', 'price(item)', 'price(item, opts)');
  assert.equal(h.published.length, 1);
  assert.deepEqual([h.published[0].hop, h.published[0].replyTo], [1, undefined]);
});

test('body and data caps: text ≤ 600 chars, ≤ 5 symbols then +N more, signatures ≤ 120, data ≤ 1024 bytes', () => {
  const changes = Array.from({ length: 30 }, (_, i) => ({ name: `fn${i}`, change: 'signature', before: `fn${i}(${'p'.repeat(300)})`, after: `fn${i}(${'q'.repeat(300)})` }));
  const d = toDraft({ file: 'lib.mjs', reason: 'export', owner: 'a', outsideTask: false, tool: 'Edit', toolUseId: 't', changes }, { topic: TOPIC, coalesced: true });
  assert.ok(d.body.text.length <= TEXT_MAX);
  const shownItems = d.body.text.split('; ').length;
  assert.ok(shownItems >= 1 && shownItems <= SYMBOLS_MAX);
  assert.ok(d.body.text.endsWith(` +${30 - shownItems} more`), d.body.text);
  const few = toDraft({ file: 'lib.mjs', reason: 'export', changes: changes.slice(0, 8).map((c) => ({ ...c, before: 'a()', after: 'b()' })) }, { topic: TOPIC });
  assert.equal(few.body.text.split('; ').length, SYMBOLS_MAX);
  assert.ok(few.body.text.endsWith(' +3 more'), few.body.text);
  assert.ok(Buffer.byteLength(JSON.stringify(d.body.data)) <= DATA_MAX);
  for (const c of d.body.data.changes) assert.ok((c.before ?? '').length <= SIG_MAX && (c.after ?? '').length <= SIG_MAX);
  assert.equal(d.body.data.coalesced, true);
});

test('planPublishes and flushPending are pure: same input, same output, no state mutation', () => {
  const state = { files: { 'lib.mjs': { kind: 'js', announced: { exports: { price: 'price(item)' }, sql: {} }, current: { exports: { price: 'price(item, opts)' }, sql: {} },
    first: { exports: { price: 'price(item)' }, sql: {} }, windowCall: 1, windowTs: 0, pending: true } }, outside: [], counters: { calls: 2, autos: 1, capped: false, lastShown: null }, snap: {} };
  const copy = structuredClone(state);
  const a = flushPending(state, { topic: TOPIC, now: 5, callNo: 3, force: true });
  assert.deepEqual(state, copy);
  assert.equal(a.publish.length, 1);
  assert.equal(planPublishes([], state, { topic: TOPIC, now: 5, callNo: 3, debounceMs: DEBOUNCE_MS, debounceCalls: DEBOUNCE_CALLS, maxAuto: MAX_AUTO, maxHop: AUTO_MAX_HOP, shown: null }).publish.length, 0);
});
