// test/ask-deny-rules.test.mjs — one deny list, one matcher (cascading-settings-design.md D13, §8 test 15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_DENY_RULES, askDenyGlobs, askPathDenied, globMatcher } from '../src/core/ask/deny-rules.mjs';
import { ASK_DENY_RULES as SPAWN_RULES, buildAskSpawnOptions } from '../src/core/ask/spawn.mjs';

const HOME = '/Users/zed';
const W = '/Users/zed/.worca-cc';
// One denied sample per Read(...) rule: a new rule without a case fails the coverage test below.
const CASES = [
  ['Read(//**/worca-cc.db*)', `${W}/worca-cc.db-wal`],
  ['Read(//**/worca.db*)', `${W}/worca.db`],
  ['Read(//**/secrets.json)', '/repo/plugins/p/data/secrets.json'],
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
