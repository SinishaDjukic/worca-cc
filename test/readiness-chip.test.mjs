import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderReadinessChip, chipTooltip, readinessMenuModel, renderLevelLabel, readinessAddedToast, workspaceReadinessAggregate } from '../ui/public/readiness-chip.mjs';


const doc = () => new JSDOM().window.document;
const summary = (o) => ({ level: 'not-ready', failingCount: 2, mustFix: 1, shouldFix: 1, passed: 5, applicable: 9, ...o });

describe('renderReadinessChip v2', () => {
  it('not-ready: words, a count disc, no dot', () => {
    const chip = renderReadinessChip(summary(), { doc: doc() });
    assert.equal(chip.className, 'pl-rd rd-not-ready');
    assert.equal(chip.firstChild.textContent, 'Not agent-ready');
    assert.equal(chip.querySelector('.rd-n').textContent, '2');
    assert.equal(chip.querySelector('.rd-dot'), null);
  });
  it('ready has no number even with advice failing', () => {
    const chip = renderReadinessChip(summary({ level: 'ready', failingCount: 0, mustFix: 0, shouldFix: 0, passed: 7 }), { doc: doc() });
    assert.equal(chip.textContent, 'Agent-ready');
    assert.equal(chip.querySelector('.rd-n'), null);
  });
  it('tooltip and accessible name spell out the count', () => {
    assert.equal(chipTooltip(summary()), '1 must fix, 1 should fix. 5 of 9 checks pass.');
    assert.equal(chipTooltip(summary({ mustFix: 0, shouldFix: 0, failingCount: 0 })), '5 of 9 checks pass.');
    const chip = renderReadinessChip(summary(), { doc: doc() });
    assert.equal(chip.title, '1 must fix, 1 should fix. 5 of 9 checks pass.');
    assert.equal(chip.getAttribute('aria-label'), 'Not agent-ready, 2 open problems. 1 must fix, 1 should fix. 5 of 9 checks pass.');
  });
  it('no copy uses a middle dot', () => {
    assert.doesNotMatch(chipTooltip(summary()), /·/);
  });
});

describe('readinessMenuModel', () => {
  const label = (n) => ({ claude: 'Claude Code', codex: 'OpenAI Codex', copilot: 'GitHub Copilot', cursor: 'Cursor' })[n];
  const report = {
    level: 'partial',
    counts: { mustFix: 0, shouldFix: 1, passed: 9, applicable: 12 },
    engines: {
      claude: { used: true, level: 'ready', reasons: [{ kind: 'run-engine', text: 'runs use it' }], failing: [] },
      codex: { used: false, level: 'unused', reasons: [], failing: [] },
      copilot: { used: true, level: 'partial', reasons: [{ kind: 'file', text: 'copilot-instructions.md in repo' }], failing: ['instructions.size'] },
    },
    checks: [
      { id: 'commands.build', title: 'Build command', scope: 'repository', severity: 'info', status: 'fail', detail: 'no build command discoverable', fix: 'Add a build script.' },
      { id: 'commands.test', title: 'Test command', scope: 'repository', severity: 'warn', status: 'pass', detail: '`npm test` in package.json', fix: 'x' },
      { id: 'deps.lockfile', title: 'Lockfile', scope: 'repository', severity: 'warn', status: 'ignored', fix: 'x' },
      { id: 'instructions.present', title: 'Agent instructions', scope: 'tool', engine: 'claude', severity: 'blocker', status: 'pass', detail: 'CLAUDE.md found', fix: 'x' },
      { id: 'instructions.size', title: 'Instruction size', scope: 'tool', engine: 'copilot', severity: 'warn', status: 'fail', detail: 'copilot-instructions.md is 52 KB, over the 40 KB limit', fix: 'Trim it.' },
      { id: 'instructions.present', title: 'Agent instructions', scope: 'tool', engine: 'codex', severity: 'blocker', status: 'fail', detail: 'none', fix: 'x' },
    ],
  };
  const m = readinessMenuModel(report, { engineLabel: label });

  it('lists used tools, run engine first, with reason, level and the failing detail', () => {
    assert.deepEqual(m.tools.map((t) => [t.label, t.reason, t.level, t.runs]),
      [['Claude Code', 'runs use it', 'ready', true], ['GitHub Copilot', 'copilot-instructions.md in repo', 'partial', false]]);
    assert.equal(m.tools[1].detail, 'copilot-instructions.md is 52 KB, over the 40 KB limit');
    assert.equal(m.tools[1].fix, 'Trim it.');
    assert.equal(m.tools[0].detail, null);
  });
  it('names the tools that are not judged', () => assert.deepEqual(m.notJudged, ['OpenAI Codex']));
  it('repository failures are grouped by severity; unused tools never appear', () => {
    assert.deepEqual(m.failing.info.map((r) => r.id), ['commands.build']);
    assert.equal(m.failing.blocker.length, 0);
  });
  it('passed covers repository and used tools only', () => {
    assert.deepEqual(m.passed.map((p) => p.title), ['Test command', 'Agent instructions (Claude Code)']);
  });
  it('ignored and the count line', () => {
    assert.deepEqual(m.ignored, [{ id: 'deps.lockfile', title: 'Lockfile' }]);
    assert.equal(m.countLine, '9 of 12 checks pass');
  });
});

describe('renderReadinessChip edge cases', () => {
  it('returns null for no summary or an unknown level', () => {
    assert.strictEqual(renderReadinessChip(null), null);
    assert.strictEqual(renderReadinessChip({ level: 'unknown', failingCount: 0, passed: 0, applicable: 0 }, { doc: doc() }), null);
  });
  it('a non-git directory reads not-ready and gets a chip', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { evaluateReadiness } = await import('../src/core/repo-readiness/evaluate.mjs');
    const { buildReport, summaryOf } = await import('../src/core/repo-readiness/report.mjs');
    const { usedEngines } = await import('../src/core/repo-readiness/used.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'rd-norepo-'));
    try {
      const base = await evaluateReadiness({ dir });
      const usage = usedEngines({ engines: Object.keys(base.engines), runEngine: 'claude', files: base.files });
      const s = summaryOf(buildReport(base, usage));
      assert.equal(s.level, 'not-ready');
      assert.equal(s.failingCount, 1);
      const chip = renderReadinessChip(s, { doc: doc() });
      assert.ok(chip.textContent.startsWith('Not agent-ready'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('a level label is plain words on a tinted pill', () => {
    const l = renderLevelLabel('unused', { doc: doc() });
    assert.equal(l.className, 'rd-lbl rd-unused');
    assert.equal(l.textContent, 'Not used');
  });
});

describe('readinessMenuModel run actions', () => {
  const label = (n) => n;
  const rep = (checks, level = 'partial') => ({ level, counts: { mustFix: 0, shouldFix: 1, passed: 1, applicable: 2 },
    engines: { claude: { used: true, level, reasons: [], failing: [] } }, checks });
  const row = (id, scope, status, engine) => ({ id, title: id, scope, status, severity: 'warn', fix: 'x', ...(engine ? { engine } : {}) });
  const run = (o = {}) => ({ available: { check: true, setup: true }, hasCode: true, lastCheck: null, lastSetup: null, live: null, ...o });
  const R = (o) => ({ runId: null, pipelineId: 'p1', status: 'done', title: 't', workflowId: 'wfp_ai-readiness_setup', workspaceId: null, score: null, at: null, ...o });
  const fixable = rep([row('instructions.present', 'tool', 'fail', 'claude')]);
  const m = (report, r, extra = {}) => readinessMenuModel(report, { engineLabel: label, run: r, projectKey: 'k', ...extra }).run;

  it('evaluate shows for a ready project with code', () => {
    assert.equal(m(rep([], 'ready'), run()).evaluate.show, true);
    assert.equal(m(fixable, run()).evaluate.show, true);
  });
  it('nothing shows for a project without code', () => {
    const r = m(fixable, run({ hasCode: false }));
    assert.equal(r.evaluate.show, false);
    assert.equal(r.setup.show, false);
  });
  it('nothing shows without the plugin, or without a run payload', () => {
    assert.equal(m(fixable, run({ available: { check: false, setup: false } })).evaluate.show, false);
    assert.equal(m(fixable, run({ available: { check: false, setup: false } })).setup.show, false);
    assert.equal(m(fixable, null).evaluate.show, false);
    assert.equal(m(fixable, undefined).setup.show, false);
  });
  it('setup shows when available, with code, and a judged tool, ignore.heavy-dirs or commands.test fails', () => {
    for (const r of [fixable, rep([row('ignore.heavy-dirs', 'repository', 'fail')]), rep([row('commands.test', 'repository', 'fail')])]) {
      assert.equal(m(r, run()).setup.show, true);
    }
  });
  it('no setup when only deps.lockfile, git.repo or secrets.tracked-names fails', () => {
    for (const id of ['deps.lockfile', 'git.repo', 'secrets.tracked-names']) {
      assert.equal(m(rep([row(id, 'repository', 'fail'), row('instructions.present', 'tool', 'pass', 'claude')]), run()).setup.show, false, id);
    }
  });
  it('a live run hides both and shows its line', () => {
    for (const status of ['running', 'starting', 'paused']) {
      const live = R({ runId: 'r1', status, workflowId: 'wfp_ai-readiness_check' });
      const r = m(fixable, run({ live, lastCheck: live }));
      assert.equal(r.evaluate.show, false, status);
      assert.equal(r.setup.show, false, status);
      assert.deepEqual(r.live, { ...live, words: 'running', href: '#running/r1', text: 'Evaluation: running' });
      assert.equal(r.lastCheck, null, 'the live run is not listed twice');
    }
    assert.equal(m(fixable, run({ lastSetup: R() })).setup.show, true, 'a finished run does not hide the button');
  });
  it('the check line shows the score, else its words', () => {
    const scored = m(fixable, run({ lastCheck: R({ workflowId: 'wfp_ai-readiness_check', score: 72 }) })).lastCheck;
    assert.equal(scored.text, 'Evaluated: 72/100');
    assert.equal(scored.score, 72);
    assert.equal(m(fixable, run({ lastCheck: R({ workflowId: 'wfp_ai-readiness_check', status: 'failed' }) })).lastCheck.text, 'Evaluation: failed');
  });
  it('the setup line stays "Setup run: <words>" and carries its link', () => {
    const l = m(fixable, run({ lastSetup: R({ pipelineId: 'p1' }) })).lastSetup;
    assert.equal(l.text, 'Setup run: ready to ship');
    assert.equal(l.href, '#history/k/p1');
  });
  it('a live run links to its run page, a finished one to its History page', () => {
    const at = (last) => m(rep([]), run({ lastSetup: last })).lastSetup.href;
    assert.equal(at(R({ runId: 'live-1', status: 'running' })), '#running/live-1');
    assert.equal(at(R({ runId: 'live-1', status: 'paused' })), '#running/live-1');
    assert.equal(at(R({ runId: null, status: 'running' })), '#history/k/p1', 'live in another process: its History page');
    assert.equal(at(R({ runId: 'live-1', status: 'done' })), '#history/k/p1');
    assert.equal(at(R({ runId: 'live-1', pipelineId: null, status: 'starting' })), '#running/live-1', 'just started: no pipeline yet');
  });
  it('the status reads as words', () => {
    const words = (status) => m(rep([]), run({ lastSetup: R({ status }) })).lastSetup.words;
    for (const s of ['starting', 'running', 'paused']) assert.equal(words(s), 'running', s);
    for (const s of ['done', 'completed']) assert.equal(words(s), 'ready to ship', s);
    for (const s of ['error', 'failed']) assert.equal(words(s), 'failed', s);
    for (const s of ['stopped', 'interrupted']) assert.equal(words(s), 'stopped', s);
  });
  it('another plugin\'s check workflow is not labelled an evaluation', () => {
    const live = R({ runId: 'r2', status: 'running', workflowId: 'wfp_other_check' });
    assert.doesNotMatch(m(rep([]), run({ live })).live.text, /^Evaluation/);
    assert.match(m(rep([]), run({ live: { ...live, workflowId: 'wfp_ai-readiness_check' } })).live.text, /^Evaluation/);
  });
  it('a live workspace run names its workspace and a finished one links to the workspace History page', () => {
    const name = (id) => ({ w1: 'Platform' })[id];
    const live = R({ runId: 'r9', status: 'running', workspaceId: 'w1', workflowId: 'wfp_ai-readiness_check' });
    assert.equal(m(rep([]), run({ live }), { workspaceName: name }).live.text, 'Evaluation (workspace Platform): running');
    assert.equal(m(rep([]), run({ live: { ...live, workflowId: 'wfp_ai-readiness_setup' } }), { workspaceName: name }).live.text, 'Setup run (workspace Platform): running');
    assert.equal(m(rep([]), run({ live }), { workspaceName: name }).live.href, '#running/r9');
    const done = R({ status: 'done', workspaceId: 'w1', pipelineId: 'p5' });
    assert.equal(m(rep([]), run({ lastSetup: done })).lastSetup.href, '#history/workspaces/w1/p5');
    assert.equal(m(rep([]), run({ live }), {}).live.text, 'Evaluation (workspace w1): running', 'an unknown workspace reads by its id');
  });
});

describe('readinessAddedToast', () => {
  it('toast has the action only when available', () => {
    const msg = { type: 'readiness-added', projectKey: 'p-1', name: 'P', engine: 'codex' };
    const store = () => ({ getItem: () => null, setItem() {} });
    const run = () => {};
    const on = readinessAddedToast(msg, { storage: store(), run: () => {}, setup: { available: true, run } });
    assert.equal(on.extraAction.label, 'Set up with AI');
    assert.equal(on.extraAction.run, run);
    assert.equal(on.key, 'readiness-p-1');
    assert.equal(on.action.label, 'See what to add');
    assert.equal(readinessAddedToast(msg, { storage: store(), run: () => {}, setup: { available: false, run } }).extraAction, undefined);
    assert.equal(readinessAddedToast(msg, { storage: store(), run: () => {} }).extraAction, undefined);
  });
});

describe('readinessAddedToast (evaluate)', () => {
  it('offers Evaluate in depth when only the check is available, Set up with AI first when both are', () => {
    const msg = { type: 'readiness-added', projectKey: 'p-2', name: 'P', engine: 'codex' };
    const store = () => ({ getItem: () => null, setItem() {} });
    const run = () => {};
    const ev = readinessAddedToast(msg, { storage: store(), run, setup: { available: false, run }, check: { available: true, run } });
    assert.equal(ev.extraAction.label, 'Evaluate in depth');
    const both = readinessAddedToast(msg, { storage: store(), run, setup: { available: true, run }, check: { available: true, run } });
    assert.equal(both.extraAction.label, 'Set up with AI');
  });
});

describe('readinessAddedToast (once)', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  const msg = { type: 'readiness-added', projectKey: 'proj-1', name: 'Proj', engine: 'codex' };

  it('builds a warn toast naming the project and engine, with a "See what to add" action', () => {
    const run = () => {};
    const o = readinessAddedToast(msg, { storage: memory(), run });
    assert.strictEqual(o.tone, 'warn');
    assert.strictEqual(o.title, 'Proj is missing agent instructions for codex');  // the server sends the engine's label
    assert.strictEqual(o.key, 'readiness-proj-1');
    assert.strictEqual(o.action.label, 'See what to add');
    assert.strictEqual(o.action.run, run);
  });

  it('fires once per project: the second frame for the same key is null', () => {
    const storage = memory();
    assert.ok(readinessAddedToast(msg, { storage, run() {} }));
    assert.strictEqual(readinessAddedToast(msg, { storage, run() {} }), null);
    assert.ok(readinessAddedToast({ ...msg, projectKey: 'proj-2' }, { storage, run() {} }));
  });

  it('is null for a frame without a project key and survives a broken storage', () => {
    assert.strictEqual(readinessAddedToast({ type: 'readiness-added' }, { storage: memory(), run() {} }), null);
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.ok(readinessAddedToast(msg, { storage: broken, run() {} }));
  });
});

describe('workspaceReadinessAggregate', () => {
  const lv = (level) => summary({ level });
  it('aggregate is the lowest member', () => {
    assert.equal(workspaceReadinessAggregate([lv('ready'), lv('partial'), lv('ready')]).level, 'partial');
    assert.equal(workspaceReadinessAggregate([lv('ready'), lv('partial'), lv('not-ready')]).level, 'not-ready');
    assert.equal(workspaceReadinessAggregate([lv('ready'), lv('ready')]).level, 'ready');
  });
  it('N of M counts ready members', () => {
    assert.deepEqual(workspaceReadinessAggregate([lv('ready'), lv('partial'), lv('ready')]), { level: 'partial', ready: 2, total: 3, known: 3 });
  });
  it('a missing member counts as unknown', () => {
    assert.deepEqual(workspaceReadinessAggregate([lv('ready'), null]), { level: 'unknown', ready: 1, total: 2, known: 1 });
    assert.deepEqual(workspaceReadinessAggregate([null, undefined]), { level: 'unknown', ready: 0, total: 2, known: 0 });
    assert.equal(workspaceReadinessAggregate([lv('ready'), { level: 'unknown' }]).ready, 1);
  });
});
