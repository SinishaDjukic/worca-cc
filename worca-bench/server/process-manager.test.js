import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { runBenchmark, runRegrade } from './process-manager.js';

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

  it('appends --profiles-dir when given (and omits it otherwise)', async () => {
    let capturedArgs = null;
    const _spawn = (_cmd, args) => {
      capturedArgs = args;
      return fakeChild(7);
    };
    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      profilesDir: '/authored/profiles',
      _spawn,
    });
    expect(capturedArgs).toEqual([
      '-m',
      'worca_bench.cli',
      'run',
      '--profile',
      'smoke',
      '--target-dir',
      '/tmp/out',
      '--profiles-dir',
      '/authored/profiles',
    ]);
  });

  it('appends --reps and --max-instances when valid (ignores junk)', async () => {
    let capturedArgs = null;
    const _spawn = (_cmd, args) => {
      capturedArgs = args;
      return fakeChild(8);
    };
    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      reps: 3,
      maxInstances: 5,
      maxParallel: 6,
      _spawn,
    });
    expect(capturedArgs).toContain('--reps');
    expect(capturedArgs[capturedArgs.indexOf('--reps') + 1]).toBe('3');
    expect(capturedArgs).toContain('--max-instances');
    expect(capturedArgs[capturedArgs.indexOf('--max-instances') + 1]).toBe('5');
    expect(capturedArgs).toContain('--max-parallel');
    expect(capturedArgs[capturedArgs.indexOf('--max-parallel') + 1]).toBe('6');

    // Non-positive / non-integer values are dropped entirely.
    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      reps: 0,
      maxInstances: undefined,
      maxParallel: 0,
      _spawn,
    });
    expect(capturedArgs).not.toContain('--reps');
    expect(capturedArgs).not.toContain('--max-instances');
    expect(capturedArgs).not.toContain('--max-parallel');
  });

  it('appends --no-canary only when noCanary is truthy', async () => {
    let capturedArgs = null;
    const _spawn = (_cmd, args) => {
      capturedArgs = args;
      return fakeChild(12);
    };
    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      noCanary: true,
      _spawn,
    });
    expect(capturedArgs).toContain('--no-canary');

    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      noCanary: false,
      _spawn,
    });
    expect(capturedArgs).not.toContain('--no-canary');
  });

  it('appends --cache-dir when given', async () => {
    let capturedArgs = null;
    const _spawn = (_cmd, args) => {
      capturedArgs = args;
      return fakeChild(9);
    };
    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      cacheDir: '/Volumes/big/cache',
      _spawn,
    });
    expect(capturedArgs).toContain('--cache-dir');
    expect(capturedArgs[capturedArgs.indexOf('--cache-dir') + 1]).toBe(
      '/Volumes/big/cache',
    );
  });

  it('appends --graphify and --code-review-graph when set', async () => {
    let capturedArgs = null;
    const _spawn = (_cmd, args) => {
      capturedArgs = args;
      return fakeChild(11);
    };
    await runBenchmark({
      profile: 'smoke',
      targetDir: '/tmp/out',
      graphify: 'full',
      codeReviewGraph: 'structural',
      _spawn,
    });
    expect(capturedArgs[capturedArgs.indexOf('--graphify') + 1]).toBe('full');
    expect(capturedArgs[capturedArgs.indexOf('--code-review-graph') + 1]).toBe(
      'structural',
    );
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

describe('runRegrade', () => {
  it('rejects when profile is missing', async () => {
    await expect(runRegrade({ targetDir: '/tmp' })).rejects.toThrow(
      /profile is required/,
    );
  });

  it('spawns the regrade subcommand with base args and resolves {pid}', async () => {
    let capturedCmd = null;
    let capturedArgs = null;
    const _spawn = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return fakeChild(4242);
    };
    const res = await runRegrade({
      profile: 'demo',
      targetDir: '/tmp/out',
      _spawn,
    });
    expect(res).toEqual({ pid: 4242 });
    expect(capturedCmd).toBe('python3');
    expect(capturedArgs).toEqual([
      '-m',
      'worca_bench.cli',
      'regrade',
      '--profile',
      'demo',
      '--target-dir',
      '/tmp/out',
    ]);
  });

  it('appends --mode, --instance, --profiles-dir, --only-errors when given', async () => {
    let capturedArgs = null;
    const _spawn = (_cmd, args) => {
      capturedArgs = args;
      return fakeChild(7);
    };
    await runRegrade({
      profile: 'demo',
      targetDir: '/tmp/out',
      profilesDir: '/authored/profiles',
      mode: 'sb-cli',
      instance: 'astropy__astropy-12907',
      onlyErrors: true,
      _spawn,
    });
    expect(capturedArgs[capturedArgs.indexOf('--mode') + 1]).toBe('sb-cli');
    expect(capturedArgs[capturedArgs.indexOf('--instance') + 1]).toBe(
      'astropy__astropy-12907',
    );
    expect(capturedArgs[capturedArgs.indexOf('--profiles-dir') + 1]).toBe(
      '/authored/profiles',
    );
    expect(capturedArgs).toContain('--only-errors');
  });

  it('rejects with a regrade-labelled message on spawn error', async () => {
    const _spawn = () => {
      const child = new EventEmitter();
      child.pid = undefined;
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    };
    await expect(
      runRegrade({ profile: 'p', targetDir: '/tmp', _spawn }),
    ).rejects.toThrow(/Failed to start regrade/);
  });
});
