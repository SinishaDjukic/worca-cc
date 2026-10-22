#!/usr/bin/env node
// Final audio mix of a promo film: narration + ducked music + SFX cues → <promo>/audio/mix.wav (48 kHz/24-bit
// stereo), mix.mp3 (dev player), mix.m4a (AAC 320k, muxed into the MP4). Everything is summed in Node (float32,
// sample-accurate) so any number of cues scales; ffmpeg only decodes, measures and encodes.
//
// The voice must never drop under the bed (TTS lines come back up to 12 dB apart, SFX files are peak-normalised
// near 0 dBFS): every line is compressed and normalised to −16 LUFS, music sits −20 dB under speech / −10 dB in gaps,
// the SFX bus −18 dB with a further −10 dB under speech, and a per-line VOICE CHECK gates the mix: in 50 ms speech
// frames the voice must be ≥ 12 dB over music + SFX (median) with ≤ 5 % of frames under 6 dB.
//   node promo-kit/tools/mix.mjs --promo <promoDir> --cues cues-thin.json [--music file] [--out <promo>/audio/mix]
//   exit 3 when the voice check fails.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFfmpeg, toolHints } from './find-tools.mjs';
import { LOOPED_SFX } from './sfx.mjs';

/** Mix levels (dB): VO target loudness, music under speech / in gaps, SFX bus and its extra duck under speech, master. */
export const DEFAULT_LEVELS = { voLUFS: -16, music_under: -20, music_gap: -10, sfx: -18, sfx_under_vo: -10, targetLUFS: -14, tp: -1 };
const VO_COMP = 'acompressor=threshold=0.089:ratio=2.5:attack=6:release=90:knee=4';
const MUSIC_FADE_OUT = 1.2, DUCK_RAMP = 0.12, DUCK_PAD = 0.08;
/** Voice check: ≥ minMedian dB voice-over-background (median of speech frames) and ≤ maxLowShare of frames under lowDb. */
export const VOICE_CHECK = { minMedian: 12, maxLowShare: 0.05, lowDb: 6, speechWindowDb: 18, frameSec: 0.05 };

const db = (x) => Math.pow(10, x / 20);
const LOOPED = new Set(LOOPED_SFX);

/**
 * @param {{promoDir:string, cues?:Array|{cues:Array}, ffmpeg?:string, levels?:object, music?:string|false, out?:string, sampleRate?:number}} o
 * @returns {Promise<{lufs:number|null, tp:number|null, lra:number|null, duration:number,
 *   voiceCheck:{ok:boolean, lines:{id,median,lowShare,ok,frames}[]}, files:{wav,mp3,m4a}|null,
 *   placed:number, missingSfx:string[], vo:{id,lufs,gainDb}[]}>}
 */
export async function mixAudio({ promoDir, cues = [], ffmpeg, levels = {}, music, out, sampleRate = 48000 } = {}) {
  if (!promoDir) throw new Error('mixAudio: promoDir is required');
  const P = path.resolve(promoDir);
  const L = { ...DEFAULT_LEVELS, ...levels };
  const timeline = JSON.parse(fs.readFileSync(path.join(P, 'timeline.json'), 'utf8'));
  const DUR = Number(timeline.duration), SR = sampleRate, N = Math.round(DUR * SR);
  const voDir = path.join(P, 'audio', 'vo');
  const ids = Object.keys(timeline.vo || {}).sort((a, b) => timeline.vo[a].start - timeline.vo[b].start);
  const fileOf = (id) => ['.mp3', '.wav', '.m4a'].map((e) => path.join(voDir, id + e)).find((f) => fs.existsSync(f)) || null;
  const have = ids.filter((id) => fileOf(id));
  const silent = { lufs: null, tp: null, lra: null, duration: DUR, voiceCheck: { ok: true, lines: [] }, files: null, placed: 0, missingSfx: [], vo: [] };
  if (timeline.narrated === false || !have.length) return silent;
  const missing = ids.filter((id) => !fileOf(id));
  if (missing.length) throw new Error(`mixAudio: narration audio missing for ${missing.join(', ')} (expected ${path.join('audio', 'vo', missing[0] + '.mp3')})`);
  const FF = ffmpeg || findFfmpeg();
  if (!FF) throw new Error('no ffmpeg found: ' + toolHints().ffmpeg);

  const ff = (args, opts = {}) => spawnSync(FF, args, { maxBuffer: 1 << 30, windowsHide: true, ...opts });
  const dec = (file, ch, af = null) => {   // → Float32Array[] per channel
    const r = ff(['-v', 'error', '-i', file, ...(af ? ['-af', af] : []), '-f', 'f32le', '-ac', String(ch), '-ar', String(SR), '-']);
    if (r.status) throw new Error('decode ' + file + ': ' + String(r.stderr).slice(-300));
    const b = r.stdout; const f = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
    const n = f.length / ch; const o = Array.from({ length: ch }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) o[c][i] = f[i * ch + c];
    return o;
  };
  const summary = (stderr) => { const s = String(stderr); return s.slice(s.lastIndexOf('Summary:')); };
  const num = (re, s) => { const m = re.exec(s); return m ? parseFloat(m[1]) : NaN; };

  const L_ = new Float32Array(N), R_ = new Float32Array(N);
  const bgBus = new Float32Array(N);   // mono music + SFX as mixed (the voice check's background)
  const voBuf = new Float32Array(N);

  /* ---- VO: compress, normalise each line to voLUFS, place ---- */
  const voLog = [], speech = [], speechById = [];
  for (const id of ids) {
    const v = timeline.vo[id], f = fileOf(id);
    const [m] = dec(f, 1, VO_COMP);
    const lufs = num(/I:\s+(-?[\d.]+) LUFS/, summary(ff(['-hide_banner', '-nostats', '-i', f, '-af', `${VO_COMP},ebur128`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr));
    const gDb = Number.isFinite(lufs) && lufs > -69 ? L.voLUFS - lufs : 0;
    voLog.push({ id, lufs: Number.isFinite(lufs) ? lufs : null, gainDb: +gDb.toFixed(2) });
    const g = db(gDb), o = Math.round(v.start * SR);
    for (let i = 0; i < m.length && o + i < N; i++) if (o + i >= 0) voBuf[o + i] += m[i] * g;
    const s = v.start + (v.speechStart || 0), e = v.start + (v.speechEnd ?? v.dur ?? m.length / SR);
    speech.push([s, e]); speechById.push({ id, s, e });
  }
  for (let i = 0; i < N; i++) { L_[i] += voBuf[i]; R_[i] += voBuf[i]; }

  /* ---- speech envelope (0..1), shared by music + SFX ducking: deterministic 120 ms linear ramps ---- */
  const sp = new Float32Array(N);
  for (const [s, e] of speech) sp.fill(1, Math.max(0, Math.round((s - DUCK_PAD) * SR)), Math.min(N, Math.round((e + DUCK_PAD) * SR)));
  const env = (() => {
    const w = Math.round(DUCK_RAMP * SR), o = new Float32Array(N), cs = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) cs[i + 1] = cs[i] + sp[i];
    const h = w >> 1; for (let i = 0; i < N; i++) { const a = Math.max(0, i - h), b = Math.min(N, i + h + 1); o[i] = (cs[b] - cs[a]) / (b - a); }
    return o;
  })();

  /* ---- music ---- */
  const musicFile = music === false ? null : path.resolve(music || path.join(P, 'audio', 'music', 'music.mp3'));
  let musicSec = null;
  if (musicFile && fs.existsSync(musicFile)) {
    const [ml, mr] = dec(musicFile, 2); musicSec = ml.length / SR;
    const fade = Math.round(MUSIC_FADE_OUT * SR);
    for (let i = 0; i < N && i < ml.length; i++) {
      const f = i > N - fade ? (N - i) / fade : 1; const g = db(L.music_gap + (L.music_under - L.music_gap) * env[i]);
      L_[i] += ml[i] * f * g; R_[i] += mr[i] * f * g; bgBus[i] += (ml[i] + mr[i]) * 0.5 * f * g;
    }
  }

  /* ---- SFX ---- */
  const sfxDir = path.join(P, 'audio', 'sfx'); const cache = new Map();
  const variants = (name) => {
    if (cache.has(name)) return cache.get(name);
    const v = [];
    if (/^[a-z0-9-]+$/.test(name)) for (const f of [`${name}.mp3`, ...[2, 3, 4].map((k) => `${name}-${k}.mp3`)]) {
      const p = path.join(sfxDir, f); if (!fs.existsSync(p)) continue;
      // one broken clip (a generator hiccup, a trim that left only a header) must never sink the whole mix
      let ch = null; try { ch = dec(p, 1)[0]; } catch (e) { console.warn(`WARNING sfx ${f} skipped: undecodable (${String(e && e.message || e).split('\n')[0].slice(0, 160)})`); continue; }
      if (!ch || ch.length < SR * 0.01) { console.warn(`WARNING sfx ${f} skipped: shorter than 10 ms`); continue; }
      v.push(ch);
    }
    cache.set(name, v); return v;
  };
  const list = (Array.isArray(cues) ? cues : cues?.cues || []).slice().sort((a, b) => a.t - b.t);
  const missingSfx = new Set(), counters = {}; let placed = 0;
  for (const c of list) {
    const vs = variants(c.name); if (!vs.length) { missingSfx.add(c.name); continue; }
    const k = counters[c.name] = (counters[c.name] || 0) + 1;   // deterministic: alternate variants by occurrence
    const src = vs[(k - 1) % vs.length]; const rate = c.rate || 1;
    let len = Math.round(src.length / rate);
    const looped = LOOPED.has(c.name) && c.dur;
    if (looped) len = Math.round(c.dur * SR);
    const start = Math.round(c.t * SR), xf = Math.round(0.04 * SR);
    const pan = Math.max(-1, Math.min(1, c.pan || 0)), ang = (pan + 1) * Math.PI / 4, gl = Math.cos(ang) * Math.SQRT2, gr = Math.sin(ang) * Math.SQRT2;
    const gain = db(L.sfx) * (c.gain ?? 1), tailFade = Math.round(0.03 * SR);
    for (let i = 0; i < len; i++) {
      const di = start + i; if (di < 0 || di >= N) continue;
      const pos = i * rate; let v;
      if (looped) {   // loop with a short crossfade at the seam
        const per = src.length - xf, p = pos % per, ip = Math.floor(p), fr = p - ip;
        v = src[ip] * (1 - fr) + (src[ip + 1] ?? 0) * fr;
        if (p < xf && pos >= per) { const q = src[src.length - xf + ip] ?? 0, w = p / xf; v = v * w + q * (1 - w); }
      } else { const ip = Math.floor(pos); if (ip >= src.length) break; const fr = pos - ip; v = src[ip] * (1 - fr) + (src[ip + 1] ?? 0) * fr; }
      const endFade = i > len - tailFade ? (len - i) / tailFade : 1;
      v *= gain * endFade * db(L.sfx_under_vo * env[di]);
      L_[di] += v * gl; R_[di] += v * gr; bgBus[di] += v;
    }
    placed++;
  }

  /* ---- voice check (pre-master) ---- */
  const VC = VOICE_CHECK, FW = Math.round(VC.frameSec * SR);
  const frameDb = (x, a) => { let q = 0; for (let i = a; i < a + FW; i++) q += x[i] * x[i]; return 10 * Math.log10(q / FW + 1e-12); };
  const lines = [];
  for (const { id, s, e } of speechById) {
    const vs = []; for (let a = Math.max(0, Math.round(s * SR)); a + FW < Math.min(N, Math.round(e * SR)); a += FW) vs.push([a, frameDb(voBuf, a)]);
    if (!vs.length) { lines.push({ id, median: null, lowShare: 0, ok: true, frames: 0 }); continue; }
    // speech frames only: within 18 dB of the line's loud level (p75) — pauses and breaths inside a line are not "voice"
    const p75 = vs.map((x) => x[1]).sort((x, y) => x - y)[Math.floor(vs.length * 0.75)];
    const r = vs.filter(([, v]) => v >= p75 - VC.speechWindowDb).map(([a, v]) => v - frameDb(bgBus, a)).sort((x, y) => x - y);
    const med = r[r.length >> 1], low = r.filter((x) => x < VC.lowDb).length / r.length;
    lines.push({ id, median: +med.toFixed(2), lowShare: +low.toFixed(4), ok: med >= VC.minMedian && low <= VC.maxLowShare, frames: r.length });
  }
  const voiceCheck = { ok: lines.every((l) => l.ok), lines };

  /* ---- master: gain + brickwall limiter walked to targetLUFS (±0.1) and true peak ≤ tp ---- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-mix-'));
  try {
    const raw = path.join(tmp, 'pre.f32'); const il = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { il[2 * i] = L_[i]; il[2 * i + 1] = R_[i]; }
    fs.writeFileSync(raw, Buffer.from(il.buffer));
    const inArgs = ['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw];
    // loudnorm's linear mode refuses when the gain would breach the true-peak ceiling (ends short on speech-peaky
    // mixes), so: measure, apply a plain gain + limiter, re-measure, correct.
    const measure = (af) => { const t = summary(ff(['-hide_banner', '-nostats', ...inArgs, '-af', `${af}ebur128=peak=true`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr);
      return { I: num(/I:\s+(-?[\d.]+) LUFS/, t), TP: num(/Peak:\s+(-?[\d.]+) dBFS/, t) }; };
    const pre = measure('');
    let gainDb = Number.isFinite(pre.I) ? L.targetLUFS - pre.I : 0, limDb = L.tp - 0.6, af2;
    for (let it = 0; it < 6; it++) {
      af2 = `volume=${gainDb.toFixed(3)}dB,alimiter=limit=${db(limDb).toFixed(4)}:attack=3:release=40:level=disabled,aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_len=${N},atrim=end_sample=${N}`;
      const m = measure(af2 + ','); const dI = L.targetLUFS - m.I, tpOver = m.TP - L.tp;
      if (!Number.isFinite(dI) || (Math.abs(dI) < 0.1 && tpOver <= 0.001)) break;
      if (Math.abs(dI) >= 0.1) gainDb += dI; if (tpOver > 0.001) limDb -= tpOver + 0.05;
    }
    const base = path.resolve(out || path.join(P, 'audio', 'mix'));
    fs.mkdirSync(path.dirname(base), { recursive: true });
    const sh = (a) => { const r = ff(['-y', '-hide_banner', '-v', 'error', ...a], { encoding: 'utf8' }); if (r.status) throw new Error('ffmpeg: ' + String(r.stderr).slice(-300)); };
    const files = { wav: base + '.wav', mp3: base + '.mp3', m4a: base + '.m4a' };
    sh([...inArgs, '-af', af2, '-c:a', 'pcm_s24le', '-ar', String(SR), files.wav]);
    sh(['-i', files.wav, '-c:a', 'libmp3lame', '-b:a', '256k', files.mp3]);
    sh(['-i', files.wav, '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', files.m4a]);
    const fin = summary(ff(['-hide_banner', '-nostats', '-i', files.wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr);
    return {
      lufs: num(/I:\s+(-?[\d.]+) LUFS/, fin), tp: num(/Peak:\s+(-?[\d.]+) dBFS/, fin), lra: num(/LRA:\s+([\d.]+) LU/, fin),
      duration: N / SR, voiceCheck, files, placed, missingSfx: [...missingSfx], vo: voLog, musicSec,
    };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const A = process.argv.slice(2); const arg = (k, d) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
  const promoDir = arg('--promo'), cuesFile = arg('--cues');
  if (!promoDir) { console.error('usage: mix.mjs --promo <promoDir> --cues cues.json [--music file] [--out base]'); process.exit(1); }
  const cues = cuesFile ? JSON.parse(fs.readFileSync(cuesFile, 'utf8')) : [];
  mixAudio({ promoDir, cues, music: arg('--music'), out: arg('--out'), ffmpeg: arg('--ffmpeg') }).then((r) => {
    if (!r.files) { console.log('silent timeline: no mix written'); return; }
    console.log('vo levelled: ' + r.vo.map((v) => `${v.id} ${v.lufs?.toFixed(1)} LUFS (${v.gainDb >= 0 ? '+' : ''}${v.gainDb} dB)`).join(' · '));
    if (r.missingSfx.length) console.warn('WARNING missing sfx files: ' + r.missingSfx.join(', '));
    console.log(`cues placed ${r.placed}; FINAL ${r.lufs} LUFS, LRA ${r.lra} LU, true peak ${r.tp} dBTP, ${r.duration.toFixed(3)} s → ${r.files.wav}`);
    console.log('voice check: line  median SBR  frames < 6 dB');
    for (const l of r.voiceCheck.lines) console.log(`  ${l.ok ? 'ok ' : 'LOW'} ${l.id}  median ${l.median ?? '–'} dB  ${(100 * l.lowShare).toFixed(0)}% < 6 dB`);
    if (!r.voiceCheck.ok) { console.error('VOICE CHECK FAILED: ' + r.voiceCheck.lines.filter((l) => !l.ok).map((l) => l.id).join(', ') + ' buried under music/SFX'); process.exit(3); }
    console.log('voice check passed: every line clearly above music + SFX');
  }).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
