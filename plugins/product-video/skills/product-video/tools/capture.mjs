#!/usr/bin/env node
// capture.mjs — run a CLI session for real and save it for playTerminal() (harness.mjs).
//
//   node capture.mjs session.in.json session.json
//
// session.in.json: { "title": "acme — demo", "prompt": "~/acme $ ", "cwd": "/abs/scratch/project",
//                    "env": { "HOME": "/abs/scratch/home" }, "cols": 100, "rows": 28, "theme": "dark",
//                    "steps": [ { "card": ["Exports", "Ship a report in one command"] },
//                               { "caption": "Export last week's runs" },
//                               { "cmd": "acme export --since 7d", "pauseAfter": 2200 } ] }
//
// Each `cmd` runs through the platform shell (/bin/sh; cmd.exe on Windows, so write the commands for it there) in
// `cwd` with `env` merged over a minimal PATH/HOME/TERM, FORCE_COLOR=1 and COLUMNS set, so the recorded output is the
// tool's own (colours included). Output is captured, never invented; a
// command that exits non-zero is recorded as it is and reported on stderr, so the storyboard can decide.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node capture.mjs session.in.json session.json'); process.exit(2); }
const s = JSON.parse(readFileSync(inPath, 'utf8'));
// Windows: a child cannot start without SYSTEMROOT, and npm/node tools need the profile and temp folders.
const winBase = process.platform === 'win32'
  ? Object.fromEntries(['SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
  : {};
const env = {
  ...winBase, PATH: process.env.PATH, HOME: process.env.HOME, TERM: 'xterm-256color', FORCE_COLOR: '1', CLICOLOR_FORCE: '1',
  COLUMNS: String(s.cols || 100), LINES: String(s.rows || 28), LANG: 'en_US.UTF-8', ...(s.env || {}),
};
let failed = 0;
for (const step of s.steps || []) {
  if (!step.cmd) continue;
  const r = spawnSync(step.cmd, { shell: true, cwd: s.cwd || process.cwd(), env, encoding: 'utf8', timeout: step.timeoutMs || 120000, maxBuffer: 16 * 1024 * 1024 });
  step.output = `${r.stdout || ''}${r.stderr || ''}`;
  step.exitCode = r.status;
  if (r.status !== 0) { failed += 1; process.stderr.write(`exit ${r.status}: ${step.cmd}\n`); }
}
const { env: _drop, cwd: _cwd, ...out } = s;   // paths and env stay out of the replay file
writeFileSync(outPath, JSON.stringify(out, null, 2));
process.stderr.write(`captured ${(s.steps || []).filter((x) => x.cmd).length} commands (${failed} non-zero) -> ${outPath}\n`);
