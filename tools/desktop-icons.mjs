#!/usr/bin/env node
// tools/desktop-icons.mjs — derive the desktop app's icons from the logo desktop/build-resources/icon.png
// (docs/desktop.md "Window and icons"): the macOS .icns (framed 824 inside 1024), the Windows .ico, the Linux PNG set,
// the runtime window icon and the tray art. Pure Node, no image library. The files are generated once and committed.
//   node tools/desktop-icons.mjs           # write every file
//   node tools/desktop-icons.mjs --check   # decode the committed files and compare their pixels with a fresh render
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'desktop/build-resources/icon.png';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const USAGE = 'usage: node tools/desktop-icons.mjs [--check]';

const fail = (message) => new Error(`desktop-icons: ${message}`);

/** RGBA (colour type 6) or RGB (type 2, alpha 255), 8-bit, not interlaced → { width, height, data: RGBA }. */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw fail('not a PNG (bad signature)');
  let header = null;
  const idat = [];
  let pos = 8;
  while (pos < buf.length) {
    if (pos + 12 > buf.length) throw fail('truncated chunk');
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) throw fail(`truncated ${type} chunk`);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw fail(`${type} chunk CRC mismatch`);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colorType: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!header) throw fail('no IHDR chunk');
  if (header.depth !== 8) throw fail(`only 8-bit PNGs are supported (bit depth ${header.depth})`);
  if (header.colorType !== 6 && header.colorType !== 2) throw fail(`only colour type 6 (RGBA) or 2 (RGB) is supported (colour type ${header.colorType})`);
  if (header.interlace !== 0) throw fail('interlaced PNGs are not supported');
  if (!idat.length) throw fail('no IDAT chunk');
  const { width, height } = header;
  const bpp = header.colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw fail(`image data length ${raw.length}, expected ${(stride + 1) * height}`);
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[out + i - bpp] : 0;
      const b = y > 0 ? px[out - stride + i] : 0;
      const c = y > 0 && i >= bpp ? px[out - stride + i - bpp] : 0;
      let pred;
      if (filter === 0) pred = 0;
      else if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw fail(`unknown row filter ${filter}`);
      px[out + i] = (raw[src + i] + pred) & 0xff;
    }
  }
  if (bpp === 4) return { width, height, data: px };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) { data[j] = px[i]; data[j + 1] = px[i + 1]; data[j + 2] = px[i + 2]; data[j + 3] = 255; }
  return { width, height, data };
}

function pngChunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** An RGBA PNG: colour type 6, filter 0 on every row, deflate level 9. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Area weights of each destination cell over the source cells it covers: [{ start, weights }]. */
function axisWeights(from, to) {
  const scale = from / to;
  const out = [];
  for (let i = 0; i < to; i++) {
    const lo = i * scale;
    const hi = (i + 1) * scale;
    const start = Math.floor(lo);
    const end = Math.min(from, Math.ceil(hi));
    const weights = [];
    for (let s = start; s < end; s++) weights.push((Math.min(hi, s + 1) - Math.max(lo, s)) / scale);
    out.push({ start, weights });
  }
  return out;
}

/** An area-weighted box filter on premultiplied alpha (transparent edges stay clean) → a size×size RGBA image. */
export function resample(img, size) {
  const { width, height, data } = img;
  const pre = new Float64Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    pre[i] = data[i] * a; pre[i + 1] = data[i + 1] * a; pre[i + 2] = data[i + 2] * a; pre[i + 3] = a;
  }
  const wx = axisWeights(width, size);
  const wy = axisWeights(height, size);
  const mid = new Float64Array(size * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      const { start, weights } = wx[x];
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const w = weights[k];
        const s = (y * width + start + k) * 4;
        r += pre[s] * w; g += pre[s + 1] * w; b += pre[s + 2] * w; a += pre[s + 3] * w;
      }
      const o = (y * size + x) * 4;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a;
    }
  }
  const out = new Uint8Array(size * size * 4);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < size; y++) {
    const { start, weights } = wy[y];
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const w = weights[k];
        const s = ((start + k) * size + x) * 4;
        r += mid[s] * w; g += mid[s + 1] * w; b += mid[s + 2] * w; a += mid[s + 3] * w;
      }
      const o = (y * size + x) * 4;
      const alpha = clamp(a);
      if (alpha === 0) continue;
      out[o] = clamp(r / a); out[o + 1] = clamp(g / a); out[o + 2] = clamp(b / a); out[o + 3] = alpha;
    }
  }
  return { width: size, height: size, data: out };
}

/** `img` resampled to content×content, centred on a transparent canvas×canvas. */
export function framed(img, canvas, content) {
  const inner = resample(img, content);
  const out = new Uint8Array(canvas * canvas * 4);
  const off = Math.floor((canvas - content) / 2);
  for (let y = 0; y < content; y++) out.set(inner.data.subarray(y * content * 4, (y + 1) * content * 4), ((y + off) * canvas + off) * 4);
  return { width: canvas, height: canvas, data: out };
}

/** Each pixel becomes the given colour with alpha a × (255 − luma) / 255: dark ink stays, light paint and holes go. */
export function silhouette(img, [r, g, b]) {
  const out = new Uint8Array(img.data.length);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const luma = Math.round((299 * d[i] + 587 * d[i + 1] + 114 * d[i + 2]) / 1000);
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
    out[i + 3] = Math.round((d[i + 3] * (255 - luma)) / 255);
  }
  return { width: img.width, height: img.height, data: out };
}

/** 'icns' + BE32 total length, then per entry a 4-char type + BE32 (8 + length) + the PNG. */
export function encodeIcns(entries) {
  const parts = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'latin1');
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'latin1');
  head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

export function readIcns(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'icns' || buf.readUInt32BE(4) !== buf.length) throw fail('not an icns file');
  const out = [];
  let pos = 8;
  while (pos < buf.length) {
    if (pos + 8 > buf.length) throw fail('truncated icns entry');
    const len = buf.readUInt32BE(pos + 4);
    if (len < 8 || pos + len > buf.length) throw fail('bad icns entry length');
    out.push({ type: buf.toString('latin1', pos, pos + 4), data: buf.subarray(pos + 8, pos + len) });
    pos += len;
  }
  return out;
}

/** A 32-bit BMP DIB for an .ico entry: BITMAPINFOHEADER (biHeight 2h), bottom-up BGRA rows, a zero AND mask. */
function encodeBmp({ width, height, data }) {
  const maskRow = Math.ceil(width / 32) * 4;
  const buf = Buffer.alloc(40 + width * height * 4 + maskRow * height);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(width, 4);
  buf.writeInt32LE(height * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(width * height * 4 + maskRow * height, 20);
  for (let y = 0; y < height; y++) {
    const row = 40 + (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const o = row + x * 4;
      buf[o] = data[s + 2]; buf[o + 1] = data[s + 1]; buf[o + 2] = data[s]; buf[o + 3] = data[s + 3];
    }
  }
  return buf;
}

/** The pixels of a 32-bit .ico BMP entry (encodeBmp's layout) → { width, height, data: RGBA }. */
export function decodeBmp(buf) {
  if (buf.length < 40 || buf.readUInt32LE(0) !== 40) throw fail('not a BITMAPINFOHEADER');
  const width = buf.readInt32LE(4);
  const height = buf.readInt32LE(8) / 2;
  if (buf.readUInt16LE(14) !== 32 || buf.readUInt32LE(16) !== 0) throw fail('only uncompressed 32-bit BMP entries are supported');
  if (!(width > 0) || !Number.isInteger(height) || height <= 0 || buf.length < 40 + width * height * 4) throw fail('bad BMP size');
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = 40 + (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const s = row + x * 4;
      const o = (y * width + x) * 4;
      data[o] = buf[s + 2]; data[o + 1] = buf[s + 1]; data[o + 2] = buf[s]; data[o + 3] = buf[s + 3];
    }
  }
  return { width, height, data };
}

/** ICONDIR + 16-byte entries (width/height byte 0 = 256, planes 1, 32 bpp); `png` entries stay PNG, `img` ones BMP. */
export function encodeIco(entries) {
  const bodies = entries.map((e) => (e.png ? e.png : encodeBmp(e.img)));
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach((e, i) => {
    const o = 6 + 16 * i;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(bodies[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += bodies[i].length;
  });
  return Buffer.concat([dir, ...bodies]);
}

export function readIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw fail('not an ico file');
  const count = buf.readUInt16LE(4);
  if (buf.length < 6 + 16 * count) throw fail('truncated ico directory');
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + 16 * i;
    const size = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    if (offset + size > buf.length) throw fail('bad ico entry offset');
    const data = buf.subarray(offset, offset + size);
    out.push({ width: buf[o] || 256, height: buf[o + 1] || 256, bitCount: buf.readUInt16LE(o + 6), kind: data.subarray(0, 8).equals(PNG_SIGNATURE) ? 'png' : 'bmp', data });
  }
  return out;
}

const ICNS_TYPES = Object.freeze([['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]]);
const ICO_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);
const LINUX_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256, 512]);
const BLACK = Object.freeze([0, 0, 0]);
const WHITE = Object.freeze([255, 255, 255]);

/** Every generated file (repo-relative), from SOURCE. `art`: full | framed | silhouette with `rgb`. */
export const ICON_OUTPUTS = Object.freeze([
  { path: 'desktop/build-resources/icon.icns', kind: 'icns', art: 'framed', images: ICNS_TYPES.map(([type, size]) => ({ type, size })) },
  { path: 'desktop/build-resources/icon.ico', kind: 'ico', art: 'full', images: ICO_SIZES.map((size) => ({ size })) },
  ...LINUX_SIZES.map((n) => ({ path: `desktop/build-resources/icons/${n}x${n}.png`, kind: 'png', art: 'full', images: [{ size: n }] })),
  { path: 'desktop/assets/icon.png', kind: 'png', art: 'full', images: [{ size: 256 }] },
  { path: 'desktop/assets/trayTemplate.png', kind: 'png', art: 'silhouette', rgb: BLACK, images: [{ size: 18 }] },
  { path: 'desktop/assets/trayTemplate@2x.png', kind: 'png', art: 'silhouette', rgb: BLACK, images: [{ size: 36 }] },
  { path: 'desktop/assets/tray-black.png', kind: 'png', art: 'silhouette', rgb: BLACK, images: [{ size: 32 }] },
  { path: 'desktop/assets/tray-black@2x.png', kind: 'png', art: 'silhouette', rgb: BLACK, images: [{ size: 64 }] },
  { path: 'desktop/assets/tray-white.png', kind: 'png', art: 'silhouette', rgb: WHITE, images: [{ size: 32 }] },
  { path: 'desktop/assets/tray-white@2x.png', kind: 'png', art: 'silhouette', rgb: WHITE, images: [{ size: 64 }] },
].map((o) => Object.freeze(o)));

const FRAME_CANVAS = 1024;
const FRAME_CONTENT = 824;
const renderCache = new Map();

/** The decoded rasters of every output: Map<path, { kind, images: [{ type?, size, img }] }>. No encoding. */
export function renderIcons(sourceBuf) {
  const key = createHash('sha256').update(sourceBuf).digest('hex');
  if (renderCache.has(key)) return renderCache.get(key);
  const src = decodePng(sourceBuf);
  const full = new Map();
  const fullAt = (n) => { if (!full.has(n)) full.set(n, resample(src, n)); return full.get(n); };
  const frame = framed(src, FRAME_CANVAS, FRAME_CONTENT);
  const frameAt = new Map([[FRAME_CANVAS, frame]]);
  const framedAt = (n) => { if (!frameAt.has(n)) frameAt.set(n, resample(frame, n)); return frameAt.get(n); };
  const out = new Map();
  for (const o of ICON_OUTPUTS) {
    const images = o.images.map(({ type, size }) => {
      const img = o.art === 'framed' ? framedAt(size) : o.art === 'silhouette' ? silhouette(fullAt(size), o.rgb) : fullAt(size);
      return { ...(type ? { type } : {}), size, img };
    });
    out.set(o.path, { kind: o.kind, images });
  }
  renderCache.set(key, out);
  return out;
}

function encodeOutput({ kind, images }) {
  if (kind === 'png') return encodePng(images[0].img);
  if (kind === 'icns') return encodeIcns(images.map(({ type, img }) => ({ type, png: encodePng(img) })));
  return encodeIco(images.map(({ size, img }) => (size >= 256 ? { size, png: encodePng(img) } : { size, img })));
}

/** The committed file's decoded images, in its container's order: [{ type?, size, img }]. */
function decodeOutput(kind, buf) {
  if (kind === 'png') { const img = decodePng(buf); return [{ size: img.width, img }]; }
  if (kind === 'icns') return readIcns(buf).map(({ type, data }) => { const img = decodePng(data); return { type, size: img.width, img }; });
  return readIco(buf).map((e) => {
    const img = e.kind === 'png' ? decodePng(e.data) : decodeBmp(e.data);
    if (img.width !== e.width || img.height !== e.height || e.bitCount !== 32) throw fail('ico entry header and image disagree');
    return { size: e.width, kind: e.kind, img };
  });
}

const sameImage = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength).equals(Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength));

function matches(path, want, buf) {
  let got;
  try { got = decodeOutput(want.kind, buf); } catch { return false; }
  if (got.length !== want.images.length) return false;
  return want.images.every((w, i) => {
    const g = got[i];
    if (g.size !== w.size || (w.type && g.type !== w.type)) return false;
    if (want.kind === 'ico' && g.kind !== (w.size >= 256 ? 'png' : 'bmp')) return false;
    return sameImage(g.img, w.img);
  });
}

/** Write every output under `root`, or (check) compare each committed file's pixels and layout with a fresh render. */
export function generateIcons({ root = ROOT, check = false, write = writeFileSync } = {}) {
  const rendered = renderIcons(readFileSync(join(root, SOURCE)));
  const written = [];
  for (const [path, want] of rendered) {
    const file = join(root, path);
    if (check) {
      let buf;
      try { buf = readFileSync(file); } catch { buf = null; }
      if (!buf || !matches(path, want, buf)) throw fail(`${path} is stale or missing — run node tools/desktop-icons.mjs`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    write(file, encodeOutput(want));
    written.push(path);
  }
  return { written };
}

// realpath, as import.meta.url is: a symlinked checkout or tools dir must still run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) { console.error(`desktop-icons: unknown flag ${unknown[0]}\n${USAGE}`); process.exit(2); }
  const check = args.includes('--check');
  try {
    const { written } = generateIcons({ check });
    console.log(check ? `desktop-icons: verified ${ICON_OUTPUTS.length} files` : `desktop-icons: wrote ${written.length} files`);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}
