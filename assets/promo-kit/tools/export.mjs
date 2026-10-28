#!/usr/bin/env node
// MP4 export of a promo film: frame i = film time i/60, captured deterministically (seek → decode → 2 rAF →
// screenshot) by N parallel headless Chromes, each piping JPEGs into its own x264 (identical settings), joined
// losslessly (concat demuxer) and muxed with the audio mix. Each worker renders a short run-up before its chunk
// (seek ≠ continuous playback for the compositor's raster history). --scale 2 renders 3840×2160 and downsamples
// to 1080p (lanczos): cleaner text and plate edges, and no 3D-raster aliasing (Chrome rasters at device scale).
//   node promo-kit/tools/export.mjs --promo <promoDir> [--out <promo>/video/promo-1080p60.mp4] [--audio <promo>/audio/mix.m4a | --no-audio]
//     [--scale 2] [--workers n] [--crf 14] [--preset slow] [--from 0 --to 30]
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openFilm, defaultWorkers, parseArgs } from './cdp.mjs';
import { readMP4 } from './analyze.mjs';
import { findFfmpeg, toolHints } from './find-tools.mjs';

const W = 1920, H = 1080;

function run(ffmpeg, args) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let e = ''; p.stderr.on('data', (d) => { e += d; });
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${args.slice(0, 4).join(' ')}…: ${e.slice(-500)}`))));
  });
}
/** concat-demuxer list line for a path on any OS (forward slashes, single quotes escaped). */
const concatLine = (p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;

/**
 * Render `html` (a film's index.html) to `out`.
 * @returns {Promise<{frames:number, expectedFrames:number, duration:number, bytes:number, out:string, violations:string[]}>}
 */
export async function exportFilm({ html, out, audio = null, scale = 2, workers, crf = 14, preset = 'slow', quality = 95, runup = 30,
  from = 0, to, chrome, ffmpeg, onProgress } = {}) {
  if (!html) throw new Error('exportFilm: html is required');
  if (!out) throw new Error('exportFilm: out is required');
  const FF = ffmpeg || findFfmpeg();
  if (!FF) throw new Error('no ffmpeg found: ' + toolHints().ffmpeg);
  if (audio && !existsSync(audio)) throw new Error(`exportFilm: audio ${audio} not found`);
  out = resolve(out);
  mkdirSync(dirname(out), { recursive: true });

  const probe = await launch({ scale: 0.25, chrome });
  let meta;
  try { await openFilm(probe, html); meta = await probe.evaluate('({dur: __film.dur, fps: __film.fps, violations: __film.violations})'); }
  finally { await probe.close(); }
  const FPS = meta.fps || 60;
  const end = Math.min(meta.dur, to ?? meta.dur);
  const f0 = Math.round(from * FPS), f1 = Math.round(end * FPS), N = f1 - f0;
  if (N <= 0) throw new Error(`exportFilm: nothing to render (${from}–${end} s)`);
  const nW = Math.max(1, Math.min(Number(workers) || await defaultWorkers(), Math.ceil(N / 30)));
  const chunk = Math.ceil(N / nW);
  const chunks = Array.from({ length: nW }, (_, k) => [f0 + k * chunk, Math.min(f1, f0 + (k + 1) * chunk)]).filter(([a, z]) => z > a);
  const tmp = mkdtempSync(join(tmpdir(), 'promo-export-'));
  const VF = [scale !== 1 ? `scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int` : null,
    'format=rgb24', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int', 'format=yuv420p'].filter(Boolean).join(',');
  const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  const done = new Array(chunks.length).fill(0);
  let lastTick = 0;
  const progress = (force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastTick < 500) return;
    lastTick = now;
    onProgress({ done: done.reduce((a, b) => a + b, 0), total: N });
  };

  async function worker(k, [a, z]) {
    const b = await launch({ scale, chrome });
    let ff = null;
    try {
      const film = await openFilm(b, html);
      for (let i = Math.max(0, a - runup); i < a; i++) await film.seek(i / FPS);   // run-up: compositor history
      const part = join(tmp, `part-${k}.mp4`);
      ff = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-vf', VF, '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
        ...TAGS, '-an', '-movflags', '+faststart', part], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      let err = ''; ff.stderr.on('data', (d) => { err += d; });
      ff.stdin.on('error', () => { /* EPIPE when x264 died: its exit code reports it */ });
      const closed = once(ff, 'close');
      closed.catch(() => { /* spawn error: surfaced by the await below */ });
      for (let i = a; i < z; i++) {
        await film.seek(i / FPS);
        const jpg = await b.capture({ format: 'jpeg', quality });
        if (ff.exitCode !== null) break;                                         // x264 died: report below
        if (!ff.stdin.write(jpg)) await Promise.race([once(ff.stdin, 'drain'), closed]);
        done[k]++; progress(false);
      }
      ff.stdin.end();
      const [code] = await closed;
      if (code !== 0) throw new Error(`ffmpeg worker ${k}: ${err.slice(-400)}`);
      return part;
    } finally {
      if (ff && ff.exitCode === null && ff.signalCode === null) { try { ff.stdin.destroy(); ff.kill('SIGKILL'); } catch { /* gone */ } }
      await b.close();
    }
  }

  try {
    const parts = await Promise.all(chunks.map((c, k) => worker(k, c)));
    progress(true);
    const list = join(tmp, 'parts.txt');
    writeFileSync(list, parts.map(concatLine).join('\n'));
    const video = join(tmp, 'video.mp4');
    await run(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video]);
    if (audio) {
      // the mix covers the whole film; cut it to the exported range
      await run(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-ss', String(f0 / FPS), '-t', String(N / FPS), '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
    } else {
      await run(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-c', 'copy', '-movflags', '+faststart', out]);
    }
    const m = readMP4(out);
    return { frames: m.samples, expectedFrames: N, duration: m.sttsDuration, bytes: statSync(out).size, out, violations: meta.violations };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const A = parseArgs(process.argv.slice(2));
  const promo = A.promo ? resolve(A.promo) : null;
  const html = A.html ? resolve(A.html) : promo ? join(promo, 'film', 'index.html') : null;
  if (!html) { console.error('usage: export.mjs --promo <promoDir> | --html <film.html> [--out f.mp4] [--audio f.m4a|--no-audio] [--scale 2] [--workers n] [--crf 14]'); process.exit(1); }
  const out = A.out ? resolve(A.out) : join(promo || dirname(dirname(html)), 'video', 'promo-1080p60.mp4');
  const dflt = promo ? join(promo, 'audio', 'mix.m4a') : null;
  const audio = A['no-audio'] ? null : A.audio ? resolve(A.audio) : dflt && existsSync(dflt) ? dflt : null;
  const t0 = Date.now();
  exportFilm({ html, out, audio, scale: Number(A.scale || 2), workers: A.workers ? Number(A.workers) : undefined, crf: Number(A.crf || 14),
    preset: A.preset || 'slow', from: Number(A.from || 0), to: A.to !== undefined ? Number(A.to) : undefined, ffmpeg: A.ffmpeg,
    onProgress: ({ done, total }) => { const el = (Date.now() - t0) / 1000; process.stdout.write(`\r  ${done}/${total} frames  ${(done / el).toFixed(1)} fps   `); } })
    .then((r) => {
      console.log(`\n${r.out}  ${(r.bytes / 1e6).toFixed(1)} MB  ${r.frames}/${r.expectedFrames} frames  ${r.duration.toFixed(3)} s  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      if (r.violations.length) console.warn('VIOLATIONS (rendered anyway):\n  ' + r.violations.join('\n  '));
      if (r.frames !== r.expectedFrames) process.exit(2);
    })
    .catch((e) => { console.error('\n' + (e.stack || e.message)); process.exit(1); });
}
