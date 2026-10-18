#!/usr/bin/env node
// Fluency check over EVERY frame of a promo film (small PNGs, decoded in Node): one-frame pops and flashes, frozen
// holds (> 1.2 s without a change) and near-blank frames (only the paper on screen). Findings carry the scene and
// its local time; --sheets DIR writes a ±4-frame contact sheet per finding.
//   node promo-kit/tools/fluency.mjs --promo <promoDir> [--from 0 --to 30] [--workers 4] [--scale 0.25] [--sheets DIR] [--json out.json]
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openFilm, defaultWorkers, parseArgs } from './cdp.mjs';
import { decodePNG, frameDiff, rollingMedian } from './analyze.mjs';
import { contactSheet } from './sheet.mjs';

const PAPER = [241, 241, 239];   // film.css --paper
const HOLD_FRAMES = 72;          // 1.2 s at 60 fps

/**
 * @returns {Promise<{frames:number, fps:number, medianDelta:number,
 *   pops:{frame,t,scene,local,delta,median}[], flashes:{frame,t,scene,local,delta}[],
 *   holds:{frame,t,scene,local,dur}[], blanks:{frame,t,scene,local,frames}[], violations:string[], sheets?:string[]}>}
 */
export async function checkFluency({ html, chrome, scale = 0.25, workers, from = 0, to, sheets = null, paper = PAPER } = {}) {
  const probe = await launch({ scale: 0.1, chrome });
  let meta;
  try { await openFilm(probe, html); meta = await probe.evaluate('({dur: __film.dur, fps: __film.fps, scenes: __film.scenes, violations: __film.violations})'); }
  finally { await probe.close(); }
  const FPS = meta.fps || 60;
  const end = Math.min(meta.dur, to ?? meta.dur);
  const f0 = Math.round(from * FPS), f1 = Math.round(end * FPS), N = f1 - f0;
  const W = Math.max(1, Math.min(Number(workers) || await defaultWorkers(), Math.ceil(N / 30)));
  const chunk = Math.ceil(N / W);
  const mad = new Float64Array(N).fill(NaN), blank = new Float64Array(N);
  const keep = sheets ? mkdtempSync(join(tmpdir(), 'promo-flu-')) : null;
  async function worker(k) {
    const a = f0 + k * chunk, z = Math.min(f1, a + chunk); if (z <= a) return;
    const b = await launch({ scale, chrome });
    try {
      const film = await openFilm(b, html);
      let prev = null;
      for (let i = Math.max(f0, a - 1); i < z; i++) {
        await film.seek(i / FPS);
        const buf = await b.capture({ format: 'png' });
        const img = decodePNG(buf);
        const rgb = img.rgb;
        if (keep) writeFileSync(join(keep, `${String(i).padStart(5, '0')}.png`), buf);
        if (i >= a) {
          let far = 0;   // blank: share of pixels far from the paper
          for (let p = 0; p < rgb.length; p += 3 * 7) { if (Math.abs(rgb[p] - paper[0]) + Math.abs(rgb[p + 1] - paper[1]) + Math.abs(rgb[p + 2] - paper[2]) > 24) far++; }
          blank[i - f0] = far / (rgb.length / (3 * 7));
          if (prev) mad[i - f0] = frameDiff(prev, rgb, img.width, img.height, 6).mad;
        }
        prev = rgb;
      }
    } finally { await b.close(); }
  }
  try {
    await Promise.all(Array.from({ length: W }, (_, k) => worker(k)));
    const sceneAt = (t) => meta.scenes.find((s) => t >= s.start && t < s.end) || meta.scenes.at(-1) || { id: '?', start: 0 };
    const at = (i) => { const t = (f0 + i) / FPS, s = sceneAt(t); return { frame: f0 + i, t: +t.toFixed(4), scene: s.id, local: +(t - s.start).toFixed(3) }; };
    const v = Array.from(mad, (x) => (Number.isNaN(x) ? null : x));
    const rm = rollingMedian(v, 12);
    const pops = [], flashes = [], holds = [], blanks = [];
    for (let i = 1; i < N - 1; i++) {
      if (v[i] == null) continue;
      const thr = Math.max(4 * rm[i], 2.2);
      if (v[i] > thr && (v[i - 1] ?? 0) < v[i] * 0.4 && (v[i + 1] ?? 0) < v[i] * 0.4) pops.push({ ...at(i), delta: +v[i].toFixed(2), median: +rm[i].toFixed(2) });
    }
    // flash: frame i differs from both neighbours, which agree with each other — two consecutive similar spikes around a quiet pair
    for (let i = 1; i < N - 2; i++) if (v[i] > 3 && v[i + 1] > 3 && Math.abs(v[i] - v[i + 1]) < 0.35 * v[i] && (v[i - 1] ?? 0) < 0.3 * v[i] && (v[i + 2] ?? 0) < 0.3 * v[i]) flashes.push({ ...at(i), delta: +v[i].toFixed(2) });
    let run = 0;
    for (let i = 0; i < N; i++) { if (v[i] != null && v[i] < 0.02) run++; else { if (run > HOLD_FRAMES) holds.push({ ...at(i - run), dur: +(run / FPS).toFixed(3) }); run = 0; } }
    if (run > HOLD_FRAMES) holds.push({ ...at(N - run), dur: +(run / FPS).toFixed(3) });
    let brun = 0;
    for (let i = 0; i < N; i++) { if (blank[i] < 0.004) brun++; else { if (brun >= 4) blanks.push({ ...at(i - brun), frames: brun }); brun = 0; } }
    if (brun >= 4) blanks.push({ ...at(N - brun), frames: brun });
    const res = { frames: N, fps: FPS, medianDelta: +(rm[Math.floor(N / 2)] || 0).toFixed(3), pops, flashes, holds, blanks, violations: meta.violations };
    if (keep) {
      const dir = resolve(sheets); mkdirSync(dir, { recursive: true });
      res.sheets = [];
      const want = [...pops.map((p) => ['pop', p.frame]), ...flashes.map((p) => ['flash', p.frame]), ...blanks.map((p) => ['blank', p.frame])].slice(0, 30);
      for (const [kind, fi] of want) {
        const images = [];
        for (let d = -4; d <= 4; d++) { const g = fi + d; if (g >= f0 && g < f1) images.push(join(keep, `${String(g).padStart(5, '0')}.png`)); }
        res.sheets.push(await contactSheet({ images, out: join(dir, `${kind}-${(fi / FPS).toFixed(3)}.jpg`), cols: 9, thumb: 320, chrome }));
      }
    }
    return res;
  } finally { if (keep) rmSync(keep, { recursive: true, force: true }); }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const A = parseArgs(process.argv.slice(2));
  const html = A.html ? resolve(A.html) : A.promo ? join(resolve(A.promo), 'film', 'index.html') : null;
  if (!html) { console.error('usage: fluency.mjs --promo <promoDir> | --html <film.html> [--from s --to s] [--workers n] [--scale 0.25] [--sheets DIR] [--json f]'); process.exit(1); }
  const t0 = Date.now();
  try {
    const r = await checkFluency({ html, scale: Number(A.scale || 0.25), workers: A.workers ? Number(A.workers) : undefined,
      from: Number(A.from || 0), to: A.to !== undefined ? Number(A.to) : undefined, sheets: A.sheets || null });
    const lab = (x) => `${x.t.toFixed(3)}s (${x.scene} +${x.local.toFixed(2)})`;
    console.log(`${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s · median Δ ${r.medianDelta}`);
    console.log(`POPS (${r.pops.length}):`); for (const p of r.pops) console.log(`  ${lab(p)}  Δ ${p.delta} vs ~${p.median}`);
    console.log(`FLASHES (${r.flashes.length}):`); for (const p of r.flashes) console.log(`  ${lab(p)}  Δ ${p.delta}`);
    console.log(`DEAD HOLDS > 1.2 s (${r.holds.length}):`); for (const p of r.holds) console.log(`  ${lab(p)}  ${p.dur} s`);
    console.log(`BLANK (paper only) ≥ 4 frames (${r.blanks.length}):`); for (const p of r.blanks) console.log(`  ${lab(p)}  ${p.frames} frames`);
    if (r.violations.length) console.log('VIOLATIONS:\n  ' + r.violations.join('\n  '));
    if (r.sheets) console.log(`sheets → ${A.sheets}`);
    if (A.json) writeFileSync(resolve(A.json), JSON.stringify(r, null, 1));
  } catch (e) { console.error(e.stack || e.message); process.exit(1); }
}
