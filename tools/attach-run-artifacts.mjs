#!/usr/bin/env node
// tools/attach-run-artifacts.mjs — copy files into a worca run's folder and index them as that run's artifacts, so Chat
// (list_run_artifacts / read_run_artifact) and the run's Artifacts tab can read them.
//   node tools/attach-run-artifacts.mjs --pipeline-dir DIR --kind KIND [--sub NAME] FILE...
// Plain node:sqlite and the INSERT of recordArtifact (src/core/artifacts.mjs): never getDb(), which migrates — a branch's
// schema must not migrate the host app's database. The run's pipelines row must exist.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/** The artifact kind rule of src/shared/graph/agent-meta.mjs (EXTRA_KIND_RE, not exported; a test keeps the two equal). */
export const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
// recordArtifact's ON CONFLICT … DO UPDATE only COALESCEs step_key/node_id/cycle; with all three NULL, DO NOTHING is the same
export const SQL = 'INSERT INTO artifacts (pipeline_id, kind, rel_path, step_key, node_id, cycle, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?) '
  + 'ON CONFLICT(pipeline_id, kind, rel_path) DO NOTHING';
export function pipelineIdOf(dir) {
  const m = /-([0-9a-z]{6,})$/i.exec(basename(resolve(dir)));
  if (!m) throw new Error(`${dir}: not a run folder (…-ID)`);
  return m[1];
}
/** worcaHome() of src/core/projects.mjs: WORCA_HOME (or the home dir) + .worca-cc; the settings.json root tier is not read. */
export const dbPath = (env = process.env) => join(resolve(env.WORCA_HOME?.trim() || homedir()), '.worca-cc', 'worca-cc.db');

export function attach({ dir, kind, sub = 'split-proof', files, db = new DatabaseSync(dbPath()), now = () => new Date().toISOString() }) {
  if (!KIND_RE.test(kind)) throw new Error(`bad kind ${kind}`);
  const id = pipelineIdOf(dir);
  db.exec('PRAGMA busy_timeout = 5000');
  if (!db.prepare('SELECT 1 FROM pipelines WHERE id = ?').get(id)) throw new Error(`no run ${id} in DB`);
  for (const f of files) if (!existsSync(f)) throw new Error(`${f}: no such file`);
  mkdirSync(join(dir, sub), { recursive: true });
  const rels = [];
  for (const f of files) {
    const rel = `${sub}/${basename(f)}`;
    copyFileSync(f, join(dir, rel));
    db.prepare(SQL).run(id, kind, rel, now());
    rels.push(rel);
  }
  return { id, rels };
}

export function main(argv = process.argv.slice(2), { log = console.log, err = console.error } = {}) {
  const o = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (['--pipeline-dir', '--kind', '--sub'].includes(argv[i])) { o[argv[i].slice(2)] = argv[i + 1]; i += 1; }
    else o.files.push(argv[i]);
  }
  if (!o['pipeline-dir'] || !o.kind || !o.files.length || Object.values(o).some((v) => v === undefined)) {
    err('usage: node tools/attach-run-artifacts.mjs --pipeline-dir DIR --kind KIND [--sub NAME] FILE...'); return 2;
  }
  try {
    const r = attach({ dir: resolve(o['pipeline-dir']), kind: o.kind, ...(o.sub ? { sub: o.sub } : {}), files: o.files.map((f) => resolve(f)) });
    for (const rel of r.rels) log(`indexed ${r.id} ${o.kind} ${rel}`);
    return 0;
  } catch (e) { err(`attach-run-artifacts: ${e.message}`); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main();
