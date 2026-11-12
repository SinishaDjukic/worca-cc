// src/core/design/pictures.mjs
// Design pictures (SPEC D10, D10a, D16): the files of a made picture. The design's own file is
// `work/assets/made/<name>.<ext>`, one per name, replaced whole by a remake (placeWorkBytes: never truncated or written
// through a link). worca keeps one more copy of every made picture by its row id, `<design>/made/<id>.<ext>`
// (madeKeptDir: beside versions/, outside work/, never exported or snapshotted, closed to worca by registry.claim),
// which the chat's tiles and the viewer read back (readKeptPicture) whatever later happens to the file in work/.
// A round's picture desk (createPictureDesk, SPEC §5) makes them, answering the kit command's asks in work/.pictures/.

import { randomBytes } from 'node:crypto';
import {
  closeSync, constants as fsc, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DESIGN_PICTURE_NAME_RE } from '../../shared/design-names.mjs';
import { IMAGE_SHAPES, IMAGES_MAX_PROMPT } from '../../shared/image-services.mjs';
import { IMAGES_MAX_BYTES, IMAGES_TIMEOUT_MS, ImagesError, pictureSize } from '../images.mjs';
import { DesignError } from './ids.mjs';
import { inWorkFolder, madeKeptDir, placeWorkBytes, removeWorkEntry } from './paths.mjs';
import { createSemaphore } from './semaphore.mjs';

/** The file types a made picture is kept in, read from its bytes (SPEC D16). */
export const PICTURE_EXTS = Object.freeze(['png', 'jpg', 'webp']);
/** The largest picture worca keeps (SPEC D8): the image service's own bound. */
export const PICTURE_BYTES_MAX = IMAGES_MAX_BYTES;
/** Each file type's content type. */
export const PICTURE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' });

/** Pictures in the making at once in one round (SPEC D8). */
export const PICTURE_AT_ONCE = 3;
/** Pictures one round makes, a remake included (SPEC D8). */
export const PICTURE_PER_ROUND = 40;
/** The largest ask file the desk reads, in bytes (SPEC D8). */
export const PICTURE_ASK_MAX = 16384;
/** How long one call to the image service may take (SPEC D8): Part A's own bound. */
export const PICTURE_CALL_MS = IMAGES_TIMEOUT_MS;
/** The most failed rows one desk writes (LEAD-CALLS: a row bound, not a money cap). Past it a failed ask has no row:
 *  a refusal is answered in its done file only, and an ask whose `making` frame went out also ends with a `failed`
 *  frame (`id: null`), so its tile closes. */
export const PICTURE_FAILED_ROWS = 40;

const OFF = 'pictures are off for this design';
const SHAPE = 'the shape must be wide, tall or square';
const PROMPT = 'say what the picture shows';
const LONG = `the description is longer than ${IMAGES_MAX_PROMPT} characters`;

/** What the kit command prints after `picture: ` (SPEC §7, word for word; `{name}` stands for the picture's name). The
 *  command loads only node: built-ins, so it spells them out itself; a test keeps the two equal. */
export const KIT_REASONS = Object.freeze({
  off: OFF,
  name: 'the name must be lower-case letters, digits and hyphens, at most 40',
  shape: SHAPE,
  prompt: PROMPT,
  long: LONG,
  making: 'still in the making. Run node .kit/picture.mjs {name} to wait for it',
  unknown: 'no picture named {name} is in the making',
});

/** The reasons the desk writes into a done file and a failed row (SPEC §7, word for word). */
export const DESK_REASONS = Object.freeze({
  stopped: 'the round stopped',
  notPicture: 'the image service answered with something that is not a picture',
  unreachable: 'the image service could not be reached',
  notSaved: 'the picture could not be saved',
  perRound: (n = PICTURE_PER_ROUND) => `this round has made its ${n} pictures`,
  off: OFF,
  shape: SHAPE,
  prompt: PROMPT,
  long: LONG,
});

const OPEN_KEPT = fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0);
/** An ask is an agent's file: never followed (no such flag on Windows: lstat first), never waited on as a FIFO. */
const OPEN_ASK = fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0);
/** `<name>.ask.json`: the only names in work/.pictures/ the desk reads (the command's dot temps and the done files are
 *  left alone). */
const ASK_FILE_RE = /^(.+)\.ask\.json$/;
/** The longest `at` an ask may carry (an ISO time is 24). */
const AT_MAX = 40;

/** `<id>.<ext>`, a kept copy's name: `id` a row id (a whole number from 1), `ext` one of PICTURE_EXTS; else null. */
function keptName(id, ext) {
  return Number.isSafeInteger(id) && id >= 1 && PICTURE_EXTS.includes(ext) ? `${id}.${ext}` : null;
}

/**
 * Saves a made picture as the design's file `work/assets/made/<name>.<ext>` (the folder made if missing, reached
 * through no link an agent planted: inWorkFolder), replaced whole if there (placeWorkBytes); the same name in either
 * other type is removed, so a name has one file. Once the new file is in place the save stands: an old type that
 * cannot be removed (an agent's locked folder at its name, a Windows program holding it) is set aside, or left, and
 * logged.
 * @param {{ designId: string, name: string, ext: string, bytes: Uint8Array }} picture `name` a picture name
 *   (DESIGN_PICTURE_NAME_RE), `ext` one of PICTURE_EXTS
 * @returns {string} `assets/made/<name>.<ext>`, with `/` on every system
 * @throws {DesignError} BAD_REQUEST for a name or type that is not one, before any path is made; a failed write of
 *   the new file
 */
export function savePicture({ designId, name, ext, bytes }) {
  if (typeof name !== 'string' || !DESIGN_PICTURE_NAME_RE.test(name) || !PICTURE_EXTS.includes(ext)) {
    throw new DesignError('BAD_REQUEST', `${JSON.stringify(String(name))}.${String(ext)} is not a picture name`);
  }
  const file = `${name}.${ext}`;
  inWorkFolder(designId, ['assets', 'made'], { create: true }, (base) => {
    placeWorkBytes(designId, base, file, bytes);
    for (const other of PICTURE_EXTS) {
      if (other === ext) continue;
      try {
        removeWorkEntry(designId, base, `${name}.${other}`, { aside: true });
      } catch (err) {
        console.warn(`[worca-design] ${name}.${other} could not be removed (${err.code ?? err.message}): left in place`);
      }
    }
  });
  return `assets/made/${file}`;
}

/**
 * Keeps worca's copy of a made picture, `<madeKeptDir>/<id>.<ext>`: written as `.<id>.<8 hex>.tmp` (a new file, mode
 * 0600) and renamed over the name. The folder (0700) is made for a design from before pictures, one level only: a
 * design deleted meanwhile is never brought back, the write fails (ENOENT).
 * @param {{ designId: string, id: number, ext: string, bytes: Uint8Array }} picture `id` the picture's row id
 * @throws {DesignError} BAD_REQUEST for an id that is not a whole number from 1 or a type not in PICTURE_EXTS; a
 *   failed write (the temp is removed first)
 */
export function keepPicture({ designId, id, ext, bytes }) {
  const file = keptName(id, ext);
  if (!file) throw new DesignError('BAD_REQUEST', `${JSON.stringify(String(id))}.${String(ext)} is not a kept picture`);
  const dir = madeKeptDir(designId);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const tmp = join(dir, `.${id}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(tmp, join(dir, file));
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* the folder may be gone */ }
    throw err;
  }
}

/**
 * The bytes of a made picture's kept copy, by its row's id and type: the path is built from those two, checked, never
 * from a URL. Opened without following a link or waiting on a FIFO, and read only when it is a regular file of at
 * most PICTURE_BYTES_MAX.
 * @param {string} designId
 * @param {{ id: number, ext: string }} row
 * @returns {Buffer|null} null for a bad id or type, a copy that is not there or cannot be opened (never a throw: an
 *   fs error's message carries the server path), or one that is not such a file
 */
export function readKeptPicture(designId, { id, ext }) {
  const file = keptName(id, ext);
  if (!file) return null;
  let fd;
  try {
    fd = openSync(join(madeKeptDir(designId), file), OPEN_KEPT);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > PICTURE_BYTES_MAX) return null;
    const buf = Buffer.allocUnsafe(st.size);
    let n = 0;
    for (let r; n < st.size && (r = readSync(fd, buf, n, st.size - n, n)) > 0;) n += r;
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * The ask at `path`, `<name>.ask.json` with `name` checked already: an agent's file, so read only when it is a regular
 * file of at most PICTURE_ASK_MAX bytes (lstat; then opened without following a link or waiting on a FIFO, fstat, and
 * read no further than one byte past the bound), holding `{ v: 1, name, at }` with its own name and `at` text of at
 * most AT_MAX. A `shape` or `prompt` that is not text reads as '', which the desk refuses; nothing in it makes a path.
 * @param {string} path
 * @param {string} name
 * @returns {{ name: string, at: string, shape: string, prompt: string }|null} null for anything else
 */
function readAsk(path, name) {
  let fd;
  try {
    const seen = lstatSync(path);
    if (!seen.isFile() || seen.size > PICTURE_ASK_MAX) return null;
    fd = openSync(path, OPEN_ASK);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > PICTURE_ASK_MAX) return null;
    const buf = Buffer.alloc(PICTURE_ASK_MAX + 1);
    let got = 0;
    for (let n; got < buf.length && (n = readSync(fd, buf, got, buf.length - got, got)) > 0;) got += n;
    if (got > PICTURE_ASK_MAX) return null;
    const ask = JSON.parse(buf.toString('utf8', 0, got));
    if (!ask || typeof ask !== 'object' || Array.isArray(ask) || ask.v !== 1 || ask.name !== name) return null;
    if (typeof ask.at !== 'string' || ask.at.length > AT_MAX) return null;
    const text = (v) => (typeof v === 'string' ? v : '');
    return { name, at: ask.at, shape: text(ask.shape), prompt: text(ask.prompt) };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * A round's picture desk (SPEC §5, D8): it answers the kit command's asks in `work/.pictures/` for one build. Each ask
 * (`name` + `at`) is handled once, one at a time per name, at most `maxAtOnce` calls at once: refused, or made by
 * `generate`, checked to be a picture (magic bytes, size, the type the answer names; D16: its width and height), booked
 * once, saved as the design's file, recorded as a row and kept by the row's id; then answered with
 * `<name>.done.json` (`{ v: 1, name, at, ok: true, file, w, h }` or `{ v: 1, name, at, ok: false, reason }`, a §7
 * reason) and a `design-picture` frame. `file` is always `assets/made/<name>.<ext>`, with `/` on every system.
 * Nothing a callback throws escapes: each `emit`, `book`, `record` and `keep` is logged on its own, and the steps after
 * it still run, the done file included.
 * @param {object} o
 * @param {string} o.designId
 * @param {string} o.buildId the round's build, named in the log (`record` and `emit` add it to the row and the frame)
 * @param {string} [o.workDir] the design's work/ (designWorkDir), which the desk reaches by `designId` (inWorkFolder)
 * @param {(o: { prompt: string, shape: string, signal: AbortSignal }) => Promise<{ bytes: Buffer, ext: string,
 *   model: string, ms: number, costUsd: number }>} o.generate rejects with an error named AbortError when `signal`
 *   stopped it, else with an ImagesError whose message is a §7 reason
 * @param {(o: { name: string, ext: string, bytes: Buffer }) => unknown} o.save the design's file (savePicture)
 * @param {(o: { id: number, ext: string, bytes: Buffer }) => unknown} o.keep the kept copy (keepPicture)
 * @param {(o: { costUsd: number, model: string }) => unknown} o.book once per made picture
 * @param {(row: object) => { id: number }} o.record the row without its design, build and round (addPicture)
 * @param {(frame: object) => unknown} o.emit a `design-picture` frame's own fields
 * @param {number} [o.maxAtOnce] calls at once (PICTURE_AT_ONCE)
 * @param {number} [o.perRound] pictures the round pays for (PICTURE_PER_ROUND): one booked but not saved counts
 * @param {number} [o.pollMs] how often `work/.pictures/` is looked at (a poll: a watch would hold a handle on work/)
 * @param {number} [o.madeBefore] what the round made before a Continue, so the 40 is not reset
 * @param {() => boolean} [o.allowed] the switch and the service, asked before every ask
 * @returns {{ start: () => void, close: () => Promise<void>, readonly made: number }} `made`: this desk's pictures
 */
export function createPictureDesk({
  designId, buildId, generate, save, keep, book, record, emit, maxAtOnce = PICTURE_AT_ONCE,
  perRound = PICTURE_PER_ROUND, pollMs = 400, madeBefore = 0, allowed = () => true,
}) {
  const sem = createSemaphore(maxAtOnce);
  const controller = new AbortController();
  const { signal } = controller;
  /** `name\nat` of every ask taken: none is made twice. */
  const handled = new Set();
  /** The last handler of each name: a newer ask under it waits for that one to end. */
  const lines = new Map();
  /** Every handler not yet ended, which close() awaits. */
  const running = new Set();
  /** Each ask file looked at by the last look and kept: `ino:size:mtimeMs`, so an unchanged one is not read again. */
  let looked = new Map();
  let timer = null;
  let closed = false;
  let closing = null;
  let made = 0;
  /** Calls booked: what the round's 40 counts, a picture that could not be saved included (the service was paid). */
  let paid = 0;
  let inMaking = 0;
  let failedRows = 0;

  const warn = (what, err) => console.warn(`[worca-design] picture desk ${buildId}: ${what} (${err?.message ?? err})`);
  /** Runs one callback; a throw is logged and answers null. */
  const guarded = (what, fn) => {
    try {
      return fn();
    } catch (err) {
      warn(what, err);
      return null;
    }
  };
  /** Writes the done file in the held `base`: a dot temp renamed over the name (placeWorkBytes: mode 0660, so a hosted
   *  agent reads it through the group). */
  const writeDone = (base, body) => {
    placeWorkBytes(designId, base, `${body.name}.done.json`, Buffer.from(JSON.stringify(body)));
  };
  const answer = (body) => guarded(`${body.name}: the answer`, () => {
    inWorkFolder(designId, ['.pictures'], {}, (base) => writeDone(base, body));
  });
  const drop = (base, file) => guarded(`${file}: the removal`, () => {
    removeWorkEntry(designId, base, file, { aside: true });
  });
  const isAllowed = () => {
    try {
      return Boolean(allowed());
    } catch (err) {
      warn('the switch', err);
      return false;
    }
  };

  /** A failed ask: its row (while fewer than PICTURE_FAILED_ROWS), then the done file, then a `failed` frame with the
   *  row's id, sent for a row and for an ask whose `making` frame went out. */
  function fail({ name, at, shape, prompt }, reason, { ms = null, costUsd = null, model = null, making = false } = {}) {
    let row = null;
    const rowed = failedRows < PICTURE_FAILED_ROWS;
    if (rowed) {
      failedRows += 1;
      row = guarded(`${name}: the row`, () => record({
        name, shape, prompt, model, state: 'failed', file: null, w: null, h: null, costUsd, ms, reason,
      }));
    }
    answer({ v: 1, name, at, ok: false, reason });
    if (rowed || making) {
      guarded(`${name}: the frame`, () => emit({
        id: row?.id ?? null, name, shape, state: 'failed', prompt, file: null, w: null, h: null, model, costUsd, ms,
        reason,
      }));
    }
  }

  /** Why a call ended without an answer: the desk's stop, a §7 reason, else (a bug, logged) `unreachable`. */
  function reasonOf(name, err) {
    if (signal.aborted || err?.name === 'AbortError') return DESK_REASONS.stopped;
    if (err instanceof ImagesError && typeof err.message === 'string' && err.message) return err.message;
    warn(`${name}: the call`, err);
    return DESK_REASONS.unreachable;
  }

  async function handle(ask) {
    const { name, at, shape, prompt } = ask;
    if (signal.aborted) {
      answer({ v: 1, name, at, ok: false, reason: DESK_REASONS.stopped });
      return;
    }
    // What the store would refuse: answered in the done file only (the command refuses both before it asks).
    if (!IMAGE_SHAPES.includes(shape)) {
      answer({ v: 1, name, at, ok: false, reason: DESK_REASONS.shape });
      return;
    }
    if (prompt.length > IMAGES_MAX_PROMPT) {
      answer({ v: 1, name, at, ok: false, reason: DESK_REASONS.long });
      return;
    }
    let refused = null;
    if (!isAllowed()) refused = DESK_REASONS.off;
    else if (!prompt.trim()) refused = DESK_REASONS.prompt;
    else if (paid + inMaking >= perRound - madeBefore) refused = DESK_REASONS.perRound(perRound);
    if (refused) {
      fail(ask, refused);
      return;
    }
    inMaking += 1;
    let held = false;
    try {
      guarded(`${name}: the frame`, () => emit({ name, shape, state: 'making', prompt }));
      let got = null;
      let ms = null;
      let reason = null;
      try {
        await sem.acquire({ signal });
        held = true;
        if (signal.aborted) {
          reason = DESK_REASONS.stopped;
        } else {
          const t0 = performance.now();
          try {
            got = await generate({ prompt, shape, signal });
          } finally {
            ms = Math.round(performance.now() - t0);
          }
        }
      } catch (err) {
        reason = reasonOf(name, err);
      }
      if (reason) {
        fail(ask, reason, { ms, making: true });
        return;
      }
      // An answer that came is finished whatever happens meanwhile: a stop now aborts nothing that was paid for.
      // Its bytes are the service's: a check that throws on them reads as not a picture, so the ask is still answered.
      let size = null;
      try {
        size = Buffer.isBuffer(got?.bytes) && got.bytes.length <= PICTURE_BYTES_MAX ? pictureSize(got.bytes) : null;
      } catch (err) {
        warn(`${name}: the answer's bytes`, err);
      }
      if (!size || size.ext !== got.ext) {
        fail(ask, DESK_REASONS.notPicture, { ms, making: true });
        return;
      }
      const { ext, w, h } = size;
      const { costUsd, model } = got;
      if (Number.isSafeInteger(got.ms) && got.ms >= 0) ms = got.ms;
      // Book, save, record and keep in one synchronous stretch: a stop cannot land between the row and its copy.
      paid += 1;
      guarded(`${name}: the booking`, () => book({ costUsd, model }));
      try {
        save({ name, ext, bytes: got.bytes });
      } catch (err) {
        warn(`${name}: the save`, err);
        fail(ask, DESK_REASONS.notSaved, { ms, costUsd, model, making: true });
        return;
      }
      const file = `assets/made/${name}.${ext}`;
      const row = guarded(`${name}: the row`, () => record({
        name, shape, prompt, model, state: 'made', file, w, h, costUsd, ms, reason: null,
      }));
      if (row) guarded(`${name}: the kept copy`, () => keep({ id: row.id, ext, bytes: got.bytes }));
      answer({ v: 1, name, at, ok: true, file, w, h });
      guarded(`${name}: the frame`, () => emit({
        id: row?.id ?? null, name, shape, state: 'made', prompt, file, w, h, model, costUsd, ms, reason: null,
      }));
      made += 1;
    } finally {
      inMaking -= 1;
      if (held) sem.release();
    }
  }

  /** Takes an ask once by `name` + `at`, behind the name's handler still running, if any. */
  function take(ask) {
    const key = `${ask.name}\n${ask.at}`;
    if (handled.has(key)) return;
    handled.add(key);
    const run = (lines.get(ask.name) ?? Promise.resolve()).then(() => handle(ask)).catch((err) => warn(ask.name, err));
    lines.set(ask.name, run);
    running.add(run);
    run.then(() => {
      running.delete(run);
      if (lines.get(ask.name) === run) lines.delete(ask.name);
    });
  }

  /** One look at work/.pictures/, in a fixed order (APFS lists in hash order, tmpfs newest first): a bad ask is
   *  removed, a new one taken. All its reads and removals go through the one held folder. */
  function tick() {
    if (closed) return;
    try {
      inWorkFolder(designId, ['.pictures'], {}, (base) => {
        const kept = new Map();
        for (const file of readdirSync(base).sort()) {
          const name = ASK_FILE_RE.exec(file)?.[1];
          if (!name || !DESIGN_PICTURE_NAME_RE.test(name)) continue;
          guarded(`${file}: the look`, () => {
            const st = lstatSync(join(base, file), { throwIfNoEntry: false });
            if (!st) return;
            const mark = `${st.ino}:${st.size}:${st.mtimeMs}`;
            if (looked.get(file) === mark) {
              kept.set(file, mark);
              return;
            }
            const ask = readAsk(join(base, file), name);
            if (!ask) {
              drop(base, file);
              return;
            }
            kept.set(file, mark);
            take(ask);
          });
        }
        looked = kept;
      });
    } catch (err) {
      warn('the look', err);
    }
  }

  return {
    /** Makes work/.pictures/ and work/assets/made/ (whatever an agent put at either name is set aside or removed),
     *  clears every entry of .pictures/ (asks an earlier drive left are never made again), then polls. */
    start() {
      if (closed || timer) return;
      inWorkFolder(designId, ['.pictures'], { create: true }, (base) => {
        for (const file of readdirSync(base)) removeWorkEntry(designId, base, file, { aside: true });
      });
      inWorkFolder(designId, ['assets', 'made'], { create: true });
      timer = setInterval(tick, pollMs);
      timer.unref();
    },
    /** Idempotent. Stops the poll and aborts the desk's calls at once (a call in flight and an ask queued for a slot
     *  end `the round stopped`, booking nothing; one that already answered finishes and is booked), awaits every
     *  handler, then answers each ask on disk never taken with `the round stopped` (no row, no frame). Never
     *  rejects. */
    close() {
      if (closing) return closing;
      closed = true;
      clearInterval(timer);
      timer = null;
      controller.abort();
      closing = (async () => {
        await Promise.allSettled([...running]);
        try {
          inWorkFolder(designId, ['.pictures'], {}, (base) => {
            for (const file of readdirSync(base).sort()) {
              const name = ASK_FILE_RE.exec(file)?.[1];
              if (!name || !DESIGN_PICTURE_NAME_RE.test(name)) continue;
              const ask = readAsk(join(base, file), name);
              if (!ask) {
                drop(base, file);
                continue;
              }
              const key = `${name}\n${ask.at}`;
              if (handled.has(key)) continue;
              handled.add(key);
              const body = { v: 1, name, at: ask.at, ok: false, reason: DESK_REASONS.stopped };
              guarded(`${name}: the answer`, () => writeDone(base, body));
            }
          });
        } catch (err) {
          warn('the asks left', err);
        }
      })();
      return closing;
    },
    get made() {
      return made;
    },
  };
}
