// scripts/promo-narrate.mjs — the `promoNarrate` card: the approved narration script becomes the
// film's TIMELINE (promo/timeline.json), which the kit's build-data, the scene builders, the
// reviewer and the renderer all read.
//
// Narrated (setup says so, a key is in the environment, a voice was picked):
//   · one ElevenLabs TTS clip per line (`/v1/text-to-speech/{voice}/with-timestamps`,
//     previous_text/next_text for continuity, mp3_44100_128), word timing from the alignment,
//     clip length from the MP3's own frames — promo/audio/vo/<id>.mp3 + <id>.json;
//   · when the setup keeps music on: a music bed per section (a chapter starts a section;
//     `/v1/music`, stitched with 0.15 s fades by ffmpeg) and the kit's SFX library
//     (`/v1/sound-generation`, one file per kit SFX name and variant, prompts from the kit's
//     tools/sfx.mjs, existing files kept).
// Anything that fails on the narrated path (no key, a refused key, no network, a line that will
// not render) falls back to the SILENT timeline — the same layout from estimated word timing —
// with the reason in the report. Music or SFX failures only drop music or SFX.
//
// Then the film folder is initialised (kit init-film) and film/data.js built (kit build-data).
// The key is read from the environment only and never written anywhere.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readSetup, promoPaths, readJson, writeJson, writeReport, answerValues, elevenKey, elevenBase, elevenFetch, withRetry,
  accountRefusal, redactKey, mp3Duration, wordsFromAlignment, estimateWords, kitSfxNames, loadKitTool, round3, present,
  OUTPUT_FORMAT, TTS_MODEL, WORDS_PER_SEC,
} from './promo-common.mjs';

/** Seconds. chapterLead: before a chapter scene's first line; lineGap: between two lines of one
 *  scene; tail: after a scene's last line; finalHold: after the film's last line; firstLead: before
 *  the first line of a film that opens without a chapter; emptySceneSec: a scene with no line. */
export const LAYOUT = Object.freeze({ chapterLead: 1.2, lineGap: 0.45, tail: 0.6, finalHold: 3, firstLead: 0.5, emptySceneSec: 2.5 });
const FPS = 60;
const MUSIC_FADE = 0.15;
const MUSIC_MIN_SECTION = 5;
const SFX_CONCURRENCY = 3;

const TONE_VOICE = Object.freeze({
  Playful: { stability: 0.38, similarity_boost: 0.8, style: 0.4 },
  Professional: { stability: 0.55, similarity_boost: 0.8, style: 0.15 },
  Bold: { stability: 0.35, similarity_boost: 0.8, style: 0.55 },
  Calm: { stability: 0.6, similarity_boost: 0.75, style: 0.1 },
});
const PACE_SPEED = Object.freeze({ Relaxed: 0.95, Lively: 1.05, Fast: 1.12 });

const MUSIC_BASE = Object.freeze({
  Playful: 'Instrumental playful bouncy modern explainer-video underscore, 120 bpm, 4/4, key of C major. Pizzicato strings, marimba, plucky synth, warm round bass, soft finger snaps and light claps. Quirky but polished, never cheesy.',
  Professional: 'Instrumental modern confident tech-product underscore, 110 bpm, 4/4, key of D major. Soft piano, muted guitar plucks, light pads, gentle pulse percussion, warm bass. Clean and assured.',
  Bold: 'Instrumental energetic modern product-launch underscore, 124 bpm, 4/4, key of A minor. Punchy drums, driving synth bass, bright synth stabs, claps. Exciting and confident.',
  Calm: 'Instrumental calm warm ambient explainer underscore, 90 bpm, 4/4, key of F major. Soft felt piano, warm pads, gentle mallets, light brushed percussion. Relaxed and clear.',
});
const MUSIC_TAIL = ' No vocals, no choir, no distortion. Light, spacious mix that leaves room for a narrator.';

/** Used only when the kit's SFX library (assets/promo-kit/tools/sfx.mjs) cannot be read. */
const FALLBACK_SFX_STYLE = ' Clean isolated single sound effect, no music, no voice, no background noise, soft rounded cartoon UI foley, high quality.';
/** `{prompt, seconds, variants, maxTrim}` for one SFX name: the kit's spec, or a plain one. */
const sfxSpec = (specs, name) => (isObject(specs?.[name]) ? specs[name]
  : { prompt: `Short ${String(name).replace(/-/g, ' ')} sound effect, cartoon UI style`, seconds: 0.8, variants: 1, maxTrim: 0.6 });

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** promo/script.json → `{title, lines:[{id, scene, text}], scenes:[{id, chapter?, minSec?}]}`. Tolerant. */
export function normalizeScript(raw) {
  const doc = isObject(raw) ? raw : {};
  const seen = new Set();
  const lines = [];
  for (const l of Array.isArray(doc.lines) ? doc.lines : []) {
    const id = str(l?.id);
    const text = str(l?.text);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    lines.push({ id, scene: str(l?.scene), text });
  }
  const sceneIds = new Set();
  const scenes = [];
  for (const s of Array.isArray(doc.scenes) ? doc.scenes : []) {
    const id = str(s?.id);
    if (!id || sceneIds.has(id)) continue;
    sceneIds.add(id);
    const sc = { id };
    if (isObject(s.chapter) && (str(s.chapter.title) || str(s.chapter.num))) sc.chapter = { num: str(s.chapter.num), title: str(s.chapter.title) };
    const minSec = Number(s.minSec);
    if (Number.isFinite(minSec) && minSec > 0) sc.minSec = minSec;
    scenes.push(sc);
  }
  return { title: str(doc.title), lines, scenes };
}

/**
 * Lay the lines onto the scenes. Pure.
 * Scenes run in order; each is `[start, max(start + minSec, lastLineEnd + tail)]`, a chapter scene
 * waits `chapterLead` before its first line, lines of one scene are `lineGap` apart, and the film
 * holds `finalHold` after its last line. A line naming no known scene joins the scene of the line
 * before it (or the first scene).
 * @param {{script: object, lines: Record<string, {dur:number, speechStart:number, speechEnd:number, words:Array}>}} a
 * @returns {{duration:number, vo:object, scenes:Array, warnings:string[]}}
 */
export function layoutTimeline({ script, lines }) {
  const s = normalizeScript(script);
  const warnings = [];
  let scenes = s.scenes.map((x) => ({ ...x }));
  if (!scenes.length) {
    const ids = [...new Set(s.lines.map((l) => l.scene).filter(Boolean))];
    scenes = (ids.length ? ids : ['main']).map((id) => ({ id }));
  }
  const byScene = new Map(scenes.map((x) => [x.id, []]));
  let last = scenes[0].id;
  for (const l of s.lines) {
    if (!lines[l.id]) continue;
    let sceneId = l.scene;
    if (!byScene.has(sceneId)) {
      warnings.push(`line ${l.id} names scene "${l.scene}", which the script does not list — placed in "${last}"`);
      sceneId = last;
    }
    byScene.get(sceneId).push({ ...l, scene: sceneId });
    last = sceneId;
  }
  const vo = {};
  const out = [];
  let t = 0;
  let lastLineEnd = null;
  scenes.forEach((sc, i) => {
    const start = round3(t);
    const ls = byScene.get(sc.id);
    let cursor = start + (sc.chapter ? LAYOUT.chapterLead : (i === 0 ? LAYOUT.firstLead : 0));
    ls.forEach((l, j) => {
      if (j > 0) cursor += LAYOUT.lineGap;
      const timing = lines[l.id];
      const at = round3(cursor);
      vo[l.id] = {
        text: l.text, scene: sc.id, start: at, dur: round3(timing.dur),
        speechStart: round3(timing.speechStart), speechEnd: round3(timing.speechEnd), words: timing.words,
      };
      cursor = at + timing.dur;
      lastLineEnd = cursor;
    });
    let end = ls.length ? cursor + LAYOUT.tail : start + LAYOUT.emptySceneSec;
    if (sc.minSec) end = Math.max(end, start + sc.minSec);
    if (i === scenes.length - 1 && lastLineEnd !== null) end = Math.max(end, lastLineEnd + LAYOUT.finalHold);
    const row = { id: sc.id, start, end: round3(end) };
    if (sc.chapter) row.chapter = sc.chapter;
    out.push(row);
    t = row.end;
  });
  // vo in SCRIPT order (the kit and the captions read it in that order)
  const ordered = {};
  for (const l of s.lines) if (vo[l.id]) ordered[l.id] = vo[l.id];
  return { duration: out[out.length - 1].end, vo: ordered, scenes: out, warnings };
}

/** Music sections: a chapter scene (after the first) starts a new one; a section shorter than
 *  MUSIC_MIN_SECTION joins the one before it. `[{at, dur}]`, covering `[0, duration]`. Pure. */
export function musicSections(scenes, duration, { single = false } = {}) {
  const cuts = single ? [0] : [0, ...scenes.filter((x, i) => i > 0 && x.chapter).map((x) => x.start)];
  const out = [];
  cuts.forEach((at, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1] : duration;
    if (out.length && end - at < MUSIC_MIN_SECTION) { out[out.length - 1].dur = round3(end - out[out.length - 1].at); return; }
    if (out.length && at - out[out.length - 1].at < MUSIC_MIN_SECTION) { out[out.length - 1].dur = round3(end - out[out.length - 1].at); return; }
    out.push({ at: round3(at), dur: round3(end - at) });
  });
  return out;
}

function sectionPrompt(tone, i, n) {
  const base = MUSIC_BASE[tone] || MUSIC_BASE.Playful;
  const part = n === 1 ? ' Starts gently, settles into a steady groove, and ends on one final bright chord that rings out.'
    : i === 0 ? ' Curious intro that builds gently in layers and keeps building; it never resolves or fades out.'
      : i === n - 1 ? ' Starts with a light accent on the first beat, a steady groove, then ends on one final bright chord that rings out.'
        : ' Starts with a light accent on the first beat, then a steady unobtrusive groove with no big fills.';
  return base + part + MUSIC_TAIL;
}

function defaultRunFfmpeg(ffmpeg) {
  return (args, { binary = false } = {}) => {
    const r = spawnSync(ffmpeg, args, { ...(binary ? {} : { encoding: 'utf8' }), windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status ?? (r.error ? 1 : 0), stderr: String(r.stderr || (r.error ? r.error.message : '')), ...(binary ? { stdout: r.stdout } : {}) };
  };
}

// ── narrated path ──────────────────────────────────────────────────────────────

/** Every line spoken (cached clips reused). Throws an Error carrying `lineId` on the first failure. */
async function speakAll({ script, setup, voice, key, call, paths, log, notes }) {
  const settings = { ...(TONE_VOICE[setup.tone] || TONE_VOICE.Playful), use_speaker_boost: true, speed: PACE_SPEED[setup.pace] || 1.05 };
  let voiceId = voice.id;
  // A library voice added on an earlier attempt speaks under the id the account gave it: reuse that id
  // (and its clips) instead of adding the voice a second time.
  for (const l of script.lines) {
    const rec = readJson(join(paths.vo, `${l.id}.json`));
    if (rec && rec.pickedVoiceId === voice.id && typeof rec.voiceId === 'string' && rec.voiceId) { voiceId = rec.voiceId; break; }
  }
  let added = false;
  const out = {};
  let spoken = 0;
  let cached = 0;
  mkdirSync(paths.vo, { recursive: true });
  for (let i = 0; i < script.lines.length; i += 1) {
    const L = script.lines[i];
    const mp3 = join(paths.vo, `${L.id}.mp3`);
    const js = join(paths.vo, `${L.id}.json`);
    const cacheKey = JSON.stringify({ voiceId, model: TTS_MODEL, settings, text: L.text });
    const prev = readJson(js);
    if (prev && prev.cacheKey === cacheKey && present(mp3)) {
      out[L.id] = prev;
      cached += 1;
      continue;
    }
    const body = { text: L.text, model_id: TTS_MODEL, voice_settings: settings };
    if (script.lines[i - 1]) body.previous_text = script.lines[i - 1].text;
    if (script.lines[i + 1]) body.next_text = script.lines[i + 1].text;
    const tts = (id) => call(`/v1/text-to-speech/${encodeURIComponent(id)}/with-timestamps`, { method: 'POST', body, query: { output_format: OUTPUT_FORMAT } });
    let res;
    try {
      res = await tts(voiceId);
    } catch (e) {
      // A shared-library voice is spoken only once it is in the account: add it, then try again.
      if (!added && voiceId === voice.id && voice.entry?.source === 'library' && voice.entry.publicOwnerId && [400, 404].includes(e?.status)) {
        added = true;
        const got = await call(`/v1/voices/add/${encodeURIComponent(voice.entry.publicOwnerId)}/${encodeURIComponent(voice.id)}`,
          { method: 'POST', body: { new_name: voice.entry.name || 'Promo narrator' } }).then((r) => r.json());
        if (typeof got?.voice_id !== 'string' || !got.voice_id) throw Object.assign(e, { lineId: L.id });
        voiceId = got.voice_id;
        notes.push(`Added the library voice ${voice.entry.name || voice.id} to your ElevenLabs voices (${voiceId}).`);
        try { res = await tts(voiceId); } catch (e2) { throw Object.assign(e2, { lineId: L.id }); }
      } else {
        throw Object.assign(e, { lineId: L.id });
      }
    }
    let j;
    try { j = await res.json(); } catch { j = null; }
    if (!j || typeof j.audio_base64 !== 'string' || !j.audio_base64) throw Object.assign(new Error('the TTS response carried no audio'), { lineId: L.id });
    const buf = Buffer.from(j.audio_base64, 'base64');
    const words = wordsFromAlignment(j.alignment || j.normalized_alignment);
    const dur = round3(mp3Duration(buf) ?? ((words[words.length - 1]?.t1 ?? 0) + 0.15));
    const rec = {
      id: L.id, text: L.text, voiceId, pickedVoiceId: voice.id, cacheKey: JSON.stringify({ voiceId, model: TTS_MODEL, settings, text: L.text }), dur,
      speechStart: words[0]?.t0 ?? 0, speechEnd: words[words.length - 1]?.t1 ?? dur, words,
    };
    writeFileSync(mp3, buf);
    writeJson(js, rec);
    out[L.id] = rec;
    spoken += 1;
  }
  log('info', `narration: ${spoken} line(s) spoken, ${cached} reused`);
  return { lines: out, voiceId, spoken, cached };
}

async function makeMusic({ timeline, setup, call, paths, ffmpeg, runFfmpeg, log }) {
  const sections = musicSections(timeline.scenes, timeline.duration, { single: !ffmpeg });
  const prompts = sections.map((_, i) => sectionPrompt(setup.tone, i, sections.length));
  const plan = { sections, prompts, duration: timeline.duration, stitched: Boolean(ffmpeg) };
  const manifest = join(paths.music, 'music.json');
  const musicFile = join(paths.music, 'music.mp3');
  const prev = readJson(manifest);
  if (prev && JSON.stringify(prev) === JSON.stringify(plan) && present(musicFile)) return { ok: true, cached: true, sections: sections.length };
  mkdirSync(paths.music, { recursive: true });
  const segs = [];
  for (let i = 0; i < sections.length; i += 1) {
    const gen = Math.min(300, Math.max(10, sections[i].dur + 2));
    const res = await call('/v1/music', { method: 'POST', query: { output_format: OUTPUT_FORMAT },
      body: { prompt: prompts[i], music_length_ms: Math.round(gen * 1000), force_instrumental: true }, timeoutMs: 300000 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('the music response was empty');
    const f = join(paths.music, `seg-${i + 1}.mp3`);
    writeFileSync(f, buf);
    segs.push(f);
  }
  if (!ffmpeg) {
    copyFileSync(segs[0], musicFile);
  } else {
    const inputs = [];
    const parts = [];
    const total = timeline.duration;
    sections.forEach((s, i) => {
      inputs.push('-i', segs[i]);
      const ms = Math.round(s.at * 1000);
      const fin = i > 0 ? `,afade=t=in:d=${MUSIC_FADE}` : '';
      const fout = i < sections.length - 1 ? `,afade=t=out:st=${Math.max(0, s.dur - MUSIC_FADE).toFixed(3)}:d=${MUSIC_FADE}` : '';
      parts.push(`[${i}:a]aresample=44100,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0,atrim=0:${s.dur},asetpts=PTS-STARTPTS,apad=whole_dur=${s.dur},atrim=0:${s.dur}${fin}${fout},adelay=${ms}|${ms}[s${i}]`);
    });
    const graph = `${parts.join(';')};${sections.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sections.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total}[o]`;
    const r = runFfmpeg(['-y', '-hide_banner', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[o]', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', musicFile]);
    if (r.status !== 0) throw new Error(`ffmpeg could not stitch the music: ${String(r.stderr).trim().split('\n').slice(-2).join(' ')}`);
  }
  writeJson(manifest, plan);
  log('info', `music: ${sections.length} section(s)`);
  return { ok: true, cached: false, sections: sections.length };
}

/** Seconds of audio ffmpeg can decode from `file` (0 when it cannot). */
function decodedSeconds(file, runFfmpeg) {
  const r = runFfmpeg(['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { binary: true });
  if (r.status !== 0) return 0;
  const n = r.stdout ? (Buffer.isBuffer(r.stdout) ? r.stdout.length : Buffer.byteLength(String(r.stdout), 'latin1')) : 0;
  return n / 2 / 8000;
}

/**
 * Peak-normalise, trim, fade one SFX clip (the film's foley sits well under the voice).
 * Normalise FIRST so the silence thresholds act on a known level: a quiet, short clip used to be trimmed to a bare
 * header (pop-high, 2026-10-16), and one undecodable clip failed the whole mix. The result must decode to ≥ 30 ms;
 * otherwise retry without the tail trim, and as a last resort keep the generator's own file.
 */
export function finishSfx({ raw, file, keep, ffmpeg, runFfmpeg }) {
  if (!ffmpeg || !runFfmpeg) { copyFileSync(raw, file); return; }
  const probe = runFfmpeg(['-hide_banner', '-i', raw, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume: (-?[\d.]+) dB/.exec(String(probe.stderr || ''));
  const pre = m ? -3 - parseFloat(m[1]) : 0;
  const head = `volume=${pre.toFixed(2)}dB,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.004,atrim=0:${keep},afade=t=out:st=${Math.max(0.02, keep - 0.08).toFixed(3)}:d=0.08`;
  const tailTrim = ',areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse';
  for (const af of [`${head}${tailTrim},alimiter=limit=0.7`, `${head},alimiter=limit=0.7`]) {
    const r = runFfmpeg(['-y', '-hide_banner', '-v', 'error', '-i', raw, '-af', af, '-ar', '44100', '-ac', '1', '-b:a', '128k', file]);
    if (r.status === 0 && present(file) && decodedSeconds(file, runFfmpeg) >= 0.03) return;
  }
  copyFileSync(raw, file);
}

async function makeSfx({ names, specs, style, call, paths, ffmpeg, runFfmpeg, log }) {
  mkdirSync(paths.sfx, { recursive: true });
  // One job per FILE: a name with variants has <name>.mp3, <name>-2.mp3 … (the mix alternates them by occurrence).
  const jobs = [];
  for (const name of names) {
    const spec = sfxSpec(specs, name);
    const n = Math.max(1, Math.min(4, Math.round(Number(spec.variants) || 1)));
    for (let v = 1; v <= n; v += 1) jobs.push({ name, v, spec, file: join(paths.sfx, v === 1 ? `${name}.mp3` : `${name}-${v}.mp3`) });
  }
  const todo = jobs.filter((j) => !present(j.file));
  const failed = [];
  let made = 0;
  let stopped = null;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && !stopped) {
      const job = queue.shift();
      const { prompt, seconds, maxTrim } = job.spec;
      try {
        const res = await call('/v1/sound-generation', { method: 'POST', query: { output_format: OUTPUT_FORMAT },
          body: { text: `${prompt}${job.v > 1 ? `, variation ${job.v}` : ''}.${style}`, duration_seconds: Math.max(0.5, Number(seconds) || 0.8), prompt_influence: 0.6 } });
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('empty response');
        const raw = `${job.file}.raw.mp3`;
        writeFileSync(raw, buf);
        try { finishSfx({ raw, file: job.file, keep: Number(maxTrim) || Math.max(0.1, Number(seconds) || 0.8), ffmpeg, runFfmpeg }); } finally { rmSync(raw, { force: true }); }
        made += 1;
      } catch (e) {
        failed.push({ name: job.v === 1 ? job.name : `${job.name}-${job.v}`, why: e?.message || String(e) });
        if (accountRefusal(e)) stopped = e?.message || String(e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SFX_CONCURRENCY, todo.length) }, worker));
  log('info', `sfx: ${made} made, ${jobs.length - todo.length} kept`);
  return { made, kept: jobs.length - todo.length, failed, stopped, total: jobs.length };
}

// ── the card ──────────────────────────────────────────────────────────────────

function pickVoice({ inputs, paths, env }) {
  const answered = answerValues(readJson(inputs.answers?.path)) || answerValues(readJson(paths.voicePort));
  const list = readJson(paths.voicesJson);
  const voices = Array.isArray(list?.voices) ? list.voices.filter((v) => isObject(v) && typeof v.id === 'string') : [];
  let id = str(answered?.voiceId);
  if (!id) id = str(env.ELEVENLABS_VOICE_ID);
  if (!id && voices[0]) id = voices[0].id;
  return { id, entry: voices.find((v) => v.id === id) || null, listError: typeof list?.error === 'string' ? list.error : null };
}

const fmt = (s) => `${(Math.round(s * 10) / 10).toFixed(1)} s`;

function reportText({ timeline, setup, mode, reason, voice, speak, music, sfx, notes, warnings, script }) {
  const L = ['# Narration', ''];
  if (mode === 'narrated') {
    const name = voice.entry?.name ? `${voice.entry.name} (\`${timeline.voiceId}\`)` : `\`${timeline.voiceId}\``;
    L.push(`Narrated with ElevenLabs, voice ${name}: ${speak.spoken} line(s) spoken, ${speak.cached} reused.`);
  } else {
    L.push(`Silent timeline${reason ? ` — ${reason}` : ''}. Word timing is estimated at ${WORDS_PER_SEC[setup.pace]} words a second (${setup.pace}).`);
  }
  L.push(`Duration ${fmt(timeline.duration)} (target ${setup.lengthSec} s) · ${Object.keys(timeline.vo).length} line(s) · ${timeline.scenes.length} scene(s).`);
  if (music) L.push(music.ok ? `Music: ${music.sections} section(s)${music.cached ? ', reused' : ''}.` : `Music: off — ${music.why}.`);
  if (sfx) {
    const bits = [`${sfx.made} made`, `${sfx.kept} kept`];
    if (sfx.failed.length) bits.push(`${sfx.failed.length} failed (${sfx.failed.slice(0, 5).map((f) => f.name).join(', ')})`);
    L.push(`Sound effects: ${bits.join(', ')} of ${sfx.total}.${sfx.stopped ? ` Stopped: ${sfx.stopped}.` : ''}`);
  }
  for (const n of notes) L.push(n);
  L.push('', '| Scene | Start | End | Chapter | Lines |', '|---|---|---|---|---|');
  for (const sc of timeline.scenes) {
    const ids = Object.entries(timeline.vo).filter(([, v]) => v.scene === sc.id).map(([id]) => id);
    L.push(`| ${sc.id} | ${fmt(sc.start)} | ${fmt(sc.end)} | ${sc.chapter ? `${sc.chapter.num} ${sc.chapter.title}`.trim() : ''} | ${ids.join(', ')} |`);
  }
  const ratio = timeline.duration / setup.lengthSec;
  const all = [...warnings];
  if (ratio > 1.25 || ratio < 0.6) all.push(`the film runs ${fmt(timeline.duration)} against a ${setup.lengthSec} s target`);
  if (!script.lines.length) all.push('the script has no narration lines');
  if (all.length) L.push('', '## Warnings', '', ...all.map((w) => `- ${w}`));
  return L.join('\n') + '\n';
}

/**
 * @param {object} api the node harness api
 * @param {{fetchImpl?:Function, env?:object, sleep?:Function, kit?:{initFilm:Function, buildData:Function},
 *   ffmpeg?:string|null, runFfmpeg?:Function, sfxNames?:string[]}} [deps] injected in tests
 */
export default async function promoNarrate(api, deps = {}) {
  const { inputs = {}, outputs = {}, ctx = {} } = api;
  const log = typeof api.log === 'function' ? api.log : () => {};
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const pipelineDir = ctx.pipelineDir || ctx.cwd || process.cwd();
  const paths = promoPaths(pipelineDir);
  const setup = readSetup(pipelineDir);
  const script = normalizeScript(readJson(inputs.script?.path) ?? readJson(paths.script));
  // Nothing to lay out at all: one scene as long as the setup asked for, so the film still has a clock.
  if (!script.lines.length && !script.scenes.length) script.scenes = [{ id: 'main', minSec: setup.lengthSec }];
  const key = elevenKey(env);
  const notes = [];
  const warnings = [];
  const redact = (t) => redactKey(t, key);

  let ffmpeg = deps.ffmpeg;
  if (ffmpeg === undefined) {
    try { ffmpeg = (await loadKitTool('find-tools')).findFfmpeg() || null; } catch (e) { ffmpeg = null; warnings.push(`ffmpeg lookup failed: ${e?.message || e}`); }
  }
  const runFfmpeg = deps.runFfmpeg || (ffmpeg ? defaultRunFfmpeg(ffmpeg) : null);

  // 1. who speaks — or why nobody does
  const voice = pickVoice({ inputs, paths, env });
  let reason = null;
  if (!setup.narrated) reason = 'the setup chose a silent video';
  else if (!key) reason = 'no ElevenLabs API key in the environment';
  else if (!voice.id) reason = `no voice was picked${voice.listError ? ` (the voice list failed: ${redact(voice.listError)})` : ''}`;
  else if (!script.lines.length) reason = 'the script has no lines to speak';

  const base = elevenBase(env);
  const call = (path, o = {}) => withRetry(() => elevenFetch(path, { key, fetchImpl, base, ...o }), { sleep: deps.sleep });
  let speak = null;
  if (!reason) {
    try {
      speak = await speakAll({ script, setup, voice, key, call, paths, log, notes });
    } catch (e) {
      reason = redact(`ElevenLabs text to speech failed${e?.lineId ? ` on ${e.lineId}` : ''}: ${e?.message || e} — the video is silent`);
      log('warn', reason);
    }
  }
  const narrated = Boolean(speak);
  const timing = {};
  for (const l of script.lines) timing[l.id] = narrated ? speak.lines[l.id] : estimateWords(l.text, WORDS_PER_SEC[setup.pace]);
  const laid = layoutTimeline({ script: { lines: script.lines, scenes: script.scenes }, lines: timing });
  warnings.push(...laid.warnings);
  const timeline = { version: 1, duration: laid.duration, fps: FPS, narrated, music: false, sfx: false };
  if (narrated) timeline.voiceId = speak.voiceId;
  timeline.vo = laid.vo;
  timeline.scenes = laid.scenes;

  // 2. music and sound effects: narrated films with music on only
  let music = null;
  let sfx = null;
  if (narrated && setup.music) {
    try {
      music = await makeMusic({ timeline, setup, call, paths, ffmpeg, runFfmpeg, log });
      timeline.music = true;
    } catch (e) {
      music = { ok: false, why: redact(e?.message || String(e)) };
      log('warn', `music: ${music.why}`);
    }
    const names = Array.isArray(deps.sfxNames) ? deps.sfxNames : kitSfxNames();
    let lib = { specs: deps.sfxSpecs || null, style: FALLBACK_SFX_STYLE };
    if (!lib.specs) {
      try { const m = await loadKitTool('sfx'); lib = { specs: m.SFX_SPECS || {}, style: m.SFX_STYLE || FALLBACK_SFX_STYLE }; }
      catch (e) { lib = { specs: {}, style: FALLBACK_SFX_STYLE }; warnings.push(`the kit SFX library could not be read (${e?.message || e}) — plain prompts used`); }
    }
    sfx = await makeSfx({ names, specs: lib.specs, style: lib.style, call, paths, ffmpeg, runFfmpeg, log });
    for (const f of sfx.failed) f.why = redact(f.why);
    if (sfx.stopped) sfx.stopped = redact(sfx.stopped);
    timeline.sfx = sfx.made + sfx.kept > 0;
  } else if (narrated) {
    notes.push('Music and sound effects: off (the setup turned music off).');
  }

  writeJson(paths.timeline, timeline);
  if (outputs.timeline?.path) writeJson(outputs.timeline.path, timeline);

  // 3. the film folder (the kit runtime) and its data.js
  const kit = deps.kit || {};
  try {
    const initFilm = kit.initFilm || (await loadKitTool('init-film')).initFilm;
    await initFilm({ filmDir: paths.film });
  } catch (e) { warnings.push(`the film folder could not be initialised: ${redact(e?.message || e)}`); }
  try {
    const buildData = kit.buildData || (await loadKitTool('build-data')).buildData;
    await buildData({ promoDir: paths.promo });
  } catch (e) { warnings.push(`film/data.js could not be built: ${redact(e?.message || e)}`); }
  for (const w of warnings) log('warn', redact(w));

  const text = redact(reportText({ timeline, setup, mode: narrated ? 'narrated' : 'silent', reason, voice, speak, music, sfx, notes, warnings, script }));
  writeReport(outputs, ['report'], text);
  const summary = narrated
    ? `narrated: ${Object.keys(timeline.vo).length} lines, ${fmt(timeline.duration)}${timeline.music ? ', music' : ''}${timeline.sfx ? ', sfx' : ''}`
    : `silent timeline: ${Object.keys(timeline.vo).length} lines, ${fmt(timeline.duration)}${reason && setup.narrated ? ` (${reason})` : ''}`;
  return { summary: redact(summary).slice(0, 400) };
}
