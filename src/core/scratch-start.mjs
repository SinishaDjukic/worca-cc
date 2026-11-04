// src/core/scratch-start.mjs
// `npm start --scratch` (or `npm start -- --scratch`): a throwaway UI server on a
// fresh temp WORCA_HOME and a free port, so a second Worca runs beside the real one
// without touching its runs, projects or ui.json. It is also how to start Worca from
// a run's own folder, which preflight-host refuses against the real home.
//
// ui/server.mjs imports this FIRST: ESM evaluates imports in order, so the env is set
// before any other module could read WORCA_HOME or PORT.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** True when the server was asked for a scratch start, by argv or by npm's config env. */
export function wantsScratch({ argv = process.argv, env = process.env } = {}) {
  return argv.slice(2).includes('--scratch') || /^(1|true)$/i.test(env.npm_config_scratch || '');
}

/**
 * The env a scratch start sets: a new temp WORCA_HOME and PORT 0 (the OS picks a free
 * one; the server prints the bound URL). An explicit WORCA_HOME or PORT is kept.
 */
export function scratchEnv({ env = process.env, mkdtemp = (p) => fs.mkdtempSync(p) } = {}) {
  const out = {};
  if (!(env.WORCA_HOME && env.WORCA_HOME.trim())) out.WORCA_HOME = mkdtemp(path.join(os.tmpdir(), 'worca-scratch-'));
  if (!env.PORT) out.PORT = '0';
  return out;
}

const isServerMain = process.argv[1] && path.basename(process.argv[1]) === 'server.mjs';
if (isServerMain && wantsScratch()) {
  const set = scratchEnv();
  Object.assign(process.env, set);
  console.log(`[worca-ui] scratch start: WORCA_HOME=${process.env.WORCA_HOME}${set.PORT ? ', free port' : `, PORT=${process.env.PORT}`}`);
}
