#!/usr/bin/env node
// test/live/run.mjs
// The live harness suite: real harness binaries, real subscriptions, real tokens.
// NEVER part of `npm test` or CI (tools/test.mjs only reads test/*.mjs). Refuses
// to start unless WORCA_ALLOW_LIVE=1. See test/live/README.md.
//
//   WORCA_ALLOW_LIVE=1 node test/live/run.mjs [--engine claude] [--tier smoke|core|full]
//        [--only <id,glob*>] [--models cheap|matrix|<id,id>] [--repeat N] [--concurrency N]
//        [--baseline <checkout>] [--repo <checkout>] [--out <dir>] [--list]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSandbox } from './lib/sandbox.mjs';
import { sumWireCost } from './lib/checks.mjs';
import { diffBuilds } from './lib/diff.mjs';
import { writeReports } from './lib/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = resolve(HERE, '..', '..');
const TIERS = ['smoke', 'core', 'full'];

function parseArgs(argv) {
  const o = { engine: 'claude', tier: 'core', only: null, models: null, repeat: 1, concurrency: 3, baseline: null, repo: REPO_DEFAULT, out: null, list: false, keep: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => argv[++i];
    if (a === '--engine') o.engine = v();
    else if (a === '--tier') o.tier = v();
    else if (a === '--only') o.only = v().split(',').filter(Boolean);
    else if (a === '--models') o.models = v();
    else if (a === '--repeat') o.repeat = Math.max(1, Number(v()) || 1);
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(v()) || 1);
    else if (a === '--baseline') o.baseline = resolve(v());
    else if (a === '--repo') o.repo = resolve(v());
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--list') o.list = true;
    else { console.error(`unknown option ${a}`); process.exit(2); }
  }
  if (!TIERS.includes(o.tier)) { console.error(`--tier must be one of ${TIERS.join(', ')}`); process.exit(2); }
  return o;
}

const globRe = (g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

async function loadScenarios() {
  const dir = join(HERE, 'scenarios');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const s of list) out.push({ ...s, file: f });
  }
  return out;
}

async function capabilitiesOf(repo, engine) {
  try {
    const m = await import(pathToFileURL(join(repo, 'src', 'core', 'engines', 'index.mjs')).href);
    return { ...m.getEngine(engine).capabilities };
  } catch {
    return null; // a pre-multi-harness build: Claude only, everything capable
  }
}

function modelsFor(s, profile, opt) {
  if (Array.isArray(s.models)) return s.models;
  if (opt.models && opt.models !== 'cheap' && opt.models !== 'matrix') {
    const list = opt.models.split(',');
    return s.models === 'matrix' ? list : [list[0]];
  }
  if (s.models === 'matrix' && opt.models !== 'cheap') return profile.models.matrix;
  return [profile.models.cheap];
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function runOne(job, opt, profile, outDir) {
  const { scenario: s, model, rep, build } = job;
  const repo = build === 'baseline' ? opt.baseline : opt.repo;
  const label = `${s.id}-${model}-r${rep}${build === 'baseline' ? '-base' : ''}`;
  const checks = [];
  const notes = [];
  const t = {
    profile, model, build, repo, rep,
    check(name, cond, detail = '', { severity = 'fail' } = {}) { checks.push({ name, ok: !!cond, detail: String(detail ?? '').slice(0, 1200), severity }); return !!cond; },
    note(msg) { notes.push(String(msg)); },
    skip(reason) { const e = new Error(reason); e.skip = true; throw e; },
  };
  const t0 = Date.now();
  let sb = null; let error = null; let skipped = null;
  try {
    sb = createSandbox({ repo, profile, outDir: join(outDir, 'sandboxes'), label, env: s.env || {} });
    t.sb = sb;
    console.log(`▶ ${label}  (${sb.base})`);
    await s.run(t);
  } catch (err) {
    if (err && err.skip) skipped = err.message;
    else { error = String(err && err.stack || err); t.check('scenario completed without throwing', false, error); }
  }
  const taps = sb ? sb.taps() : [];
  const agentTaps = taps.filter((x) => !x.probe);
  const res = {
    id: s.id, title: s.title, tier: s.tier, model, rep, build, label, sandbox: sb?.base,
    ms: Date.now() - t0, checks, notes, skipped, error,
    spawns: agentTaps.length, wireCostUsd: sumWireCost(agentTaps),
    status: skipped ? 'skip' : checks.some((c) => !c.ok && c.severity === 'fail') ? 'fail' : 'pass',
    warnings: checks.filter((c) => !c.ok && c.severity === 'warn').length,
  };
  const failN = checks.filter((c) => !c.ok && c.severity === 'fail').length;
  console.log(`${res.status === 'pass' ? '✓' : res.status === 'skip' ? '○' : '✗'} ${label}  ${(res.ms / 1000).toFixed(0)}s  $${res.wireCostUsd.toFixed(3)}  ${checks.length - failN}/${checks.length} checks${skipped ? `  skip: ${skipped}` : ''}`);
  for (const c of checks.filter((x) => !x.ok)) console.log(`    ${c.severity === 'warn' ? '!' : '✗'} ${c.name} — ${c.detail.slice(0, 300)}`);
  return { res, taps, sb };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const profile = (await import(pathToFileURL(join(HERE, 'profiles', `${opt.engine}.mjs`)).href)).default;
  let scenarios = (await loadScenarios()).filter((s) => TIERS.indexOf(s.tier) <= TIERS.indexOf(opt.tier));
  if (opt.only) scenarios = scenarios.filter((s) => opt.only.some((g) => globRe(g).test(s.id)));
  scenarios = scenarios.filter((s) => !s.engines || s.engines.includes(opt.engine));
  if (opt.list) { for (const s of scenarios) console.log(`${s.id.padEnd(34)} ${s.tier.padEnd(6)} ${String(Array.isArray(s.models) ? s.models.join(',') : s.models || 'cheap').padEnd(8)} ${s.title}`); return; }

  if (process.env.WORCA_ALLOW_LIVE !== '1') {
    console.error('The live suite spends real tokens on your harness subscription. Set WORCA_ALLOW_LIVE=1 to run it.');
    process.exit(3);
  }
  const pf = profile.preflight();
  if (!pf.ok) { console.error(`${opt.engine} preflight failed: ${pf.reason}`); process.exit(4); }
  const caps = await capabilitiesOf(opt.repo, opt.engine);
  const outDir = opt.out || join(HERE, 'out', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });
  console.log(`live suite · engine=${opt.engine} (${pf.version}, auth ${pf.auth}) · tier=${opt.tier} · repo=${opt.repo}${opt.baseline ? ` · baseline=${opt.baseline}` : ''}\n  out: ${outDir}`);

  const jobs = [];
  for (const s of scenarios) {
    const missing = (s.requires || []).filter((k) => caps && caps[k] === false);
    for (const model of modelsFor(s, profile, opt)) {
      for (let rep = 1; rep <= (s.repeat || opt.repeat); rep++) {
        if (missing.length) { jobs.push({ scenario: s, model, rep, build: 'test', skip: `${opt.engine} lacks ${missing.join(', ')}` }); continue; }
        jobs.push({ scenario: s, model, rep, build: 'test' });
        if (opt.baseline && s.diff && rep === 1) jobs.push({ scenario: s, model, rep, build: 'baseline' });
      }
    }
  }
  // Serial scenarios (they own shared state like the real ~/.claude) run alone, after the pool.
  const parallel = jobs.filter((j) => !j.scenario.serial);
  const serial = jobs.filter((j) => j.scenario.serial);
  const run = (j) => (j.skip
    ? Promise.resolve({ res: { id: j.scenario.id, title: j.scenario.title, tier: j.scenario.tier, model: j.model, rep: j.rep, build: j.build, status: 'skip', skipped: j.skip, checks: [], notes: [], ms: 0, spawns: 0, wireCostUsd: 0 }, taps: [] })
    : runOne(j, opt, profile, outDir));
  const done = [...await pool(parallel, opt.concurrency, run)];
  for (const j of serial) done.push(await run(j));

  // Build-vs-build wire diffs.
  const diffs = [];
  for (const d of done.filter((x) => x.res.build === 'baseline')) {
    const peer = done.find((x) => x.res.build === 'test' && x.res.id === d.res.id && x.res.model === d.res.model && x.res.rep === 1);
    if (!peer || !peer.sb || !d.sb) continue;
    diffs.push({ id: d.res.id, model: d.res.model, ...diffBuilds(profile, { taps: d.taps, sb: d.sb }, { taps: peer.taps, sb: peer.sb }) });
  }
  const results = done.map((x) => x.res);
  const summary = writeReports(outDir, { opt, preflight: pf, caps, results, diffs });
  console.log(`\n${summary}`);
  process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exit(1); });
