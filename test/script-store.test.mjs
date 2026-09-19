// test/script-store.test.mjs
// User-layer script CRUD (workbench spec §3.1–§3.3), the sibling of
// agent-store.test.mjs: the store owns `meta.file`, writes atomically in the
// order source -> cases -> meta, refuses built-in/plugin keys and any key an
// agent already holds (base D16), renames the program when the runtime changes,
// stamps createdBy/updatedBy (W19), and keeps a user's cases for a BUILT-IN
// script as an overlay with no meta beside it (W18).
// WORCA_HOME is a temp dir for the whole file: every path below is under it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  listScripts, readScript, createScript, updateScript, deleteScript, duplicateScript, writeCases,
  sourceFileFor, userScriptsDir, stripNullKeys, SCRIPT_KEY_RE, RESERVED_SCRIPT_KEYS, MAX_SOURCE_BYTES,
} from '../src/core/script-store.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { writeGraphWorkflow, deleteWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);

const NODE_META = { metaVersion: 2, key: 'lint', displayName: 'Lint', description: 'lints', runtime: 'node',
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'lint-cycle{cycle}.md' }] };
const SRC = 'export default async function () {\n  return { summary: "ok" };\n}\n';
const SHELL_META = (over = {}) => ({ metaVersion: 2, key: 'tests', displayName: 'Tests', runtime: 'shell',
  command: 'npm test',
  inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }], ...over });
const fails = async (fn, code, re) => {
  await assert.rejects(fn, (e) => {
    assert.equal(e.code, code, `expected code ${code}, got ${e.code} (${e.message})`);
    if (re) assert.match(e.message, re);
    return true;
  });
};
const userFiles = () => readdirSync(userScriptsDir()).sort();

test('sourceFileFor names the program per runtime (python is P2 but the mapping ships now)', () => {
  assert.equal(sourceFileFor('lint', 'node'), 'lint.mjs');
  assert.equal(sourceFileFor('lint', 'python'), 'lint.py');
  assert.equal(sourceFileFor('lint', 'shell'), 'lint.sh');
  assert.equal(sourceFileFor('lint', 'shell', { win32: true }), 'lint.cmd');
  assert.equal(sourceFileFor('lint', 'nope'), null);
  assert.ok(SCRIPT_KEY_RE.test('lint') && !SCRIPT_KEY_RE.test('9x'));
  assert.deepEqual([...RESERVED_SCRIPT_KEYS], ['new', 'bench', 'runtimes']);
  assert.equal(MAX_SOURCE_BYTES, 262144);
});

test('create -> read -> update -> delete; the store owns file; stamps ride the meta', async () => {
  const created = await createScript({ meta: { ...NODE_META, file: '../evil.mjs', order: undefined }, source: SRC, by: 'ui' });
  assert.equal(created.meta.key, 'lint');
  assert.equal(created.meta.origin, 'user');
  assert.equal(created.meta.file, 'lint.mjs', 'a client-sent file is ignored and recomputed');
  assert.equal(created.meta.order, 99, 'user scripts sort after the built-ins by default');
  assert.equal(created.meta.createdBy, 'ui');
  assert.equal(created.meta.updatedBy, 'ui');
  assert.deepEqual(userFiles(), ['lint.meta.json', 'lint.mjs'], 'no .tmp- leftovers');

  const read = await readScript('lint');
  assert.equal(read.source, SRC);
  assert.equal(read.sourceWin32, '');
  assert.equal(read.sourcePath, join(userScriptsDir(), 'lint.mjs'));
  assert.equal(read.sourceTruncated, false);
  assert.deepEqual(read.cases, []);
  assert.deepEqual(read.userCases, []);
  assert.equal(read.casesWritable, true);
  assert.equal(read.meta.origin, 'user');

  const upd = await updateScript('lint', { meta: { ...NODE_META, displayName: 'Lint it', key: 'ignored' }, source: '// v2\n', by: 'ask:th_1' });
  assert.equal(upd.meta.displayName, 'Lint it');
  assert.equal(upd.meta.key, 'lint', 'key is immutable on update');
  assert.equal(upd.meta.createdBy, 'ui', 'createdBy survives an update');
  assert.equal(upd.meta.updatedBy, 'ask:th_1');
  assert.deepEqual(upd.warnings, []);
  assert.equal((await readScript('lint')).source, '// v2\n');

  assert.deepEqual(await deleteScript('lint'), { ok: true });
  assert.equal(await readScript('lint'), null);
  assert.deepEqual(userFiles(), []);
});

test('keys: shape, the reserved "new", built-ins, plugin keys and the shared agent namespace', async () => {
  await fails(() => createScript({ meta: { ...NODE_META, key: '9x' }, source: SRC }), 'BAD_REQUEST', /alphanumeric/);
  await fails(() => createScript({ meta: { ...NODE_META, key: 'new' }, source: SRC }), 'BAD_REQUEST', /reserved script key/);
  // `/api/scripts/runtimes` is a literal route: a script under that key saves and is then unopenable.
  await fails(() => createScript({ meta: { ...NODE_META, key: 'runtimes' }, source: SRC }), 'BAD_REQUEST', /reserved script key/);
  await fails(() => createScript({ meta: { ...NODE_META, key: 'bench' }, source: SRC }), 'BAD_REQUEST', /reserved script key/);
  await fails(() => createScript({ meta: { ...NODE_META, key: 'shell', runtime: 'shell', command: 'x' }, source: '' }),
    'BUILTIN', /built-in script — duplicate it under a new name instead/);
  // D16: agents win the shared key namespace, so a script may never take one.
  await fails(() => createScript({ meta: { ...NODE_META, key: 'reviewer' }, source: SRC }),
    'DUPLICATE', /is an agent key — scripts and agents share one namespace/);
  await createScript({ meta: NODE_META, source: SRC, by: 'cli' });
  await fails(() => createScript({ meta: NODE_META, source: SRC }), 'DUPLICATE', /a user script "lint" already exists/);
  await fails(() => createScript({ meta: NODE_META, source: SRC, by: 'nobody' }), 'BAD_REQUEST', /by must be "ui", "cli" or "ask:<threadId>"/);
  await fails(() => updateScript('shell', { meta: SHELL_META({ key: 'shell' }) }), 'BUILTIN', /duplicate it instead of editing/);
  await fails(() => deleteScript('shell'), 'BUILTIN', /cannot be deleted/);
  await fails(() => updateScript('nope', { meta: NODE_META }), 'NOT_FOUND', /script not found: nope/);
  await fails(() => deleteScript('nope'), 'NOT_FOUND', /script not found: nope/);
  await deleteScript('lint');
});

test('a reserved key is refused in ANY case: express matches a literal route segment case-blind', async () => {
  // `GET /api/scripts/Runtimes` answers the runtime probe, not the script — express
  // routing is case-INSENSITIVE by default, and so is the filesystem (C23). A key the
  // store accepts here saves and can then never be opened.
  for (const key of ['Runtimes', 'RUNTIMES', 'Bench', 'BENCH', 'New']) {
    await fails(() => createScript({ meta: { ...NODE_META, key }, source: SRC }), 'BAD_REQUEST', /is a reserved script key/);
  }
  await fails(() => duplicateScript('shell', 'Runtimes', 'ui'), 'BAD_REQUEST', /is a reserved script key/);
  assert.deepEqual(userFiles(), [], 'nothing was written');
});

test('a Windows device stem is refused as a key: con.mjs IS the console on a Windows host', async () => {
  // CON, PRN, AUX, NUL, COM1-9 and LPT1-9 resolve to a device even with an extension,
  // so `con.meta.json` writes to the console and can never be read back.
  for (const key of ['con', 'NUL', 'aux', 'Prn', 'com1', 'LPT9']) {
    await fails(() => createScript({ meta: { ...NODE_META, key }, source: SRC }), 'BAD_REQUEST', /reserved device name on Windows/);
  }
  await fails(() => duplicateScript('shell', 'con', 'ui'), 'BAD_REQUEST', /reserved device name on Windows/);
  assert.deepEqual(userFiles(), []);
});

test('sources: the empty/over-cap rules and the shell trio (inline command, .sh, .sh + .cmd)', async () => {
  await fails(() => createScript({ meta: NODE_META, source: '   ' }), 'BAD_REQUEST', /runtime "node" needs a program/);
  await fails(() => createScript({ meta: NODE_META, source: 'x'.repeat(MAX_SOURCE_BYTES + 1) }), 'BAD_REQUEST', /source is over 262144 bytes/);
  await fails(() => createScript({ meta: NODE_META, source: SRC, sourceWin32: '@echo off\n' }), 'BAD_REQUEST', /only legal on the shell runtime/);
  await fails(() => createScript({ meta: SHELL_META(), source: '', sourceWin32: '@echo off\n' }), 'BAD_REQUEST', /sourceWin32 needs a shell file/);

  const inline = await createScript({ meta: SHELL_META(), source: '', by: 'ui' });
  assert.equal(inline.meta.file, null, 'a shell card with an inline command has no file');
  assert.deepEqual(userFiles(), ['tests.meta.json']);

  const withFile = await updateScript('tests', { meta: SHELL_META({ command: undefined }), source: 'npm test\n', by: 'ui' });
  assert.equal(withFile.meta.file, 'tests.sh');
  assert.deepEqual(userFiles(), ['tests.meta.json', 'tests.sh']);

  const both = await updateScript('tests', { meta: SHELL_META({ command: undefined }), source: 'npm test\n', sourceWin32: 'npm.cmd test\r\n', by: 'ui' });
  assert.deepEqual(both.meta.file, { default: 'tests.sh', win32: 'tests.cmd' });
  assert.deepEqual(userFiles(), ['tests.cmd', 'tests.meta.json', 'tests.sh']);
  const back = await readScript('tests');
  assert.equal(back.source, 'npm test\n', 'source is always the default entry, on every host');
  assert.equal(back.sourceWin32, 'npm.cmd test\r\n');

  // Dropping the win32 variant removes its file.
  const dropped = await updateScript('tests', { meta: SHELL_META({ command: undefined }), source: 'npm test\n', sourceWin32: '', by: 'ui' });
  assert.equal(dropped.meta.file, 'tests.sh');
  assert.deepEqual(userFiles(), ['tests.meta.json', 'tests.sh']);
  await deleteScript('tests');
});

test('a runtime change renames the program file', async () => {
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  const upd = await updateScript('lint', { meta: { ...NODE_META, runtime: 'shell', command: undefined }, source: 'eslint .\n', by: 'ui' });
  assert.equal(upd.meta.runtime, 'shell');
  assert.equal(upd.meta.file, 'lint.sh');
  assert.deepEqual(userFiles(), ['lint.meta.json', 'lint.sh'], 'the .mjs is gone');
  assert.equal(loadScriptRegistry({ agentKeys: null }).lint.scriptPath, join(userScriptsDir(), 'lint.sh'));
  await deleteScript('lint');
});

test('meta validation is the sidecar validator, verbatim; a port change only warns', async () => {
  await fails(() => createScript({ meta: { ...NODE_META, runtime: 'perl' }, source: SRC }), 'BAD_REQUEST', /runtime must be one of node, shell/);
  await fails(() => createScript({ meta: { ...NODE_META, inputs: [{ id: 'plan', type: 'md', as: 'file' }] }, source: SRC }),
    'BAD_REQUEST', /as is a prompt-side field/);
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  await writeGraphWorkflow({ id: 'wf_lintuser', name: 'Lint user', version: 2,
    nodes: [{ id: 'n_lint', kind: 'script', key: 'lint', x: 0, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_lint', port: 'log' }, to: { node: 'n_end', port: 'result' } }] });
  const upd = await updateScript('lint', {
    meta: { ...NODE_META, outputs: [{ id: 'report', type: 'md', when: 'always', filename: 'lint-cycle{cycle}.md' }] }, by: 'ui',
  });
  assert.deepEqual(upd.warnings, ['saved pipelines reference a removed port: Lint user (n_lint.log)']);
  await fails(() => deleteScript('lint'), 'REFERENCED', /used by saved workflow\(s\): Lint user/);
  await deleteWorkflow('wf_lintuser');
  await deleteScript('lint');
});

test('duplicate: any layer -> a user copy, cases included', async () => {
  await writeCases('shell', [{ id: 'c1', name: 'smoke', params: { command: 'echo hi' },
    ports: { inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-{cycle}.md' }] } }]);
  const copy = await duplicateScript('shell', 'myShell', 'ui');
  assert.equal(copy.meta.key, 'myShell');
  assert.equal(copy.meta.origin, 'user');
  assert.equal(copy.meta.runtime, 'shell');
  assert.equal(copy.meta.createdBy, 'ui');
  const read = await readScript('myShell');
  assert.deepEqual(read.cases.map((c) => c.id), ['c1'], 'the source script`s cases travel with the copy');
  assert.deepEqual(read.userCases, [], 'a user script has no overlay');
  await fails(() => duplicateScript('shell', 'myShell', 'ui'), 'DUPLICATE', /a user script "myShell" already exists/);
  await fails(() => duplicateScript('nope', 'other', 'ui'), 'NOT_FOUND', /script not found: nope/);
  await fails(() => duplicateScript('shell', 'new', 'ui'), 'BAD_REQUEST', /reserved script key/);
  await deleteScript('myShell');
  await writeCases('shell', []);
});

test('cases: written to the user layer; for a built-in key they are an OVERLAY with no meta (W18)', async () => {
  await fails(() => writeCases('shell', [{ id: '9x' }]), 'BAD_REQUEST', /bad case id "9x"/);
  const { cases } = await writeCases('shell', [{ id: 'c_ok', name: 'smoke', params: { command: 'echo hi' },
    ports: { inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-{cycle}.md' }] },
    expect: { verdict: 'clean', fired: ['log'] } }]);
  assert.deepEqual(cases.map((c) => c.id), ['c_ok']);
  assert.deepEqual(userFiles(), ['shell.tests.json'], 'the overlay has NO meta beside it');
  const reg = loadScriptRegistry({ agentKeys: null });
  assert.equal(reg.shell.origin, 'builtin', 'a tests file without a meta is not a script');
  const read = await readScript('shell');
  assert.deepEqual(read.cases, [], 'the built-in ships none');
  assert.deepEqual(read.userCases.map((c) => c.id), ['c_ok']);
  const listed = (await listScripts()).find((s) => s.key === 'shell');
  assert.equal(listed.caseCount, 1);
  // Emptying the overlay removes the file.
  assert.deepEqual((await writeCases('shell', [])).cases, []);
  assert.deepEqual(userFiles(), []);
  await fails(() => writeCases('nope', []), 'NOT_FOUND', /script not found: nope/);
  await fails(() => writeCases('shell', 'x'), 'BAD_REQUEST', /cases must be an array/);
});

test('listScripts is the registry order with caseCount; a half-written pair loads nothing', async () => {
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  await writeCases('lint', [{ id: 'c1' }]);
  const list = await listScripts();
  assert.deepEqual(list.map((s) => s.key), ['shell', 'js', 'py', 'gitDiff', 'lint']);
  assert.equal(list.at(-1).caseCount, 1);
  assert.equal(list[0].caseCount, 0);
  // The crash state the write order protects: a source with no meta beside it.
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'halfway.mjs'), SRC);
  assert.equal(loadScriptRegistry({ agentKeys: null }).halfway, undefined);
  assert.equal((await listScripts()).some((s) => s.key === 'halfway'), false);
  await deleteScript('lint');
  assert.equal(existsSync(join(dir, 'lint.tests.json')), false, 'delete takes the cases file too');
});

test('line endings belong to the store: a .cmd is written CRLF, a .sh is written LF, whatever the page sent', async () => {
  // A <textarea> can never hold a CR, so the editor always sends LF — the .cmd must still ship CRLF.
  await createScript({ meta: SHELL_META({ command: undefined }), source: 'echo one\r\necho two\r\n', sourceWin32: '@echo off\necho one\n', by: 'ui' });
  assert.equal(readFileSync(join(userScriptsDir(), 'tests.cmd'), 'utf8'), '@echo off\r\necho one\r\n');
  assert.equal(readFileSync(join(userScriptsDir(), 'tests.sh'), 'utf8'), 'echo one\necho two\n', 'a CR in a .sh is a syntax error to /bin/sh');
  // Idempotent: what readScript hands back saves to the same bytes.
  const back = await readScript('tests');
  await updateScript('tests', { meta: SHELL_META({ command: undefined }), source: back.source, sourceWin32: back.sourceWin32, by: 'ui' });
  assert.equal(readFileSync(join(userScriptsDir(), 'tests.cmd'), 'utf8'), '@echo off\r\necho one\r\n');
  // A node program is left byte-for-byte alone.
  await createScript({ meta: NODE_META, source: '// a\r\n', by: 'ui' });
  assert.equal(readFileSync(join(userScriptsDir(), 'lint.mjs'), 'utf8'), '// a\r\n');
  await deleteScript('lint');
  await deleteScript('tests');
});

test('a sent null REMOVES the stored key: verdict, exitCodes and command can be cleared, and shell -> node saves', async () => {
  assert.deepEqual(stripNullKeys({ a: 1, b: null, c: undefined }), { a: 1, c: undefined });
  const full = SHELL_META({ verdict: { filename: 'tests-cycle{cycle}.json' }, exitCodes: { clean: [0], blocking: [1, 2] } });
  const made = await createScript({ meta: full, source: '', by: 'ui' });
  assert.deepEqual(made.meta.verdict, { filename: 'tests-cycle{cycle}.json' });
  assert.deepEqual(made.meta.exitCodes, { clean: [0], blocking: [1, 2] });
  // Omitting a key KEEPS it (the merge); null clears it.
  const kept = await updateScript('tests', { meta: { displayName: 'T2' }, by: 'ui' });
  assert.deepEqual(kept.meta.verdict, { filename: 'tests-cycle{cycle}.json' });
  const cleared = await updateScript('tests', { meta: { verdict: null, exitCodes: null }, by: 'ui' });
  assert.equal(cleared.meta.verdict ?? null, null);
  assert.notDeepEqual(cleared.meta.exitCodes, { clean: [0], blocking: [1, 2] }, 'back to the runtime default');
  // shell -> node: the validator refuses `command` and `exitCodes` on node, so the form sends both as null.
  const node = await updateScript('tests', { meta: { runtime: 'node', command: null, exitCodes: null }, source: SRC, by: 'ui' });
  assert.equal(node.meta.runtime, 'node');
  assert.equal(node.meta.file, 'tests.mjs');
  assert.equal(node.meta.command ?? null, null);
  // inputs/outputs <-> ports:"config" are mutually exclusive in a sidecar: the switch needs the same escape.
  const cfg = await updateScript('tests', { meta: { ports: 'config', defaultPorts: { inputs: [], outputs: [] }, inputs: null, outputs: null }, by: 'ui' });
  assert.equal(cfg.meta.ports, 'config');
  const flat = await updateScript('tests', { meta: { ports: null, defaultPorts: null, inputs: [], outputs: [] }, by: 'ui' });
  assert.equal(flat.meta.ports ?? null, null);
  await deleteScript('tests');
});

test('a key that differs only in CASE is refused: one file holds both on macOS and Windows', async () => {
  await createScript({ meta: NODE_META, source: '// the original\n', by: 'ui' });
  await fails(() => createScript({ meta: { ...NODE_META, key: 'Lint' }, source: '// the second\n' }),
    'DUPLICATE', /a script "lint" already exists — script keys differ only in case/);
  await fails(() => duplicateScript('shell', 'LINT', 'ui'), 'DUPLICATE', /differ only in case/);
  assert.equal(userFiles().some((f) => f.startsWith('Lint') || f.startsWith('LINT')), false);
  assert.equal((await readScript('lint')).source, '// the original\n');
  await deleteScript('lint');
});

test('two saves of ONE script at once: no interleaved rename, and the tree is one writer`s', async () => {
  await createScript({ meta: NODE_META, source: 'v0\n', by: 'ui' });
  const big = (tag) => tag.repeat(20000);
  const rs = await Promise.all([
    updateScript('lint', { meta: { displayName: 'A' }, source: big('A'), by: 'ui' }),
    updateScript('lint', { meta: { displayName: 'B' }, source: big('B'), by: 'ui' }),
  ]);
  assert.equal(userFiles().some((f) => f.includes('.tmp-')), false, 'no .tmp- left behind');
  const onDisk = await readScript('lint');
  const winner = rs.find((r) => r.meta.displayName === onDisk.meta.displayName);
  assert.ok(winner, 'the stored meta is one of the two saves');
  assert.equal(onDisk.source, winner.source, 'the program on disk belongs to the same save as the meta');
  // Same for the cases file: both writes answer, neither renames over the other's temp.
  const mk = (n) => Array.from({ length: 3 }, (_, i) => ({ id: `c${n}_${i}` }));
  const cs = await Promise.all([writeCases('lint', mk(1)), writeCases('lint', mk(2))]);
  const stored = (await readScript('lint')).cases.map((c) => c.id);
  assert.ok(cs.some((r) => r.cases.map((c) => c.id).join() === stored.join()), 'the file holds one whole answered list');
  await deleteScript('lint');
});

test('a program the read had to cut at the cap is never written back (no silent truncation)', async () => {
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  const huge = `${'a'.repeat(MAX_SOURCE_BYTES)}\n// TAIL\n`;
  writeFileSync(join(userScriptsDir(), 'lint.mjs'), huge);
  const read = await readScript('lint');
  assert.equal(read.sourceTruncated, true);
  await fails(() => updateScript('lint', { meta: { displayName: 'Renamed' }, by: 'ui' }), 'BAD_REQUEST', /read short/);
  await fails(() => updateScript('lint', { source: read.source, by: 'ui' }), 'BAD_REQUEST', /read short/);
  await fails(() => duplicateScript('lint', 'lintCopy', 'ui'), 'BAD_REQUEST', /read short/);
  assert.equal(readFileSync(join(userScriptsDir(), 'lint.mjs'), 'utf8'), huge, 'the user`s program is untouched');
  await deleteScript('lint');
});

test('the program read is bounded in BYTES, cut on a character boundary, and covers the .cmd', async () => {
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  // 110 000 three-byte characters: 330 000 bytes, but only 110 000 UTF-16 units, so a
  // slice() by units hands the whole over-cap program back — and can end mid-character.
  writeFileSync(join(userScriptsDir(), 'lint.mjs'), '中'.repeat(110000));
  const read = await readScript('lint');
  assert.equal(read.sourceTruncated, true);
  assert.ok(Buffer.byteLength(read.source, 'utf8') <= MAX_SOURCE_BYTES,
    `the cap is a BYTE cap (got ${Buffer.byteLength(read.source, 'utf8')})`);
  assert.equal(read.source.includes('�'), false, 'the cut never splits a character');
  await deleteScript('lint');
  // The win32 variant rides the same cap: without the flag the page is handed the whole
  // over-cap .cmd and every save is refused with a message naming no remedy.
  await createScript({ meta: SHELL_META({ command: undefined }), source: 'npm test\n', sourceWin32: '@echo off\n', by: 'ui' });
  writeFileSync(join(userScriptsDir(), 'tests.cmd'), `${'b'.repeat(MAX_SOURCE_BYTES)}\r\n`);
  const cmd = await readScript('tests');
  assert.equal(cmd.sourceTruncated, true, 'a truncated .cmd sets the same flag');
  await fails(() => updateScript('tests', { meta: { displayName: 'Renamed' }, by: 'ui' }), 'BAD_REQUEST', /read short/);
  await deleteScript('tests');
  // A program that is NOT over the cap is WHOLE: an incomplete trailing sequence (a
  // latin-1 file, a stray byte) must decode to U+FFFD like every other invalid byte,
  // never disappear. Held back by stream mode, the tail vanished with sourceTruncated
  // false — and the page saves back the text it was handed, so a no-edit Save dropped
  // the last character of the user`s file without a word.
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  writeFileSync(join(userScriptsDir(), 'lint.mjs'), Buffer.concat([Buffer.from('// caf'), Buffer.from([0xE9])]));
  const whole = await readScript('lint');
  assert.equal(whole.sourceTruncated, false, 'a 7-byte program is nowhere near the cap');
  assert.equal(whole.source, '// caf�', `a complete file keeps its last byte (got ${JSON.stringify(whole.source)})`);
  await deleteScript('lint');
});

test('a program that could not be READ is never written back either (an I/O failure is not "no program")', async () => {
  // C30 guards the program that was read SHORT. A read that FAILED (a permission
  // accident, EMFILE under load, a directory in the program`s place) also answered
  // `source: ''` — and a meta-only save of a shell script with an inline command
  // then dropped `file` and DELETED the user`s program. ENOENT stays "no program".
  await createScript({ meta: SHELL_META({ key: 'ro', command: 'echo inline' }), source: 'echo precious\n', by: 'ui' });
  const program = join(userScriptsDir(), 'ro.sh');
  rmSync(program);
  mkdirSync(program);                                  // read() -> EISDIR on every host
  const read = await readScript('ro');
  assert.equal(read.source, '');
  assert.equal(read.sourceUnreadable, true, 'a failed read is flagged, not reported as an empty program');
  await fails(() => updateScript('ro', { meta: { displayName: 'Renamed' }, by: 'ui' }), 'BAD_REQUEST', /could not be read/);
  await fails(() => duplicateScript('ro', 'roCopy', 'ui'), 'BAD_REQUEST', /could not be read/);
  assert.equal(existsSync(program), true, 'the user`s program is untouched');
  rmSync(program, { recursive: true });
  // A program that is simply GONE is still "no program": the save proceeds.
  assert.equal((await readScript('ro')).sourceUnreadable, false);
  await updateScript('ro', { meta: { displayName: 'Renamed' }, by: 'ui' });
  await deleteScript('ro');
});

test('a script whose program is a DIRECTORY is still deletable: the meta never goes alone', async () => {
  // deleteScript does not read the program, so such a script "stays deletable" —
  // but the removals ran without `recursive`, so the meta and the cases were gone
  // and then the program removal THREW: the script vanished from worca, the junk
  // stayed, and the retry answered 404.
  await createScript({ meta: SHELL_META({ key: 'ro2', command: 'echo inline' }), source: 'echo precious\n', by: 'ui' });
  const program = join(userScriptsDir(), 'ro2.sh');
  rmSync(program);
  mkdirSync(join(program, 'junk'), { recursive: true });
  assert.deepEqual(await deleteScript('ro2'), { ok: true });
  assert.equal(await readScript('ro2'), null);
  assert.deepEqual(userFiles().filter((f) => f.startsWith('ro2')), [], 'nothing of the script is left behind');
  assert.equal(existsSync(program), false, 'the junk in the program`s place went with it');
});

test('a saved case survives an edit to its script`s ports: the read is lenient, the next write keeps it', async () => {
  await createScript({ meta: NODE_META, source: SRC, by: 'ui' });
  await writeCases('lint', [{ id: 'c1', name: 'keeps', inputs: { done: { fired: true } }, expect: { verdict: 'clean', fired: ['log'] } }]);
  await updateScript('lint', { meta: { inputs: [], outputs: [{ id: 'report', type: 'md', when: 'always', filename: 'lint-cycle{cycle}.md' }] }, by: 'ui' });
  const read = await readScript('lint');
  assert.deepEqual(read.cases.map((c) => c.id), ['c1'], 'a strict read would drop the whole case — and the page`s next save would delete it');
  assert.deepEqual(read.cases[0].inputs, {});
  assert.deepEqual(read.cases[0].expect, { verdict: 'clean' }, 'an expectation filtered to nothing is dropped — [] would claim "nothing may fire"');
  assert.equal((await writeCases('lint', read.cases)).cases.length, 1);
  await deleteScript('lint');
});

test('a saved case survives the Overview ports switch too (config -> declared ports)', async () => {
  const PORTS = { inputs: [{ id: 'in', type: 'md', required: false }],
    outputs: [{ id: 'out', type: 'md', when: 'always', filename: 'o-cycle{cycle}.md' }] };
  await createScript({ meta: { metaVersion: 2, key: 'sw', runtime: 'node', ports: 'config', defaultPorts: PORTS }, source: SRC, by: 'ui' });
  await writeCases('sw', [{ id: 'c1', name: 'mine', ports: PORTS, inputs: { in: { text: 'hi' } } }]);
  await updateScript('sw', { meta: { ports: null, defaultPorts: null, ...PORTS }, by: 'ui' });
  const read = await readScript('sw');
  assert.deepEqual(read.cases.map((c) => c.id), ['c1'], 'the page showed no cases, and its next save deleted the file');
  assert.equal((await writeCases('sw', read.cases)).cases.length, 1);
  assert.equal(existsSync(join(userScriptsDir(), 'sw.tests.json')), true);
  await deleteScript('sw');
});
