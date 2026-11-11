import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { runEngineCounts } from '../src/core/artifacts.mjs';

describe('runEngineCounts', () => {
  const home = useTempHome(after, 'worca-cc-rd-used-');
  it('counts runs per engine since a date; NULL engine is claude', () => {
    void home;
    const db = getDb();
    const ins = db.prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, started_at, outcome, resume_point)
      VALUES (?, 'pk', 'project', 'done', 'done', ?, ?, NULL)`);
    ins.run('a1', '2026-10-01T00:00:00Z', JSON.stringify({ runEngine: 'codex' }));
    ins.run('a2', '2026-10-02T00:00:00Z', JSON.stringify({ runEngine: 'codex' }));
    ins.run('a3', '2026-10-03T00:00:00Z', null);
    ins.run('a4', '2026-01-01T00:00:00Z', JSON.stringify({ runEngine: 'copilot' }));   // outside the window
    assert.deepEqual(runEngineCounts('pk', '2026-07-01T00:00:00Z'), { codex: 2, claude: 1 });
    assert.deepEqual(runEngineCounts('other', '2026-07-01T00:00:00Z'), {});
  });
});
