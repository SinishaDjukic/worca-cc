// assets/design-kit/look.mjs — see what a Design looks like as it stands.
//
//   node look.mjs <work folder> <out folder> [section id …]
//
// Shoots every built section of the design in <work folder> into <out folder>/<id>.png and prints where, then lists
// each picture that its frame cuts (a screenshot zoomed past its box, or cropped by `object-fit: cover`). The lead of
// a Design build runs it before it judges the sections: a section is what it looks like, not what its files say.
// A picture worca made (under `assets/made/`) that only `object-fit: cover` cuts fills its box on purpose: it is
// listed as cropped, not cut, and needs nothing done.
//
// What is shot is the build page (`assembleDesign`, mode `build`): every finished section in its finished state, with
// no script of the design running. A deck or a video is laid out as its board, one slide or scene per row at two
// thirds of the canvas; a web page at its canvas width. The page is written to <out folder>/page.html and loads the
// design's files from the work folder through a `<base>`. Nothing is written into the work folder.
//
// It needs Chrome or Edge on the machine, driven through the capture kit's `open` (playwright-core).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleDesign } from '../../src/core/design/assemble.mjs';
import { classifyRef } from '../../src/core/design/html-scan.mjs';
import { isBoardKind } from '../../src/core/design/kinds.mjs';
import { open } from '../promo-kit/capture/lib.mjs';

/** A board tile's size against the canvas: 1920×1080 is shot as 1280×720, large enough to read and light to look at. */
const SCALE = 2 / 3;
/** A web page's window height. Each section is shot whole, however tall. */
const WEB_HEIGHT = 900;
/** Below this share a picture counts as cut; the rest is rounding and rounded corners. */
const WHOLE = 0.98;
/** How long the page may take to load its pictures before they are measured as they are. */
const PICTURES_MS = 8000;

const HEAD_OPEN = /<head(?:[\t\n\f\r ][^>]*)?>/i;
const DOCTYPE = /^[\t\n\f\r ]*<!doctype[^>]*>/i;

/**
 * The page the Look kit opens: the design's build page, loading from `workDir`, the board at one column.
 * @param {{ workDir: string, plan: { kind?: string, canvas?: { w?: number, h?: number }, sections?: { id: string }[] } }} opts
 * @returns {{ html: string, ids: string[], waiting: string[], size: { w: number, h: number }, board: boolean }} `ids`
 *   are the built sections, in plan order; `waiting` the ones not finished yet; `size` the window to open
 */
export function lookDoc({ workDir, plan }) {
  const { html, sections } = assembleDesign({ workDir, plan, mode: 'build' });
  const board = isBoardKind(plan?.kind);
  const w = Number.isFinite(plan?.canvas?.w) ? plan.canvas.w : 1440;
  const h = Number.isFinite(plan?.canvas?.h) ? plan.canvas.h : 1080;
  const head = `<base href="${pathToFileURL(`${resolve(workDir)}/`).href}">`
    + (board ? `<style>:root{--worca-board-s:${SCALE.toFixed(7)};--worca-board-cols:1;--worca-board-pad:0px;--worca-board-pad-b:0px;--worca-board-gap:0px;--worca-board-r:0px}</style>` : '');
  const at = HEAD_OPEN.exec(html);
  const cut = at ? at.index + at[0].length : (DOCTYPE.exec(html)?.[0].length ?? 0);
  return {
    html: html.slice(0, cut) + head + html.slice(cut),
    ids: sections.filter((s) => s.state === 'included').map((s) => s.id),
    waiting: sections.filter((s) => s.state !== 'included').map((s) => s.id),
    size: board ? { w: Math.round(w * SCALE), h: Math.round(h * SCALE) } : { w, h: WEB_HEIGHT },
    board,
  };
}

/**
 * The share of a picture that is on screen, 0 to 1: what its clipping boxes leave of its box, times what
 * `object-fit: cover` keeps of the picture. Null for a picture with no box or one that did not load.
 * @param {{ box: { x: number, y: number, w: number, h: number }, clips?: { x: number, y: number, w: number, h: number }[],
 *   natural: { w: number, h: number }, fit?: string }} m all rects in the same page pixels
 * @returns {number | null}
 */
export function shown({ box, clips = [], natural, fit }) {
  if (!(box?.w > 0 && box?.h > 0) || !(natural?.w > 0 && natural?.h > 0)) return null;
  let x0 = box.x;
  let y0 = box.y;
  let x1 = box.x + box.w;
  let y1 = box.y + box.h;
  for (const c of clips) {
    x0 = Math.max(x0, c.x);
    y0 = Math.max(y0, c.y);
    x1 = Math.min(x1, c.x + c.w);
    y1 = Math.min(y1, c.y + c.h);
  }
  const visible = (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / (box.w * box.h);
  if (fit !== 'cover') return visible;
  const a = box.w / box.h;
  const b = natural.w / natural.h;
  return visible * (Math.min(a, b) / Math.max(a, b));
}

/** The first clipping box, from the picture outward, that the picture's box reaches past; null when none does. */
function cutBy({ box, clips = [] }) {
  const past = (c) => box.x < c.x - 0.5 || box.y < c.y - 0.5 || box.x + box.w > c.x + c.w + 0.5 || box.y + box.h > c.y + c.h + 0.5;
  return clips.find(past)?.by ?? null;
}

/**
 * One cut picture as a line the lead can act on.
 * @param {{ src: string, natural: { w: number, h: number }, shown: number, by: string | null }} cut
 * @returns {string}
 */
export function cutLine({ src, natural, shown: share, by }) {
  return `cut: ${src} (${natural.w}×${natural.h}) shows ${Math.round(share * 100)}% of itself: ${by ? `${by} cuts it` : '`object-fit: cover` cuts it'}`;
}

/**
 * One made picture that fills its box, as a line that tells the lead it is meant to be so.
 * @param {{ src: string, natural: { w: number, h: number }, shown: number }} crop
 * @returns {string}
 */
export function cropLine({ src, natural, shown: share }) {
  return `cropped: ${src} (${natural.w}×${natural.h}) fills its box and shows ${Math.round(share * 100)}% of itself`;
}

/** A picture worca made (`assets/made/`) that only `object-fit: cover` cuts: its clipping boxes leave it whole. */
function filled(m) {
  const ref = classifyRef(m.src);
  return ref.type === 'local' && ref.rel.startsWith('assets/made/') && m.fit === 'cover' && shown({ ...m, fit: 'fill' }) >= WHOLE;
}

/** In the page: load every picture now, lazy ones too, and wait for them (or for `ms`). */
function loadPictures(ms) {
  const imgs = [...document.images];
  for (const img of imgs) img.loading = 'eager';
  const all = Promise.all(imgs.map((img) => (img.complete ? null : new Promise((done) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }))));
  return Promise.race([all, new Promise((done) => { setTimeout(done, ms); })]).then(() => null);
}

/** In the page: every `<img>` of the named sections with its box, its size as a file, its fit, and the boxes that
 *  clip it (each ancestor that does not show overflow, up to the section's root). */
function collect(ids) {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const out = [];
  for (const id of ids) {
    const root = document.querySelector(`[data-section="${id}"]`);
    if (!root) continue;
    for (const img of root.querySelectorAll('img')) {
      const clips = [];
      for (let el = img.parentElement; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          clips.push({ ...rect(el), by: el.tagName.toLowerCase() + (el.classList.length ? `.${el.classList[0]}` : '') });
        }
        if (el === root) break;
      }
      out.push({ section: id, src: img.getAttribute('src') || '', box: rect(img), clips,
        natural: { w: img.naturalWidth, h: img.naturalHeight }, fit: getComputedStyle(img).objectFit });
    }
  }
  return out;
}

/**
 * Shoots the built sections of the design in `workDir` and measures their pictures.
 * @param {{ workDir: string, outDir: string, ids?: string[] | null, chrome?: string }} opts `ids` names the sections
 *   to shoot (all the built ones when empty); `chrome` a browser binary, else the first one found
 * @returns {Promise<{ shots: { id: string, file: string }[], cuts: { section: string, src: string,
 *   natural: { w: number, h: number }, shown: number, by: string | null }[], crops: { section: string, src: string,
 *   natural: { w: number, h: number }, shown: number }[], waiting: string[], page: string }>} `crops` are the made
 *   pictures that only `object-fit: cover` cuts; they are never in `cuts`
 * @throws when plan.json does not read, the page cannot be assembled, or no Chrome-family browser is found
 */
export async function look({ workDir, outDir, ids = null, chrome } = {}) {
  const plan = JSON.parse(readFileSync(join(workDir, 'plan.json'), 'utf8'));
  const doc = lookDoc({ workDir, plan });
  mkdirSync(outDir, { recursive: true });
  const pageFile = join(outDir, 'page.html');
  writeFileSync(pageFile, doc.html);
  const want = ids?.length ? doc.ids.filter((id) => ids.includes(id)) : doc.ids;
  const { page, close } = await open({ url: pathToFileURL(pageFile).href, dsf: 1, width: doc.size.w, height: doc.size.h, chrome });
  try {
    await page.evaluate(loadPictures, PICTURES_MS);
    const shots = [];
    for (const id of want) {
      const file = join(outDir, `${id}.png`);
      await page.locator(`[data-section="${id}"]`).first().screenshot({ path: file, animations: 'disabled' });
      shots.push({ id, file });
    }
    const cuts = [];
    const crops = [];
    for (const m of await page.evaluate(collect, want)) {
      const share = shown(m);
      if (share !== null && share < WHOLE) {
        if (filled(m)) crops.push({ section: m.section, src: m.src, natural: m.natural, shown: share });
        else cuts.push({ section: m.section, src: m.src, natural: m.natural, shown: share, by: cutBy(m) });
      }
    }
    return { shots, cuts, crops, waiting: doc.waiting, page: pageFile };
  } finally {
    await close();
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The command: prints one line per section, its cut then its cropped pictures under it, then the count. Returns the
 *  exit code. */
async function main(argv) {
  const [work, out, ...ids] = argv;
  if (!work || !out) {
    console.error('Usage: node look.mjs <work folder> <out folder> [section id …]');
    return 2;
  }
  let result;
  try {
    result = await look({ workDir: resolve(work), outDir: resolve(out), ids });
  } catch (err) {
    console.error(`look: ${err?.message ?? err}`);
    return 1;
  }
  for (const shot of result.shots) {
    console.log(`${shot.id}  ${shot.file}`);
    for (const cut of result.cuts.filter((c) => c.section === shot.id)) console.log(`  ${cutLine(cut)}`);
    for (const crop of result.crops.filter((c) => c.section === shot.id)) console.log(`  ${cropLine(crop)}`);
  }
  for (const id of result.waiting) console.log(`${id}  not built yet`);
  const cropped = result.crops.length > 0 ? `, ${result.crops.length} cropped` : '';
  console.log(`${plural(result.shots.length, 'section')} shot, ${plural(result.cuts.length, 'picture')} cut${cropped}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await main(process.argv.slice(2)));
}
