// src/core/design/film-mp4.mjs
// A video exports as an MP4. The film is a pure function of its time (`F.seek(t)`, film.js), so the file is made frame
// by frame: headless Chromes open the capture page (the standalone film held still), seek to every frame and shoot it,
// and ffmpeg encodes the shots and muxes the sound. The sound is not recorded: it is mixed from the round's own files
// by the rule the player follows (`soundAt`, shared/sound-services.mjs), so the MP4 sounds as the film plays.
//
// A render takes about as long as the film runs, so it is a job, not a request: `createFilmExports` holds one job per
// design, renders one at a time, and keeps the finished file in `<design>/export/` under the key of the round it
// shows, so the same round downloads again at once and a new round renders anew. The render itself runs in a child
// process (film-mp4-cli.mjs): thousands of screenshots through the server's own event loop would stall every page.
//
// The capture page is the one doc whose own scripts run in a Chrome on the server (render.mjs `captureDoc`): what
// holds it is that Chrome, which resolves no host, reads no file and refuses every request but the page's own.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { findFfmpeg, toolHints } from '../../../assets/promo-kit/tools/find-tools.mjs';
import { exportStem } from '../../shared/design-names.mjs';
import { MUSIC_FADE_IN, MUSIC_FADE_OUT } from '../../shared/sound-services.mjs';
import { openArtifactUnder } from '../artifacts.mjs';
import { signalTree } from '../engines/spawn.mjs';
import { scrubbedEnv } from '../plugin-shim.mjs';
import { assembleDesign } from './assemble.mjs';
import { ExportRefusal, readExportPlan } from './export.mjs';
import { designDir, designWorkDir } from './paths.mjs';
import { captureDoc, designChrome } from './render.mjs';
import { SOUND_DIR, soundTracks } from './sound.mjs';

/** How a film is shot and encoded. A change here is a different file, so it is part of every job's key. */
export const FILM_MP4 = Object.freeze({ scale: 1, crf: 18, preset: 'veryfast', quality: 90 });
/** A Chrome that shoots frames holds about this much memory. */
const WORKER_BYTES = 1.5 * 1024 ** 3;
const MAX_WORKERS = 8;
/** What the child gets beyond `scrubbedEnv`: where temp files go, and CI's and a container's word that Chrome must
 *  run without its sandbox. No key and no worca setting. */
const CHILD_ENV = Object.freeze(['TMPDIR', 'CHROME_NO_SANDBOX']);
/** The mix's sample rate; the MP4's sound is encoded from it. */
const MIX_RATE = 48000;
const FILM_MP4_CLI = fileURLToPath(new URL('./film-mp4-cli.mjs', import.meta.url));
const NO_CHROME = 'Video needs Chrome or Edge on this machine. Install one, or set WORCA_CHROME.';
const noFfmpeg = () => `Video needs ffmpeg on this machine. ${toolHints().ffmpeg}.`;
const FAILED = 'Could not make the video.';
const PROBLEMS_SHOWN = 20;
const PROBLEM_REF_MAX = 200;
const STDERR_KEEP = 4096;
const RM = Object.freeze({ recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

function abortError() {
  const e = new Error('the video was stopped');
  e.name = 'AbortError';
  return e;
}

/** `<design>/export`: the kept film and its record, and a job's folder while it renders. Never in work/. */
export function filmExportDir(id) {
  return join(designDir(id), 'export');
}

/**
 * How many Chromes shoot a film at once: two cores stay free, each Chrome needs its memory, and never more than 8.
 * `WORCA_DESIGN_VIDEO_WORKERS` (a whole number from 1) sets it instead.
 * @param {{ cpus?: number, mem?: number, env?: Record<string, string|undefined> }} [opts]
 * @returns {number}
 */
export function filmWorkers({ cpus = availableParallelism(), mem = totalmem(), env = process.env } = {}) {
  const set = String(env.WORCA_DESIGN_VIDEO_WORKERS ?? '');
  if (/^[1-9]\d*$/.test(set)) return Number(set);
  return Math.max(1, Math.min(cpus - 2, Math.floor(mem / WORKER_BYTES), MAX_WORKERS));
}

/* ---------- the capture page ---------- */

/**
 * The exporter's handle, the page's last script: `window.__film`, which the promo kit's exporter waits for and seeks.
 * The film has already started (`F.start()` is the script before it). Every font the page declares is loaded and
 * every image decoded before the film is `ready`, so the first frame of a scene is drawn with its own type. A page
 * with no film to seek (no kit, or no scene with a duration) says `ready: false` at once.
 */
export const FILM_CAPTURE_SCRIPT = `(function () {
  var F = window.F;
  if (!F || !(F.DUR > 0)) { window.__film = { ready: false }; return; }
  var waits = [];
  try { document.fonts.forEach(function (face) { waits.push(face.load().catch(function () {})); }); } catch (e) { /* no font set */ }
  try { waits.push(document.fonts.ready); } catch (e) { /* no font set */ }
  [].forEach.call(document.images, function (img) { if (img.decode) waits.push(img.decode().catch(function () {})); });
  Promise.all(waits).then(function () {
    F.seek(0);
    window.__film = { ready: true, dur: F.DUR, fps: F.FPS, violations: F.violations, seek: function (t) { F.seek(t); return Promise.resolve(); } };
  });
})();`;

/**
 * A video's capture page: the standalone film (every local reference embedded) without its sound, embedded so film.js
 * adds no bar and plays nothing by itself, under the capture CSP, with the exporter's handle as its last script.
 * @param {{ workDir: string, plan: object }} opts
 * @returns {{ html: string, problems: { ref: string, why: string }[] }} `problems` is what the page had to leave out
 */
export function filmCaptureDoc({ workDir, plan }) {
  const page = assembleDesign({ workDir, plan, mode: 'standalone', kind: 'video', sound: false, embedded: true });
  return { html: captureDoc(page.html, { script: FILM_CAPTURE_SCRIPT }), problems: page.problems };
}

/** The film's length in seconds: every plan scene's duration, as film.js sums them. */
function filmSeconds(plan) {
  let sum = 0;
  for (const s of plan?.sections ?? []) if (Number.isFinite(s?.duration) && s.duration > 0) sum += s.duration;
  return sum;
}

/* ---------- the sound mix ---------- */

/** A number as ffmpeg reads it: at most a millisecond's precision, no exponent. */
const num = (x) => String(Number(Number(x).toFixed(3)));

/**
 * The ffmpeg arguments (after the binary) that mix a film's sound into one WAV at `out`, by the player's rule
 * (`soundAt`): each clip from its start for its own length; the music looped for the whole film at its gain, faded in
 * at the start and out before the end. A clip that would start at or after the film's end is left out.
 * @param {{ tracks: { clips: { file: string, start: number, seconds: number }[], music: { file: string, seconds: number, gain: number }|null }|null,
 *   dur: number, dir: string, out: string }} opts `dir` holds the tracks' files under their own names
 * @returns {string[]|null} null when nothing plays
 */
export function filmMixArgs({ tracks, dur, dir, out }) {
  const clips = (tracks?.clips ?? []).filter((c) => c.start < dur && c.seconds > 0);
  const music = tracks?.music ?? null;
  if (!clips.length && !music) return null;
  const inputs = [];
  const chains = [];
  const mixed = [];
  const head = (i) => `[${i}:a]aresample=${MIX_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  clips.forEach((c, i) => {
    inputs.push('-i', join(dir, c.file));
    chains.push(`${head(i)},atrim=0:${num(c.seconds)},asetpts=PTS-STARTPTS,adelay=${Math.round(c.start * 1000)}:all=1[c${i}]`);
    mixed.push(`[c${i}]`);
  });
  if (music) {
    inputs.push('-i', join(dir, music.file));
    chains.push(`${head(clips.length)},atrim=0:${num(music.seconds)},asetpts=PTS-STARTPTS,aloop=loop=-1:size=${Math.round(music.seconds * MIX_RATE)},`
      + `atrim=0:${num(dur)},volume=${num(music.gain)},afade=t=in:st=0:d=${num(MUSIC_FADE_IN)},`
      + `afade=t=out:st=${num(Math.max(0, dur - MUSIC_FADE_OUT))}:d=${num(MUSIC_FADE_OUT)}[m]`);
    mixed.push('[m]');
  }
  chains.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=longest,apad=whole_dur=${num(dur)},atrim=0:${num(dur)}[out]`);
  return [...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', '-ar', String(MIX_RATE), '-ac', '2', out];
}

/* ---------- one job's folder ---------- */

/**
 * Fills `dir` (empty, made by the caller) with what one render reads: `capture.html`, the sound's files in `sound/`
 * (read from work/ without following a link, as the sound route reads them) and `job.json` for the CLI. The key is a
 * hash of everything the file is made from: the capture page, the tracks, the sound's bytes and the settings.
 * @param {{ design: { id: string, kind: string }, dir: string }} opts
 * @returns {Promise<{ key: string, total: number, seconds: number, problems: { ref: string, why: string }[] }>}
 *   `total` is the frames the film holds
 * @throws {ExportRefusal} `not-done` for a missing or invalid plan
 */
export async function prepareFilmJob({ design, dir }) {
  const workDir = designWorkDir(design.id);
  const plan = readExportPlan(design);
  const { html, problems } = filmCaptureDoc({ workDir, plan });
  const seconds = filmSeconds(plan);
  const fps = plan.canvas.fps;
  const hash = createHash('sha256').update(JSON.stringify([1, FILM_MP4, seconds, fps])).update('\0').update(html);
  writeFileSync(join(dir, 'capture.html'), html);

  const tracks = soundTracks(workDir, plan);
  const files = tracks ? [...tracks.clips.map((c) => c.file), ...(tracks.music ? [tracks.music.file] : [])] : [];
  const mix = files.length ? filmMixArgs({ tracks, dur: seconds, dir: join(dir, 'sound'), out: join(dir, 'mix.wav') }) : null;
  if (mix) {
    mkdirSync(join(dir, 'sound'));
    hash.update('\0').update(JSON.stringify(tracks));
    for (const file of files) {
      const fh = await openArtifactUnder(workDir, `${SOUND_DIR}/${file}`);
      if (!fh) throw new Error(`the sound file ${file} is no longer there`);
      let bytes;
      try { bytes = await fh.readFile(); } finally { await fh.close(); }
      hash.update('\0').update(bytes);
      writeFileSync(join(dir, 'sound', file), bytes);
    }
  }
  const job = {
    v: 1, html: join(dir, 'capture.html'), out: join(dir, 'film.mp4'), audio: mix ? join(dir, 'mix.wav') : null, mix,
    workers: filmWorkers(), ...FILM_MP4,
  };
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job));
  return { key: hash.digest('hex'), total: Math.round(seconds * fps), seconds, problems };
}

/* ---------- the render: a child process ---------- */

const lastLine = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? '';

/**
 * Renders the job in `dir` to `<dir>/film.mp4` with film-mp4-cli.mjs as a child process, which reports on stdout as
 * JSON lines: `progress` (`done`, `total` frames), then `done` or `error`. An aborted `signal` closes the child's
 * stdin, which is its own stop (it closes its browsers and encoders and removes what it wrote); a child still there
 * after `graceMs`, or one that says nothing for `stallMs`, has its whole tree killed.
 * @param {{ dir: string, chrome: string, ffmpeg: string, signal?: AbortSignal|null,
 *   onProgress?: ((p: { done: number, total: number }) => void)|null, spawnImpl?: typeof spawn, stallMs?: number,
 *   graceMs?: number, kill?: typeof signalTree, env?: Record<string, string|undefined> }} opts `env` is the server's,
 *   of which the child gets `scrubbedEnv` and `CHILD_ENV` only
 * @returns {Promise<{ frames: number, seconds: number, bytes: number, violations: string[] }>} rejects with an
 *   `AbortError` after a stop, else with the child's own words
 */
export function renderFilmMp4({
  dir, chrome, ffmpeg, signal = null, onProgress = null, spawnImpl = spawn, stallMs = 120000, graceMs = 5000, kill = signalTree,
  env = process.env,
} = {}) {
  const childEnv = scrubbedEnv(process.platform, env);
  for (const name of CHILD_ENV) if (env[name]) childEnv[name] = env[name];
  return new Promise((resolve, reject) => {
    let child = null;
    let settled = false;
    let made = null;
    let said = '';
    let tail = '';
    let rest = '';
    let stalled = false;
    let stall = null;
    let grace = null;
    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(stall);
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value);
    };
    const watch = () => {
      clearTimeout(stall);
      stall = setTimeout(() => { stalled = true; kill(child, 'SIGKILL'); }, stallMs);
      stall.unref?.();
    };
    function onAbort() {
      clearTimeout(stall);
      try { child.stdin.end(); } catch { /* already closed */ }
      grace = setTimeout(() => kill(child, 'SIGKILL'), graceMs);
      grace.unref?.();
    }
    const onLine = (line) => {
      let msg = null;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg?.type === 'progress') {
        watch();
        onProgress?.({ done: Number(msg.done) || 0, total: Number(msg.total) || 0 });
      } else if (msg?.type === 'done') {
        made = {
          frames: Number(msg.frames) || 0, seconds: Number(msg.seconds) || 0, bytes: Number(msg.bytes) || 0,
          violations: Array.isArray(msg.violations) ? msg.violations.map(String) : [],
        };
      } else if (msg?.type === 'error') {
        said = String(msg.message ?? '');
      }
    };
    try {
      child = spawnImpl(process.execPath, [FILM_MP4_CLI, join(dir, 'job.json'), chrome, ffmpeg], {
        cwd: dir,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Its own process group, so a kill reaches its browsers and encoders. It still ends with the server: its stdin
        // closes when the server goes, and a closed stdin is its stop.
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      settle(e);
      return;
    }
    child.stdin?.on('error', () => { /* the child went first */ });
    const decoder = new StringDecoder('utf8');
    child.stdout?.on('data', (chunk) => {
      rest += decoder.write(chunk);
      const lines = rest.split('\n');
      rest = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line);
    });
    child.stderr?.on('data', (chunk) => { tail = (tail + chunk.toString('utf8')).slice(-STDERR_KEEP); });
    child.on('error', (e) => settle(signal?.aborted ? abortError() : e));
    child.on('close', (code) => {
      if (signal?.aborted) settle(abortError());
      else if (stalled) settle(new Error('the render stopped making progress'));
      else if (code === 0) settle(made ? null : new Error('the render ended without a video'), made);
      else settle(new Error(said || lastLine(tail) || `exit ${code}`));
    });
    watch();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* ---------- the export jobs ---------- */

/** What the dialog lists as left out of the file: the count, and the first few by name (as `encodeProblems` cuts). */
function shownProblems(problems) {
  const list = Array.isArray(problems) ? problems : [];
  return {
    total: list.length,
    shown: list.slice(0, PROBLEMS_SHOWN).map((p) => ({ ref: String(p?.ref ?? '').slice(0, PROBLEM_REF_MAX), why: String(p?.why ?? '') })),
  };
}

/** The kept film's record, when its file is there and is the size the record names; else null. */
function readKept(id) {
  try {
    const root = filmExportDir(id);
    const rec = JSON.parse(readFileSync(join(root, 'film.json'), 'utf8'));
    if (rec?.v !== 1 || typeof rec.key !== 'string' || statSync(join(root, 'film.mp4')).size !== rec.bytes) return null;
    return { key: rec.key, bytes: rec.bytes, frames: rec.frames, seconds: rec.seconds, problems: rec.problems };
  } catch {
    return null;
  }
}

/**
 * The MP4 export of every video: one job per design, `limit` renders at a time, the rest wait their turn.
 * - `start(design)` answers the job's status. The same round as the kept file is `ready` at once; the round a render
 *   already runs for joins it; any other round stops what runs and starts anew.
 * - `status(designId)` is `{state: 'none'}`, `{state: 'queued'|'rendering', done, total, key}`,
 *   `{state: 'ready', key, bytes, frames, seconds, problems}` or `{state: 'failed', error}`. It names no path.
 * - `stop(designId)` aborts a waiting or running job and forgets it; the kept file of an earlier round stays.
 * - `file(design, key)` is the kept film, only under the key of the round it shows.
 * - `forget(designId)` stops and waits until the design's folder is free (before the design is deleted).
 * - `idle()` resolves when no render is left running.
 * @param {{ render?: typeof renderFilmMp4, prepare?: typeof prepareFilmJob, chrome?: () => string|null,
 *   ffmpeg?: () => string|null, limit?: number }} [opts] seams for tests
 */
export function createFilmExports({ render = renderFilmMp4, prepare = prepareFilmJob, chrome = designChrome, ffmpeg = findFfmpeg, limit = 1 } = {}) {
  /** designId -> job: { id, state, key, done, total, dir, ac, chrome, ffmpeg, problems, run, bytes, frames, seconds, error } */
  const jobs = new Map();
  const waiting = [];
  const runs = new Set();
  /** The folders of starts still getting ready: no job owns them yet, and no other start may clear them. */
  const preparing = new Set();
  /** designId -> how many stops it has had: a start that finds the count moved while it got ready was stopped. */
  const stops = new Map();
  let active = 0;

  const view = (job) => {
    if (!job) return { state: 'none' };
    if (job.state === 'ready') return { state: 'ready', key: job.key, bytes: job.bytes, frames: job.frames, seconds: job.seconds, problems: job.problems };
    if (job.state === 'failed') return { state: 'failed', error: job.error };
    return { state: job.state, done: job.done, total: job.total, key: job.key };
  };
  const open = (job) => job?.state === 'queued' || job?.state === 'rendering';

  /** The finished job's file becomes the design's kept film. The record goes first and comes last: a crash in between
   *  leaves a film with no record, which is no film. */
  function keep(job, made) {
    const root = filmExportDir(job.id);
    rmSync(join(root, 'film.json'), { force: true });
    renameSync(join(job.dir, 'film.mp4'), join(root, 'film.mp4'));
    const rec = { v: 1, key: job.key, bytes: statSync(join(root, 'film.mp4')).size, frames: made.frames, seconds: made.seconds, problems: job.problems };
    const tmp = join(root, `film.json.tmp-${randomBytes(4).toString('hex')}`);
    writeFileSync(tmp, JSON.stringify(rec));
    renameSync(tmp, join(root, 'film.json'));
    return rec;
  }

  async function runJob(job) {
    try {
      const made = await render({
        dir: job.dir, chrome: job.chrome, ffmpeg: job.ffmpeg, signal: job.ac.signal,
        onProgress: ({ done, total }) => { job.done = done; if (total > 0) job.total = total; },
      });
      if (job.ac.signal.aborted) return;
      Object.assign(job, keep(job, made), { state: 'ready' });
    } catch (e) {
      if (job.ac.signal.aborted) return;
      // The child's words can name server paths: the log keeps them, the person gets a sentence.
      console.error(`[worca-design] video export of ${job.id} failed: ${e?.message ?? e}`);
      Object.assign(job, { state: 'failed', error: FAILED });
    } finally {
      try { rmSync(job.dir, RM); } catch (e) { console.error(`[worca-design] video export folder of ${job.id} not removed: ${e?.message ?? e}`); }
      active -= 1;
      pump();
    }
  }

  /** Starts as many waiting jobs as there are free turns. Synchronous up to each render's first await, so a job that
   *  starts at once is `rendering` before `start` answers. */
  function pump() {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active += 1;
      job.state = 'rendering';
      const run = runJob(job).finally(() => runs.delete(run));
      runs.add(run);
      job.run = run;
    }
  }

  /** The person's stop (and a delete's): what runs or waits is dropped, and a start still getting ready learns of it. */
  function stop(designId) {
    stops.set(designId, (stops.get(designId) ?? 0) + 1);
    drop(designId);
  }

  /** The design's job goes: a waiting one never renders, a rendering one is aborted. The kept file stays. */
  function drop(designId) {
    const job = jobs.get(designId);
    if (!job) return;
    jobs.delete(designId);
    if (!open(job)) return;
    job.ac.abort();
    const at = waiting.indexOf(job);
    if (at < 0) return;   // rendering: runJob removes its folder when the render has ended
    waiting.splice(at, 1);
    try { rmSync(job.dir, RM); } catch { /* cleared by the next start */ }
  }

  async function start(design) {
    const chromeBin = chrome();
    if (!chromeBin) throw new ExportRefusal(422, 'no-chrome', NO_CHROME);
    const ffmpegBin = ffmpeg();
    if (!ffmpegBin) throw new ExportRefusal(422, 'no-ffmpeg', noFfmpeg());
    const root = filmExportDir(design.id);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // What a dead server left: a job folder that no job and no start owns.
    const live = new Set([...[...jobs.values()].map((j) => j.dir), ...preparing]);
    for (const name of readdirSync(root)) {
      if (name.startsWith('job-') && !live.has(join(root, name))) rmSync(join(root, name), RM);
    }
    const dir = join(root, `job-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir);
    preparing.add(dir);
    const stopsBefore = stops.get(design.id) ?? 0;
    let prepared;
    try {
      prepared = await prepare({ design, dir });
    } catch (e) {
      rmSync(dir, RM);
      throw e;
    } finally {
      preparing.delete(dir);
    }
    // Stopped while it got ready (the dialog's Stop can come before this answer does): nothing starts.
    if ((stops.get(design.id) ?? 0) !== stopsBefore) {
      rmSync(dir, RM);
      return view(jobs.get(design.id));
    }
    const now = jobs.get(design.id);
    if (open(now) && now.key === prepared.key) {
      rmSync(dir, RM);
      return view(now);
    }
    const kept = readKept(design.id);
    if (kept?.key === prepared.key) {
      rmSync(dir, RM);
      drop(design.id);
      const ready = { id: design.id, state: 'ready', ...kept };
      jobs.set(design.id, ready);
      return view(ready);
    }
    drop(design.id);
    const job = {
      id: design.id, state: 'queued', key: prepared.key, done: 0, total: prepared.total, dir, ac: new AbortController(),
      chrome: chromeBin, ffmpeg: ffmpegBin, problems: shownProblems(prepared.problems), run: null,
    };
    jobs.set(design.id, job);
    waiting.push(job);
    pump();
    return view(job);
  }

  function file(design, key) {
    if (typeof key !== 'string' || !key) return null;
    const kept = readKept(design.id);
    if (kept?.key !== key) return null;
    return { path: join(filmExportDir(design.id), 'film.mp4'), bytes: kept.bytes, name: `${exportStem(design.title)}.mp4` };
  }

  async function forget(designId) {
    const run = jobs.get(designId)?.run;
    stop(designId);
    await run;
  }

  return {
    start, stop, file, forget,
    status: (designId) => view(jobs.get(designId)),
    idle: async () => { while (runs.size) await Promise.allSettled([...runs]); },
  };
}

/** The server's own: every route and the design's delete share it. */
export const filmExports = createFilmExports();
