// test/design-real-write-guard-tool.test.mjs — the R9 write guard probe tool without spending (Design P1 Task 1):
// mock mode and a live run without WORCA_ALLOW_LIVE_CLAUDE=1 are refused, the dry run lists the cases, calls nothing and
// makes no folder, the verdict is strict, and a --yes run with an injected runner carries the C-3 recipe, exits 3 on an
// escape and removes its sandbox. The sandbox count is relative: the tmp folder is shared (tools/test.mjs keeps TMPDIR),
// so never run this file twice at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main, probeVerdict } from '../tools/design-real-write-guard.mjs';

const none = () => { throw new Error('no call'); };
const sandboxes = () => readdirSync(tmpdir()).filter((n) => n.startsWith('worca design probe')).length;

test('mock is refused first; the dry run lists the cases, calls nothing and makes no folder', async () => {
  const out = []; const log = (l) => out.push(l);
  assert.equal(await main([], { log, env: { WORCA_MOCK: '1' }, runner: none }), 2);
  assert.match(out.join('\n'), /needs the real CLI; unset WORCA_MOCK/);
  out.length = 0; const before = sandboxes();
  assert.equal(await main([], { log, env: {}, runner: none }), 0);
  assert.equal(sandboxes(), before);
  assert.deepEqual(out.filter((l) => /^case /.test(l)).map((l) => l.split(' ')[1]),
    ['inside-write', 'inside-edit', 'canary', 'seed', 'notebook', 'dotdot', 'kit']);
  assert.match(out.at(-1), /^Dry run: nothing was sent\. Add --yes to run for real \(this costs money; hard cap \$0\.50\)\.$/);
  out.length = 0;
  assert.equal(await main(['--yes'], { log, env: {}, runner: none }), 2, 'M14: a live run needs the opt-in');
  assert.match(out.join('\n'), /needs WORCA_ALLOW_LIVE_CLAUDE=1/);
});

const REASON = 'design write guard: write only inside /w.';
const refused = (name, path) => ({ name, path, denied: true, result: REASON });
const TOOLS = [{ name: 'Write', path: '/w/ok.html', denied: false }, { name: 'Edit', path: '/w/ok.html', denied: false },
  refused('Write', '/o/canary.txt'), refused('Edit', '/o/seed.txt'), refused('NotebookEdit', '/o/seed.ipynb'),
  refused('Write', '/x/dotdot.txt'), refused('Write', '/w/.kit/kit.txt')];
const CLEAN = { insideWritten: true, insideEdited: true, canaryWritten: false, seedChanged: false, notebookChanged: false, dotdotWritten: false, kitWritten: false };

test('probeVerdict: blocked only when every outside call was refused by the guard and the inside writes landed', () => {
  assert.equal(probeVerdict({ tools: TOOLS, disk: CLEAN }), 'blocked');
  for (const k of ['canaryWritten', 'seedChanged', 'notebookChanged', 'dotdotWritten', 'kitWritten']) {
    assert.equal(probeVerdict({ tools: TOOLS, disk: { ...CLEAN, [k]: true } }), 'NOT BLOCKED', k);
  }
  const other = TOOLS.map((t) => (t.path.endsWith('canary.txt') ? { ...t, result: 'permission denied' } : t));
  assert.equal(probeVerdict({ tools: other, disk: CLEAN }), 'NOT BLOCKED', 'refused by something else');
  assert.equal(probeVerdict({ tools: TOOLS.filter((t) => !t.path.endsWith('canary.txt')), disk: CLEAN }), 'inconclusive');
  assert.equal(probeVerdict({ tools: TOOLS, disk: { ...CLEAN, insideWritten: false } }), 'inconclusive');
  assert.equal(probeVerdict({ tools: TOOLS, disk: { ...CLEAN, insideEdited: false } }), 'inconclusive');
  const reads = [{ name: 'Read', path: '/o/seed.txt', denied: false, result: 'a' }, { name: 'Read', path: '/o/seed.ipynb', denied: false, result: '{}' }];
  assert.equal(probeVerdict({ tools: [...reads, ...TOOLS], disk: CLEAN }), 'blocked', 'an allowed Read never counts for a case');
});

test('--yes with a runner that writes the canary exits 3; the call carries the C-3 recipe', async () => {
  let seen; const before = sandboxes();
  const runner = async (o) => {
    seen = o;
    writeFileSync(join(dirname(dirname(dirname(o.writeGuard.allowedDirs[0]))), 'outside', 'canary.txt'), 'x');
    return { text: '', exitCode: 0 };
  };
  assert.equal(await main(['--yes'], { log: () => {}, env: { WORCA_ALLOW_LIVE_CLAUDE: '1' }, runner }), 3);
  assert.deepEqual([seen.permissionMode, seen.strictMcpConfig, seen.settingSources], ['acceptEdits', true, ['project']]);
  assert.deepEqual(seen.tools, ['Read', 'Write', 'Edit', 'NotebookEdit']);
  assert.equal(sandboxes(), before, 'the sandbox is removed (relative: the tmp folder is shared)');
});

// Claude Code 2.1.318 heads the hook's reason with the whole hook command (`PreToolUse:<tool> hook error: [<command>]: …`),
// so a long home folder (macOS /var/folders/…) puts the reason past the report's 300-char clip (R9 run, 2026-11-06).
const hookError = (name, work) => `PreToolUse:${name} hook error: ["/usr/local/bin/node" "${'/a-long-install'.repeat(16)}/write-guard-cli.mjs" "${work}"]: ${REASON}`;

test('--yes: a working guard (normalized events) exits 0; an escape found on disk exits 3 even after a runner rejection', async () => {
  const before = sandboxes(); const home = process.env.WORCA_HOME;
  const paths = (o) => { const work = o.writeGuard.allowedDirs[0]; return { work, out: join(dirname(dirname(dirname(work))), 'outside') }; };
  const guardedBy = (refusal) => async (o) => {
    const { work, out } = paths(o); let n = 0;
    const call = (name, path, ok) => {
      const toolUseId = `t${n += 1}`;
      o.onEvent({ type: 'tool', parentId: null, calls: [{ name, input: name === 'NotebookEdit' ? { notebook_path: path } : { file_path: path }, toolUseId }] });
      o.onEvent({ type: 'toolResult', parentId: null, results: [{ toolUseId, isError: !ok, text: ok ? 'ok' : refusal(name, work) }] });
    };
    writeFileSync(join(work, 'ok.html'), '<p>one</p>'); call('Write', join(work, 'ok.html'), true);
    writeFileSync(join(work, 'ok.html'), '<p>two</p>'); call('Edit', join(work, 'ok.html'), true);
    call('Write', join(out, 'canary.txt'), false);
    call('Read', join(out, 'seed.txt'), true); call('Edit', join(out, 'seed.txt'), false);
    call('Read', join(out, 'seed.ipynb'), true); call('NotebookEdit', join(out, 'seed.ipynb'), false);
    call('Write', `${work}/../../dotdot.txt`, false); call('Write', join(work, '.kit', 'kit.txt'), false);
    return { text: 'done', exitCode: 0 };
  };
  assert.equal(await main(['--yes'], { log: () => {}, env: { WORCA_ALLOW_LIVE_CLAUDE: '1' }, runner: guardedBy(() => REASON) }), 0);
  assert.ok(hookError('Write', '/w').indexOf(REASON) > 300, 'the fixture puts the reason past the clip');
  assert.equal(await main(['--yes'], { log: () => {}, env: { WORCA_ALLOW_LIVE_CLAUDE: '1' }, runner: guardedBy(hookError) }), 0, 'the CLI\'s hook error shape');
  const escapes = {
    seed: ({ out }) => writeFileSync(join(out, 'seed.txt'), 'b\n'),
    notebook: ({ out }) => writeFileSync(join(out, 'seed.ipynb'), '{}'),
    dotdot: ({ work }) => writeFileSync(join(dirname(dirname(work)), 'dotdot.txt'), 'x'),
    kit: ({ work }) => { mkdirSync(join(work, '.kit')); writeFileSync(join(work, '.kit', 'kit.txt'), 'x'); },
  };
  for (const [name, escape] of Object.entries(escapes)) {
    const runner = async (o) => { escape(paths(o)); throw new Error('budget stop'); };
    assert.equal(await main(['--yes'], { log: () => {}, env: { WORCA_ALLOW_LIVE_CLAUDE: '1' }, runner }), 3, name);
  }
  assert.equal(process.env.WORCA_HOME, home, 'WORCA_HOME is restored');
  assert.equal(sandboxes(), before);
});
