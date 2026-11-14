#!/usr/bin/env node
// tools/stillhet-seed-insights.mjs — real records for Stillhet's Insights in the live kind (slice 10 D22): twelve runs over
// three projects, two people, two workflows and the `client` cost tag, two of them shaped, each with its cost on a fixed day
// of this month, and a budget. The projects are added through dev's route (POST /api/projects); the runs are written by
// dev's production writers (createPipeline, writeState, persistPrState, recordCostDelta), as test/helpers/db-seed.mjs does,
// so this process must share the sandbox's WORCA_HOME; the budget goes through POST /api/settings. Team metrics needs a git
// sink, so the walk checks the team pages' empty state. It feeds the one Expert walk at the end of the slice; the pixel
// compare stays demo against demo. Pinned by test/stillhet-seed-insights.test.mjs.
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxOnly } from './stillhet-seed-projects.mjs';
export { sandboxOnly };

const run = (project, person, workflow, status, client, usd, day, extra = {}) => Object.freeze({ project, person, workflow, status, client, usd, day, ...extra });
/** What is seeded: each run's project, who started it, its workflow, how it ended, its client, its cost and the day of this month. */
export const SEEDED_RUNS = Object.freeze([
  run('seed-billing', 'Maya', 'Default', 'done', 'acme', 42.5, 1, { pr: 'MERGED', size: 'small', shaped: true }),
  run('seed-billing', 'Jonas', 'Full', 'done', 'globex', 25, 2, { pr: 'OPEN' }),
  run('seed-billing', 'Maya', 'Full', 'error', 'acme', 6.75, 2),
  run('seed-web', 'Jonas', 'Default', 'done', null, 18, 3, { pr: 'MERGED', size: 'medium', shaped: true }),
  run('seed-web', 'Maya', 'Default', 'stopped', 'acme', 3.25, 4),
  run('seed-web', 'Jonas', 'Full', 'done', 'globex', 31, 4),
  run('seed-web', 'Maya', 'Default', 'done', null, 12, 5, { size: 'small' }),
  run('seed-docs', 'Maya', 'Default', 'done', 'acme', 4.5, 5),
  run('seed-docs', 'Jonas', 'Default', 'error', null, 2.25, 6),
  run('seed-docs', 'Maya', 'Full', 'done', 'acme', 9, 7, { size: 'medium' }),
  run('seed-billing', 'Jonas', 'Default', 'done', 'acme', 14, 8),
  run('seed-web', 'Maya', 'Full', 'done', null, 7.5, 8),
]);
export const SEEDED_PROJECTS = Object.freeze(['seed-billing', 'seed-web', 'seed-docs']);
export const SEEDED_BUDGET_USD = 500;

/** Seeds the runs into the sandbox at `base` (whose WORCA_HOME this process shares). Days past today land on today. */
export async function seedInsights({ base, root = null, now = Date.now() } = {}) {
  const call = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${await r.text()}`);
    return r.json();
  };
  const { createPipeline, writeState, persistPrState } = await import('../src/core/artifacts.mjs');
  const { recordCostDelta } = await import('../src/core/cost-budget.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  root ||= await realpath(await mkdtemp(join(tmpdir(), 'stillhet-seed-insights-')));
  const dirs = {};
  for (const name of SEEDED_PROJECTS) {
    dirs[name] = join(root, name);
    await mkdir(dirs[name], { recursive: true });
    await call('POST', '/api/projects', { name, path: dirs[name] });
  }
  const today = new Date(now), ids = [];
  for (const r of SEEDED_RUNS) {
    const day = new Date(today.getFullYear(), today.getMonth(), Math.min(r.day, today.getDate()), 9 + (ids.length % 8));
    const { id, dir } = await createPipeline(dirs[r.project], { prompt: `seed ${ids.length + 1}`, title: `Seeded run ${ids.length + 1}`, startedBy: r.person, tags: r.client ? [`client:${r.client}`] : [] });
    await writeState(dir, { projectKey: projectKey(dirs[r.project]), id, status: r.status, totalCostUsd: r.usd, humanHours: 1, stepper: { template: { id: `wf_${r.workflow.toLowerCase()}`, name: r.workflow } }, ...(r.size ? { runSize: r.size } : {}), ...(r.shaped ? { shapeStats: { reviewCycles: 1 } } : {}) });
    getDb().prepare('UPDATE pipelines SET started_at = ? WHERE id = ?').run(day.toISOString(), id);   // a fixed day, as the stats tests seed it
    if (r.pr) persistPrState(id, { url: `https://github.com/seed/${r.project}/pull/${ids.length + 1}`, number: ids.length + 1, state: r.pr });
    recordCostDelta({ pipelineId: id, amountUsd: r.usd, tsMs: +day });
    ids.push(id);
  }
  await call('POST', '/api/settings', { totalCostLimitUsd: SEEDED_BUDGET_USD });
  return { root, ids, budget: SEEDED_BUDGET_USD };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // it writes into the server it is given: only a named one, only a blank sandbox, and only with that sandbox's WORCA_HOME
  const base = process.argv[2];
  if (!base || !process.env.WORCA_HOME) { console.error('usage: WORCA_HOME=<the sandbox\'s> node tools/stillhet-seed-insights.mjs http://127.0.0.1:PORT   (a blank sandbox server)'); process.exit(2); }
  sandboxOnly(base).then(() => seedInsights({ base })).then((r) => console.log(`stillhet: seeded Insights ${JSON.stringify(r)}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
