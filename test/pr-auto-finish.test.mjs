// test/pr-auto-finish.test.mjs — the PR-when-done step (src/core/pr-auto-finish.mjs) against fakes: when a settled run
// opens a PR, when it does not and why, the account preflight, and the Shaper `each` / `one` modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrAutoFinisher, accountCheck } from '../src/core/pr-auto-finish.mjs';

const OK = { ok: true, url: 'https://github.com/o/r/pull/1', fellBack: false };

/** A fake world: run rows (pr_auto), features, and every server dependency recorded. */
function world({ runs = {}, features = {}, flag = true } = {}) {
  const w = { logs: [], notices: [], notifs: [], opened: [], members: [], ships: [], billed: [], changed: [], runs, features, flag,
    prs: {}, commits: true, accountResult: { ok: true } };
  const link = new Map();
  for (const [fid, f] of Object.entries(features)) for (const p of f.pids || []) link.set(p, { featureId: fid, idx: (f.pids.indexOf(p)) + 1 });
  w.deps = {
    readRunPrAuto: (id) => (runs[id] ? runs[id].pa : null),
    setRunPrOutcome: (id, o) => {
      const pa = runs[id]?.pa;
      if (!pa || pa.outcome?.final) return false;
      pa.outcome = o; return true;
    },
    featurePrSetting: (id) => features[id]?.setting || null,
    setFeaturePrOutcome: (id, o) => {
      const s = features[id]?.setting;
      if (!s || (s.outcome && s.outcome.status !== 'held')) return false;
      s.outcome = o; return true;
    },
    logToRun: (id, level, text) => { w.logs.push({ id, level, text }); },
    featureOfPipeline: (id) => link.get(id) || null,
    featureView: (id) => features[id]?.view(),
    featureThread: (id) => (features[id]?.thread === false ? null : { threadId: `t-${id}` }),
    featureRootSource: (id) => features[id]?.root || null,
    featureBase: (id) => features[id]?.base || 'main',
    roundOrigin: (id) => runs[id]?.origin || id,
    readPrState: (id) => w.prs[id] || null,
    readState: (id) => w.states?.[id] || null,
    readMemberPrStates: () => ({}),
    branchExists: async () => true,
    commitsAhead: async () => (w.commits ? 2 : 0),
    flagEnabled: () => w.flag,
    addNotification: (n) => { w.notifs.push(n); return n; },
    withBillTo: (who, fn) => { w.billed.push(who); return fn(); },
    accountCheck: async (a) => { w.accountArgs = a; return w.accountResult; },
    now: () => '2026-01-01T00:00:00.000Z',
    pushRemoteUrls: async (dirs) => { w.pushDirs = dirs; return ['https://github.com/o/r.git']; },
    live: () => null,
    changed: (k) => w.changed.push(k),
    postNotice: (thread, text) => w.notices.push({ thread, text }),
    openRunPrs: async (id, o) => { w.opened.push({ id, ...o, who: w.billed.at(-1) }); return w.openRunResult ? w.openRunResult(o) : { ...OK, newDraft: !!o.draft }; },
    openMemberPr: async (id, o) => { w.members.push({ id, ...o, who: w.billed.at(-1) }); return w.memberResult ? w.memberResult(id, o) : { ok: true, newDraft: !!o.draft, pr: { url: `https://github.com/o/r/pull/${id}` } }; },
    shipFeatureNow: async (id, mode, o) => { w.ships.push({ id, mode, ...o, who: w.billed.at(-1) }); return w.shipResult ? w.shipResult(o) : { status: 200, body: { ok: true, prUrl: 'https://github.com/o/r/pull/99', newDraft: !!o.draft } }; },
  };
  w.fin = createPrAutoFinisher(w.deps);
  return w;
}
const PA = (over = {}) => ({ open: 'draft', slices: 'each', scope: 'project', source: { open: 'project', slices: 'default' }, ...over });
const st = (over = {}) => ({ id: 'r1', status: 'done', startedBy: 'ann@acme.test', projectDir: '/p', target: 'project',
  branch: { feature: 'feat/x', source: 'main' }, ...over });
const logTexts = (w) => w.logs.map((l) => l.text);
const outcomeOf = (w, id = 'r1') => w.runs[id].pa.outcome;

test('error / stopped: nothing opened, the reason logged, outcome skipped and non-final', async () => {
  for (const status of ['error', 'stopped']) {
    const w = world({ runs: { r1: { pa: PA() } } });
    await w.fin.afterSettled(st({ status }));
    assert.equal(w.opened.length, 0);
    assert.deepEqual([outcomeOf(w).status, outcomeOf(w).final], ['skipped', false]);
    assert.deepEqual(logTexts(w), [`Pull request not opened: the run ended with status ${status}`]);
  }
});

test('error then resumed to done: the second settle opens the PR', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  await w.fin.afterSettled(st({ status: 'error' }));
  const o = await w.fin.afterSettled(st());
  assert.equal(w.opened.length, 1);
  assert.deepEqual([o.status, o.final, outcomeOf(w).status], ['opened', true, 'opened']);
});

test('paused: no-op, no outcome', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  assert.equal(await w.fin.afterSettled(st({ status: 'paused' })), null);
  assert.equal(outcomeOf(w), undefined);
  assert.deepEqual(w.logs, []);
});

test('done with commitFailed: kept uncommitted work, nothing opened', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  await w.fin.afterSettled(st({ branch: { feature: 'f', source: 'main', commitFailed: { step: 'commit' } } }));
  assert.equal(w.opened.length, 0);
  assert.deepEqual(logTexts(w), ['Pull request not opened: the run kept uncommitted work (commit failed at git commit)']);
  assert.equal(outcomeOf(w).final, true);
});

test('done with no commits ahead: nothing opened', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  w.commits = false;
  await w.fin.afterSettled(st());
  assert.equal(w.opened.length, 0);
  assert.deepEqual(logTexts(w), ['Pull request not opened: the run committed no work on feat/x']);
});

test('already has a PR: nothing opened (a closed one does not count)', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  w.prs.r1 = { url: 'https://github.com/o/r/pull/5', state: 'OPEN' };
  await w.fin.afterSettled(st());
  assert.equal(w.opened.length, 0);
  assert.deepEqual(logTexts(w), ['Pull request not opened: the run already has one (https://github.com/o/r/pull/5)']);
  const closed = world({ runs: { r1: { pa: PA() } } });
  closed.prs.r1 = { url: 'https://github.com/o/r/pull/5', state: 'CLOSED' };
  await closed.fin.afterSettled(st());
  assert.equal(closed.opened.length, 1);
});

test('open none: nothing opened, no log line', async () => {
  const w = world({ runs: { r1: { pa: PA({ open: 'none' }) } } });
  await w.fin.afterSettled(st());
  assert.equal(w.opened.length, 0);
  assert.deepEqual(w.logs, []);
  assert.equal(outcomeOf(w).status, 'skipped');
});

test('automation / pr-watch exemptions: nothing opened; a round re-checks its feature', async () => {
  for (const exempt of ['automation', 'pr-watch', 'resolve', 'no-work', 'same-as-source']) {
    const w = world({ runs: { r1: { pa: PA({ open: 'none', exempt }) } } });
    await w.fin.afterSettled(st());
    assert.equal(w.opened.length + w.members.length + w.ships.length, 0, exempt);
    assert.equal(outcomeOf(w).status, 'skipped', exempt);
  }
  const view = (ready) => () => ({ id: 'f1', title: 'T', ship: { ready, mode: null }, slices: [{ index: 1 }] });
  const w = world({
    runs: { r1: { pa: PA({ open: 'none', exempt: 'round' }), origin: 's1' }, s1: { pa: PA() } },
    features: { f1: { pids: ['s1'], setting: { open: 'draft', slices: 'one', source: {}, outcome: null, createdBy: 'ann@acme.test', projectDir: '/p' }, view: view(true) } },
  });
  await w.fin.afterSettled(st());
  assert.equal(w.ships.length, 1, 'the round settle ships the feature a live round was holding');
  assert.equal(outcomeOf(w).status, 'skipped');
});

test('pre-v86 run (pr_auto null): nothing at all', async () => {
  const w = world({ runs: {} });
  assert.equal(await w.fin.afterSettled(st()), null);
  assert.deepEqual([w.opened, w.logs, w.notifs], [[], [], []]);
});

test('final outcome already set: a second settle does nothing', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  await w.fin.afterSettled(st());
  await w.fin.afterSettled(st());
  assert.equal(w.opened.length, 1);
});

test('done and committed: openRunPrs called once with draft true and actor = startedBy inside withBillTo(startedBy)', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  const o = await w.fin.afterSettled(st());
  assert.equal(w.opened.length, 1);
  assert.deepEqual([w.opened[0].draft, w.opened[0].actor, w.opened[0].who], [true, 'ann@acme.test', 'ann@acme.test']);
  assert.deepEqual([o.status, o.draft, o.urls], ['opened', true, ['https://github.com/o/r/pull/1']]);
  assert.deepEqual(logTexts(w), ['Opened a draft pull request: https://github.com/o/r/pull/1']);
  assert.ok(w.changed.includes('pipelines-changed'));
});

test('ready: draft false', async () => {
  const w = world({ runs: { r1: { pa: PA({ open: 'ready' }) } } });
  await w.fin.afterSettled(st());
  assert.equal(w.opened[0].draft, false);
  assert.deepEqual(logTexts(w), ['Opened a pull request ready for review: https://github.com/o/r/pull/1']);
});

test('a PR a person opened during the gate is skipped, not recorded as an auto-opened draft', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  w.openRunResult = () => ({ ...OK, existed: true, newDraft: false });
  const o = await w.fin.afterSettled(st());
  assert.deepEqual([o.status, o.final], ['skipped', true]);
  assert.match(o.reason, /^the run already has one \(https:\/\/github\.com\/o\/r\/pull\/1\)/);
  assert.deepEqual(logTexts(w), [`Pull request not opened: ${o.reason}`]);
});

test('draft refused: opened ready and a run-log line says so', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  w.openRunResult = (o) => { o.onDraftFallback({ memberKey: null, error: 'drafts are off' }); return { ...OK, fellBack: true }; };
  const o = await w.fin.afterSettled(st());
  assert.deepEqual([o.draft, o.fellBack], [false, true]);
  assert.deepEqual(logTexts(w), [
    'Draft pull requests are not available for this repository (drafts are off): opened it ready for review instead.',
    'Opened a pull request ready for review: https://github.com/o/r/pull/1']);
});

const wsState = (over = {}) => st({ target: 'workspace', projectDir: '/a', branch: null, projects: [
  { projectKey: 'a', projectName: 'a', projectDir: '/a' }, { projectKey: 'b', projectName: 'b', projectDir: '/b' }],
  branches: { a: { feature: 'f-a', source: 'main' }, b: { feature: 'f-b', source: 'main' } }, ...over });

test('workspace: member PRs reported; any member with commitFailed opens nothing', async () => {
  const w = world({ runs: { r1: { pa: PA({ scope: 'workspace', slices: null }) } } });
  w.openRunResult = () => ({ ok: true, url: 'u1', prs: [{ name: 'a', url: 'u1' }, { name: 'b', url: null, error: 'push denied' }], fellBack: false, newDraft: true });
  const o = await w.fin.afterSettled(wsState());
  assert.deepEqual(o.urls, ['u1']);
  assert.deepEqual(w.pushDirs, ['/a', '/b']);
  assert.deepEqual(logTexts(w), ['Opened a draft pull request: u1', 'Pull request not opened for b: push denied']);
  const kept = world({ runs: { r1: { pa: PA({ scope: 'workspace', slices: null }) } } });
  await kept.fin.afterSettled(wsState({ branches: { a: { feature: 'f-a', source: 'main' }, b: { feature: 'f-b', source: 'main', commitFailed: { step: 'add' } } } }));
  assert.equal(kept.opened.length, 0);
  assert.match(logTexts(kept)[0], /kept uncommitted work \(commit failed at git add\)/);
  const none = world({ runs: { r1: { pa: PA({ scope: 'workspace', slices: null }) } } });
  none.openRunResult = () => ({ ok: false, error: 'the run changed no repository' });
  assert.equal((await none.fin.afterSettled(wsState())).status, 'skipped');
});

test('as-person mode, starter with no GitHub: failed with the reason recorded, notification, the run\'s status untouched, no opener call', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  const env = { WORCA_BROKER_URL: 'http://127.0.0.1:1', WORCA_GH_AS_PERSON: 'prefer' };
  w.deps.accountCheck = (a) => accountCheck({ ...a, env, personGithubToken: async () => { throw new Error('not connected'); } });
  const fin = createPrAutoFinisher(w.deps);
  const s = st();
  const o = await fin.afterSettled(s);
  assert.equal(w.opened.length, 0);
  assert.equal(o.status, 'failed');
  assert.match(o.reason, /ann@acme.test has no usable GitHub account for pushes \(not connected\)/);
  assert.equal(w.notifs.length, 1);
  assert.deepEqual([w.notifs[0].kind, w.notifs[0].pipelineId], ['pr_auto', 'r1']);
  assert.equal(s.status, 'done');
  assert.match(logTexts(w)[0], /^Pull request not opened: ann@acme.test has no usable/);
});

test('accountCheck: the starter is normalised like the push (lower-cased) before the token is asked for', async () => {
  const asked = [];
  const env = { WORCA_BROKER_URL: 'http://x', WORCA_GH_AS_PERSON: 'required' };
  await accountCheck({ startedBy: ' Ann@Acme.test ', repoUrls: ['git@github.com:o/r.git'], env, personGithubToken: async (who) => { asked.push(who); return {}; } });
  assert.deepEqual(asked, ['ann@acme.test']);
});

test('accountCheck: off → ok; a non-GitHub remote needs no preflight; a non-person starter is refused', async () => {
  let asked = 0;
  const token = async () => { asked++; return { token: 't' }; };
  const env = { WORCA_BROKER_URL: 'http://x', WORCA_GH_AS_PERSON: 'required' };
  assert.deepEqual(await accountCheck({ startedBy: 'local', repoUrls: ['https://github.com/o/r.git'], env: {}, personGithubToken: token }), { ok: true });
  assert.deepEqual(await accountCheck({ startedBy: 'ann@acme.test', repoUrls: ['https://gitlab.com/o/r.git'], env, personGithubToken: token }), { ok: true });
  assert.equal(asked, 0);
  const local = await accountCheck({ startedBy: 'local', repoUrls: ['git@github.com:o/r.git'], env, personGithubToken: token });
  assert.equal(local.ok, false);
  assert.match(local.reason, /go out as the person who started the run, and local is not a signed-in person/);
  assert.deepEqual(await accountCheck({ startedBy: 'ann@acme.test', repoUrls: ['git@github.com:o/r.git'], env, personGithubToken: token }), { ok: true });
  assert.equal(asked, 1);
});

test('an opener that throws → failed, never rejects', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  w.deps.openRunPrs = async () => { throw new Error('boom'); };
  const fin = createPrAutoFinisher(w.deps);
  const o = await fin.afterSettled(st());
  assert.deepEqual([o.status, o.final], ['failed', true]);
  assert.match(o.reason, /boom/);
});

// ── Shaper slices ─────────────────────────────────────────────────────────────────────────────────────────────
const SETTING = (over = {}) => ({ open: 'draft', slices: 'one', source: { open: 'team', slices: 'team' }, outcome: null, createdBy: 'ann@acme.test', projectDir: '/p', ...over });
const feature = ({ pids = ['s1', 's2'], setting = SETTING(), ready = () => true, kinds = [], acceptance = null, mode = null, title = 'Charts', ...rest } = {}) => ({
  pids, setting, root: null, ...rest,
  view: () => ({ id: 'f1', title, ship: { ready: ready(), mode, ...(acceptance ? { acceptance: acceptance() } : {}) },
    slices: pids.map((p, i) => ({ index: i + 1, pipelineId: p, kind: kinds[i] || null })) }),
});
const sliceWorld = (f, extra = {}) => world({ runs: { s1: { pa: PA() }, s2: { pa: PA() }, ...extra }, features: { f1: f } });
const slice = (id, over = {}) => st({ id, ...over });

test('each: every done slice calls openMemberPr with draft and the starter', async () => {
  const w = sliceWorld(feature({ setting: SETTING({ slices: 'each' }) }));
  await w.fin.afterSettled(slice('s1'));
  await w.fin.afterSettled(slice('s2'));
  assert.deepEqual(w.members.map((m) => [m.id, m.draft, m.actor, m.who]), [['s1', true, 'ann@acme.test', 'ann@acme.test'], ['s2', true, 'ann@acme.test', 'ann@acme.test']]);
  assert.equal(w.opened.length, 0);
  assert.deepEqual(w.runs.s1.pa.outcome.urls, ['https://github.com/o/r/pull/s1']);
});

test('each: a PR a person opened during the gate (found on the forge, r.pr.existed) is skipped, not recorded as opened', async () => {
  const w = sliceWorld(feature({ setting: SETTING({ slices: 'each' }) }));
  w.memberResult = () => ({ ok: true, pr: { url: 'https://github.com/o/r/pull/7', existed: true }, newDraft: false });
  await w.fin.afterSettled(slice('s1'));
  const o = w.runs.s1.pa.outcome;
  assert.deepEqual([o.status, o.final], ['skipped', true]);
  assert.match(o.reason, /^the run already has one \(https:\/\/github\.com\/o\/r\/pull\/7\)/);
  assert.deepEqual(logTexts(w), [`Pull request not opened: ${o.reason}`]);
});

test('workspace: member PRs that already existed are neither logged nor recorded as opened', async () => {
  const w = world({ runs: { r1: { pa: PA({ scope: 'workspace', slices: null }) } } });
  w.openRunResult = () => ({ ok: true, url: 'u-new', prs: [{ name: 'a', url: 'u-old', existed: true }, { name: 'b', url: 'u-new', draft: true }], fellBack: false, existed: false, newDraft: true });
  const o = await w.fin.afterSettled(wsState());
  assert.deepEqual([o.status, o.urls], ['opened', ['u-new']]);
  assert.deepEqual(logTexts(w), ['Opened a draft pull request: u-new']);
});

test('one: a slice opens nothing (waiting) and maybeShipOne ships when ship.ready', async () => {
  let ready = false;
  const w = sliceWorld(feature({ ready: () => ready }));
  await w.fin.afterSettled(slice('s1'));
  assert.deepEqual([w.members.length, w.ships.length, w.runs.s1.pa.outcome.status, w.runs.s1.pa.outcome.final], [0, 0, 'waiting', true]);
  assert.match(logTexts(w)[0], /^This slice opens no PR of its own/);
  ready = true;
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 1);
  assert.deepEqual([w.ships[0].id, w.ships[0].mode, w.ships[0].draft, w.ships[0].watch, w.ships[0].actor, w.ships[0].who, w.ships[0].base],
    ['f1', 'one', true, true, 'ann@acme.test', 'ann@acme.test', null]);
  assert.deepEqual(w.features.f1.setting.outcome.urls, ['https://github.com/o/r/pull/99']);
  assert.equal(w.features.f1.setting.outcome.status, 'opened');
  assert.ok(logTexts(w).includes('Opened a draft pull request: https://github.com/o/r/pull/99'));
});

test('one: a slice that errored then resumed to done triggers the ship', async () => {
  const w = sliceWorld(feature());
  await w.fin.afterSettled(slice('s2', { status: 'error' }));
  assert.deepEqual([w.ships.length, w.runs.s2.pa.outcome.status, w.runs.s2.pa.outcome.final], [0, 'waiting', false]);
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 1);
});

test('one: not ready while an extra slice is planned; ships when the extra slice is done (never on idx === total)', async () => {
  let ready = false;
  const w = sliceWorld(feature({ pids: ['s1', 's2', 's3'], ready: () => ready }), { s3: { pa: PA() } });
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 0, 'slice 2 of 2 settled, but the extra run 3 is planned');
  ready = true;
  await w.fin.afterSettled(slice('s3'));
  assert.equal(w.ships.length, 1);
});

test('one: a follow-up blocks it: no ship call, one feature notice, a notification, even when the follow-up settles last', async () => {
  const w = sliceWorld(feature({ pids: ['s1', 's2'], kinds: [null, 'follow-up'] }));
  await w.fin.afterSettled(slice('s1'));
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 0);
  assert.equal(w.notices.length, 1);
  assert.equal(w.notices[0].text, 'One pull request for "Charts" was not opened: run 2 is a follow-up that starts from main, so the last run\'s branch does not hold every run\'s work. Ship the feature from the Ship card.');
  assert.equal(w.notifs.length, 1);
  assert.equal(w.features.f1.setting.outcome.status, 'blocked');
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.notices.length, 1, 'a later trigger does not notify again');
});

test('one: a re-planned feature: the old feature never ships, the new one ships with base = featureRootSource', async () => {
  const w = world({ runs: { s1: { pa: PA() }, n1: { pa: PA() } }, features: {
    f1: feature({ pids: ['s1'], ready: () => false }),
    f2: { ...feature({ pids: ['n1'] }), root: 'main', base: 'feat/old-last' },
  } });
  w.deps.featureView = (id) => w.features[id].view();
  await w.fin.afterSettled(slice('s1'));
  assert.equal(w.ships.length, 0, 'the replanned feature is not ship.ready');
  w.features.f2.view = () => ({ id: 'f2', title: 'Charts', ship: { ready: true, mode: null }, slices: [{ index: 1, pipelineId: 'n1' }] });
  await w.fin.afterSettled(slice('n1'));
  assert.deepEqual([w.ships.length, w.ships[0].id, w.ships[0].base], [1, 'f2', 'main']);
});

test('one: requirements unmarked → held, one notice; onAcceptanceChanged ships when marked; a second held does not notify again', async () => {
  let left = 2;
  const acceptance = () => ({ ready: left === 0, items: [{ id: 'a', pass: left < 2 }, { id: 'b', pass: left < 1 }].filter((i) => !i.pass).concat(left === 0 ? [{ id: 'z', pass: true }] : []) });
  const w = sliceWorld(feature({ acceptance }));
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 0);
  assert.equal(w.features.f1.setting.outcome.status, 'held');
  assert.equal(w.notices.length, 1);
  assert.match(w.notices[0].text, /waits for every agreed requirement to be marked \(2 left\)\. It opens when the last one is marked/);
  left = 1;
  await w.fin.onAcceptanceChanged('f1');
  assert.equal(w.ships.length, 0);
  assert.equal(w.notices.length, 1, 'still held: no second notice');
  assert.equal(w.features.f1.setting.outcome.left, 1);
  left = 0;
  await w.fin.onAcceptanceChanged('f1');
  assert.equal(w.ships.length, 1);
  assert.equal(w.features.f1.setting.outcome.status, 'opened');
  await w.fin.onAcceptanceChanged('f1');
  assert.equal(w.ships.length, 1, 'an opened feature is not shipped again');
});

test('one: the requirements gate is off without the flag', async () => {
  const w = sliceWorld(feature({ acceptance: () => ({ ready: false, items: [{ id: 'a', pass: false }] }) }));
  w.flag = false;
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 1);
});

test('one: 409 already shipping is a no-op; a 409 ACCEPTANCE_INCOMPLETE is held; any other 409 is blocked', async () => {
  const w = sliceWorld(feature());
  w.shipResult = () => ({ status: 409, body: { code: 'SHIPPING', error: 'this feature is already shipping' } });
  await w.fin.afterSettled(slice('s2'));
  assert.deepEqual([w.features.f1.setting.outcome, w.notices.length, w.notifs.length], [null, 0, 0]);
  w.shipResult = () => ({ status: 409, body: { error: 'x', code: 'ACCEPTANCE_INCOMPLETE', missing: ['a'] } });
  await w.fin.maybeShipOne('f1');
  assert.equal(w.features.f1.setting.outcome.status, 'held');
  w.shipResult = () => ({ status: 409, body: { code: 'HAS_SLICE_PR', error: 'a run in this feature already has a PR: create one PR per run' } });
  await w.fin.maybeShipOne('f1');
  const o = w.features.f1.setting.outcome;
  assert.deepEqual([o.status, o.reason], ['blocked', 'a run in this feature already has a PR: create one PR per run']);
  assert.equal(w.notifs.length, 1);
});

test('one: a not-ready 409 (a round or extra run began during the account check) records nothing and the next settle ships', async () => {
  for (const code of ['ROUND_LIVE', 'NOT_READY']) {
    const w = sliceWorld(feature());
    w.shipResult = () => ({ status: 409, body: { code, error: 'still going' } });
    await w.fin.afterSettled(slice('s2'));
    assert.deepEqual([w.features.f1.setting.outcome, w.notices.length, w.notifs.length], [null, 0, 0], code);
    w.shipResult = null;
    await w.fin.maybeShipOne('f1');
    assert.equal(w.features.f1.setting.outcome.status, 'opened', code);
  }
});

test('one: the feature is re-read after the account check: not ready then, or shipped meanwhile, ships nothing', async () => {
  let calls = 0;
  const w = sliceWorld(feature({ ready: () => ++calls === 1 }));
  await w.fin.afterSettled(slice('s2'));
  assert.deepEqual([w.ships.length, w.features.f1.setting.outcome], [0, null]);
  const shipped = sliceWorld(feature());
  let n = 0;
  const base = shipped.features.f1.view;
  shipped.features.f1.view = () => { const v = base(); return ++n >= 2 ? { ...v, ship: { ...v.ship, mode: 'one' } } : v; };
  await shipped.fin.afterSettled(slice('s2'));
  assert.equal(shipped.ships.length, 0);
  assert.deepEqual([shipped.features.f1.setting.outcome.status, shipped.notices.length, shipped.notifs.length], ['skipped', 0, 0]);
});

test('one: an ALREADY_SHIPPED 409 is a quiet skipped', async () => {
  const w = sliceWorld(feature());
  w.shipResult = () => ({ status: 409, body: { code: 'ALREADY_SHIPPED', error: 'this feature was already shipped as one PR' } });
  await w.fin.afterSettled(slice('s2'));
  assert.deepEqual([w.features.f1.setting.outcome.status, w.notices.length, w.notifs.length], ['skipped', 0, 0]);
});

test('one: a slice that kept uncommitted work is skipped, and the feature is blocked with a notice naming the run (never a partial PR)', async () => {
  const w = sliceWorld(feature());
  w.states = { s1: { branch: { feature: 'f', source: 'main', commitFailed: { step: 'commit' } } }, s2: {} };
  await w.fin.afterSettled(slice('s1', { branch: { feature: 'f', source: 'main', commitFailed: { step: 'commit' } } }));
  assert.deepEqual([w.runs.s1.pa.outcome.status, w.runs.s1.pa.outcome.final], ['skipped', true]);
  assert.match(w.runs.s1.pa.outcome.reason, /kept uncommitted work \(commit failed at git commit\)/);
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 0);
  const o = w.features.f1.setting.outcome;
  assert.equal(o.status, 'blocked');
  assert.match(o.reason, /run 1 kept uncommitted work/);
  assert.equal(w.notices.length, 1);
});

test('one: a manual ship settles a held feature; the finisher\'s own ship is left to write its outcome', async () => {
  const w = sliceWorld(feature({ setting: SETTING({ outcome: { status: 'held', final: false } }) }));
  w.fin.onShipped('f1');
  assert.equal(w.features.f1.setting.outcome.status, 'skipped');
  const done = sliceWorld(feature({ setting: SETTING({ outcome: { status: 'opened', final: true } }) }));
  done.fin.onShipped('f1');
  assert.equal(done.features.f1.setting.outcome.status, 'opened');
  const none = sliceWorld(feature());
  none.fin.onShipped('f1');
  assert.equal(none.features.f1.setting.outcome.status, 'skipped', 'a feature whose auto attempt recorded nothing is settled too');
  const off = sliceWorld(feature({ setting: SETTING({ open: 'none' }) }));
  off.fin.onShipped('f1');
  assert.equal(off.features.f1.setting.outcome, null);
});

test('one: an exempt round that ends in error still releases the ship (its own outcome stays open); a Watch PR round does too', async () => {
  const w = world({ runs: { s1: { pa: PA() }, s2: { pa: PA() }, rd: { pa: PA({ open: 'none', exempt: 'round' }), origin: 's2' }, pw: { pa: PA({ open: 'none', exempt: 'pr-watch' }), origin: 's2' } },
    features: { f1: feature() } });
  await w.fin.afterSettled(st({ id: 'rd', status: 'error' }));
  assert.deepEqual([w.ships.length, w.runs.rd.pa.outcome.final], [1, false]);
  const other = world({ runs: { s1: { pa: PA() }, s2: { pa: PA() }, pw: { pa: PA({ open: 'none', exempt: 'pr-watch' }), origin: 's2' } },
    features: { f1: feature() } });
  await other.fin.afterSettled(st({ id: 'pw' }));
  assert.equal(other.ships.length, 1);
});

test('one: a resumed errored slice that settles after the ship notifies once', async () => {
  const w = sliceWorld(feature({ mode: 'one' }));
  await w.fin.afterSettled(slice('s2', { status: 'error' }));
  assert.equal(w.notices.length, 0, 'not final: no notice');
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.notices.length, 1);
});

test('one: failed is not retried by a later trigger', async () => {
  const w = sliceWorld(feature());
  w.shipResult = () => ({ status: 500, body: { error: 'could not create the PR: boom' } });
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.features.f1.setting.outcome.status, 'failed');
  assert.equal(w.notifs.length, 1);
  await w.fin.maybeShipOne('f1');
  await w.fin.afterSettled(slice('s1'));
  assert.equal(w.ships.length, 1);
});

test('one: a live round holds it until the round run settles', async () => {
  let ready = false;
  const w = world({ runs: { s1: { pa: PA() }, s2: { pa: PA() }, rd: { pa: PA({ open: 'none', exempt: 'round' }), origin: 's2' } },
    features: { f1: feature({ ready: () => ready }) } });
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 0);
  ready = true;
  await w.fin.afterSettled(st({ id: 'rd' }));
  assert.equal(w.ships.length, 1);
});

test('one: a slice settled after the feature shipped is skipped with a feature notice', async () => {
  const w = sliceWorld(feature({ mode: 'one' }));
  await w.fin.afterSettled(slice('s2'));
  assert.equal(w.ships.length, 0);
  assert.equal(w.runs.s2.pa.outcome.status, 'skipped');
  assert.match(w.runs.s2.pa.outcome.reason, /^the feature already shipped as one PR; this run's work is not in it/);
  assert.equal(w.notices.length, 1);
});

test('a feature whose open is none, or that is unknown, opens nothing and logs nothing', async () => {
  const w = sliceWorld(feature({ setting: SETTING({ open: 'none' }) }));
  await w.fin.afterSettled(slice('s1'));
  assert.deepEqual([w.members.length, w.ships.length, w.logs.length, w.runs.s1.pa.outcome.status], [0, 0, 0, 'skipped']);
});

test('a thread-less feature falls back to a notification', async () => {
  const w = sliceWorld(feature({ pids: ['s1', 's2'], kinds: [null, 'follow-up'], thread: false }));
  await w.fin.afterSettled(slice('s2'));
  assert.deepEqual([w.notices.length, w.notifs.length], [0, 1], 'one notification, not two');
});

test('a resumed run whose in-memory state has no starter takes it from the row', async () => {
  const w = world({ runs: { r1: { pa: PA() } } });
  w.states = { r1: { startedBy: 'bob@acme.test' } };
  await w.fin.afterSettled(st({ startedBy: null }));
  assert.deepEqual([w.opened[0].actor, w.opened[0].who], ['bob@acme.test', 'bob@acme.test']);
  const none = world({ runs: { r1: { pa: PA() } } });
  await none.fin.afterSettled(st({ startedBy: null }));
  assert.equal(none.opened[0].actor, 'worca', 'no starter anywhere: worca opens it');
});
