// test/wsmap-join-script-graph.test.mjs — scripts/workspace-map-join.mjs hands the graphify
// enricher to joinMap: the merged graph lands in the pipeline dir and map.graph points at it
// (wsmap P7). The script is called the way src/core/graph/script-child.mjs calls it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import joinScript from '../scripts/workspace-map-join.mjs';
import { entryId } from '../src/shared/workspace-map/ids.mjs';
import { makeGraphWorkspace } from './helpers/wsmap-graphs.mjs';

const fx = await makeGraphWorkspace();
after(() => fx.ws.cleanup());
const { dir } = fx;
const ENTRY = entryId('b', 'http', 'http:GET /invoices/{}');
const member = (key) => ({ key, name: key, dir: dir[key], role: null, aliases: [key], stack: ['node'], surveyStatus: 'skipped', unresolved: [],
  coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, detectors: {} }, graph: null, facts: { static: 1, llm: 0 } });
const catalog = { version: 1, workspace: { name: 'Shop' }, members: { a: member('a'), b: member('b') },
  entries: [{ id: ENTRY, member: 'b', kind: 'http', norm: 'http:GET /invoices/{}', display: 'GET /invoices/{id}', terms: ['/invoices'],
    evidence: [{ file: 'src/routes.ts', line: 2, match: 'x' }], sources: ['static'] }],
  consumes: { a: [{ kind: 'http', dir: 'consumes', key: 'GET /invoices/:id', norm: 'http:GET /invoices/{}', file: 'src/client.ts', line: 3, match: 'x',
    source: 'static', test: false, evidence: [{ file: 'src/client.ts', line: 3, match: 'x' }], entry: ENTRY, toMember: 'b' }], b: [] },
  candidates: { a: [], b: [] }, aliasIndex: {}, ambiguousAliases: {}, rejected: [], errors: [] };

async function runScript(pipelineDir, workspaceMembers) {
  await mkdir(pipelineDir, { recursive: true });
  const catalogPath = join(pipelineDir, 'catalog.json');
  const usagePath = join(pipelineDir, 'usage.json');
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(usagePath, JSON.stringify({ version: 1, members: {} }));
  const api = {
    inputs: { catalog: { type: 'json', path: catalogPath, fresh: true }, usage: { type: 'json', path: usagePath, fresh: true } },
    outputs: { map: { type: 'json', path: join(pipelineDir, 'workspace-map.json') }, brief: { type: 'md', path: join(pipelineDir, 'synth-brief.md') } },
    params: {},
    ctx: { cwd: pipelineDir, pipelineDir, projectDir: dir.a, runRoot: null, repos: null, checkpointRef: null, baseName: null, runId: 'run-7',
      platform: process.platform, mock: true, bench: false,
      workspace: { id: 'ws_1', name: 'Shop', members: workspaceMembers.map((k) => ({ key: k, name: k, dir: dir[k], projectDir: dir[k] })) } },
    verdictPath: null, node: { id: 'n_join', key: 'workspaceMapJoin', displayName: 'Workspace map join' }, execution: { id: 'e1', ordinal: 1 },
    log: () => {},
  };
  await joinScript(api);
  return JSON.parse(await readFile(join(pipelineDir, 'workspace-map.json'), 'utf8'));
}

test('join script: fresh member graphs → map.graph points at <pipelineDir>/workspace-graph.json, edges carry context', async () => {
  const pipelineDir = join(fx.ws.root, 'pipe-1');
  const map = await runScript(pipelineDir, ['a', 'b']);
  assert.deepEqual(map.graph, { mode: 'full', file: 'workspace-graph.json', nodes: 17, bridges: 1 });
  assert.equal(map.edges[0].context.from.symbol, 'getInvoice()');
  const doc = JSON.parse(await readFile(join(pipelineDir, 'workspace-graph.json'), 'utf8'));
  assert.equal(doc.links.filter((l) => l.relation === 'cross_repo_uses').length, 1);
});

test('join script: no graphs (a mock run) → graph mode none and no file', async () => {
  const pipelineDir = join(fx.ws.root, 'pipe-2');
  const map = await runScript(pipelineDir, ['c']);
  assert.deepEqual(map.graph, { mode: 'none', file: null, nodes: 0, bridges: 0 });
  await assert.rejects(stat(join(pipelineDir, 'workspace-graph.json')));
});
