#!/usr/bin/env node
// tools/firefox-smoke.mjs — load the built Firefox extension into a headless Firefox as a temporary add-on (web-ext run)
// and exit. web-ext rejects if the manifest or the install fails. Skips (exit 0) when no Firefox is installed locally;
// in CI (CI=true) a missing Firefox is a failure.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.FIREFOX_BIN, '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox', 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'].filter(Boolean);
let bin = candidates.find((c) => existsSync(c));
if (!bin) { try { bin = execFileSync('which', ['firefox'], { encoding: 'utf8' }).trim() || null; } catch { bin = null; } }
if (!bin) {
  console.log('firefox-smoke: SKIP — no Firefox found (set FIREFOX_BIN)');
  process.exit(process.env.CI ? 1 : 0);
}
// A stalled Firefox, or web-ext handles left open after exit(), must not hang CI.
const kill = setTimeout(() => { console.error('firefox-smoke: timed out after 120 s'); process.exit(1); }, 120_000);
// web-ext waits 30 s for Firefox's debugger port with no option to change it, and a cold start on a busy CI runner can
// take longer: its own connector with 90 s (750 x 120 ms), passed through the run command's firefoxClient option.
const { connectWithMaxRetries } = await import(new URL('./lib/firefox/remote.js', import.meta.resolve('web-ext')));
const runner = await webExt.cmd.run({
  sourceDir: join(ROOT, 'extension/dist/firefox'),
  target: ['firefox-desktop'],
  firefox: bin,
  args: ['-headless'],
  noInput: true,
  noReload: true,
}, { shouldExitProgram: false, firefoxClient: ({ port }) => connectWithMaxRetries({ port, maxRetries: 750 }) });
console.log('firefox-smoke: the extension installed as a temporary add-on');
await runner.exit();
clearTimeout(kill);
process.exit(0);
