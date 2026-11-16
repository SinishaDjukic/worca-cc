#!/usr/bin/env node
// tools/stillhet-sweeps.mjs — runs only the prototype sweeps a change needs, from disk, one after another (each already runs
// its units side by side, plans/rail/prototype/gates/pool.mjs). Which sweep a path needs follows docs/rail/gate.md › The
// checks, its "When" column; a file every page shares needs all four. The change is the working tree against HEAD (staged,
// unstaged, untracked), and with --base REF the commits since it too.
//   npm run stillhet:sweeps [-- --base origin/docs/rail-agreed] [--all] [--list] [--workers N]
// Needs a Chromium that playwright can launch. NOT part of `npm test`.
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTO = 'plans/rail/prototype';
/** The four sweeps, cheapest first, with the page each opens (run-page-sweep and pulse-sweep take theirs as an argument). */
export const SWEEPS = { 'ds-check': null, 'worca-sweep': null, 'run-page-sweep': 'run-page.html', 'pulse-sweep': 'pulse.html' };
const ALL = Object.keys(SWEEPS);
const S = 'ui/public/stillhet/';
/** Path rules, first match wins: [pattern, the sweeps it needs]. */
const RULES = [
  // what every page draws with, and the gates' shared parts
  [/^ui\/public\/design-system\//, ALL],
  [new RegExp(`^${S}(app\\.css|components\\.js|adapter\\.js|css/|demo/)`), ALL],
  [new RegExp(`^${PROTO}/gates/(pool|target|app-css|components-js|align-check)\\.mjs$`), ALL],
  // a gate's own script: that gate
  [new RegExp(`^${PROTO}/gates/(${ALL.join('|')})\\.mjs$`), (m) => [m[1]]],
  [new RegExp(`^${PROTO}/gates/`), []],   // the other gates (click-check, colour-check, …) are not sweeps
  // the run page's model also feeds Pulse; the run or group page: run-page-sweep (gate.md)
  [new RegExp(`^${S}runs/run-page-model\\.js$`), ['ds-check', 'run-page-sweep', 'pulse-sweep']],
  [new RegExp(`^(${S}runs/|${PROTO}/run-page\\.html$)`), ['ds-check', 'run-page-sweep']],
  // Pulse or Settings: pulse-sweep; world.js is the store Pulse reads, in the shell's folder
  [new RegExp(`^${S}shell/world\\.js$`), ['ds-check', 'worca-sweep', 'pulse-sweep']],
  [new RegExp(`^(${S}(pulse|settings)/|${PROTO}/pulse\\.html$)`), ['ds-check', 'pulse-sweep']],
  // the shell, what joins pages, and every other place (they open in index.html): worca-sweep
  [new RegExp(`^(${S}|${PROTO}/index\\.html$)`), ['ds-check', 'worca-sweep']],
  [new RegExp(`^${PROTO}/[^/]+\\.(html|js)$`), ['ds-check']],   // the switch page and the gallery
];

/** The sweeps a list of changed paths needs, in SWEEPS order. */
export function sweepsFor(paths) {
  const need = new Set();
  for (const p of paths) for (const [re, gates] of RULES) {
    const m = re.exec(p); if (!m) continue;
    for (const g of typeof gates === 'function' ? gates(m) : gates) need.add(g);
    break;
  }
  return ALL.filter((g) => need.has(g));
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
/** The changed paths: the working tree against HEAD, untracked files, and with a base the commits since it. */
export function changedPaths(base) {
  const out = [...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')];
  if (base) out.push(...git('diff', '--name-only', `${base}...HEAD`));
  return [...new Set(out)];
}

const flag = (argv, name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const run = (gate, extra) => new Promise((resolve) => {
  const page = SWEEPS[gate];
  const args = [join(ROOT, PROTO, 'gates', gate + '.mjs'), ...(page ? [pathToFileURL(join(ROOT, PROTO, page)).href] : []), ...extra];
  const t0 = Date.now();
  const c = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  c.on('close', (code) => resolve({ gate, code, s: Math.round((Date.now() - t0) / 1000) }));
});

/** The runner. Returns the exit code: 1 when a sweep found something, 2 on a bad argument. */
export async function main(argv = process.argv.slice(2)) {
  const base = flag(argv, '--base');
  if (argv.includes('--base') && (!base || base.startsWith('--'))) { console.error('--base needs a ref'); return 2; }
  let gates;
  if (argv.includes('--all')) gates = ALL;
  else {
    let paths;
    try { paths = changedPaths(base); } catch (e) { console.error(e.message.split('\n')[0]); return 2; }
    gates = sweepsFor(paths);
  }
  if (!gates.length) { console.log('no sweep needed: nothing changed that a prototype page draws'); return 0; }
  console.log(`sweeps: ${gates.join(', ')}`);
  if (argv.includes('--list')) return 0;
  const wi = argv.findIndex((a) => a === '--workers' || a.startsWith('--workers='));
  const extra = wi < 0 ? [] : argv[wi].includes('=') ? [argv[wi]] : argv.slice(wi, wi + 2);
  const results = [];
  for (const g of gates) { console.log(`\n── ${g}`); results.push(await run(g, extra)); }
  console.log('\n' + results.map((r) => `${r.code === 0 ? 'ok  ' : 'FAIL'} ${r.gate} (${r.s} s)`).join('\n'));
  return results.some((r) => r.code !== 0) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
