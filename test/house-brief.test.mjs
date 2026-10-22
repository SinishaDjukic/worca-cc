// test/house-brief.test.mjs — the deterministic house brief (slice 2): sources, word budget, pins, hash gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { memoryRoot, projectScope, writeMemory } from '../src/core/memory-store.mjs';
import { projectStorePath } from '../src/core/store.mjs';
import { proseWords } from '../src/shared/human-estimate.mjs';
import {
  ensureHouseBrief, renderHouseBrief, isKnownBugMemory, endpointLines, tokenLines, planLine, claudeMdLines,
  componentLine, cardTypeNames, workflowLines, normalisePins, writeHouseBriefPins, HOUSE_BRIEF_WORD_BUDGET, HOUSE_BRIEF_FILE,
} from '../src/core/house-brief.mjs';

useTempHome(after);
let n = 0;
const KEY = () => `fixture-${String(++n).padStart(8, '0')}`;
const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const memo = (name, description, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody of ${name}.\n`;

async function fixture() {
  const key = KEY();
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-house-brief-'));
  put(dir, 'CLAUDE.md', '# Rules\n\nUse 4px corners on controls.\n```\nnpm test\n```\n<!-- worca-cc:context:begin p1 -->\nRun-only text\n<!-- worca-cc:context:end -->\n');
  put(dir, 'ui/public/style.css', '/* tokens */\n:root{\n  --r-sm:4px;\n  --ink:light-dark(#111,#eee);\n}\n:root[data-theme="dark"]{color-scheme:dark;}\n');
  put(dir, 'ui/public/shape/check-row.mjs', "// ui/public/shape/check-row.mjs — the shape check row: chips per check. More text.\nregisterChatCard('receipt', build);\n");
  put(dir, 'ui/server.mjs', "// GET /api/things — list the things.\napp.get('/api/things', h);\napp.post('/api/run', express.json({ limit: '1mb' }));\napp.post('/api/run', h);\n");
  put(dir, 'src/core/graph/builtin-workflows.mjs', "export const SHAPE_WORKFLOW_ID = 'wf_shape';\nexport const SHAPE_WORKFLOW_NAME = 'Shaper';\n");
  put(dir, 'plans/fit-review-design.md', '# Fit review\n\nStatus: draft\n\nThe fit reviewer checks a plan against the brief. More.\n');
  put(dir, 'plans/old-design.md', '# Old thing\n\nStatus: **implemented** (branch x)\n');
  const scope = projectScope(key);
  await writeMemory(memoryRoot(), scope, 'graph-workflow-traps', memo('graph-workflow-traps', 'Traps when editing graph workflows'), { source: 'test' });
  await writeMemory(memoryRoot(), scope, 'run-worktree-node-modules', memo('run-worktree-node-modules', 'Read before running tests in a run worktree'), { source: 'test' });
  return { key, dir };
}

test('built from fixture sources it lists memory, CLAUDE.md, tokens, components, card types, endpoints, workflows and open specs', async () => {
  const { key, dir } = await fixture();
  const b = await ensureHouseBrief({ projectKey: key, projectDir: dir });
  assert.equal(b.rebuilt, true);
  for (const heading of ['## Known bugs (memory traps)', '## Project instructions (CLAUDE.md)', '## Memory', '## Open specs (plans/)',
    '## Design tokens (style.css)', '## Workflows', '## Card types', '## Components', '## Endpoints']) assert.ok(b.brief.includes(heading), heading);
  assert.match(b.brief, /## Known bugs \(memory traps\)\n- graph-workflow-traps — Traps when editing graph workflows/);
  assert.match(b.brief, /## Memory\n- run-worktree-node-modules — Read before running tests/);
  assert.match(b.brief, /- Use 4px corners on controls\./);
  assert.doesNotMatch(b.brief, /npm test|Run-only text/);
  assert.match(b.brief, /- --r-sm: 4px/);
  assert.match(b.brief, /- ui\/public\/shape\/check-row\.mjs — the shape check row: chips per check\./);
  assert.match(b.brief, /- receipt \(ui\/public\/shape\/check-row\.mjs\)/);
  assert.match(b.brief, /- GET \/api\/things — list the things\./);
  assert.equal((b.brief.match(/POST \/api\/run/g) || []).length, 1);
  assert.match(b.brief, /- wf_shape — Shaper \(src\/core\/graph\/builtin-workflows\.mjs\)/);
  assert.match(b.brief, /- Fit review — The fit reviewer checks a plan against the brief\. \(plans\/fit-review-design\.md\)/);
  assert.doesNotMatch(b.brief, /Old thing/);
  assert.ok(b.words <= HOUSE_BRIEF_WORD_BUDGET);
  assert.equal(b.words, proseWords(b.brief));
  assert.deepEqual(b.sources.map((s) => s.kind), ['memory', 'claude-md', 'tokens', 'components', 'endpoints', 'workflows', 'plans']);
  assert.ok(b.sources.every((s) => !Number.isNaN(Date.parse(s.readAt))));
});

test('over budget: endpoints are trimmed before components, pins are kept, the count is reported', () => {
  const lines = {
    memory: ['m — a memory line'],
    components: Array.from({ length: 200 }, (_, i) => `ui/c${i}.mjs — a component that does one thing well`),
    endpoints: Array.from({ length: 600 }, (_, i) => `GET /api/e${i} — returns the thing number ${i}`),
  };
  const r = renderHouseBrief(lines, ['Never add a second check-row component.'], { budget: 2000 });
  assert.ok(r.words <= 2000);
  assert.equal(r.words, proseWords(r.text));
  assert.equal(r.trimmed.bySection.endpoints, 600);
  assert.ok(r.trimmed.bySection.components > 0 && r.trimmed.bySection.components < 200);
  assert.equal(r.trimmed.lines, r.trimmed.bySection.endpoints + r.trimmed.bySection.components);
  assert.match(r.text, /^# House brief\n\n## Pinned\n- Never add a second check-row component\./);
  assert.match(r.text, /- m — a memory line/);
});

test('this repo builds within 2,000 words', async () => {
  const b = await ensureHouseBrief({ projectKey: KEY(), projectDir: process.cwd() });
  assert.ok(b.words > 0 && b.words <= HOUSE_BRIEF_WORD_BUDGET, String(b.words));
  assert.ok(b.trimmed.lines > 0);
});

test('a pinned line survives a refresh after a source file changes', async () => {
  const { key, dir } = await fixture();
  writeHouseBriefPins(key, ['Reuse ui/public/shape/check-row.mjs for every check row.']);
  const first = await ensureHouseBrief({ projectKey: key, projectDir: dir });
  put(dir, 'ui/server.mjs', "app.get('/api/brand-new', h);\n");
  const second = await ensureHouseBrief({ projectKey: key, projectDir: dir, now: () => new Date('2030-01-01T00:00:00Z') });
  assert.equal(second.rebuilt, true);
  assert.notEqual(second.sourceHash, first.sourceHash);
  assert.match(second.brief, /## Pinned\n- Reuse ui\/public\/shape\/check-row\.mjs for every check row\./);
  assert.match(second.brief, /GET \/api\/brand-new/);
  assert.equal(second.builtAt, '2030-01-01T00:00:00.000Z');
});

test('an unchanged source hash does not rebuild', async () => {
  const { key, dir } = await fixture();
  const first = await ensureHouseBrief({ projectKey: key, projectDir: dir, now: () => new Date('2030-01-01T00:00:00Z') });
  const second = await ensureHouseBrief({ projectKey: key, projectDir: dir, now: () => new Date('2031-01-01T00:00:00Z') });
  assert.equal(second.rebuilt, false);
  assert.equal(second.builtAt, first.builtAt);
  assert.equal(second.brief, first.brief);
  const forced = await ensureHouseBrief({ projectKey: key, projectDir: dir, force: true, now: () => new Date('2031-01-01T00:00:00Z') });
  assert.equal(forced.rebuilt, true);
  assert.equal(forced.builtAt, '2031-01-01T00:00:00.000Z');
});

test('no sources: an empty brief, stored, no throw', async () => {
  const key = KEY();
  const b = await ensureHouseBrief({ projectKey: key, projectDir: mkdtempSync(join(tmpdir(), 'worca-cc-house-brief-empty-')) });
  assert.equal(b.brief, '');
  assert.equal(b.words, 0);
  assert.deepEqual(b.sources, []);
  assert.ok(existsSync(join(projectStorePath(key), HOUSE_BRIEF_FILE)));
  assert.equal((await ensureHouseBrief({ projectKey: KEY(), projectDir: '/does/not/exist' })).brief, '');
});

test('known bugs: kind, name segment or description; anything else is plain memory', () => {
  assert.equal(isKnownBugMemory({ name: 'x', description: 'y', extra: { kind: 'defect-class' } }), true);
  assert.equal(isKnownBugMemory({ name: 'ask-and-chat-ui-traps', description: 'Read before editing chat' }), true);
  assert.equal(isKnownBugMemory({ name: 'notes', description: 'A defect class that recurs in reviews' }), true);
  assert.equal(isKnownBugMemory({ name: 'run-worktree-node-modules', description: 'Read before running tests' }), false);
  assert.equal(isKnownBugMemory({ name: 'entrapment', description: '' }), false);
});

test('extractors: tokens only from bare :root, endpoints skip body parsers, closed specs are dropped', () => {
  assert.deepEqual(tokenLines(':root{--a:1px;--b:light-dark(#fff,#000);}\n:root[data-theme="dark"]{--c:2px;}'), ['--a: 1px', '--b: light-dark(#fff,#000)']);
  assert.deepEqual(endpointLines("app.post('/api/run', express.json());\napp.post('/api/run', h);"), ['POST /api/run']);
  assert.equal(planLine('plans/a.md', '# A\n\nStatus: approved design, not yet implemented\n\nDoes A.'), 'A — Does A. (plans/a.md)');
  assert.equal(planLine('plans/b.md', '# B\nStatus: shipped\n'), null);
  assert.deepEqual(claudeMdLines('# T\n```\ncode\n```\n- keep me'), ['T', 'keep me']);
});

test('extractors: components, card types, workflows', () => {
  assert.equal(componentLine('ui/public/x.mjs', '// ui/public/x.mjs\n// the x view. More.\nexport {};'), 'ui/public/x.mjs — the x view.');
  assert.equal(componentLine('ui/public/y.mjs', 'import a from "a";'), 'ui/public/y.mjs');
  assert.deepEqual(cardTypeNames("const ASK_COMPOSER_CARD_TYPES = ['agent-draft','script-draft'];\nif (card.type === 'web') {}"), ['web', 'agent-draft', 'script-draft']);
  assert.deepEqual(workflowLines('wf.mjs', "deepFreeze({ id: 'wf_default', name: 'Default', nodes: [] })"), ['wf_default — Default (wf.mjs)']);
});

test('pins: blank dropped, duplicates collapsed, limits rejected', () => {
  assert.deepEqual(normalisePins(['  a ', '', 'a', 'b']), { pins: ['a', 'b'] });
  assert.match(normalisePins('a').error, /list/);
  assert.match(normalisePins([1]).error, /text/);
  assert.match(normalisePins(['x'.repeat(241)]).error, /240/);
  assert.match(normalisePins(Array.from({ length: 21 }, (_, i) => `p${i}`)).error, /20/);
});

test('renderHouseBrief is deterministic', () => {
  const lines = { memory: ['a — b'], endpoints: ['GET /x'] };
  assert.equal(renderHouseBrief(lines, ['p']).text, renderHouseBrief(lines, ['p']).text);
});
