// scripts/workspace-map-extract.mjs — the `workspaceMapExtract` card (wsmap spec §6.1), stage 1 of
// wf_workspace_scan: the static boundary facts of every member -> extract.json, plus the survey
// brief the survey agent reads. Bad data never fails the run: no workspace, no member, a crashed
// extraction or one past EXTRACT_DEADLINE_MS writes the "every member none" document (failedExtract),
// so the survey investigates everything (D2, spec §7). The card fails only when it cannot write its
// outputs at all.
import { extractWorkspace, failedExtract, surveyBrief } from '../src/core/workspace-map/extract.mjs';
import { outPath, writeJson, writeText, workspaceOf, isObj, checkerFor, briefHead, withDeadline } from './workspace-map-io.mjs';

/** Below the card's 30-minute sidecar timeout: a slow extraction degrades (spec §7), never pauses the run. */
export const EXTRACT_DEADLINE_MS = 25 * 60 * 1000;

/** `extract` (extractWorkspace) raced against `deadlineMs`: `{ doc, why }` — doc null and `why` set when
 *  the extraction crashed or did not finish in time. Exported, with both parameters, for the tests. */
export async function extractWithin({ name, members, extract = extractWorkspace, deadlineMs = EXTRACT_DEADLINE_MS }) {
  try {
    const doc = await withDeadline(extract({ name, members }), deadlineMs, null);
    return doc ? { doc, why: '' } : { doc: null, why: `extraction did not finish within ${Math.round(deadlineMs / 60000)} minutes` };
  } catch (err) {
    return { doc: null, why: `extraction crashed: ${err?.message || err}` };
  }
}

function levelCounts(doc) {
  const out = { rich: 0, partial: 0, none: 0 };
  for (const m of Object.values(isObj(doc?.members) ? doc.members : {})) {
    const level = m?.coverage?.level;
    if (Object.hasOwn(out, level)) out[level] += 1;
  }
  return out;
}

export default async function ({ outputs, ctx, log }) {
  const extractPath = outPath(outputs, 'extract');
  const briefPath = outPath(outputs, 'brief');
  const checker = checkerFor('survey', extractPath);
  const ws = workspaceOf(ctx);
  const name = ws?.name || 'Workspace';
  const members = ws ? ws.members : [];
  try {
    let why = !ws ? 'this run spans no workspace (ctx.workspace is null)'
      : members.length === 0 ? 'the workspace names no member checkout' : '';
    let doc = null;
    if (!why) ({ doc, why } = await extractWithin({ name, members }));
    if (why) {
      log('warn', why);
      doc = failedExtract({ name, members, error: why });
    }
    await writeJson(extractPath, doc);
    await writeText(briefPath, surveyBrief(doc, { extractPath, checkerCmd: checker }));
    const count = Object.keys(isObj(doc?.members) ? doc.members : {}).length;
    const n = levelCounts(doc);
    return {
      summary: why
        ? `extract degraded — ${why}; ${count} members, all to survey`
        : `extract: ${count} members (${n.rich} rich, ${n.partial} partial, ${n.none} none)`,
    };
  } catch (err) {
    const why = `workspaceMapExtract failed: ${err?.message || err}`;
    log('error', why);
    await writeJson(extractPath, { version: 1, workspace: { name }, createdAt: new Date().toISOString(), members: {}, errors: [why] });
    await writeText(briefPath, `${briefHead('Workspace survey brief', 'extract', extractPath, checker)}\nNo member could be listed: ${why}\n`);
    return { summary: `extract degraded — ${why}` };
  }
}
