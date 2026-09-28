// scripts/workspace-map-catalog.mjs — the `workspaceMapCatalog` card (wsmap spec §6.3), stage 3 of
// wf_workspace_scan: verify the survey's evidence, catalog what every member provides, find literal
// candidate uses in the other members -> catalog.json, and write the usage brief (an index) plus one
// `usage-briefs/<key>.md` per member next to it. A missing or unreadable extract.json is rebuilt as
// the "every member none" document from ctx.workspace; a missing or unreadable survey.json counts as
// a failed survey (buildCatalog). A run that spans no workspace (ctx.workspace null) writes the empty
// catalog and says why. The card fails only when it cannot write its outputs at all.
import { join, dirname } from 'node:path';
import { buildCatalog, usageBriefs, usageBriefPath } from '../src/core/workspace-map/catalog.mjs';
import { failedExtract } from '../src/core/workspace-map/extract.mjs';
import { outPath, readJsonInput, writeJson, writeText, workspaceOf, isObj, checkerFor, briefHead } from './workspace-map-io.mjs';

export default async function ({ inputs, outputs, ctx, log }) {
  const catalogPath = outPath(outputs, 'catalog');
  const briefPath = outPath(outputs, 'brief');
  const checker = checkerFor('usage', catalogPath);
  const ws = workspaceOf(ctx);
  /** The empty catalog (the shape P1's catalog.mjs builds) + a usage brief that still carries its first lines. */
  const degrade = async (why, level = 'warn') => {
    log(level, why);
    await writeJson(catalogPath, {
      // 'consumes' quoted: the v1 tripwire bans the bare sidecar token (index: every P2 file).
      version: 1, workspace: { name: ws?.name || 'Workspace' }, members: {}, entries: [], aliasIndex: {}, ambiguousAliases: {},
      'consumes': {}, candidates: {}, rejected: [], briefs: {}, errors: [why],
    });
    await writeText(briefPath, `${briefHead('Workspace usage brief', 'catalog', catalogPath, checker)}\nNo member brief could be written: ${why}\n`);
    return { summary: `catalog degraded — ${why}` };
  };
  if (!ws) return degrade('this run spans no workspace (ctx.workspace is null)');
  try {
    const notes = [];
    let extract = await readJsonInput(inputs?.extract);
    if (!isObj(extract) || !isObj(extract.members)) {
      notes.push('extract.json is missing or unreadable');
      extract = failedExtract({ name: ws.name || 'Workspace', members: ws.members, error: notes[0] });
    }
    const survey = await readJsonInput(inputs?.survey);
    if (survey === null) notes.push('survey.json is missing or unreadable (every gap member counts as survey failed)');
    for (const note of notes) log('warn', note);
    const catalog = await buildCatalog({ extract, survey });
    // spec §5.5: the per-member brief paths (pipeline-dir relative) — exactly the files written below.
    catalog.briefs = Object.fromEntries(Object.keys(isObj(catalog.members) ? catalog.members : {}).map((k) => [k, usageBriefPath(k)]));
    await writeJson(catalogPath, catalog);
    const { index, files } = usageBriefs(catalog, { catalogPath, checkerCmd: checker });
    let written = 0;
    for (const [key, text] of Object.entries(isObj(files) ? files : {})) {
      // P1's usageBriefPath is the ONE name source the index lines were built from; it maps any key
      // to one safe file name under usage-briefs/.
      await writeText(join(dirname(briefPath), ...usageBriefPath(key).split('/')), String(text));
      written += 1;
    }
    await writeText(briefPath, String(index));
    const entries = Array.isArray(catalog?.entries) ? catalog.entries.length : 0;
    const candidates = Object.values(isObj(catalog?.candidates) ? catalog.candidates : {})
      .reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    return { summary: `catalog: ${entries} entries, ${candidates} candidates, ${written} usage briefs${notes.length ? ` — ${notes.join('; ')}` : ''}` };
  } catch (err) {
    return degrade(`workspaceMapCatalog failed: ${err?.message || err}`, 'error');
  }
}
