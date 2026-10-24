// src/core/update-eligibility.mjs
// Who may update this Worca from the app (issue #841). Pure apart from probeNpmGlobal.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { DRY_RUN_ENV } from './ui-update.mjs';

const execFileP = promisify(execFile);
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

export const UPDATE_MESSAGES = Object.freeze({
  shared: 'Updates are turned off on a shared install. Whoever runs this Worca updates it.',
  agent: 'An agent cannot update Worca. Open Worca in your browser to update it.',
  source: 'Run from a git checkout: update with git pull, then worca ui restart.',
  'not-supervised': 'This Worca was not started with worca ui, so it cannot restart itself. Update from a terminal:',
  'not-npm-global': 'This Worca was not installed with npm install -g (pnpm, volta or npx), so it cannot update itself. Update from a terminal:',
  'not-writable': "npm's global folder is not writable without sudo, so Worca cannot update itself. Update from a terminal:",
  'npm-missing': 'npm was not found, so Worca cannot update itself. Update from a terminal:',
  mock: 'Updates are off in mock mode.',
});

/** Shared = not a local deployment, or a trusted-header shared sign-in. WORCA_IDENTITY_NAME does not count. */
export function isSharedInstall({ deployment, env = process.env }) {
  return deployment !== 'local' || !!String(env.WORCA_IDENTITY_HEADER || '').trim();
}

const refuse = (reason, extra = '') => ({ canUpdate: false, reason, message: extra ? `${UPDATE_MESSAGES[reason].replace(/ is not writable/, ` (${extra}) is not writable`)}` : UPDATE_MESSAGES[reason], dryRun: false });

export function updateEligibility({ deployment, env = process.env, sourceBuild, supervised, npm, mock }) {
  if (isSharedInstall({ deployment, env })) return refuse('shared');
  if (sourceBuild) return refuse('source');
  if (!supervised) return refuse('not-supervised');
  if (truthy(env[DRY_RUN_ENV])) return { canUpdate: true, reason: null, message: '', dryRun: true };
  if (mock) return refuse('mock');
  if (!npm || !npm.root) return refuse('npm-missing');
  if (!npm.underRoot) return refuse('not-npm-global');
  if (!npm.writable) return refuse('not-writable', (npm.unwritable || []).join(', '));
  return { canUpdate: true, reason: null, message: '', dryRun: false };
}

/** Where `npm install -g` puts @worca/app, whether this package is that copy, and whether npm may write there. */
export async function probeNpmGlobal({ packageRoot, exec = execFileP, platform = process.platform, fsx = fs } = {}) {
  const opts = { shell: platform === 'win32', windowsHide: true, timeout: 15_000 };
  let root; let prefix;
  try {
    const [r, p] = await Promise.all([exec('npm', ['root', '-g'], opts), exec('npm', ['prefix', '-g'], opts)]);
    root = String(r.stdout || '').trim(); prefix = String(p.stdout || '').trim();
  } catch { return { root: null }; }
  if (!root) return { root: null };
  const P = platform === 'win32' ? path.win32 : path.posix;
  const real = (p) => { try { return fsx.realpathSync(p); } catch { return p; } };
  const norm = (p) => (platform === 'win32' ? p.toLowerCase() : p);
  const realRoot = real(root);
  const underRoot = norm(real(packageRoot)) === norm(P.join(realRoot, '@worca', 'app'));
  const binDir = platform === 'win32' ? prefix : P.join(prefix, 'bin');
  const dirs = [realRoot, P.join(realRoot, '@worca'), binDir].filter(Boolean);
  const unwritable = dirs.filter((d) => {
    try { fsx.accessSync(d, fsx.constants.W_OK); return false; } catch (e) { return e.code !== 'ENOENT'; }
  });
  return { root: realRoot, prefix, underRoot, writable: unwritable.length === 0, unwritable };
}
