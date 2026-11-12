#!/usr/bin/env node
// tools/stillhet-gates.mjs — runs the six prototype gates against the running app (docs/rail/gate.md). A sandbox app is started
// with `rail` on, each gate opens it through STILLHET_TARGET (plans/rail/prototype/gates/target.mjs), and what a gate reports is
// compared with test/fixtures/stillhet-gate-baselines.json. The baseline can only shrink: a finding outside it fails, and an
// entry the gate no longer reports also fails (delete it), so it cannot go stale or be raised without a visible edit.
//   npm run stillhet:gates [-- --only ds-check,click-check]
// Needs a Chromium that playwright can launch. NOT part of `npm test`.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BASELINES = join(ROOT, 'test/fixtures/stillhet-gate-baselines.json');
/** The six gates, with the arguments each takes when run against the app. Only the first two need the app's pages; all open it. */
export const GATES = ['ds-check', 'click-check', 'worca-sweep', 'colour-check', 'handover-check', 'settings-sentences'];

// A gate's count and summary lines ("1714 checks · ", "colour: …", handover-check's "ok …"), which change from run to run.
const SUMMARY = /^(\d+ (checks|clicks) ·|colour: |ok\s|settings-sentences: |\d+ sentences read wrong, in \d+ readings)/;
/** The findings a gate printed: its non-empty lines, less its summary; a crash is one finding, named by its error line. */
export function findingsOf(output) {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => /^Node\.js v\d/.test(l))) return [`crashed: ${lines.find((l) => /^\w*Error\b/.test(l)) || lines[0]}`];
  return [...new Set(lines.filter((l) => !SUMMARY.test(l)))].sort();
}

/**
 * @param {string[]} found     what the gate reported now
 * @param {string[]} baseline  what the baseline allows
 * @returns {{ added: string[], stale: string[] }}  findings outside the baseline, and baseline entries no longer reported
 */
export function checkBaseline(found, baseline) {
  return { added: found.filter((f) => !baseline.includes(f)), stale: baseline.filter((b) => !found.includes(b)) };
}

/** The line that says a gate could not start (no browser, a missing module), or null when it ran. */
export const launchFailure = (output) => output.split('\n').find((l) => /Executable doesn't exist|Failed to launch|Cannot find (package|module)/.test(l))?.trim() || null;

const runGate = (gate, env) => new Promise((resolve) => {
  let out = '';
  const c = spawn(process.execPath, [join(ROOT, 'plans/rail/prototype/gates', gate + '.mjs')], { cwd: ROOT, env: { ...process.env, ...env, FORCE_COLOR: '0' } });
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  c.on('close', (code) => resolve({ code, out }));
});

export async function main(argv = process.argv.slice(2)) {
  const oi = argv.indexOf('--only');
  const gates = oi >= 0 ? argv[oi + 1].split(',') : GATES;
  const baselines = JSON.parse(await readFile(BASELINES, 'utf8'));
  const { startApp, launchOptions } = await import('./stillhet-compare.mjs');
  await (await import('./stillhet-build.mjs')).buildStillhet();   // once, before any gate: against the app a gate never rebuilds them (target.mjs buildBundles)
  const chrome = launchOptions().executablePath;   // the compare's Chrome; colour-check and handover-check read CHROME, the rest launch channel 'chrome'
  const home = await mkdtemp(join(tmpdir(), 'stillhet-gates-'));
  const app = await startApp(home, { WORCA_STILLHET_DEMO: '1' }, { lockRail: true });   // demo data (D3); locked, so no gate's click turns it off
  let code = 0;
  try {
    for (const gate of gates) {
      const { code: exit, out } = await runGate(gate, { STILLHET_TARGET: app.base, ...(chrome ? { CHROME: chrome } : {}) });
      const failed = launchFailure(out);
      if (failed) { code = 1; console.log(`FAIL ${gate}: could not start: ${failed}`); continue; }   // the other gates still run
      const { added, stale } = checkBaseline(exit === 0 ? [] : findingsOf(out), baselines[gate] || []);
      const bad = added.length || stale.length;
      if (bad) code = 1;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${gate}: ${added.length} new, ${stale.length} stale baseline entries`);
      for (const a of added) console.log('  new:   ' + a);
      for (const s of stale) console.log('  stale: ' + s);
    }
  } finally { app.stop(); await rm(home, { recursive: true, force: true }); }
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
