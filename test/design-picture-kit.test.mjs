// test/design-picture-kit.test.mjs — Design pictures (P2 Task B1): the picture kit command `.kit/picture.mjs` and its
// staging. stagePictureKit puts it in `work/.kit/` for any kind; run from any folder, it asks through
// `work/.pictures/<name>.ask.json`, waits at most 100 s for `<name>.done.json` and prints one line (SPEC D4, §5, §7).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageDesignKit, stagePictureKit, unstagePictureKit } from '../src/core/design/kit.mjs';
import { designWorkDir, PICTURE_KIT, picturesDir } from '../src/core/design/paths.mjs';
import { KIT_REASONS } from '../src/core/design/pictures.mjs';
import { IMAGE_SHAPES, IMAGES_MAX_PROMPT } from '../src/shared/image-services.mjs';
import { DESIGN_PICTURE_NAME_RE } from '../src/shared/design-names.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'pic-kit-')); dirs.push(d); return d; };

const POSIX = process.platform !== 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let work; let pics;
beforeEach(() => { work = join(tmp(), 'work'); pics = join(work, '.pictures'); mkdirSync(pics, { recursive: true }); stagePictureKit({ workDir: work }); });
const run = (args, { cwd = work } = {}) => new Promise((res) => {
  const c = spawn(process.execPath, [join(work, '.kit/picture.mjs'), ...args], { cwd }); let out = '';
  c.stdout.on('data', (b) => { out += b; }); c.on('close', (code) => res({ code, out }));
});
const waitAsk = async (name) => { for (;;) { try { return JSON.parse(readFileSync(join(pics, `${name}.ask.json`), 'utf8')); } catch { await sleep(20); } } };
const writeDone = (name, body) => { const t = join(pics, `.d${process.hrtime.bigint()}.tmp`); writeFileSync(t, JSON.stringify(body)); renameSync(t, join(pics, `${name}.done.json`)); };
const made = (name, at, w = 1536, h = 1024) => ({ v: 1, name, at, ok: true, file: `assets/made/${name}.png`, w, h });
const STILL = (name) => `picture: still in the making. Run node .kit/picture.mjs ${name} to wait for it\n`;

test('1 stagePictureKit puts the command in .kit byte for byte for any kind; a link there is replaced', async () => {
  assert.deepEqual(readFileSync(join(work, '.kit/picture.mjs')), readFileSync(PICTURE_KIT));
  assert.equal(await stageDesignKit({ kind: 'nope', workDir: tmp() }), false, 'a kind with no kit folder');
  const other = tmp(); assert.equal(stagePictureKit({ workDir: other }), true, 'still gets the command');
  if (POSIX) {
    const out = join(tmp(), 'keep.mjs'); writeFileSync(out, 'mine'); rmSync(join(other, '.kit/picture.mjs')); symlinkSync(out, join(other, '.kit/picture.mjs'));
    stagePictureKit({ workDir: other });
    assert.equal(readFileSync(out, 'utf8'), 'mine'); assert.equal(lstatSync(join(other, '.kit/picture.mjs')).isSymbolicLink(), false);
  }
});
test('1b unstagePictureKit removes the command and .pictures, keeps the rest of .kit, and logs what it cannot remove', async () => {
  const prev = process.env.WORCA_HOME; process.env.WORCA_HOME = tmp();
  const id = 'd_0123456789ab'; const w = designWorkDir(id); const kit = join(w, '.kit');
  const warned = []; const warn = console.warn; console.warn = (...a) => { warned.push(a.join(' ')); };
  try {
    unstagePictureKit({ designId: id }); mkdirSync(w, { recursive: true });
    assert.equal(await stageDesignKit({ kind: 'web', workDir: w }), true); stagePictureKit({ workDir: w });
    mkdirSync(picturesDir(id)); writeFileSync(join(picturesDir(id), 'hero.ask.json'), '{}');
    unstagePictureKit({ designId: id });
    assert.deepEqual(readdirSync(kit), ['CONTRACT.md']); assert.equal(existsSync(picturesDir(id)), false);
    unstagePictureKit({ designId: id });
    assert.deepEqual(warned, [], 'nothing there is nothing to remove');
    if (POSIX && process.getuid?.() !== 0) {
      stagePictureKit({ workDir: w }); mkdirSync(picturesDir(id)); chmodSync(kit, 0o555);
      try { unstagePictureKit({ designId: id }); } finally { chmodSync(kit, 0o755); }
      assert.ok(existsSync(join(kit, 'picture.mjs')), 'a read-only .kit keeps it');
      assert.equal(existsSync(picturesDir(id)), false, 'each removal on its own: .pictures goes all the same');
      assert.ok(warned.some((t) => t.includes('.kit/picture.mjs')), warned.join('\n'));
    }
  } finally {
    console.warn = warn;
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
test('2 wrong use: exit 2 with the §7 words, nothing written', async () => {
  for (const [args, text] of [
    [[], 'Usage: node .kit/picture.mjs <name> <wide|tall|square> <what it shows>'],
    [['--wait-ms', '0', 'hero'], 'Usage: node .kit/picture.mjs <name> <wide|tall|square> <what it shows>'],
    [['--wait-ms', '100001', 'hero'], 'Usage: node .kit/picture.mjs <name> <wide|tall|square> <what it shows>'],
    [['Hero'], 'picture: the name must be lower-case letters, digits and hyphens, at most 40'],
    [['../x', 'wide', 'x'], 'picture: the name must be lower-case letters, digits and hyphens, at most 40'],
    [['a'.repeat(41), 'wide', 'x'], 'picture: the name must be lower-case letters, digits and hyphens, at most 40'],
    [['hero', 'round', 'x'], 'picture: the shape must be wide, tall or square'],
    [['hero', 'wide', '  '], 'picture: say what the picture shows'],
    [['hero', 'wide', 'x'.repeat(4001)], 'picture: the description is longer than 4000 characters'],
  ]) assert.deepEqual(await run(args), { code: 2, out: `${text}\n` }, args.join(' '));
  assert.deepEqual(readdirSync(pics), []);
});
test('3 no .pictures folder: pictures are off, exit 1, in both forms', async () => {
  rmSync(pics, { recursive: true });
  for (const args of [['hero', 'wide', 'x'], ['hero']]) assert.deepEqual(await run(args), { code: 1, out: 'picture: pictures are off for this design\n' });
});
test('3b a link at .pictures is not a folder: pictures are off, nothing written through it', { skip: !POSIX }, async () => {
  const real = join(tmp(), 'elsewhere'); mkdirSync(real); rmSync(pics, { recursive: true }); symlinkSync(real, pics);
  assert.deepEqual(await run(['hero', 'wide', 'x']), { code: 1, out: 'picture: pictures are off for this design\n' });
  assert.deepEqual(readdirSync(real), []);
});
test('4 from another folder: the ask lands in its own work/.pictures, atomically, and the answer is printed', async () => {
  for (const words of [['A quiet studio, no text'], ['A', 'quiet', 'studio,', 'no', 'text']]) {
    const r = run(['hero', 'wide', ...words], { cwd: tmpdir() });
    const ask = await waitAsk('hero');
    assert.deepEqual(Object.keys(ask).sort(), ['at', 'name', 'prompt', 'shape', 'v']);
    assert.deepEqual([ask.v, ask.name, ask.shape, ask.prompt], [1, 'hero', 'wide', 'A quiet studio, no text'], 'quoted or loose, the same text');
    if (POSIX) assert.equal(statSync(join(pics, 'hero.ask.json')).mode & 0o777, 0o660);
    writeDone('hero', made('hero', '2000-01-01T00:00:00.000Z', 1, 1));          // an older answer: skipped
    writeDone('hero', made('hero', ask.at));
    assert.deepEqual(await r, { code: 0, out: 'assets/made/hero.png  1536×1024\n' });
    assert.deepEqual(readdirSync(pics).filter((n) => n.endsWith('.tmp')), []);
    rmSync(join(pics, 'hero.ask.json')); rmSync(join(pics, 'hero.done.json'));
  }
});
test('4b a failed answer prints its reason; a later ask under the name answers too', async () => {
  let r = run(['hero', 'wide', 'x']); let ask = await waitAsk('hero');
  writeDone('hero', { v: 1, name: 'hero', at: ask.at, ok: false, reason: 'the round stopped' });
  assert.deepEqual(await r, { code: 1, out: 'picture: the round stopped\n' });
  rmSync(join(pics, 'hero.ask.json')); r = run(['hero', 'wide', 'x']); ask = await waitAsk('hero');
  writeDone('hero', made('hero', new Date(Date.parse(ask.at) + 1000).toISOString()));
  assert.equal((await r).code, 0);
});
test('4c one line: a reason on one line of at most 300 characters; a size that is not whole is skipped; an ask that cannot be written is off', async () => {
  const r = run(['hero', 'wide', 'x']); const ask = await waitAsk('hero');
  writeDone('hero', { v: 1, name: 'hero', at: ask.at, ok: false, reason: `the service said\nno\r\nthanks ${'y'.repeat(400)}` });
  assert.deepEqual(await r, { code: 1, out: `picture: ${`the service said no thanks ${'y'.repeat(400)}`.slice(0, 300)}\n` });
  for (const [w, h] of [[1.5, 1024], [1536, 0]]) {
    writeDone('hero', made('hero', ask.at, w, h));
    assert.deepEqual(await run(['--wait-ms', '300', 'hero']), { code: 3, out: STILL('hero') }, `${w}×${h}`);
  }
  rmSync(join(pics, 'hero.ask.json')); mkdirSync(join(pics, 'hero.ask.json'));
  assert.deepEqual(await run(['--wait-ms', '300', 'hero', 'wide', 'x']), { code: 1, out: 'picture: pictures are off for this design\n' });
  assert.deepEqual(readdirSync(pics).filter((n) => n.endsWith('.tmp')), [], 'no temp is left');
});
test('4d asking again under the name replaces the ask whole, through a new file; the old answer does not end the new wait', async () => {
  assert.equal((await run(['--wait-ms', '200', 'hero', 'wide', 'x'])).code, 3);
  const first = JSON.parse(readFileSync(join(pics, 'hero.ask.json'), 'utf8')); const { ino } = statSync(join(pics, 'hero.ask.json'));
  writeDone('hero', made('hero', first.at));
  assert.deepEqual(await run(['--wait-ms', '300', 'hero', 'tall', 'y']), { code: 3, out: STILL('hero') });
  const second = JSON.parse(readFileSync(join(pics, 'hero.ask.json'), 'utf8'));
  assert.deepEqual([second.shape, second.prompt, second.at > first.at], ['tall', 'y', true]);
  if (POSIX) assert.notEqual(statSync(join(pics, 'hero.ask.json')).ino, ino, 'a new file renamed over, never written in place');
  assert.deepEqual(readdirSync(pics).filter((n) => n.endsWith('.tmp')), []);
});
test('5 at its limit the first form ends with 3 and leaves the ask; a bad done file never ends a wait', async () => {
  assert.deepEqual(await run(['--wait-ms', '300', 'hero', 'wide', 'x']), { code: 3, out: STILL('hero') });
  assert.ok(existsSync(join(pics, 'hero.ask.json')), 'the ask stays for the desk');
  const { at } = JSON.parse(readFileSync(join(pics, 'hero.ask.json'), 'utf8'));
  for (const bad of ['not json', JSON.stringify({ ...made('hero', at), file: 'assets/made/../x.png' }), JSON.stringify({ ...made('hero', at), name: 'other' })]) {
    writeFileSync(join(pics, 'hero.done.json'), bad);
    assert.deepEqual(await run(['--wait-ms', '300', 'hero']), { code: 3, out: STILL('hero') });
  }
  if (POSIX) { rmSync(join(pics, 'hero.done.json')); const out = join(tmp(), 'd.json'); writeFileSync(out, JSON.stringify(made('hero', at))); symlinkSync(out, join(pics, 'hero.done.json'));
    assert.deepEqual(await run(['--wait-ms', '300', 'hero']), { code: 3, out: STILL('hero') }, 'a link is never followed'); }
});
test('5b a made picture is a png, jpg or webp of its own name; a done file past 4096 bytes is skipped', async () => {
  assert.equal((await run(['--wait-ms', '200', 'hero', 'wide', 'x'])).code, 3);
  const { at } = JSON.parse(readFileSync(join(pics, 'hero.ask.json'), 'utf8'));
  for (const ext of ['jpg', 'webp']) {
    writeDone('hero', { ...made('hero', at), file: `assets/made/hero.${ext}` });
    assert.deepEqual(await run(['hero']), { code: 0, out: `assets/made/hero.${ext}  1536×1024\n` }, ext);
  }
  for (const file of ['assets/made/hero.gif', 'assets/made/other.png', 'made/hero.png']) {
    writeDone('hero', { ...made('hero', at), file });
    assert.deepEqual(await run(['--wait-ms', '300', 'hero']), { code: 3, out: STILL('hero') }, file);
  }
  const sized = (n) => { const body = { ...made('hero', at), pad: '' }; body.pad = 'x'.repeat(n - JSON.stringify(body).length); return body; };
  writeDone('hero', sized(4097));
  assert.deepEqual(await run(['--wait-ms', '300', 'hero']), { code: 3, out: STILL('hero') }, '4097 bytes');
  writeDone('hero', sized(4096));
  assert.deepEqual(await run(['hero']), { code: 0, out: 'assets/made/hero.png  1536×1024\n' }, '4096 bytes');
});
test('6 the name alone writes no ask and picks up a done file written later, or one already there', async () => {
  assert.equal((await run(['--wait-ms', '200', 'hero', 'wide', 'x'])).code, 3);
  const asked = readFileSync(join(pics, 'hero.ask.json'), 'utf8'); const { at } = JSON.parse(asked);
  const again = run(['--wait-ms', '5000', 'hero']);
  await sleep(300); writeDone('hero', made('hero', at));
  assert.deepEqual(await again, { code: 0, out: 'assets/made/hero.png  1536×1024\n' });
  assert.equal(readFileSync(join(pics, 'hero.ask.json'), 'utf8'), asked, 'no new ask');
  assert.deepEqual(await run(['hero']), { code: 0, out: 'assets/made/hero.png  1536×1024\n' }, 'an answer already there, at once');
});
test('7 the name alone with no ask of that name', async () => {
  assert.deepEqual(await run(['nope']), { code: 1, out: 'picture: no picture named nope is in the making\n' });
  writeFileSync(join(pics, 'odd.ask.json'), 'not json');
  assert.deepEqual(await run(['odd']), { code: 1, out: 'picture: no picture named odd is in the making\n' });
});
test('7b the name alone takes only a whole ask of its own name, of at most 16 KiB', async () => {
  const at = new Date().toISOString();
  for (const ask of [{ v: 2, name: 'odd', at }, { v: 1, name: 'other', at }, { v: 1, name: 'odd' }, { v: 1, name: 'odd', at, pad: 'x'.repeat(16384) }]) {
    writeFileSync(join(pics, 'odd.ask.json'), JSON.stringify(ask));
    assert.deepEqual(await run(['--wait-ms', '300', 'odd']), { code: 1, out: 'picture: no picture named odd is in the making\n' }, Object.keys(ask).join());
  }
});
test('8 one file: node: built-ins only, no env variable, the 100 s limit, Part A\'s shapes and limit, the desk\'s words', () => {
  const src = readFileSync(PICTURE_KIT, 'utf8');
  for (const m of src.matchAll(/\bfrom\s+'([^']+)'/g)) assert.match(m[1], /^node:/);
  assert.doesNotMatch(src, /process\.env/);
  assert.ok(src.includes('const WAIT_MS = 100000;'));
  assert.deepEqual(JSON.parse(/const SHAPES = (\[[^\]]*\]);/.exec(src)[1].replaceAll("'", '"')), [...IMAGE_SHAPES]);
  assert.ok(src.includes(`const PROMPT_MAX = ${IMAGES_MAX_PROMPT};`) && src.includes(`const NAME_RE = ${DESIGN_PICTURE_NAME_RE};`));
  for (const t of Object.values(KIT_REASONS)) for (const part of t.split('{name}')) assert.ok(src.includes(part), t);
});
