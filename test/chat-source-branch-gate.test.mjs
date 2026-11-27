// test/chat-source-branch-gate.test.mjs — the one gate (src/core/chat-source-branch-gate.mjs) that decides which git
// targets of a chat run card have no branch under "Ask me on the card" / "Only when the chat names one": branchNeeds
// against fakes, targetsForBody's never-rejecting resolution, cardBranchGate's top-level mode, and the one-decider grep.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { branchNeeds, cardBranchGate, targetsForBody } from '../src/core/chat-source-branch-gate.mjs';

useTempHome(after);

const T = (key, extra = {}) => ({ key, name: key, path: `/repos/${key}`, row: { key, name: key, path: `/repos/${key}`, vcs: 'git' }, ...extra });
/** Fake deps: per-key modes ({ mode, source }), the user layer under null, everything git unless told otherwise. */
function deps({ modes = {}, user = { mode: 'ask', source: 'default' }, gitOn = true, folder = [], notRepo = [], seen = [] } = {}) {
  return {
    gitOn: () => gitOn,
    modeOf: (key) => { seen.push(key); return key && modes[key] ? modes[key] : user; },
    workModeOf: (t) => (folder.includes(t.key) || !gitOn ? 'folder' : 'git'),
    isGitRepo: (path) => !notRepo.some((k) => path.endsWith(`/${k}`)),
  };
}

test('a git project with no branch: one entry under ask and require, none under current', () => {
  for (const mode of ['ask', 'require']) {
    assert.deepEqual(branchNeeds([T('api')], {}, deps({ modes: { api: { mode, source: 'project' } } })),
      [{ key: 'api', name: 'api', mode, source: 'project' }]);
  }
  assert.deepEqual(branchNeeds([T('api')], {}, deps({ modes: { api: { mode: 'current', source: 'user' } } })), []);
});

test('a card-wide branch covers every target; sourceBranchByKey covers only its member', () => {
  const d = deps();
  assert.deepEqual(branchNeeds([T('api'), T('web')], { sourceBranch: 'dev' }, d), []);
  assert.deepEqual(branchNeeds([T('api'), T('web')], { sourceBranch: '  ' }, d).map((n) => n.key), ['api', 'web'], 'a blank branch is no branch');
  assert.deepEqual(branchNeeds([T('api'), T('web')], { sourceBranchByKey: { api: 'main' } }, d).map((n) => n.key), ['web']);
});

test('Folder, git off and non-repo targets are never in needs, in all 3 modes', () => {
  for (const mode of ['current', 'ask', 'require']) {
    const user = { mode, source: 'user' };
    assert.deepEqual(branchNeeds([T('api')], {}, deps({ user, folder: ['api'] })), []);
    assert.deepEqual(branchNeeds([T('api')], {}, deps({ user, gitOn: false })), []);
    assert.deepEqual(branchNeeds([T('api')], {}, deps({ user, notRepo: ['api'] })), []);
  }
});

test('an unregistered member reads the user layer; a throwing mode read counts as ask', () => {
  const seen = [];
  const out = branchNeeds([T('api', { row: null })], {}, deps({ modes: { api: { mode: 'current', source: 'project' } }, user: { mode: 'require', source: 'user' }, seen }));
  assert.deepEqual(seen, [null]);
  assert.deepEqual(out, [{ key: 'api', name: 'api', mode: 'require', source: 'user' }]);
  const boom = { ...deps(), modeOf: () => { throw new Error('db gone'); } };
  assert.deepEqual(branchNeeds([T('api')], {}, boom), [{ key: 'api', name: 'api', mode: 'ask', source: 'default' }]);
  assert.deepEqual(branchNeeds(null, null, deps()), [], 'no targets, no throw');
});

test('cardBranchGate: the project\'s mode, the user layer\'s for a workspace, and the same needs as branchNeeds', () => {
  const d = deps({ modes: { api: { mode: 'require', source: 'project' }, web: { mode: 'current', source: 'project' } }, user: { mode: 'ask', source: 'user' } });
  assert.deepEqual(cardBranchGate([T('api')], d), { mode: 'require', source: 'project', needs: branchNeeds([T('api')], {}, d) });
  const members = [T('api', { member: true }), T('web', { member: true })];
  const gate = cardBranchGate(members, d);
  assert.deepEqual({ mode: gate.mode, source: gate.source }, { mode: 'ask', source: 'user' });
  assert.deepEqual(gate.needs, [{ key: 'api', name: 'api', mode: 'require', source: 'project' }]);
  assert.deepEqual(cardBranchGate([], d), { mode: 'ask', source: 'user', needs: [] });
});

test('targetsForBody resolves to [] for noProject, an unknown workspace and a missing dir, without rejecting', async () => {
  assert.deepEqual(await targetsForBody({ noProject: true }), []);
  assert.deepEqual(await targetsForBody({ workspaceId: 'wks-nope-00000000' }), []);
  assert.deepEqual(await targetsForBody({ projectDir: join(tmpdir(), 'worca-gate-missing-dir-xyz') }), []);
  assert.deepEqual(await targetsForBody(null), []);
  const dir = mkdtempSync(join(tmpdir(), 'worca-gate-plain-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const [t] = await targetsForBody({ projectDir: dir });
  assert.equal(t.path, dir);
  assert.equal(t.row, null, 'an unregistered dir has no row');
  assert.equal(typeof t.key, 'string');
});

test('R-arch-12: one decider — each gate function is called only by its named callers', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules' || n === 'vendor') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(mjs|js)$/.test(n)) files.push(p); } };
  walk(join(root, 'src')); walk(join(root, 'ui'));
  const callers = (name) => files.filter((f) => readFileSync(f, 'utf8').split('\n')
    .some((line) => line.includes(`${name}(`) && !/export (async )?function/.test(line))).map((f) => relative(root, f).split('\\').join('/')).sort();
  assert.deepEqual(callers('chatSourceBranchMode'), ['src/core/chat-source-branch-gate.mjs']);
  assert.deepEqual(callers('branchNeeds'), ['src/core/ask/proposal.mjs', 'src/core/chat-source-branch-gate.mjs', 'ui/server.mjs']);
  assert.deepEqual(callers('cardBranchGate'), ['ui/routes/new-run/run-defaults.mjs']);
});

test('sourceBranchRefusal: the 400 body names the members by key, in the card\'s words', async () => {
  const { sourceBranchRefusal } = await import('../src/core/chat-source-branch-gate.mjs');
  const needs = [{ key: 'api-1', name: 'api', mode: 'ask', source: 'user' }, { key: 'web-2', name: 'web', mode: 'require', source: 'project' }];
  assert.deepEqual(sourceBranchRefusal(needs.slice(0, 1)), { error: 'Pick a source branch to start this run.', code: 'source-branch-required', members: ['api-1'] });
  assert.deepEqual(sourceBranchRefusal(needs, { workspace: true }), { error: 'Pick a source branch for: api, web.', code: 'source-branch-required', members: ['api-1', 'web-2'] });
});
