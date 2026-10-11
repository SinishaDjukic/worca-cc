// scripts/c4-check.mjs — the `c4Check` card: the gate between the architect and the renderer.
// Reads the architect's `model` envelope ({ path, bands? }), parses the file with the viewer's
// parser (so a file that passes here is a file the viewer draws), and blocks on anything an
// agent tends to get wrong. Blocking findings route back to the architect's `fix` port.
// `checkC4` is the rule set; scripts/c4-check-cli.mjs prints the same findings for a shell.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseC4, buildViews } from '../ui/public/c4/c4-view.mjs';
import { resolveC4Path } from './c4-paths.mjs';

const BLOCKING = new Set(['critical', 'major']);

/** Every finding for one C4 source text. Pure: no file system. */
export function checkC4(text) {
  const findings = [];
  const add = (severity, title, detail) => findings.push({ severity, title, detail });
  let m = null;
  try { m = parseC4(text); } catch (e) { add('critical', 'the file does not parse', e.message); }
  if (!m) return { findings, views: [], bands: [], model: null };
  for (const p of m.problems) add('major', 'unresolved reference', p);
  const views = buildViews(m);
  if (!views.length) add('major', 'no views', 'The file declares no view; nothing can be drawn.');
  const dep = views.filter((v) => v.type === 'deployment');
  const bands = m.deploymentOrder.filter((id) => !m.deployment[id].parent);
  if (bands.length && !dep.length) add('major', 'bands without a deployment view', 'There are top-level deployment nodes but no `deployment view` that includes them.');
  const placedUnder = (id) => Object.values(m.deployment).filter((d) => d.instance && d.id.startsWith(`${id}.`)).length;
  for (const id of bands) {
    if (!placedUnder(id)) add('major', `band "${m.deployment[id].title}" is empty`, `No element is placed under ${id}. Place the elements its criteria describe, or remove the band.`);
  }
  for (const v of dep) for (const n of v.nodes) if (n.instance && !m.elements[n.modelRef]) add('major', `instance ${n.id} points nowhere`, `instanceOf ${n.modelRef} does not name a model element.`);
  // every deployment view should include every band, or the sheet silently drops one
  for (const v of dep) for (const id of bands) if (!v.nodes.some((n) => n.id === id)) add('minor', `view "${v.title}" leaves out band "${m.deployment[id].title}"`, `Add \`${id}.*\` (and the nested \`${id}.**\` or the frames' \`.*\`) to its include list.`);
  // model elements of a kind that is placed somewhere but which themselves are placed nowhere
  const placed = new Set(Object.values(m.deployment).filter((d) => d.instance).map((d) => d.modelRef));
  const placedKinds = new Set([...placed].filter((r) => m.elements[r]).map((r) => m.elements[r].kind));
  const covered = (id) => { let s = id; while (s && m.elements[s]) { if (placed.has(s)) return true; s = m.elements[s].parent; } return false; };
  const unplaced = Object.values(m.elements).filter((e) => !e.children.length && placedKinds.has(e.kind) && !covered(e.id));
  if (bands.length && unplaced.length) add('minor', `${unplaced.length} element(s) of a placed kind are not on the sheet`, unplaced.map((e) => `${e.id} (${e.kind})`).join(', '));
  return {
    findings,
    views: views.map((v) => ({ id: v.id, type: v.type, title: v.title, elements: v.nodes.filter((n) => !n.children.length).length, relationships: v.edges.length })),
    bands: bands.map((id) => ({ id, title: m.deployment[id].title, placed: placedUnder(id) })),
    model: m,
  };
}

export const isBlocking = (f) => BLOCKING.has(f.severity);

export default async function ({ inputs, outputs, ctx, log }) {
  const env = JSON.parse(readFileSync(inputs.model.path, 'utf8'));
  const file = resolveC4Path(env, ctx);
  let result = { findings: [], views: [] };
  if (!file || !existsSync(file)) {
    result.findings.push({ severity: 'critical', title: `file missing: ${env.path}`, detail: 'The architect reported a path that does not exist in the checkout.' });
  } else {
    result = checkC4(readFileSync(file, 'utf8'));
  }
  const { findings, views } = result;
  const blocking = findings.filter(isBlocking);
  const md = [`# C4 check: ${blocking.length ? 'blocking' : 'clean'}`, '', `File: \`${env.path}\``, ''];
  for (const f of findings) md.push(`- **${f.severity}** — ${f.title}: ${f.detail}`);
  if (!findings.length) md.push('No findings.');
  if (views.length) md.push('', '## Views', '', ...views.map((v) => `- ${v.title} (${v.type}): ${v.elements} elements, ${v.relationships} relationships`));
  const report = md.join('\n') + '\n';
  // The verdict is a review ({ issues }): critical/major block and route to `review`, the rest pass.
  const verdict = { issues: findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail, location: env.path })), summary: blocking.length ? `${blocking.length} blocking` : 'clean' };
  // Every declared output is written whichever way the verdict goes (the script contract); the
  // verdict decides which ports FIRE: `review` on blocking, `checked` + `pass` on clean.
  writeFileSync(outputs.review.path, report, 'utf8');
  writeFileSync(outputs.checked.path, JSON.stringify({ ...env, views, findings }, null, 2), 'utf8');
  if (blocking.length) {
    log('warn', `${blocking.length} blocking finding(s)`);
    return { verdict, summary: `${blocking.length} blocking: ${blocking[0].title}` };
  }
  return { verdict, summary: `clean: ${views.length} views${findings.length ? `, ${findings.length} minor` : ''}` };
}
