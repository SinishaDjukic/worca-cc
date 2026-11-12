#!/usr/bin/env node
// tools/stillhet-wiring.mjs — lists every prototype action and every seeded figure of ui/public/stillhet/, and reports the ones
// with no row in plans/rail/stillhet-wiring.md ("Action rows" and "Figure rows", keyed by the id in the first column).
//   action  `module › phrase`: each window.RailWould(...) call (the phrase with every ${…} read as …), each RailAdapter.act('id')
//           call, and each key of demo/demo-actions.js but `would`; plus `design-system/components/run-state.mjs › phrase`
//           for each `would` phrase of the library's run-state flow (its {names} kept)
//   figure  `model file › key`: each data key (not a function) of the globals a model file sets, loaded in a node:vm sandbox, and
//           its seed getters (`seed`, `data`),
//           plus NAMED_FIGURES, the counts the bar, Pulse and the bell draw
//   npm run stillhet:wiring            prints the ids with no row; exit 1 when there is one
//   npm run stillhet:wiring -- --list  prints every id
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'ui/public/stillhet');
export const WIRING = path.join(ROOT, 'plans/rail/stillhet-wiring.md');
const GENERATED = /\/(components|graph)\.js$/;
const SKIP = /\/(adapter|demo-actions)\.js$/;   // the seam itself: it answers the calls, it holds no action

/** The model files, in the order boot.js loads them (a later one may read an earlier one's global). */
export const MODEL_FILES = ['runs/run-page-model.js', 'shell/world.js', 'pulse/pulse-model.js', 'runs/runs-model.js', 'chat/chats-model.js',
  'schedules/schedules-model.js', 'settings/settings-model.js', 'insights/insights-model.js'];

/** The functions of a model that hand out its seed data. */
const SEEDS = new Set(['seed', 'data']);

/** The counts a screen draws from seed data that no single model key names. */
export const NAMED_FIGURES = [
  'bar › Pulse badge: the Needs you count', 'bar › Pulse: the unread updates', 'bar › Pulse: the running tasks',
  'bell › the Needs you rows', 'sidebar › Chat: the unread reply dot', 'profile › the usage rings per harness',
  'profile › spend and the budget left',
];

// The JS string literal that starts at src[i] (a quote or a backtick), with every ${…} read as "…". Returns [text, end].
function readLiteral(src, i) {
  const q = src[i]; let out = ''; let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { out += src[j + 1]; j += 2; continue; }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      let depth = 1; j += 2;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      out += '…'; continue;
    }
    out += src[j++];
  }
  return [out, j + 1];
}

/** The phrase of each RailWould call in a source text. */
export function phrasesOf(src) {
  const out = [];
  for (const m of src.matchAll(/RailWould\(\s*/g)) {
    const at = m.index + m[0].length;
    if (!/['"`]/.test(src[at])) { out.push('(a phrase built from data)'); continue; }
    let [text, end] = readLiteral(src, at);
    if (/^\s*\+/.test(src.slice(end))) text += '…';
    out.push(text.replace(/\s+/g, ' ').trim() || '(a phrase built from data)');
  }
  return out;
}

const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

// The library's run-state flow: each `would` phrase is an action the library cannot take, answered by the host (the app's
// refusal until its area wires it), so it needs a row like a RailWould call. Read from the source, its {names} kept.
const RUN_STATE = path.join(ROOT, 'ui/public/design-system/components/run-state.mjs');
const RUN_STATE_ID = 'design-system/components/run-state.mjs';
export function wouldPhrasesOf(src) {
  return [...src.matchAll(/\bwould:\s*(?=['"`])/g)].map((m) => readLiteral(src, m.index + m[0].length)[0].replace(/\s+/g, ' ').trim());
}

/** Every action id under ui/public/stillhet/ and of the library's run-state flow, sorted and unique. */
export function actionIds(src = SRC, runState = RUN_STATE) {
  const ids = new Set();
  for (const f of walk(src).filter((p) => p.endsWith('.js') && !GENERATED.test(p))) {
    const text = readFileSync(f, 'utf8'), mod = path.relative(src, f).split(path.sep).join('/');
    if (mod === 'demo/demo-actions.js') {
      const sb = { window: {} }; vm.runInNewContext(text, sb);
      for (const k of Object.keys(sb.window.RailDemoActions || {})) if (k !== 'would') ids.add(`${mod} › ${k}`);
      continue;
    }
    if (SKIP.test(f)) continue;
    for (const p of phrasesOf(text)) ids.add(`${mod} › ${p}`);
    for (const m of text.matchAll(/RailAdapter\.act\(\s*['"]([^'"]+)['"]/g)) ids.add(`${mod} › ${m[1]}`);
  }
  for (const p of wouldPhrasesOf(readFileSync(runState, 'utf8'))) ids.add(`${RUN_STATE_ID} › ${p}`);
  return [...ids].sort();
}

/** Every seeded figure id: each data key of the globals the model files set, then NAMED_FIGURES. */
export async function figureIds(src = SRC) {
  const R = await import(new URL('../ui/public/design-system/components/index.mjs', import.meta.url));
  const win = { RailUI: { ...R }, RailWould: (p) => p, location: { search: '', hash: '' }, addEventListener() {} };
  const ctx = vm.createContext({ window: win, location: win.location, URLSearchParams, setTimeout, console,
    document: { addEventListener() {}, querySelector: () => null, documentElement: { dataset: {} } }, localStorage: { getItem: () => null, setItem() {} } });
  const ids = [];
  for (const f of MODEL_FILES) {
    const before = new Set(Object.keys(win));
    vm.runInContext(readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f });
    for (const g of Object.keys(win).filter((k) => !before.has(k))) {
      const v = win[g];
      if (v === null || typeof v !== 'object') { ids.push(`${f} › ${g}`); continue; }
      for (const k of Object.keys(v)) if (typeof v[k] !== 'function' || SEEDS.has(k)) ids.push(`${f} › ${g}.${k}`);
    }
  }
  return [...ids, ...NAMED_FIGURES];
}

// The table rows under `## heading` in the wiring file (rows whose first cell is backticked).
const rowsUnder = (doc, heading) => {
  const at = doc.indexOf(`\n## ${heading}\n`);
  return at < 0 ? [] : doc.slice(at + 1).split(/\n## /)[0].split('\n').filter((l) => l.startsWith('| `'));
};

/** The ids of a table in the wiring file: the backticked first cell of each row under `## heading`. */
export const rowIds = (doc, heading) => rowsUnder(doc, heading).map((l) => l.slice(3, l.indexOf('`', 3)));

export const STATUS = /\|\s*(wire to|new: build it|add to the design first)\s*\|/;

/** What has no row, and the rows of the two tables whose status is not one of the three words. */
export function check(doc, actions, figures) {
  const a = new Set(rowIds(doc, 'Action rows')), f = new Set(rowIds(doc, 'Figure rows'));
  return {
    actions: actions.filter((id) => !a.has(id)),
    figures: figures.filter((id) => !f.has(id)),
    badStatus: [...rowsUnder(doc, 'Action rows'), ...rowsUnder(doc, 'Figure rows')].filter((l) => !STATUS.test(l)),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const actions = actionIds(), figures = await figureIds();
  if (argv.includes('--list')) { for (const id of [...actions, ...figures]) console.log(id); return 0; }
  const { actions: a, figures: f, badStatus } = check(readFileSync(WIRING, 'utf8'), actions, figures);
  for (const id of a) console.log('no action row: ' + id);
  for (const id of f) console.log('no figure row: ' + id);
  for (const l of badStatus) console.log('no known status: ' + l.slice(0, 100));
  console.log(`${actions.length} actions, ${figures.length} figures; ${a.length + f.length} without a row`);
  return a.length || f.length || badStatus.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
