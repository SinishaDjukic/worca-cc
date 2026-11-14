// test/rail-docs.test.mjs — the docs, the catalog, the library and the gallery agree (docs/rail/gate.md): each rule has one
// home and a check that exists; each catalog entry with `code` is a real export; each component the library exports is in
// the catalog, tested and drawn in the gallery; contributors and agents are pointed at the design system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as LIB from '../ui/public/design-system/components/index.mjs';
import { catalogHtml, chapters as pageChapters, tilesHtml } from '../tools/rail-artifact.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const RAIL = 'docs/rail';
const chapters = () => readdirSync(join(ROOT, RAIL)).filter((f) => f.endsWith('.md'));
const catalog = () => JSON.parse(read('docs/design-system-catalog.json'));

function rules() {
  const out = [];
  for (const f of chapters()) for (const m of read(`${RAIL}/${f}`).matchAll(/^\| `([a-z-]+\.[a-z-]+)` \| (.+?) \| (.+?) \| (.+?) \|$/gm)) out.push({ file: f, id: m[1], what: m[2], why: m[3], held: m[4] });
  return out;
}
const checkExists = (c) => c === 'by hand' || [`plans/rail/prototype/gates/${c}.mjs`, `test/${c}.test.mjs`, `tools/${c}.mjs`].some((p) => existsSync(join(ROOT, p)));

test('every rule has one home, an id, a why, and a check that exists', () => {
  const all = rules(); assert.ok(all.length > 40, 'the scan sees the rules');
  const seen = new Map();
  for (const r of all) { assert.ok(!seen.has(r.id), `${r.id} is in ${seen.get(r.id)} and ${r.file}`); seen.set(r.id, r.file); assert.ok(checkExists(r.held), `${r.id}: no check named ${r.held}`); }
});

test('the index lists every chapter, and every chapter it lists exists', () => {
  const idx = read(`${RAIL}/README.md`);
  const listed = [...idx.matchAll(/\]\(([a-z-]+\.md)\)/g)].map((m) => m[1]);
  for (const f of listed) assert.ok(existsSync(join(ROOT, RAIL, f)), `${f} is listed and missing`);
  for (const f of chapters()) if (f !== 'README.md') assert.ok(listed.includes(f), `${f} is not in the index`);
});

// The file at `code` exports the name: a function or const of its own, or a name in an `export { … }` list.
function assertExports(owner, code) {
  const [file, name] = code.split('#');
  assert.match(name ?? '', /^\w+$/, `${owner}: ${code} names no export`);
  assert.ok(existsSync(join(ROOT, file)), `${owner}: ${file} is missing`);
  const src = read(file);
  const own = new RegExp(`export (async )?(function|const) ${name}\\b`).test(src);
  const listed = [...src.matchAll(/export \{([^}]*)\}/g)].some((m) => new RegExp(`\\b${name}\\b`).test(m[1]));
  assert.ok(own || listed, `${owner}: ${file} does not export ${name}`);
  return name;
}

// A real use of a library name by a page (gate.docs): `R.name` / `RailUI.name`, a destructure from `R` or `window.RailUI`,
// a named import from a design-system path, or `X.name` after `import * as X` from one. Comments are stripped first, so
// a word in a comment is no use. Computed access (`R['name']`, `R[key]`) is not detected: rail-gate's review catches it.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
function usesName(src, name) {
  const s = stripComments(src); const word = new RegExp(`\\b${name}\\b`);
  if (new RegExp(`\\b(R|RailUI)\\??\\.${name}\\b`).test(s)) return true;
  for (const m of s.matchAll(/\{([^}]*)\}\s*=\s*(?:R|window\.RailUI)\b/g)) if (word.test(m[1])) return true;
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*design-system\/[^'"]*['"]/g)) if (word.test(m[1])) return true;
  for (const m of s.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*['"][^'"]*design-system\/[^'"]*['"]/g)) if (new RegExp(`\\b${m[1]}\\??\\.${name}\\b`).test(s)) return true;
  return false;
}
function pageFiles(dir = 'ui/public', out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (p !== 'ui/public/design-system') pageFiles(p, out); } else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the use finder sees a real use and never a word in a comment', () => {
  assert.equal(usesName('// shows the list\nconst shows = 1;', 'shows'), false);
  assert.equal(usesName('/* R.shows(x) */', 'shows'), false);
  assert.equal(usesName('R.shows(x)', 'shows'), true);
  assert.equal(usesName('window.RailUI?.shows(x)', 'shows'), true);
  assert.equal(usesName("import * as DS from '../design-system/components/index.mjs'; DS?.shows(x)", 'shows'), true);
  assert.equal(usesName('const { shows, prefs } = R;', 'shows'), true);
  assert.equal(usesName("import { shows } from '../design-system/components/index.mjs';", 'shows'), true);
  assert.equal(usesName("import * as DS from '../design-system/components/index.mjs'; DS.shows(x)", 'shows'), true);
  assert.equal(usesName("import * as DS from '../design-system/components/index.mjs'; DS.showsMore(x)", 'shows'), false);
});

test('a catalog entry with code is a real export, and every public export has one place in the catalog', () => {
  const cat = catalog(); const entries = [...cat.components, ...cat.patterns, ...cat.logic];
  const places = new Map(); const also = [];
  const place = (name, where) => { assert.ok(!places.has(name), `${name} has two places in the catalog`); places.set(name, where); };
  for (const e of entries) {
    if (e.code) place(assertExports(e.name, e.code), e.name);
    for (const a of e.also || []) {
      place(assertExports(`${e.name} › also`, a.code), `${e.name} › also`);
      assert.ok(Array.isArray(a.needs) && a.needs.length >= 1, `${a.code}: an also element needs at least one need`);
      also.push(a.code.split('#')[1]);
    }
  }
  for (const i of cat.internal) {
    assert.ok(i.name in LIB, `${i.name} is listed as internal and not exported`);
    assert.ok(['html', 'constant', 'part'].includes(i.kind), `${i.name}: internal kind ${i.kind} is not html, constant or part`);
    if (i.kind === 'constant') assert.match(i.name, /^[A-Z][A-Z0-9_]*$/, `${i.name} is a constant and not an ALL_CAPS name`);
    assert.ok(i.why, `${i.name}: internal without a why`);
    place(i.name, 'internal');
  }
  for (const name of Object.keys(LIB)) assert.ok(places.has(name), `${name} is exported and has no place in the catalog: give it needs (a component, logic or an also element) or list it as internal`);
  const tests = read('test/design-system-components.test.mjs') + read('test/design-system-logic.test.mjs'); const lookup = read(`${RAIL}/components.md`);
  for (const name of also) {
    assert.match(tests, new RegExp(`\\b${name}\\b`), `${name}: an also element no library test names`);
    assert.match(lookup, new RegExp(`\\b${name}\\b`), `${name}: an also element the lookup (docs/rail/components.md) does not name`);
  }
  const pages = pageFiles().map((f) => [f, read(f)]);
  for (const i of cat.internal) if (i.kind === 'part') for (const [file, src] of pages) assert.ok(!usesName(src, i.name), `${i.name} is internal but ${file} uses it: make it an also element with its need`);
});

test('the gallery\'s inline scripts parse: one syntax error blanks every example', () => {
  const gallery = read('plans/rail/prototype/components.html');
  const scripts = [...gallery.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2, 'read the gallery scripts');
  for (const [i, src] of scripts.entries()) assert.doesNotThrow(() => new Function(src), `inline script ${i + 1}`);
});

test('every component in code is tested and drawn in the gallery', () => {
  const tests = read('test/design-system-components.test.mjs'); const gallery = read('plans/rail/prototype/components.html');
  for (const c of catalog().components) {
    if (!c.code) { assert.fail(`${c.name} has no code entry`); }
    const name = c.code.split('#')[1];
    assert.match(tests, new RegExp(`\\b${name}\\b`), `${c.name}: no test mentions ${name}`);
    assert.ok(gallery.includes(`${c.name}: [[`) || gallery.includes(`'${c.name}': [[`), `${c.name}: no gallery example`);
  }
});

test('contributors and agents are pointed at the design system', () => {
  for (const f of ['CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md']) assert.match(read(f), /docs\/rail\/README\.md/, `${f} does not point to the design system`);
  for (const a of readdirSync(join(ROOT, '.claude/agents'))) assert.match(read(`.claude/agents/${a}`), /docs\/rail\/README\.md/, `${a} does not point to the design system`);
});

test('the plans point at what exists, and the one names stay', () => {
  for (const f of readdirSync(join(ROOT, 'plans/rail'))) if (f.endsWith('.md')) assert.doesNotMatch(read(`plans/rail/${f}`), /rail-restart-handoff/, f);
  assert.match(read('plans/rail/implementation-prompt.md'), /`docs\/rail-agreed`/);
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'docs/rail/README.md']) assert.match(read(f), /Building Rail now/, f);
  for (const f of [...chapters().map((c) => `${RAIL}/${c}`), 'docs/design-system-catalog.json']) assert.doesNotMatch(read(f), /account menu/i, `${f}: the name is the profile menu`);
});

test('the motion timings are the ones the catalog names', () => {
  const look = read('ui/public/stillhet/css/rail-look.css'), t = catalog().motion.timings;
  assert.match(look, /--motion-quick:150ms/); assert.match(t['--motion-quick'], /^150ms/);
  assert.match(look, /--motion-change:200ms/); assert.match(t['--motion-change'], /^200ms/);
  assert.match(look, /--motion-flash:1\.2s/);
});

test('no pointer to the deleted Shaping branch is left in what Agreed decided', () => {
  for (const f of readdirSync(join(ROOT, 'plans/rail/agreed'))) if (f.endsWith('.md')) assert.doesNotMatch(read(`plans/rail/agreed/${f}`), /rail-shaping|plans\/rail\/shaping/, f);
});

test('the generated page holds every chapter, rule and catalog entry, from the sources alone', () => {
  const ch = pageChapters(); const html = ch.map((c) => c.html).join('') + catalogHtml() + tilesHtml();
  for (const f of readdirSync(join(ROOT, RAIL))) { const id = f === 'README.md' ? 'rail' : f.replace('.md', ''); assert.ok(ch.some((c) => c.id === id), `${f} is not on the page`); }
  for (const r of rules()) assert.ok(html.includes(r.id), `${r.id} is not on the page`);
  for (const c of [...catalog().components, ...catalog().patterns, ...catalog().logic]) assert.ok(html.includes(c.name.replace(/&/g, '&amp;')), `${c.name} is not on the page`);
});
