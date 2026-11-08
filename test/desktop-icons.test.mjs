// test/desktop-icons.test.mjs — tools/desktop-icons.mjs: the pure-Node PNG codec, resampler, silhouette, the .icns and
// .ico containers, and the committed desktop icon set (generated once from desktop/build-resources/icon.png).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePng, encodePng, resample, framed, silhouette, encodeIcns, readIcns, encodeIco, readIco, decodeBmp,
  ICON_OUTPUTS, renderIcons, generateIcons,
} from '../tools/desktop-icons.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** An RGBA image; `pixel(x, y)` → [r, g, b, a]. */
function image(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function ihdr(width, height, { depth = 8, colorType = 6, interlace = 0 } = {}) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0); b.writeUInt32BE(height, 4); b[8] = depth; b[9] = colorType; b[12] = interlace;
  return chunk('IHDR', b);
}
const png = (header, raw) => Buffer.concat([SIG, header, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

/** A PNG whose rows use filter type y % 5 (None, Sub, Up, Average, Paeth), filtered by hand. */
function filteredPng(img) {
  const bpp = 4;
  const stride = img.width * bpp;
  const px = Buffer.from(img.data);
  const raw = Buffer.alloc((stride + 1) * img.height);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < img.height; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = px[y * stride + i];
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  return png(ihdr(img.width, img.height), raw);
}

const noisy = image(7, 6, (x, y) => [(x * 37 + y * 11) & 0xff, (x * 5 + y * 71) & 0xff, (x * y * 13 + 3) & 0xff, (x * 29 + y * 17 + 40) & 0xff]);
const bbox = (img) => {
  let x0 = img.width; let y0 = img.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};

test('PNG: an RGBA image round-trips; an RGB PNG decodes with alpha 255', () => {
  const back = decodePng(encodePng(noisy));
  assert.deepEqual([back.width, back.height], [7, 6]);
  assert.deepEqual(Array.from(back.data), Array.from(noisy.data));
  const raw = Buffer.alloc((2 * 3 + 1) * 2);
  raw.set([0, 10, 20, 30, 40, 50, 60], 0);
  raw.set([0, 70, 80, 90, 100, 110, 120], 7);
  const rgb = decodePng(png(ihdr(2, 2, { colorType: 2 }), raw));
  assert.deepEqual(Array.from(rgb.data), [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
});

test('PNG: rows filtered None/Sub/Up/Average/Paeth decode to the original pixels', () => {
  const tall = image(9, 11, (x, y) => [(x * 53 + y * 7) & 0xff, (y * 31 + 5) & 0xff, (x * y * 3) & 0xff, (255 - x * 9 - y * 4) & 0xff]);
  assert.deepEqual(Array.from(decodePng(filteredPng(tall)).data), Array.from(tall.data));
});

test('PNG: refusals — bad signature, CRC mismatch, palette, interlace, short IDAT, no IDAT', () => {
  const good = encodePng(noisy);
  const bad = (buf, re) => assert.throws(() => decodePng(buf), (err) => err instanceof Error && /^desktop-icons: /.test(err.message) && re.test(err.message));
  const sig = Buffer.from(good); sig[0] = 0;
  bad(sig, /signature/);
  const crc = Buffer.from(good); crc[8 + 8 + 13] ^= 0xff;   // the IHDR CRC
  bad(crc, /CRC/);
  const raw = Buffer.alloc(3 * 2);
  bad(png(ihdr(2, 2, { colorType: 3 }), raw), /colour type/);
  bad(png(ihdr(2, 2, { interlace: 1 }), Buffer.alloc((2 * 4 + 1) * 2)), /interlace/);
  bad(png(ihdr(2, 2), Buffer.alloc(2 * 4 + 1)), /length/);
  bad(Buffer.concat([SIG, ihdr(2, 2), chunk('IEND', Buffer.alloc(0))]), /IDAT/);
  bad(png(ihdr(2, 2, { depth: 16 }), Buffer.alloc((2 * 8 + 1) * 2)), /8-bit/);
});

test('resample: 2x2 → 1x1 averages; premultiplied (white + transparent → white at half alpha); any ratio', () => {
  const four = image(2, 2, (x, y) => [[0, 40, 80, 120][x + 2 * y], 100, 200, 255]);
  assert.deepEqual(Array.from(resample(four, 1).data), [60, 100, 200, 255]);
  const half = image(2, 2, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  assert.deepEqual(Array.from(resample(half, 1).data), [255, 255, 255, 128]);
  const edge = image(2, 2, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 0]));
  assert.deepEqual(Array.from(resample(edge, 1).data), [0, 0, 0, 128], 'a transparent pixel\'s colour does not bleed in');
  const big = image(1024, 1024, () => [0, 0, 0, 255]);
  const r = resample(big, 824);
  assert.deepEqual([r.width, r.height, r.data.length], [824, 824, 824 * 824 * 4]);
  assert.ok(r.data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 0)), 'a flat image stays flat');
  const up = resample(image(2, 2, () => [9, 9, 9, 255]), 5);
  assert.equal(up.width, 5);
  assert.ok(up.data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 9)));
});

test('framed: the content is centred on a transparent canvas', () => {
  const f = framed(image(10, 10, () => [0, 0, 0, 255]), 20, 10);
  assert.deepEqual([f.width, f.height], [20, 20]);
  assert.deepEqual(bbox(f), { x0: 5, y0: 5, x1: 14, y1: 14 });
});

test('silhouette: white → alpha 0, black → alpha 255 in the given rgb, transparent stays 0', () => {
  const src = image(3, 1, (x) => [[255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0]][x]);
  assert.deepEqual(Array.from(silhouette(src, [255, 255, 255]).data), [255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0]);
  const grey = silhouette(image(1, 1, () => [128, 128, 128, 200]), [0, 0, 0]);
  assert.deepEqual(Array.from(grey.data), [0, 0, 0, Math.round(200 * (255 - 128) / 255)]);
});

test('icns: types in order, the header length is the file length, each PNG has its size', () => {
  const entries = [['icp4', 16], ['ic07', 128], ['ic10', 1024]].map(([type, n]) => ({ type, png: encodePng(image(n, n, () => [0, 0, 0, 255])) }));
  const buf = encodeIcns(entries);
  assert.equal(buf.toString('latin1', 0, 4), 'icns');
  assert.equal(buf.readUInt32BE(4), buf.length);
  const back = readIcns(buf);
  assert.deepEqual(back.map((e) => e.type), ['icp4', 'ic07', 'ic10']);
  assert.deepEqual(back.map((e) => decodePng(e.data).width), [16, 128, 1024]);
  assert.throws(() => readIcns(Buffer.from('nope0000')), /^Error: desktop-icons: /);
});

test('ico: the count, 256 is a PNG with width byte 0, BMP entries have biHeight 2h and a zero AND mask', () => {
  const img = (n) => image(n, n, (x, y) => [x & 0xff, y & 0xff, 7, (x + y) & 0xff]);
  const buf = encodeIco([{ size: 16, img: img(16) }, { size: 48, img: img(48) }, { size: 256, png: encodePng(img(256)) }]);
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  assert.equal(buf.readUInt16LE(4), 3);
  assert.equal(buf[6 + 2 * 16], 0, 'the 256 entry width byte is 0');
  assert.equal(buf.readUInt16LE(6 + 4), 1, 'planes');
  const back = readIco(buf);
  assert.deepEqual(back.map((e) => [e.width, e.height, e.bitCount, e.kind]), [[16, 16, 32, 'bmp'], [48, 48, 32, 'bmp'], [256, 256, 32, 'png']]);
  const bmp = back[1].data;
  assert.equal(bmp.readUInt32LE(0), 40);
  assert.equal(bmp.readInt32LE(4), 48);
  assert.equal(bmp.readInt32LE(8), 96, 'biHeight = 2h');
  const maskRow = Math.ceil(48 / 32) * 4;
  assert.equal(bmp.length, 40 + 48 * 48 * 4 + maskRow * 48);
  assert.ok(bmp.subarray(40 + 48 * 48 * 4).every((v) => v === 0), 'the AND mask is all zero');
  assert.deepEqual(Array.from(decodeBmp(bmp).data), Array.from(img(48).data), 'bottom-up BGRA decodes back');
  assert.deepEqual(Array.from(decodePng(back[2].data).data), Array.from(img(256).data));
});

const committed = (path) => readFileSync(join(ROOT, path));
const coverage = (img) => { let s = 0; for (let i = 3; i < img.data.length; i += 4) s += img.data[i]; return s / 255 / (img.width * img.height); };

test('the committed icon set equals a fresh generation from icon.png (pixels and container layout)', () => {
  assert.deepEqual(generateIcons({ root: ROOT, check: true }), { written: [] });
  assert.equal(renderIcons(committed('desktop/build-resources/icon.png')).size, ICON_OUTPUTS.length);
});

test('framing: the .icns is 824 inside 1024 with transparent corners; the .ico 256 entry is full-bleed', () => {
  const icns = readIcns(committed('desktop/build-resources/icon.icns'));
  assert.deepEqual(icns.map((e) => e.type), ['icp4', 'icp5', 'ic11', 'ic12', 'ic07', 'ic13', 'ic08', 'ic14', 'ic09', 'ic10']);
  const big = decodePng(icns.find((e) => e.type === 'ic10').data);
  assert.equal(big.width, 1024);
  const b = bbox(big);
  for (const v of [b.x0, b.y0, b.x1, b.y1]) assert.ok(v >= 96 && v < 928, `bounding box ${JSON.stringify(b)}`);
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) assert.equal(big.data[(y * 1024 + x) * 4 + 3], 0, 'corner transparent');
  const ico = readIco(committed('desktop/build-resources/icon.ico'));
  assert.deepEqual(ico.map((e) => [e.width, e.kind]), [[16, 'bmp'], [24, 'bmp'], [32, 'bmp'], [48, 'bmp'], [64, 'bmp'], [128, 'bmp'], [256, 'png']]);
  const full = bbox(decodePng(ico.at(-1).data));
  assert.ok(full.x0 <= 2 && full.y0 <= 2 && full.x1 >= 253 && full.y1 >= 253, `full-bleed ${JSON.stringify(full)}`);
});

test('tray art: template and black silhouettes are pure black, white is pure white, coverage 0.3–0.75', () => {
  const rows = [['trayTemplate.png', 18, 0], ['trayTemplate@2x.png', 36, 0], ['tray-black.png', 32, 0], ['tray-black@2x.png', 64, 0], ['tray-white.png', 32, 255], ['tray-white@2x.png', 64, 255]];
  for (const [file, size, ink] of rows) {
    const img = decodePng(committed(`desktop/assets/${file}`));
    assert.deepEqual([img.width, img.height], [size, size], file);
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0) assert.deepEqual([img.data[i], img.data[i + 1], img.data[i + 2]], [ink, ink, ink], file);
    const c = coverage(img);
    assert.ok(c >= 0.3 && c <= 0.75, `${file} coverage ${c}`);
  }
});

test('a committed file with one pixel changed fails the check with the stale message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desk-icons-'));
  try {
    for (const p of ['desktop/build-resources/icon.png', ...ICON_OUTPUTS.map((o) => o.path)]) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), committed(p));
    }
    assert.deepEqual(generateIcons({ root: dir, check: true }), { written: [] }, 'the unmodified copy passes');
    const target = 'desktop/assets/tray-white.png';
    const img = decodePng(committed(target));
    img.data[(5 * img.width + 5) * 4 + 3] ^= 0x01;
    writeFileSync(join(dir, target), encodePng(img));
    assert.throws(() => generateIcons({ root: dir, check: true }), { message: `desktop-icons: ${target} is stale or missing — run node tools/desktop-icons.mjs` });
    rmSync(join(dir, 'desktop/build-resources/icon.ico'));
    writeFileSync(join(dir, target), committed(target));
    assert.throws(() => generateIcons({ root: dir, check: true }), /icon\.ico is stale or missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
