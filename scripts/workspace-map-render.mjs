// scripts/workspace-map-render.mjs — the `workspaceMapRender` card (wsmap spec §6.7), stage 7 of
// wf_workspace_scan: the workspace description from the map + the synthesis, held to the HARD line
// budget scanDescriptionBudget(member count) (D6) -> workspace-scan.md, the file the run's finalize
// saves as the workspace's description. A missing map renders the minimal document; a missing or
// invalid synthesis renders the fallbacks (P1 renderWorkspaceDescription). A run that spans no
// workspace (ctx.workspace null) writes the minimal document and says why. The card fails only when
// it cannot write its output at all.
import { renderWorkspaceDescription, countLines } from '../src/shared/workspace-map/render.mjs';
import { checkSynthesis } from '../src/shared/workspace-map/schema.mjs';
import { rekeyOverrides } from '../src/shared/workspace-map/overrides.mjs';
import { scanDescriptionBudget } from '../src/shared/workspace-size.mjs';
import { outPath, readJsonInput, writeText, workspaceOf, isObj } from './workspace-map-io.mjs';

export default async function ({ inputs, outputs, ctx, log }) {
  const outFile = outPath(outputs, 'workspace');
  const ws = workspaceOf(ctx);
  /** The minimal description: the fixed sections, the members as listed, the reason under Coverage. */
  const degrade = async (why, level = 'warn') => {
    log(level, why);
    const members = ws ? ws.members : [];
    await writeText(outFile, [
      `# Workspace: ${ws?.name || 'Workspace'}`,
      '## Overview',
      `Workspace of ${members.length} projects.`,
      '## Projects',
      ...members.map((m) => `- ${m.name} (\`${m.key}\`): (role unknown)`),
      '## Interconnections',
      '## Change-coordination notes',
      '## Suggested change order',
      '## Coverage',
      `- not mapped: ${why}`,
      '',
    ].join('\n'));
    return { summary: `render degraded — ${why}` };
  };
  if (!ws) return degrade('this run spans no workspace (ctx.workspace is null)');
  try {
    const raw = await readJsonInput(inputs?.map);
    const map = isObj(raw) ? raw : null;
    if (!map) log('warn', 'workspace-map.json is missing or unreadable — minimal description');
    const memberKeys = (Array.isArray(map?.members) ? map.members : [])
      .map((m) => (isObj(m) ? m.key : null)).filter((k) => typeof k === 'string' && k);
    const rawSynthesis = await readJsonInput(inputs?.synthesis);
    let synthesis = null;
    if (isObj(rawSynthesis)) {
      const checked = checkSynthesis(rawSynthesis, { memberKeys });
      if (!checked.ok) log('warn', `synthesis.json: ${checked.errors.length} invalid item(s) dropped`);
      synthesis = checked.value;
    } else {
      log('warn', 'synthesis.json is missing or unreadable — fallback overview and roles');
    }
    const count = Math.max(ws.members.length, memberKeys.length);
    const budget = scanDescriptionBudget(count);
    const name = ws.name || (typeof map?.workspace?.name === 'string' && map.workspace.name) || 'Workspace';
    // M15: the overrides the run froze at start (ctx.workspace.overrides, absent on a first scan), moved first as the
    // join card (liveEdges) and finalize move them: this file shows the map's stored change order and the order notes
    // beside it, and a rejection whose edge an agent reworded this scan stays rejected.
    const overrides = isObj(ctx?.workspace?.overrides) ? rekeyOverrides(ctx.workspace.overrides, map) : null;
    const text = String(renderWorkspaceDescription({ name, map, synthesis, overrides, budget }));
    await writeText(outFile, text.endsWith('\n') ? text : `${text}\n`);
    return { summary: `description: ${countLines(text)} lines (budget ${budget}, ${count} members)` };
  } catch (err) {
    return degrade(`workspaceMapRender failed: ${err?.message || err}`, 'error');
  }
}
