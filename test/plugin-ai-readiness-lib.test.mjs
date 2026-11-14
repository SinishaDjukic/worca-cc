// test/plugin-ai-readiness-lib.test.mjs — rubric arithmetic: core weights, tool surfaces,
// overall = the lowest selected tool, severity from weight × shortfall, the re-score gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coreScore, toolScores, overallScore, dimensionSeverity, toolSeverity,
  scoreCard, mergeMembers, verdictFor, escapeHtml, PASS_MARK, gapRows, plannedFiles, skillFolders,
} from '../plugins/ai-readiness/scripts/readiness-lib.mjs';

const DIMS = { commands: 80, architecture: 60, conventions: 60, gotchas: 40, tests: 100, recurringTasks: null };

test('coreScore: weighted mean over the non-null dimensions', () => {
  // (25*80 + 15*60 + 15*60 + 15*40 + 15*100) / 85 = 5900 / 85 = 69.4
  assert.equal(coreScore(DIMS), 69);
  assert.equal(coreScore({}), null);
});

test('toolScores and overall: core × surface factor; the overall is the LOWEST selected tool', () => {
  const tools = toolScores(70, { 'claude': 'self-sufficient', codex: 'partial' }, ['claude', 'codex']);
  assert.deepEqual(tools, { 'claude': 70, codex: 35 });
  assert.equal(overallScore(70, tools), 35);
  assert.equal(overallScore(70, {}), 70, 'no tool selected: the core');
});

test('a tool that was not selected is never scored', () => {
  assert.deepEqual(toolScores(70, { cursor: 'missing' }, ['claude']), { 'claude': 0 });
});

test('dimensionSeverity: weight × shortfall', () => {
  assert.equal(dimensionSeverity('commands', 0), 'critical');   // 25 points lost
  assert.equal(dimensionSeverity('gotchas', 40), 'major');      // 9
  assert.equal(dimensionSeverity('gotchas', 80), 'minor');      // 3
  assert.equal(dimensionSeverity('gotchas', 95), 'suggestion'); // 0.75
  assert.equal(dimensionSeverity('codeHealth', 0), null, 'not a core dimension');
});

test('toolSeverity: a missing surface is major at baseline and critical at re-score', () => {
  assert.equal(toolSeverity('missing'), 'major');
  assert.equal(toolSeverity('missing', { final: true }), 'critical');
  assert.equal(toolSeverity('self-sufficient', { final: true }), null);
});

const PROBE = {
  selectedTools: ['claude', 'codex'],
  tools: { 'claude': { surface: 'self-sufficient', files: ['CLAUDE.md'] }, codex: { surface: 'missing', files: [] } },
  commands: [{ id: 'test', kind: 'test', command: 'npm test', status: 'fail', exitCode: 1, documented: true, baselineStatus: 'pass' }],
  frontmatter: [{ path: '.agents/skills/x/SKILL.md', error: 'no description' }],
  sideEffects: [],
};
const JUDGEMENT = {
  dimensions: DIMS, reasons: { commands: 'documented' },
  gaps: [{ id: 'g1', dimension: 'gotchas', title: 'Gotchas missing', detail: '', fix: 'add them', location: 'AGENTS.md' }],
};

test('scoreCard: severities come from the library, not the model; the tools come from the probe', () => {
  const card = scoreCard({ ...JUDGEMENT, gaps: [{ ...JUDGEMENT.gaps[0], severity: 'suggestion' }] }, PROBE);
  assert.equal(card.valid, true);
  assert.equal(card.gaps.find((g) => g.id === 'g1').severity, 'major');
  assert.equal(card.gaps.find((g) => g.id === 'tool-codex').severity, 'major');
  assert.equal(card.overall, 0, 'Codex has no surface, so the overall is 0');
  assert.deepEqual(card.hardFailures, [], 'no hard failures at baseline');
});

test('scoreCard: a tool row shows the files its surface comes from', () => {
  const probe = { ...PROBE, tools: { claude: { surface: 'self-sufficient', files: ['AGENTS.md', '.claude/rules/a.md'] }, codex: { surface: 'missing', files: [] } } };
  const card = scoreCard(JUDGEMENT, probe);
  assert.equal(card.tools.codex.file, '');
  assert.equal(card.tools.claude.file, 'AGENTS.md, .claude/rules/a.md');
});

test('scoreCard final: a failing documented command and a broken frontmatter are hard failures', () => {
  const card = scoreCard(JUDGEMENT, PROBE, { final: true });
  assert.deepEqual(card.hardFailures.map((h) => h.title), [
    'Documented command fails: npm test',
    'Skill frontmatter does not parse: .agents/skills/x/SKILL.md',
  ]);
});

test('verdictFor: blocking below the pass mark or on a hard failure; a pass has no issues', () => {
  const pass = { overall: PASS_MARK, hardFailures: [], gaps: [{ severity: 'major', title: 't', detail: '', location: 'x' }], valid: true };
  assert.deepEqual(verdictFor(pass).issues, []);
  const low = verdictFor({ ...pass, overall: 50 });
  assert.equal(low.issues[0].severity, 'critical');
  assert.match(low.issues[0].title, /50\/100 is below the pass mark 80/);
  assert.equal(low.issues[1].severity, 'major', 'the blocking gaps ride along so Generate knows what to fix');
  const hard = verdictFor({ ...pass, hardFailures: [{ severity: 'critical', title: 'h', detail: '', location: 'AGENTS.md' }] });
  assert.equal(hard.issues.length, 1);
});

test('scoreCard on a malformed or mock judgement: invalid, no score, no crash', () => {
  for (const j of [null, { mock: true }, 'nope']) {
    const card = scoreCard(j, PROBE);
    assert.equal(card.valid, false);
    assert.equal(card.overall, null);
  }
});

test('mergeMembers: the overall is the lowest member, gaps prefixed by member', () => {
  const a = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'] });
  const b = scoreCard({ ...JUDGEMENT, dimensions: { ...DIMS, commands: 0 } }, { ...PROBE, selectedTools: ['claude'] });
  const m = mergeMembers({ api: a, web: b });
  assert.equal(m.overall, Math.min(a.overall, b.overall));
  assert.ok(m.gaps.every((g) => /^(api|web): /.test(g.title)));
  assert.deepEqual(Object.keys(m.members), ['api', 'web']);
});

test('escapeHtml', () => {
  assert.equal(escapeHtml('<img onerror="x">&\''), '&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;');
});

test('toolSeverity fix 1: every non-self-sufficient surface is major baseline, critical final', () => {
  assert.equal(toolSeverity('skills-only'), 'major');
  assert.equal(toolSeverity('partial', { final: true }), 'critical');
});

test('verdictFor fix 2: below pass mark carries critical/major/minor gaps (not suggestion)', () => {
  const card = {
    valid: true, overall: 70,
    gaps: [{ severity: 'minor', title: 'Minor gap', detail: '', fix: '', location: 'x.md' }],
    hardFailures: [],
  };
  const verdict = verdictFor(card);
  assert.equal(verdict.issues[0].severity, 'critical', 'below pass mark');
  assert.match(verdict.issues[0].title, /70\/100 is below the pass mark 80/);
  assert.equal(verdict.issues[1].severity, 'major', 'minor gap is carried as major');
  assert.equal(verdict.issues[1].title, 'Minor gap');
});

const card = (overall, extra = {}) => ({ valid: true, overall, pass: overall >= 80, gaps: [], hardFailures: [], sideEffects: [], ...extra });

test('case 1: the workspace overall is the lowest member, and one member below 80 blocks', () => {
  const m = mergeMembers({ api: card(100), web: card(100), worker: card(62) });
  assert.equal(m.overall, 62);
  assert.equal(m.pass, false);
  assert.deepEqual(m.blocked, ['worker']);
});

test('case 2: the verdict names only the blocked member, with its gaps', () => {
  const m = mergeMembers({
    api: card(100, { gaps: [{ id: 'a', title: 'api gap', severity: 'minor', location: 'AGENTS.md', detail: 'd', fix: 'f' }] }),
    worker: card(62, { gaps: [{ id: 'w', title: 'No test command', severity: 'major', location: 'AGENTS.md', detail: 'd', fix: 'f' }] }),
  });
  const v = verdictFor(m);
  assert.match(v.issues[0].title, /^worker: score 62\/100 is below the pass mark 80$/);
  assert.ok(v.issues.some((i) => /^worker: No test command$/.test(i.title) && i.location === 'worker/AGENTS.md'));
  assert.ok(!v.issues.some((i) => /api/.test(i.title)));
});

test('case 3: a member with no readable judgement is blocked and named', () => {
  const m = mergeMembers({ api: card(95), web: { valid: false, overall: null, pass: false, gaps: [], hardFailures: [], sideEffects: [] } });
  assert.equal(m.pass, false);
  assert.deepEqual(m.blocked, ['web']);
  assert.equal(m.overall, 95);
});

test('every member at 80 or above with no hard failure passes', () => {
  const m = mergeMembers({ api: card(80), web: card(97) });
  assert.equal(m.pass, true);
  assert.deepEqual(m.blocked, []);
  assert.equal(verdictFor(m).issues.length, 0);
});

test('a member with a hard failure blocks even at a high score', () => {
  const m = mergeMembers({ api: card(95, { pass: false, hardFailures: [{ severity: 'critical', title: 'Documented command fails: npm test', detail: 'x', location: 'AGENTS.md' }] }), web: card(90) });
  assert.equal(m.pass, false);
  assert.deepEqual(m.blocked, ['api']);
  assert.equal(verdictFor(m).issues[0].title, 'api: Documented command fails: npm test');
});

test('a file over limits.perFile is a hard failure only when a selected engine reads it', () => {
  const capProbe = { ...PROBE, selectedTools: ['claude', 'codex'], limits: { perFile: 20480, total: 65536 },
    tools: { ...PROBE.tools, codex: { surface: 'partial', files: ['AGENTS.md'] } },
    sizes: { 'AGENTS.md': 40000 }, overCap: { files: ['AGENTS.md'], engines: [] } };
  const cardWithCodex = scoreCard(JUDGEMENT, capProbe, { final: true });
  const cap = cardWithCodex.hardFailures.find((h) => h.title.includes('KiB'));
  assert.equal(cap.title, 'AGENTS.md is over the 20 KiB per-file limit');
  assert.equal(cap.detail, '40000 bytes');
  assert.ok(!cardWithCodex.hardFailures.some((h) => h.title.includes('32 KiB')), 'no fixed Codex cap');

  const noReader = scoreCard(JUDGEMENT, { ...capProbe, selectedTools: ['claude'] }, { final: true });
  assert.ok(!noReader.hardFailures.some((h) => h.title.includes('KiB')));
});

test('a selected engine whose files pass limits.total is a hard failure', () => {
  const probe = { ...PROBE, selectedTools: ['claude'], limits: { perFile: 20480, total: 65536 }, labels: { claude: 'Claude Code' },
    tools: { claude: { surface: 'partial', files: ['CLAUDE.md', 'CLAUDE.local.md'], expected: 'CLAUDE.md' } },
    overCap: { files: [], engines: ['claude', 'codex'] } };
  const hard = scoreCard(JUDGEMENT, probe, { final: true }).hardFailures.filter((h) => h.title.includes('KiB'));
  assert.deepEqual(hard.map((h) => [h.title, h.location]), [["Claude Code's instruction files are over the 64 KiB total limit", 'CLAUDE.md']]);
});

test('mergeMembers: a member\'s "+N more" side-effect marker is not turned into a path', () => {
  const a = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'], sideEffects: ['out.txt', '+10 more'] });
  const m = mergeMembers({ api: a });
  assert.deepEqual(m.sideEffects, ['api/out.txt', 'api: +10 more']);
});

test('mergeMembers fix 5: locations are prefixed as k/location, not k: location', () => {
  const a = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'] });
  const b = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'] });
  const m = mergeMembers({ api: a, web: b });
  const apiGap = m.gaps.find((g) => g.title.startsWith('api:'));
  assert.ok(apiGap, 'gap is prefixed with api:');
  if (apiGap.location) {
    assert.ok(apiGap.location.startsWith('api/'), `location should start with 'api/', got '${apiGap.location}'`);
  }
});

test('mergeMembers fix 1: pass requires all cards valid, not just merged overall >= PASS_MARK', () => {
  const invalid = scoreCard(null, PROBE);
  const valid = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'] });
  // Manually set valid card to 90
  const validAt90 = { ...valid, overall: 90, pass: true };
  const merged = mergeMembers({ api: invalid, web: validAt90 });
  assert.equal(merged.pass, false, 'merged.pass is false when any member is invalid');
  assert.ok(verdictFor(merged).issues.length > 0, 'verdictFor blocks when member is invalid');
});

test('scoreCard fix 2a: judgement with empty dimensions is invalid', () => {
  const card = scoreCard({ dimensions: {} }, PROBE);
  assert.equal(card.valid, false);
  assert.equal(card.overall, null);
});

test('scoreCard fix 2b: merged with invalid member blocks', () => {
  const invalid = scoreCard({ dimensions: {} }, PROBE);
  const valid = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'] });
  const validAt90 = { ...valid, overall: 90, pass: true };
  const merged = mergeMembers({ api: invalid, web: validAt90 });
  assert.equal(merged.pass, false);
  assert.ok(verdictFor(merged).issues.length > 0);
});

test('hardFailuresOf fix 4: .agents/ frontmatter only counts when an .agents engine is selected', () => {
  const probe = { ...PROBE, frontmatter: [{ path: '.agents/skills/x/SKILL.md', error: 'no description' }] };
  const cardWithCodex = scoreCard(JUDGEMENT, probe, { final: true });
  assert.ok(cardWithCodex.hardFailures.some((h) => h.title.includes('frontmatter')));

  const cardWithoutCodex = scoreCard(JUDGEMENT, { ...probe, selectedTools: ['claude'] }, { final: true });
  assert.ok(!cardWithoutCodex.hardFailures.some((h) => h.title.includes('frontmatter')));
});

test('scoreCard fix 5: deduplicates selectedTools and converts invalid surfaces to missing', () => {
  const probe = { selectedTools: ['codex', 'codex'], tools: { codex: { surface: 5 } } };
  const card = scoreCard(JUDGEMENT, probe);
  assert.equal(Object.keys(card.tools).length, 1, 'only one tool-codex');
  const toolGap = card.gaps.find((g) => g.id === 'tool-codex');
  assert.ok(toolGap, 'tool-codex gap exists');
  assert.equal(toolGap.severity, 'major', 'missing surface is major');
});

test('dimensionSeverity fix 6: ignores non-core dimensions like toString', () => {
  assert.equal(dimensionSeverity('toString', 0), null);
});

test('scoreCard fix 6: drops gaps with non-core dimensions', () => {
  const card = scoreCard({ ...JUDGEMENT, gaps: [{ ...JUDGEMENT.gaps[0], dimension: 'toString' }] }, { ...PROBE, selectedTools: ['claude'] });
  assert.equal(card.gaps.length, 0, 'non-core dimension gap is dropped');
});

test('verdictFor fix 7: adds major issues for blocked dimensions without gaps', () => {
  const card = { valid: true, overall: 64, gaps: [], hardFailures: [], dimensions: { commands: 50, architecture: null, conventions: null, gotchas: null, tests: null, recurringTasks: null } };
  const verdict = verdictFor(card);
  assert.ok(verdict.issues.length > 1, 'has headline + dimension issues');
  const dimensionIssues = verdict.issues.slice(1);
  assert.ok(dimensionIssues.every((i) => i.severity === 'major'), 'all dimension issues are major');
  assert.ok(dimensionIssues.some((i) => i.title.includes('scored')), 'dimension issues have score format');
});

test('mergeMembers fix 3 and 9: sideEffects prefixed k/s and location is api/AGENTS.md', () => {
  const a = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'], sideEffects: ['side1'] });
  const b = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'], sideEffects: ['side2'] });
  const merged = mergeMembers({ api: a, web: b });
  assert.ok(merged.sideEffects.some((s) => s === 'api/side1'));
  assert.ok(merged.sideEffects.some((s) => s === 'web/side2'));
  const apiGap = merged.gaps.find((g) => g.title.startsWith('api:'));
  assert.equal(apiGap.location, 'api/AGENTS.md');
});

test('scoreCard copies restoreFailed (strings only) and mergeMembers prefixes it', () => {
  const a = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'], restoreFailed: ['x.txt', 7, null] });
  const b = scoreCard(JUDGEMENT, { ...PROBE, selectedTools: ['claude'] });
  assert.deepEqual(a.restoreFailed, ['x.txt']);
  assert.deepEqual(b.restoreFailed, []);
  const merged = mergeMembers({ api: a, web: b });
  assert.deepEqual(merged.restoreFailed, ['api/x.txt']);
});

test('hardFailuresOf fix 9: the per-file limit failure is located at the file', () => {
  const capProbe = { ...PROBE, selectedTools: ['codex'], limits: { perFile: 20480 },
    tools: { codex: { surface: 'partial', files: ['AGENTS.md'] } }, overCap: { files: ['AGENTS.md'], engines: [] } };
  const card = scoreCard(JUDGEMENT, capProbe, { final: true });
  const capFailure = card.hardFailures.find((h) => h.title.includes('KiB'));
  assert.equal(capFailure.location, 'AGENTS.md');
});

test('a documented command the budget never started is no hard failure; fail and timeout are', () => {
  const probe = (status) => ({ selectedTools: [], commands: [{ command: 'npm test', documented: true, documentedIn: 'AGENTS.md', status, baselineStatus: 'pass' }], frontmatter: [] });
  const dims = { commands: 90, architecture: 90, conventions: 90, gotchas: 90, tests: 90, recurringTasks: 90 };
  const j = { dimensions: dims };
  assert.deepEqual(scoreCard(j, probe('skipped-budget'), { final: true }).hardFailures, []);
  assert.deepEqual(scoreCard(j, probe('skipped-memory'), { final: true }).hardFailures, [], 'a memory command nobody confirmed was not run');
  assert.deepEqual(scoreCard(j, probe('skipped-wrong'), { final: true }).hardFailures, []);
  assert.equal(scoreCard(j, probe('fail'), { final: true }).hardFailures.length, 1);
  assert.equal(scoreCard(j, probe('timeout'), { final: true }).hardFailures.length, 1);
});

test('pass requires no hard failures', () => {
  const dims = { commands: 90, architecture: 90, conventions: 90, gotchas: 90, tests: 90, recurringTasks: 90 };
  const probe = { selectedTools: [], commands: [{ command: 'npm test', documented: true, documentedIn: 'AGENTS.md', status: 'fail', exitCode: 1, baselineStatus: 'pass' }], frontmatter: [] };
  const card = scoreCard({ dimensions: dims }, probe, { final: true });
  assert.ok(card.overall >= PASS_MARK);
  assert.equal(card.pass, false);
  assert.equal(scoreCard({ dimensions: dims }, { ...probe, commands: [] }, { final: true }).pass, true);
});

test('a documented command that already failed before setup is no hard failure; a seeded one or one that passed at baseline is', () => {
  const dims = { commands: 90, architecture: 90, conventions: 90, gotchas: 90, tests: 90, recurringTasks: 90 };
  const hard = (c) => scoreCard({ dimensions: dims }, { selectedTools: [], commands: [{ command: 'npm test', documented: true, documentedIn: 'AGENTS.md', status: 'fail', exitCode: 1, ...c }], frontmatter: [] }, { final: true }).hardFailures.length;
  assert.equal(hard({ baselineStatus: 'pass' }), 1, 'setup broke a passing command');
  assert.equal(hard({ baselineStatus: 'fail' }), 0, 'red before setup');
  assert.equal(hard({ baselineStatus: 'timeout', status: 'timeout' }), 0, 'slow before setup');
  assert.equal(hard({ baselineStatus: 'none' }), 0, 'not run at baseline');
  assert.equal(hard({}), 0, 'no baseline recorded');
  assert.equal(hard({ baselineStatus: 'none', seeded: true }), 1, 'Seed tests wrote it');
  assert.equal(hard({ baselineStatus: 'fail', seeded: true, status: 'timeout' }), 1, 'a seeded command that times out');
  const card = scoreCard({ dimensions: dims }, { selectedTools: [], commands: [{ command: 'npm test', documented: true, documentedIn: 'AGENTS.md', status: 'fail', exitCode: 1, baselineStatus: 'fail' }], frontmatter: [] }, { final: true });
  assert.equal(card.pass, true, 'a suite red before setup does not dead-end setup');
});

test('gapRows: one headline per dimension at its severity, items under it; other gaps stay their own rows', () => {
  const dims = { commands: 90, architecture: 40, conventions: 80, gotchas: 0, tests: 90, recurringTasks: null };
  const gaps = [
    { id: 'a1', dimension: 'architecture', severity: 'major', title: 'A1' },
    { id: 'k1', dimension: 'gotchas', severity: 'critical', title: 'K1' },
    { id: 'tool-codex', dimension: 'tool', tool: 'codex', severity: 'critical', title: 'Codex: instructions partial' },
    { id: 'c1', dimension: 'conventions', severity: 'minor', title: 'C1' },
    { id: 'k2', dimension: 'gotchas', severity: 'critical', title: 'K2' },
    { id: 'a2', dimension: 'architecture', severity: 'major', title: 'A2' },
    { id: 'm1', dimension: 'commands', severity: 'minor', title: 'M1' },
  ];
  const rows = gapRows(gaps, dims);
  assert.deepEqual(rows.map((r) => [r.kind, r.dimension, r.severity, (r.items || []).map((i) => i.id)]), [
    ['dimension', 'gotchas', 'critical', ['k1', 'k2']],
    ['gap', 'tool', 'critical', []],
    ['dimension', 'architecture', 'major', ['a1', 'a2']],
    ['dimension', 'conventions', 'minor', ['c1']],   // 3 points lost
    ['dimension', 'commands', 'minor', ['m1']],      // 2.5 points lost, same severity: after conventions
  ]);
  assert.equal(rows[0].lost, 15);
  assert.equal(rows[0].label, 'gotchas');
  assert.deepEqual(gapRows([], dims), []);
});

const ALL = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'qwen', 'goose', 'opencode'];
const ids = (selected, opts) => plannedFiles(selected, opts).files.map((r) => r.id);
const brokenSkill = (path) => ({ ...PROBE, commands: [], frontmatter: [{ path, error: 'no description' }] });
const frontmatterFails = (path, selectedTools) => scoreCard(JUDGEMENT, { ...brokenSkill(path), selectedTools }, { final: true })
  .hardFailures.some((h) => h.title === `Skill frontmatter does not parse: ${path}`);

test('includes .agents rows when only gemini is selected', () => {
  assert.deepEqual(ids(['gemini']), ['AGENTS.md', 'GEMINI.md', '.agents/skills/']);
  assert.deepEqual(skillFolders(['gemini']), ['.agents/skills/']);
  for (const e of ['codex', 'copilot', 'cursor', 'gemini', 'opencode', 'goose']) {
    assert.deepEqual(skillFolders([e]), ['.agents/skills/'], e);
    assert.equal(frontmatterFails('.agents/skills/x/SKILL.md', [e]), true, e);
  }
  assert.equal(frontmatterFails('.agents/skills/x/SKILL.md', ['claude', 'qwen']), false);
  assert.deepEqual(plannedFiles(['gemini', 'codex']).files.find((r) => r.id === '.agents/skills/').tools, ['gemini', 'codex'], 'in selection order');
});

test('includes .qwen rows only with qwen', () => {
  assert.deepEqual(ids(['qwen']), ['AGENTS.md', '.qwen/skills/']);
  assert.ok(!ids(ALL.filter((e) => e !== 'qwen')).includes('.qwen/skills/'));
  assert.equal(frontmatterFails('.qwen/skills/x/SKILL.md', ['qwen']), true);
  assert.equal(frontmatterFails('.qwen/skills/x/SKILL.md', ALL.filter((e) => e !== 'qwen')), false);
  assert.equal(frontmatterFails('.claude/skills/x/SKILL.md', ['claude']), true);
  assert.equal(frontmatterFails('.claude/skills/x/SKILL.md', ['qwen', 'codex']), false);
  assert.deepEqual(skillFolders(ALL), ['.claude/skills/', '.agents/skills/', '.qwen/skills/']);
  assert.deepEqual(ids(ALL), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.claude/skills/', '.agents/skills/', '.qwen/skills/']);
  assert.deepEqual(ids(ALL, { skills: false }), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'], 'no folder rows without a skill');
  assert.deepEqual(plannedFiles([]), { files: [], existing: [] });
});

test('never plans .github/copilot-instructions.md for a repo without one', () => {
  for (const sel of [['copilot'], ALL]) {
    const plan = plannedFiles(sel, { present: ['AGENTS.md'] });
    assert.ok(!plan.files.some((r) => r.id === '.github/copilot-instructions.md'), sel.join(','));
    assert.deepEqual(plan.existing, ['AGENTS.md']);
  }
});

test('keeps an existing copilot-instructions.md row as improve/leave', () => {
  const present = ['.github/copilot-instructions.md'];
  const plan = plannedFiles(['copilot'], { present, copilotNeedsChange: true });
  assert.deepEqual(plan.files.map((r) => r.id), ['AGENTS.md', '.github/copilot-instructions.md', '.agents/skills/']);
  assert.deepEqual(plan.existing, ['.github/copilot-instructions.md'], 'only add, improve or leave alone; never created');
  assert.deepEqual(plannedFiles(['claude'], { present, copilotNeedsChange: true }).existing, [], 'Copilot not selected: the file is not touched');
});

test('plannedFiles: an existing copilot-instructions.md gets a row only when it needs a change', () => {
  const present = ['.github/copilot-instructions.md'];
  assert.ok(!ids(['copilot'], { present }).includes('.github/copilot-instructions.md'), 'present but fine: no row');
  assert.ok(ids(['copilot'], { present, copilotNeedsChange: true }).includes('.github/copilot-instructions.md'));
  assert.ok(!ids(['copilot'], { present: [], copilotNeedsChange: true }).includes('.github/copilot-instructions.md'), 'never new');
});

test('verdictFor: a chip member with no card is blocked with "No judgement for <member>"', () => {
  const m = mergeMembers({ a: card(100) });
  const chip = { members: { a: { blocking: [], outside: [] }, b: { blocking: [], outside: [] } } };
  const v = verdictFor(m, chip);
  assert.deepEqual(v.blocked, ['b']);
  assert.ok(v.issues.some((i) => i.severity === 'critical' && /No judgement for b/.test(i.title)));
  const withRows = verdictFor(m, { members: { ...chip.members, b: { blocking: [{ severity: 'critical', title: 'Codex: Instructions committed', detail: '', location: '' }], outside: [] } } });
  assert.deepEqual(withRows.blocked, ['b']);
  assert.ok(withRows.issues.some((i) => i.title === 'b: Codex: Instructions committed'), 'its chip rows ride along');
  assert.match(withRows.summary, /^Blocked: b;/);
});
