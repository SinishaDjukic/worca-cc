// tools/parity/compare.mjs — #919 slice 2: compare two snapshots; the report slice 3 reads.
import { median, withinBudget, BUDGET_PCT, RUNS, NOISE_FLOOR_MS } from './timing.mjs';
import { PAGES, FLOWS } from './flows.mjs';
import { THEMES } from './visual.mjs';

export const EXPECTED_SHOTS = PAGES.length * THEMES.length;   // 18
export const FLOW_NAMES = FLOWS.map((f) => f.name);           // the 5 flows every snapshot must carry
const key = (r) => `${r.method} ${r.path}`;

export function compareRoutes(a, b) {
  const A = new Map(a.map((r) => [key(r), r])); const B = new Map(b.map((r) => [key(r), r]));
  const diffs = [];
  for (const [k, ra] of A) {
    const rb = B.get(k);
    if (!rb) { diffs.push({ route: k, kind: 'only-in-a' }); continue; }
    if (ra.skipped || rb.skipped) { if (ra.skipped !== rb.skipped) diffs.push({ route: k, kind: 'skip', a: ra.skipped, b: rb.skipped }); continue; }
    if (ra.status !== rb.status) diffs.push({ route: k, kind: 'status', a: ra.status, b: rb.status });
    else if (!ra.volatile && !rb.volatile && ra.shape !== rb.shape) diffs.push({ route: k, kind: 'shape', a: ra.shape, b: rb.shape });
  }
  for (const k of B.keys()) if (!A.has(k)) diffs.push({ route: k, kind: 'only-in-b' });
  return diffs;
}

function structural(side, s) {
  const p = [];
  if (!s.routes.signedIn?.length) p.push(`${side}: no signed-in routes`);
  if (!s.routes.signedOut?.length) p.push(`${side}: no signed-out routes`);
  if ((s.routes.signedOut?.length ?? 0) !== (s.routes.signedIn?.length ?? 0)) {
    p.push(`${side}: ${s.routes.signedOut?.length ?? 0} signed-out rows, expected ${s.routes.signedIn?.length ?? 0}`);
  }
  if (s.shots.length !== EXPECTED_SHOTS) p.push(`${side}: ${s.shots.length} shots, expected ${EXPECTED_SHOTS}`);
  const names = (s.flows || []).map((f) => f.name);
  for (const n of FLOW_NAMES) if (!names.includes(n)) p.push(`${side}: flow ${n} missing`);
  for (const r of s.routes.signedIn || []) if (r.status === 'crashed' || r.status === 'timeout') p.push(`${side}: ${key(r)} ${r.status}`);
  return p;
}

const counts = (s) => ({ listed: s.routes.signedIn?.length ?? 0, probed: (s.routes.signedIn || []).filter((r) => !r.skipped).length,
  skipped: (s.routes.signedIn || []).filter((r) => r.skipped).length });

function timing(a, b, gated, floorMs) {
  const ma = median(a); const mb = median(b);
  if (ma === null || mb === null) return { a: ma, b: mb, deltaPct: null, gated, pass: !gated };   // a snapshot-only dir: no samples
  const { pass, deltaPct } = withinBudget(ma, mb, { floorMs });
  return { a: ma, b: mb, deltaPct, gated, pass: gated ? pass : true };
}

/** `visual` is the list of {page, theme, pixels, diff?, note?} computed by compareDirs from both snapshots' PNGs. */
export function compareSnapshots(a, b, { visual, gateTimings = true }) {
  const docker = a.kind === 'docker' || b.kind === 'docker';
  const timingGated = gateTimings && a.kind === 'tree' && b.kind === 'tree' && a.timings.samples >= RUNS && b.timings.samples >= RUNS;
  const visualGated = !docker;
  const routeDiffs = [...compareRoutes(a.routes.signedIn, b.routes.signedIn), ...compareRoutes(
    a.routes.signedOut.map(({ problem, ...r }) => r), b.routes.signedOut.map(({ problem, ...r }) => r))];
  const signedOutProblems = [...a.routes.signedOut, ...b.routes.signedOut].filter((r) => r.problem);
  const flows = [...a.flows.map((f) => ({ ...f, side: 'a' })), ...b.flows.map((f) => ({ ...f, side: 'b' }))];
  const failedFlows = flows.filter((f) => !f.ok);
  const visualDiffs = visual.filter((v) => v.pixels !== 0);
  const problems = [...structural('A', a), ...structural('B', b)];
  const timings = { boot: timing(a.timings.bootMs, b.timings.bootMs, timingGated, NOISE_FLOOR_MS.boot), pages: {} };
  for (const p of Object.keys(a.timings.pageLoadMs)) timings.pages[p] = timing(a.timings.pageLoadMs[p], b.timings.pageLoadMs[p] || [], timingGated, NOISE_FLOOR_MS.page);
  const timingPass = timings.boot.pass && Object.values(timings.pages).every((t) => t.pass);
  const pass = !routeDiffs.length && !signedOutProblems.length && !failedFlows.length && !problems.length
    && (!visualGated || !visualDiffs.length) && timingPass;
  return { a: a.target, b: b.target, pass, routeDiffs, signedOutProblems, failedFlows, flows, visual, visualDiffs,
    visualGated, timingGated, timings, problems, routeCounts: { a: counts(a), b: counts(b) } };
}

export function summaryLine(r) {
  const t = !r.timingGated ? 'timings reported, not gated'
    : (r.timings.boot.pass && Object.values(r.timings.pages).every((x) => x.pass)) ? `timings within ${BUDGET_PCT}%` : 'timings over budget';
  const n = r.problems.length + r.signedOutProblems.length;
  const probs = n ? `; ${n} problem${n === 1 ? '' : 's'}` : '';
  return `${r.routeDiffs.length} route, ${r.visualDiffs.length} visual, ${r.failedFlows.length} flow differences; ${t}${probs} — ${r.pass ? 'PASS' : 'FAIL'}`;
}

export function timingLine(name, x) {
  if (x.a === null || x.b === null) return `${name}: n/a (no samples)`;
  return `${name}: A ${x.a} ms, B ${x.b} ms (${x.deltaPct >= 0 ? '+' : ''}${x.deltaPct}%) ${x.gated ? (x.pass ? 'PASS' : `FAIL (budget ${BUDGET_PCT}%)`) : '(reported, not gated)'}`;
}

export function flowLine(f) {
  return f.ok ? `${f.name}: PASS (${(f.ms / 1000).toFixed(1)} s)`
    : `${f.name}: FAIL — ${f.error}${f.apiErrors?.length ? ` [${f.apiErrors.join(', ')}]` : ''} (${f.shot ? `shot: ${f.shot}` : 'no screenshot: page closed'})`;
}

export function renderReport(r) {
  const lines = [`# Parity: ${r.pass ? 'PASS' : 'FAIL'}`, '', summaryLine(r), '',
    `A: \`${r.a}\` · B: \`${r.b}\``, '', '## Problems', '', ...r.problems.map((p) => `- ${p}`), '',
    '## Routes', '', `A: ${r.routeCounts.a.listed} listed, ${r.routeCounts.a.probed} probed, ${r.routeCounts.a.skipped} skipped · `
      + `B: ${r.routeCounts.b.listed} listed, ${r.routeCounts.b.probed} probed, ${r.routeCounts.b.skipped} skipped`, '',
    '| Route | Kind | A | B |', '|---|---|---|---|',
    ...r.routeDiffs.map((d) => `| ${d.route} | ${d.kind} | ${d.a ?? ''} | ${d.b ?? ''} |`), '',
    '## Signed out', '', ...r.signedOutProblems.map((p) => `- ${p.method} ${p.path}: ${p.problem}`), '',
    '## Flows', '', ...r.flows.map((f) => `- ${f.side} ${flowLine(f)}`), '',
    `## Visuals${r.visualGated ? '' : ' (reported, not gated)'}`, '', '| Page | Theme | Pixels | Diff |', '|---|---|---|---|',
    ...r.visual.map((v) => `| ${v.page} | ${v.theme} | ${v.pixels ?? '—'} | ${v.diff ?? v.note ?? ''} |`), '',
    '## Timings', '', `- ${timingLine('boot', r.timings.boot)}`, ...Object.entries(r.timings.pages).map(([p, x]) => `- ${timingLine(p, x)}`), ''];
  return lines.join('\n');
}
