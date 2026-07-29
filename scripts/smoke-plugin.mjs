#!/usr/bin/env node
// scripts/smoke-plugin.mjs
// Offline plugin-system SMOKE (spec §12). Proves, with $0 spend and no network:
//   link the mock-source fixture plugin -> registry serves its agent (origin
//   plugin:mock-source) -> listTaskSources/resolveTaskInput serve the mock
//   source under WORCA_MOCK canned frames -> a full mock pipeline runs FROM
//   that source -> the pipelines row carries source_type/source_ref -> the
//   post-done write-back invoked reportResult (observable: the lastReport key
//   in ~/.worca-cc/plugins/mock-source/data/state.json via readPluginState).
//
// ISOLATION (mirrors scripts/smoke-workspace.mjs): a THROWAWAY mkdtemp
// WORCA_HOME — set BEFORE any core call, superseding the npm script's
// .worca-cc-smoke default so repeated runs never accrete a linked plugin into
// the home `npm run smoke` uses for its zero-plugin feature-off bar — plus a
// throwaway git repo as the target project. Both reaped in a finally block.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '..', 'test', 'fixtures', 'plugins', 'mock-source');

function die(msg) {
  console.error(`smoke:plugin FAILED — ${msg}`);
  process.exitCode = 1;
}

/** A fresh throwaway git repo with one commit, on branch `main`. */
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-smoke-plugin-proj-'));
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'smoke@worca-cc']);
  g(['config', 'user.name', 'smoke']);
  await writeFile(join(dir, 'README.md'), '# smoke:plugin target\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

async function main() {
  process.env.WORCA_MOCK = process.env.WORCA_MOCK || '1'; // offline everywhere
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-smoke-plugin-home-'));
  process.env.WORCA_HOME = home; // BEFORE any core import runs a query — worcaHome()/getDb() resolve lazily

  const scratch = [home];
  try {
    // Dynamic imports AFTER the env is pinned keep the isolation order obvious.
    const { linkPlugin, listInstalledPlugins } = await import('../src/core/plugin-store.mjs');
    const { readPluginState } = await import('../src/core/plugin-config.mjs');
    const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
    const { listTaskSources, resolveTaskInput } = await import('../src/core/sources.mjs');
    const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
    const { prepare } = await import('../src/core/db.mjs');

    // 1) INSTALL the fixture (dev-mode link — the local-path mechanism, Task 5).
    linkPlugin('mock-source', FIXTURE);
    const installed = listInstalledPlugins().find((p) => p.name === 'mock-source');
    if (!installed) return die('linkPlugin did not produce a lock entry for mock-source');
    if (!installed.enabled) return die('linked plugin is not enabled');
    console.log(`  link: mock-source linked from ${FIXTURE}`);

    // 2) REGISTRY serves the plugin agent with a plugin origin.
    const registry = loadAgentRegistry();
    const helper = registry.mockHelper;
    if (!helper) return die('mockHelper missing from the merged agent registry');
    if (helper.origin !== 'plugin:mock-source') return die(`mockHelper origin is ${helper.origin}, expected plugin:mock-source`);
    console.log('  registry: mockHelper served with origin plugin:mock-source');

    // 3) SOURCES: listed, and resolveTaskInput returns the canned task.
    const sources = listTaskSources();
    const mockSource = sources.find((s) => s.type === 'plugin' && s.plugin === 'mock-source' && s.sourceId === 'mock');
    if (!mockSource) return die(`mock source not listed (got: ${JSON.stringify(sources)})`);
    const source = { type: 'plugin', plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-1' };
    const proj = await freshRepo();
    scratch.push(proj);
    const resolved = await resolveTaskInput(source, { projectDir: proj });
    if (!resolved.promptText || !resolved.promptText.startsWith('# ')) {
      return die(`resolveTaskInput promptText malformed: ${JSON.stringify(resolved.promptText).slice(0, 120)}`);
    }
    if (resolved.sourceMeta?.plugin !== 'mock-source' || resolved.sourceMeta?.taskId !== 'MOCK-1') {
      return die(`sourceMeta wrong: ${JSON.stringify(resolved.sourceMeta)}`);
    }
    console.log('  source: resolveTaskInput returned the canned MOCK-1 task');

    // 4) FULL mock pipeline from the plugin source (Task 13 threading).
    const orch = createOrchestrator({
      projectDir: proj,
      source,
      auto: true,
      claude: { mock: true },
    });
    const res = await orch.run();
    if (res.status !== 'done') return die(`pipeline did not complete: status=${res.status}`);
    const state = orch.getState();

    // 5) source_type / source_ref persisted on the pipelines row (Task 10/13).
    const row = prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(state.id);
    if (!row) return die(`no pipelines row for ${state.id}`);
    if (row.source_type !== 'plugin') return die(`source_type=${row.source_type}, expected plugin`);
    let ref;
    try { ref = JSON.parse(row.source_ref); } catch { return die(`source_ref is not JSON: ${row.source_ref}`); }
    if (ref.plugin !== 'mock-source' || ref.taskId !== 'MOCK-1') return die(`source_ref wrong: ${row.source_ref}`);
    console.log(`  run:  status=done, source_ref persisted (${row.source_ref})`);

    // 6) WRITE-BACK ran: the reportResult frame's stateDelta landed in state.json.
    const pstate = readPluginState('mock-source');
    if (!pstate.lastReport) return die(`no lastReport in plugin state (state=${JSON.stringify(pstate)})`);
    const report = JSON.parse(pstate.lastReport);
    if (report.id !== 'MOCK-1') return die(`reportResult id=${report.id}, expected MOCK-1`);
    if (report.status !== 'completed') return die(`reportResult status=${report.status}, expected completed`);
    console.log(`  write-back: reportResult recorded (id=${report.id}, status=${report.status})`);

    console.log('smoke:plugin OK — link, registry origin, source resolution, mock pipeline, source_ref, write-back.');
  } finally {
    await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
