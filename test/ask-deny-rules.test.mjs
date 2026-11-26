// test/ask-deny-rules.test.mjs — one deny list, one matcher (cascading-settings-design.md D13, §8 test 15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_DENY_RULES, RUN_READ_DENY_RULES, REQUIREMENTS_READ_DENY_RULES, askDenyGlobs, askPathDenied, globMatcher } from '../src/core/ask/deny-rules.mjs';
import { ASK_DENY_RULES as SPAWN_RULES, buildAskSpawnOptions } from '../src/core/ask/spawn.mjs';

const HOME = '/Users/zed';
const W = '/Users/zed/.worca-cc';
// One denied sample per Read(...) rule: a new rule without a case fails the coverage test below.
const CASES = [
  ['Read(//**/worca-cc.db*)', `${W}/worca-cc.db-wal`],
  ['Read(//**/worca.db*)', `${W}/worca.db`],
  ['Read(//**/secrets.json)', '/repo/plugins/p/data/secrets.json'],
  ['Read(//**/proxy-login.json*)', '/srv/worca/proxy-login.json'],
  ['Read(//**/worca-vault*)', '/srv/worca/worca-vault.enc'],
  ['Read(//**/.env*)', '/repo/sub/.env.local'],
  ['Read(//**/.worca-cc/settings.json)', `${W}/settings.json`],
  ['Read(//**/.worca-cc/store/**)', `${W}/store/k/run/log.txt`],
  ['Read(//**/.worca-cc/runs/**)', `${W}/runs/r1/checkout/a.js`],
  ['Read(//**/.worca-cc/plugins/**)', `${W}/plugins/p/manifest.json`],
  ['Read(//**/.worca-cc/tmp/**)', `${W}/tmp/ask/mcp-askm_00000001.json`],
  ['Read(//**/.worca-cc/logs/**)', `${W}/logs/ask-web.jsonl`],
  ['Read(//**/.worca-cc/mcp/**)', `${W}/mcp/servers.json`],
  ['Read(//**/.worca-cc/skills/**)', `${W}/skills/library/demo/SKILL.md`],
  ['Read(~/.ssh/**)', `${HOME}/.ssh/id_ed25519`],
  ['Read(~/.aws/**)', `${HOME}/.aws/credentials`],
  ['Read(~/.gnupg/**)', `${HOME}/.gnupg/pubring.kbx`],
  ['Read(~/.kube/**)', `${HOME}/.kube/config`],
  ['Read(~/.docker/**)', `${HOME}/.docker/config.json`],
  ['Read(~/.claude/**)', `${HOME}/.claude/.credentials.json`],
  ['Read(~/.netrc)', `${HOME}/.netrc`],
  ['Read(~/.npmrc)', `${HOME}/.npmrc`],
  ['Read(~/.config/gh/**)', `${HOME}/.config/gh/hosts.yml`],
  ['Read(//proc/**)', '/proc/1/environ'],
  ['Read(//run/secrets/**)', '/run/secrets/worca_broker_secret'],
  ['Read(//var/run/secrets/**)', '/var/run/secrets/worca_broker_secret'],
  ['Read(//worca/egress/**)', '/worca/egress/settings.json'],
];

test('spawn.mjs re-exports the one list: the Claude permission rules are the same array, same order', () => {
  assert.equal(SPAWN_RULES, ASK_DENY_RULES);
  const o = buildAskSpawnOptions({ thread: { id: 'ask_00000001' }, turn: {}, limits: {}, mcpConfigPath: '/x/mcp.json', scratchDir: '/x' });
  assert.deepEqual(o.permissionRules.deny, [...ASK_DENY_RULES]);
});

test('every Read rule has a case; tool-only rules carry no path', () => {
  const reads = ASK_DENY_RULES.filter((r) => r.startsWith('Read('));
  assert.deepEqual(CASES.map(([r]) => r).sort(), [...reads].sort());
  assert.equal(askDenyGlobs({ home: HOME }).length, reads.length);
});

test('each rule denies its sample, and askPathDenied names the first denying rule in list order', () => {
  for (const [rule, path] of CASES) assert.equal(askPathDenied(path, { home: HOME }), rule, path);
});

test('the chat roots and look-alike names stay readable', () => {
  for (const p of [
    `${W}/ask/ask_00000001/wt/w1/src/a.mjs`,
    `${W}/ask/ask_00000001/att/att_00000001.png`,
    `${W}/ask/memory/global/.claude/rules/worca/global/style.md`,
    '/repo/environment.md',
    '/repo/docs/secrets.json.md',
    `${HOME}/.sshd_config_notes`,
  ]) assert.equal(askPathDenied(p, { home: HOME }), null, p);
});

test('globMatcher: ** spans folders (a trailing /** also matches the folder), * and ? stay in one segment', () => {
  assert.ok(globMatcher('/**/x.db*').test('/a/b/x.db-shm'));
  assert.ok(globMatcher('/a/**').test('/a'));
  assert.ok(globMatcher('/a/**').test('/a/b/c'));
  assert.ok(!globMatcher('/a/*.js').test('/a/b/c.js'));
  assert.ok(globMatcher('/a/?.js').test('/a/b.js'));
  assert.ok(globMatcher('/r/**/*.mjs').test('/r/x.mjs'));
});

test('globMatcher: case-insensitive matching folds exactly as a regex i flag does, non-ASCII included', () => {
  for (const [g, p] of [['/a/ς', '/a/σ'], ['/a/ς', '/a/Σ'], ['/a/µ', '/a/μ'], ['/a/?', '/a/İ'], ['/a/k', '/a/\u212a'], ['/a/s', '/a/ſ'], ['/A/B', '/a/b']]) {
    assert.equal(globMatcher(g, { caseInsensitive: true }).test(p), new RegExp(`^${g.replace('?', '[^/]')}$`, 'i').test(p), `${g} ~ ${p}`);
  }
});

test('globMatcher: a glob the model writes never backtracks — *a*a*… against a long name is instant', () => {
  const name = `/b/${'a'.repeat(60)}`;
  const t0 = Date.now();
  assert.equal(globMatcher(`/b/${'*a'.repeat(40)}z`).test(name), false);
  assert.equal(globMatcher(`/**/${'**a'.repeat(40)}`).test(name), true);
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
});

// Windows: a drive path (C:\…) has no POSIX root, so the `//**/…` rules once matched nothing there and the Copilot /
// Codex files server read .env and secrets.json under its roots. The same samples, written as Windows paths under a
// Windows home, must be denied by the same rule, on every platform (the matcher is plain string work).
const WIN_HOME = String.raw`C:\Users\zed`;
const win = (p) => (p.startsWith(HOME) ? WIN_HOME + p.slice(HOME.length) : `C:${p}`).replaceAll('/', '\\');

test('Windows drive paths: each rule denies its sample written as a C: path, under a Windows home', () => {
  for (const [rule, path] of CASES) {
    if (['Read(//proc/**)', 'Read(//run/secrets/**)', 'Read(//var/run/secrets/**)', 'Read(//worca/egress/**)'].includes(rule)) continue; // POSIX root folders, not a folder on every drive
    assert.equal(askPathDenied(win(path), { home: WIN_HOME }), rule, win(path));
  }
  assert.equal(askPathDenied('c:/repo/sub/.env', { home: WIN_HOME }), 'Read(//**/.env*)', 'a lower-case drive letter');
  assert.equal(askPathDenied(String.raw`D:\work\plugins\p\data\secrets.json`, { home: WIN_HOME }), 'Read(//**/secrets.json)', 'another drive');
  assert.equal(askPathDenied(String.raw`\\server\share\repo\.env`, { home: WIN_HOME }), 'Read(//**/.env*)', 'a UNC path');
});

test('Windows drive paths: look-alike names and a drive folder named proc stay readable', () => {
  for (const p of [String.raw`C:\repo\environment.md`, String.raw`C:\repo\docs\secrets.json.md`, String.raw`C:\proc\notes.md`, win(`${HOME}/.sshd_config_notes`)]) {
    assert.equal(askPathDenied(p, { home: WIN_HOME }), null, p);
  }
});

test('Windows: the ~/ globs sit under the rooted home; extended-length and device paths name the same files', () => {
  const ssh = askDenyGlobs({ home: 'C:\\Users\\zed\\' }).find((g) => g.rule === 'Read(~/.ssh/**)');
  assert.equal(ssh.glob, '/C:/Users/zed/.ssh/**');
  assert.equal(askPathDenied(String.raw`\\?\C:\Users\zed\.ssh\id_ed25519`, { home: WIN_HOME }), 'Read(~/.ssh/**)');
  assert.equal(askPathDenied(String.raw`\\.\C:\Users\zed\.aws\credentials`, { home: WIN_HOME }), 'Read(~/.aws/**)');
  assert.equal(askPathDenied(String.raw`\\?\UNC\server\share\repo\.env`, { home: WIN_HOME }), 'Read(//**/.env*)');
  assert.equal(askPathDenied(String.raw`\\?\C:\repo\notes.md`, { home: WIN_HOME }), null);
});
test('Worca\'s secret files are denied under ~/.worca-cc and a custom home, by all three lists', () => {
  const paths = [`${W}/proxy-login.json`, '/srv/worca/proxy-login.json', '/srv/worca/worca-vault.enc',
    '/srv/worca/worca-vault.enc.1a2b3c4d.tmp', '/srv/worca/worca-vault.enc.unreadable-20261121T101500Z', '/srv/worca/worca-vault.key'];
  for (const rules of [ASK_DENY_RULES, RUN_READ_DENY_RULES, REQUIREMENTS_READ_DENY_RULES]) {
    for (const p of paths) assert.ok(askPathDenied(p, { rules, home: HOME }), p);
  }
});

test('container secret files are denied through /run and its /var/run alias, and through the sidecar data dir', () => {
  for (const p of ['/run/secrets/worca_egress_secret', '/var/run/secrets/worca_egress_secret', '/var/run/secrets/sub/key.pem']) {
    for (const rules of [ASK_DENY_RULES, RUN_READ_DENY_RULES, REQUIREMENTS_READ_DENY_RULES]) assert.ok(askPathDenied(p, { rules, home: HOME }), p);
  }
  assert.equal(askPathDenied('/var/run/secrets/x', { home: HOME }), 'Read(//var/run/secrets/**)');
  assert.ok(askPathDenied('/worca/egress/proxy-login.json', { home: HOME }));
  for (const p of ['/var/run/docker.sock.md', '/srv/run/secrets.md', '/repo/var/run/notes.md']) assert.equal(askPathDenied(p, { home: HOME }), null, p);
});
