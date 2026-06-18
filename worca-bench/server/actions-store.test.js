import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findAction,
  patchAction,
  pidAlive,
  readActions,
  recordAction,
} from './actions-store.js';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wb-actions-'));
});

const ALIVE = () => true;
const DEAD = () => false;

describe('recordAction / readActions', () => {
  it('records a running action with id + timestamps', () => {
    const rec = recordAction(dir, {
      type: 'run',
      profile: 'demo',
      src: 'abc123',
      pid: 4242,
      params: { reps: 1 },
      startedAt: '2026-06-18T10:00:00.000Z',
    });
    expect(rec.status).toBe('running');
    expect(rec.type).toBe('run');
    expect(rec.id).toContain('run-demo-4242');
    const [a] = readActions(dir, { _pidAlive: ALIVE });
    expect(a.id).toBe(rec.id);
    expect(a.status).toBe('running');
    expect(a.params.reps).toBe(1);
  });

  it('collapses to the latest record per id (patch wins)', () => {
    const rec = recordAction(dir, { type: 'regrade', profile: 'p', pid: 7 });
    patchAction(dir, rec.id, {
      status: 'stopped',
      ended_at: '2026-06-18T11:00:00Z',
    });
    const [a] = readActions(dir, { _pidAlive: ALIVE });
    expect(a.status).toBe('stopped');
    expect(a.ended_at).toBe('2026-06-18T11:00:00Z');
  });

  it('reconciles a dead pid to completed and persists the terminal record', () => {
    const rec = recordAction(dir, { type: 'run', profile: 'p', pid: 999999 });
    const [a] = readActions(dir, {
      _pidAlive: DEAD,
      now: '2026-06-18T12:00:00Z',
    });
    expect(a.status).toBe('completed');
    expect(a.ended_at).toBe('2026-06-18T12:00:00Z');
    // persisted: a fresh read (even claiming alive) stays completed
    const [b] = readActions(dir, { _pidAlive: ALIVE });
    expect(b.status).toBe('completed');
    expect(b.id).toBe(rec.id);
  });

  it('keeps an action running while its pid is alive', () => {
    recordAction(dir, { type: 'run', profile: 'p', pid: 123 });
    const [a] = readActions(dir, { _pidAlive: ALIVE });
    expect(a.status).toBe('running');
    expect(a.ended_at).toBeUndefined();
  });

  it('does not resurrect an explicitly stopped action even if pid looks dead', () => {
    const rec = recordAction(dir, { type: 'run', profile: 'p', pid: 5 });
    patchAction(dir, rec.id, {
      status: 'stopped',
      ended_at: '2026-06-18T11:00:00Z',
    });
    const [a] = readActions(dir, { _pidAlive: DEAD });
    expect(a.status).toBe('stopped'); // terminal, untouched by reconciliation
  });

  it('skips malformed lines without throwing', () => {
    recordAction(dir, { type: 'run', profile: 'good', pid: 1 });
    const f = join(dir, 'actions.jsonl');
    writeFileSync(f, `${readFileSync(f, 'utf8')}{torn\n`);
    const all = readActions(dir, { _pidAlive: ALIVE });
    expect(all.length).toBe(1);
    expect(all[0].profile).toBe('good');
  });

  it('returns actions newest-first by started_at', () => {
    recordAction(dir, {
      type: 'run',
      profile: 'old',
      pid: 1,
      startedAt: '2026-06-18T09:00:00Z',
    });
    recordAction(dir, {
      type: 'run',
      profile: 'new',
      pid: 2,
      startedAt: '2026-06-18T10:00:00Z',
    });
    const order = readActions(dir, { _pidAlive: ALIVE }).map((a) => a.profile);
    expect(order).toEqual(['new', 'old']);
  });

  it('findAction returns one by id without a reconcile write-back', () => {
    const rec = recordAction(dir, { type: 'regrade', profile: 'p', pid: 3 });
    const before = readFileSync(join(dir, 'actions.jsonl'), 'utf8');
    const a = findAction(dir, rec.id, { _pidAlive: DEAD });
    expect(a.id).toBe(rec.id);
    // no extra terminal line appended (reconcile suppressed)
    expect(readFileSync(join(dir, 'actions.jsonl'), 'utf8')).toBe(before);
  });
});

describe('pidAlive', () => {
  it('is true for the current process and false for an invalid pid', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(undefined)).toBe(false);
  });
});
