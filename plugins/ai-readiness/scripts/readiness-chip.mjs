// plugins/ai-readiness/scripts/readiness-chip.mjs — the first step. Hands the chip's view of the run's
// checkout (api.readiness, computed by worca: the engines, their labels and which of them the repo
// is judged for) to Map, the probes and the gate as one json file, so the plugin never keeps its own
// list of tools. A workspace run gets `{ members: { <projectKey>: <view> }, workspaceMap }` (the workspace's
// reviewed map, or null), written as it comes.
import { writeFileSync } from 'node:fs';

export default async function ({ outputs, readiness, log }) {
  if (!readiness) throw new Error('this worca has no readiness view; update worca');
  writeFileSync(outputs.view.path, JSON.stringify(readiness, null, 2));
  const n = readiness.members ? Object.keys(readiness.members).length : 1;
  log('info', `readiness view for ${n} project(s)`);
  return { summary: `Readiness view for ${n} project(s).` };
}
