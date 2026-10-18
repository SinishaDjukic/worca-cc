// Pixel + container analysis for the promo kit's tools — zero dependencies (node:zlib, node:fs only).
//   decodePNG(buf)            → { width, height, rgb, alpha }   (8/16-bit gray/RGB/RGBA/palette, non-interlaced;
//                               alpha: Uint8Array per pixel for gray+alpha / RGBA / tRNS palettes, else null)
//   encodePNG(w, h, rgb)      → PNG Buffer (8-bit RGB)
//   frameDiff(a, b, w, h, T)  → { mad, tiles }           mean |Δ| over RGB (0–255) + per-tile MAD on a T×T grid
//   channelBias(a, b)         → [dR, dG, dB]             signed mean (a − b) per channel
//   median / percentile / rollingMedian
//   readMP4(path)             → exact sample count, timescale, CFR deltas, size, profile, colr, faststart
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

/* ---------- PNG ---------- */
export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chans || interlace || !(depth === 8 || depth === 16) || (ctype === 3 && depth !== 8)) {
    throw new Error(`unsupported PNG (type ${ctype}, depth ${depth}, interlace ${interlace})`);
  }
  const bpp = (chans * depth) >> 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < h * (stride + 1)) throw new Error('truncated PNG data');
  const px = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], ls = y * (stride + 1) + 1;
    const out = px.subarray(y * stride, (y + 1) * stride);
    if (ft === 0) for (let i = 0; i < stride; i++) out[i] = raw[ls + i];
    else if (ft === 1) for (let i = 0; i < stride; i++) out[i] = (raw[ls + i] + (i >= bpp ? out[i - bpp] : 0)) & 255;
    else if (ft === 2) for (let i = 0; i < stride; i++) out[i] = (raw[ls + i] + prev[i]) & 255;
    else if (ft === 3) for (let i = 0; i < stride; i++) out[i] = (raw[ls + i] + (((i >= bpp ? out[i - bpp] : 0) + prev[i]) >> 1)) & 255;
    else if (ft === 4) for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[i] = (raw[ls + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    } else throw new Error(`bad PNG filter ${ft} on row ${y}`);
    prev = out;
  }
  const n = w * h, rgb = new Uint8Array(n * 3), step = depth >> 3; // 16-bit: take the high byte
  const alpha = ctype === 4 || ctype === 6 || (ctype === 3 && trns) ? new Uint8Array(n) : null;
  for (let i = 0; i < n; i++) {
    const s = i * bpp, d = i * 3;
    if (ctype === 2 || ctype === 6) { rgb[d] = px[s]; rgb[d + 1] = px[s + step]; rgb[d + 2] = px[s + 2 * step]; if (alpha) alpha[i] = px[s + 3 * step]; }
    else if (ctype === 0 || ctype === 4) { rgb[d] = rgb[d + 1] = rgb[d + 2] = px[s]; if (alpha) alpha[i] = px[s + step]; }
    else { const k = px[s] * 3; rgb[d] = plte[k]; rgb[d + 1] = plte[k + 1]; rgb[d + 2] = plte[k + 2]; if (alpha) alpha[i] = px[s] < trns.length ? trns[px[s]] : 255; }
  }
  return { width: w, height: h, rgb, alpha };
}

export function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- frame differences ---------- */
const gridCache = new Map();
function grid(w, h, T) {
  const key = `${w}x${h}x${T}`;
  if (!gridCache.has(key)) {
    const tx = new Uint16Array(w), ty = new Uint16Array(h), count = new Float64Array(T * T);
    for (let x = 0; x < w; x++) tx[x] = Math.min(T - 1, Math.floor((x * T) / w));
    for (let y = 0; y < h; y++) ty[y] = Math.min(T - 1, Math.floor((y * T) / h));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) count[ty[y] * T + tx[x]] += 3;
    gridCache.set(key, { tx, ty, count });
  }
  return gridCache.get(key);
}
/** Mean absolute RGB difference (0–255) of two frames, plus the same per tile of a T×T grid. */
export function frameDiff(a, b, w, h, T = 9) {
  const { tx, ty, count } = grid(w, h, T);
  const tiles = new Float64Array(T * T);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const rowT = ty[y] * T;
    let i = y * w * 3;
    for (let x = 0; x < w; x++, i += 3) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d) { total += d; tiles[rowT + tx[x]] += d; }
    }
  }
  for (let k = 0; k < tiles.length; k++) tiles[k] /= count[k];
  return { mad: total / (w * h * 3), tiles };
}
/** Signed mean difference per channel, a − b (colour-shift detector). */
export function channelBias(a, b) {
  const s = [0, 0, 0];
  for (let i = 0; i < a.length; i += 3) { s[0] += a[i] - b[i]; s[1] += a[i + 1] - b[i + 1]; s[2] += a[i + 2] - b[i + 2]; }
  const n = a.length / 3;
  return s.map((v) => v / n);
}

/* ---------- stats ---------- */
export function percentile(values, p) {
  const v = Array.from(values).filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const k = Math.min(v.length - 1, Math.max(0, (v.length - 1) * p));
  const lo = Math.floor(k), hi = Math.ceil(k);
  return v[lo] + (v[hi] - v[lo]) * (k - lo);
}
export const median = (v) => percentile(v, 0.5);
/** Median of v[i−r .. i+r] excluding v[i] itself (null entries skipped). */
export function rollingMedian(v, r) {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const win = [];
    for (let j = Math.max(0, i - r); j <= Math.min(v.length - 1, i + r); j++) if (j !== i && v[j] != null) win.push(v[j]);
    win.sort((x, y) => x - y);
    out[i] = win.length ? (win.length % 2 ? win[win.length >> 1] : (win[win.length / 2 - 1] + win[win.length / 2]) / 2) : 0;
  }
  return out;
}

/* ---------- MP4 (ISO BMFF) — exact verification without ffprobe ---------- */
const PROFILES = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
/** Parse the moov box of an MP4 (reads only box headers + moov). Returns the first video track's facts. */
export function readMP4(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const hdr = Buffer.alloc(16);
    const top = [];
    for (let o = 0; o + 8 <= size;) {
      readSync(fd, hdr, 0, 16, o);
      let len = hdr.readUInt32BE(0), h = 8;
      if (len === 1) { len = Number(hdr.readBigUInt64BE(8)); h = 16; } else if (len === 0) len = size - o;
      if (len < h) break;
      top.push({ type: hdr.toString('latin1', 4, 8), start: o, len, h });
      o += len;
    }
    const moovBox = top.find((b) => b.type === 'moov');
    if (!moovBox) throw new Error('no moov box');
    const mdatBox = top.find((b) => b.type === 'mdat');
    const buf = Buffer.alloc(moovBox.len);
    readSync(fd, buf, 0, moovBox.len, moovBox.start);
    const kids = (s, e) => {
      const out = [];
      for (let o = s; o + 8 <= e;) {
        let len = buf.readUInt32BE(o), h = 8;
        if (len === 1) { len = Number(buf.readBigUInt64BE(o + 8)); h = 16; } else if (len === 0) len = e - o;
        if (len < h || o + len > e) break;
        out.push({ type: buf.toString('latin1', o + 4, o + 8), body: o + h, end: o + len });
        o += len;
      }
      return out;
    };
    const find = (list, t) => list.find((b) => b.type === t);
    const path2 = (list, ...types) => { let cur = list, box; for (const t of types) { box = find(cur, t); if (!box) return null; cur = kids(box.body, box.end); } return box; };
    const moov = kids(moovBox.h, moovBox.len);
    const mvhd = find(moov, 'mvhd');
    const mv = buf[mvhd.body] === 1
      ? { timescale: buf.readUInt32BE(mvhd.body + 20), duration: Number(buf.readBigUInt64BE(mvhd.body + 24)) }
      : { timescale: buf.readUInt32BE(mvhd.body + 12), duration: buf.readUInt32BE(mvhd.body + 16) };
    for (const trak of moov.filter((b) => b.type === 'trak')) {
      const tk = kids(trak.body, trak.end);
      const hdlr = path2(tk, 'mdia', 'hdlr');
      if (!hdlr || buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'vide') continue;
      const mdhd = path2(tk, 'mdia', 'mdhd');
      const v1 = buf[mdhd.body] === 1;
      const timescale = buf.readUInt32BE(mdhd.body + (v1 ? 20 : 12));
      const duration = v1 ? Number(buf.readBigUInt64BE(mdhd.body + 24)) : buf.readUInt32BE(mdhd.body + 16);
      const stbl = path2(tk, 'mdia', 'minf', 'stbl');
      const st = kids(stbl.body, stbl.end);
      const stts = find(st, 'stts'), stsz = find(st, 'stsz'), stss = find(st, 'stss'), stsd = find(st, 'stsd');
      const deltas = [];
      for (let i = 0, n = buf.readUInt32BE(stts.body + 4); i < n; i++) deltas.push({ count: buf.readUInt32BE(stts.body + 8 + i * 8), delta: buf.readUInt32BE(stts.body + 12 + i * 8) });
      const samples = buf.readUInt32BE(stsz.body + 8);
      const keyframes = stss ? buf.readUInt32BE(stss.body + 4) : samples;
      const entry = kids(stsd.body + 8, stsd.end)[0];
      const width = buf.readUInt16BE(entry.body + 24), height = buf.readUInt16BE(entry.body + 26);
      const ek = kids(entry.body + 78, entry.end);
      const avcC = find(ek, 'avcC'), colrBox = find(ek, 'colr');
      let colr = null;
      if (colrBox) {
        const kind = buf.toString('latin1', colrBox.body, colrBox.body + 4);
        colr = { kind };
        if (kind === 'nclx' || kind === 'nclc') {
          colr.primaries = buf.readUInt16BE(colrBox.body + 4); colr.transfer = buf.readUInt16BE(colrBox.body + 6);
          colr.matrix = buf.readUInt16BE(colrBox.body + 8);
          if (kind === 'nclx') colr.fullRange = !!(buf[colrBox.body + 10] & 0x80);
        }
      }
      const elst = path2(tk, 'edts', 'elst');
      let editMediaTime = null;
      if (elst && buf.readUInt32BE(elst.body + 4) > 0) {
        editMediaTime = buf[elst.body] === 1 ? Number(buf.readBigInt64BE(elst.body + 16)) : buf.readInt32BE(elst.body + 12);
      }
      const totalTicks = deltas.reduce((s, d) => s + d.count * d.delta, 0);
      return {
        codec: entry.type, width, height, samples, keyframes, timescale, mediaDuration: duration / timescale,
        sttsDuration: totalTicks / timescale, movieDuration: mv.duration / mv.timescale,
        fps: deltas.length ? timescale / deltas[0].delta : NaN, cfr: deltas.every((d) => d.delta === deltas[0].delta), deltas,
        profile: avcC ? (PROFILES[buf[avcC.body + 1]] || `profile ${buf[avcC.body + 1]}`) : null,
        level: avcC ? buf[avcC.body + 3] / 10 : null, colr, editMediaTime, bframes: !!find(st, 'ctts'),
        faststart: mdatBox ? moovBox.start < mdatBox.start : true, bytes: size,
      };
    }
    throw new Error('no video track');
  } finally { closeSync(fd); }
}
