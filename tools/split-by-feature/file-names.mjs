// tools/split-by-feature/file-names.mjs — #919 mechanical names for the split's files (docs/split-by-feature.md, Layout).
// Names say what a file holds, never where it registers. Routes: the area, the path segment after the feature prefix;
// CSS: the section heading; markup: the view or dialog id. The rules' inputs live in feature-map.json `naming`, so a
// rerun on the same sources gives the same names. A name the rules cannot derive, or one that is generic or carries a
// number, throws (NameError) instead of falling back. Pure functions: no fs, no git.

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** The `naming` defaults: a feature map (or a test fixture map) without the block still names its files. */
export const NAMING_DEFAULTS = Object.freeze({ minLines: 40, areaMinLines: 150,
  stopwords: ['the', 'a', 'an', 'and', 'of', 'for', 'to', 'in', 'on', 'with', 'at', 'is', 'by', 'one'],
  generic: ['part', 'document', 'shared', 'common', 'misc', 'other', 'utils', 'two', 'this',
    'one', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second', 'third'],
  cssPrefixes: {}, cssBlocks: [], areas: {}, views: {}, rename: {} });
const PHASE = /^(p\d+|\d+)$/;

/** A name the rules cannot give. planSplit reports its message as a problem. */
export class NameError extends Error {}

/** Throws unless `name` is a valid name with no number (digits or spelled out) and no generic word. */
export function checkName(name, generic, where) {
  if (!name || !NAME.test(name)) throw new NameError(`cannot name ${where}: "${name ?? ''}" is not a name; map it in feature-map.json naming`);
  const words = name.split('-');
  const num = words.find((w) => /\d/.test(w));
  if (num) throw new NameError(`bad name ${where}: "${name}" has a number ("${num}"); name it by content in feature-map.json naming`);
  const gen = words.find((w) => generic.includes(w));
  if (gen) throw new NameError(`bad name ${where}: "${name}" is generic ("${gen}"); name it by content in feature-map.json naming`);
  return name;
}

const literals = (p) => String(p).split('/').filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
/**
 * A route path's literal segments after the feature prefix ('/api/runs/:id/diff' under '/api/runs' → ['diff']); a path
 * that is the prefix itself gives the prefix's own resource ('/api/run-groups' → ['run-groups']). Params, wildcards and
 * patterns are dropped; '' (a regexp or unknown path) gives [].
 */
export function routeKeys(path, prefix = '/api') {
  const all = literals(path);
  if (!all.length) return [];
  const keys = all.slice(literals(prefix).length);
  return keys.length ? keys : all.slice(-1);
}

/** A route's path descriptor (routes.mjs pathDesc) → its first literal path string ('' for a regexp or unknown). */
export const pathOf = (d) => (d?.kind === 'array' ? pathOf(d.value[0]) : d?.kind === 'string' ? d.value : '');

const lineSum = (us) => us.reduce((n, x) => n + x.lines, 0);

/** An over-cap group splits off its largest sub-resource (key at `depth`) until the rest fits; names compound with '-'. */
function fit(name, units, depth, cap, measure) {
  if (measure(units) <= cap) return [{ name, units }];
  const by = new Map();
  for (const x of units) { const k = x.keys[depth]; if (k) (by.get(k) ?? by.set(k, []).get(k)).push(x); }
  if (!by.size) return [{ name, units, oversize: true }];
  const out = []; let rest = units;
  for (const [k, us] of [...by].sort((a, b) => measure(b[1]) - measure(a[1]) || (a[0] < b[0] ? -1 : 1))) {
    if (measure(rest) <= cap) break;
    rest = rest.filter((x) => !us.includes(x));
    out.push(...fit(`${name}-${k}`, us, depth + 1, cap, measure));
  }
  return [...(rest.length ? [{ name, units: rest, ...(measure(rest) > cap ? { oversize: true } : {}) }] : []), ...out];
}

/**
 * The route files of one feature. `units`: [{ segment, keys, lines, first, ... }] in source order, one per packFiles
 * statement component; `keys` are routeKeys under the feature prefix, so keys[0] is the unit's area, and `full` (optional)
 * the literals after /api/.
 * - naming.areas[feature] groups areas under one file name ({ pause: 'control', resume: 'control', stop: 'control' }).
 *   A key with slashes matches the literals after /api/ ('history/pr' is /api/history/pr, not /api/pr); the longest wins.
 * - An unmapped area under `areaMinLines` joins the dominant (largest) area of its segment while that stays within the cap.
 * - An area over the cap splits off its largest sub-resource ('threads' → 'threads-cards').
 * The segment is not part of the name (ui/routes/FEATURE/index.mjs records it): one name in two segments throws, and so
 * does a unit with no area. `measure(units)` is the emitted file's line count (packFiles passes fileLines; tests default
 * to the sum). `rename` maps 'ui/routes/FEATURE/NAME.mjs' to a name. Returns [{ segment, name, units, oversize? }]
 * sorted by segment, then first statement.
 */
export function routeFiles(feature, units, { cap = 1000, areaMinLines = NAMING_DEFAULTS.areaMinLines, areas = {},
  generic = NAMING_DEFAULTS.generic, rename = {}, measure = lineSum } = {}) {
  const alias = areas[feature] ?? {}; const mapped = new Set(Object.values(alias));
  const files = [];
  for (const segment of [...new Set(units.map((x) => x.segment))].sort((a, b) => a - b)) {
    const by = new Map();
    for (const x of units.filter((y) => y.segment === segment)) {
      const k = x.keys[0];
      if (!k) throw new NameError(`cannot name a route area of feature ${feature}: its first route has no literal path (statement ${x.first}); map it in feature-map.json naming.areas`);
      const full = x.full ?? [];
      let a = alias[k] ?? k;
      for (let n = full.length; n >= 2; n--) { const hit = alias[full.slice(0, n).join('/')]; if (hit) { a = hit; break; } }
      (by.get(a) ?? by.set(a, []).get(a)).push(x);
    }
    const groups = [...by].flatMap(([area, us]) => fit(area, us, 1, cap, measure));
    const size = new Map(groups.map((g) => [g, measure(g.units)]));
    const dominant = groups.reduce((d, g) => (size.get(g) > size.get(d) ? g : d));
    const kept = [dominant];
    for (const g of groups) {
      if (g === dominant) continue;
      if (!g.oversize && !mapped.has(g.name) && size.get(g) < areaMinLines && measure([...dominant.units, ...g.units]) <= cap) dominant.units.push(...g.units);
      else kept.push(g);
    }
    for (const g of kept) { g.units.sort((a, b) => a.first - b.first); files.push({ segment, ...g }); }
  }
  const seen = new Map();
  for (const f of files) {
    f.name = rename[`ui/routes/${feature}/${f.name}.mjs`] ?? f.name;
    const where = `ui/routes/${feature}/${f.name}.mjs`;
    checkName(f.name, generic, where);
    if (seen.has(f.name)) throw new NameError(`${where}: area "${f.name}" registers in segments ${seen.get(f.name)} and ${f.segment}; group one under another name in feature-map.json naming.areas`);
    seen.set(f.name, f.segment);
  }
  return files.sort((a, b) => a.segment - b.segment || a.units[0].first - b.units[0].first);
}

/** Heading → words: parentheses dropped, cut at an em/en dash, middle dot or " - ", lowercased, stopwords and phase tokens removed. */
export function slugWords(title, stopwords) {
  return title.replace(/\([^)]*\)?/g, ' ').split(/[—–·]| - /)[0].toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w && !stopwords.includes(w) && !PHASE.test(w));
}

/** The title a CSS section is named by: its heading, or, when a phase token left it under 2 words, the first comment line under the marker. */
export function cssTitle(heading, firstComment, stopwords) {
  const phased = heading.toLowerCase().split(/[^a-z0-9]+/).some((w) => /^p\d+$/.test(w));   // "step 1" is no phase
  if (!phased || slugWords(heading, stopwords).length >= 2 || !firstComment) return heading;
  return firstComment.replace(/^\s*\/\*+\s*/, '').replace(/\s*\*+\/\s*$/, '');
}

/** Per folder: the shortest prefix of >= `min` words that no other title in the folder shares. Equal titles stay equal: nameProblems reports them. */
export function uniqueNames(titles, stopwords, min = 2) {
  const words = titles.map((t) => slugWords(t, stopwords));
  return words.map((w, i) => {
    let k = Math.min(min, w.length);
    while (k < w.length && words.some((o, j) => j !== i && o.slice(0, k).join('-') === w.slice(0, k).join('-'))) k += 1;
    const name = w.slice(0, k).join('-');
    if (!name) throw new NameError(`cannot name the CSS section "${titles[i]}": its heading has no words; map it in feature-map.json naming.rename`);
    return name;
  });
}

/** A markup part's name: its first data-view, else its first dialog/template/viewer-modal id (minus -modal), else its marker's words. */
export function markupName(text, { stopwords }) {
  const view = /data-view="([a-z0-9-]+)"/.exec(text)?.[1];
  if (view) return view;
  const dialog = /<(?:dialog|template|div class="viewer-modal")\b[^>]*\bid="([a-z0-9-]+)"/.exec(text)?.[1] ?? /\bid="([a-z0-9-]+-modal)"/.exec(text)?.[1];
  if (dialog) return dialog.replace(/-modal$/, '');
  const first = text.split('\n')[0];
  const marker = /<!--\s*=*\s*(?:VIEW:\s*)?(.+?)\s*=*\s*-->/.exec(first)?.[1] ?? /<!--\s*(.+?)[(.:]/.exec(first)?.[1];
  const words = marker ? slugWords(marker.split(':')[0], stopwords).slice(0, 3) : slugWords(first.replace(/[<>/]/g, ' '), stopwords);
  if (!words.length) throw new NameError(`cannot name the markup block "${first.trim().slice(0, 60)}": no view, dialog id or marker words; map it in feature-map.json naming`);
  return words.join('-');
}

/** D11: every generated path has a valid, folder-unique name; no route area is called index. */
export function nameProblems(paths) {
  const out = []; const seen = new Set();
  for (const p of paths) {
    if (p === 'ui/routes/index.mjs' || p === 'ui/public/parts.json') continue;
    const m = /^ui\/(routes|public)\/([a-z0-9-]+)\/([^/]+)\.(mjs|css|html)$/.exec(p);
    const name = m?.[3];
    if (!m || !NAME.test(name) || (m[1] === 'routes' && name === 'index')) out.push(`bad name: ${p}`);
    else if (seen.has(p)) out.push(`name collision: ${p}`);
    seen.add(p);
  }
  return out;
}
