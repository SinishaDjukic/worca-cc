// assets/design-kit/picture.mjs — have a picture made for the design (Design pictures, SPEC D4).
//
//   node .kit/picture.mjs <name> <wide|tall|square> <what it shows>
//   node .kit/picture.mjs <name>
//
// Staged as work/.kit/picture.mjs when a round has pictures on (core/design/kit.mjs stagePictureKit). The first form
// drops an ask in work/.pictures/<name>.ask.json, which the round's picture desk reads and answers with
// work/.pictures/<name>.done.json and the picture under work/assets/made/; the second form writes nothing and waits for
// the ask of that name again. It finds work/ from its own place, never from the current folder, loads only node:
// built-ins and reads no environment variable. It prints one line on stdout and ends with 0 made, 1 not made, 2 wrong
// use, 3 still in the making: it never waits longer than WAIT_MS, because an engine's shell stops a command after a
// time of its own and a picture can take longer; the ask stays and the desk goes on.
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The longest the command waits for an answer, in ms. */
const WAIT_MS = 100000;
/** How often it looks for the answer, in ms. */
const POLL_MS = 250;
/** The shapes a picture can take (worca's IMAGE_SHAPES; a test keeps them equal). */
const SHAPES = ['wide', 'tall', 'square'];
/** The longest description, in UTF-16 units (worca's IMAGES_MAX_PROMPT). */
const PROMPT_MAX = 4000;
/** A picture's name, which names its file too (worca's DESIGN_PICTURE_NAME_RE). */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** The largest ask file read back, in bytes (the desk's own bound). */
const ASK_MAX = 16384;
/** The largest answer read, in bytes. */
const DONE_MAX = 4096;
/** The most characters of a reason printed. */
const REASON_MAX = 300;
/** The file types a made picture has. */
const EXTS = ['png', 'jpg', 'webp'];
/** Windows: a rename over a file another process holds open fails for a moment; retried this often, 50 ms apart. */
const RENAME_RETRIES = 10;
const RENAME_BUSY = process.platform === 'win32' ? ['EPERM', 'EBUSY', 'EACCES'] : [];
/** Never through a link at the name itself (no such flag on Windows), never blocking on a FIFO. */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

const WORK = dirname(dirname(fileURLToPath(import.meta.url)));
const PICTURES = join(WORK, '.pictures');
const USAGE = 'Usage: node .kit/picture.mjs <name> <wide|tall|square> <what it shows>';
const OFF = 'picture: pictures are off for this design';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (n) => Number.isInteger(n) && n > 0;

/** Prints the one line and answers the exit code. */
function say(code, line) {
  process.stdout.write(`${line}\n`);
  return code;
}

/** `work/.pictures` is a real folder (a link is not one): pictures are on for this design. */
function picturesOn() {
  try {
    return lstatSync(PICTURES, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** The JSON object in the regular file `path` of at most `max` bytes: opened without following a link or waiting on a
 *  FIFO, read no further than the size it had. Null for anything else. */
function readJson(path, max) {
  let fd = null;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    for (let n; got < buf.length && (n = readSync(fd, buf, got, buf.length - got, got)) > 0;) got += n;
    const value = JSON.parse(buf.toString('utf8', 0, got));
    return isObject(value) ? value : null;
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

/** Renames `from` over `to`, retrying a Windows rename that a held file fails. */
function renameOver(from, to) {
  for (let retries = 0; ; retries += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (retries >= RENAME_RETRIES || !RENAME_BUSY.includes(err?.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/** Writes the ask as `.pictures/<name>.ask.json`: a new dot temp (never through a link), group-readable and -writable
 *  for worca when hosted, then renamed over the name. False when it could not be written. */
function writeAsk(name, ask) {
  const tmp = join(PICTURES, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o660);
    try {
      fchmodSync(fd, 0o660);
    } catch {
      // Windows has no mode bits.
    }
    const bytes = Buffer.from(JSON.stringify(ask));
    for (let off = 0; off < bytes.length;) off += writeSync(fd, bytes, off, bytes.length - off);
    closeSync(fd);
    fd = null;
    renameOver(tmp, join(PICTURES, `${name}.ask.json`));
    return true;
  } catch {
    if (fd != null) closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // Never made, or gone already.
    }
    return false;
  }
}

/** The line and code the answer in `.pictures/<name>.done.json` ends the command with, or null while there is none
 *  for an ask at or after `wantedAt` (ISO times compare in order: a later `at` is a later ask under the same name). */
function answer(name, wantedAt) {
  const done = readJson(join(PICTURES, `${name}.done.json`), DONE_MAX);
  if (!done || done.v !== 1 || done.name !== name || typeof done.at !== 'string' || done.at < wantedAt) return null;
  if (done.ok === true) {
    const ext = EXTS.find((e) => done.file === `assets/made/${name}.${e}`);
    if (!ext || !whole(done.w) || !whole(done.h)) return null;
    return [0, `${done.file}  ${done.w}×${done.h}`];
  }
  if (done.ok === false && typeof done.reason === 'string') {
    const reason = [...done.reason.replace(/[\r\n]+/g, ' ').trim()].slice(0, REASON_MAX).join('');
    if (reason) return [1, `picture: ${reason}`];
  }
  return null;
}

/** Waits up to `waitMs` for the answer to the ask made at `wantedAt`; one already there is printed at once. */
async function wait(name, wantedAt, waitMs) {
  const until = performance.now() + waitMs;
  for (;;) {
    const found = answer(name, wantedAt);
    if (found) return say(...found);
    const left = until - performance.now();
    if (left <= 0) return say(3, `picture: still in the making. Run node .kit/picture.mjs ${name} to wait for it`);
    await sleep(Math.min(POLL_MS, left));
  }
}

async function main(argv) {
  let args = argv;
  let waitMs = WAIT_MS;
  if (args[0] === '--wait-ms') {
    const n = /^[0-9]+$/.test(args[1] ?? '') ? Number(args[1]) : 0;
    if (n < 1 || n > WAIT_MS) return say(2, USAGE);
    waitMs = n;
    args = args.slice(2);
  }
  if (!args.length) return say(2, USAGE);
  const [name, shape, ...words] = args;
  if (!NAME_RE.test(name)) return say(2, 'picture: the name must be lower-case letters, digits and hyphens, at most 40');
  if (args.length === 1) {
    if (!picturesOn()) return say(1, OFF);
    const ask = readJson(join(PICTURES, `${name}.ask.json`), ASK_MAX);
    if (!ask || ask.v !== 1 || ask.name !== name || typeof ask.at !== 'string') {
      return say(1, `picture: no picture named ${name} is in the making`);
    }
    return wait(name, ask.at, waitMs);
  }
  if (!SHAPES.includes(shape)) return say(2, 'picture: the shape must be wide, tall or square');
  const prompt = words.join(' ').trim();
  if (!prompt) return say(2, 'picture: say what the picture shows');
  if (prompt.length > PROMPT_MAX) return say(2, 'picture: the description is longer than 4000 characters');
  if (!picturesOn()) return say(1, OFF);
  const at = new Date().toISOString();
  if (!writeAsk(name, { v: 1, name, shape, prompt, at })) return say(1, OFF);
  return wait(name, at, waitMs);
}

process.exitCode = await main(process.argv.slice(2));
