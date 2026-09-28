// pkg-maven: pom.xml → provides maven:<groupId>:<artifactId>; consumes every
// <dependency> (project, profiles, and BOM imports in dependencyManagement).
// ${project.groupId} / ${project.version} / <properties> are substituted; an
// unresolvable ${…} in a coordinate becomes an `unresolved` item, not a fact.
import { scanXml } from './lib/xml.mjs';
import { splitLines, fact, aliasable, onePerKey, cleanUnresolved, isSampleManifest } from './lib/text.mjs';
import { isTestPath } from '../files.mjs';
import { LIMITS } from '../../../shared/workspace-map/limits.mjs';

const DEP_PARENTS = [
  'project/dependencies/dependency',
  'project/profiles/profile/dependencies/dependency',
];
const MGMT = 'project/dependencyManagement/dependencies/dependency';

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  const { leaves } = scanXml(text);
  const at = (path) => leaves.find((l) => l.path === path) || null;
  const props = {};
  for (const l of leaves) if (l.path.startsWith('project/properties/')) props[l.name] = l.text;
  const group = at('project/groupId') || at('project/parent/groupId');
  const artifact = at('project/artifactId');
  props['project.groupId'] = group?.text ?? '';
  props['project.artifactId'] = artifact?.text ?? '';
  props['project.version'] = (at('project/version') || at('project/parent/version'))?.text ?? '';
  const subst = (s) => String(s ?? '').replace(/\$\{([^}]{1,200})\}/g, (all, k) => (props[k] ? props[k] : all));
  const facts = [];
  const unresolved = [];
  const aliases = [];
  if (group?.text && artifact?.text) {
    const g = subst(group.text);
    const a = subst(artifact.text);
    if (!g.includes('${') && !a.includes('${')) {
      facts.push(fact({ kind: 'pkg', dir: 'provides', key: `maven:${g}:${a}`, rel, lines, line: artifact.line, needle: `<artifactId>${artifact.text}</artifactId>`, detail: 'Maven project', confidence: 'exact' }));
      if (aliasable(rel, a)) aliases.push({ value: a, source: 'maven' });
    }
  }
  // Group dependency leaves by their enclosing <dependency> element.
  const byElement = new Map();
  for (const l of leaves) {
    const parent = l.path.slice(0, l.path.lastIndexOf('/'));
    if (!DEP_PARENTS.includes(parent) && parent !== MGMT) continue;
    if (!byElement.has(l.parent)) byElement.set(l.parent, { parent });
    const d = byElement.get(l.parent);
    d[l.name] = l.text;
    d[`${l.name}Line`] = l.line;
  }
  for (const d of byElement.values()) {
    if (!d.artifactId || !d.groupId) continue;
    if (d.parent === MGMT && !(d.scope === 'import' && d.type === 'pom')) continue;
    const g = subst(d.groupId);
    const a = subst(d.artifactId);
    const line = d.artifactIdLine;
    if (g.includes('${') || a.includes('${')) {
      unresolved.push({ kind: 'pkg', raw: `${d.groupId}:${d.artifactId}`, file: rel, line, reason: 'unresolved maven property' });
      continue;
    }
    const detail = [d.scope && `scope ${d.scope}`, d.parent === MGMT && 'BOM import'].filter(Boolean).join(', ') || undefined;
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `maven:${g}:${a}`, rel, lines, line, needle: `<artifactId>${d.artifactId}</artifactId>`, detail, confidence: 'exact' }));
  }
  const desc = at('project/description')?.text?.replace(/\s+/g, ' ').trim();
  const test = isTestPath(rel); // a test fixture's pom says nothing about the member's stack or role
  return {
    facts: onePerKey(facts), aliases, unresolved: cleanUnresolved(ctx?.state, rel, unresolved), stack: test ? [] : ['java'],
    role: desc && !test ? { text: desc.slice(0, LIMITS.ROLE_MAX), source: 'manifest' } : undefined,
  };
}

export default Object.freeze({
  id: 'pkg-maven',
  claims: (rel) => /(^|\/)pom\.xml$/.test(rel) && !isSampleManifest(rel),
  detect,
});
