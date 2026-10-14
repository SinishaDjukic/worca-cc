#!/usr/bin/env node
// video.mjs — post-production for a recorded take: contact sheets, trimming, H.264 encoding, probing, and the check
// for the programs all of that needs. Runs on macOS, Linux and Windows with nothing but Node and an ffmpeg.
//
//   node video.mjs check                                    what this machine has; exit 1 when something is missing
//   node video.mjs sheets TAKE.webm OUTDIR [--every 2.5]    contact sheets (12 frames each, 3x4) for review
//   node video.mjs finish TAKE.webm OUTDIR NAME [--small-mb 9.5]
//                                                           trim the blank lead-in, then NAME.mp4 (full size) and
//                                                           NAME-small.mp4 (1600 wide, under --small-mb MB)
//   node video.mjs probe FILE.mp4                           duration, size, resolution
//
// The pipeline's script steps import the same functions, so the recorder's peek and the review's sheets are one code.
//
// Zooms: a take may have a sidecar `<take name>.zooms.json` — { version: 1, zooms: [{ kind, at, ms, hold?, end?,
// rect: {x, y, w, h}, scale?, why }] }. `live` zooms (harness.mjs) are already in the video; `post` zooms (written by
// hand for takes where the page cannot zoom itself: simulator, desktop recorder) are applied by `finish` as an eased
// crop + scale of the frames — softer than a live zoom, since pixels are upscaled. `sheets` adds one full-size frame
// from the middle of every zoom (zoomNN.png) for the review.
//
// Programs: any ffmpeg reads the take — the one on PATH, else the one Playwright downloads next to its browsers.
// Encoding H.264 needs an ffmpeg with libx264 on PATH (every OS); on macOS without one, Playwright's ffmpeg decodes
// to PNG frames and encode.swift (AVFoundation, needs swiftc from the Xcode command line tools) encodes them.
// Images are read and written here (PNG via node:zlib), so no Pillow, python or ImageMagick is involved.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 25;                     // Playwright records at 25 fps; frames are extracted at exactly this rate
const SHEET_COLS = 3, SHEET_ROWS = 4, CELL_W = 640, CELL_H = 360;

// ── programs ────────────────────────────────────────────────────────────────

/** Absolute path of `name` on PATH (PATHEXT on Windows), or null. */
export function which(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try { if (statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${basename(exe)}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${basename(exe)} ${args.slice(0, 3).join(' ')}… exited ${r.status}: ${String(r.stderr || '').trim().slice(-1500)}`);
  return r.stdout;
}

/** The ffmpeg on PATH when it can encode H.264 (libx264), else null. */
export function x264Ffmpeg() {
  const exe = which('ffmpeg');
  if (!exe) return null;
  const r = spawnSync(exe, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return !r.error && /\blibx264\b/.test(r.stdout || '') ? exe : null;
}

/** Where Playwright keeps its downloads on this OS (PLAYWRIGHT_BROWSERS_PATH wins). */
export function playwrightCacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright');
}

/** Playwright's own ffmpeg builds (decode the take, write PNG; cannot encode H.264), newest revision first. Each
 *  revision decodes only the codec its recorder writes (1011: VP8, 1013: VP9), so all of them are candidates. */
export function playwrightFfmpegs() {
  const base = playwrightCacheDir();
  let dirs = [];
  try { dirs = readdirSync(base).filter((d) => /^ffmpeg-\d+$/.test(d)); } catch { return []; }
  dirs.sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
  const out = [];
  for (const d of dirs) {
    const p = ['ffmpeg-mac', 'ffmpeg-linux', 'ffmpeg-win64.exe', 'ffmpeg.exe', 'ffmpeg'].map((n) => join(base, d, n)).find((x) => existsSync(x));
    if (p) out.push(p);
  }
  return out;
}

/** Every ffmpeg that may read the take, best first: the one on PATH, then Playwright's builds. */
export function decoders() {
  return [which('ffmpeg'), ...playwrightFfmpegs()].filter(Boolean);
}

/** How this machine encodes H.264: { kind: 'ffmpeg', path } | { kind: 'avfoundation', path } | null. */
export function h264Encoder() {
  const ff = x264Ffmpeg();
  if (ff) return { kind: 'ffmpeg', path: ff };
  const swiftc = process.platform === 'darwin' ? which('swiftc') : null;
  return swiftc ? { kind: 'avfoundation', path: swiftc } : null;
}

const INSTALL_FFMPEG = {
  darwin: 'brew install ffmpeg',
  linux: 'install ffmpeg from your distribution (apt install ffmpeg, dnf install ffmpeg, …)',
  win32: 'winget install Gyan.FFmpeg (then open a new terminal so PATH has it)',
};

const encoderHint = () => (INSTALL_FFMPEG[process.platform] || INSTALL_FFMPEG.linux)
  + (process.platform === 'darwin' ? ', or install the Xcode command line tools (xcode-select --install)' : '');

/**
 * Everything the pipeline needs, checked up front: Playwright, a browser it can drive, a decoder for the take and
 * an H.264 encoder. `missing` lists what is absent with the command that fixes it; empty means ready.
 * @param {{launch?: boolean}} [o] launch: start the browser headless once to prove it works (default true)
 */
export async function checkTools({ launch = true } = {}) {
  const { findPlaywright } = await import('./find-playwright.mjs');
  const out = { platform: process.platform, node: process.version, playwright: null, browser: null, decoder: null, encoder: null,
    simulators: { ios: process.platform === 'darwin' && Boolean(which('xcrun')), android: Boolean(which('adb')) }, missing: [] };
  out.playwright = findPlaywright();
  if (!out.playwright) out.missing.push({ what: 'Playwright (playwright-core)', hint: 'npx -y playwright@latest --version' });
  else if (launch) {
    try {
      const { chromium } = await import(pathToFileURL(out.playwright).href);
      const { launchBrowser } = await import('./harness.mjs');
      const { browser, kind } = await launchBrowser(chromium);
      await browser.close();
      out.browser = kind;
    } catch (err) {
      out.missing.push({ what: 'a browser Playwright can start', hint: `install Google Chrome, or run: npx -y playwright@latest install chromium (${String(err.message || err).split('\n')[0]})` });
    }
  }
  out.decoder = decoders()[0] || null;
  if (!out.decoder) out.missing.push({ what: 'ffmpeg (to read the take)', hint: `${INSTALL_FFMPEG[process.platform] || INSTALL_FFMPEG.linux}, or: npx -y playwright@latest install ffmpeg` });
  const enc = h264Encoder();
  out.encoder = enc ? enc.kind : null;
  if (!enc) out.missing.push({ what: 'an H.264 encoder: ffmpeg with libx264' + (process.platform === 'darwin' ? ', or swiftc' : ''), hint: encoderHint() });
  return out;
}

// ── PNG (8-bit, non-interlaced: what ffmpeg writes) ─────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** @returns {{width:number, height:number, channels:number, data:Buffer}} unfiltered pixel rows */
export function readPng(file) {
  const buf = readFileSync(file);
  let width = 0, height = 0, channels = 0;
  const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`${file}: only 8-bit non-interlaced PNG is supported`);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[body[9]];
      if (!channels) throw new Error(`${file}: unsupported PNG colour type ${body[9]}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels, data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels] : 0, b = y ? data[prev + x] : 0, c = y && x >= channels ? data[prev + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      data[row + x] = v & 0xff;
    }
  }
  return { width, height, channels, data };
}

export function writeRgbPng(file, width, height, rgb) {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, body) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ── take → frames ───────────────────────────────────────────────────────────


/** Run `args` with the first ffmpeg that can decode `take`; `cleanup` empties a failed attempt's output. */
function decodeWith(take, args, cleanup) {
  const exes = decoders();
  if (!exes.length) throw new Error(`no ffmpeg found (PATH or the Playwright cache) — cannot read the take. ${INSTALL_FFMPEG[process.platform] || INSTALL_FFMPEG.linux}`);
  const errors = [];
  for (const exe of exes) {
    try { run(exe, args); return; } catch (err) { errors.push(err.message); cleanup(); }
  }
  throw new Error(`no ffmpeg here can decode ${basename(take)}:\n${errors.join('\n')}`);
}

/** Decode `take` into `<dir>/f%05d.png`; `rate` frames per second (default FPS), optional scale and pixel format. */
function extract(take, dir, { rate = FPS, scale = null, pixFmt = 'rgb24' } = {}) {
  mkdirSync(dir, { recursive: true });
  const args = ['-hide_banner', '-loglevel', 'error', '-i', take, '-r', String(rate)];
  if (scale) args.push('-vf', `scale=${scale}`);
  decodeWith(take, [...args, '-pix_fmt', pixFmt, join(dir, 'f%05d.png')], () => { for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true }); });
  return readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort().map((f) => join(dir, f));
}

const withTmp = (prefix, fn) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// ── zooms ───────────────────────────────────────────────────────────────────

/** The zoom sidecar of a take (`<name>.zooms.json` next to it): its valid entries, sorted by time. */
export function readZooms(take) {
  const file = join(dirname(take), `${basename(take).replace(/\.[^.]+$/, '')}.zooms.json`);
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  return (Array.isArray(raw?.zooms) ? raw.zooms : [])
    .filter((z) => z && (z.kind === 'live' || z.kind === 'post') && num(z.at) && z.rect && ['x', 'y', 'w', 'h'].every((k) => num(z.rect[k])) && z.rect.w > 0 && z.rect.h > 0)
    .map((z) => ({ ...z, ms: num(z.ms) ? z.ms : 650, hold: num(z.hold) ? z.hold : 1800 }))
    .sort((a, b) => a.at - b.at);
}

/** Seconds into the take where zoom `z` is fully in and holding (the middle of the hold). */
export function zoomMidpoint(z) {
  const inEnd = z.at + z.ms / 1000;
  const outStart = z.kind === 'live' && typeof z.end === 'number' ? z.end - z.ms / 1000 : inEnd + z.hold / 1000;
  return (inEnd + Math.max(inEnd, outStart)) / 2;
}

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** The crop rect of a post zoom at take time `t` in a W×H frame, or null when `z` is not on screen then. */
export function postZoomRect(z, t, W, H) {
  const a = z.at, inEnd = a + z.ms / 1000, outStart = inEnd + z.hold / 1000, b = outStart + z.ms / 1000;
  if (t < a || t > b) return null;
  const p = t < inEnd ? easeInOut((t - a) / (inEnd - a)) : t <= outStart ? 1 : easeInOut(1 - (t - outStart) / (b - outStart));
  const pad = 56;
  const s = z.scale || Math.min(2.5, Math.max(1.4, Math.min(W / (z.rect.w + 2 * pad), H / (z.rect.h + 2 * pad))));
  const w = W / s, h = H / s;
  const x = Math.min(W - w, Math.max(0, z.rect.x + z.rect.w / 2 - w / 2)), y = Math.min(H - h, Math.max(0, z.rect.y + z.rect.h / 2 - h / 2));
  return { x: x * p, y: y * p, w: W + (w - W) * p, h: H + (h - H) * p };
}

/** Bilinear crop of `img` (readPng) to rect, scaled to W×H; returns an RGB buffer. */
export function cropScale(img, rect, W, H) {
  const out = Buffer.alloc(W * H * 3), c = img.channels, iw = img.width, ih = img.height, d = img.data;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(ih - 1, Math.max(0, rect.y + ((y + 0.5) * rect.h) / H - 0.5)), y0 = Math.floor(sy), y1 = Math.min(ih - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(iw - 1, Math.max(0, rect.x + ((x + 0.5) * rect.w) / W - 0.5)), x0 = Math.floor(sx), x1 = Math.min(iw - 1, x0 + 1), fx = sx - x0;
      for (let k = 0; k < 3; k++) {
        const kk = c >= 3 ? k : 0;
        const v = (d[(y0 * iw + x0) * c + kk] * (1 - fx) + d[(y0 * iw + x1) * c + kk] * fx) * (1 - fy)
          + (d[(y1 * iw + x0) * c + kk] * (1 - fx) + d[(y1 * iw + x1) * c + kk] * fx) * fy;
        out[(y * W + x) * 3 + k] = v + 0.5;
      }
    }
  }
  return out;
}

/** One full-size frame from the middle of each zoom (post zooms rendered as `finish` will), as outdir/zoomNN.png. */
export function zoomFrames(take, outdir) {
  const out = [];
  readZooms(take).forEach((z, i) => {
    const t = zoomMidpoint(z), p = join(outdir, `zoom${String(i).padStart(2, '0')}.png`);
    decodeWith(take, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', take, '-frames:v', '1', '-pix_fmt', 'rgb24', p], () => rmSync(p, { force: true }));
    if (z.kind === 'post') { const img = readPng(p); writeRgbPng(p, img.width, img.height, cropScale(img, postZoomRect(z, t, img.width, img.height), img.width, img.height)); }
    out.push({ path: p, kind: z.kind, at: Math.round(t * 10) / 10, why: z.why || '' });
  });
  return out;
}

/** Frames at FPS and the index of the first one that is not a blank page (near-uniform grey). */
export function scanTake(take) {
  return withTmp('pv-scan-', (dir) => {
    const frames = extract(take, dir, { scale: '160:90', pixFmt: 'gray' });
    let start = 0;
    for (let i = 0; i < Math.min(frames.length, 300); i++) {
      const { data } = readPng(frames[i]);
      let sum = 0, sq = 0;
      for (const v of data) { sum += v; sq += v * v; }
      const mean = sum / data.length;
      if (Math.sqrt(Math.max(0, sq / data.length - mean * mean)) > 1.5) { start = i; break; }
    }
    return { frames: frames.length, start, seconds: Math.round(((frames.length - start) / FPS) * 10) / 10 };
  });
}

/** Contact sheets for review: one frame every `every` seconds, 12 to a sheet. Replaces any sheet*.png in outdir. */
export function sheets(take, outdir, { every = 2.5 } = {}) {
  if (!existsSync(take) || !statSync(take).size) throw new Error(`no take at ${take}`);
  mkdirSync(outdir, { recursive: true });
  for (const f of readdirSync(outdir)) if (/^(sheet|zoom)\d+\.png$/.test(f)) rmSync(join(outdir, f));
  return withTmp('pv-sheet-', (dir) => {
    const frames = extract(take, dir, { rate: 1 / every, scale: `${CELL_W}:${CELL_H}` });
    const W = CELL_W * SHEET_COLS, H = CELL_H * SHEET_ROWS, per = SHEET_COLS * SHEET_ROWS, out = [];
    for (let k = 0; k < frames.length; k += per) {
      const sheet = Buffer.alloc(W * H * 3, 0xff);
      frames.slice(k, k + per).forEach((f, i) => {
        const img = readPng(f), ox = (i % SHEET_COLS) * CELL_W, oy = Math.floor(i / SHEET_COLS) * CELL_H;
        for (let y = 0; y < Math.min(img.height, CELL_H); y++) {
          for (let x = 0; x < Math.min(img.width, CELL_W); x++) {
            const s = (y * img.width + x) * img.channels, d = ((oy + y) * W + ox + x) * 3;
            if (img.channels >= 3) { sheet[d] = img.data[s]; sheet[d + 1] = img.data[s + 1]; sheet[d + 2] = img.data[s + 2]; }
            else sheet[d] = sheet[d + 1] = sheet[d + 2] = img.data[s];
          }
        }
      });
      const p = join(outdir, `sheet${String(k / per).padStart(2, '0')}.png`);
      writeRgbPng(p, W, H, sheet);
      out.push(p);
    }
    return { sheets: out, frames: frames.length, everySeconds: every, zooms: zoomFrames(take, outdir) };
  });
}

/**
 * The take a recording-notes file names (`video-takes/<file>.webm|.mp4`, the first mention), resolved under
 * pipelineDir; the newest file in video-takes/ when the notes name none. `{ error }` when there is no usable take.
 */
export function takeFromNotes(notesPath, pipelineDir) {
  let text = '';
  try { text = notesPath ? readFileSync(notesPath, 'utf8') : ''; } catch { /* no notes: fall back to the newest take */ }
  const dir = join(pipelineDir, 'video-takes');
  const listed = (() => { try { return readdirSync(dir).filter((f) => /\.(webm|mp4)$/i.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })); } catch { return []; } })()
    .sort((a, b) => b.t - a.t);
  const m = text.match(/video-takes[\\/]([^\s`'"()[\]<>|*]+\.(?:webm|mp4))/i);
  const name = m ? m[1] : listed[0]?.f;
  if (!name) return { error: 'the recording notes name no take and video-takes/ holds none' };
  const path = join(dir, name);
  if (!existsSync(path)) return { error: `video-takes/${name} (named in the recording notes) does not exist` };
  const st = statSync(path);
  if (!st.size) return { error: `video-takes/${name} is empty` };
  return { path, rel: `video-takes/${name}`, bytes: st.size, modified: new Date(st.mtimeMs).toISOString(), named: Boolean(m),
    newest: listed[0]?.f === name, newer: listed.filter((x) => x.t > st.mtimeMs).map((x) => `video-takes/${x.f}`) };
}

// ── encode ──────────────────────────────────────────────────────────────────

function encodeSwift(swiftc, framesDir, start, out, width, bitrate) {
  const bin = join(tmpdir(), 'pv-encode');
  const src = join(HERE, 'encode.swift');
  if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs) run(swiftc, ['-O', src, '-o', bin]);
  const said = run(bin, [framesDir, out, String(start), String(width), String(bitrate)]).trim();
  if (!said.startsWith('ok')) throw new Error(`encode.swift: ${said}`);
}

/**
 * Trim the blank lead-in and write `<name>.mp4` (native width, H.264) and `<name>-small.mp4` (≤ 1600 wide, under
 * smallMb MB). The small copy is re-encoded at a lower bitrate up to twice when it lands over the cap.
 */
export function finish(take, outdir, name, { smallMb = 9.5 } = {}) {
  if (!existsSync(take) || !statSync(take).size) throw new Error(`no take at ${take}`);
  const enc = h264Encoder();
  if (!enc) throw new Error(`no H.264 encoder: ${encoderHint()}. The .webm take itself is still a valid deliverable.`);
  mkdirSync(outdir, { recursive: true });
  const full = join(outdir, `${name}.mp4`), small = join(outdir, `${name}-small.mp4`);
  const scan = scanTake(take);
  const cap = smallMb * 1024 * 1024;
  let rate = Math.floor((cap * 8 * 0.92) / Math.max(scan.seconds, 1));   // 92 % of the budget, no audio
  const ss = (scan.start / FPS).toFixed(2);
  const ffArgs = (extra, out) => ['-y', '-hide_banner', '-loglevel', 'error', '-ss', ss, '-i', take, ...extra, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
  const smallArgs = () => ffArgs(['-vf', "scale='min(1600,iw)':-2", '-b:v', String(rate), '-maxrate', String(rate), '-bufsize', String(rate * 2)], small);
  const post = readZooms(take).filter((z) => z.kind === 'post');
  if (post.length) {
    // Post zooms: decode every frame, crop + scale the zoomed ones in place, encode the PNG sequence.
    withTmp('pv-zoom-', (dir) => {
      const frames = extract(take, dir);
      const first = readPng(frames[0]), W = first.width, H = first.height;
      frames.forEach((f, i) => {
        const r = post.map((z) => postZoomRect(z, i / FPS, W, H)).find(Boolean);
        if (r) writeRgbPng(f, W, H, cropScale(readPng(f), r, W, H));
      });
      if (enc.kind === 'ffmpeg') {
        const seq = (extra, out) => ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-start_number', String(scan.start + 1), '-i', join(dir, 'f%05d.png'), ...extra, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
        const smallSeq = () => seq(['-vf', "scale='min(1600,iw)':-2", '-b:v', String(rate), '-maxrate', String(rate), '-bufsize', String(rate * 2)], small);
        run(enc.path, seq(['-crf', '20', '-preset', 'slow'], full));
        run(enc.path, smallSeq());
        for (let i = 0; i < 2 && statSync(small).size > cap; i++) { rate = Math.floor(rate * 0.85); run(enc.path, smallSeq()); }
      } else {
        encodeSwift(enc.path, dir, scan.start, full, W, W >= 1600 ? 4_000_000 : 2_500_000);
        encodeSwift(enc.path, dir, scan.start, small, Math.min(1600, W), rate);
        for (let i = 0; i < 2 && statSync(small).size > cap; i++) { rate = Math.floor(rate * 0.85); encodeSwift(enc.path, dir, scan.start, small, Math.min(1600, W), rate); }
      }
    });
  } else if (enc.kind === 'ffmpeg') {
    run(enc.path, ffArgs(['-crf', '20', '-preset', 'slow'], full));
    run(enc.path, smallArgs());
    for (let i = 0; i < 2 && statSync(small).size > cap; i++) { rate = Math.floor(rate * 0.85); run(enc.path, smallArgs()); }
  } else {
    withTmp('pv-frames-', (dir) => {
      const frames = extract(take, dir);
      const width = readPng(frames[0]).width;
      encodeSwift(enc.path, dir, scan.start, full, width, width >= 1600 ? 4_000_000 : 2_500_000);
      encodeSwift(enc.path, dir, scan.start, small, Math.min(1600, width), rate);
      for (let i = 0; i < 2 && statSync(small).size > cap; i++) { rate = Math.floor(rate * 0.85); encodeSwift(enc.path, dir, scan.start, small, Math.min(1600, width), rate); }
    });
  }
  return {
    encoder: enc.kind, trimmedFrames: scan.start, seconds: scan.seconds, postZooms: post.length,
    full: { path: full, ...probe(full) }, small: { path: small, ...probe(small) },
    smallUnderCap: statSync(small).size <= cap, smallMb,
  };
}

// ── probe (MP4 boxes: moov/mvhd for duration, trak/tkhd for size) ──────────

export function probe(file) {
  const buf = readFileSync(file);
  const res = { bytes: buf.length, seconds: null, width: null, height: null };
  const walk = (start, end) => {
    for (let o = start; o + 8 <= end;) {
      let size = buf.readUInt32BE(o), head = 8;
      const type = buf.toString('latin1', o + 4, o + 8);
      if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); head = 16; } else if (size === 0) size = end - o;
      if (size < head) return;
      const body = o + head;
      if (type === 'moov' || type === 'trak') walk(body, o + size);
      else if (type === 'mvhd') {
        const v1 = buf[body] === 1;
        const scale = buf.readUInt32BE(body + (v1 ? 20 : 12));
        const dur = v1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        if (scale) res.seconds = Math.round((dur / scale) * 10) / 10;
      } else if (type === 'tkhd' && !res.width) {
        const w = buf.readUInt32BE(o + size - 8) / 65536, h = buf.readUInt32BE(o + size - 4) / 65536;
        if (w && h) { res.width = w; res.height = h; }
      }
      o += size;
    }
  };
  walk(0, buf.length);
  return res;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (n, d) => { const i = rest.indexOf(n); if (i < 0) return d; const v = Number(rest[i + 1]); rest.splice(i, 2); return v; };
  const say = (o) => console.log(JSON.stringify(o, null, 2));
  if (cmd === 'check') { const r = await checkTools(); say(r); return r.missing.length ? 1 : 0; }
  if (cmd === 'sheets') { const every = flag('--every', 2.5); say(sheets(rest[0], rest[1], { every })); return 0; }
  if (cmd === 'finish') { const smallMb = flag('--small-mb', 9.5); say(finish(rest[0], rest[1], rest[2], { smallMb })); return 0; }
  if (cmd === 'probe') { say(probe(rest[0])); return 0; }
  console.error('usage: node video.mjs check | sheets TAKE OUTDIR [--every 2.5] | finish TAKE OUTDIR NAME [--small-mb 9.5] | probe FILE.mp4');
  return 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(String(err.message || err)); process.exit(1); });
}
