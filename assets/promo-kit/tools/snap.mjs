#!/usr/bin/env node
// Frames, contact sheets and the SFX cue dump of a promo film (headless Chrome, deterministic seeks).
//   node promo-kit/tools/snap.mjs --promo <promoDir> --times 1,2.5,7 --out DIR [--scale 1]
//   node promo-kit/tools/snap.mjs --promo <promoDir> --from 12 --to 20 --step 0.5 --sheet out.jpg [--cols 6 --thumb 320]
//   node promo-kit/tools/snap.mjs --promo <promoDir> --scene hook --step 1 --sheet out.jpg
//   node promo-kit/tools/snap.mjs --promo <promoDir> --cues out.json        (every scene's SFX cues + violations, no frames)
//   --html FILE instead of --promo opens any kit page (e.g. <promo>/film/mascot-demo.html).
// Prints the film's violations (kit warnings) and console errors; exit 2 when there are any.
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openFilm, parseArgs } from './cdp.mjs';
import { contactSheet } from './sheet.mjs';

/** Film facts without rendering frames: duration, scenes, SFX cues (sorted), kit violations, console errors. */
export async function dumpCues({ html, chrome } = {}) {
  const b = await launch({ scale: 0.25, chrome });
  try {
    await openFilm(b, html);
    const meta = await b.evaluate('({dur: __film.dur, scenes: __film.scenes, cues: __film.cues, violations: __film.violations})');
    return { ...meta, logs: [...new Set(b.logs)] };
  } finally { await b.close(); }
}

/** JPEG frames at film times `times` into `out` (a temp dir when omitted). Returns { files, out, scenes, dur, violations, logs }. */
export async function snapFrames({ html, times, out, scale = 0.5, chrome, quality = 88 } = {}) {
  const dir = out ? resolve(out) : mkdtempSync(join(tmpdir(), 'promo-snap-'));
  mkdirSync(dir, { recursive: true });
  const b = await launch({ scale, chrome });
  try {
    const film = await openFilm(b, html);
    const meta = await b.evaluate('({dur: __film.dur, scenes: __film.scenes})');
    const files = [];
    for (const [i, t] of times.entries()) {
      await film.seek(t);
      const f = join(dir, `f${String(i).padStart(3, '0')}_${t.toFixed(2).padStart(7, '0')}.jpg`);
      writeFileSync(f, await b.capture({ format: 'jpeg', quality }));
      files.push(f);
    }
    const violations = await b.evaluate('__film.violations');
    return { files, out: dir, ...meta, violations, logs: [...new Set(b.logs)] };
  } finally { await b.close(); }
}

/** Film times for --from/--to/--step or a scene's window. */
export function timesFor({ scenes, dur }, { from, to, step = 1, scene } = {}) {
  const sc = scene && scenes.find((s) => s.id === scene);
  if (scene && !sc) throw new Error('no scene ' + scene);
  const a = sc ? sc.start : Number(from || 0), z = sc ? sc.end - 0.01 : Number(to ?? dur), st = Number(step) || 1;
  const out = [];
  for (let t = a; t <= z + 1e-9; t += st) out.push(+t.toFixed(4));
  return out;
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const A = parseArgs(process.argv.slice(2));
  const html = A.html ? resolve(A.html) : A.promo ? join(resolve(A.promo), 'film', 'index.html') : null;
  if (!html) { console.error('usage: snap.mjs --promo <promoDir> | --html <film.html>  [--times …|--from … --to … --step …|--scene id] [--out DIR] [--sheet f.jpg] [--cues f.json]'); process.exit(1); }
  let code = 0;
  try {
    const meta = await dumpCues({ html });
    if (A.cues) {
      mkdirSync(dirname(resolve(A.cues)), { recursive: true });
      writeFileSync(resolve(A.cues), JSON.stringify({ dur: meta.dur, cues: meta.cues }, null, 1));
      console.log(`${meta.cues.length} cues → ${A.cues}`);
    }
    let times = [];
    if (A.times) times = String(A.times).split(',').map(Number);
    else if (A.from !== undefined || A.to !== undefined || A.scene) times = timesFor(meta, A);
    let logs = meta.logs, violations = meta.violations;
    if (times.length) {
      const r = await snapFrames({ html, times, out: A.out, scale: Number(A.scale || 0.5) });
      console.log(`${r.files.length} frames → ${r.out}`);
      if (A.sheet) {
        await contactSheet({ images: r.files, out: resolve(A.sheet), cols: Number(A.cols || 4), thumb: Number(A.thumb || 480) });
        console.log(`sheet → ${A.sheet}`);
        if (!A.out) rmSync(r.out, { recursive: true, force: true });
      }
      logs = [...new Set([...logs, ...r.logs])]; violations = r.violations;
    }
    if (violations.length) { console.log('VIOLATIONS:\n  ' + violations.join('\n  ')); code = 2; }
    if (logs.length) { console.log('CONSOLE:\n  ' + logs.slice(0, 30).join('\n  ')); code = 2; }
  } catch (e) { console.error(e.stack || e.message); code = 1; }
  process.exit(code);
}
