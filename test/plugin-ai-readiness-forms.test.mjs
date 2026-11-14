// test/plugin-ai-readiness-forms.test.mjs — the ai-readiness plugin's two ask forms (card A on
// Map, card B on Plan): each passes the shared form gate, and the unattended auto answer over
// realistic data is the detected default — never a heavy item.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFormDef } from '../src/shared/forms/form-def.mjs';
import { autoAnswer, checkAskData, collectAnswer } from '../src/shared/forms/answer.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';
import { visibleFields } from '../src/shared/forms/layout.mjs';
import { promptFields } from '../src/shared/forms/project.mjs';
import { prepareFormAsk } from '../src/core/ask-forms.mjs';
import { createFormAsker } from '../src/cli/forms.mjs';

const meta = (key) => JSON.parse(readFileSync(fileURLToPath(new URL(`../plugins/ai-readiness/agents/${key}.meta.json`, import.meta.url)), 'utf8'));
const form = (key, id) => meta(key).ask.forms[id];
const settled = (def, data) => autoAnswer(def, data);

const CARD_A_DATA = {
  summary: 'A Node CLI and web UI.\nAgents run in worktrees.\nSQLite holds the runs.',
  judgedTools: ['claude', 'codex'],
  toolChoices: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }],
  recurringTasks: [{ id: 'add-setting', name: 'Add a user setting', why: '6 settings follow one shape', example: 'src/core/settings.mjs' }],
  commands: [
    { id: 'install', kind: 'install', command: 'npm ci' },
    { id: 'test', kind: 'test', command: 'node tools/test.mjs' },
  ],
  gotchas: [{ id: 'g1', text: 'Tests need HOME and WORCA_HOME set to a scratch dir.' }],
};

test('card A (readiness-confirm) passes the form gate', () => {
  const r = validateFormDef(form('readinessMap', 'readiness-confirm'), { id: 'readiness-confirm' });
  assert.deepEqual(r.errors || [], [], JSON.stringify(r.errors));
});

const CORRECTION_FIELDS = ['summaryFix', 'tasks', 'missingTasks', 'commands', 'needsToRun', 'gotchas', 'unwritten'];

test('card A asks "Looks right?" first, defaulting to yes', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const s = resolveAnswerSchema(def.answer, CARD_A_DATA);
  assert.deepEqual(s.properties.looksRight.enum, ['yes', 'correct']);
  assert.equal(s.properties.looksRight.default, 'yes');
  assert.ok(s.required.includes('looksRight'));
  const item = def.layout.find((i) => i.field === 'looksRight');
  assert.equal(item.widget, 'select');
  assert.equal(item.label, 'Looks right?');
  assert.deepEqual(item.labels, { yes: 'Yes, keep what you found', correct: 'Let me correct it' });
  // tools, the summary, then the question; the summary fix comes straight after it
  assert.deepEqual(def.layout.slice(0, 4).map((i) => i.field || i.bind), ['tools', 'data.summary', 'looksRight', 'summaryFix']);
});

test('card A with "yes": no per-item list or free text is shown, and Map keeps what it found', () => {
  const def = form('readinessMap', 'readiness-confirm');
  assert.deepEqual(visibleFields(def.layout, { looksRight: 'yes' }), ['tools', 'looksRight']);
  for (const f of CORRECTION_FIELDS) {
    const item = def.layout.find((i) => i.field === f);
    assert.deepEqual(item.when, { looksRight: 'correct' }, `${f} waits for "Let me correct it"`);
  }
});

test('card A with "correct": every list and free text is shown, each item starting at keep', () => {
  const def = form('readinessMap', 'readiness-confirm');
  assert.deepEqual(visibleFields(def.layout, { looksRight: 'correct' }), ['tools', 'looksRight', ...CORRECTION_FIELDS]);
  const fields = promptFields({ data: CARD_A_DATA, layout: def.layout, answerSchema: resolveAnswerSchema(def.answer, CARD_A_DATA) });
  const keep = Object.fromEntries(fields.filter((f) => f.widget === 'review-list').map((f) => {
    const v = f.itemFields.find((x) => x.field === 'verdict');
    return [f.field, [v.default, v.options.find((o) => o.value === v.default).label]];
  }));
  // the stored values stay; only what the user reads changes
  assert.deepEqual(keep, { tasks: ['confirm', 'keep'], commands: ['correct', 'keep'], gotchas: ['confirm', 'keep'] });
});

test('card A unattended: the detected tools and "yes"; nothing else is answered', () => {
  const def = form('readinessMap', 'readiness-confirm');
  assert.equal(checkAskData(def, CARD_A_DATA).ok, true, JSON.stringify(checkAskData(def, CARD_A_DATA).errors));
  assert.deepEqual(settled(def, CARD_A_DATA), { tools: ['claude', 'codex'], looksRight: 'yes' });
});

test('card A shows no "confirm" to the user', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const fields = promptFields({ data: CARD_A_DATA, layout: def.layout, answerSchema: resolveAnswerSchema(def.answer, CARD_A_DATA) });
  const shown = fields.flatMap((f) => [f.label, ...f.options.map((o) => o.label),
    ...(f.itemFields || []).flatMap((x) => [x.label, ...x.options.map((o) => o.label)])]);
  assert.ok(shown.length > 10);
  for (const t of shown) assert.doesNotMatch(String(t), /confirm/i, t);
  assert.doesNotMatch(def.title, /confirm/i);
  const verdictLabels = Object.fromEntries(def.layout.filter((i) => i.widget === 'review-list').map((i) => [i.field, i.labels]));
  assert.deepEqual(verdictLabels, {
    tasks: { confirm: 'keep', remove: 'remove' },
    commands: { correct: 'keep', wrong: 'wrong', slow: 'slow (skip running it)' },
    gotchas: { confirm: 'keep', wrong: 'wrong' },
  });
});

const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-air-forms-'));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

test('card A in the CLI: a "yes" user answers two prompts (tools, Looks right?)', async () => {
  const def = form('readinessMap', 'readiness-confirm');
  const r = await prepareFormAsk({ agentMeta: { ask: { forms: { 'readiness-confirm': def } } }, payload: { form: 'readiness-confirm', data: CARD_A_DATA },
    cwd: scratch, pipelineDir: scratch, askId: 'questions-x:n_map:1-r1-readiness-confirm' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const prompts = [];
  const { askForm } = createFormAsker({ out: () => {}, c: (_k, t) => t, question: async (_rl, p) => { prompts.push(p); return ''; } });
  const { values } = await askForm({ rl: true }, { id: 'q', kind: 'form', agent: 'Map', ...r.ask });
  assert.equal(prompts.length, 2, prompts.join('\n'));
  assert.deepEqual(values, { tools: ['claude', 'codex'], looksRight: 'yes' });
});

test('card A with empty lists is still askable (a bare repository)', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const data = { ...CARD_A_DATA, judgedTools: ['claude'], recurringTasks: [], commands: [], gotchas: [] };
  assert.equal(checkAskData(def, data).ok, true, JSON.stringify(checkAskData(def, data).errors));
  assert.deepEqual(settled(def, data).tools, ['claude']);
});

test('card A takes workspace-prefixed ids longer than 48 characters', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const key = 'customer-billing-service-frontend-app';
  const id = (x) => `${key}:${x}`.padEnd(100, 'x');
  const data = {
    ...CARD_A_DATA,
    recurringTasks: [{ ...CARD_A_DATA.recurringTasks[0], id: id('add-setting') }],
    commands: [{ id: id('install'), kind: 'install', command: 'npm ci' }],
    gotchas: [{ id: id('g1'), text: 'Tests need HOME set.' }],
  };
  assert.equal(checkAskData(def, data).ok, true, JSON.stringify(checkAskData(def, data).errors));
});

test('card A tools enum is the eight engine ids', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const s = resolveAnswerSchema(def.answer, CARD_A_DATA);
  assert.deepEqual(s.properties.tools.items.enum, ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'qwen', 'goose', 'opencode']);
});

test('card A tools defaultFrom is data.judgedTools, and the field says how to turn a tool off', () => {
  const def = form('readinessMap', 'readiness-confirm');
  assert.equal(def.answer.properties.tools.defaultFrom, 'data.judgedTools');
  const field = def.layout.find((f) => f.field === 'tools');
  assert.match(field.help || field.description || '', /Tools this project uses stay on; mark one Not used in Settings › Agent readiness\./);
});

const CARD_B_DATA = {
  scoreLine: '**40/100**, pass mark 80. Claude Code 40 · Codex 0',
  files: [
    { id: 'AGENTS.md', tools: 'Codex, Claude Code', reason: 'the shared core every tool reads' },
    { id: 'CLAUDE.md', tools: 'Claude Code', reason: 'imports AGENTS.md' },
  ],
  existing: [{ id: 'README.md', title: 'README.md (mentions build commands)' }],
  tasks: [{ id: 'add-setting', name: 'Add a user setting', becomes: 'a skill in .agents/skills' }],
  testOptions: [
    { id: 'seed-helpers', label: 'Add tests for 3 pure helpers', adds: 'adds 3 test files, no new dependency' },
    { id: 'none', label: 'No tests', adds: 'adds nothing' },
  ],
  testDefault: 'seed-helpers',
  heavy: [{ id: 'ci', label: 'A CI workflow (.github/workflows)' }],
};

test('card B (readiness-plan) passes the form gate', () => {
  const r = validateFormDef(form('readinessPlan', 'readiness-plan'), { id: 'readiness-plan' });
  assert.deepEqual(r.errors || [], [], JSON.stringify(r.errors));
});

test('card B unattended: every file, only-add for existing files, the default tests, nothing heavy, write', () => {
  const def = form('readinessPlan', 'readiness-plan');
  assert.equal(checkAskData(def, CARD_B_DATA).ok, true, JSON.stringify(checkAskData(def, CARD_B_DATA).errors));
  const v = settled(def, CARD_B_DATA);
  assert.deepEqual(v.files, ['AGENTS.md', 'CLAUDE.md']);
  assert.deepEqual(v.existing, [{ id: 'README.md', verdict: 'only-add' }]);
  assert.deepEqual(v.tasks, [{ id: 'add-setting', verdict: 'repo' }]);
  assert.equal(v.tests, 'seed-helpers');
  assert.deepEqual(v.offLimits ?? [], []);
  assert.equal(v.decision, 'write');
});

test('plan card: each recurring task chooses repo, worca or skip; the default is repo', () => {
  const def = form('readinessPlan', 'readiness-plan');
  const data = { ...CARD_B_DATA, tasks: [{ id: 'add-route', name: 'Add a route', becomes: 'a section in AGENTS.md' }] };
  const answer = autoAnswer(def, data);
  assert.deepEqual(answer.tasks, [{ id: 'add-route', verdict: 'repo' }]);
  const errorsFor = (verdict) => collectAnswer(def, resolveAnswerSchema(def.answer, data), { ...answer, tasks: [{ id: 'add-route', verdict }] }).errors;
  assert.deepEqual(errorsFor('worca'), []);
  assert.ok(errorsFor('cloud').length > 0);
});

test('card B takes workspace-prefixed task and heavy ids of 100 characters', () => {
  const def = form('readinessPlan', 'readiness-plan');
  const id = (x) => `customer-billing-service-frontend-app/${x}`.padEnd(100, 'x');
  const data = {
    ...CARD_B_DATA,
    tasks: [{ ...CARD_B_DATA.tasks[0], id: id('task') }],
    heavy: [{ id: id('ci'), label: 'A CI workflow (.github/workflows)' }],
  };
  assert.equal(checkAskData(def, data).ok, true, JSON.stringify(checkAskData(def, data).errors));
});

test('card B refuses wildcard file ids, takes folder ids and 60 rows', () => {
  const def = form('readinessPlan', 'readiness-plan');
  const withFiles = (files) => checkAskData(def, { ...CARD_B_DATA, files });
  for (const bad of ['api/{.claude,.agents}/skills/*/SKILL.md', 'api/.claude/skills/*/SKILL.md', 'a?.md', 'a[1].md']) {
    assert.equal(withFiles([{ id: bad }]).ok, false, bad);
  }
  assert.equal(withFiles([{ id: 'api/.claude/skills/', tools: 'Claude Code', reason: '4 skills' }]).ok, true);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `api/.claude/rules/r${i}.md` }));
  const r = withFiles(many);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('card B with no existing files, no tasks and nothing heavy is still askable', () => {
  const def = form('readinessPlan', 'readiness-plan');
  const data = { ...CARD_B_DATA, existing: [], tasks: [], heavy: [] };
  assert.equal(checkAskData(def, data).ok, true, JSON.stringify(checkAskData(def, data).errors));
});

test('Score no longer asks; Plan asks, routes proceed|stopped and has a verdict', () => {
  const score = meta('readinessScore');
  assert.equal(score.asksQuestions ?? false, false);
  assert.equal(score.verdict, undefined);
  const plan = meta('readinessPlan');
  assert.equal(plan.asksQuestions, true);
  assert.equal(plan.questionsLocked, true);
  assert.ok(plan.verdict?.filename, 'Plan has a verdict file');
  assert.deepEqual(plan.outputs.map((o) => [o.id, o.when || 'always']), [['plan', 'always'], ['proceed', 'clean'], ['stopped', 'blocking']]);
});

test('card A: an item from worca memory shows its origin', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const data = { ...CARD_A_DATA, gotchas: [
    { id: 'g1', text: 'Run migrations before tests', origin: 'memory:db-migrations.md' },
    { id: 'g2', text: 'Ports 4317-4320 are taken' },
  ] };
  const r = checkAskData(def, data);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  // The review-list widget has no columns: the gotchas list shows the origin as its meta line.
  const list = def.layout.find((i) => i.bind === 'data.gotchas');
  assert.equal(list.metaKey, 'origin', 'the gotchas list shows the origin');
  // Commands have no body line, so it carries the origin.
  assert.equal(def.layout.find((i) => i.bind === 'data.commands').bodyKey, 'origin');
  for (const k of ['recurringTasks', 'commands', 'gotchas']) {
    assert.equal(def.data.properties[k].items.properties.origin.type, 'string', `${k} items carry origin`);
  }
});

test('card A data without toolChoices fails the data validation; with it passes', () => {
  const def = form('readinessMap', 'readiness-confirm');
  const { toolChoices, ...without } = CARD_A_DATA;
  assert.equal(checkAskData(def, without).ok, false);
  assert.equal(checkAskData(def, CARD_A_DATA).ok, true);
});

test('card B lists the three folder rows from a fixture plan', () => {
  const def = form('readinessPlan', 'readiness-plan');
  const data = {
    ...CARD_B_DATA,
    scoreLine: '**40/100**, pass mark 80. Claude Code 40 · OpenAI Codex 0 · GitHub Copilot 0 · Cursor 0 · Gemini CLI 0 · Qwen Code 0 · Goose 0 · OpenCode 0',
    files: [
      { id: 'AGENTS.md', tools: 'Claude Code, OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI, Qwen Code, Goose, OpenCode', reason: 'the shared core every tool reads' },
      { id: 'CLAUDE.md', tools: 'Claude Code', reason: 'exactly @AGENTS.md' },
      { id: 'GEMINI.md', tools: 'Gemini CLI', reason: 'exactly @AGENTS.md' },
      { id: '.claude/skills/', tools: 'Claude Code', reason: '1 skill: the recurring tasks kept in the repository' },
      { id: '.agents/skills/', tools: 'OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI, Goose, OpenCode', reason: '1 skill: the recurring tasks kept in the repository' },
      { id: '.qwen/skills/', tools: 'Qwen Code', reason: '1 skill: the recurring tasks kept in the repository' },
    ],
    tasks: [{ id: 'add-setting', name: 'Add a user setting', becomes: 'a skill in .claude/skills, .agents/skills and .qwen/skills' }],
  };
  const r = checkAskData(def, data);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const folders = settled(def, data).files.filter((id) => id.endsWith('/'));
  assert.deepEqual(folders, ['.claude/skills/', '.agents/skills/', '.qwen/skills/']);
  assert.deepEqual(def.example.files.filter((f) => f.id.endsWith('/')).map((f) => f.id), ['.claude/skills/', '.agents/skills/', '.qwen/skills/'],
    'the form example shows one row per skills folder');
});

test('card B with no existing instruction files can be answered (empty review-list)', () => {
  const def = form('readinessPlan', 'readiness-plan');
  const data = { ...CARD_B_DATA, existing: [] };
  assert.equal(checkAskData(def, data).ok, true, JSON.stringify(checkAskData(def, data).errors));
  const schema = resolveAnswerSchema(def.answer, data);
  const auto = autoAnswer(def, data);
  assert.deepEqual(collectAnswer(def, schema, auto).errors, []);
  // The UI answer carries no `existing` key, or an empty list: both validate.
  const { existing, ...without } = auto;
  assert.deepEqual(collectAnswer(def, schema, without).errors, []);
  assert.deepEqual(collectAnswer(def, schema, { ...without, existing: [] }).errors, []);
});
