// test/fit-review.test.mjs — slice 3: the Project fit reviewer (mock) on the recorded 17 Oct plan that adds a second
// check-row renderer. Pure prompt pieces + runMock; no orchestrator, no server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMock, fitDuplicates } from '../src/core/engines/mock.mjs';
import { roleBriefBlock, houseBriefBlock, roleItems, roleRecord } from '../src/shared/shape/role-review.mjs';
import { renderHouseBrief } from '../src/core/house-brief.mjs';
import { checkShape } from '../src/shared/shape/shape.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/fit-review/check-row-duplicate-plan.md', import.meta.url));
const PLAN = readFileSync(FIXTURE, 'utf8');
const BRIEF = renderHouseBrief({ components: ['ui/public/shape/check-row.mjs — the shape check row: one row per check, a Fix button on a failing one.'] }).text;
const dir = mkdtempSync(join(tmpdir(), 'worca-fit-review-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const ids = roleItems('fit', PLAN).map((i) => i.id);

/** The fit reviewer's prompt as buildAgentPrompt assembles its role parts, plus the markers runMock reads. */
async function review(brief, tag) {
  const json = join(dir, `${tag}.json`);
  const prompt = roleBriefBlock('fit', PLAN) + houseBriefBlock('fit', brief) + [
    'MOCK_ROLE: plan-review', 'MOCK_CYCLE: 1', 'MOCK_PERSPECTIVE: fit', `MOCK_CHECKLIST: ${ids.join(',')}`,
    `MOCK_IN: ${FIXTURE}`, `MOCK_JSON: ${json}`, `MOCK_OUT: ${join(dir, `${tag}.md`)}`,
  ].join('\n') + '\n';
  await runMock({ cwd: dir, prompt, onEvent: () => {} });
  return roleRecord('fit', 1, JSON.parse(readFileSync(json, 'utf8')), ids);
}

test('the 17 Oct fixture carries R-fit-1..5 and passes the shape check for Product, Architect, QA and Project fit', () => {
  assert.deepEqual(ids, ['R-fit-1', 'R-fit-2', 'R-fit-3', 'R-fit-4', 'R-fit-5']);
  const r = checkShape(PLAN, { perspectives: ['product', 'architect', 'qa', 'fit'], size: 'medium' });
  const bad = r.items.filter((i) => !i.pass && ['sections', 'checklists', 'decisions'].includes(i.id));
  assert.deepEqual(bad, []);
});

test('with the house brief, the fit reviewer flags the second check-row renderer: R-fit-1 unmet, one major naming check-row.mjs', async () => {
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
  const rec = await review(BRIEF, 'brief');
  assert.deepEqual(rec.checklist.map((c) => [c.id, c.status]),
    [['R-fit-1', 'unmet'], ['R-fit-2', 'met'], ['R-fit-3', 'met'], ['R-fit-4', 'met'], ['R-fit-5', 'met']]);
  const majors = rec.findings.filter((f) => f.severity === 'major');
  assert.equal(majors.length, 1);
  assert.match(majors[0].title, /ui\/public\/shape\/check-row\.mjs/);
  assert.match(majors[0].fix, /Reuse ui\/public\/shape\/check-row\.mjs/);
  assert.equal(majors[0].section, 'Fit');
});

test('without a house brief the fit reviewer has nothing to compare: no major, R-fit-1 met', async () => {
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
  const rec = await review('', 'nobrief');
  assert.equal(rec.findings.some((f) => f.severity === 'major' || f.severity === 'critical'), false);
  assert.equal(rec.checklist.find((c) => c.id === 'R-fit-1').status, 'met');
});

test('fitDuplicates: only (new) lines, never test files, one finding per existing component', () => {
  const plan = [
    '- `ui/public/feature-check-row.mjs` (new) and `test/ui-feature-check-row.test.mjs` (new)',
    '- `ui/public/other-check-row.mjs` (new)',
    '- `ui/public/shape/check-row.mjs` is reused',
  ].join('\n');
  assert.deepEqual(fitDuplicates(plan, BRIEF), [{ existing: 'ui/public/shape/check-row.mjs', added: 'ui/public/feature-check-row.mjs' }]);
  assert.deepEqual(fitDuplicates(plan, ''), []);
  assert.deepEqual(fitDuplicates('- `ui/public/feature-check-row.mjs` is changed', BRIEF), []);
});
