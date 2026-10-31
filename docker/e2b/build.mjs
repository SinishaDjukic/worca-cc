#!/usr/bin/env node
// docker/e2b/build.mjs
// Build worca's E2B sandbox template (docker/e2b/e2b.Dockerfile) through the E2B API.
// Needs the optional `e2b` package and a reachable E2B API — never run by tests or CI.
//
//   E2B_API_KEY=… E2B_API_URL=http://localhost:3000 npm run e2b:build -- [--name worca-agent]
//        [--cpu 2] [--memory-mb 4096] [--no-cache]
import { pathToFileURL } from 'node:url';
// One renderer for this script and the server's project builds (src/core/exec-env/backends/e2b-template.mjs).
import { renderTemplateDockerfile, pinnedClaudeCodeVersion, cliVersionsLine } from '../../src/core/exec-env/backends/e2b-template.mjs';

export { renderTemplateDockerfile };

export function parseArgs(argv) {
  const o = { name: process.env.WORCA_E2B_TEMPLATE || 'worca-agent', cpuCount: 2, memoryMB: 4096, skipCache: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => argv[++i];
    if (a === '--name') o.name = v();
    else if (a === '--cpu') o.cpuCount = Number(v());
    else if (a === '--memory-mb') o.memoryMB = Number(v());
    else if (a === '--no-cache') o.skipCache = true;
    else throw new Error(`e2b:build: unknown option ${a}`);
  }
  if (!Number.isInteger(o.cpuCount) || o.cpuCount < 1) throw new Error('e2b:build: --cpu must be a positive integer');
  if (!Number.isInteger(o.memoryMB) || o.memoryMB % 2) throw new Error('e2b:build: --memory-mb must be an even integer');
  return o;
}

export async function buildTemplate({ sdk, name, cpuCount, memoryMB, skipCache = false, conn, log = console.log }) {
  const { Template, defaultBuildLogger } = sdk;
  const tpl = Template().fromDockerfile(renderTemplateDockerfile(pinnedClaudeCodeVersion()));
  return Template.build(tpl, name, { ...conn, cpuCount, memoryMB, skipCache,
    onBuildLogs: defaultBuildLogger ? defaultBuildLogger() : (e) => log(String(e?.message ?? e)) });
}

async function main() {
  let o; try { o = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }
  if (!process.env.E2B_API_KEY) { console.error('e2b:build: E2B_API_KEY is not set'); process.exit(2); }
  let sdk; try { sdk = await import('e2b'); } catch { console.error('e2b:build: the optional "e2b" package is missing (npm install e2b@2.56.0)'); process.exit(1); }
  const conn = { apiKey: process.env.E2B_API_KEY, ...(process.env.E2B_API_URL ? { apiUrl: process.env.E2B_API_URL } : {}) };
  console.log(`e2b:build: ${o.name} (${cliVersionsLine()}, ${o.cpuCount} vCPU, ${o.memoryMB} MB) via ${conn.apiUrl || 'E2B Cloud'}`);
  const info = await buildTemplate({ sdk, ...o, conn });
  console.log(`e2b:build: done — template ${info.name || o.name} (${info.templateId}, build ${info.buildId})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(`e2b:build: ${err?.message || err}`); process.exit(1); });
