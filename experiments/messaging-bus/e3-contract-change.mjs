#!/usr/bin/env node
// experiments/messaging-bus/e3-contract-change.mjs — E3 (plan §4.3): a breaking contract change by
// agent A while agent B writes call sites, with the bus (B's real PostToolUse hook) vs today's
// review loop. Agents are scripted; the numbers come from an explicit STEP MODEL, but the delivery
// delay d is MEASURED from the real hook output, and each arm's final code is truth-checked by
// running it.  node e3-contract-change.mjs [--quick] [--out <path>]
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSqliteBus } from './lib/sqlite-bus.mjs';
import { estimateTokens } from './lib/render.mjs';
import { round } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'lib', 'hook.mjs');
const N = 10;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const S_B = { spread: range(1, 10), late: range(6, 10) };
const START_MARK = 'step:r_e3:impl:1';
const PREFIX = 'run.r_e3.step.impl';

/** The pure step model (d = delivery delay in extra ticks). */
export function predict({ S_B: writes, k, d = 0, arm, N: n = N }) {
  if (arm === 'bus-act') {
    const rework = writes.filter((t) => t <= k + d).length;
    return { rework, leadTime: d + 1, makespan: n + rework + 1, reviewCycles: 0 };
  }
  const rework = writes.length;
  const leadTime = arm === 'review' ? n - k + 1 : d + 1;
  return { rework, leadTime, makespan: n + 1 + rework + 1, reviewCycles: 1 };
}

const LIB_V1 = 'export function price(item) {\n  return item.cost;\n}\n';
const LIB_V2 = "export function price(item, opts) {\n  if (!opts || !opts.currency) throw new TypeError('currency required');\n  return item.cost;\n}\n";
const site = (t, v2) => (v2 ? `  () => price({ id: ${t}, cost: ${t} }, { currency: 'EUR' }),` : `  () => price({ id: ${t}, cost: ${t} }),`);
const isV1 = (line) => line.includes('price(') && !line.includes('currency');
const toV2 = (line) => line.replace(/\}\),$/, "}, { currency: 'EUR' }),");
const cartText = (lines) => `import { price } from './lib.mjs';\nexport const sites = [\n${lines.join('\n')}${lines.length ? '\n' : ''}];\n`;

function truthCheck(dir) {
  for (const f of ['lib.mjs', 'cart.mjs']) {
    if (spawnSync(process.execPath, ['--check', join(dir, f)]).status !== 0) return false;
  }
  const script = `const m = await import(${JSON.stringify(pathToFileURL(join(dir, 'cart.mjs')).href)});
    for (const s of m.sites) s();`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script]).status === 0;
}

/** The read of a bus arm's announcement: the first contract.changed row whose `from` is A. */
function firstFromA(bus, fromA) {
  const rows = bus.db.prepare("SELECT env_json FROM bus_messages WHERE kind = 'contract.changed' ORDER BY seq").all().map((r) => JSON.parse(r.env_json));
  return rows.filter((e) => e.from?.kind === fromA.kind && e.from.id === fromA.id && e.from.sub === fromA.sub);
}

/**
 * One case; `hookCmd` is the seam the lagging-hook test uses (plan §4.3). `trigger` (E6, plan §4.10):
 * 'scripted' publishes the announcement from the script at tick k; 'detector' gives A a hook with
 * --detect and makes A edit lib.mjs every tick (a comment tweak, the signature at tick k), so the
 * announcement is the hook's auto-publish. Inside a tick A's call and A's hook run before B's.
 */
export async function runCase({ variant, k, topology, arm, hookCmd = [process.execPath, HOOK], trigger = 'scripted' }) {
  const writes = S_B[variant];
  if (!writes) throw new Error(`unknown variant ${variant}`);
  const dir = mkdtempSync(join(tmpdir(), 'bus-e3-'));
  const work = join(dir, 'src');
  mkdirSync(work);
  const db = join(dir, 'bus.db');
  const bus = createSqliteBus({ path: db, origin: 'h_e3' });
  try {
    const isBus = arm !== 'review';
    const sub = topology === 'subagents';
    const topic = sub ? 'run.r_e3.team.impl' : 'run.r_e3.siblings';
    const auto = trigger === 'detector' && isBus;
    bus.mark(START_MARK);
    writeFileSync(join(work, 'lib.mjs'), auto ? `// rev 0\n${LIB_V1}` : LIB_V1);
    const taskMap = join(dir, 'task-map.json');
    if (auto) {
      writeFileSync(taskMap, JSON.stringify({ v: 1, tasks: {
        a: { title: 'A', file: 'tasks/a.md', files: ['lib.mjs'], parsed: true },
        b: { title: 'B', file: 'tasks/b.md', files: ['cart.mjs'], parsed: true },
      } }));
    }
    const lines = [];
    const writeCart = () => writeFileSync(join(work, 'cart.mjs'), cartText(lines));
    writeCart();

    const payloads = sub
      ? { A: { session_id: 's', agent_id: 'a' }, B: { session_id: 's', agent_id: 'b' }, C: { session_id: 's', agent_id: 'c' }, D: { session_id: 's', agent_id: 'd' } }
      : { B: { session_id: 'b' }, ...(auto ? { A: { session_id: 'a' } } : {}) };
    const fromA = sub ? { kind: 'agent', id: 's', sub: 'a' } : { kind: 'agent', id: 'a', sub: 'main' };
    const flags = ['--db', db, '--consumer-prefix', PREFIX, '--topics', topic, '--start-mark', START_MARK];
    let call = 0;
    const hook = (who, extra = null) => {
      call += 1;
      const r = spawnSync(hookCmd[0], [...hookCmd.slice(1), ...flags, ...(extra?.args ?? [])], {
        input: JSON.stringify({ ...payloads[who], tool_name: 'Edit', tool_use_id: `tu_${call}`, ...(extra?.payload ?? {}) }),
        encoding: 'utf8',
        env: process.env,
      });
      if (!r.stdout) return '';
      try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
    };
    const cursorsOf = (agents) => JSON.stringify(bus.db.prepare(
      `SELECT consumer, origin, seq FROM bus_cursors WHERE consumer IN (${agents.map(() => '?').join(',')}) ORDER BY consumer, origin`,
    ).all(...agents.map((a) => `${PREFIX}:s:${a}`)));

    let msgId = null;
    let knows = false;
    let deliveredTick = null;
    let rework = 0;
    let mailboxTokens = 0;
    const deliveries = sub ? { A: 0, B: 0, C: 0, D: 0 } : { B: 0 };
    let cursorsUnmovedByA = true;
    let lateJoinerFirstCall = null;
    let lateJoinerFirstCallTokens = null;
    const shows = (text) => !!msgId && text.includes(msgId);
    let rev = 0;
    let autoPublishes = 0;
    let falsePublishes = 0;
    let selfShows = 0;
    let bodyTokens = 0;
    /** E6: A's Edit of lib.mjs, then A's --detect hook; returns A's hook output. */
    const editA = (oldS, newS) => {
      const p = join(work, 'lib.mjs');
      writeFileSync(p, readFileSync(p, 'utf8').replace(oldS, () => newS));
      const before = firstFromA(bus, fromA).length;
      const text = hook('A', {
        args: ['--detect', '--publish-topic', topic, '--task-map', taskMap, '--task-id', 'a', '--root', work],
        payload: { hook_event_name: 'PostToolUse', cwd: work, tool_input: { file_path: p, old_string: oldS, new_string: newS } },
      });
      const rows = firstFromA(bus, fromA);
      if (rows.length > before) {
        autoPublishes += rows.length - before;
        if (msgId === null) { msgId = rows[0].id; bodyTokens = estimateTokens(rows[0].body.text); }
      }
      return { text, added: rows.length - before };
    };

    for (let t = 1; t <= N; t++) {
      if (auto) {
        // A's tool call every tick: the signature at tick k, a body-only comment tweak otherwise
        const cursorsBefore = sub ? cursorsOf(['b', 'c']) : null;
        const r = t === k
          ? editA('export function price(item) {\n  return item.cost;', LIB_V2.slice(0, LIB_V2.indexOf('\n  return item.cost;') + '\n  return item.cost;'.length))
          : editA(`// rev ${rev}`, `// rev ${rev + 1}`);
        if (t !== k) rev += 1;
        if (t !== k) falsePublishes += r.added;
        if (shows(r.text)) { selfShows += 1; if (sub) deliveries.A += 1; }
        if (sub && cursorsOf(['b', 'c']) !== cursorsBefore) cursorsUnmovedByA = false;
      }
      // A's tool call: the change (and, in the bus arms, its announcement)
      if (t === k && !auto) {
        writeFileSync(join(work, 'lib.mjs'), LIB_V2);
        if (isBus) {
          msgId = bus.publish({
            topic, kind: 'contract.changed',
            body: { text: 'lib.mjs: price(item) is now price(item, { currency }); a call without currency throws TypeError. Update every call site.' },
          }, { from: fromA }).id;
        }
      }
      if (sub && isBus && !auto) {
        const before = cursorsOf(['b', 'c']);
        if (shows(hook('A'))) deliveries.A += 1;
        if (cursorsOf(['b', 'c']) !== before) cursorsUnmovedByA = false;
      }
      // B's tool call: one new call site, in the form B knows at the start of the tick
      if (writes.includes(t)) { lines.push(site(t, knows)); writeCart(); }
      // B's PostToolUse hook
      if (isBus) {
        const text = hook('B');
        mailboxTokens += estimateTokens(text);
        if (shows(text)) {
          deliveries.B += 1;
          if (deliveredTick === null) {
            deliveredTick = t;
            if (arm === 'bus-act') {
              // one redo step per already-stale site, then v2 from the next write on
              for (let i = 0; i < lines.length; i++) {
                if (isV1(lines[i])) { lines[i] = toV2(lines[i]); rework += 1; }
              }
              writeCart();
              knows = true;
            }
          }
        }
      }
      if (sub && isBus) {
        if (shows(hook('C'))) deliveries.C += 1;
        if (arm === 'bus-act' && t >= k + 2) {
          const text = hook('D');
          if (lateJoinerFirstCall === null) {
            lateJoinerFirstCall = shows(text);
            lateJoinerFirstCallTokens = estimateTokens(text);
          }
          if (shows(text)) deliveries.D += 1;
        }
      }
    }
    // the review step: the contract check finds every stale site; a fix cycle rewrites them
    const stale = lines.filter(isV1).length;
    let reviewCycles = 0;
    if (stale > 0) {
      reviewCycles = 1;
      for (let i = 0; i < lines.length; i++) if (isV1(lines[i])) lines[i] = toV2(lines[i]);
      rework += stale;
      writeCart();
    }
    const d = isBus && deliveredTick !== null ? deliveredTick - k : null;
    const leadTime = arm === 'review' ? N - k + 1 : d === null ? null : d + 1;
    const makespan = arm === 'bus-act' && reviewCycles === 0 ? N + rework + 1 : N + 1 + rework + 1;
    const predicted = predict({ S_B: writes, k, d: 0, arm });
    const out = {
      variant, k, topology, arm, d, rework, predictedRework: predicted.rework,
      measuredEqualsPredicted: rework === predicted.rework,
      leadTime, predictedLeadTime: predicted.leadTime, makespan, predictedMakespan: predicted.makespan,
      reviewCycles, correct: truthCheck(work), mailboxTokens,
    };
    if (sub) {
      out.deliveries = deliveries;
      out.cursorsUnmovedByA = cursorsUnmovedByA;
      out.lateJoinerFirstCall = lateJoinerFirstCall;
      out.lateJoinerFirstCallTokens = lateJoinerFirstCallTokens;
    }
    if (trigger === 'detector') {
      Object.assign(out, { trigger, autoPublishes, falsePublishes, selfShows, bodyTokens });
    }
    return out;
  } finally {
    bus.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function summarize(cases) {
  const s = { 'e3.cases': cases.length };
  const find = (o) => cases.find((c) => Object.entries(o).every(([k, v]) => c[k] === v));
  for (const topology of ['decompose', 'subagents']) {
    for (const variant of ['spread', 'late']) {
      const ratios = [];
      for (const k of [...new Set(cases.map((c) => c.k))]) {
        const b = find({ variant, k, topology, arm: 'bus-act' });
        const r = find({ variant, k, topology, arm: 'review' });
        if (b && r) ratios.push(b.rework / r.rework);
      }
      s[`e3.${topology}.${variant}.meanRatio`] = round(mean(ratios), 2);
    }
  }
  const act = cases.filter((c) => c.arm === 'bus-act');
  const busArms = cases.filter((c) => c.arm !== 'review');
  s['e3.busAct.maxLeadTime'] = Math.max(...act.map((c) => c.leadTime));
  s['e3.busAct.maxD'] = Math.max(...busArms.map((c) => c.d));
  s['e3.busAct.reviewCycles'] = act.reduce((x, c) => x + c.reviewCycles, 0);
  s['e3.review.meanLeadTime'] = round(mean(cases.filter((c) => c.arm === 'review').map((c) => c.leadTime)), 2);
  s['e3.busAct.meanMakespan'] = round(mean(act.map((c) => c.makespan)), 2);
  s['e3.review.meanMakespan'] = round(mean(cases.filter((c) => c.arm === 'review').map((c) => c.makespan)), 2);
  s['e3.busAct.meanMailboxTokens'] = round(mean(act.map((c) => c.mailboxTokens)), 2);
  s['e3.allCorrect'] = cases.every((c) => c.correct);
  s['e3.allMeasuredEqualsPredicted'] = cases.every((c) => c.measuredEqualsPredicted);
  s['e3.ignoreEqualsReview'] = cases.filter((c) => c.arm === 'bus-ignore').every((c) => {
    const r = find({ variant: c.variant, k: c.k, topology: c.topology, arm: 'review' });
    return !!r && r.rework === c.rework;
  });
  const subBus = busArms.filter((c) => c.topology === 'subagents');
  s['e3.subagents.deliveredOnce'] = subBus.every((c) => c.deliveries.B === 1 && c.deliveries.C === 1 && (c.arm !== 'bus-act' || c.deliveries.D === 1));
  s['e3.subagents.selfShows'] = subBus.reduce((x, c) => x + c.deliveries.A, 0);
  s['e3.subagents.cursorsUnmovedByA'] = subBus.every((c) => c.cursorsUnmovedByA);
  s['e3.subagents.reworkEqualsDecompose'] = cases.filter((c) => c.topology === 'subagents').every((c) => {
    const twin = find({ variant: c.variant, k: c.k, topology: 'decompose', arm: c.arm });
    return !!twin && twin.rework === c.rework;
  });
  const late = subBus.filter((c) => c.arm === 'bus-act');
  s['e3.subagents.lateJoinerFirstCall'] = late.every((c) => c.lateJoinerFirstCall === true);
  s['e3.subagents.lateJoinerFirstCallTokens'] = Math.max(...late.map((c) => c.lateJoinerFirstCallTokens));
  return s;
}

function parseArgs(argv) {
  const o = { quick: false, out: join(HERE, 'results', 'e3.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quick') o.quick = true;
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const cases = [];
  for (const variant of ['spread', 'late']) {
    for (const k of o.quick ? [5] : [2, 5, 8]) {
      for (const topology of ['decompose', 'subagents']) {
        for (const arm of ['review', 'bus-act', 'bus-ignore']) {
          cases.push(await runCase({ variant, k, topology, arm }));
        }
      }
    }
  }
  const result = {
    experiment: 'e3', quick: o.quick, method: 'computed from a step model; delivery delay measured from the real hook',
    env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
    N, S_B, durationMs: Date.now() - t0, summary: summarize(cases), cases,
  };
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result.summary) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}
