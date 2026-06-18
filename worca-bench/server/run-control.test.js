import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearProfileResults,
  killTrackedGroups,
  stopProfileRuns,
} from './run-control.js';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-ctl-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('clearProfileResults', () => {
  it('drops the profile rows and removes its runs/work trees', () => {
    const rows = [
      { profile: 'keep', instance_id: 'x', rep: 1 },
      { profile: 'gone', instance_id: 'y', rep: 1 },
      { profile: 'gone', instance_id: 'y', rep: 2 },
    ];
    writeFileSync(
      join(dir, 'results.jsonl'),
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );
    mkdirSync(join(dir, 'runs', 'gone', 'y', 'rep1'), { recursive: true });
    mkdirSync(join(dir, 'work', 'gone', 'y', 'rep1'), { recursive: true });
    mkdirSync(join(dir, 'runs', 'keep'), { recursive: true });

    const removed = clearProfileResults('gone', [dir]);

    expect(removed).toBe(2);
    const remaining = readFileSync(join(dir, 'results.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(remaining).toEqual([{ profile: 'keep', instance_id: 'x', rep: 1 }]);
    expect(existsSync(join(dir, 'runs', 'gone'))).toBe(false);
    expect(existsSync(join(dir, 'work', 'gone'))).toBe(false);
    expect(existsSync(join(dir, 'runs', 'keep'))).toBe(true); // untouched
  });

  it('is a no-op when the profile has no rows or trees', () => {
    writeFileSync(join(dir, 'results.jsonl'), '');
    expect(clearProfileResults('nobody', [dir])).toBe(0);
  });
});

describe('stopProfileRuns', () => {
  it('returns 0 when no runner process matches', async () => {
    expect(await stopProfileRuns('definitely-not-a-running-profile-xyz')).toBe(
      0,
    );
  });
});

// Write a worca proc-registry entry: <dir>/work/<name>/<inst>/rep1/.worca/runs/<id>/procs/<pgid>.json
function seedProcEntry(name, inst, runId, { pgid, pid }) {
  const procsDir = join(
    dir,
    'work',
    name,
    inst,
    'rep1',
    '.worca',
    'runs',
    runId,
    'procs',
  );
  mkdirSync(procsDir, { recursive: true });
  writeFileSync(
    join(procsDir, `${pgid}.json`),
    JSON.stringify({ pgid, pid, stage: 'implement', iteration: 1 }),
  );
}

const posix = process.platform !== 'win32';

describe('killTrackedGroups (orphan reap)', () => {
  it('SIGKILLs a tracked agent process group (detached session leader)', async () => {
    if (!posix) return; // negative-pid group signal is POSIX-only
    // A detached child is its own session/group leader: pgid === child.pid —
    // exactly the shape worca records for a start_new_session agent.
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(child.pid, 0)).not.toThrow(); // alive

    seedProcEntry('p1', 'lib', 'p1__lib__rep1', {
      pgid: child.pid,
      pid: child.pid,
    });
    const reaped = await killTrackedGroups([dir], 'p1');
    expect(reaped).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(child.pid, 0)).toThrow(); // gone
  });

  it('skips stale entries whose leader pid is no longer alive', async () => {
    seedProcEntry('p1', 'lib', 'p1__lib__rep1', {
      pgid: 2147483000, // implausible pid → not alive
      pid: 2147483000,
    });
    expect(await killTrackedGroups([dir], 'p1')).toBe(0);
  });

  it('is a no-op (0) when the profile has no procs registry', async () => {
    expect(await killTrackedGroups([dir], 'nope')).toBe(0);
  });

  it('rejects unsafe profile names', async () => {
    await expect(killTrackedGroups([dir], '../../x')).rejects.toThrow(
      /invalid profile name/,
    );
  });
});

describe('input validation (security)', () => {
  it('rejects path-traversal / unsafe profile names before any fs/proc work', () => {
    mkdirSync(join(dir, 'work'), { recursive: true });
    for (const bad of ['../evil', 'a/b', '..', '.', 'a b', 'a;rm', '$(x)']) {
      expect(() => clearProfileResults(bad, [dir])).toThrow(
        /invalid profile name/,
      );
    }
  });

  it('rejects unsafe names in stopProfileRuns', async () => {
    await expect(stopProfileRuns('../../x')).rejects.toThrow(
      /invalid profile name/,
    );
  });

  it('does not delete outside <dir>/<sub> for a crafted dirs arg', () => {
    // Even a valid name only ever touches <dir>/runs|work/<name>.
    mkdirSync(join(dir, 'sibling'), { recursive: true });
    mkdirSync(join(dir, 'work', 'p'), { recursive: true });
    clearProfileResults('p', [dir]);
    expect(existsSync(join(dir, 'sibling'))).toBe(true);
    expect(existsSync(join(dir, 'work', 'p'))).toBe(false);
  });
});
