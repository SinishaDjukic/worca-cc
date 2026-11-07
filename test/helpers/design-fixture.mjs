// test/helpers/design-fixture.mjs
// Shared setup for the Design engine tests (P2); P4 reuses it to record frames. A temp home with the mock and the
// `design` flag on, a design row, and a DesignBuild whose every spawn is recorded.

import { runClaude } from '../../src/core/claude-runner.mjs';
import { DesignBuild } from '../../src/core/design/build.mjs';
import { createDesign } from '../../src/core/design/store.mjs';
import { useTempHome } from './temp-home.mjs';

/**
 * `WORCA_MOCK=1`, `WORCA_FLAGS=design` and a temp `WORCA_HOME` for the calling test file, restored in `after`.
 * `tools/test.mjs` deletes `WORCA_FLAGS`, so the flag is set here. It keeps `WORCA_DESIGN_MAX_BUILDERS`, which would
 * override the builder cap the tests pin (12 fast, 3 off), so that one is deleted until `after`.
 * @param {(fn: () => void) => void} after the node:test `after` hook
 * @returns {string} the temp home
 */
export function useDesignEnv(after) {
  const saved = {
    WORCA_MOCK: process.env.WORCA_MOCK,
    WORCA_FLAGS: process.env.WORCA_FLAGS,
    WORCA_DESIGN_MAX_BUILDERS: process.env.WORCA_DESIGN_MAX_BUILDERS,
  };
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'design';
  delete process.env.WORCA_DESIGN_MAX_BUILDERS;
  const home = useTempHome(after, 'worca-design-');
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  return home;
}

/** A design row: web, titled `T`, engine `claude`, made by `createdBy`. */
export function newDesign({ createdBy = 'local', ...fields } = {}) {
  return createDesign({ kind: 'web', title: 'T', engine: 'claude', ...fields }, { by: createdBy });
}

/**
 * A DesignBuild of `design`, not started. The brief is `brief || instruction || 'MOCK_SECTIONS=1'`, because
 * `createBuild` refuses an empty one. Every other field (`kind`, `sections`, `needsLead`, `pins`, `by`) goes to
 * `DesignBuild.create`. `calls` holds the options of every spawn, whichever `deps.runClaude` the test gives (default:
 * the mock); `frames` every frame in emit order.
 */
export function newBuild(design, { brief, instruction, deps = {}, ...startFields } = {}) {
  const calls = [];
  const inner = deps.runClaude ?? ((o) => runClaude({ ...o, mock: true }));
  const build = DesignBuild.create({
    design,
    brief: brief || instruction || 'MOCK_SECTIONS=1',
    ...startFields,
    deps: {
      staggerMs: 0,
      retryDelayMs: 0,
      ...deps,
      runClaude: async (o) => { calls.push(o); return inner(o); },
    },
  });
  const frames = [];
  build.on('frame', (f) => frames.push(f));
  return { build, frames, calls };
}

/** The frames of one type, in emit order. */
export function framesOf(frames, type) {
  return frames.filter((f) => f.type === type);
}

/** The first frame matching `pred`, polling every 5 ms; rejects after `ms`. */
export async function waitForFrame(frames, pred, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const hit = frames.find(pred);
    if (hit) return hit;
    if (Date.now() >= end) throw new Error(`no matching frame within ${ms} ms (${frames.length} frames seen)`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Resolves once `pred()` is truthy, polling every 5 ms; rejects after `ms` (5 s). */
export async function waitUntil(pred, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    if (pred()) return;
    if (Date.now() >= end) throw new Error(`condition not met within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * A finished mock build's frames, every one in emit order (P4 records its stage fixtures with it). It makes its own
 * design and build, with `deps.mock: true` and a `runClaude` that forces the mock, so it needs neither `WORCA_MOCK`
 * nor the `design` flag; only a temp `WORCA_HOME` (`tools/test.mjs` gives one).
 * @param {{ brief?: string, kind?: string, fast?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
export async function recordMockBuild({ brief = 'MOCK_SECTIONS=3', kind = 'web', fast = false } = {}) {
  if (!process.env.WORCA_HOME) throw new Error('recordMockBuild needs a temp WORCA_HOME');
  const design = newDesign({ kind, fast });
  const build = DesignBuild.create({
    design,
    brief,
    deps: { mock: true, staggerMs: 0, retryDelayMs: 0, runClaude: (o) => runClaude({ ...o, mock: true }) },
  });
  const frames = [];
  build.on('frame', (f) => frames.push(f));
  await build.run();
  return frames;
}
