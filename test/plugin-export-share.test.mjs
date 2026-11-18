// test/plugin-export-share.test.mjs — under agent isolation a new plugin version dir is
// group read-only after setup (MCP registry spec §14: agents run plugin stdio servers
// from versions/<sha7>; the server's umask 0007 would leave it group-writable).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { JIRA, writeMcpPlugin } from './helpers/mcp-plugin-fixture.mjs';
import { installPlugin, uninstallPlugin, updatePlugin } from '../src/core/plugin-store.mjs';
import { pluginCurrentDir, pluginDir } from '../src/core/plugins-lock.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-share-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const NAME = 'share-tools';
const repo = writeMcpPlugin(join(scratch, 'repo'), {
  name: NAME,
  files: {
    'worca-cc-plugin.json': JSON.stringify({ name: NAME, version: '1.0.0', engines: { 'worca-cc-api': '>=5 <6' }, setup: { node: true }, mcpServers: { jira: JIRA } }),
    'package.json': JSON.stringify({ name: NAME, version: '1.0.0' }),
    'package-lock.json': JSON.stringify({ name: NAME, lockfileVersion: 3, packages: { '': { name: NAME } } }),
  },
});

/** npm as runNpm starts it: `npm` (POSIX), node with npm-cli.js, or one `npm …` command line (Windows). */
const isNpm = (cmd, args) => cmd === 'npm' || /^npm /.test(cmd) || /npm-cli\.js$/i.test(args?.[0] ?? '');
/** git/tar/chmod pass through; npm ci is faked (writes node_modules under the current umask). */
function makeExec() {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push([cmd, ...(args ?? [])]);
    if (isNpm(cmd, args)) {
      mkdirSync(join(opts.cwd, 'node_modules', 'dep'), { recursive: true });
      writeFileSync(join(opts.cwd, 'node_modules', 'dep', 'index.js'), '');
      return { stdout: '', stderr: '' };
    }
    return execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
  };
  return { calls, exec };
}
const groupBits = (p) => (statSync(p).mode & 0o070).toString(8);
// POSIX modes and groups; as root, agentIdentity() ignores gid 0 and no chgrp would run.
const POSIX = { skip: process.platform === 'win32' ? 'chmod/chgrp are POSIX' : process.getgid() === 0 ? 'gid 0 is never the agents\' group' : false };

test('agent isolation: install and update share versions/<sha7> read-only in the agents\' group, node_modules included; no isolation: untouched', POSIX, async () => {
  const git = (...a) => execFileP('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  await execFileP('git', ['init', '-q', '-b', 'main', repo]);
  await git('add', '-A');
  await git('commit', '-qm', 'c1');
  const sha = (await git('rev-parse', 'HEAD')).stdout.trim();
  const prevMask = process.umask(0o007);   // the container server's umask
  const ISO = { WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: join(scratch, 'agent-home'), WORCA_AGENT_GID: String(process.getgid()) };
  const G = ISO.WORCA_AGENT_GID;
  try {
    Object.assign(process.env, ISO);
    const shared = makeExec();
    await installPlugin({ repoUrl: repo, subdir: '', name: NAME, sha }, { exec: shared.exec });
    const cur = pluginCurrentDir(NAME);
    assert.equal(groupBits(join(cur, 'node_modules', 'dep')), '50', 'dir: group r-x');
    assert.equal(groupBits(join(cur, 'node_modules', 'dep', 'index.js')), '40', 'file: group r--');
    assert.equal(groupBits(join(cur, 'mcp', 'jira.mjs')), '40');
    const [pdir, versions] = [pluginDir(NAME), join(pluginDir(NAME), 'versions')];
    const vdir = join(versions, sha.slice(0, 7));
    const share = shared.calls.filter((c) => c[0] === 'chgrp' || c[0] === 'chmod');
    assert.deepEqual(share, [
      ['chmod', '0710', pdir], ['chmod', 'g-w,g+rX', versions], ['chmod', '-R', 'g-w,g+rX', vdir],
      ['chgrp', G, pdir, versions], ['chgrp', '-R', G, vdir],
    ], 'modes first (never a group-writable moment), then the agents\' group: the entrypoint shares only what exists at boot');
    assert.ok(shared.calls.findIndex((c) => isNpm(c[0], c.slice(1))) < shared.calls.indexOf(share[0]), 'after setup, so dependencies are covered');
    assert.equal(groupBits(pdir), '10', 'plugins/<p>/: traverse only, never group-writable');

    await uninstallPlugin(NAME, { purge: true });
    for (const k of Object.keys(ISO)) delete process.env[k];
    const plain = makeExec();
    await installPlugin({ repoUrl: repo, subdir: '', name: NAME, sha }, { exec: plain.exec });
    assert.ok(!plain.calls.some((c) => c[0] === 'chmod' || c[0] === 'chgrp'), 'a local install changes no modes or groups');
    assert.equal(groupBits(join(pluginCurrentDir(NAME), 'node_modules', 'dep')), '70');

    Object.assign(process.env, ISO, { WORCA_AGENT_GID: '' });   // no agents' group known: modes only
    writeFileSync(join(repo, 'mcp', 'jira.mjs'), '// v2\n');
    await git('commit', '-qam', 'c2');
    const upd = makeExec();
    await updatePlugin(NAME, { exec: upd.exec });
    assert.equal(groupBits(join(pluginCurrentDir(NAME), 'node_modules', 'dep')), '50', 'an update\'s new version too');
    assert.ok(!upd.calls.some((c) => c[0] === 'chgrp'), 'no gid: no chgrp');
  } finally {
    process.umask(prevMask);
    for (const k of Object.keys(ISO)) delete process.env[k];
  }
});
