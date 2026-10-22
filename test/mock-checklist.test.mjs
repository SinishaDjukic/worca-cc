// test/mock-checklist.test.mjs — the mock engine under Shape it first slice 3 (spec D7, C10): the planner writes a
// checklist per Perspectives prefix, the reviewer reports the plan's items, and a prompt or plan without items gives
// the output it always did.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMock, mockChecklistPrefixes, mockPlanMarkdown } from '../src/core/engines/mock.mjs';
import { perspectivesBlock } from '../src/shared/shape/perspectives.mjs';
import { extractChecklist } from '../src/shared/shape/checklist.mjs';

const scratch = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-mock-cl-')); scratch.push(d); return d; };
after(async () => { for (const d of scratch) await rm(d, { recursive: true, force: true }); });

const BLOCK = perspectivesBlock(['product', 'architect', 'qa']);
const markers = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n');

test('mockChecklistPrefixes reads the prefixes a Perspectives block asks for', () => {
  assert.deepEqual(mockChecklistPrefixes(BLOCK), ['arch', 'qa']);
  assert.deepEqual(mockChecklistPrefixes('a plain prompt'), []);
  assert.deepEqual(mockChecklistPrefixes(undefined), []);
});

test('the planner writes a checklist per prefix, and the plain plan is byte-identical', async () => {
  const dir = await tmp();
  const out = join(dir, 'plan.md');
  const run = (extra) => runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
    prompt: `${markers({ MOCK_ROLE: 'planner-plan', MOCK_BASE: 'demo', MOCK_OUT: out })}\n${extra}` });
  await run(BLOCK);
  const shaped = await readFile(out, 'utf8');
  assert.deepEqual(extractChecklist(shaped).map((i) => i.id), ['R-arch-1', 'R-qa-1']);
  assert.ok(shaped.includes('### Checklist'));
  await run('no block here');
  assert.equal(await readFile(out, 'utf8'), mockPlanMarkdown('demo', 1));
  assert.ok(!(await readFile(out, 'utf8')).includes('### Checklist'));
});

test('the reviewer reports the plan\'s items: cycle 1 [unmet, met], cycle 2 [met, na]; no items, no key', async () => {
  const dir = await tmp();
  const plan = join(dir, 'plan.md');
  await writeFile(plan, mockPlanMarkdown('demo', 1, ['arch', 'qa']), 'utf8');
  const bare = join(dir, 'bare.md');
  await writeFile(bare, mockPlanMarkdown('demo', 1), 'utf8');
  const review = async (cycle, input) => {
    const json = join(dir, `r${cycle}-${input.split('/').pop()}.json`);
    await runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
      prompt: markers({ MOCK_ROLE: 'reviewer', MOCK_CYCLE: cycle, MOCK_IN: input, MOCK_OUT: join(dir, 'rev.md'), MOCK_JSON: json }) });
    return JSON.parse(await readFile(json, 'utf8'));
  };
  assert.deepEqual((await review(1, plan)).checklist.map((c) => [c.id, c.status]), [['R-arch-1', 'unmet'], ['R-qa-1', 'met']]);
  assert.deepEqual((await review(2, plan)).checklist.map((c) => [c.id, c.status]), [['R-arch-1', 'met'], ['R-qa-1', 'na']]);
  assert.ok((await review(2, plan)).checklist.every((c) => c.evidence));
  assert.equal(Object.hasOwn(await review(1, bare), 'checklist'), false);
});

// ── role reviews (spec §3): the plan reviewer's role mode and the refiner's `addressed` ──

test('the plan reviewer in role mode writes one checklist entry per MOCK_CHECKLIST id, and every issue has section and fix', async () => {
  const dir = await tmp();
  const json = join(dir, 'role-ux-plan-review-cycle1.json');
  const run = () => runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
    prompt: markers({ MOCK_ROLE: 'plan-review', MOCK_CYCLE: 1, MOCK_PERSPECTIVE: 'ux', MOCK_CHECKLIST: 'R-ux-1,R-ux-2',
      MOCK_OUT: join(dir, 'f.md'), MOCK_JSON: json }) });
  const prev = process.env.WORCA_MOCK_ROLE_REVIEW;
  try {
    delete process.env.WORCA_MOCK_ROLE_REVIEW;
    await run();
    let r = JSON.parse(await readFile(json, 'utf8'));
    assert.deepEqual(r.checklist.map((c) => [c.id, c.status]), [['R-ux-1', 'met'], ['R-ux-2', 'met']]);
    assert.deepEqual(r.issues.map((i) => i.severity), ['minor'], 'the default is one non-blocking finding');
    for (const i of r.issues) { assert.ok(i.section); assert.ok(i.fix); }
    process.env.WORCA_MOCK_ROLE_REVIEW = '{"ux":{"1":"critical"}}';
    await run();
    r = JSON.parse(await readFile(json, 'utf8'));
    assert.deepEqual(r.issues.map((i) => i.severity), ['critical']);
    assert.deepEqual(r.checklist.map((c) => c.status), ['unmet', 'unmet']);
  } finally {
    if (prev === undefined) delete process.env.WORCA_MOCK_ROLE_REVIEW; else process.env.WORCA_MOCK_ROLE_REVIEW = prev;
  }
});

test('the refiner fed MOCK_FINDINGS lists that file\'s finding ids in `addressed`; without it, no key', async () => {
  const dir = await tmp();
  const findings = join(dir, 'findings.md');
  await writeFile(findings, '# Role reviews — round 1\n\n## UX\n\n- **ux-1-1** [critical] Testing: x — fix: y\n\n## QA\n\n- **qa-1-1** [minor] t — fix: f\n');
  const json = join(dir, 'refine.json');
  const run = (extra) => runMock({ cwd: dir, systemPrompt: '', onEvent: () => {},
    prompt: markers({ MOCK_ROLE: 'refiner', MOCK_CYCLE: 1, MOCK_OUT: join(dir, 'plan-v2.md'), MOCK_JSON: json, ...extra }) });
  await run({ MOCK_FINDINGS: findings });
  assert.deepEqual(JSON.parse(await readFile(json, 'utf8')).addressed, ['ux-1-1', 'qa-1-1']);
  await run({});
  assert.equal('addressed' in JSON.parse(await readFile(json, 'utf8')), false);
});
