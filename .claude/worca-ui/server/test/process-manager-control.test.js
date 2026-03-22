import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import { pausePipeline, stopPipeline } from '../process-manager.js';

function makeTmpDir() {
  const d = join(tmpdir(), `worca-ctrl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

// ─── pausePipeline ─────────────────────────────────────────────────────────────

describe('pausePipeline', () => {
  let worcaDir;

  beforeEach(() => { worcaDir = makeTmpDir(); });
  afterEach(() => rmSync(worcaDir, { recursive: true, force: true }));

  it('writes control.json with action=pause and source=ui', () => {
    pausePipeline(worcaDir, 'run-abc');
    const data = JSON.parse(readFileSync(join(worcaDir, 'runs', 'run-abc', 'control.json'), 'utf8'));
    expect(data.action).toBe('pause');
    expect(data.source).toBe('ui');
  });

  it('returns { runId, paused: true }', () => {
    const result = pausePipeline(worcaDir, 'run-xyz');
    expect(result).toEqual({ runId: 'run-xyz', paused: true });
  });

  it('creates parent directories when they do not exist', () => {
    pausePipeline(worcaDir, 'new-run-abc');
    expect(existsSync(join(worcaDir, 'runs', 'new-run-abc'))).toBe(true);
  });

  it('requested_at is a valid ISO timestamp', () => {
    const before = Date.now();
    pausePipeline(worcaDir, 'run-ts');
    const after = Date.now();
    const data = JSON.parse(readFileSync(join(worcaDir, 'runs', 'run-ts', 'control.json'), 'utf8'));
    expect(typeof data.requested_at).toBe('string');
    const t = new Date(data.requested_at).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after + 1000);
  });

  it('overwrites an existing control.json', () => {
    const runDir = join(worcaDir, 'runs', 'run-ow');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'control.json'), JSON.stringify({ action: 'stop', requested_at: 'old', source: 'cli' }));

    pausePipeline(worcaDir, 'run-ow');

    const data = JSON.parse(readFileSync(join(runDir, 'control.json'), 'utf8'));
    expect(data.action).toBe('pause');
    expect(data.source).toBe('ui');
  });
});

// ─── stopPipeline control.json ─────────────────────────────────────────────────

describe('stopPipeline writes control.json', () => {
  let worcaDir;
  const children = [];

  async function spawnLongProcess() {
    const child = spawn('node', ['-e', 'setTimeout(()=>{},30000)'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    children.push(child);
    await new Promise(resolve => setTimeout(resolve, 80));
    return child;
  }

  beforeEach(() => { worcaDir = makeTmpDir(); });

  afterEach(() => {
    rmSync(worcaDir, { recursive: true, force: true });
    for (const c of children) {
      try { process.kill(c.pid, 'SIGKILL'); } catch { /* already dead */ }
    }
    children.length = 0;
  });

  it('writes control.json with action=stop when active_run exists', async () => {
    const runId = 'stop-run-001';
    mkdirSync(join(worcaDir, 'runs', runId), { recursive: true });
    writeFileSync(join(worcaDir, 'active_run'), runId, 'utf8');

    const child = await spawnLongProcess();
    writeFileSync(join(worcaDir, 'pipeline.pid'), String(child.pid), 'utf8');

    stopPipeline(worcaDir);

    const controlPath = join(worcaDir, 'runs', runId, 'control.json');
    expect(existsSync(controlPath)).toBe(true);
    const data = JSON.parse(readFileSync(controlPath, 'utf8'));
    expect(data.action).toBe('stop');
    expect(data.source).toBe('ui');
    expect(typeof data.requested_at).toBe('string');
    expect(new Date(data.requested_at).getTime()).not.toBeNaN();
  });

  it('does not throw and skips control.json when active_run is missing', async () => {
    const child = await spawnLongProcess();
    writeFileSync(join(worcaDir, 'pipeline.pid'), String(child.pid), 'utf8');

    expect(() => stopPipeline(worcaDir)).not.toThrow();
    expect(existsSync(join(worcaDir, 'runs'))).toBe(false);
  });
});
