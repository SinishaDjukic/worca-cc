#!/usr/bin/env node
// Bundle <promo>/timeline.json + <promo>/plates/manifest.json + the list of <promo>/film/scenes/*.js|css into
// <promo>/film/data.js (window.FILM_DATA), so the film opens from file:// with no fetches. Re-run after any
// timeline, plate or scene-file change (adding a scene file needs a rebuild: index.html loads what data.js lists).
//   node promo-kit/tools/build-data.mjs <promoDir>
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** The plate map from a manifest: `{version, plates:{…}}` or a flat `{name: plate}` map. */
export function platesOf(manifest) {
  if (!manifest || typeof manifest !== 'object') return {};
  if (manifest.plates && typeof manifest.plates === 'object' && !Array.isArray(manifest.plates)) return manifest.plates;
  const out = {};
  for (const [k, v] of Object.entries(manifest)) if (v && typeof v === 'object' && v.states && typeof v.states === 'object') out[k] = v;
  return out;
}

/**
 * Load order for scene files: shared helper files (a name that is no scene id, e.g. `_shared.js`) first, sorted,
 * then one file per scene in timeline order — a scene may use helpers an earlier scene's file defines.
 */
export function orderSceneFiles(files, scenes = []) {
  const base = (f) => f.replace(/\.(js|css)$/, '');
  const ids = (scenes || []).map((s) => s.id);
  const helpers = files.filter((f) => !ids.includes(base(f))).sort();
  const own = files.filter((f) => ids.includes(base(f))).sort((a, b) => ids.indexOf(base(a)) - ids.indexOf(base(b)));
  return [...helpers, ...own];
}

/**
 * Build FILM_DATA from a timeline object, a plate map and the scene file lists (pure).
 * vo words become absolute film seconds; `end` = start + speechEnd (or dur).
 */
export function filmData(timeline, plates = {}, { sceneFiles = [], sceneCss = [], title } = {}) {
  const warnings = [];
  const scenes = (timeline.scenes || []).map((s) => ({ id: s.id, start: s.start, end: s.end, ...(s.chapter ? { chapter: s.chapter } : {}) }));
  const ids = Object.keys(timeline.vo || {}).sort((a, b) => timeline.vo[a].start - timeline.vo[b].start);
  const vo = {};
  const layoutVo = {};
  for (const id of ids) {
    const v = timeline.vo[id];
    const start = v.start;
    vo[id] = {
      id, text: v.text, scene: v.scene, start, dur: v.dur, end: start + (v.speechEnd ?? v.dur),
      words: (v.words || []).map((w) => ({ w: w.w, key: w.key ?? norm(w.w), t0: start + w.t0, t1: start + w.t1 })),
    };
    layoutVo[id] = start;
  }
  for (let i = 1; i < ids.length; i++) {
    const p = vo[ids[i - 1]], c = vo[ids[i]];
    if (p.end > c.start - 0.15) warnings.push(`${p.id} ends at ${p.end.toFixed(2)} but ${c.id} starts at ${c.start.toFixed(2)}`);
  }
  const last = ids.length ? vo[ids.at(-1)] : null;
  if (last && last.end > timeline.duration) warnings.push(`the last line ${last.id} ends after the film (${last.end.toFixed(2)} > ${timeline.duration})`);
  for (let i = 1; i < scenes.length; i++) {
    const gap = scenes[i].start - scenes[i - 1].end;
    if (Math.abs(gap) > 0.001) warnings.push(`scene ${scenes[i].id} starts ${gap > 0 ? 'after a gap of' : 'overlapping by'} ${Math.abs(gap).toFixed(3)} s`);
  }
  for (const id of ids) {
    const v = vo[id], s = scenes.find((x) => x.id === v.scene);
    if (v.scene && !s) warnings.push(`${id} names an unknown scene ${v.scene}`);
    else if (s && (v.start < s.start - 0.001 || v.end > s.end + 0.001)) warnings.push(`${id} (${v.start.toFixed(2)}–${v.end.toFixed(2)}) runs outside its scene ${s.id} (${s.start}–${s.end})`);
  }
  const layout = { duration: timeline.duration, fps: timeline.fps ?? 60, scenes, vo: layoutVo };
  const data = { layout, vo, plates, sceneFiles, sceneCss, ...(title ? { title } : {}) };
  return { data, warnings };
}

/**
 * Write <promoDir>/film/data.js atomically.
 * @returns {{scenes:number, plates:number, voLines:number, sceneFiles:string[], warnings:string[], file:string}}
 */
export function buildData({ promoDir } = {}) {
  if (!promoDir) throw new Error('buildData: promoDir is required');
  const dir = resolve(promoDir);
  const tlFile = join(dir, 'timeline.json');
  if (!existsSync(tlFile)) throw new Error(`buildData: ${tlFile} not found (timeline.json is written by the narration step)`);
  const timeline = readJson(tlFile);
  const mfFile = join(dir, 'plates', 'manifest.json');
  const plates = existsSync(mfFile) ? platesOf(readJson(mfFile)) : {};
  const filmDir = join(dir, 'film');
  const scenesDir = join(filmDir, 'scenes');
  const list = existsSync(scenesDir) ? readdirSync(scenesDir).sort() : [];
  const sceneFiles = orderSceneFiles(list.filter((f) => f.endsWith('.js')), timeline.scenes).map((f) => `scenes/${f}`);
  const sceneCss = orderSceneFiles(list.filter((f) => f.endsWith('.css')), timeline.scenes).map((f) => `scenes/${f}`);
  let title;
  try { title = readJson(join(dir, 'script.json')).title || undefined; } catch { /* optional */ }
  const { data, warnings } = filmData(timeline, plates, { sceneFiles, sceneCss, title });
  mkdirSync(filmDir, { recursive: true });
  // atomic: scene agents rebuild this while others snap
  const out = join(filmDir, 'data.js');
  const tmp = join(filmDir, `.data.${process.pid}.${Date.now()}.js`);
  writeFileSync(tmp, `/* generated by promo-kit/tools/build-data.mjs — do not edit */\nwindow.FILM_DATA = ${JSON.stringify(data)};\n`);
  renameSync(tmp, out);
  return { scenes: data.layout.scenes.length, plates: Object.keys(plates).length, voLines: Object.keys(data.vo).length, sceneFiles, warnings, file: out };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const a = process.argv.slice(2);
  const promoDir = a.includes('--promo') ? a[a.indexOf('--promo') + 1] : a[0];
  if (!promoDir) { console.error('usage: node build-data.mjs <promoDir>'); process.exit(1); }
  try {
    const r = buildData({ promoDir });
    console.log(`film/data.js: ${r.voLines} VO lines, ${r.plates} plates, ${r.scenes} scenes, ${r.sceneFiles.length} scene files`);
    for (const w of r.warnings) console.warn('WARN ' + w);
  } catch (e) { console.error(e.message); process.exit(1); }
}
