// test/agent-contract-sync.test.mjs — H: the engine loads agents/*.md (agent-registry.mjs DEFAULT_AGENTS_DIR);
// .claude/agents/*.md serve the frozen in-session orchestrate skill (CONTRIBUTING.md). The sections that define
// the verdict contract, the severity rubric, the convergence rules and the planner's self-verification are
// shared text and must stay byte-identical in both copies; everything else (frontmatter, Ports vs Inputs,
// workspace / memory / fan-out sections, UI-levels bullets, the 3-mode planner) differs by design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** The text from the line starting `## <head>` up to (not including) the next `## ` heading. */
function section(md, head) {
  const start = md.indexOf(`\n## ${head}`);
  assert.notEqual(start, -1, `section "## ${head}" present`);
  const rest = md.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const PAIRS = [
  ['worca-cc-plan-refiner.md', ['review-cycleN.json contract', 'Severity rubric', 'Convergence rules']],
  ['worca-cc-plan-reviewer.md', ['plan-review-cycleN.json contract', 'Severity rubric', 'Convergence rules']],
  ['worca-cc-code-reviewer.md', ['review-cycleN.json contract', 'Severity rubric']],
  ['worca-cc-planner.md', ['Self-verification before handoff']],
];

test('the shared contract, rubric, convergence and self-verification sections are byte-identical in agents/ and .claude/agents/', () => {
  for (const [file, heads] of PAIRS) {
    const engine = read(`agents/${file}`);
    const skill = read(`.claude/agents/${file}`);
    for (const head of heads) assert.equal(section(skill, head), section(engine, head), `${file}: ## ${head}`);
  }
});

test('the severity rubric is one text across the refiner, the plan reviewer and the code reviewer', () => {
  const body = (file) => section(read(`agents/${file}`), 'Severity rubric').split('\n').slice(0, 11).join('\n');
  assert.equal(body('worca-cc-plan-reviewer.md'), body('worca-cc-plan-refiner.md'));
  assert.equal(body('worca-cc-code-reviewer.md'), body('worca-cc-plan-refiner.md'));
});

test('the contracts say what the gate reads: issues = still open in the output, resolved = fixed and verified, lanes recorded', () => {
  for (const file of ['worca-cc-plan-refiner.md', 'worca-cc-plan-reviewer.md', 'worca-cc-code-reviewer.md']) {
    const md = read(`agents/${file}`);
    assert.match(md, /"resolved": \[/, `${file}: the contract fence carries resolved`);
    assert.match(md, /"lanes": \[/, `${file}: the contract fence carries lanes`);
    assert.match(md, /Only `critical` and `major` items in `issues` block the loop; nothing in `resolved` ever does\./, `${file}: the gate sentence`);
    assert.doesNotMatch(md, /issues you found in the INPUT plan/, `${file}: the input-graded sentence is gone`);
  }
  for (const dir of ['agents', '.claude/agents']) {
    for (const file of ['worca-cc-plan-refiner.md', 'worca-cc-plan-reviewer.md', 'worca-cc-code-reviewer.md']) {
      assert.doesNotMatch(read(`${dir}/${file}`), /at least a major issue/, `${dir}/${file}: test severity defers to the Severity rubric`);
    }
  }
  const planner = read('agents/worca-cc-planner.md');
  assert.match(planner, /\n7\. Carry a `## Verified` block/, 'the planner MUST carry a Verified block');
  assert.match(planner, /End the plan with a `## Verified` block, immediately BEFORE the `## Clarifications \(Q&A\)` section/);
});
