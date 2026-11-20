// test/mock-slices.test.mjs — the mock planner under Shape it first slice 4 (spec F17): the `MOCK_SLICES` marker plus
// "plan this in slices" in the task makes it write a two-slice outline and no plan; without either it writes the plan.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMock, mockPlanMarkdown, MOCK_OUTLINE, MOCK_OUTLINE_3 } from '../src/core/engines/mock.mjs';

const scratch = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-mock-sl-')); scratch.push(d); return d; };
after(async () => { for (const d of scratch) await rm(d, { recursive: true, force: true }); });

const markers = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n');
const exists = (p) => access(p).then(() => true, () => false);

test('MOCK_OUTLINE is a frozen two-slice outline, the second depending on the first', () => {
  assert.ok(Object.isFrozen(MOCK_OUTLINE));
  assert.deepEqual(MOCK_OUTLINE.slices.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(MOCK_OUTLINE.slices[1].dependsOn, ['s1']);
});

test('the marker and the phrase write the outline and no plan', async () => {
  const dir = await tmp();
  const out = join(dir, 'plan.md');
  const slices = join(dir, 'sub', 'slices.json');
  const events = [];
  const text = await runMock({ cwd: dir, systemPrompt: '', onEvent: (e) => events.push(e),
    prompt: `${markers({ MOCK_ROLE: 'planner-plan', MOCK_BASE: 'demo', MOCK_OUT: out, MOCK_SLICES: slices })}\nPlease Plan this in slices.` });
  assert.deepEqual(JSON.parse(await readFile(slices, 'utf8')), MOCK_OUTLINE);
  assert.equal(await exists(out), false);
  assert.ok(JSON.stringify(text).includes(`outline at ${slices}`));
  assert.ok(events.some((e) => e.type === 'tool_use' && e.raw?.file === slices));
});

test('a revise prompt edits the existing outline: why carries the feedback, slices unchanged', async () => {
  const { outlineFeedbackBlock } = await import('../src/shared/shape/slices.mjs');
  const dir = await tmp();
  const out = join(dir, 'plan.md');
  const slices = join(dir, 'slices.json');
  const run = (extra = '') => runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
    prompt: `${markers({ MOCK_ROLE: 'planner-plan', MOCK_BASE: 'demo', MOCK_OUT: out, MOCK_SLICES: slices })}\nPlan this in slices.\n\n${extra}` });
  await run();
  const first = await readFile(slices, 'utf8');
  await run(outlineFeedbackBlock('Merge the first two.'));
  const edited = JSON.parse(await readFile(slices, 'utf8'));
  assert.notEqual(await readFile(slices, 'utf8'), first, 'the bytes changed');
  assert.deepEqual(edited.slices, MOCK_OUTLINE.slices);
  assert.ok(edited.why.startsWith(MOCK_OUTLINE.why));
  assert.ok(edited.why.includes('Merge the first two.'));
  assert.equal(await exists(out), false, 'still no plan');
  // a missing outline file is still written in full
  await rm(slices);
  await run(outlineFeedbackBlock('Again.'));
  assert.deepEqual(JSON.parse(await readFile(slices, 'utf8')), MOCK_OUTLINE);
});

test('without the phrase, or without the marker, the plan is written as today and no outline', async () => {
  const dir = await tmp();
  const out = join(dir, 'plan.md');
  const slices = join(dir, 'slices.json');
  const run = (m, extra) => runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
    prompt: `${markers({ MOCK_ROLE: 'planner-plan', MOCK_BASE: 'demo', MOCK_OUT: out, ...m })}\n${extra}` });
  await run({ MOCK_SLICES: slices }, 'a plain task');
  assert.equal(await readFile(out, 'utf8'), mockPlanMarkdown('demo', 1));
  assert.equal(await exists(slices), false);
  await rm(out);
  await run({}, 'plan this in slices');
  assert.equal(await readFile(out, 'utf8'), mockPlanMarkdown('demo', 1));
  assert.equal(await exists(slices), false);
});

test('"plan this in 3 slices" writes the three-run outline (s2 depends on s1, s3 on s2); "plan this in slices" still writes two', async () => {
  const dir = await tmp();
  const write = async (phrase) => {
    const slices = join(dir, `${phrase.length}.json`);
    await runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
      prompt: `${markers({ MOCK_ROLE: 'planner-plan', MOCK_BASE: 'demo', MOCK_OUT: join(dir, 'plan.md'), MOCK_SLICES: slices })}\n${phrase}` });
    return JSON.parse(await readFile(slices, 'utf8'));
  };
  const three = await write('Please plan this in 3 slices.');
  assert.ok(Object.isFrozen(MOCK_OUTLINE_3));
  assert.deepEqual(three, MOCK_OUTLINE_3);
  assert.deepEqual(three.slices.map((s) => s.dependsOn), [[], ['s1'], ['s2']]);
  assert.equal((await write('plan this in slices')).slices.length, 2);
});

test('with MOCK_REQUIREMENTS the mock outline deals 4 + 3 ids (3 + 2 + 2 for 3 slices) and leaves R-ops-1 out with a reason', async () => {
  const { MOCK_REQUIREMENTS_CRITERIA } = await import('../src/core/engines/mock.mjs');
  const dir = await tmp();
  const req = join(dir, 'requirements.md');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(req, `# Requirements\n\n${MOCK_REQUIREMENTS_CRITERIA.map(([id, t]) => `- **${id}** ${t}`).join('\n')}\n`);
  const write = async (phrase) => {
    const slices = join(dir, `${phrase.length}.json`);
    await runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
      prompt: `${markers({ MOCK_ROLE: 'planner-plan', MOCK_BASE: 'demo', MOCK_OUT: join(dir, 'plan.md'), MOCK_SLICES: slices, MOCK_REQUIREMENTS: req })}\n${phrase}` });
    return JSON.parse(await readFile(slices, 'utf8'));
  };
  const two = await write('plan this in slices');
  assert.deepEqual(two.slices.map((s) => s.requirements), [['R-po-1', 'R-po-2', 'R-arch-1', 'R-ux-1'], ['R-qa-1', 'R-sec-1', 'R-sec-2']]);
  assert.deepEqual(two.leftOut, [{ id: 'R-ops-1', reason: 'Moved to a later feature' }]);
  const three = await write('Please plan this in 3 slices.');
  assert.deepEqual(three.slices.map((s) => s.requirements), [['R-po-1', 'R-po-2', 'R-arch-1'], ['R-ux-1', 'R-qa-1'], ['R-sec-1', 'R-sec-2']]);
  assert.deepEqual(three.leftOut, [{ id: 'R-ops-1', reason: 'Moved to a later feature' }]);
  assert.deepEqual({ ...two, slices: two.slices.map(({ requirements, ...s }) => s), leftOut: undefined }, { ...MOCK_OUTLINE, leftOut: undefined });
});
