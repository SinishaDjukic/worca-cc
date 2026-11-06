// test/design-system-logic.test.mjs — the shared logic of a Rail page (docs/rail/logic.md): states, actions, the step
// flow, where the work goes, interface modes. Written so Chat can use it: no DOM, no mock data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../ui/public/design-system/components/index.mjs';

const CTX = { pr: '#1', pr2: '#2', pr3: '#3', base: 'main', branch: 'feat/x', groupBranch: 'feat/x', source: 'feat/s', hidden: 'worca/run-1', folder: '~/x', n: 3 };

test('every state has a word and a colour, and an unknown state throws', () => {
  for (const id of R.stateIds()) { const s = R.runState(id, CTX); assert.ok(s.word, id); assert.ok(s.dot || s.sym, `${id} has a mark`); }
  assert.throws(() => R.runState('nope'), /unknown state/);
});

test('Paused and Stopped are never Ready: their word and their section stay theirs', () => {
  assert.equal(R.runState('paused', CTX).word, 'Paused');
  assert.equal(R.runState('stopped', CTX).word, 'Stopped');
  assert.equal(R.sectionOf('Paused'), 'needs');
  assert.equal(R.sectionOf('Working'), 'running');
  assert.equal(R.sectionOf('Stopped'), 'recent');
  assert.equal(R.sectionOf('Merged'), 'recent');
});

test('one main action per state; names fill from the run; every main step leads somewhere', () => {
  assert.equal(R.runState('approved', CTX).action.label, 'Merge PR');
  assert.equal(R.runState('outline', CTX).action.label, 'Approve 3 runs');
  assert.equal(R.actionHelp('Merge PR', CTX), 'Merges the PR into main on GitHub');
  assert.equal(R.actionFlow('approved', CTX)['Merge PR'].confirm, 'Merge #1 into main?');
  for (const id of R.stateIds()) {
    const s = R.runState(id, CTX); if (!s.action) continue;
    const f = R.actionFlow(id, CTX);
    if (id === 'featureone') continue;   // its main step comes from how it ships
    assert.ok(f[s.action.label], `${id}: ${s.action.label} has a flow`);
    for (const it of s.action.items) assert.ok(f[it] || /^(Create|Stop|Check out|Try)/.test(it), `${id}: ${it} has a flow`);
  }
});

test('a run inside a group keeps what gets it moving; shipping is the group\'s', () => {
  for (const l of ['Send answer', 'Accept as is', 'Resume now', 'Fix checks', 'Restart Build', 'Approve and build']) assert.ok(R.memberKeeps(l), l);
  for (const l of ['Create PR', 'Merge PR', 'View PR', 'Discard', 'Push']) assert.ok(!R.memberKeeps(l), l);
});

test('a step reads its stage: live, done, next, and how long', () => {
  const st = (state, time = '') => ({ state, time });
  assert.equal(R.stageState([st('done'), st('now')]), 'live');
  assert.equal(R.stageState([st('done'), st('merged')]), 'done');
  assert.equal(R.stageState([st('next')]), 'next');
  assert.equal(R.stageMeta({ subs: [st('done', '59m 50s')] }), '1h');
  assert.equal(R.defaultStage([{ key: 'a', subs: [st('done')] }, { key: 'b', subs: [st('ask')] }]), 'b');
  assert.equal(R.stepLook({ state: 'ask', name: 'x' }).word, 'Needs you');
});

test('the step flow: Dialog, confirm, working, then done or a failure in its words', () => {
  const log = []; let confirmed = false; let shown = false; let end = { ok: true };
  const follow = R.stepFlow({ dialogShown: () => shown, openDialog: () => log.push('dialog'), confirmed: () => confirmed, askConfirm: () => log.push('ask'), working: (l) => log.push(R.workingWord(l)),
    perform: () => end, done: () => log.push('done'), failed: (l, e) => log.push(`${e.title} / ${e.detail}`), after: (fn) => fn() });
  follow({ say: 'x' }, 'Pause'); assert.deepEqual(log.splice(0), ['done']);
  follow({ dialog: 'pr' }, 'Create PR'); assert.deepEqual(log.splice(0), ['dialog']);
  shown = true; follow({ dialog: 'pr' }, 'Create PR'); assert.deepEqual(log.splice(0), ['Creating…', 'done']);
  follow({ confirm: 'Merge?' }, 'Merge PR'); assert.deepEqual(log.splice(0), ['ask']);
  confirmed = true; end = { ok: false, why: 'the branch moved' }; follow({ confirm: 'Merge?' }, 'Merge PR');
  assert.deepEqual(log.splice(0), ['Merging…', 'Could not merge PR / The branch moved. Nothing changed.']);
  end = { ok: false, odd: true }; follow({ confirm: 'Merge?' }, 'Merge PR');
  assert.match(log.at(-1), /Something went wrong on Worca’s side\. Nothing changed\.$/);
  assert.deepEqual(R.confirmOf({ confirm: 'Stop?' }, 'Stop the run'), { text: 'Stop?', yes: 'Stop', danger: true });
});

test('where the work goes: one phrase that follows the run', () => {
  const p = { branch: 'feat/x', base: 'dev' };
  assert.equal(R.workPhrase(p), 'feat/x into dev');
  assert.equal(R.workPhrase({ ...p, pr: '#9' }), '#9 merges feat/x into dev');
  assert.equal(R.workPhrase({ ...p, pr: '#9', merged: true }), 'feat/x merged into dev by #9');
  assert.equal(R.workPhrase({ branch: 'main', base: 'origin/main' }), 'main to origin/main');
  assert.equal(R.workPhrase({ branch: 's', base: 'origin', onSource: true }), 'on s then to origin');
  assert.equal(R.workPhrase({ branch: 's', base: 'origin', onSource: true, finished: true }), 's to origin');
  assert.equal(R.workPhrase({ branch: 's', base: 'origin', onSource: true, hidden: 'copy' }), 'copy not merged into s');
  assert.equal(R.workPhrase({ folder: '~/f' }), 'into ~/f');
  assert.equal(R.workPhrase({ folder: '~/f', applied: true }), 'written into ~/f');
  assert.equal(R.workPlace({ branch: '', base: '' }), '');
  assert.deepEqual(R.foldMiddle('feat/unified-breadcrumb'), ['feat/unified', '-breadcrumb']);
});

test('interface mode: four tabs always; Logs and the graph Advanced, Agents and log filters Expert', () => {
  assert.ok(!R.runPartShows('logs', 'simple')); assert.ok(R.runPartShows('logs', 'advanced'));
  assert.ok(!R.runPartShows('graph', 'simple')); assert.ok(R.runPartShows('graph', 'advanced'));
  assert.ok(!R.runPartShows('agents', 'advanced')); assert.ok(R.runPartShows('agents', 'expert'));
  assert.ok(!R.runPartShows('logFilters', 'advanced')); assert.ok(R.runPartShows('logFilters', 'expert'));
  assert.ok(!R.runPartShows('actions', 'simple')); assert.ok(R.runPartShows('actions', 'advanced'));
  assert.ok(R.runPartShows('overview', 'simple'));
  assert.throws(() => R.atLevel('nope'), /unknown mode/);
});

test('prefs: one mode and one set of Labs flags; a change tells who listens', () => {
  const seen = []; const off = R.prefs.onChange(() => seen.push(R.prefs.mode()));
  R.prefs.setMode('simple'); assert.ok(!R.shows('advanced')); assert.ok(R.shows(''));
  R.prefs.setMode('expert'); R.prefs.setFlag('x', true); assert.ok(R.prefs.flag('x')); off();
  R.prefs.setMode('advanced'); R.prefs.setMode('expert');
  assert.deepEqual(seen, ['simple', 'expert', 'expert']);
  assert.throws(() => R.prefs.setMode('nope'));
});

test('a run\'s other states: what each offers, and what it holds back', () => {
  assert.deepEqual(R.runState('paused-budget', CTX).action.items, []);   // a total budget offers only Open Settings
  assert.equal(R.runState('paused-budget', CTX).action.label, 'Open Settings');
  assert.ok(R.runState('paused-limit', CTX).action.items.includes('Resume on Codex'));   // the other engine only after its limit
  assert.ok(!R.runState('paused-reason', CTX).action.items.includes('Resume on Codex'));
  assert.match(R.runState('capped', CTX).action.off['Resume at…'], /cost cap/);
  assert.equal(R.runState('round', CTX).word, 'In review');   // a PR fix round never raises Needs you
  assert.equal(R.runState('pr-closed', { host: 'azure' }).word, 'Abandoned');
  assert.equal(R.runState('pr-closed', { host: 'bitbucket' }).word, 'Declined');
  assert.equal(R.runState('pr-closed').word, 'Closed');
  assert.equal(R.actionLevel('Open in New run'), 'advanced');
  assert.equal(R.actionLevel('Resume now'), 'simple');
  assert.ok(R.memberKeeps('Resume now') && R.memberKeeps('Retry') && !R.memberKeeps('Create PR again'));
});

test('usage: only connected providers count; a ring says what it shows; it refreshes every minute', () => {
  const usage = [{ p: 'claude' }, { p: 'codex' }];
  assert.deepEqual(R.connectedUsage(usage, (p) => p === 'codex'), [{ p: 'codex' }]);
  assert.equal(R.usageTip({ what: 'Weekly', who: 'Claude Code', figure: '55%', resets: 'Wed 5:00 PM' }), 'Weekly · Claude Code: 55%\nResets Wed 5:00 PM');
  assert.equal(R.usageTip({ what: 'Spend', who: 'this week', figure: '$10 of $20' }), 'Spend · this week: $10 of $20');
  assert.equal(R.usageWindow('week'), 'Weekly');
  assert.equal(R.USAGE_REFRESH_MS, 60000);
  R.prefs.setConnected('claude', false); assert.ok(!R.prefs.connected('claude')); assert.ok(R.prefs.connected('codex'));
  R.prefs.setConnected('claude', true); assert.ok(R.prefs.connected('claude'));
});

test('tryStep: says what is happening, then the next step; never a dead end', () => {
  const svc = { name: 'Web', port: 3000 };
  assert.deepEqual(R.tryStep({ checkingOut: true }).map((x) => [x.text, x.off]), [['Checking out…', true]]);
  assert.equal(R.tryStep({ settingUp: true })[0].text, 'Setting up…');
  assert.equal(R.tryStep({ setupFailed: 'npm install failed' })[0].help, 'npm install failed');
  assert.equal(R.tryStep({ service: svc })[0].text, 'Start Web');
  assert.deepEqual(R.tryStep({ service: { ...svc, running: true } }).map((x) => x.text), ['Open :3000', 'Stop Web']);
  assert.equal(R.tryStep({})[0].text, 'Open Actions');
});
