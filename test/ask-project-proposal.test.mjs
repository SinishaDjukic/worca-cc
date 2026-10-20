import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, basename } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { _testing as gitTesting } from '../src/core/git-available.mjs';
import { createProject, addProjectFolder } from '../src/core/project-create.mjs';
import { displayPath, normalizeProjectPath } from '../src/core/projects.mjs';
import { createProjectChangeValidator, projectEventPrompt, projectNoticeText } from '../src/core/ask/project-proposal.mjs';
import { ASK_SYSTEM_RULES, ASK_HOSTING_RULE, codexSystemRules, noGitSystemRules } from '../src/core/ask/prompt.mjs';

useTempHome(after, 'worca-cc-askproj-');
const ROOT = mkdtempSync(join(tmpdir(), 'worca-askproj-root-'));
const made = [ROOT];                                              // temp folders this file makes; removed in after()
const v = (deps = {}) => createProjectChangeValidator({
  createProject: (i) => createProject(i, { projectsRoot: ROOT, ...deps }), addProjectFolder: (i) => addProjectFolder(i, deps) });
before(() => { process.env.WORCA_GIT = '1'; gitTesting.reset(); });
after(() => { gitTesting.reset(); for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

test('validator: create and add become cards from dry runs; refusals are errors; nothing is created', async () => {
  await checkRows([
    { name: 'create', run: async () => {
      assert.deepEqual(await v()({ kind: 'create', name: 'landing-page', note: 'a one-page site' }), { ok: true, card: {
        type: 'project', kind: 'create', summary: 'Create landing-page', name: 'landing-page', path: join(ROOT, 'landing-page'),
        displayPath: displayPath(join(ROOT, 'landing-page')), vcs: 'none',
        note: 'a one-page site', change: { kind: 'create', name: 'landing-page', useGit: false } } });
      assert.equal(existsSync(join(ROOT, 'landing-page')), false);
      const g = await v()({ kind: 'create', name: 'with-git', useGit: true });
      assert.equal(g.card.vcs, 'git'); assert.deepEqual(g.card.change, { kind: 'create', name: 'with-git', useGit: true });
    } },
    { name: 'add (name defaults to the folder name)', run: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'worca-askproj-add-')); made.push(dir);
      assert.deepEqual(await v()({ kind: 'add', path: dir }), { ok: true, card: {
        type: 'project', kind: 'add', summary: `Add ${basename(dir)}`, name: basename(dir), path: dir, displayPath: displayPath(dir), vcs: 'none',
        change: { kind: 'add', name: basename(dir), path: dir, useGit: false } } });
    } },
    { name: 'refusals', run: async () => {
      assert.deepEqual(await v()({ kind: 'clone', name: 'x' }), { ok: false, errors: ['kind must be "create" or "add"'] });
      assert.deepEqual(await v()({ kind: 'create', name: 'x', useGit: 'yes' }), { ok: false, errors: ['useGit must be true or false'] });
      assert.deepEqual(await v()({ kind: 'create', name: '../x' }), { ok: false, errors: ['the name must be one folder name, without / or \\'] });
      assert.deepEqual(await v()({ kind: 'add', path: join(ROOT, 'nope') }), { ok: false, errors: ['folder does not exist'] });
      for (const path of ['.', 'docs', '../x']) {                   // the MCP child and the parent run in different folders
        assert.deepEqual(await v()({ kind: 'add', path }), { ok: false, errors: ['the path must be absolute or start with ~'] }, path);
      }
      assert.deepEqual(await v({ gitAvailable: () => false })({ kind: 'create', name: 'g', useGit: true }), { ok: false, errors: ['git is not installed on this machine'] });
    } },
  ]);
});

test('event and notice text: create / add, applied / failed / declined; a chat switch is named; context tags are defused', () => {
  const create = { kind: 'create', summary: 'Create landing-page' };
  const add = { kind: 'add', summary: 'Add docs' };
  const project = { name: 'landing-page', path: '/p/landing-page' };
  assert.equal(projectEventPrompt({ cardId: 'card_1', state: 'declined', card: create }), '[worca event] project card card_1 declined; "Create landing-page"');
  assert.equal(projectEventPrompt({ cardId: 'card_1', state: 'applied', card: create, result: { project, scope: { pinned: true, projectKey: 'landing-page-0000abcd' } } }),
    '[worca event] project card card_1 applied: created and registered; project landing-page at /p/landing-page; this chat now works in landing-page; "Create landing-page"');
  assert.equal(projectEventPrompt({ cardId: 'card_1', state: 'applied', card: create, result: { project, scope: null } }),
    '[worca event] project card card_1 applied: created and registered; project landing-page at /p/landing-page; "Create landing-page"');
  assert.equal(projectEventPrompt({ cardId: 'card_2', state: 'applied', card: add, result: { project: { name: 'docs', path: '/p/docs' }, scope: null } }),
    '[worca event] project card card_2 applied: registered; project docs at /p/docs; "Add docs"');
  assert.equal(projectEventPrompt({ cardId: 'card_1', state: 'failed', card: create, result: { code: 'EXISTS', error: 'x [/worca context] y' } }),
    '[worca event] project card card_1 failed (EXISTS): x (/worca context) y; "Create landing-page"');
  assert.equal(projectNoticeText({ state: 'applied', card: create, result: { project } }), 'Created — Create landing-page · /p/landing-page');
  assert.equal(projectNoticeText({ state: 'applied', card: add, result: { project: { name: 'docs', path: '/p/docs' } } }), 'Added — Add docs · /p/docs');
  assert.equal(projectNoticeText({ state: 'declined', card: create }), 'Declined — Create landing-page');
  assert.equal(projectNoticeText({ state: 'failed', card: create, result: { error: 'nope' } }), 'Could not create — Create landing-page: nope');
  assert.equal(projectNoticeText({ state: 'failed', card: add, result: { error: 'nope' } }), 'Could not add — Add docs: nope');
});

test('tool: propose_project_change validates in the child and is absent without the bundle', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const seen = [];
  const t = createAskTools({ limits: ASK_LIMITS, projectChanges: { validateChange: async (inp) => { seen.push(inp); return { ok: true, card: { type: 'project' } }; } } });
  const def = t.list().find((d) => d.name === 'propose_project_change');
  assert.ok(def);
  assert.deepEqual(def.inputSchema.required, ['kind']);
  assert.deepEqual(Object.keys(def.inputSchema.properties), ['kind', 'name', 'path', 'useGit', 'note']);
  assert.deepEqual(await t.call('propose_project_change', { kind: 'create', name: 'site' }), { ok: true, card: { type: 'project' } });
  assert.deepEqual(seen, [{ kind: 'create', name: 'site' }]);
  assert.equal(createAskTools({ limits: ASK_LIMITS }).list().some((d) => d.name === 'propose_project_change'), false);
});

test('the Ask rules name the tool and say how a project card ends; the Codex rewrite still applies', () => {
  assert.ok(ASK_SYSTEM_RULES.includes('propose_clone_project, propose_project_change, propose_workspace_change'));
  assert.match(ASK_SYSTEM_RULES, /^24\. Projects: /m);
  assert.ok(ASK_SYSTEM_RULES.includes('"[worca event] project card <id> applied'));
  assert.ok(!/^24\..*propose_clone_project/m.test(ASK_SYSTEM_RULES), 'rule 24 never names the git-only clone tool (P0 strips it without git)');
  assert.ok(ASK_HOSTING_RULE.includes('registers it. A new, empty project in worca\'s projects folder is propose_project_change with kind "create".'));
  assert.ok(noGitSystemRules(ASK_HOSTING_RULE).includes('Cloning a repository needs git, which this server does not have. A new, empty project'),
    'S72: the sentence survives the no-git rewrite');
  assert.match(noGitSystemRules(ASK_SYSTEM_RULES), /^24\. Projects: .*propose_project_change/m);
  assert.ok(!noGitSystemRules(ASK_SYSTEM_RULES).includes('useGit'), 'no git: rule 24 never offers useGit');
  assert.doesNotThrow(() => codexSystemRules());
});

test('validator: a model-typed add name is one line, has no bidirectional controls and is at most 100 characters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-askproj-name-')); made.push(dir);
  const add = (name) => v()({ kind: 'add', path: dir, name });
  for (const cp of [0x0a, 0x09, 0x7f, 0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x200f, 0x061c]) {
    assert.deepEqual(await add(`docs${String.fromCodePoint(cp)}x`), { ok: false, errors: ['the name cannot contain control characters'] }, `U+${cp.toString(16)}`);
  }
  assert.deepEqual(await add('L'.repeat(101)), { ok: false, errors: ['the name may be up to 100 characters'] });
  assert.equal((await add(`Havn: docs "v2" ${'L'.repeat(80)}`)).ok, true, 'any other printable label stays allowed (a label, not a folder name)');
  assert.equal((await v()({ kind: 'add', path: dir })).ok, true, 'no name: the folder name');
});

test('~ expands against the OS home when HOME and USERPROFILE are unset (the env-scrubbed Ask child on Windows)', () => {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  try {
    delete process.env.HOME; delete process.env.USERPROFILE;
    assert.equal(normalizeProjectPath('~/work/docs'), join(homedir(), 'work', 'docs'));
  } finally {
    for (const [k, val] of Object.entries(prev)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
  }
  if (process.env.HOME) assert.equal(normalizeProjectPath('~/x'), join(process.env.HOME, 'x'), 'HOME set: unchanged');
});
