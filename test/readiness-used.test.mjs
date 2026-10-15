import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { usedEngines, toolFiles } from '../src/core/repo-readiness/used.mjs';

const ENGINES = ['claude', 'codex', 'copilot', 'cursor'];
const used = (o) => usedEngines({ engines: ENGINES, runEngine: 'claude', ...o });
const usedNames = (r) => Object.entries(r).filter(([, v]) => v.used).map(([k]) => k);

describe('usedEngines', () => {
  it('a fresh project judges only the run engine', () => {
    const r = used({});
    assert.deepEqual(usedNames(r), ['claude']);
    assert.deepEqual(r.claude.reasons, [{ kind: 'run-engine', text: 'runs use it' }]);
    assert.equal(r.codex.detected, false);
  });

  it('run history inside the window counts', () => {
    const r = used({ history: { codex: 3 } });
    assert.deepEqual(usedNames(r), ['claude', 'codex']);
    assert.deepEqual(r.codex.reasons, [{ kind: 'history', text: 'used in 3 runs' }]);
  });

  it('one run reads "used in 1 run"', () => {
    assert.equal(used({ history: { codex: 1 } }).codex.reasons[0].text, 'used in 1 run');
  });

  it('a tool file counts', () => {
    const r = used({ files: { copilot: 'copilot-instructions.md' } });
    assert.deepEqual(r.copilot.reasons, [{ kind: 'file', text: 'copilot-instructions.md in repo' }]);
    assert.equal(r.copilot.used, true);
  });

  it('unused wins over every signal for that tool only', () => {
    const r = used({ files: { copilot: 'copilot-instructions.md' }, history: { codex: 2 }, settings: { copilot: 'unused' } });
    assert.equal(r.copilot.used, false);
    assert.equal(r.copilot.detected, true);
    assert.equal(r.copilot.setting, 'unused');
    assert.equal(r.codex.used, true, 'other tools keep detecting');
  });

  it('used wins over no signal', () => {
    const r = used({ settings: { cursor: 'used' } });
    assert.equal(r.cursor.used, true);
    assert.deepEqual(r.cursor.reasons, [{ kind: 'setting', text: 'set by you' }]);
  });

  it('the run engine is judged even when set to unused', () => {
    const r = used({ settings: { claude: 'unused' } });
    assert.equal(r.claude.used, true);
    assert.equal(r.claude.setting, 'unused');
    assert.deepEqual(r.claude.reasons, [{ kind: 'run-engine', text: 'runs use it' }]);
  });

  it('signals say what Detect finds even when the setting overrides it', () => {
    const r = used({ files: { copilot: 'copilot-instructions.md' }, settings: { copilot: 'used' } });
    assert.deepEqual(r.copilot.reasons, [{ kind: 'setting', text: 'set by you' }]);
    assert.deepEqual(r.copilot.signals, [{ kind: 'file', text: 'copilot-instructions.md in repo' }]);
  });

  it('an unknown setting value reads as detect', () => {
    assert.equal(used({ settings: { codex: 'maybe' } }).codex.setting, 'detect');
  });
});

describe('toolFiles', () => {
  const facts = (paths) => ({ trackedSet: new Set(paths) });
  it('maps each tool-specific file to its engine', () => {
    assert.deepEqual(toolFiles(facts(['CLAUDE.md', '.github/copilot-instructions.md', '.cursor/rules/a.mdc'])),
      { claude: 'CLAUDE.md', copilot: 'copilot-instructions.md', cursor: '.cursor/rules' });
  });
  it('AGENTS.md alone marks nothing', () => {
    assert.deepEqual(toolFiles(facts(['AGENTS.md', 'AGENTS.override.md'])), {});
  });
  it('.github/instructions counts for copilot', () => {
    assert.deepEqual(toolFiles(facts(['.github/instructions/api.instructions.md'])), { copilot: '.github/instructions' });
  });
  it('no tracked set: nothing', () => assert.deepEqual(toolFiles({}), {}));
});
