import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Capture spawn calls to inspect args
let spawnCalls = [];
const fakeChild = {
  pid: 99999,
  unref: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn((...args) => {
    spawnCalls.push(args);
    // Simulate a child that stays alive (timeout resolves the promise)
    return fakeChild;
  }),
  execFileSync: vi.fn(),
}));

const { startPipeline } = await import('../process-manager.js');

describe('startPipeline arg building', () => {
  let tmpDir, worcaDir;

  beforeEach(() => {
    spawnCalls = [];
    fakeChild.on.mockReset();
    fakeChild.unref.mockReset();

    tmpDir = mkdtempSync(join(tmpdir(), 'pm-args-test-'));
    worcaDir = join(tmpDir, '.worca');
    mkdirSync(worcaDir, { recursive: true });

    // Create the script file so existsSync passes
    const scriptDir = join(tmpDir, '.claude', 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, 'run_pipeline.py'), '# stub');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function getArgs() {
    expect(spawnCalls.length).toBe(1);
    return spawnCalls[0][1]; // spawn(cmd, args, options)
  }

  // --- New format: sourceType + prompt ---

  it('builds --source arg when sourceType=source', async () => {
    const p = startPipeline(worcaDir, {
      sourceType: 'source',
      sourceValue: 'gh:issue:42',
      projectRoot: tmpDir,
    });
    // Trigger the timeout resolve via the 'on' mock
    // The promise resolves after 2s timeout, so we need to handle it
    // Actually, fakeChild.on doesn't fire events, so the timeout fires
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--source');
    expect(args[args.indexOf('--source') + 1]).toBe('gh:issue:42');
    expect(args).not.toContain('--prompt');
  });

  it('builds --spec arg when sourceType=spec', async () => {
    startPipeline(worcaDir, {
      sourceType: 'spec',
      sourceValue: 'docs/spec.md',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--spec');
    expect(args[args.indexOf('--spec') + 1]).toBe('docs/spec.md');
    expect(args).not.toContain('--prompt');
  });

  it('builds --prompt arg when sourceType=none with prompt', async () => {
    startPipeline(worcaDir, {
      sourceType: 'none',
      prompt: 'Add user auth',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--prompt');
    expect(args[args.indexOf('--prompt') + 1]).toBe('Add user auth');
    expect(args).not.toContain('--source');
    expect(args).not.toContain('--spec');
  });

  it('builds --source + --prompt when both provided', async () => {
    startPipeline(worcaDir, {
      sourceType: 'source',
      sourceValue: 'gh:issue:42',
      prompt: 'focus on auth',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--source');
    expect(args[args.indexOf('--source') + 1]).toBe('gh:issue:42');
    expect(args).toContain('--prompt');
    expect(args[args.indexOf('--prompt') + 1]).toBe('focus on auth');
  });

  it('builds only --plan when plan-only (no source, no prompt)', async () => {
    startPipeline(worcaDir, {
      sourceType: 'none',
      planFile: 'docs/plans/my-plan.md',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--plan');
    expect(args[args.indexOf('--plan') + 1]).toBe('docs/plans/my-plan.md');
    expect(args).not.toContain('--source');
    expect(args).not.toContain('--spec');
    expect(args).not.toContain('--prompt');
  });

  it('builds --spec + --prompt + --plan when all provided', async () => {
    startPipeline(worcaDir, {
      sourceType: 'spec',
      sourceValue: 'docs/spec.md',
      prompt: 'extra instructions',
      planFile: 'docs/plans/my-plan.md',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--spec');
    expect(args[args.indexOf('--spec') + 1]).toBe('docs/spec.md');
    expect(args).toContain('--prompt');
    expect(args[args.indexOf('--prompt') + 1]).toBe('extra instructions');
    expect(args).toContain('--plan');
    expect(args[args.indexOf('--plan') + 1]).toBe('docs/plans/my-plan.md');
  });

  // --- Legacy format: inputType/inputValue ---

  it('legacy: builds --prompt from inputType=prompt', async () => {
    startPipeline(worcaDir, {
      inputType: 'prompt',
      inputValue: 'Add user auth',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--prompt');
    expect(args[args.indexOf('--prompt') + 1]).toBe('Add user auth');
  });

  it('legacy: builds --source from inputType=source', async () => {
    startPipeline(worcaDir, {
      inputType: 'source',
      inputValue: 'gh:issue:42',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--source');
    expect(args[args.indexOf('--source') + 1]).toBe('gh:issue:42');
  });

  it('legacy: builds --spec from inputType=spec', async () => {
    startPipeline(worcaDir, {
      inputType: 'spec',
      inputValue: 'docs/spec.md',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--spec');
    expect(args[args.indexOf('--spec') + 1]).toBe('docs/spec.md');
  });

  // --- Other options ---

  it('includes --msize and --mloops when > 1', async () => {
    startPipeline(worcaDir, {
      sourceType: 'none',
      prompt: 'test',
      msize: 3,
      mloops: 2,
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--msize');
    expect(args[args.indexOf('--msize') + 1]).toBe('3');
    expect(args).toContain('--mloops');
    expect(args[args.indexOf('--mloops') + 1]).toBe('2');
  });

  it('omits --msize and --mloops when 1', async () => {
    startPipeline(worcaDir, {
      sourceType: 'none',
      prompt: 'test',
      msize: 1,
      mloops: 1,
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).not.toContain('--msize');
    expect(args).not.toContain('--mloops');
  });

  it('includes --branch when provided', async () => {
    startPipeline(worcaDir, {
      sourceType: 'none',
      prompt: 'test',
      branch: 'feature/my-branch',
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--branch');
    expect(args[args.indexOf('--branch') + 1]).toBe('feature/my-branch');
  });

  it('uses --resume when resume=true', async () => {
    startPipeline(worcaDir, {
      resume: true,
      projectRoot: tmpDir,
    });
    await vi.waitFor(() => expect(spawnCalls.length).toBe(1), { timeout: 100 });

    const args = getArgs();
    expect(args).toContain('--resume');
    expect(args).not.toContain('--source');
    expect(args).not.toContain('--prompt');
  });
});
