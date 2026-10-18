// scripts/promo-render.mjs — the `promoRender` card: the reviewed film becomes the deliverables,
// video/promo-1080p60.mp4, video/promo.en.srt and video/youtube.md (indexed as run artifacts).
//
//   1. the film (promo/film/index.html) and the timeline must exist — else a critical finding;
//   2. Chrome and ffmpeg are looked up (kit find-tools) — a missing one is a critical finding with
//      the install hint for the host OS (the run preflight refuses earlier; this is the backstop);
//   3. film/data.js is rebuilt from the latest timeline and plates (kit build-data);
//   4. narrated films: the SFX cues are dumped from the film (kit snap), thinned (kit thin-cues)
//      and mixed with the voice and music (kit mix: per-line levelling, ducking, −14 LUFS master,
//      −1 dBTP). The mix's VOICE CHECK gates the export: a buried line is a blocking finding that
//      names it, so the scene builder can pull the effects down there;
//   5. the export (kit export: headless Chrome frames + ffmpeg, 1080p60, scale 2, up to 8 workers)
//      muxes the mix when there is one; the frame count and duration are verified;
//   6. captions (kit srt) and the YouTube title, description and chapters are written.
// Outputs: `video` md always (this report), `findings` md on a blocking verdict (the same file),
// `pass` on a clean one. No network, no key.
import { availableParallelism, cpus as osCpus } from 'node:os';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promoPaths, readJson, writeText, writeReport, loadKitTool } from './promo-common.mjs';

export const VIDEO_FILE = 'promo-1080p60.mp4';
export const SRT_FILE = 'promo.en.srt';
export const YOUTUBE_FILE = 'youtube.md';
const FPS = 60;
const MAX_WORKERS = 8;
/** YouTube chapters: at least three, each at least ten seconds, the first at 0:00. */
const CHAPTER_MIN_SEC = 10;
const CHAPTER_MIN_COUNT = 3;

const TOOL_MODULE = Object.freeze({
  findChrome: 'find-tools', findFfmpeg: 'find-tools', toolHints: 'find-tools', buildData: 'build-data',
  dumpCues: 'snap', thinCues: 'thin-cues', mixAudio: 'mix', exportFilm: 'export', buildSrt: 'srt',
});

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const msg = (e) => String(e?.message || e || 'failed').split('\n').slice(0, 6).join('\n');
const secs = (s) => `${(Math.round(s * 10) / 10).toFixed(1)} s`;

// ── youtube.md ──────────────────────────────────────────────────────────────────

/** `m:ss`, or `h:mm:ss` from an hour on (YouTube's chapter stamp). */
export function stamp(t) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The one automatic remix after a failed voice check: the SFX bus ducks this much under speech (kit default −10 dB). */
const RETRY_LEVELS = Object.freeze({ sfx_under_vo: -18 });
const DEFAULT_SFX_UNDER_VO = -10;

/** Chapters from the timeline's chapter scenes, by YouTube's rules — `[]` when they cannot be met. Pure. */
export function youtubeChapters(timeline) {
  const scenes = Array.isArray(timeline?.scenes) ? timeline.scenes : [];
  const end = Number.isFinite(timeline?.duration) ? timeline.duration : (scenes.length ? scenes[scenes.length - 1].end : 0);
  const raw = scenes.filter((s) => isObject(s.chapter)).map((s) => ({
    t: Number(s.start) || 0, title: String(s.chapter.title || '').trim() || `Chapter ${String(s.chapter.num || '').trim()}`.trim(),
  })).sort((a, b) => a.t - b.t);
  if (!raw.length) return [];
  if (raw[0].t > 0) {
    if (raw[0].t < CHAPTER_MIN_SEC) raw[0].t = 0; else raw.unshift({ t: 0, title: 'Intro' });
  }
  const kept = [];
  for (const c of raw) if (!kept.length || c.t - kept[kept.length - 1].t >= CHAPTER_MIN_SEC) kept.push(c);
  while (kept.length && end - kept[kept.length - 1].t < CHAPTER_MIN_SEC) kept.pop();
  return kept.length >= CHAPTER_MIN_COUNT ? kept : [];
}

/** The first prose paragraph of a markdown file (headings, quotes, lists, tables and code skipped). Pure. */
export function firstParagraph(md) {
  const blocks = String(md || '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split(/\n\s*\n/);
  let fenced = false;
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const fences = lines.filter((l) => l.startsWith('```')).length;
    if (fenced || fences) { if (fences % 2) fenced = !fenced; continue; }
    if (/^(#|>|[-*+] |\d+[.)] |\||!\[|<)/.test(lines[0])) continue;
    return lines.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/**
 * The YouTube description. Pure. The explorer's product.md leads with labelled lines (`One-liner: "…" — source refs`)
 * and tables, so the first prose paragraph is often empty: lead with the quoted one-liner, then the film's opening
 * narration (first three lines); a product.md with a plain first paragraph falls back to that.
 */
export function youtubeDescription({ product = '', script = null } = {}) {
  const one = /^\s*One-liner:\s*["“]([^"”\n]+)["”]/mi.exec(String(product || ''));
  const lines = (Array.isArray(script?.lines) ? script.lines : []).map((l) => String(l?.text || '').trim()).filter(Boolean).slice(0, 3);
  const lead = one ? one[1].trim().replace(/[.!?]*$/, '.') : '';
  if (lead || lines.length) return [lead, lines.join(' ')].filter(Boolean).join('\n\n');
  return firstParagraph(product);
}

/** video/youtube.md. Pure. */
export function youtubeMarkdown({ title, description, chapters, files }) {
  const L = ['# YouTube', '', '## Title', '', title || 'Promo video', '', '## Description', ''];
  if (description) L.push(description, '');
  if (chapters.length) L.push(...chapters.map((c) => `${stamp(c.t)} ${c.title}`), '');
  if (files.length) L.push('## Files', '', ...files.map((f) => `- ${f}`), '');
  return L.join('\n');
}

// ── the card ──────────────────────────────────────────────────────────────────

function issue(severity, title, detail, location = '') {
  return { severity, title, detail, location };
}

function reportText({ issues, timeline, result, mix, srt, workers, ms, violations, mixRetry = false }) {
  const L = ['# Promo video', ''];
  const blocking = issues.filter((i) => i.severity === 'critical' || i.severity === 'major');
  if (result && !blocking.length) {
    const mb = (result.bytes / (1024 * 1024)).toFixed(1);
    L.push(`Rendered \`video/${VIDEO_FILE}\` — 1080p, ${FPS} fps, ${secs(result.duration)} (${result.frames} frames), ${mb} MB, ${timeline.narrated ? 'narrated' : 'silent'}.`);
    L.push(`${srt ? `Captions: \`video/${SRT_FILE}\` · ` : ''}YouTube title, description and chapters: \`video/${YOUTUBE_FILE}\`.`);
  } else {
    L.push(`Not rendered: ${blocking[0]?.title || 'see the findings'}.`);
  }
  if (mix) {
    const n = Array.isArray(mix.voiceCheck?.lines) ? mix.voiceCheck.lines.length : 0;
    const failed = n ? mix.voiceCheck.lines.filter((l) => !l.ok).length : 0;
    L.push(`Mix: ${Number(mix.lufs).toFixed(1)} LUFS integrated, ${Number(mix.tp).toFixed(1)} dBTP true peak; `
      + (mix.voiceCheck?.ok ? `voice check passed on all ${n} line(s).` : `voice check FAILED on ${failed} of ${n} line(s).`));
    if (mixRetry) L.push(`The first mix failed the voice check, so the effects were remixed ducked harder under speech (${RETRY_LEVELS.sfx_under_vo} dB, was ${DEFAULT_SFX_UNDER_VO} dB) — ducked the effects harder${mix.voiceCheck?.ok ? ' and it passed' : ', and it still fails'}.`);
    if (n) {
      L.push('', '| Line | Voice over the bed (median) | Speech frames under 6 dB | OK |', '|---|---|---|---|');
      for (const l of mix.voiceCheck.lines) L.push(`| ${l.id} | ${Number(l.median).toFixed(1)} dB | ${Math.round((Number(l.lowShare) || 0) * 100)} % | ${l.ok ? 'yes' : 'no'} |`);
    }
  }
  if (result) L.push('', `Export: ${workers} worker(s), ${Math.round(ms / 1000)} s.`);
  if (violations?.length) L.push('', '## Kit warnings', '', ...violations.slice(0, 40).map((v) => `- ${v}`));
  if (issues.length) {
    L.push('', '## Findings', '');
    for (const i of issues) L.push(`- **${i.severity}** — ${i.title}${i.location ? ` (\`${i.location}\`)` : ''}: ${i.detail}`);
  }
  return L.join('\n') + '\n';
}

/**
 * @param {object} api the node harness api
 * @param {{tools?:object, loadTool?:Function, platform?:string, cpus?:number, chrome?:string|null, ffmpeg?:string|null}} [deps]
 *   injected in tests: any kit tool by its exported name; `loadTool(module)` replaces the kit import
 */
export default async function promoRender(api, deps = {}) {
  const { inputs = {}, outputs = {}, ctx = {} } = api;
  const log = typeof api.log === 'function' ? api.log : () => {};
  const pipelineDir = ctx.pipelineDir || ctx.cwd || process.cwd();
  const platform = deps.platform || ctx.platform || process.platform;
  const paths = promoPaths(pipelineDir);
  const issues = [];
  const state = { timeline: null, result: null, mix: null, srt: false, workers: 0, ms: 0, violations: [] };
  const finish = () => {
    writeReport(outputs, ['video', 'findings'], reportText({ issues, ...state }));
    try { writeText(paths.videoMd, reportText({ issues, ...state })); } catch { /* the port file is what counts */ }
    const blocking = issues.filter((i) => i.severity === 'critical' || i.severity === 'major');
    const summary = blocking.length
      ? `not rendered: ${blocking[0].title}`
      : `video/${VIDEO_FILE}: ${secs(state.result.duration)}, 1080p${FPS}${state.timeline.narrated ? ', narrated' : ', silent'}`;
    return { summary, verdict: { issues, summary } };
  };

  // 1. what to render
  const timeline = readJson(inputs.timeline?.path) || readJson(paths.timeline);
  if (!isObject(timeline) || !Number.isFinite(timeline.duration) || timeline.duration <= 0) {
    issues.push(issue('critical', 'No timeline to render', 'promo/timeline.json is missing or has no duration — the narration step did not finish.', 'promo/timeline.json'));
    return finish();
  }
  state.timeline = timeline;
  if (!existsSync(paths.filmHtml)) {
    issues.push(issue('critical', 'No film to render', 'promo/film/index.html does not exist — the film folder was never initialised or the scenes step did not run.', 'promo/film/index.html'));
    return finish();
  }

  // A cycle starts from nothing: a failed render must not leave the previous cycle's video looking current.
  for (const f of [VIDEO_FILE, SRT_FILE, YOUTUBE_FILE]) rmSync(join(paths.video, f), { force: true });

  // 2. the kit tools, and the two programs they drive
  const missingTools = [];
  const tool = async (name) => {
    const given = deps.tools?.[name];
    if (typeof given === 'function') return given;
    const load = typeof deps.loadTool === 'function' ? deps.loadTool : loadKitTool;
    try {
      const mod = await load(TOOL_MODULE[name]);
      if (typeof mod?.[name] === 'function') return mod[name];
      throw new Error(`tools/${TOOL_MODULE[name]}.mjs exports no ${name}`);
    } catch (e) {
      missingTools.push(`${name} (tools/${TOOL_MODULE[name]}.mjs): ${msg(e)}`);
      return null;
    }
  };
  const missingKit = () => {
    issues.push(issue('critical', 'The promo kit is incomplete', `worca could not load: ${missingTools.join('; ')}.`, 'assets/promo-kit/tools/'));
    return finish();
  };
  const [findChrome, findFfmpeg, toolHints] = [await tool('findChrome'), await tool('findFfmpeg'), await tool('toolHints')];
  if (missingTools.length) return missingKit();
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { log('warn', msg(e)); return dflt; } };
  const hints = safe(() => toolHints(platform), {}) || {};
  const chrome = deps.chrome !== undefined ? deps.chrome : safe(() => findChrome(), null);
  const ffmpeg = deps.ffmpeg !== undefined ? deps.ffmpeg : safe(() => findFfmpeg(), null);
  if (!chrome) issues.push(issue('critical', 'Chrome not found', `The film's frames are rendered with a headless Chrome or Edge, and none was found. ${hints.chrome || 'Install Google Chrome, or set WORCA_CHROME.'}`, ''));
  if (!ffmpeg) issues.push(issue('critical', 'ffmpeg not found', `The video is encoded with ffmpeg, and none was found. ${hints.ffmpeg || 'Install ffmpeg, or set WORCA_FFMPEG.'}`, ''));
  if (issues.length) return finish();

  const names = timeline.narrated ? ['buildData', 'dumpCues', 'thinCues', 'mixAudio', 'exportFilm', 'buildSrt'] : ['buildData', 'exportFilm', 'buildSrt'];
  const fns = {};
  for (const n of names) fns[n] = await tool(n);
  if (missingTools.length) return missingKit();

  // 3. data.js from the latest timeline and plates
  try {
    const built = await fns.buildData({ promoDir: paths.promo });
    for (const w of Array.isArray(built?.warnings) ? built.warnings : []) log('warn', `data.js: ${w}`);
  } catch (e) {
    issues.push(issue('major', 'film/data.js could not be built', msg(e), 'promo/film/data.js'));
    return finish();
  }

  // 4. the mix (narrated only), gated on the voice check
  let audio = null;
  if (timeline.narrated) {
    try {
      const dump = await fns.dumpCues({ html: paths.filmHtml, chrome });
      state.violations = Array.isArray(dump?.violations) ? dump.violations.map(String) : [];
      const thinned = await fns.thinCues(Array.isArray(dump?.cues) ? dump.cues : [], { accents: [] });
      const cues = timeline.sfx === false ? [] : (Array.isArray(thinned) ? thinned : []);
      state.mix = await fns.mixAudio({ promoDir: paths.promo, cues, ffmpeg });
      // A marginal fail (a burst of effects on a word) is fixed by one remix with the effects ducked harder under
      // speech — cheaper than sending the film back through the scenes step. Still failing → the blocking finding.
      if (state.mix && state.mix.voiceCheck && !state.mix.voiceCheck.ok) {
        state.mixRetry = true;
        state.mix = await fns.mixAudio({ promoDir: paths.promo, cues, ffmpeg, levels: { ...RETRY_LEVELS } });
      }
    } catch (e) {
      issues.push(issue('major', 'The audio mix failed', msg(e), 'promo/audio/'));
      return finish();
    }
    if (state.violations.length) {
      issues.push(issue('minor', 'The film reported kit warnings', state.violations.slice(0, 10).join('; '), 'promo/film/'));
    }
    const missingSfx = Array.isArray(state.mix?.missingSfx) ? state.mix.missingSfx : [];
    if (missingSfx.length) {
      issues.push(issue('minor', 'Some sound effects have no file', `Cued but not in promo/audio/sfx/, so they are silent: ${missingSfx.slice(0, 12).join(', ')}.`, 'promo/audio/sfx/'));
    }
    if (!state.mix?.voiceCheck?.ok) {
      const bad = (state.mix?.voiceCheck?.lines || []).filter((l) => !l.ok);
      const list = bad.map((l) => `${l.id} (median ${Number(l.median).toFixed(1)} dB, ${Math.round((Number(l.lowShare) || 0) * 100)} % of speech frames under 6 dB)`).join(', ');
      issues.push(issue('major', 'The voice is buried under the music and effects',
        `The voice check needs the narration at least 12 dB over the bed (median) with at most 5 % of speech frames under 6 dB. Failing: ${list || 'the mix gave no line detail'}. Lower the SFX gains (F.sfxAt … { gain }) on those lines, or move the cues off the words.`,
        'promo/audio/mix.wav'));
      return finish();
    }
    audio = state.mix?.files?.m4a || null;
    if (!audio || !existsSync(audio)) {
      issues.push(issue('major', 'The audio mix wrote no m4a', `Expected ${audio || 'promo/audio/mix.m4a'}.`, 'promo/audio/'));
      return finish();
    }
  }

  // 5. the export
  const cores = Number.isInteger(deps.cpus) ? deps.cpus : (availableParallelism?.() || osCpus().length);
  state.workers = Math.max(1, Math.min(MAX_WORKERS, cores - 2));
  const out = join(paths.video, VIDEO_FILE);
  let lastPct = -1;
  const onProgress = (a, b) => {
    const done = isObject(a) ? (a.done ?? a.frame ?? 0) : Number(a) || 0;
    const total = isObject(a) ? (a.total ?? 0) : Number(b) || 0;
    if (!total) return;
    const pct = Math.floor((done / total) * 20) * 5;
    if (pct !== lastPct) { lastPct = pct; log('info', `export ${pct}% (${done}/${total} frames)`); }
  };
  const started = Date.now();
  try {
    state.result = await fns.exportFilm({ html: paths.filmHtml, out, audio, scale: 2, workers: state.workers, chrome, ffmpeg, onProgress });
  } catch (e) {
    rmSync(out, { force: true });
    issues.push(issue('major', 'The export failed', msg(e), `video/${VIDEO_FILE}`));
    return finish();
  }
  state.ms = Date.now() - started;
  const expected = Math.round(timeline.duration * FPS);
  const frames = Number(state.result?.frames);
  if (!existsSync(out) || !statSync(out).size) {
    issues.push(issue('major', 'The export wrote no video', `video/${VIDEO_FILE} is missing or empty.`, `video/${VIDEO_FILE}`));
    state.result = null;
    return finish();
  }
  if (!Number.isFinite(frames) || Math.abs(frames - expected) > 1) {
    issues.push(issue('major', 'The video is the wrong length',
      `The export produced ${frames} frames (${secs(Number(state.result?.duration) || 0)}) against ${expected} frames (${secs(timeline.duration)}) on the timeline — the film's own duration and the timeline disagree.`,
      `video/${VIDEO_FILE}`));
    return finish();
  }
  if (!Number.isFinite(state.result.bytes)) state.result.bytes = statSync(out).size;
  if (!Number.isFinite(state.result.duration)) state.result.duration = frames / FPS;

  // 6. captions and YouTube metadata
  try {
    writeText(join(paths.video, SRT_FILE), String(await fns.buildSrt(timeline)));
    state.srt = true;
  } catch (e) {
    issues.push(issue('minor', 'Captions could not be written', msg(e), `video/${SRT_FILE}`));
  }
  const script = readJson(paths.script);
  let product = '';
  try { product = readFileSync(paths.product, 'utf8'); } catch { product = ''; }
  const files = [`${VIDEO_FILE} — 1080p${FPS}, ${secs(state.result.duration)}`];
  if (state.srt) files.push(`${SRT_FILE} — English captions`);
  writeText(join(paths.video, YOUTUBE_FILE), youtubeMarkdown({
    title: typeof script?.title === 'string' ? script.title.trim() : '',
    description: youtubeDescription({ product, script }),
    chapters: youtubeChapters(timeline),
    files,
  }));
  return finish();
}
