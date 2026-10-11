// scripts/c4-render.mjs — the `c4Render` card: images of a checked C4 file. SVG always (the
// headless renderer in c4-view.mjs, with the vendored dagre); JPEG/PNG through a headless
// Chrome-family browser (c4-raster.mjs) when one is installed, else the card says so and ships
// the SVGs. Which formats, and whether the images go into the checkout, come from — in order —
// the card's params (wire-settable, so Ask Worca can set them), the person's answers on the
// C4 setup form (c4-setup.json in the pipeline dir), and the defaults.
//
// Every render, and a copy of the .c4 file itself, also lands in <pipelineDir>/c4/, which the
// `renders` port indexes as run artifacts: the Artifacts tab opens the .c4 in the viewer and the
// images as images, whether or not they were committed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseC4, renderToSVG } from '../ui/public/c4/c4-view.mjs';
import { loadDagre } from './c4-dagre.mjs';
import { openRaster } from './c4-raster.mjs';
import { resolveC4Path, toPosixRel, c4Roots } from './c4-paths.mjs';

const FORMATS = new Set(['svg', 'jpeg', 'png']);
const EXT = { svg: 'svg', jpeg: 'jpg', png: 'png' };
const SETUP_FILE = 'c4-setup.json';          // architectSetup's `answers` filename

/** The setup form's values, or {} when the run had none (a resumed or hand-built graph). */
function setupValues(pipelineDir) {
  try { const j = JSON.parse(readFileSync(join(pipelineDir, SETUP_FILE), 'utf8')); return (j && j.values) || {}; } catch { return {}; }
}

/** "svg, JPEG,jpg" → ['svg','jpeg']; unknown names dropped. */
export function parseFormats(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const out = [];
  for (const raw of list) {
    const f = String(raw).trim().toLowerCase().replace(/^jpg$/, 'jpeg');
    if (FORMATS.has(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Resolve what to render from params → setup answers → defaults. Pure. */
export function renderPlan(params = {}, setup = {}) {
  const fromParams = parseFormats(params.formats);
  const fromSetup = parseFormats(setup.exports);
  const formats = fromParams.length ? fromParams : fromSetup.length ? fromSetup : ['svg', 'jpeg'];
  const wanted = String(params.views || '').split(',').map((s) => s.trim()).filter(Boolean);
  const viewsFromSetup = setup.exportViews === 'Deployment sheet only' ? 'deployment' : 'all';
  const commit = params.commit === true || params.commit === 'true' ? true
    : params.commit === false || params.commit === 'false' ? false
      : setup.imagesTo !== 'Run artifacts only';
  return {
    formats,
    views: wanted,
    viewKind: wanted.length ? 'listed' : viewsFromSetup,
    scale: Number(params.scale) > 0 ? Math.min(4, Number(params.scale)) : 2,
    dark: String(params.theme || 'light').toLowerCase() === 'dark',
    commit,
    outDir: typeof params.outDir === 'string' ? params.outDir.trim() : '',
  };
}

export default async function ({ inputs, outputs, params, ctx, log }) {
  const env = JSON.parse(readFileSync(inputs.checked.path, 'utf8'));
  const file = resolveC4Path(env, ctx);
  if (!file || !existsSync(file)) throw new Error(`the checked C4 file is missing: ${env.path}`);
  const m = parseC4(readFileSync(file, 'utf8'));
  const dagre = loadDagre();
  if (!dagre) log('warn', 'dagre could not be loaded: element views fall back to rows');
  const plan = renderPlan(params, setupValues(ctx.pipelineDir));
  const stem = basename(file).replace(/\.(c4|likec4)$/i, '');
  const views = (env.views || []).filter((v) => (plan.viewKind === 'listed' ? plan.views.includes(v.id)
    : plan.viewKind === 'deployment' ? v.type === 'deployment' : true));

  // Run artifacts: a fresh c4/ folder every cycle, so a view the architect removed leaves no stale image.
  const artDir = join(ctx.pipelineDir, 'c4');
  rmSync(artDir, { recursive: true, force: true });
  mkdirSync(artDir, { recursive: true });
  copyFileSync(file, join(artDir, basename(file)));
  // The checkout copy, committed with the run, beside the file unless told otherwise.
  const outDir = plan.commit ? (plan.outDir ? join(dirname(file), plan.outDir) : join(dirname(file), `${stem}.renders`)) : null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  const raster = plan.formats.filter((f) => f !== 'svg');
  let browser = null; let skipped = '';
  if (raster.length && views.length) {
    const r = await openRaster();
    if (r.capture) browser = r; else { skipped = r.reason; log('warn', `JPEG/PNG skipped, SVG written: ${r.reason}`); }
  }
  const rows = [];
  try {
    for (const v of views) {
      const { svg, width, height } = renderToSVG(m, v.id, { dagre, dark: plan.dark });
      const written = [];
      const put = (name, data) => {
        writeFileSync(join(artDir, name), data);
        if (outDir) { const p = join(outDir, name); writeFileSync(p, data); written.push(p); }
        else written.push(join(artDir, name));
      };
      if (plan.formats.includes('svg') || !browser) put(`${v.id}.svg`, svg);
      if (browser) {
        for (const f of raster) {
          const buf = await browser.capture(svg, { width, height, scale: plan.scale, format: f, background: plan.dark ? '#1B1B19' : '#FBFBF9' });
          put(`${v.id}.${EXT[f]}`, buf);
        }
      }
      rows.push({ view: v, files: written });
    }
  } finally { if (browser) await browser.close(); }

  const roots = c4Roots(ctx);
  const root = (env.project && roots.find((r) => r.key === env.project)) || roots[0];
  const rel = (p) => (p.startsWith(ctx.pipelineDir) ? `(run) ${toPosixRel(ctx.pipelineDir, p)}` : toPosixRel(root.dir, p));
  const md = ['# C4 renders', '', `Source: \`${env.path}\`${roots.length > 1 ? ` in \`${root.key}\`` : ''}`,
    outDir ? `Images: \`${toPosixRel(root.dir, outDir)}/\` (committed with the run)` : 'Images: run artifacts only (not committed)',
    `Formats: ${plan.formats.join(', ')}${skipped ? ` — JPEG/PNG skipped: ${skipped}` : ''}`, ''];
  for (const r of rows) md.push(`## ${r.view.title}`, '', ...r.files.map((f) => `- \`${rel(f)}\``), '');
  if (!rows.length) md.push('No view matched the requested list.', '');
  writeFileSync(outputs.renders.path, md.join('\n'), 'utf8');
  const count = readdirSync(artDir).length - 1;
  return { summary: `${rows.length} view(s), ${count} image(s)${outDir ? ` → ${toPosixRel(root.dir, outDir)}` : ''}${skipped ? ' (SVG only)' : ''}` };
}
