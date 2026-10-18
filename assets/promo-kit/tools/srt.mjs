#!/usr/bin/env node
// Captions (SRT) from the narration's word timings in <promo>/timeline.json: ≤ 42 chars a line, ≤ 2 lines a cue,
// cues split at sentence breaks, never overlapping.
//   node promo-kit/tools/srt.mjs <promoDir> [--out <promoDir>/video/promo.en.srt]
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX = 42;
const len = (ws) => ws.join(' ').length;
/** Best two-line split of words (balanced), or null when it can't fit in 2 × MAX. */
function split2(ws) {
  if (len(ws) <= MAX) return [ws];
  let best = null, bd = Infinity;
  for (let i = 1; i < ws.length; i++) {
    const a = len(ws.slice(0, i)), b = len(ws.slice(i));
    if (a <= MAX && b <= MAX && Math.max(a, b) < bd) { bd = Math.max(a, b); best = i; }
  }
  return best == null ? null : [ws.slice(0, best), ws.slice(best)];
}

const ts = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

/** SRT text for a timeline (`vo.*.start` absolute, words relative to it). Empty string when there is no narration. */
export function buildSrt(timeline) {
  const vo = timeline?.vo || {};
  const ids = Object.keys(vo).sort((a, b) => vo[a].start - vo[b].start);
  const cues = [];
  for (const id of ids) {
    const line = vo[id];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      cues.push({ t0: line.start + cur[0].t0, t1: line.start + cur.at(-1).t1, words: cur.map((w) => w.w.replace(/\.\.\.$/, '…')) });
      cur = [];
    };
    for (const w of line.words || []) {
      if (cur.length && !split2([...cur, w].map((x) => x.w))) flush();
      cur.push(w);
      if (/[.?!:]$|\.\.\.$|…$/.test(w.w) && len(cur.map((x) => x.w)) > 18) flush();
    }
    flush();
  }
  return cues.map((c, i) => {
    const next = cues[i + 1];
    let end = Math.min(c.t1 + 0.35, next ? next.t0 - 0.05 : c.t1 + 1.2);
    if (end <= c.t0) end = next ? Math.max(c.t0 + 0.01, Math.min(next.t0, c.t1)) : c.t0 + 0.5;
    const lines = split2(c.words) || [c.words];
    return `${i + 1}\n${ts(c.t0)} --> ${ts(end)}\n${lines.map((l) => l.join(' ')).join('\n')}\n`;
  }).join('\n');
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const a = process.argv.slice(2);
  const promo = a.includes('--promo') ? a[a.indexOf('--promo') + 1] : a.find((x) => !x.startsWith('--'));
  if (!promo) { console.error('usage: srt.mjs <promoDir> [--out file.srt]'); process.exit(1); }
  const out = resolve(a.includes('--out') ? a[a.indexOf('--out') + 1] : join(promo, 'video', 'promo.en.srt'));
  const srt = buildSrt(JSON.parse(readFileSync(join(promo, 'timeline.json'), 'utf8')));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, srt);
  console.log(`${srt ? srt.trim().split(/\n\n+/).length : 0} captions → ${out}`);
}
