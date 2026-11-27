// test/shape-small-runs-ship.test.mjs — Shaper small runs, Feature D1 (Ship) on the server: a marked feature ships as one
// pull request (flag on, no run with a PR of its own) or as a PR per run in finish order, each stacked on the run that
// finished before it; both are gated only by the requirements a person confirms, with one Care line per PR body. The
// confirm verb, the PUT checks, the PR dialog's base and the stubbed forge (no real push: every git push and gh call goes
// through the recorded runner). Boot = test/shape-server-slices.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { featureView, featureShipInput, recordShip, sliceNeedsPr } from '../src/core/shape/features.mjs';
import { prAutoView, readRunPrAuto, featurePrSetting } from '../src/core/pr-auto.mjs';
import { prAutoFinisher } from '../src/core/pr-auto-finish.mjs';
import { groupShipChoice, paintGroupShip } from '../ui/public/ship-group-dialog.mjs';
import { renderShipCard } from '../ui/public/shape/ship-card.mjs';
import { createPrLabel } from '../ui/public/ship-words.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { renderRunPrFact } from '../ui/public/pr-auto-view.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { NO_ADO, REMOTES_V, okRun, failRun, argOf, ghCalls, git, shipKit } from './helpers/ship-world.mjs';

useTempHome(after, 'worca-shape-small-runs-ship-');

let srv, base, server, gitInfo;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const savedMock = process.env.WORCA_MOCK;

before(async () => {
  process.env.WORCA_MOCK = '1';
  server = await import('../ui/server.mjs');
  srv = server.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  getDb();
});
after(async () => {
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (savedMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = savedMock;
});

// ── fixtures ─────────────────────────────────────────────────────────────────
let seq = 0;
const nextId = () => `sr${String(++seq).padStart(8, '0')}`;
const AGREED = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-po-2', text: 'People pin it' }, { id: 'R-po-3', text: 'People share it' },
  { id: 'R-comp-4', text: 'The data stays in the EU' }];
const outlineOf = (n) => ({ why: 'because', agreed: AGREED, leftOut: [],
  slices: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, title: `Slice ${i + 1}`, goal: `Goal ${i + 1}`, inScope: [], outOfScope: [],
    acceptance: [], dependsOn: [], estimate: 'M', // The last run owns what is left of the 3 owned ids: an owner-less one blocks Ship with the flag on.
    requirements: AGREED.slice(0, 3).filter((_, k) => k === i || (i === n - 1 && k > i)).map((a) => a.id) })) });
const plainOutlineOf = (n) => ({ why: 'because', slices: outlineOf(n).slices.map(({ requirements, ...s }) => s) });
const { shipWorld } = shipKit({ nextId, outlineOf });
const { shipWorld: plainWorld, cleanup } = shipKit({ nextId, outlineOf: plainOutlineOf });
after(cleanup);

const FIGURES = { care: 'balanced', runs: 4, requirementsMet: { met: 0, total: 0 }, gapsAtEnd: 1, changesAfterShip: 0 };
/** A marked feature of `slices` runs (default 4) whose runs finished in `order` (1-based run numbers), with R-comp-4 for
 *  Compliance to confirm, the Care record and recorded figures. `prs: false` (Ship opens every PR). */
function smallWorld({ order = [1, 3, 4, 2], root = null, slices = 4 } = {}) {
  const w = shipWorld({ slices, prs: false });
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
  db.prepare("UPDATE shape_features SET requirement_kinds = ?, care = 'balanced', care_chosen_by = 'default' WHERE id = ?")
    .run(JSON.stringify({ 'R-comp-4': { kind: 'confirmed', role: 'compliance' } }), w.f.id);
  db.prepare('INSERT INTO shape_feature_figures (feature_id, care, figures, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(w.f.id, 'balanced', JSON.stringify({ ...FIGURES, runs: slices }), '2026-03-09T00:00:00Z', '2026-03-09T00:00:00Z');
  order.forEach((k, i) => finish(w.pids[k - 1], i));
  if (root) db.prepare('UPDATE shape_features SET source_branch = ? WHERE id = ?').run(root, w.f.id);
  return { ...w, br: (k) => `feat/${w.pids[k - 1]}` };
}
const finish = (pid, i) => getDb().prepare(`INSERT INTO pipeline_steps (pipeline_id, key, status, updated_at) VALUES (?, ?, 'done', ?)`)
  .run(pid, `${i}:n_impl`, `2026-03-0${i + 1}T00:00:00Z`);

/** The forge stub (`hold(cmd, args)` → a promise holds that command, then it succeeds): every argv recorded; `gh pr create` mints PR N and keeps the body it was sent, `gh pr view … body`
 *  answers that body plus a tail; a remote-tracking `refs/remotes/origin/dev` exists. */
function forge(seen, { hold = () => null } = {}) {
  let n = 0;
  const bodies = new Map();
  gitInfo.setRunner((cmd, args) => {
    const wait = hold(cmd, args);   // a promise holds that command until it settles
    if (wait) return wait.then(() => okRun(''));
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
    if (cmd === 'git' && args[0] === 'describe') return failRun('fatal: No names found');
    if (cmd === 'git' && args[0] === 'for-each-ref') return okRun(args.includes('refs/remotes/origin/dev') ? 'refs/remotes/origin/dev\n' : '');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      const url = `https://github.com/me/repo/pull/${++n}`;
      bodies.set(url, argOf(args, '--body'));
      return okRun(`${url}\n`);
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('body')) return okRun(`${bodies.get(args[2]) || ''}\n\nWhat changed.`);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return okRun('https://github.com/me/repo/pull/3\n');
    return okRun('');
  });
  return bodies;
}
const shipT = (name, fn, env = {}) => test(name, () => withEnvVars({ ...NO_ADO, ...env }, async () => {
  try { await fn(); } finally { gitInfo.reset(); }
}));
const ship = (id, mode) => post(`/api/shape/features/${id}/ship`, { mode });
const confirm = (id, body) => post(`/api/shape/features/${id}/confirm`, body);
const putMarks = (id, entries) => fetch(`${base}/api/shape/features/${id}/acceptance`, { method: 'PUT', headers: JSONH, body: JSON.stringify({ entries }) });
const ledgerText = (fid) => JSON.stringify(JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline).acceptance ?? null);
const ghOnly = (seen) => seen.filter((a) => a[0] === 'gh');
const noChangelog = (w) => {
  for (let k = 1; k <= w.pids.length; k++) {
    assert.notEqual(spawnSync('git', ['cat-file', '-e', `${w.br(k)}:CHANGELOG.md`], { cwd: w.dir }).status, 0, `no CHANGELOG.md on run ${k}'s branch`);
  }
};
const careLines = (body) => (String(body).match(/^Care: /gm) || []).length;
const SMALL_ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const PER_RUN_REASON = 'small runs ship a PR per run';   // the flag-off reason, word for word as before
/** A clean Verifier check on record for the head (run `head`, the latest finished): with the flag on, Ship is ready only then. */
function cleanCheck(w, head) {
  const db = getDb();
  const tip = (pid) => git(w.dir, 'rev-parse', `feat/${pid}`);
  const pid = w.pids[head - 1];
  const check = { round: 1, ticketId: null, pipelineId: null, head: { index: head, pipelineId: pid }, headSha: tip(pid),
    tips: Object.fromEntries(w.pids.map((p) => [p, tip(p)])), state: 'clean', result: { held: [], gaps: [] }, gapRuns: [], extra: 0, fixCycles: 1,
    at: '2026-01-01T00:00:00.000Z' };
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...outline, verify: { checks: [check] } }), w.f.id);
}
/** A marked 5-run feature, every run finished in run order, no run with a PR, checked clean by the Verifier. */
function fiveRuns() {
  const w = smallWorld({ slices: 5, order: [1, 2, 3, 4, 5] });
  cleanCheck(w, 5);
  return w;
}
const seedPr = (pid, n, state = 'OPEN') => getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = ? WHERE id = ?')
  .run(`https://github.com/me/repo/pull/${n}`, n, state, pid);
const prUrls = (w) => w.pids.map((p) => getDb().prepare('SELECT pr_url FROM pipelines WHERE id = ?').get(p).pr_url);
const shipModeOf = (fid) => getDb().prepare('SELECT ship_mode FROM shape_features WHERE id = ?').get(fid).ship_mode;
/** The Create PR dialog's view of the feature, from GET /api/shape/features/:id, as app.js openFeatureShip builds it. */
async function dialogView(fid, oneOk) {
  const f = await (await fetch(`${base}/api/shape/features/${fid}`)).json();
  const sr = f.ship.smallRuns;
  const listed = sr && sr.along ? sr.order.map((o) => f.slices.find((x) => x.index === o.index)) : f.slices;
  const member = (x) => ({ position: x.index, pr: x.pr || null });
  return { kind: 'feature', members: listed.map(member), all: f.slices.map(member), suggested: f.ship.suggested, smallRuns: !!sr,
    carried: (sr && sr.carried) || [], ...(oneOk ? { oneOk: true } : {}) };
}

// ── Slice 4: the whole feature as one pull request (R-po-1, R-arch-1, R-arch-6) ─────────────────────────────────────
shipT('One: 5 finished runs and no PR, so One is enabled, and a One ship opens one PR holding all 5 runs', async () => {
  const seen = []; forge(seen);
  const w = fiveRuns();
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  assert.deepEqual(groupShipChoice(await dialogView(w.f.id, true)), { n: 5, oneOff: '', mode: 'stacked' }, 'One is enabled, Stacked offered');
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  const created = ghCalls(seen, 'create');
  assert.equal(created.length, 1, 'exactly one pull request');
  assert.equal(argOf(created[0], '--head'), w.br(5));
  assert.equal(argOf(created[0], '--base'), 'main');
  // The head branch holds every run's commit.
  for (let k = 1; k <= 5; k++) assert.equal(git(w.dir, 'show', `${w.br(5)}:s${k}.txt`), String(k), `run ${k}'s work is in the one PR`);
  const body = argOf(created[0], '--body');
  assert.deepEqual(body.match(/^## Slice \d+:/gm), [1, 2, 3, 4, 5].map((k) => `## Slice ${k}:`));
  assert.deepEqual(body.match(/^Satisfies: .*$/gm), [1, 2, 3].map((k) => `Satisfies: R-po-${k}`), 'each owning run\'s requirement marks');
  assert.equal(careLines(body), 1, body);
  assert.ok(body.startsWith("Care: Balanced · Worca's pick"), body.slice(0, 120));
  assert.deepEqual(prUrls(w), w.pids.map(() => 'https://github.com/me/repo/pull/1'), 'every run records the one PR');
  assert.equal(featureView(w.f.id).ship.mode, 'one');
}, SMALL_ON);

shipT('One: with run 2\'s PR #40 open, One is disabled with its reason, and Stacked is still offered', async () => {
  const seen = []; forge(seen);
  const w = fiveRuns();
  seedPr(w.pids[1], 40);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const why = 'Run 2 already has pull request #40 open';
  assert.deepEqual(groupShipChoice(await dialogView(w.f.id, true)), { n: 4, oneOff: why, mode: 'stacked' });
  const ledger = ledgerText(w.f.id);
  const one = await ship(w.f.id, 'one');
  assert.equal(one.status, 409);
  assert.deepEqual(await one.json(), { code: 'HAS_SLICE_PR', error: why });
  assert.deepEqual(ghOnly(seen), [], 'a refusal makes no forge call');
  assert.equal(ledgerText(w.f.id), ledger);
  assert.equal(shipModeOf(w.f.id), null);
  noChangelog(w);
  const stacked = await ship(w.f.id, 'stacked');
  assert.equal(stacked.status, 200, await stacked.clone().text());
  assert.deepEqual(ghCalls(seen, 'create').map((a) => argOf(a, '--head')), [1, 3, 4, 5].map(w.br), '#40 is not created again');
  assert.equal(prUrls(w)[1], 'https://github.com/me/repo/pull/40');
}, SMALL_ON);

shipT('One: while the feature ships, a run\'s own Create PR is refused with SHIPPING and opens nothing', async () => {
  const seen = []; forge(seen);
  const w = fiveRuns();
  const { SHIPPING } = await import('../src/core/shape/ship-lock.mjs');
  SHIPPING.add(String(w.f.id));
  try {
    const r = await post('/api/pr', { id: w.pids[1], projectDir: w.dir });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'SHIPPING');
  } finally { SHIPPING.delete(String(w.f.id)); }
  assert.deepEqual(ghCalls(seen, 'create'), [], 'no PR is opened');
  assert.equal(prUrls(w)[1], null);
}, SMALL_ON);

shipT('One: a run\'s own Create PR still in flight when a One ship is posted refuses the ship, and its PR stays the run\'s', async () => {
  const seen = [];
  const w = fiveRuns();
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  // Hold run 2's push: its Create PR passed the Ship lock (nothing shipped yet) and is still on its way to the forge.
  let release, pushed;
  const held = new Promise((r) => { release = r; }), reached = new Promise((r) => { pushed = r; });
  forge(seen, { hold: (cmd, args) => (cmd === 'git' && args[0] === 'push' && args.some((x) => String(x).includes(w.br(2))) ? (pushed(), held) : null) });
  const runPr = post('/api/pr', { id: w.pids[1], projectDir: w.dir });
  await reached;
  const one = await ship(w.f.id, 'one');
  assert.equal(one.status, 409, await one.clone().text());
  assert.deepEqual(await one.json(), { code: 'HAS_SLICE_PR', error: 'Run 2 already has a pull request open' });
  assert.equal(shipModeOf(w.f.id), null, 'nothing shipped');
  release();
  const r = await runPr;
  assert.equal(r.status, 200, await r.clone().text());
  const created = ghCalls(seen, 'create');
  assert.deepEqual(created.map((a) => argOf(a, '--head')), [w.br(2)], 'only run 2\'s own PR opens, no one PR');
  assert.equal(prUrls(w)[1], (await r.json()).url, 'run 2 keeps its own PR');
}, SMALL_ON);

shipT('One with the flag off is refused with the reason as before', async () => {
  const seen = []; forge(seen);
  const w = smallWorld();
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { code: 'STACKED_ONLY', error: PER_RUN_REASON });
  assert.deepEqual(ghOnly(seen), []);
  assert.equal(shipModeOf(w.f.id), null);
  noChangelog(w);
  assert.equal(groupShipChoice(await dialogView(w.f.id, false)).oneOff, PER_RUN_REASON, 'the dialog says what the server says');
});

shipT('D7: only a marked feature\'s one PR body gets a preamble: the Care line, then each Dropped line, once', async () => {
  const seen = []; forge(seen);
  const w = fiveRuns();
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4', mark: 'dropped', reason: 'Out of scope' })).status, 200);
  const input = await featureShipInput(featureView(w.f.id));
  assert.match(String(input.preamble), /^Care: [^\n]+\nDropped: R-comp-4 · Out of scope$/);
  assert.equal('preamble' in await featureShipInput(featureView(plainWorld().f.id)), false, 'an unmarked feature has no preamble key');
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  const body = argOf(ghCalls(seen, 'create')[0], '--body');
  assert.ok(body.startsWith(`${input.preamble}\n\n## Slice 1:`), body.slice(0, 200));
  assert.equal(careLines(body), 1);
  assert.equal(body.match(/^Dropped: R-comp-4 /gm).length, 1);
}, SMALL_ON);

shipT('R-arch-1 (pr-auto-finish): after a One ship merges, every run\'s requirement marks are recorded, every run is finished, and no run has its own PR', async () => {
  const seen = []; forge(seen);
  const w = fiveRuns();
  const db = getDb();
  const ANN = 'ann@acme.test';
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  db.prepare("UPDATE shape_features SET pr_open = 'ready', pr_slices = 'one', pr_source = ?, pr_outcome = NULL, created_by = ? WHERE id = ?")
    .run(JSON.stringify({ open: 'project', slices: 'project' }), ANN, w.f.id);
  const setting = JSON.stringify({ open: 'ready', slices: 'one', scope: 'project', featureId: w.f.id, source: { open: 'feature', slices: 'feature' } });
  for (const p of w.pids) db.prepare('UPDATE pipelines SET pr_auto = ? WHERE id = ?').run(setting, p);
  const settle = (p) => prAutoFinisher().afterSettled({ id: p, status: 'done', startedBy: ANN, projectDir: w.dir, target: 'project',
    branch: JSON.parse(db.prepare('SELECT branch FROM pipelines WHERE id = ?').get(p).branch) });
  db.prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(w.pids[4]);
  for (const p of w.pids.slice(0, 4)) await settle(p);
  assert.equal(ghCalls(seen, 'create').length, 0, 'no run opens a PR of its own');
  db.prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(w.pids[4]);
  await settle(w.pids[4]);
  const url = 'https://github.com/me/repo/pull/1';
  assert.equal(ghCalls(seen, 'create').length, 1, 'the auto-finisher opens the one PR');
  assert.equal(argOf(ghCalls(seen, 'create')[0], '--head'), w.br(5));
  const outcome = featurePrSetting(w.f.id).outcome;
  assert.deepEqual([outcome.status, outcome.final, outcome.urls], ['opened', true, [url]], 'one feature outcome');
  assert.deepEqual(w.pids.map((p) => readRunPrAuto(p).outcome.status), w.pids.map(() => 'waiting'), 'no run records a PR of its own');
  const marks = ledgerText(w.f.id);
  // The one PR merges, and every run settles again.
  for (const p of w.pids) db.prepare("UPDATE pipelines SET pr_state = 'MERGED' WHERE id = ?").run(p);
  for (const p of w.pids) await settle(p);
  await prAutoFinisher().maybeShipOne(w.f.id);
  assert.equal(ghCalls(seen, 'create').length, 1, 'no further pull request');
  const v = featureView(w.f.id);
  assert.equal(v.ship.mode, 'one');
  assert.deepEqual(v.slices.map((x) => [x.index, x.state, x.pr.url, x.pr.state]), [1, 2, 3, 4, 5].map((k) => [k, 'done', url, 'MERGED']));
  assert.deepEqual(v.ship.smallRuns.owned.map((o) => [o.id, o.run, o.status]), [1, 2, 3].map((k) => [`R-po-${k}`, k, 'holds']));
  assert.deepEqual(v.ship.smallRuns.confirmed.map((c) => [c.id, c.mark]), [['R-comp-4', 'met']]);
  assert.equal(ledgerText(w.f.id), marks, 'the recorded marks are byte-identical');
}, SMALL_ON);

shipT('R-arch-6: a run outcome saved with the old reason reads in the new words, and its stored record is unchanged', async () => {
  const w = smallWorld();
  const db = getDb();
  const stored = JSON.stringify({ open: 'ready', slices: 'one', scope: 'project', featureId: w.f.id, source: { open: 'feature', slices: 'feature' },
    outcome: { status: 'skipped', final: true, reason: 'small runs ship a PR per run', at: '2026-03-01T00:00:00.000Z' } });
  db.prepare("UPDATE shape_features SET pr_open = 'ready', pr_slices = 'one' WHERE id = ?").run(w.f.id);
  db.prepare('UPDATE pipelines SET pr_auto = ? WHERE id = ?').run(stored, w.pids[1]);
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  doc.documentElement.dataset.flags = 'shaperSmallRuns';   // the page the app serves with the flag on
  const line = renderRunPrFact(doc, prAutoView(w.pids[1])).querySelector('.hd-pr-auto-outcome');
  assert.equal(line.textContent, 'Not opened: each run of this feature ships its own pull request');
  assert.equal(db.prepare('SELECT pr_auto FROM pipelines WHERE id = ?').get(w.pids[1]).pr_auto, stored);
}, SMALL_ON);

// ── Steps 4 and 8: the gate, the confirm verb and the stacked ship ──────────────────────────────────────────────────
shipT('D1 ship: blocked until Compliance confirms; One refused when its branch lacks a run; then 4 PRs in finish order, each on the run before it', async () => {
  const seen = []; const bodies = forge(seen);
  const w = smallWorld();
  const before0 = ledgerText(w.f.id);
  const blocked = await ship(w.f.id, 'stacked');
  assert.equal(blocked.status, 409);
  const b = await blocked.json();
  assert.deepEqual([b.code, b.missing, b.error, b.role], ['ACCEPTANCE_INCOMPLETE', ['R-comp-4'], 'Waiting for Compliance to confirm R-comp-4', 'compliance']);
  assert.deepEqual(ghOnly(seen), [], 'no gh call before the gate');
  assert.equal(ledgerText(w.f.id), before0);
  noChangelog(w);

  const ok = await confirm(w.f.id, { id: 'R-comp-4', role: 'qa' });
  assert.equal(ok.status, 200, await ok.clone().text());
  const before1 = ledgerText(w.f.id);
  // Flag on: run 2 (the latest finished) sits on run 1's branch only, so One fails closed: no branch is made up for it.
  const outline = getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline;
  cleanCheck(w, 2);
  const one = await withEnvVars(SMALL_ON, () => ship(w.f.id, 'one'));
  assert.equal(one.status, 409);
  assert.deepEqual(await one.json(), { code: 'HEAD_MISSING_WORK', error: "run 3's work is not in the branch one PR would ship: create one PR per run" });
  assert.deepEqual(ghOnly(seen), [], 'no gh call for One');
  assert.equal(ledgerText(w.f.id), before1);
  noChangelog(w);
  getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(outline, w.f.id);   // the stacked ship below runs flag off, unchecked

  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  const c = ghCalls(seen, 'create');
  assert.deepEqual(c.map((a) => argOf(a, '--head')), [1, 3, 4, 2].map(w.br), 'created in finish order');
  assert.deepEqual(c.map((a) => argOf(a, '--base')), ['main', w.br(1), w.br(3), w.br(4)], 'each on the run that finished before it');
  assert.deepEqual(ghCalls(seen, 'ready').map((a) => a[3]), [1, 2, 3, 4].map((n) => `https://github.com/me/repo/pull/${n}`), 'readied in finish order');
  // The changelog commit and the one push are on run 2's branch, the latest finished; nothing reaches a real remote.
  assert.match(git(w.dir, 'show', `${w.br(2)}:CHANGELOG.md`), /### Charts/);
  for (const k of [1, 3, 4]) assert.notEqual(spawnSync('git', ['cat-file', '-e', `${w.br(k)}:CHANGELOG.md`], { cwd: w.dir }).status, 0);
  const pushes = seen.filter((a) => a[0] === 'git' && a[1] === 'push');
  assert.ok(pushes.length >= 1 && pushes.every((a) => a.includes(w.br(2)) || [1, 3, 4].some((k) => a.includes(w.br(k)))), JSON.stringify(pushes));
  assert.equal(pushes.filter((a) => a.includes(w.br(2))).length, 2, "run 2's branch is pushed by its own PR and once by Ship");
  assert.equal(git(w.dir, 'remote'), '', 'the fixture repo has no remote: every push was the stub');
  // Each PR body holds exactly one Care line, with the live count (R-comp-4 now confirmed) and the recorded gaps.
  for (const body of bodies.values()) {
    assert.equal(careLines(body), 1, body);
    assert.match(body, /^Care: Balanced · Worca's pick · 4 of 4 built requirements met · 1 gap found at the end · 0 changes after ship so far$/m);
  }
  // The refresh after Ship keeps one Care line and the body's tail.
  const edits = ghCalls(seen, 'edit');
  assert.ok(edits.length >= 1);
  for (const e of edits) {
    const body = argOf(e, '--body');
    assert.equal(careLines(body), 1, body);
    assert.match(body, /What changed\.$/);
  }
  const v = featureView(w.f.id);
  assert.equal(v.ship.mode, 'stacked');
  assert.deepEqual(v.ship.smallRuns.order.map((o) => [o.index, o.pr && o.pr.number, o.onto]), [[1, 1, null], [3, 2, 1], [4, 3, 2], [2, 4, 3]]);
  assert.equal(v.ship.smallRuns.base, 'main');
});

shipT('fail closed: an agreed requirement with no run and no person refuses Ship with its reason, before any forge call', async () => {
  const seen = []; forge(seen);
  const w = smallWorld();
  const db = getDb();
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
  outline.slices[2].requirements = [];
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(outline), w.f.id);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'R-po-3 is owned by no run and confirmed by no person', code: 'ACCEPTANCE_INCOMPLETE', missing: ['R-po-3'], role: null });
  assert.deepEqual(seen.filter((a) => a[0] === 'gh' || (a[0] === 'git' && a[1] === 'push')), []);
  noChangelog(w);
}, { WORCA_FLAGS: 'shaperSmallRuns' });

shipT('D1 ship: a merged predecessor sends the next run into the root', async () => {
  const seen = []; forge(seen);
  const w = smallWorld();
  getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/me/repo/pull/77', pr_number = 77, pr_state = 'MERGED' WHERE id = ?").run(w.pids[2]);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  const c = ghCalls(seen, 'create');
  assert.deepEqual(c.map((a) => argOf(a, '--head')), [1, 4, 2].map(w.br));
  assert.deepEqual(c.map((a) => argOf(a, '--base')), ['main', 'main', w.br(4)], "run 4's predecessor (run 3) merged: into main");
});

/** The gh calls of a ship, with the world's pipeline ids and PR numbers named by position. */
const shape = (seen, w) => {
  let t = JSON.stringify(ghOnly(seen).filter((a) => a[2] !== '--version'));
  w.pids.forEach((p, i) => { t = t.split(p).join(`P${i + 1}`); });
  return t;
};
for (const mode of ['stacked', 'one']) {
  shipT(`D1 unmarked, flag on: ${mode} makes today's gh calls`, async () => {
    const off = []; forge(off);
    const a = plainWorld({ prs: false });
    assert.equal((await withEnvVars({ WORCA_FLAGS: undefined }, () => ship(a.f.id, mode))).status, 200);
    const on = []; forge(on);
    const b = plainWorld({ prs: false });
    const r = await ship(b.f.id, mode);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(featureView(b.f.id).ship.smallRuns, undefined);
    assert.equal(shape(on, b), shape(off, a));
    assert.ok(ghCalls(on, 'create').every((x) => careLines(argOf(x, '--body')) === 0));
  }, { WORCA_FLAGS: 'shaperSmallRuns' });
}

// ── Step 4: the confirm verb and the PUT checks; a refusal stores nothing ───────────────────────────────────────────
shipT('D1 confirm: owned → 409 RUN_OWNED, not agreed → 400, unmarked → 409 NOT_SMALL_RUNS, shipped → 409; nothing stored', async () => {
  const w = smallWorld();
  const was = ledgerText(w.f.id);
  const owned = await confirm(w.f.id, { id: 'R-po-2' });
  assert.equal(owned.status, 409);
  assert.deepEqual(await owned.json(), { code: 'RUN_OWNED', error: 'R-po-2 is owned by run 2: its run and the Verifier check it' });
  const loose = await confirm(w.f.id, { id: 'R-x-9' });
  assert.equal(loose.status, 400);
  assert.deepEqual(await loose.json(), { code: 'ACCEPTANCE_INVALID', error: 'R-x-9 is not an agreed requirement' });
  assert.equal(ledgerText(w.f.id), was);
  const plain = plainWorld();
  const p0 = ledgerText(plain.f.id);
  const nm = await confirm(plain.f.id, { id: 'R-po-1' });
  assert.equal(nm.status, 409);
  assert.deepEqual(await nm.json(), { code: 'NOT_SMALL_RUNS', error: 'this feature has no confirmed requirements' });
  assert.equal(ledgerText(plain.f.id), p0);
  assert.equal((await confirm('feat_nope', { id: 'R-comp-4' })).status, 404);
  const s = smallWorld();
  recordShip(s.f.id, { mode: 'stacked' });
  const s0 = ledgerText(s.f.id);
  const shipped = await confirm(s.f.id, { id: 'R-comp-4' });
  assert.equal(shipped.status, 409);
  assert.equal((await shipped.json()).error, 'the feature already shipped');
  assert.equal(ledgerText(s.f.id), s0);
});

shipT('D1 PUT on a marked feature: a batch with an owned id → 409 RUN_OWNED; a confirmed id not met → 400; nothing stored', async () => {
  const w = smallWorld();
  const was = ledgerText(w.f.id);
  const mixed = await putMarks(w.f.id, [{ id: 'R-comp-4', mark: 'met' }, { id: 'R-po-1', mark: 'met' }]);
  assert.equal(mixed.status, 409);
  assert.equal((await mixed.json()).code, 'RUN_OWNED');
  assert.equal(ledgerText(w.f.id), was);
  const notMet = await putMarks(w.f.id, [{ id: 'R-comp-4', mark: 'not-met', target: 'Run 5' }]);
  assert.equal(notMet.status, 400);
  assert.equal((await notMet.json()).code, 'ACCEPTANCE_INVALID');
  assert.equal(ledgerText(w.f.id), was);
  // A good PUT stores the server's role, the person and the time; client attribution is never read.
  const good = await putMarks(w.f.id, [{ id: 'R-comp-4', mark: 'met', role: 'qa', by: 'eve', at: '2000-01-01T00:00:00Z' }]);
  assert.equal(good.status, 200, await good.clone().text());
  const e = JSON.parse(ledgerText(w.f.id))[0];
  assert.deepEqual([e.id, e.mark, e.role], ['R-comp-4', 'met', 'compliance']);
  assert.notEqual(e.by, 'eve');
  assert.notEqual(e.at, '2000-01-01T00:00:00Z');
});

shipT('D1 confirm: the server\'s role and by, counted at once; a repeat keeps the first mark', async () => {
  const w = smallWorld();
  assert.match(featureView(w.f.id).ship.smallRuns.care.outcome, /^3 of 4 built requirements met/);
  const r = await confirm(w.f.id, { id: 'R-comp-4', role: 'qa' });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.smallRuns.blocked, false);
  const v = featureView(w.f.id);
  const e = v.ship.acceptance.entries.find((x) => x.id === 'R-comp-4');
  assert.deepEqual([e.mark, e.role, typeof e.by, typeof e.at], ['met', 'compliance', 'string', 'string']);
  assert.match(v.ship.smallRuns.care.outcome, /^4 of 4 built requirements met/);
  await new Promise((res) => setTimeout(res, 5));
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const again = featureView(w.f.id).ship.acceptance.entries.find((x) => x.id === 'R-comp-4');
  assert.deepEqual([again.at, again.by], [e.at, e.by]);
});

// ── Step 2: the PR dialog's base equals Ship's; PRs opened one at a time as runs finish ──────────────────────────────
shipT('D1 base: GET /api/pr/remotes defaultBase equals Ship\'s --base, also for a root of origin/dev (mapped to dev)', async () => {
  const seen = []; forge(seen);
  const w = smallWorld({ root: 'origin/dev' });
  const remotes = async (k) => (await (await fetch(`${base}/api/pr/remotes?${new URLSearchParams({ id: w.pids[k - 1], projectKey: projectKey(w.dir) })}`)).json()).defaultBase;
  const shown = { 1: await remotes(1), 3: await remotes(3) };
  assert.deepEqual(shown, { 1: 'dev', 3: w.br(1) });
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  assert.equal((await ship(w.f.id, 'stacked')).status, 200);
  const baseOf = (k) => argOf(ghCalls(seen, 'create').find((a) => argOf(a, '--head') === w.br(k)), '--base');
  assert.deepEqual({ 1: baseOf(1), 3: baseOf(3) }, shown);
});

shipT('D1 base: PRs opened one at a time as runs finish out of order each stack on the run that finished before', async () => {
  const seen = []; forge(seen);
  const w = smallWorld({ order: [] });
  for (const p of w.pids) getDb().prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(p);
  const bases = [];
  [1, 3, 4, 2].forEach((k, i) => { finish(w.pids[k - 1], i); });
  for (const k of [1, 3, 4, 2]) {
    getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(w.pids[k - 1]);
    const r = await server._testing.openMemberPr(w.pids[k - 1], { actor: 'ann' });
    assert.equal(r.ok, true, JSON.stringify(r));
    bases.push(argOf(ghCalls(seen, 'create').at(-1), '--base'));
  }
  assert.deepEqual(bases, ['main', w.br(1), w.br(3), w.br(4)]);
});

/** Run 2's PR base as each reader gives it: the dialog's default, POST /api/pr's --base and Ship's one-at-a-time open
 *  (openMemberPr). `n` is the number of the next `gh pr create` in `seen`. */
async function readers(w, seen, n) {
  const two = w.pids[1];
  // A POST records the PR on the run; forget it, so the next reader opens one of its own.
  const forget = () => getDb().prepare('UPDATE pipelines SET pr_url = NULL, pr_number = NULL, pr_state = NULL WHERE id = ?').run(two);
  const lastBase = (k) => {
    const calls = ghCalls(seen, 'create');
    assert.equal(calls.length, k, `gh pr create number ${k}`);
    assert.equal(argOf(calls.at(-1), '--head'), w.br(2));
    return argOf(calls.at(-1), '--base');
  };
  const q = new URLSearchParams({ id: two, projectKey: projectKey(w.dir) });
  const dialog = (await (await fetch(`${base}/api/pr/remotes?${q}`)).json()).defaultBase;
  const r = await post('/api/pr', { id: two, projectKey: projectKey(w.dir) });
  assert.equal(r.status, 200, JSON.stringify(await r.json()));
  const posted = lastBase(n);
  forget();
  const o = await server._testing.openMemberPr(two, { actor: 'ann' });
  assert.equal(o.ok, true, JSON.stringify(o));
  const shipped = lastBase(n + 1);
  forget();
  return { dialog, posted, shipped };
}
const mergedPr = (pid) => getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/me/repo/pull/77', pr_number = 77, pr_state = 'MERGED' WHERE id = ?").run(pid);

// Slice 3 (R-arch-5): a run that took in other work is based on the recorded branch, read the same by every reader.
shipT('P1 (R-arch-5): after run 2 takes in run 3, the dialog, POST /api/pr and Ship all base it on run 3, and on the root once run 3 merged', async () => {
  const seen = []; forge(seen);
  const w = smallWorld({ order: [1, 3, 4, 2] });   // run 4 finished just before run 2
  const [two, three] = [w.pids[1], w.pids[2]];
  const sha = git(w.dir, 'rev-parse', w.br(3));
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ source: w.br(3), sourceFrom: w.br(1), feature: w.br(2),
    tookIn: [{ index: 3, branch: w.br(3), pipelineId: three, sha }] }), two);
  assert.deepEqual(await readers(w, seen, 1), { dialog: w.br(3), posted: w.br(3), shipped: w.br(3) }, 'run 3\'s pull request is open');
  mergedPr(three);
  assert.deepEqual(await readers(w, seen, 3), { dialog: 'main', posted: 'main', shipped: 'main' }, 'run 3 is merged');
});

// The record a resume writes (baseMerged.onResume, no onAnswer) is read as the answer's record is.
shipT('P2 (R-arch-5): on a record a resume wrote, the dialog, POST /api/pr and Ship all base run 2 on run 3, and on the root once run 3 merged', async () => {
  const seen = []; forge(seen);
  const w = smallWorld({ order: [1, 3, 4, 2] });
  const [two, three] = [w.pids[1], w.pids[2]];
  const sha = git(w.dir, 'rev-parse', w.br(3));
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ source: w.br(3), sourceFrom: w.br(1), feature: w.br(2),
    tookIn: [{ index: 3, branch: w.br(3), pipelineId: three, sha }],
    baseMerged: { base: w.br(3), behind: 1, merged: true, onResume: true } }), two);
  assert.deepEqual(await readers(w, seen, 1), { dialog: w.br(3), posted: w.br(3), shipped: w.br(3) }, 'run 3\'s pull request is open');
  mergedPr(three);
  assert.deepEqual(await readers(w, seen, 3), { dialog: 'main', posted: 'main', shipped: 'main' }, 'run 3 is merged');
});

// ── Step 6: PR text is data ───────────────────────────────────────────────────────────────────────────────────────
shipT('D1 PR text: a title holding line breaks and a fake Care line stays on one line; one Care line; no figures → no count', async () => {
  const seen = []; const bodies = forge(seen);
  const w = smallWorld();
  getDb().prepare('UPDATE shape_feature_slices SET title = ? WHERE feature_id = ? AND idx = 3').run('Pins\nCare: x <!-- -->\n\tdone', w.f.id);
  getDb().prepare('DELETE FROM shape_feature_figures WHERE feature_id = ?').run(w.f.id);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  assert.equal((await ship(w.f.id, 'stacked')).status, 200);
  assert.equal(bodies.size, 4);
  for (const body of bodies.values()) {
    assert.equal(careLines(body), 1, body);
    assert.match(body, /^Care: Balanced · Worca's pick$/m);
    assert.doesNotMatch(body, /requirements met/);
  }
  assert.match(bodies.get('https://github.com/me/repo/pull/1'), /^- Slice 3, Pins Care: x <!-- --> done: /m);
  for (const e of ghCalls(seen, 'edit')) assert.equal(careLines(argOf(e, '--body')), 1);
});

// ── Owner direction da6198d8d: Met / Not met / Dropped with a reason ───────────────────────────────────────────────────
shipT('D1 marks: the API refuses a bad mark, a missing or overlong reason and a run-owned id; nothing stored', async () => {
  const w = smallWorld();
  const was = ledgerText(w.f.id);
  const refuse = async (body, status, error) => {
    const r = await confirm(w.f.id, body);
    assert.equal(r.status, status, JSON.stringify(body));
    const out = await r.json();
    if (error) assert.equal(out.error, error);
    return out;
  };
  await refuse({ id: 'R-comp-4', mark: 'maybe' }, 400, 'R-comp-4: the mark must be met, not met or dropped');
  await refuse({ id: 'R-comp-4', mark: 'not-met' }, 400, 'R-comp-4: not met needs a reason');
  await refuse({ id: 'R-comp-4', mark: 'dropped', reason: ' \n\t ' }, 400, 'R-comp-4: dropped needs a reason');
  await refuse({ id: 'R-comp-4', mark: 'not_met', reason: 'x'.repeat(301) }, 400, 'R-comp-4: the reason is longer than 300 characters');
  assert.equal((await refuse({ id: 'R-po-2', mark: 'dropped', reason: 'no' }, 409)).code, 'RUN_OWNED');
  assert.equal(ledgerText(w.f.id), was);
});

shipT('D1 marks: Not met with a reason opens Ship, stores the server\'s role, counts only Met, and can change until shipped', async () => {
  const seen = []; const bodies = forge(seen);
  const w = smallWorld();
  const r = await confirm(w.f.id, { id: 'R-comp-4', mark: 'not_met', reason: '  Legal has\nnot signed ', role: 'qa' });
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json();
  assert.deepEqual([out.smallRuns.blocked, out.smallRuns.confirmed[0].mark, out.smallRuns.confirmed[0].reason], [false, 'not-met', 'Legal has not signed']);
  const e = featureView(w.f.id).ship.acceptance.entries.find((x) => x.id === 'R-comp-4');
  assert.deepEqual([e.mark, e.reason, e.role, typeof e.by, typeof e.at], ['not-met', 'Legal has not signed', 'compliance', 'string', 'string']);
  assert.match(featureView(w.f.id).ship.smallRuns.care.outcome, /^3 of 4 built requirements met/);
  // Re-marking: Dropped replaces it; then Met.
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4', mark: 'dropped', reason: 'Out of scope' })).status, 200);
  assert.deepEqual(featureView(w.f.id).ship.smallRuns.unmet, [{ id: 'R-comp-4', text: 'The data stays in the EU', mark: 'dropped', reason: 'Out of scope' }]);
  assert.equal((await ship(w.f.id, 'stacked')).status, 200);
  // Each PR description carries the Dropped line once, under the Care line.
  assert.equal(bodies.size, 4);
  for (const body of bodies.values()) {
    assert.equal(careLines(body), 1, body);
    assert.match(body, /^Care: .*\nDropped: R-comp-4 · Out of scope$/m);
  }
  // The stacked refresh rewrites the preamble in place: one Dropped line and one slice list per edited body.
  const edits = ghCalls(seen, 'edit');
  assert.ok(edits.length > 0);
  for (const e of edits) {
    const body = argOf(e, '--body');
    assert.equal((body.match(/^Dropped: R-comp-4 /gm) || []).length, 1, body);
    for (const n of [1, 2, 3, 4]) assert.ok((body.match(new RegExp(`^- Slice ${n}, `, 'gm')) || []).length <= 1, body);
  }
  const after0 = ledgerText(w.f.id);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4', mark: 'met' })).status, 409, 'no change once shipped');
  assert.equal(ledgerText(w.f.id), after0);
});

shipT('D1 base: the done row names the base as the PR does: a root of origin/dev reads dev', async () => {
  const w = smallWorld({ root: 'origin/dev' });
  spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/me/repo.git'], { cwd: w.dir });
  assert.equal(featureView(w.f.id).ship.smallRuns.base, 'dev');
  const plain = smallWorld({ root: 'feature/x' });
  assert.equal(featureView(plain.f.id).ship.smallRuns.base, 'feature/x', 'not a remote: kept');
});

// ── Slice 5 (R-po-2): Ship names the carried runs and counts the pull requests it will open ─────────────────────────
const CARRIED_BARE = "Run 2's work ships in run 3's pull request";
const CARRIED_LINE = `${CARRIED_BARE} (#40 is open)`;
/** fiveRuns(), with run 3 started on run 1's branch and having taken in run 2's: run 3 carries run 2, so Ship lists
 *  runs 1, 3, 4 and 5. */
function carriedRuns() {
  const w = fiveRuns();
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ source: w.br(1), feature: w.br(3),
    tookIn: [{ index: 2, branch: w.br(2), pipelineId: w.pids[1], sha: git(w.dir, 'rev-parse', w.br(2)) }] }), w.pids[2]);
  return w;
}
const getFeature = async (fid) => (await fetch(`${base}/api/shape/features/${fid}`)).json();
const textsOf = (root, sel) => [...root.querySelectorAll(sel)].map((x) => x.textContent);
/** The Ship card in its ready phase, drawn from the feature as GET answers it. */
function shipCardOf(f) {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  return renderShipCard(doc, { phase: 'ready', featureId: f.id, title: f.title, runs: f.total, smallRuns: f.ship.smallRuns }, {});
}
const cardLabel = (f) => shipCardOf(f).querySelector('[data-act="ship-create"]').textContent;
/** The Create PR dialog's Pull requests zone painted over the real #shipit-modal. */
function paintedDialog(view) {
  const modal = new JSDOM(readIndexHtml()).window.document.getElementById('shipit-modal');
  const ctl = paintGroupShip(modal, view, { setLabel: (l) => { modal.querySelector('.shipit-ok').textContent = l; } });
  const pick = (v) => { const r = modal.querySelector(`.shipit-prs input[value="${v}"]`); r.checked = true; r.dispatchEvent(new modal.ownerDocument.defaultView.Event('change')); };
  return { modal, ctl, pick, ok: () => modal.querySelector('.shipit-ok').textContent };
}

shipT('carried: run 3 carries run 2 with #40 open: the view lists the line, newPrs is 4, the card and dialog read Create 4 PRs', async () => {
  const seen = []; forge(seen);
  const w = carriedRuns();
  seedPr(w.pids[1], 40);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const f = await getFeature(w.f.id);
  const sr = f.ship.smallRuns;
  assert.equal(sr.along, true);
  assert.deepEqual(sr.order.map((o) => o.index), [1, 3, 4, 5], 'run 2 is carried: it is not listed');
  assert.deepEqual(sr.carried, [{ index: 2, by: 3, title: 'Slice 2',
    pr: { number: 40, url: 'https://github.com/me/repo/pull/40', state: 'OPEN' }, line: CARRIED_LINE }], '`by` is the carrier\'s run index');
  assert.equal(sr.newPrs, 4, '#40 is not counted');
  const card = shipCardOf(f);
  assert.deepEqual(textsOf(card, '.ask-shipcard-carried li'), [CARRIED_LINE]);
  assert.equal(card.querySelector('[data-act="ship-create"]').textContent, 'Create 4 PRs');
  const view = await dialogView(w.f.id, true);
  assert.equal(groupShipChoice(view).n, 4);
  const d = paintedDialog(view);
  assert.deepEqual(textsOf(d.modal, '.shipit-prs-carried small.hint'), [CARRIED_LINE]);
  assert.equal(d.modal.querySelector('.shipit-prs-kept')?.textContent, '#40 is not counted.');
  assert.equal(d.ok(), 'Create 4 PRs');
}, SMALL_ON);

shipT('the button count equals the PR creations: a stacked ship makes 4 gh pr create calls (runs 1, 3, 4, 5) and leaves #40 open with no close', async () => {
  const seen = []; forge(seen);
  const w = carriedRuns();
  seedPr(w.pids[1], 40);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const f = await getFeature(w.f.id);
  const label = cardLabel(f);
  const dialog = paintedDialog(await dialogView(w.f.id, true)).ok();
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  const created = ghCalls(seen, 'create');
  assert.deepEqual(created.map((a) => argOf(a, '--head')), [1, 3, 4, 5].map(w.br));
  assert.equal(f.ship.smallRuns.newPrs, created.length, 'newPrs is the number of PR creations');
  assert.deepEqual([label, dialog], [createPrLabel(created.length), createPrLabel(created.length)]);
  assert.deepEqual(ghCalls(seen, 'close'), [], '#40 is not closed');
  assert.deepEqual(getDb().prepare('SELECT pr_url, pr_state FROM pipelines WHERE id = ?').all(w.pids[1]).map((x) => [x.pr_url, x.pr_state]),
    [['https://github.com/me/repo/pull/40', 'OPEN']], 'run 2 keeps #40, open');
}, SMALL_ON);

shipT('the button count equals the PR creations, a listed run with a PR: its open one is not counted, a closed one is', async () => {
  const seen = []; forge(seen);
  const w = carriedRuns();
  seedPr(w.pids[1], 40);
  seedPr(w.pids[3], 41);             // run 4, listed, open: Ship creates none for it
  seedPr(w.pids[4], 42, 'CLOSED');   // run 5, listed, closed: Ship creates a new one
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const f = await getFeature(w.f.id);
  assert.deepEqual(f.ship.smallRuns.order.map((o) => [o.index, o.pr && o.pr.state]), [[1, null], [3, null], [4, 'OPEN'], [5, 'CLOSED']]);
  assert.equal(f.ship.smallRuns.newPrs, 3);
  const label = cardLabel(f);
  const dialog = paintedDialog(await dialogView(w.f.id, true)).ok();
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  const created = ghCalls(seen, 'create');
  assert.deepEqual(created.map((a) => argOf(a, '--head')), [1, 3, 5].map(w.br));
  assert.deepEqual([label, dialog], [createPrLabel(created.length), createPrLabel(created.length)]);
}, SMALL_ON);

shipT('the button count equals the PR creations, One: 1 on the label, 1 create', async () => {
  const seen = []; forge(seen);
  const w = carriedRuns();
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const f = await getFeature(w.f.id);
  assert.equal(f.ship.smallRuns.newPrs, 4);
  assert.deepEqual(f.ship.smallRuns.carried.map((c) => [c.index, c.by, c.pr, c.line]), [[2, 3, null, CARRIED_BARE]]);
  const d = paintedDialog(await dialogView(w.f.id, true));
  assert.deepEqual(textsOf(d.modal, '.shipit-prs-carried small.hint'), [CARRIED_BARE], 'Stacked names the carried run');
  d.pick('one');
  assert.equal(d.modal.querySelector('.shipit-prs-carried').hidden, true, 'One ships every run: no carried line');
  const label = d.ok();
  assert.deepEqual([d.ctl.mode(), d.ctl.count(), label], ['one', 1, 'Create PR']);
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(ghCalls(seen, 'create').length, d.ctl.count());
}, SMALL_ON);

shipT('carried: when the list falls back to the finish order there is no carried key, and newPrs counts the runs the ship loop walks', async () => {
  const seen = []; forge(seen);
  const w = smallWorld();            // finish order 1, 3, 4, 2: runs 3 and 4 cannot be followed into a list
  cleanCheck(w, 2);                  // with the flag on, Ship is ready only once the Verifier checked the head
  seedPr(w.pids[2], 43);
  assert.equal((await confirm(w.f.id, { id: 'R-comp-4' })).status, 200);
  const f = await getFeature(w.f.id);
  const sr = f.ship.smallRuns;
  assert.equal('along' in sr, false);
  assert.equal('carried' in sr, false);
  assert.equal(sr.newPrs, 3);
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(ghCalls(seen, 'create').length, sr.newPrs);
}, SMALL_ON);

shipT('flag off: ship.smallRuns has no newPrs or carried, and order[].pr has no state', async () => {
  const w = carriedRuns();
  seedPr(w.pids[0], 41);
  seedPr(w.pids[1], 40);
  const sr = (await getFeature(w.f.id)).ship.smallRuns;
  assert.equal('newPrs' in sr, false);
  assert.equal('carried' in sr, false);
  const prs = sr.order.map((o) => o.pr).filter(Boolean);
  assert.equal(prs.length, 2);
  for (const pr of prs) assert.deepEqual(Object.keys(pr).sort(), ['number', 'url']);
}, { WORCA_FLAGS: undefined });

test('the stacked ship loop asks the ledger\'s needsNewPr which runs need a pull request (R-arch-7), through features.mjs sliceNeedsPr', () => {
  const src = readServerSource(undefined, { routes: false });
  assert.match(src, /import \{[^}]*\bsliceNeedsPr\b[^}]*\} from '\.\.\/src\/core\/shape\/features\.mjs';/);
  const at = src.indexOf('async function shipFeatureNow(');
  assert.ok(at >= 0);
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(body, /\.some\(sliceNeedsPr\)/);
  assert.match(body, /!sliceNeedsPr\(s\)/);
  assert.doesNotMatch(body, /state === 'CLOSED' *\)/, 'no second copy of the predicate');
  const pr = (state) => ({ url: 'https://github.com/me/repo/pull/9', number: 9, state });
  assert.deepEqual([null, pr('OPEN'), pr('CLOSED'), pr('MERGED')].map((p) => sliceNeedsPr({ pipelineId: 'p1', pr: p })), [true, false, true, false]);
  assert.equal(sliceNeedsPr({ pipelineId: null, pr: null }), false, 'a run not started yet has no branch to open');
});
