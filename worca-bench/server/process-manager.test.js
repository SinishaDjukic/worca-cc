import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { runBenchmark } from './process-manager.js';

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stderr = new EventEmitter();
  child.unref = () => {};
  return child;
}

describe('runBenchmark', () => {
  it('rejects when profile is missing', async () => {
    await expect(runBenchmark({ targetDir: '/tmp' })).rejects.toThrow(
      /profile is required/,
    );
  });

  it('spawns the python runner with the right args and resolves {pid}', async () => {
    let capturedCmd = null;
    let capturedArgs = null;
    const _spawn = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return fakeChild(9999);
    };
    const res = await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      _spawn,
    });
    expect(res).toEqual({ pid: 9999 });
    expect(capturedCmd).toBe('python3');
    expect(capturedArgs).toEqual([
      '-m',
      'worca_bench.cli',
      'run',
      '--profile',
      'smoke',
      '--target-dir',
      '/tmp/out',
    ]);
  });

  it('detaches and ignores stdin/stdout, pipes stderr', async () => {
    let capturedOpts = null;
    const _spawn = (_cmd, _args, opts) => {
      capturedOpts = opts;
      return fakeChild(123);
    };
    await runBenchmark({ profile: 'p', targetDir: '/tmp', _spawn });
    expect(capturedOpts.detached).toBe(true);
    expect(capturedOpts.stdio).toEqual(['ignore', 'ignore', 'pipe']);
  });

  it('rejects if the child errors before producing a pid', async () => {
    const _spawn = () => {
      const child = new EventEmitter();
      child.pid = undefined;
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    };
    await expect(
      runBenchmark({ profile: 'p', targetDir: '/tmp', _spawn }),
    ).rejects.toThrow(/Failed to start benchmark/);
  });
});
