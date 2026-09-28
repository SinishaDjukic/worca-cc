#!/usr/bin/env node
// tools/workspace-map-eval.mjs
// Precision / recall of a workspace map against labelled truth (spec D18). Offline: no LLM,
// no network. Reads worca's database only to resolve a run id or a workspace's overrides —
// set WORCA_HOME when you want a home other than your own.
//
//   node tools/workspace-map-eval.mjs --map <file|runFolder|runId> --labels <labels.json> [--json]
//   node tools/workspace-map-eval.mjs --map <file|runFolder|runId> --overrides <workspaceId> [--json]
//   node tools/workspace-map-eval.mjs --map <file|runFolder|runId> --init <labels.json>
//
// --map      a workspace-map.json file (a stored map_json doc { map, synthesis } too), a run
//            folder, or the id of a Workspace scan run (its run folder's workspace-map.json);
//            only an id-shaped argument is looked up in the database.
// --labels   a labels doc: { version: 1, workspace, edges: [{ from, to, kind, key?, truth }] }
// --overrides score against a workspace's review: confirmed = true, rejected = false,
//            manual = true (a relation the scan missed)
// --init     write a labels template for the map (truth: null everywhere); never overwrites
// Exit: 0 report printed / template written; 2 usage or input error.

import { realpathSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { evaluate, labelsFromMap, labelsFromOverrides, formatReport } from '../src/core/workspace-map/eval.mjs';
import { findPipelineRowById, runDirForRow } from '../src/core/artifacts.mjs';
import { readWorkspaceMap, isWorkspaceMap, WORKSPACE_KEY_RE } from '../src/core/workspaces.mjs';
import { WORKSPACE_MAP_FILE } from '../src/core/workspace-scan-run.mjs';

export const USAGE = 'usage: node tools/workspace-map-eval.mjs --map <file|runFolder|runId> '
  + '(--labels <file> | --overrides <workspaceId> | --init <out>) [--json]';

class InputError extends Error {}

/** A run id (8 hex) or a run folder name ending in -<id>: the only --map values worth a DB lookup. */
const RUN_ID_RE = /^(?:[\w.-]*-)?[0-9a-f]{8}$/i;

async function kindOf(p) {
  try { const s = await stat(p); return s.isFile() ? 'file' : s.isDirectory() ? 'dir' : null; } catch { return null; }
}
/** JSON.parse that tolerates a UTF-8 BOM (Windows editors write one). */
const parseJson = (text) => JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** --map: a file, a run folder, else a run id -> <run folder>/workspace-map.json. */
export async function loadMap(arg) {
  let text;
  const kind = await kindOf(arg);
  if (kind === 'file') {
    text = await readFile(arg, 'utf8');
  } else if (kind === 'dir') {
    try { text = await readFile(join(arg, WORKSPACE_MAP_FILE), 'utf8'); }
    catch { throw new InputError(`--map: ${arg} has no ${WORKSPACE_MAP_FILE}`); }
  } else {
    const row = RUN_ID_RE.test(arg) ? findPipelineRowById(arg) : null;
    if (!row) throw new InputError(`--map: no such file or run: ${arg}`);
    const dir = await runDirForRow(row);
    try { text = await readFile(join(dir, WORKSPACE_MAP_FILE), 'utf8'); }
    catch { throw new InputError(`--map: run ${row.id} has no ${WORKSPACE_MAP_FILE} (${dir})`); }
  }
  let doc;
  try { doc = parseJson(text); } catch { throw new InputError('--map: not JSON'); }
  if (isWorkspaceMap(doc)) return doc;
  if (doc && isWorkspaceMap(doc.map)) return doc.map;
  throw new InputError('--map: not a workspace map (needs members[] and edges[])');
}

async function loadLabels(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { throw new InputError(`--labels: cannot read ${file}`); }
  try { return parseJson(text); } catch { throw new InputError('--labels: not JSON'); }
}

async function loadOverrides(id) {
  if (!WORKSPACE_KEY_RE.test(id)) throw new InputError(`--overrides: not a workspace id: ${id}`);
  const stored = await readWorkspaceMap(id);
  if (!stored) throw new InputError(`--overrides: no such workspace: ${id}`);
  return stored.overrides;
}

/**
 * @param {string[]} argv
 * @param {{out?: {write:Function}, err?: {write:Function}}} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { out = process.stdout, err = process.stderr } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        map: { type: 'string' }, labels: { type: 'string' }, overrides: { type: 'string' },
        init: { type: 'string' }, json: { type: 'boolean', default: false },
      },
      strict: true, allowPositionals: false,
    }));
  } catch (e) {
    err.write(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  const modes = ['labels', 'overrides', 'init'].filter((k) => values[k] !== undefined);
  if (!values.map || modes.length !== 1) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const map = await loadMap(values.map);
    if (values.init !== undefined) {
      const template = labelsFromMap(map);
      try {
        // 'wx': refuses atomically when anything is at that path (never overwrites a labelled file).
        await writeFile(values.init, `${JSON.stringify(template, null, 2)}\n`, { flag: 'wx' });
      } catch (e) {
        throw new InputError(e && e.code === 'EEXIST'
          ? `--init: ${values.init} exists; choose another path`
          : `--init: cannot write ${values.init} (${(e && e.code) || e})`);
      }
      out.write(`wrote ${template.edges.length} labels to ${values.init} (set each truth to true or false)\n`);
      return 0;
    }
    const labels = values.labels !== undefined
      ? await loadLabels(values.labels)
      : labelsFromOverrides(map, await loadOverrides(values.overrides));
    const result = evaluate(map, labels);
    out.write(values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatReport(result, { workspace: (map.workspace && map.workspace.name) || null }));
    return 0;
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    err.write(`${e.message}\n`);
    return 2;
  }
}

/** True when this file is the process entry — compared by real path, so a symlinked checkout
 *  path (macOS /tmp -> /private/tmp) still runs main(). */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 1;
  });
}
