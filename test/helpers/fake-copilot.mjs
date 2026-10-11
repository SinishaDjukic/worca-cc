// test/helpers/fake-copilot.mjs
// A stand-in `copilot` binary for the Copilot adapter's spawn tests: it records what it was handed (argv,
// stdin, the env names and values a test asks for, the node agent file, the MCP config), writes the usage
// file when asked (--usage-output-file), prints a captured JSONL fixture and exits with the given code.
import { writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} dir  scratch folder for the script and its record
 * @param {{fixture:string, code?:number, stderr?:string, usage?:object|null, envNames?:string[], holdMs?:number}} o
 * @returns {{bin:string, record:()=>object}}
 */
export function fakeCopilot(dir, { fixture, code = 0, stderr = '', usage = null, envNames = [], holdMs = 0 }) {
  const bin = join(dir, 'copilot');
  const rec = join(dir, 'record.json');
  const cfg = JSON.stringify({ fixture, code, stderr, usage, envNames, holdMs, rec });
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const cfg = ${cfg};
const argv = process.argv.slice(2);
let stdin = ''; process.stdin.on('data', (d) => { stdin += d; }).on('end', () => {
  const at = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
  const addDirs = argv.flatMap((a, i) => (a === '--add-dir' ? [argv[i + 1]] : []));
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const agentName = at('--agent');
  const agentFile = addDirs.length && agentName ? read(path.join(addDirs[0], '.github', 'agents', agentName + '.agent.md')) : null;
  const investigator = addDirs.length ? read(path.join(addDirs[0], '.github', 'agents', 'worca-investigator.agent.md')) : null;
  const mcp = at('--additional-mcp-config');
  const env = Object.fromEntries(cfg.envNames.map((n) => [n, process.env[n] ?? null]));
  fs.writeFileSync(cfg.rec, JSON.stringify({ argv, stdin, cwd: process.cwd(), env, agentFile, investigator, mcp: mcp ? read(mcp.replace(/^@/, '')) : null }));
  const usageFile = at('--usage-output-file');
  if (usageFile && cfg.usage) fs.writeFileSync(usageFile, JSON.stringify(cfg.usage));
  if (cfg.stderr) process.stderr.write(cfg.stderr + '\\n');
  const out = fs.readFileSync(cfg.fixture, 'utf8');
  setTimeout(() => { process.stdout.write(out, () => process.exit(cfg.code)); }, cfg.holdMs);
});
`);
  chmodSync(bin, 0o755);
  return { bin, record: () => JSON.parse(readFileSync(rec, 'utf8')) };
}
