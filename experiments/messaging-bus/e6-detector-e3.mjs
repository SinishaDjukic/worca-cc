#!/usr/bin/env node
// experiments/messaging-bus/e6-detector-e3.mjs — E6 (plan §4.10): E3's grid re-run with the contract.changed
// publish TRIGGERED by A's hook detector (--detect) instead of a scripted bus.publish. Each case runs with
// both triggers; E3's metrics are reported under `e6.` for the detector run, plus whether every case equals
// its scripted twin, false publishes (outside tick k), auto-publishes per case and self-shows.
//   node e6-detector-e3.mjs [--quick] [--out <path>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase, summarize as summarizeE3, S_B } from './e3-contract-change.mjs';
import { round } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAME = ['rework', 'leadTime', 'makespan', 'correct'];

export function summarize(pairs) {
  const det = pairs.map((p) => p.detector);
  const s = {};
  for (const [k, v] of Object.entries(summarizeE3(det))) s[k.replace(/^e3\./, 'e6.')] = v;
  s['e6.equalsScripted'] = pairs.every((p) => SAME.every((key) => p.detector[key] === p.scripted[key]));
  const busArms = det.filter((c) => c.arm !== 'review');
  s['e6.falsePublishes'] = busArms.reduce((x, c) => x + c.falsePublishes, 0);
  s['e6.autoPublishes.perCase'] = Math.max(0, ...busArms.map((c) => c.autoPublishes));
  const tokens = busArms.map((c) => c.bodyTokens).filter((t) => t > 0);
  s['e6.meanBodyTokens'] = tokens.length ? round(tokens.reduce((x, y) => x + y, 0) / tokens.length, 2) : 0;
  s['e6.selfShows'] = busArms.reduce((x, c) => x + c.selfShows, 0);
  return s;
}

function parseArgs(argv) {
  const o = { quick: false, out: join(HERE, 'results', 'e6.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quick') o.quick = true;
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const pairs = [];
  for (const variant of ['spread', 'late']) {
    for (const k of o.quick ? [5] : [2, 5, 8]) {
      for (const topology of ['decompose', 'subagents']) {
        for (const arm of ['review', 'bus-act', 'bus-ignore']) {
          const c = { variant, k, topology, arm };
          pairs.push({ scripted: await runCase(c), detector: await runCase({ ...c, trigger: 'detector' }) });
        }
      }
    }
  }
  const summary = summarize(pairs);
  const result = {
    experiment: 'e6', quick: o.quick,
    method: "E3's step model with the announcement triggered by A's hook detector; delivery delay measured from the real hooks",
    env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
    S_B, durationMs: Date.now() - t0, summary,
    cases: pairs.map((p) => ({ ...p.detector, scriptedTwin: Object.fromEntries(SAME.map((k) => [k, p.scripted[k]])) })),
  };
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}
