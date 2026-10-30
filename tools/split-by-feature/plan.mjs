// tools/split-by-feature/plan.mjs — the feature map (#919): loading, the naming rule and matching.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

export const MAP_REL = 'tools/split-by-feature/feature-map.json';
const NAME = /^[a-z][a-z0-9-]*$/;

const lineOf = (text, needle) => { const at = text.indexOf(needle); return at < 0 ? 1 : text.slice(0, at).split('\n').length; };
const docNames = (root) => new Set(readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md')));
const publicFolders = (root) => new Set(readdirSync(join(root, 'ui/public')).filter((f) => statSync(join(root, 'ui/public', f)).isDirectory()));

export function loadMap(root, text = readFileSync(join(root, MAP_REL), 'utf8'), { folders = publicFolders(root) } = {}) {
  const map = JSON.parse(text);
  const problems = [];
  const seen = new Set(); const docs = docNames(root); const docless = map.docless ?? {};
  for (const f of map.features) {
    const at = `${MAP_REL}:${lineOf(text, `"name": "${f.name}"`)}`;
    if (!NAME.test(f.name) || seen.has(f.name)) problems.push(`bad or duplicate feature name: ${f.name} (${at})`);
    seen.add(f.name);
    if (docs.has(f.name)) { if (f.doc !== `docs/${f.name}.md`) problems.push(`feature ${f.name}: doc must be docs/${f.name}.md (${at})`); }
    else if (f.name in docless) { if (f.doc !== null) problems.push(`feature ${f.name}: a docless feature has doc null (${at})`); }
    else if (!folders.has(f.name) && f.name !== 'shell') problems.push(`bad feature name: ${f.name} is not a docs/*.md basename, a ui/public folder, shell or a docless entry (${at})`);
    if (f.doc && !existsSync(join(root, f.doc))) problems.push(`feature ${f.name}: doc ${f.doc} does not exist (${at})`);
    for (const p of f.routes) if (p.split('/').filter(Boolean).length < 2) problems.push(`feature ${f.name}: route prefix ${p} is too broad (${at})`);
    f.cssRe = f.css.map((s) => new RegExp(s));
  }
  for (const [k, why] of Object.entries(docless)) {
    if (!seen.has(k)) problems.push(`docless entry ${k} names no feature (${MAP_REL}:${lineOf(text, `"${k}":`)})`);
    if (typeof why !== 'string' || !why.trim()) problems.push(`docless entry ${k} needs a reason (${MAP_REL}:${lineOf(text, `"${k}":`)})`);
  }
  if (problems.length) throw Object.assign(new Error(problems.join('\n')), { problems });
  return map;
}

/** The feature whose longest route prefix matches `prefix`, or null. */
export function featureForRoute(map, prefix) {
  let best = null; let len = -1;
  for (const f of map.features) for (const p of f.routes) {
    const hit = prefix === p || prefix.startsWith(p.endsWith('/') ? p : p + '/');
    if (hit && p.length > len) { best = f.name; len = p.length; }
  }
  return best;
}

export function featureForCss(map, title) {
  const hits = map.features.filter((f) => f.cssRe.some((re) => re.test(title)));
  return hits.length === 1 ? hits[0].name : hits.length ? `ambiguous:${hits.map((h) => h.name).join(',')}` : null;
}

export function featureForHtml(map, trimmedLine) {
  const hits = map.features.filter((f) => f.html.some((s) => trimmedLine.startsWith(s)));
  return hits.length === 1 ? hits[0].name : null;
}
