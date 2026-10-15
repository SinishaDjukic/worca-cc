import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderReadinessChip, chipTooltip, readinessMenuModel, renderLevelLabel, readinessAddedToast } from '../ui/public/readiness-chip.mjs';


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
  it('a level label is plain words on a tinted pill', () => {
    const l = renderLevelLabel('unused', { doc: doc() });
    assert.equal(l.className, 'rd-lbl rd-unused');
    assert.equal(l.textContent, 'Not used');
  });
});

describe('readinessAddedToast', () => {
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
