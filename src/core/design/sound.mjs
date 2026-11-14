// src/core/design/sound.mjs
// Design sound (SPEC D8-D11, §5 "Design sound"): a video's voice and music in `work/assets/sound/`. One clip per scene
// that has words (`voice-<sectionId>.<ext>`), one music track (`music.<ext>`) and the manifest that lists them
// (`sound.json`). The folder is in work/, an agent's to write, so the manifest is read as untrusted: never through a
// link, never past SOUND_LIMITS.manifestBytes, and a name in it is only ever one checked bare name. Every write goes
// through inWorkFolder + placeWorkBytes (P8), so a planted link is replaced and never written through.
// `makeSound` is the round's sound stage: it makes what is missing, reuses the rest, grows a scene its voice needs, and
// books every call that answered. `speak` and `compose` are passed in: nothing here reaches a network, and nothing
// imports assemble.mjs or build.mjs (both import this module).

import { createHash } from 'node:crypto';
import { closeSync, constants as fsc, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { round3 } from '../elevenlabs.mjs';
import {
  MUSIC_GAIN, MUSIC_KEEP_SLACK, SOUND_LIMITS, SOUND_SERVICE, VOICE_LEAD, VOICE_TAIL, musicPrompt,
} from '../../shared/sound-services.mjs';
import { isSectionId } from './ids.mjs';
import { inWorkFolder, placeWorkBytes, readFolder, removeWorkEntry } from './paths.mjs';
import { createSemaphore } from './semaphore.mjs';

/** The sound's folder in work/, with `/` on every system. */
export const SOUND_DIR = 'assets/sound';
/** The manifest's name in SOUND_DIR. */
export const SOUND_MANIFEST = 'sound.json';

const SOUND_PARTS = SOUND_DIR.split('/');
/** The longest a scene may be, in seconds: plan.mjs's MAX_DURATION, which it does not export. */
const MAX_SCENE = 600;
/** The manifest is an agent's file: never followed (no such flag on Windows: lstat first), never waited on as a FIFO. */
const OPEN_MANIFEST = fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0);
const SOUND_EXTS = Object.freeze(['mp3', 'wav']);
const CLIP_FILE_RE = /^voice-[a-z][a-z0-9-]{0,31}\.(mp3|wav)$/;
const MUSIC_FILE_RE = /^music\.(mp3|wav)$/;
const KEY_RE = /^[0-9a-f]{64}$/;
/** A word that ends a sentence (sentenceCues). */
const SENTENCE_END_RE = /[.!?…]$/;

/** The reasons the stage writes itself (SPEC §7, word for word); a SoundError's message is P1's. */
const REASONS = Object.freeze({
  unreachable: 'ElevenLabs could not be reached',
  notSound: 'ElevenLabs answered with something that is not sound',
  notSaved: 'the sound could not be saved',
  tooLong: (id) => `the voice for ${id} is longer than a scene can be`,
});

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = Number.isFinite;
const durationOf = (section) => (finite(section?.duration) ? section.duration : 0);
const hasSay = (section) => typeof section?.say === 'string' && section.say.trim() !== '';
const isAbort = (err) => err?.name === 'AbortError';
const abortError = () => new DOMException('This operation was aborted', 'AbortError');
const otherExt = (ext) => (ext === 'mp3' ? 'wav' : 'mp3');
const warn = (what, err) => console.warn(`[worca-design] sound: ${what} (${err?.code ?? err?.message ?? err})`);

const sha256 = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** A clip's key: the same voice, model and words make the same clip (SPEC D8). */
export function clipKey({ voiceId, model, text }) {
  return sha256(['voice', voiceId, model, text]);
}

/** The music's key: the same description and model make the same track (SPEC D10). */
export function musicKey({ prompt, model }) {
  return sha256(['music', prompt, model]);
}

/**
 * The manifest file at `path` (in a held folder) parsed, or null: read only when it is a regular file of at most
 * SOUND_LIMITS.manifestBytes (lstat; then opened without following a link or waiting on a FIFO, fstat, and read no
 * further than one byte past the bound).
 */
function readManifestFile(path) {
  const max = SOUND_LIMITS.manifestBytes;
  let fd;
  try {
    const seen = lstatSync(path);
    if (!seen.isFile() || seen.size > max) return null;
    fd = openSync(path, OPEN_MANIFEST);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(max + 1);
    let got = 0;
    for (let n; got < buf.length && (n = readSync(fd, buf, got, buf.length - got, got)) > 0;) got += n;
    if (got > max) return null;
    return JSON.parse(buf.toString('utf8', 0, got));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** A clip as the manifest may list it, a fresh object; null for anything else. */
function cleanClip(c) {
  if (!isRecord(c) || !isSectionId(c.id)) return null;
  if (typeof c.file !== 'string' || !CLIP_FILE_RE.test(c.file) || !c.file.startsWith(`voice-${c.id}.`)) return null;
  if (!finite(c.at) || c.at < 0 || !finite(c.seconds) || c.seconds <= 0) return null;
  if (typeof c.key !== 'string' || !KEY_RE.test(c.key) || typeof c.text !== 'string' || !Array.isArray(c.cues)) return null;
  const cues = [];
  for (const q of c.cues) {
    if (!isRecord(q) || !finite(q.t) || typeof q.text !== 'string') return null;
    cues.push({ t: q.t, text: q.text });
  }
  return { id: c.id, file: c.file, key: c.key, at: c.at, seconds: c.seconds, text: c.text, cues };
}

/** The music as the manifest may list it, a fresh object; null for anything else. */
function cleanMusic(m) {
  if (!isRecord(m) || typeof m.file !== 'string' || !MUSIC_FILE_RE.test(m.file)) return null;
  if (!finite(m.seconds) || m.seconds <= 0 || !finite(m.gain) || m.gain <= 0) return null;
  if (typeof m.key !== 'string' || !KEY_RE.test(m.key)) return null;
  return { file: m.file, key: m.key, seconds: m.seconds, gain: m.gain, prompt: typeof m.prompt === 'string' ? m.prompt : '' };
}

/** The parsed manifest checked: exactly `{ v: 1, voice, clips, music }`, each part fresh; null when it is not `v: 1`.
 *  A second clip of one scene is left out. */
function cleanManifest(raw) {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const v = raw.voice;
  const voice = isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.model === 'string'
    ? { id: v.id, name: v.name, model: v.model }
    : null;
  const clips = [];
  const ids = new Set();
  for (const c of Array.isArray(raw.clips) ? raw.clips : []) {
    const clip = cleanClip(c);
    if (!clip || ids.has(clip.id)) continue;
    ids.add(clip.id);
    clips.push(clip);
  }
  return { v: 1, voice, clips, music: cleanMusic(raw.music) };
}

/** Whether `<base>/<file>` is a regular file (lstat in the held folder: a link is not there). */
function isThere(base, file) {
  try {
    return lstatSync(join(base, file)).isFile();
  } catch {
    return false;
  }
}

/**
 * The manifest of `<workDir>/assets/sound/` and which of the files it lists are there, read in one held folder
 * (readFolder: a level that is a link or missing reads as nothing). Any throw (EACCES on a level) reads as nothing.
 * @returns {{ manifest: object, there: Set<string> }|null}
 */
function look(workDir) {
  try {
    return readFolder(workDir, SOUND_PARTS, (base) => {
      const manifest = cleanManifest(readManifestFile(join(base, SOUND_MANIFEST)));
      if (!manifest) return null;
      const files = [...manifest.clips.map((c) => c.file), ...(manifest.music ? [manifest.music.file] : [])];
      return { manifest, there: new Set(files.filter((f) => isThere(base, f))) };
    });
  } catch {
    return null;
  }
}

/**
 * The design's sound manifest (SPEC §5), read as an agent may have written it: null when `assets/sound` or the
 * manifest is not there, is a link, a FIFO or another non-file, is bigger than SOUND_LIMITS.manifestBytes, is not JSON
 * or not `v: 1`. Otherwise a fresh `{ v: 1, voice, clips, music }` holding only the clips and music that check out.
 * @param {string} workDir the design's work/ (designWorkDir)
 */
export function readSoundManifest(workDir) {
  return look(workDir)?.manifest ?? null;
}

/**
 * What a video plays (SPEC §5 Tracks): the manifest's clips whose scene is in `plan`, whose scene's `say` is the clip's
 * `text` (a clip plays only for the words the plan now holds) and whose file is there, in plan order, each starting at
 * film time `round3(the scenes before it + at)`; and the music when its file is there.
 * @param {string} workDir
 * @param {object|null} plan
 * @returns {{ clips: { id, file, start, seconds }[], music: { file, seconds, gain }|null }|null} null for a plan that
 *   is not a video's, no manifest, or nothing to play
 */
export function soundTracks(workDir, plan) {
  if (plan?.kind !== 'video') return null;
  const seen = look(workDir);
  if (!seen) return null;
  const { manifest, there } = seen;
  const byId = new Map(manifest.clips.map((c) => [c.id, c]));
  const clips = [];
  let before = 0;
  for (const section of Array.isArray(plan.sections) ? plan.sections : []) {
    const c = byId.get(section?.id);
    if (c && typeof section.say === 'string' && section.say === c.text && there.has(c.file)) {
      clips.push({ id: c.id, file: c.file, start: round3(before + c.at), seconds: c.seconds });
    }
    before += durationOf(section);
  }
  const m = manifest.music;
  const music = m && there.has(m.file) ? { file: m.file, seconds: m.seconds, gain: m.gain } : null;
  return clips.length || music ? { clips, music } : null;
}

/**
 * A clip's captions: one cue per sentence (a word ending in `.`, `!`, `?` or `…` ends one), starting at its first
 * word's time plus `at`; words after the last sentence's end make a last cue. No words: one cue of the whole text.
 * @param {string} text
 * @param {{ w: string, t0: number }[]} words
 * @param {number} at where the clip starts in its scene
 * @returns {{ t: number, text: string }[]}
 */
export function sentenceCues(text, words, at) {
  const list = Array.isArray(words) ? words.filter((w) => typeof w?.w === 'string' && finite(w.t0)) : [];
  if (!list.length) return [{ t: at, text }];
  const cues = [];
  let sentence = [];
  const close = () => {
    cues.push({ t: round3(sentence[0].t0 + at), text: sentence.map((w) => w.w).join(' ') });
    sentence = [];
  };
  for (const w of list) {
    sentence.push(w);
    if (SENTENCE_END_RE.test(w.w)) close();
  }
  if (sentence.length) close();
  return cues;
}

/**
 * Makes each scene fit its voice (SPEC D9): it needs VOICE_LEAD + the clip + VOICE_TAIL, rounded up to 0.1 s. A scene
 * shorter than that grows; one that would pass 600 s keeps its length and its id is listed in `dropped`.
 * @param {object} plan
 * @param {Map<string, { seconds: number }>} clips by section id
 * @returns {{ plan: object, grown: { id, from, to }[], dropped: string[] }} a new plan; the input is not changed
 */
export function fitDurations(plan, clips) {
  const grown = [];
  const dropped = [];
  const sections = (Array.isArray(plan?.sections) ? plan.sections : []).map((section) => {
    const clip = clips?.get(section.id);
    if (!clip) return { ...section };
    const need = round3(VOICE_LEAD + clip.seconds + VOICE_TAIL);
    if (need > MAX_SCENE) {
      dropped.push(section.id);
      return { ...section };
    }
    const to = Math.ceil(need * 10 - 1e-9) / 10;
    if (!(to > section.duration)) return { ...section };
    grown.push({ id: section.id, from: section.duration, to });
    return { ...section, duration: to };
  });
  return { plan: { ...plan, sections }, grown, dropped };
}

/** Removes `<base>/<file>`, setting aside what cannot be removed; a throw is logged and the write goes on. */
function removeQuietly(designId, base, file) {
  try {
    removeWorkEntry(designId, base, file, { aside: true });
  } catch (err) {
    warn(`${file} could not be removed: left in place`, err);
  }
}

/**
 * One write of `work/assets/sound/` (P8): the folder made a real folder of worca's (a link or file planted at `assets`
 * or `sound` is replaced, never written through), then in that one held folder `drop`'s files removed, `put`'s file
 * placed whole with its other type removed, and the manifest placed last, so a file and the manifest that lists it land
 * together. Synchronous: the held folders close when the callback returns.
 * @param {string} designId
 * @param {string} text the manifest's JSON
 * @param {{ put?: { file: string, bytes: Uint8Array, other: string }|null, drop?: string[] }} [what]
 */
function writeSound(designId, text, { put = null, drop = [] } = {}) {
  inWorkFolder(designId, SOUND_PARTS, { create: true }, (base) => {
    for (const file of drop) removeQuietly(designId, base, file);
    if (put) {
      placeWorkBytes(designId, base, put.file, put.bytes);
      removeQuietly(designId, base, put.other);
    }
    placeWorkBytes(designId, base, SOUND_MANIFEST, Buffer.from(text));
  });
}

/** Whether a call's answer is sound worca keeps: an mp3 or wav of some length. */
const isSound = (got) => SOUND_EXTS.includes(got?.ext) && got.bytes instanceof Uint8Array && finite(got.seconds) && got.seconds > 0;

/**
 * The round's sound stage (SPEC D8-D10, D16, D17): prunes the clips the plan no longer wants, and the music set to
 * none or to another description (one write, before any call), reuses each clip whose key is unchanged and whose file is there, makes the others (at most `atOnce` calls at
 * once), books each answer as it arrives and writes it with the manifest, grows the scenes their voices need, then
 * keeps or makes the music for the film's length. A refusal is a reason in `failed`, never a throw: 401 stops every
 * call left, 402 and 403 the voice calls left. Only an abort rejects, once every call in flight has settled and been
 * written; what was made stays listed.
 * @param {{ designId: string, workDir: string, plan: object, sound: object,
 *   speak: (o: object) => Promise<object>, compose: (o: object) => Promise<object>, signal?: AbortSignal,
 *   book: (usd: number, model: string) => void, atOnce?: number }} o
 * @returns {Promise<{ plan: object, grown: { id, from, to }[], clips: Map<string, object>, music: object|null,
 *   made: { voice: number, reused: number, music: boolean }, failed: { what: string, id?: string, reason: string }[] }>}
 */
export async function makeSound({ designId, workDir, plan, sound, speak, compose, signal, book, atOnce = SOUND_LIMITS.atOnce }) {
  const voiceId = sound?.voice?.id;
  const voice = { id: voiceId, name: sound?.voice?.name, model: SOUND_SERVICE.voiceModel };
  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  const wanted = typeof voiceId === 'string' ? sections.filter((s) => isSectionId(s?.id) && hasSay(s)) : [];
  const jobs = wanted.map((s, i) => ({
    id: s.id,
    text: s.say,
    key: clipKey({ voiceId, model: SOUND_SERVICE.voiceModel, text: s.say }),
    previousText: wanted[i - 1]?.say,
    nextText: wanted[i + 1]?.say,
  }));
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const prompt = musicPrompt(sound?.music);
  const musicWanted = prompt === null ? null : musicKey({ prompt, model: SOUND_SERVICE.musicModel });
  const failed = [];
  const made = { voice: 0, reused: 0, music: false };
  /** The scenes whose clip was made by this call. */
  const madeNow = new Set();
  /** A voice failure, each reason listed once. */
  const voiceFail = (id, reason) => {
    if (failed.some((f) => f.what === 'voice' && f.reason === reason)) return;
    failed.push(id == null ? { what: 'voice', reason } : { what: 'voice', id, reason });
  };
  const bookQuietly = (got, what) => {
    try {
      book(got?.costUsd, got?.model);
    } catch (err) {
      warn(`${what} was not booked`, err);
    }
  };

  // 1. What is there. `clips` and `music` are what the manifest lists from here on, files there only.
  const seen = look(workDir);
  const there = seen?.there ?? new Set();
  let clips = new Map();
  let music = seen?.manifest.music && there.has(seen.manifest.music.file) ? seen.manifest.music : null;
  let last = seen ? JSON.stringify(seen.manifest) : null;
  const textOf = (c, m) => JSON.stringify({ v: 1, voice, clips: jobs.filter((j) => c.has(j.id)).map((j) => c.get(j.id)), music: m });
  const save = (c, m, what) => {
    const text = textOf(c, m);
    if (Buffer.byteLength(text) > SOUND_LIMITS.manifestBytes) throw new Error(`the manifest would pass ${SOUND_LIMITS.manifestBytes} bytes`);
    writeSound(designId, text, what);
    last = text;
  };

  // 2. Prune first: only a wanted scene's own clip of its wanted key stays, so a remake that fails or is cut never
  // leaves a stale voice; the music goes the same way once it is set to none or to another description. A listed
  // file that is gone leaves the list too, so the manifest names only what is there.
  const pruned = [];
  let gone = false;
  for (const c of seen?.manifest.clips ?? []) {
    const job = jobOf.get(c.id);
    if (!job || c.key !== job.key || c.text !== job.text) pruned.push(c.file);
    else if (there.has(c.file)) clips.set(c.id, c);
    else gone = true;
  }
  const listed = seen?.manifest.music ?? null;
  if (listed && listed.key !== musicWanted) {
    pruned.push(...SOUND_EXTS.map((ext) => `music.${ext}`));
    music = null;
  } else if (listed && !music) {
    gone = true;
  }
  if (pruned.length || gone) {
    try {
      save(clips, music, { drop: pruned });
    } catch (err) {
      warn('the old sound could not be removed', err);
      voiceFail(null, REASONS.notSaved);
    }
  }

  // 3-4. Reuse what is there; make the rest.
  const sem = createSemaphore(atOnce);
  let stop = null;
  let aborted = null;
  const todo = jobs.filter((j) => !clips.has(j.id));
  const makeClip = async (job) => {
    let held = false;
    try {
      await sem.acquire({ signal });
      held = true;
      if (stop) return;
      let got;
      try {
        got = await speak({ text: job.text, voiceId, previousText: job.previousText, nextText: job.nextText, signal });
      } catch (err) {
        if (isAbort(err)) {
          aborted ??= err;
        } else if (err?.name === 'SoundError') {
          voiceFail(job.id, err.message);
          if (err.status === 401) stop = 'all';
          else if ((err.status === 402 || err.status === 403) && stop !== 'all') stop = 'voice';
        } else {
          warn(`the voice for ${job.id} was not made`, err);
          voiceFail(job.id, REASONS.unreachable);
        }
        return;
      }
      // The bytes arrived and were paid for: booked, checked and written whatever the signal says meanwhile (a booking
      // may itself pause the round).
      bookQuietly(got, `the voice for ${job.id}`);
      if (!isSound(got)) {
        voiceFail(job.id, REASONS.notSound);
        return;
      }
      const clip = {
        id: job.id, file: `voice-${job.id}.${got.ext}`, key: job.key, at: VOICE_LEAD, seconds: got.seconds, text: job.text,
        cues: sentenceCues(job.text, got.words, VOICE_LEAD),
      };
      const next = new Map(clips).set(job.id, clip);
      try {
        save(next, music, { put: { file: clip.file, bytes: got.bytes, other: `voice-${job.id}.${otherExt(got.ext)}` } });
      } catch (err) {
        warn(`the voice for ${job.id} was not saved`, err);
        voiceFail(job.id, REASONS.notSaved);
        return;
      }
      clips = next;
      madeNow.add(job.id);
    } catch (err) {
      if (isAbort(err)) aborted ??= err;
      else {
        warn(`the voice for ${job.id} was not made`, err);
        voiceFail(job.id, REASONS.unreachable);
      }
    } finally {
      if (held) sem.release();
    }
  };
  await Promise.all(todo.map(makeClip));
  if (aborted) throw aborted;
  if (signal?.aborted) throw abortError();

  // 5. Each scene fits its voice; a voice no scene can hold goes, with its file.
  const fit = fitDurations(plan, clips);
  if (fit.dropped.length) {
    const next = new Map(clips);
    for (const id of fit.dropped) next.delete(id);
    try {
      save(next, music, { drop: fit.dropped.map((id) => clips.get(id).file) });
    } catch (err) {
      warn('a voice longer than a scene could not be removed', err);
      voiceFail(null, REASONS.notSaved);
    }
    clips = next;
    for (const id of fit.dropped) failed.push({ what: 'voice', id, reason: REASONS.tooLong(id) });
  }

  // 6. The music follows the film. Music set to none or to another description went in step 2: what is left is the
  // wanted description's track, kept while the film is not more than MUSIC_KEEP_SLACK longer (or it is a whole
  // musicMaxSec track, which loops).
  const length = round3(fit.plan.sections.reduce((t, s) => t + durationOf(s), 0));
  if (prompt !== null && stop !== 'all') {
    const max = SOUND_LIMITS.musicMaxSec;
    const keep = music && (length <= music.seconds + MUSIC_KEEP_SLACK || music.seconds >= max - MUSIC_KEEP_SLACK);
    if (!keep) {
      let got = null;
      try {
        got = await compose({ prompt, seconds: Math.min(max, Math.max(SOUND_LIMITS.musicMinSec, length)), signal });
      } catch (err) {
        if (isAbort(err)) throw err;
        if (err?.name === 'SoundError') {
          failed.push({ what: 'music', reason: err.message });
        } else {
          warn('the music was not made', err);
          failed.push({ what: 'music', reason: REASONS.unreachable });
        }
      }
      if (got) {
        bookQuietly(got, 'the music');
        if (!isSound(got)) {
          failed.push({ what: 'music', reason: REASONS.notSound });
        } else {
          const track = { file: `music.${got.ext}`, key: musicWanted, seconds: got.seconds, gain: MUSIC_GAIN, prompt };
          try {
            save(clips, track, { put: { file: track.file, bytes: got.bytes, other: `music.${otherExt(got.ext)}` } });
            music = track;
            made.music = true;
          } catch (err) {
            warn('the music was not saved', err);
            failed.push({ what: 'music', reason: REASONS.notSaved });
          }
        }
      }
    }
  }

  // 7. Written last once more, when it says something new; nothing made where there was nothing.
  if (textOf(clips, music) !== last && (last !== null || clips.size || music)) {
    try {
      save(clips, music);
    } catch (err) {
      warn('the manifest was not saved', err);
      voiceFail(null, REASONS.notSaved);
    }
  }
  // A pause the music's booking raised rejects as the voice's does (after step 4): the track paid for stays listed.
  if (signal?.aborted) throw abortError();
  // What the film has now: a clip step 5 dropped is neither made nor reused.
  made.voice = [...madeNow].filter((id) => clips.has(id)).length;
  made.reused = clips.size - made.voice;
  return {
    plan: fit.plan,
    grown: fit.grown,
    clips: new Map(jobs.filter((j) => clips.has(j.id)).map((j) => [j.id, clips.get(j.id)])),
    music,
    made,
    failed,
  };
}

/** Removes `work/assets/sound/` and what it holds, never a link's target (inWorkFolder, removeWorkEntry: the
 *  removeSectionDir idiom). Nothing there is no error; a folder worca cannot empty (an agent's locked folder inside it)
 *  is set aside, as every other removal of an agent-writable folder is. */
export function removeSound(designId) {
  inWorkFolder(designId, ['assets'], {}, (assets) => removeWorkEntry(designId, assets, 'sound', { aside: true }));
}
