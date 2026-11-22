// test/helpers/flag-off.mjs — the secret vault's flag-off harness, reused by every vault slice. It runs the same
// child steps twice, in two fresh homes under one temp root: a baseline with no WORCA_FLAGS and no OS-store switch,
// and a flag-off run with WORCA_FLAGS=-secretVault and the switch pointing at a fake state file outside both homes.
// It then reports every byte or mode difference between the two trees, every vault file, the fake's call count and
// every forbidden module the flag-off run imported. stdout is compared; stderr is not.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VAULT_NAME_PREFIX } from '../../src/core/secrets/files.mjs';
import { readFakeCalls, writeFakeState } from './os-store-fake.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const RECORDER = pathToFileURL(fileURLToPath(new URL('./import-recorder.mjs', import.meta.url))).href;
const FAKE_MODULE = 'test/helpers/os-store-fake.mjs';
const modeOf = (st) => (process.platform === 'win32' ? null : st.mode & 0o777);

/** `relPath → { sha256, mode }` for every file and directory under `root` (directories have sha256 null). */
export function snapshotTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relative(root, p).split('\\').join('/');
      const st = statSync(p);
      if (e.isDirectory()) {
        out.set(rel, { sha256: null, mode: modeOf(st) });
        walk(p);
      } else {
        out.set(rel, { sha256: createHash('sha256').update(readFileSync(p)).digest('hex'), mode: modeOf(st) });
      }
    }
  };
  walk(root);
  return out;
}

/** Differences from tree `a` to tree `b`: `missing` (only in a), `extra` (only in b), `bytes`, `mode`. */
export function diffTrees(a, b) {
  const diff = [];
  for (const [path, x] of a) {
    const y = b.get(path);
    if (!y) diff.push({ path, kind: 'missing' });
    else if (x.sha256 !== y.sha256) diff.push({ path, kind: 'bytes' });
    else if (x.mode !== y.mode) diff.push({ path, kind: 'mode' });
  }
  for (const path of b.keys()) if (!a.has(path)) diff.push({ path, kind: 'extra' });
  return diff.sort((p, q) => (p.path < q.path ? -1 : p.path > q.path ? 1 : 0));
}

function runSide(root, name, steps, extraEnv) {
  const dir = join(root, name);
  const home = join(dir, 'home');
  const worca = join(dir, 'worca');
  mkdirSync(home, { recursive: true });
  mkdirSync(worca, { recursive: true });
  const importLog = join(root, `${name}.imports.log`);
  const env = { ...process.env };
  for (const k of ['WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_TEST_IMPORT_LOG']) delete env[k];
  Object.assign(env, {
    HOME: home, USERPROFILE: home, WORCA_HOME: worca,
    NODE_TEST_CONTEXT: 'child-v8', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_TEST_IMPORT_LOG: importLog,
  }, extraEnv);
  const runs = steps.map(({ args }) => {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', RECORDER, ...args],
      { cwd: REPO, env, encoding: 'utf8', timeout: 60_000 });
    return { args, status: r.status, stdout: r.stdout, stderr: r.stderr };
  });
  let imports = [];
  try { imports = readFileSync(importLog, 'utf8').split('\n').filter(Boolean); } catch { /* no module resolved */ }
  return { dir, tree: snapshotTree(dir), stdout: runs.map((r) => r.stdout), runs, imports };
}

/**
 * Run `steps` (`[{ args }]`, node args after the recorder preload, cwd the repo) as baseline and as flag-off.
 * Returns `{ root, baseline, flagOff, diff, vaultFiles, fakeCalls, forbiddenHits }`. The caller removes `root`
 * (`rmSync(root, { recursive: true, force: true, maxRetries: 5 })`) in `after`, once every child has exited.
 */
export function runFlagOffPair({ steps, forbidModules = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'worca-flag-off-'));
  const state = join(root, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  const baseline = runSide(root, 'baseline', steps, {});
  const flagOff = runSide(root, 'flag-off', steps, { WORCA_FLAGS: '-secretVault', WORCA_TEST_OS_STORE: state });
  const vaultFiles = [];
  for (const side of [baseline, flagOff]) {
    for (const p of side.tree.keys()) {
      if (p.split('/').pop().toLowerCase().startsWith(VAULT_NAME_PREFIX)) vaultFiles.push(`${relative(root, side.dir)}/${p}`);
    }
  }
  const forbid = [...new Set([FAKE_MODULE, ...forbidModules])];
  const forbiddenHits = [];
  for (const url of flagOff.imports) for (const module of forbid) if (url.includes(module)) forbiddenHits.push({ module, url });
  return {
    root, baseline, flagOff,
    diff: diffTrees(baseline.tree, flagOff.tree),
    vaultFiles,
    fakeCalls: readFakeCalls(state).length,
    forbiddenHits,
  };
}
