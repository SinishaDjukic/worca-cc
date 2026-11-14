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
  assert.equal(R.runState('outline', CTX).action.label, 'Approve 3 tasks');
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

// A step others see or that cannot be taken back confirms (docs/rail/actions.md act.confirm). An exception needs its reason here.
const OTHERS_SEE = /^(Push|Publish|Apply to|Fix |Merge|Mark ready|Link remote|Discard|Archive|Stop|Cancel the rest|Re-plan|Delete|Continue|Update branch|Create|Raise)/;
const NO_CONFIRM = {
  'Fix all': 'it rewrites a plan nobody else has seen yet; spending alone never confirms',
  'ready-moved/Update branch': 'it merges into a branch only on this machine',
};
const everyAction = () => R.stateIds().flatMap((id) => Object.entries(R.actionFlow(id, CTX)).filter(([, f]) => f && typeof f === 'object').map(([label, f]) => ({ id, label, f })));

test('act.confirm: every action others see or cannot take back asks first', () => {
  for (const { id, label, f } of everyAction()) {
    if (!OTHERS_SEE.test(label) || NO_CONFIRM[label] || NO_CONFIRM[`${id}/${label}`]) continue;
    assert.ok(f.confirm || f.dialog || f.member, `${id}: ${label} goes ahead without asking`);
  }
  for (const l of ['stop', 'archive']) assert.ok(R.runFlow(CTX)[l].confirm, l);
  assert.equal(R.runFlow(CTX).report.dialog, 'report');
  assert.ok(!R.runFlow(CTX).pauseNow.confirm, 'Pause does not ask');
});

test('act.flow: a Fix shows a Fixing state first; a move says what happened; a Report takes a note; commands stay', () => {
  for (const { id, label, f } of everyAction()) {
    if (/^Fix /.test(label) && f.to) assert.match(f.to, /fixing/, `${id}: ${label} goes straight past a Fixing state`);
    if (/^Fix /.test(label)) assert.doesNotMatch(f.say || '', /\bfixed\b/, `${id}: ${label} says done before it is`);
    if (f.to) assert.ok(f.say, `${id}: ${label} moves on and says nothing`);
    if (/^Report/.test(label)) assert.equal(f.dialog, 'report', `${id}: ${label} takes a note`);
    assert.doesNotMatch(f.say || '', /^git /, `${id}: ${label} puts commands in a toast that fades`);
    if (f.to) assert.ok(R.stateIds().includes(f.to) || /-/.test(f.to) || f.to === 'discarded', `${id}: ${label} leads to ${f.to}`);
  }
  assert.equal(R.actionFlow('scheduled', CTX)['Delete task'].no, 'Keep');
  assert.ok(R.actionFlow('ready', CTX)['How to merge'].commands);
});

test('a table: a sentence on the narrow detail line carries no label', () => {
  const html = R.table({ label: 't', columns: [{ id: 'a', label: 'A' }, { id: 'why', label: 'Why', narrow: false, bare: true }, { id: 'n', label: 'Model', narrow: false }], rows: [{ a: 'x', why: 'Because', n: 'M' }] });
  assert.match(html, /rt-detail">Because · Model M</);
});

test('the main action is what the state needs, and a same-named main has one weight', () => {
  const main = (id) => R.runState(id, CTX).action.label;
  assert.equal(main('capped'), 'Raise the cap');
  assert.equal(main('ticket-failed'), 'Open project');
  assert.equal(main('auto-failed'), 'Sign in');
  assert.equal(main('pr-changes'), 'Fix requested changes');
  assert.equal(main('diverged'), 'Re-check');
  assert.equal(main('failed-kept'), 'Restart Build');
  assert.equal(main('ready-moved'), 'Update branch');
  assert.ok(R.runState('paused-limit', CTX).action.off['Resume now'], 'nothing resumes before the limit resets');
  assert.ok(!R.runState('ready', CTX).action.items.includes('Push main'), 'Push main is for a run on main');
  const weight = new Map();
  for (const id of R.stateIds()) { const a = R.runState(id, CTX).action; if (!a) continue;
    if (weight.has(a.label)) assert.equal(a.primary, weight.get(a.label), `${id}: ${a.label} changes weight`); else weight.set(a.label, a.primary); }
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

test('act.archive: Archive says what goes and what stays', () => {
  const f = R.actionFlow('interrupted', CTX).Archive;
  assert.match(f.confirm, /local branch, worktree and logs are removed; the remote branch and any PR stay/);
});

test('the step flow: Dialog, confirm, always working, then what perform promises: done or a failure in its words', async () => {
  const log = []; let confirmed = false; let shown = false; let end = { ok: true };
  const follow = R.stepFlow({ dialogShown: () => shown, openDialog: () => log.push('dialog'), confirmed: () => confirmed, askConfirm: () => log.push('ask'), working: (l) => log.push(R.workingWord(l)),
    perform: async () => { log.push('call'); if (end === 'throws') throw new Error('x'); return end; }, done: () => log.push('done'), failed: (l, e) => log.push(`${e.title} / ${e.detail}`) });
  await follow({ say: 'x', to: 'paused' }, 'Pause'); assert.deepEqual(log.splice(0), ['Pausing…', 'call', 'done']);   // no confirm: it still says what is happening
  await follow({ say: 'Would open it' }, 'View PR'); assert.deepEqual(log.splice(0), ['done']);   // a step that only says something: no working
  await follow({ dialog: 'pr' }, 'Create PR'); assert.deepEqual(log.splice(0), ['dialog']);
  shown = true; await follow({ dialog: 'pr' }, 'Create PR'); assert.deepEqual(log.splice(0), ['Creating…', 'call', 'done']);
  await follow({ confirm: 'Merge?' }, 'Merge PR'); assert.deepEqual(log.splice(0), ['ask']);
  confirmed = true; end = { ok: false, why: 'the branch moved' }; await follow({ confirm: 'Merge?' }, 'Merge PR');
  assert.deepEqual(log.splice(0), ['Merging…', 'call', 'Could not merge PR / The branch moved. Nothing changed.']);
  end = { ok: false, odd: true }; await follow({ confirm: 'Merge?' }, 'Merge PR');
  assert.match(log.at(-1), /Something went wrong on Worca’s side\. Nothing changed\.$/);
  end = 'throws'; log.splice(0); await follow({ confirm: 'Merge?' }, 'Merge PR');   // a call that rejects is a failure, never a stuck button
  assert.match(log.at(-1), /^Could not merge PR \/ Something went wrong/);
  assert.deepEqual(R.confirmOf({ confirm: 'Stop?' }, 'Stop the run'), { text: 'Stop?', yes: 'Stop', no: 'Cancel', danger: true });
  assert.equal(R.confirmOf({ confirm: 'Delete?', no: 'Keep' }, 'Delete run').no, 'Keep');
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
  assert.deepEqual(R.runState('paused-budget', CTX).action.items, ['Resume now']);   // a total budget: Settings, then Resume once there is room
  assert.ok(R.runState('paused-budget', CTX).action.off['Resume now']);
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

test('selection: toggle sets the anchor, unticking the last keeps selecting, a range adds from the anchor', () => {
  const shown = ['a', 'b', 'c', 'd'];
  let s = R.selectToggle(R.selectClear(), 'b');
  assert.deepEqual(s, { on: true, ids: ['b'], anchor: 'b' });
  assert.deepEqual(R.selectRange(s, shown, 'd').ids, ['b', 'c', 'd']);
  assert.equal(R.selectRange(s, shown, 'd').anchor, 'b', 'the anchor stays');
  assert.deepEqual(R.selectRange(s, shown, 'a').ids, ['b', 'a'], 'upwards too');
  assert.deepEqual(R.selectRange(R.selectClear(), shown, 'c'), { on: true, ids: ['c'], anchor: 'c' }, 'no anchor: a toggle');
  assert.equal(R.selectRange(s, shown, 'gone'), s, 'a row not shown: nothing');
  assert.deepEqual(R.selectToggle(s, 'b'), { on: true, ids: [], anchor: 'b' });
});

test('selection: all, clear, count, what Select all shows, and starting with nothing ticked', () => {
  const shown = ['a', 'b'];
  const s = R.selectAll(R.selectClear(), shown);
  assert.equal(R.selectCount(s, shown), 2);
  assert.equal(R.selectCount(s, ['a', 'z']), 1, 'counts what is shown');
  assert.equal(R.selectAllState(s, shown), 'all');
  assert.equal(R.selectAllState(R.selectToggle(R.selectClear(), 'a'), shown), 'some');
  assert.equal(R.selectAllState(R.selectStart(), shown), 'none');
  assert.deepEqual(R.selectStart(), { on: true, ids: [], anchor: '' });
  assert.deepEqual(R.selectPrune(s, ['b']).ids, ['b']);
  assert.equal(R.selectPrune(s, []).on, true, 'selecting goes on');
  assert.deepEqual(R.selectApply(s, 'clear'), R.selectClear());
});

test('selection: shift and an arrow extends from the row and stops at the ends', () => {
  const shown = ['a', 'b', 'c'];
  const one = R.selectExtend(R.selectClear(), shown, 'a', 1);
  assert.equal(one.to, 'b'); assert.deepEqual(one.pick.ids, ['a', 'b']); assert.equal(one.pick.anchor, 'a');
  const two = R.selectExtend(one.pick, shown, 'b', 1);
  assert.equal(two.to, 'c'); assert.deepEqual(two.pick.ids, ['a', 'b', 'c']);
  assert.equal(R.selectExtend(two.pick, shown, 'c', 1).to, 'c');
  assert.equal(R.selectExtend(R.selectClear(), [], '', 1).to, '');
});

test('selectionAction: a click or a press or a key to its action; a plain click opens', () => {
  const click = (o) => R.selectionAction({ click: true, ...o });
  assert.equal(click({}), null);
  assert.equal(click({ metaKey: true }), 'toggle');
  assert.equal(click({ ctrlKey: true }), 'toggle');
  assert.equal(click({ shiftKey: true }), 'range');
  assert.equal(click({ onBox: true }), 'toggle');
  assert.equal(click({ onBox: true, shiftKey: true }), 'range');
  assert.equal(click({ button: 1, metaKey: true }), null, 'a middle click stays the browser\'s');
  assert.equal(R.selectionAction({ press: true }), 'toggle');
  assert.equal(R.selectionAction({ click: true }, { selecting: true }), 'toggle', 'while selecting a plain click or tap ticks');
  assert.equal(R.selectionAction({ key: ' ', onRow: true }), 'toggle');
  assert.equal(R.selectionAction({ key: ' ' }), null, 'Space on a button stays the button\'s');
  assert.equal(R.selectionAction({ key: 'a', metaKey: true }), 'all');
  assert.equal(R.selectionAction({ key: 'a', ctrlKey: true }), 'all');
  assert.equal(R.selectionAction({ key: 'Escape' }), null, 'Esc only ends selecting while selecting');
  assert.equal(R.selectionAction({ key: 'Escape' }, { selecting: true }), 'clear');
  assert.equal(R.selectionAction({ key: 'ArrowDown', shiftKey: true }), 'extend-down');
});

test('keepFocus: the same row, else the next one still there, else the one before', () => {
  assert.equal(R.keepFocus(['a', 'b', 'c'], ['a', 'b', 'c'], 'b'), 'b');
  assert.equal(R.keepFocus(['a', 'b', 'c'], ['a', 'c'], 'b'), 'c');
  assert.equal(R.keepFocus(['a', 'b', 'c'], ['a'], 'c'), 'a');
  assert.equal(R.keepFocus(['a'], [], 'a'), '');
  assert.equal(R.keepFocus([], ['x'], 'a'), 'x');
});

test('shortcutAction: a list moves and opens; selecting adds its keys; a scope that is not named does nothing', () => {
  const list = { scopes: ['list', 'anywhere'] }, upd = { scopes: ['selecting', 'list', 'anywhere'] };
  for (const [key, want] of [['ArrowDown', 'down'], ['j', 'down'], ['J', 'down'], ['ArrowUp', 'up'], ['k', 'up']]) assert.equal(R.shortcutAction({ key }, list), want, key);
  assert.equal(R.shortcutAction({ key: 'Enter', onRow: true }, list), 'open');
  assert.equal(R.shortcutAction({ key: 'Enter' }, list), null, 'Enter on a button stays the button\'s');
  assert.equal(R.shortcutAction({ key: ' ', onRow: true }, list), null, 'a list with no selecting');
  assert.equal(R.shortcutAction({ key: 'a', metaKey: true }, list), null);
  assert.equal(R.shortcutAction({ key: ' ', onRow: true }, upd), 'toggle');
  assert.equal(R.shortcutAction({ key: 'a', metaKey: true }, upd), 'all');
  assert.equal(R.shortcutAction({ key: 'Escape' }, { ...upd, selecting: true }), 'clear');
  assert.equal(R.shortcutAction({ key: 'Escape' }, upd), 'close', 'not selecting: Esc closes');
  assert.equal(R.shortcutAction({ key: 'j', shiftKey: true }, list), null);
  assert.equal(R.shortcutAction({ key: 'j', metaKey: true }, list), null);
  assert.equal(R.shortcutAction({ key: 'j' }, { scopes: ['anywhere'] }), null);
});

test('shortcutAction: an action a list does not have does nothing and is not in its sheet', () => {
  assert.equal(R.shortcutAction({ key: 'e' }, { scopes: ['list'] }), null);
  assert.equal(R.shortcutAction({ key: 'e' }, { scopes: ['list'], can: ['archive'] }), 'archive');
  const labels = (can) => R.shortcutSections({ scopes: ['list'], can })[0].rows.map((r) => r.label);
  assert.ok(!labels([]).includes('Archive'));
  assert.ok(labels(['archive']).includes('Archive'));
});

test('shortcutAction: anywhere and the run page; ? takes Shift or not by layout; Ctrl-only stays Ctrl-only', () => {
  const any = { scopes: ['anywhere'] }, run = { scopes: ['run', 'anywhere'] };
  assert.equal(R.shortcutAction({ key: 'k', metaKey: true }, any), 'search');
  assert.equal(R.shortcutAction({ key: 'k', ctrlKey: true }, any), 'search');
  assert.equal(R.shortcutAction({ key: 'k' }, any), null);
  assert.equal(R.shortcutAction({ key: '?', shiftKey: true }, any), 'help');
  assert.equal(R.shortcutAction({ key: '?' }, any), 'help');
  assert.equal(R.shortcutAction({ key: 'l' }, run), 'labels');
  assert.equal(R.shortcutAction({ key: 'L', shiftKey: true }, run), null);
  assert.equal(R.shortcutAction({ key: '`', ctrlKey: true }, run), 'terminal');
  assert.equal(R.shortcutAction({ key: '`', metaKey: true }, run), null);
  for (const [key, want] of [['ArrowRight', 'next'], ['ArrowUp', 'prev'], ['Home', 'first'], ['End', 'last']]) assert.equal(R.shortcutAction({ key }, run), want, key);
});

test('keys never fire while typing: only Esc and a menu\'s own way out work in a field', () => {
  const all = { scopes: ['selecting', 'list', 'run', 'anywhere'], selecting: true, can: ['menu', 'fold', 'stop', 'archive', 'rename', 'pin', 'group', 'delete'] };
  assert.equal(R.shortcutAction({ key: 'k', ctrlKey: true, inField: true }, all), 'search', '⌘K reaches the search from the composer');
  for (const f of [{ key: '?' }, { key: 'j' }, { key: 'l' }, { key: ' ', onRow: true }, { key: 'a', metaKey: true }, { key: 'Enter', onRow: true }, { key: 'e' }, { key: '`', ctrlKey: true }, { key: 'Backspace' }]) {
    assert.ok(R.shortcutAction(f, all), `${f.key} acts out of a field`);
    assert.equal(R.shortcutAction({ ...f, inField: true }, all), null, `${f.key} acts in a field`);
  }
  const inField = R.SHORTCUTS.flatMap((s) => s.rows).filter((r) => r.inField).map((r) => r.do).sort();
  assert.deepEqual(inField, ['clear', 'close', 'first', 'focus-list', 'last', 'new-chat', 'next', 'prev', 'search', 'toggle-list']);
  assert.equal(R.shortcutAction({ key: 'Escape', inField: true }, { scopes: ['anywhere'] }), 'close');
  assert.equal(R.keyFacts({ key: 'j', target: { closest: (sel) => (sel === R.FIELD ? {} : null) } }).inField, true);
  assert.equal(R.keyFacts({ key: 'j', target: { closest: () => null } }, '.row').onRow, false);
});

test('no shortcut uses a combo the browser owns', () => {
  assert.ok(R.RESERVED.includes('mod+t'));
  for (const s of R.SHORTCUTS) for (const r of s.rows) for (const c of r.keys) assert.ok(!R.RESERVED.includes(R.chordId(c)), `${r.label}: ${c.join('+')} is the browser's`);
  assert.equal(R.chordId(['ctrl', 'T']), 'mod+t', 'Ctrl is the browser\'s too');
});

test('every row of the table: a label of 1 to 3 words, an action that is its own within its scope', () => {
  for (const s of R.SHORTCUTS) {
    const did = s.rows.map((r) => r.do);
    assert.equal(new Set(did).size, did.length, s.title);
    for (const r of s.rows) { assert.ok(r.label.split(' ').length <= 3, r.label); assert.ok(r.keys.length, r.label); }
  }
});

test('keyGlyph, keyHint and isMac: ⌘ on a Mac, Ctrl elsewhere', () => {
  assert.equal(R.keyGlyph('mod', true), '⌘');
  assert.equal(R.keyGlyph('mod', false), 'Ctrl');
  assert.equal(R.keyGlyph('ArrowUp', false), '↑');
  assert.equal(R.keyGlyph('j', false), 'J');
  assert.equal(R.keyHint(['mod', 'K'], true), '⌘K');
  assert.equal(R.keyHint(['mod', 'K'], false), 'Ctrl+K');
  assert.equal(R.isMac({ navigator: { platform: 'MacIntel' } }), true);
  assert.equal(R.isMac({ navigator: { platform: 'Win32' } }), false);
});

test('listMove: on by one, stopping at the ends; from nowhere, the first row', () => {
  assert.equal(R.listMove(['a', 'b'], 'a', 1), 'b');
  assert.equal(R.listMove(['a', 'b'], 'b', 1), 'b');
  assert.equal(R.listMove(['a', 'b'], 'a', -1), 'a');
  assert.equal(R.listMove(['a', 'b'], '', 1), 'a');
  assert.equal(R.listMove([], '', 1), '');
});

test('a project with no remote offers Link remote, never Create PR; a mock run offers nothing to ship', () => {
  assert.equal(R.runState('no-remote').action.label, 'Link remote');
  assert.ok(!R.runState('no-remote').action.items.includes('Create PR'));
  assert.equal(R.runState('mock-run').word, 'Mock task'); assert.equal(R.runState('mock-run').action, null);
});

test('sectionOf: a list reads a real case: Paused and Stopped are never Ready, and every state has its section', () => {
  for (const id of R.stateIds()) assert.ok(['needs', 'running', 'scheduled', 'recent'].includes(R.sectionOf(R.runState(id).word)), id);
  assert.equal(R.runState('paused').word, 'Paused'); assert.equal(R.sectionOf('Paused'), 'needs');
  assert.equal(R.runState('stopped').word, 'Stopped'); assert.equal(R.sectionOf('Stopped'), 'recent');
  assert.equal(R.sectionOf(R.runState('scheduled').word), 'scheduled');
});

test('chatState, bulkStateOf: a chat sorts Needs you, Running, Recent; an unknown one throws; a run\'s word to the bulk table', () => {
  assert.equal(R.chatState('needs-you').word, R.runState('question').word);
  assert.deepEqual(['needs-you', 'replying', 'command', 'following', 'idle'].map((s) => R.chatState(s).section), ['needs', 'running', 'running', 'running', 'recent']);
  assert.throws(() => R.chatState('nope'));
  assert.equal(R.planBulk('stop', [{ id: 'a', title: 'a', state: R.bulkStateOf(R.runState('working').word) }, { id: 'b', title: 'b', state: R.bulkStateOf(R.runState('stopped').word) }]).apply.length, 1);
  assert.equal(R.planBulk('archive', [{ id: 'a', title: 'a', state: R.bulkStateOf('Merged') }]).apply.length, 1);
});

test('selectStep: a selection key as one step', () => {
  const shown = ['a', 'b', 'c'];
  assert.deepEqual(R.selectStep(R.selectClear(), 'toggle', { from: 'a', shown }).pick.ids, ['a']);
  assert.deepEqual(R.selectStep(R.selectClear(), 'all', { shown }).pick.ids, shown);
  const ex = R.selectStep({ on: true, ids: ['a'], anchor: 'a' }, 'extend-down', { from: 'a', shown });
  assert.deepEqual([ex.pick.ids, ex.to], [['a', 'b'], 'b']);
});

test('shortcutAction: Chat has its own keys, and they work in a field', () => {
  assert.equal(R.shortcutAction({ key: '˜', code: 'KeyN', metaKey: true, altKey: true, inField: true }, { scopes: ['chat'] }), 'new-chat');
  assert.equal(R.shortcutAction({ key: '\\', metaKey: true }, { scopes: ['chat'] }), 'toggle-list');
  assert.equal(R.shortcutAction({ key: 'L', metaKey: true, shiftKey: true, inField: true }, { scopes: ['chat'] }), 'focus-list');
  assert.equal(R.shortcutAction({ key: 'ArrowUp', altKey: true }, { scopes: ['chat'] }), 'prev-chat');
  assert.equal(R.shortcutAction({ key: 'ArrowUp', altKey: true, inField: true }, { scopes: ['chat'] }), null);
});

test('dismissOnOutside: a click closes every layer it landed outside, Esc only the top one; a page can name what closes nothing', async () => {
  const { JSDOM } = await import('jsdom');
  const win = new JSDOM('<body><p id="page">p</p><div id="tools">t</div></body>').window, d = win.document;
  const click = (id) => d.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  let a = true, b = true;
  R.dismissOnOutside(d, { rank: 1, open: () => a, inside: '#none', close: () => { a = false; }, paint: () => {} });
  R.dismissOnOutside(d, { rank: 3, open: () => b, inside: '#none', close: () => { b = false; }, paint: () => {} });
  R.neverOutside(d, '#tools');
  click('tools'); assert.deepEqual([a, b], [true, true]);
  d.getElementById('page').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); assert.deepEqual([a, b], [true, false]);
  b = true; click('page'); assert.deepEqual([a, b], [false, false]);
});

test('dismissOnOutside: a click outside closes; inside never; a real control also acts; a Dialog keeps what was typed; Esc and focus', async () => {
  const { JSDOM } = await import('jsdom');
  const win = new JSDOM('<body><div id="pane"><i id="in"></i></div><button id="open">o</button><button id="other">x</button><p id="page">p</p><div id="dlg"><input id="f"></div><p id="scrim">s</p></body>', { pretendToBeVisual: true }).window, d = win.document;
  const click = (id) => d.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const esc = () => d.getElementById('page').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  let open = true, paints = 0, acted = 0, dlg = false;
  d.getElementById('other').addEventListener('click', () => { acted++; });
  d.getElementById('page').addEventListener('click', () => { acted += 100; });
  const off = R.dismissOnOutside(d, { open: () => open, inside: '#pane, #open', back: () => '#open', close: () => { open = false; }, paint: () => { paints++; } });
  R.dismissOnOutside(d, { dialog: true, open: () => dlg, inside: '#dlg', close: () => { dlg = false; }, paint: () => { paints++; } });
  click('in'); assert.equal(open, true, 'inside stays'); click('open'); assert.equal(open, true, 'its own button is its own');
  click('page'); assert.equal(open, false); assert.equal(acted, 0, 'a click on nothing does nothing else'); assert.equal(d.activeElement.id, 'open', 'the focus returns');
  open = true; click('other'); assert.equal(open, false); assert.equal(acted, 1, 'a real control acts as well'); assert.equal(paints, 2, 'and it paints');
  open = true; esc(); assert.equal(open, false, 'Esc closes');
  dlg = true; click('dlg'); assert.equal(dlg, true);
  click('scrim'); assert.equal(dlg, false, 'an untouched Dialog closes on its scrim');
  dlg = true; d.getElementById('f').dispatchEvent(new win.Event('input', { bubbles: true }));
  click('scrim'); assert.equal(dlg, true, 'typed text stays'); esc(); assert.equal(dlg, true, 'Esc too');
  off();
});

test('dismissOnOutside: an esc that returns a selector focuses it after the repaint; one that returns true repaints and keeps the layer', async () => {
  const { JSDOM } = await import('jsdom');
  const win = new JSDOM('<body><div id="pane"></div><p id="page">p</p></body>', { pretendToBeVisual: true }).window, d = win.document;
  const esc = () => d.getElementById('page').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  let open = true, closed = 0, paints = 0, step = '[data-menu-sub="anthropic"]';
  const pane = d.getElementById('pane');
  R.dismissOnOutside(d, { open: () => open, inside: '#pane', close: () => { closed++; open = false; }, esc: () => step, paint: () => { paints++; pane.innerHTML = '<button data-menu-sub="anthropic">Anthropic</button>'; } });
  esc();
  assert.equal(d.activeElement, d.querySelector('[data-menu-sub="anthropic"]'), 'the element drawn by the repaint takes the focus');
  assert.deepEqual([open, closed, paints], [true, 0, 1], 'the layer stays');
  step = true; esc();
  assert.deepEqual([open, closed, paints], [true, 0, 2], 'true: taken, repainted, kept');
  step = false; esc();
  assert.deepEqual([open, closed], [false, 1], 'nothing to take: it closes as before');
});

test('soundFor: what the choice says plays; info never; a burst once; never when away', () => {
  const needs = [{ sev: 'needs' }], problem = [{ sev: 'problem' }], info = [{ sev: 'info' }];
  assert.equal(R.soundFor({ events: needs }), true, 'what needs you is the default');
  assert.equal(R.soundFor({ events: problem }), false);
  assert.equal(R.soundFor({ choice: 'problems', events: problem }), true);
  assert.equal(R.soundFor({ choice: 'problems', events: needs }), true);
  for (const choice of ['needs', 'problems', 'none']) assert.equal(R.soundFor({ choice, events: info }), false, `info is silent on ${choice}`);
  assert.equal(R.soundFor({ choice: 'none', events: needs }), false);
  assert.equal(R.soundFor({ events: needs, away: true }), false);
  assert.equal(R.soundFor({ events: [...info, ...needs, ...needs] }), true, 'many at once are one sound');
  assert.equal(R.soundFor({ events: needs, at: 1000 + R.BURST_MS - 1, lastAt: 1000 }), false, 'the same burst');
  assert.equal(R.soundFor({ events: needs, at: 1000 + R.BURST_MS, lastAt: 1000 }), true);
  assert.deepEqual(R.SOUND_CHOICES.map((c) => c.id), ['needs', 'problems', 'none']);
});

test('playChime: two notes; quiet with no error when the browser blocks or has no Web Audio', () => {
  assert.equal(R.playChime({}), false, 'no Web Audio');
  const never = () => { throw new Error('must not open audio before the first click'); };
  assert.equal(R.playChime({ AudioContext: never, navigator: { userActivation: { hasBeenActive: false } } }), false);
  assert.equal(R.playChime({ AudioContext: function () { throw new Error('blocked'); } }), false, 'a throw stays inside');
  let notes = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class Ctx { currentTime = 0; destination = {}; resume() { return Promise.reject(new Error('blocked')); }
    createOscillator() { notes += 1; return { frequency: param(), connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: param(), connect() {} }; } }
  assert.equal(R.playChime({ AudioContext: Ctx, navigator: { userActivation: { hasBeenActive: true } } }), true);
  assert.equal(notes, 2);
});
