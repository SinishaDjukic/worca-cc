// scripts/c4-discover.mjs — the `c4Discover` card: walks the checkout (every member on a
// workspace run) for *.c4 / *.likec4 files and describes each one, so the setup agent can
// offer them to the person. Parses with the viewer's own parser, so what it reports is what
// the viewer can draw. Runs with worca's privileges; reads only.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseC4, buildViews } from '../ui/public/c4/c4-view.mjs';
import { c4Roots, toPosixRel, c4CheckCommand } from './c4-paths.mjs';

const EXT = /\.(c4|likec4)$/i;
const MAX_FILES = 40;            // the setup form's table holds at most this many rows

function walk(dir, skip, out, depth = 0) {
  if (depth > 12 || out.length >= MAX_FILES * 4) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), skip, out, depth + 1); }
    else if (e.isFile() && EXT.test(e.name)) out.push(join(dir, e.name));
  }
}

export function describe(file, root) {
  const text = readFileSync(file, 'utf8');
  const rel = toPosixRel(root, file);
  const base = { path: rel, bytes: Buffer.byteLength(text, 'utf8'), lines: text.split('\n').length };
  try {
    const m = parseC4(text);
    const views = buildViews(m).map((v) => ({ id: v.id, type: v.type, title: v.title, elements: v.nodes.filter((n) => !n.children.length).length, relationships: v.edges.length }));
    const bands = m.deploymentOrder.filter((id) => !m.deployment[id].parent).map((id) => {
      const d = m.deployment[id]; const meta = d.metadata || {};
      return { id, title: d.title, criteria: meta.criteria || '', order: meta.order || 'declared', children: d.children.length };
    });
    return { ...base, elements: Object.keys(m.elements).length, relations: m.relations.length, views, bands, problems: m.problems, parses: true };
  } catch (e) {
    return { ...base, parses: false, error: e.message, views: [], bands: [] };
  }
}

/** The `c4-setup` form's `data`: one table row per file, a summary, and the default choice. */
export function setupFormData(payload, roots) {
  const where = roots.length > 1 ? `the ${roots.length} workspace projects` : `\`${roots[0].name}\``;
  const bad = payload.files.filter((f) => !f.parses).length;
  const summary = payload.count
    ? `Found ${payload.count} C4 file${payload.count === 1 ? '' : 's'} in ${where}${bad ? `; ${bad} do${bad === 1 ? 'es' : ''} not parse` : ''}. Pick one to update, or create a new one.`
    : `No C4 file in ${where} yet. Worca will create one: choose where, and how to group the deployment sheet.`;
  const files = payload.files.map((f) => ({
    id: f.id, path: f.path, project: (roots.find((r) => r.key === f.project) || {}).name || f.project,
    views: f.parses ? `${f.views.length} view${f.views.length === 1 ? '' : 's'}` : '—',
    bands: f.parses ? (f.bands.length ? f.bands.map((b) => b.title).join(' · ') : 'none') : '—',
    status: f.parses ? (f.problems && f.problems.length ? `${f.problems.length} unresolved` : 'parses') : `does not parse: ${String(f.error || '').slice(0, 90)}`,
  }));
  return {
    summary, files, defaultTarget: files.length ? 'Update a found file' : 'Create a new file',
    defaultFile: files.length ? files[0].id : '',
    projects: roots.map((r) => ({ id: r.key, name: r.name })), defaultProject: roots[0].key,
  };
}

export default async function ({ outputs, params, ctx, log }) {
  const skip = new Set(String(params.ignore || '').split(',').map((s) => s.trim()).filter(Boolean));
  const roots = c4Roots(ctx);
  const found = [];
  for (const r of roots) {
    const files = [];
    walk(r.dir, skip, files);
    for (const f of files) { const d = describe(f, r.dir); found.push({ id: roots.length > 1 ? `${r.key}/${d.path}` : d.path, project: r.key, ...d }); }
  }
  found.sort((a, b) => a.project.localeCompare(b.project) || a.path.localeCompare(b.path));
  const listed = found.slice(0, MAX_FILES);
  const payload = {
    roots: roots.map((r) => r.key),
    // where each root is checked out for THIS run — the architect writes there
    rootDirs: roots.map((r) => ({ key: r.key, name: r.name, dir: r.dir })),
    workspace: roots.length > 1,
    count: found.length,
    files: listed,
    // The architect's self-check, absolute and quoted: replace <FILE> with the file's absolute path.
    checkCommand: c4CheckCommand(),
  };
  // The c4-setup form's data, built here so the setup agent copies it rather than composing it.
  payload.formData = setupFormData(payload, roots);
  writeFileSync(outputs.found.path, JSON.stringify(payload, null, 2), 'utf8');
  const lines = [`# C4 files found: ${found.length}`, '', `Searched: ${roots.map((r) => r.key).join(', ')}`, ''];
  for (const f of listed) {
    lines.push(`## ${f.project}: ${f.path}`, '');
    if (!f.parses) { lines.push(`Does not parse: ${f.error}`, ''); continue; }
    lines.push(`${f.elements} elements, ${f.relations} relationships, ${f.views.length} views (${f.views.map((v) => `${v.title} [${v.type}]`).join(', ')}).`);
    if (f.bands.length) {
      lines.push('', 'Grouping bands (deployment, top level, in order):');
      for (const b of f.bands) lines.push(`- **${b.title}** (${b.children} placed, order: ${b.order})${b.criteria ? ` — ${b.criteria}` : ' — no criteria yet'}`);
    }
    if (f.problems && f.problems.length) { lines.push('', 'Unresolved references:'); for (const p of f.problems) lines.push(`- ${p}`); }
    lines.push('');
  }
  if (found.length > listed.length) lines.push(`…and ${found.length - listed.length} more, not listed.`, '');
  if (!found.length) lines.push('No .c4 or .likec4 file in the checkout. The setup step will offer to create one.');
  writeFileSync(outputs.brief.path, lines.join('\n') + '\n', 'utf8');
  log('info', `found ${found.length} C4 file(s) in ${roots.length} root(s)`);
  return { summary: found.length ? `${found.length} C4 file(s): ${listed.map((f) => f.path).join(', ')}` : 'no C4 files' };
}
