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
import { clearProfileResults, stopProfileRuns } from './run-control.js';

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
