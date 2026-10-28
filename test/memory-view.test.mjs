// test/memory-view.test.mjs — pure jsdom tests for the Memory-view renderers (agent-memory-design.md §10).
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  formatWhen, renderHealthCard, renderFileList, renderEditor, collectEditor,
  renderMemoryHistory, MEMORY_NAME_HELP, parseSnapshotId, memorySource, patchRunRefs,
  MEMORY_TEAM_SUB, teamStateBadge, renderMemoryViews, renderTeamCard, renderTeamNotes, renderSeedReview,
  renderClashCompare, collectSeedDecisions, seedSummary, seedableCount, renderTeamAvailableLine, TEAM_AVAILABLE_TEXT,
} from '../ui/public/memory-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const HEALTH = { files: 2, bytes: 300, oversized: 0, overHard: 0, invalidFrontmatter: 0, alwaysOnBytes: 120, alwaysOnFiles: 1, writesSinceDefrag: 3, lastWriteAt: '2026-09-09T10:00:00.000Z', lastDefragAt: null, lastDefragRunId: null, level: 'ok', reasons: [] };
const REPORT = { scope: 'global', project: null, files: [], state: {}, health: HEALTH, defragRunId: null };
const HOST = { key: 'alpha-00000001', name: 'alpha' };
const PROJECT_REPORT = { ...REPORT, scope: 'projects/alpha-00000001', project: { key: 'alpha-00000001', name: 'alpha' } };

test('renderHealthCard: badge, reasons, counters, and the Defragment control in its three states', () => {
  const ok = renderHealthCard(REPORT, { doc, host: HOST });
  assert.ok(ok.classList.contains('card') && ok.classList.contains('mem-health'));
  assert.equal(ok.querySelector('.badge').textContent, 'Healthy');
  assert.ok(ok.querySelector('.badge').classList.contains('green'));
  assert.equal(ok.querySelector('.mem-reasons'), null, 'no reasons list when there are none');
  assert.match(ok.querySelector('.mem-counters').textContent, /2 files · 300 bytes · 120 bytes always loaded · 3 writes since the last defragment/);
  const btn = ok.querySelector('.mem-defrag');
  assert.equal(btn.disabled, false); assert.equal(btn.textContent, 'Defragment');
  assert.equal(btn.dataset.runId, undefined, 'no run to open');
  assert.equal(ok.querySelector('.mem-host-hint').textContent, 'Runs on alpha. Pick another project on the New run page.');
  const due = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'due', reasons: ['12 memory writes since the last defragment (due at 10)', '1 file over the 8192-byte soft cap: big.md'] } }, { doc, host: HOST });
  assert.deepEqual([...due.querySelectorAll('.mem-reasons li')].map((li) => li.textContent), ['12 memory writes since the last defragment (due at 10)', '1 file over the 8192-byte soft cap: big.md']);
  // A live defragment: ONE control (spec §10) — still enabled, it opens the run.
  const live = renderHealthCard({ ...REPORT, defragRunId: 'abc-123' }, { doc, host: HOST });
  const liveBtn = live.querySelector('.mem-defrag');
  assert.equal(liveBtn.disabled, false);
  assert.equal(liveBtn.dataset.runId, 'abc-123');
  assert.equal(liveBtn.textContent, 'Open run');
  assert.match(live.querySelector('.mem-counters').textContent, / · defragmenting now$/, 'the state stays in the line');
  assert.equal(live.querySelector('.mem-run'), null, 'no second control');
  const failing = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'failing', failedWrites: 2, reasons: ['2 memory writes by runs failed since the last defragment — last in run abc12345; that run\'s History detail carries the reason'] } }, { doc, host: HOST });
  assert.equal(failing.querySelector('.badge').textContent, 'Writes failing');
  assert.ok(failing.querySelector('.badge').classList.contains('red'));
  assert.match(failing.querySelector('.mem-counters').textContent, / · 2 failed writes$/);
  assert.ok(!/failed write/.test(ok.querySelector('.mem-counters').textContent), 'no failed-write counter when there are none');
  const hostile = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'due', reasons: ['<img src=x onerror=1>'] } }, { doc, host: HOST });
  assert.equal(hostile.querySelector('img'), null, 'reasons are text, never markup');
});

test('renderHealthCard: the global scope needs a host project; a project scope never does', () => {
  const noHost = renderHealthCard(REPORT, { doc, host: null });
  const btn = noHost.querySelector('.mem-defrag');
  assert.equal(btn.disabled, true);
  assert.equal(noHost.querySelector('.mem-host-hint').textContent, 'Register a project on the Projects page to host the global defragment run.');
  assert.equal(btn.title, 'Register a project on the Projects page to host the global defragment run.');
  const proj = renderHealthCard(PROJECT_REPORT, { doc, host: null });
  assert.equal(proj.querySelector('.mem-defrag').disabled, false, 'a project defragment runs on that project');
  assert.equal(proj.querySelector('.mem-host-hint'), null, 'no host line for a project scope');
});

test('renderFileList: the main block of a row is the control; name, hook and meta; the selected row is .on; empty ⇒ hist-empty', () => {
  const files = [
    { name: 'testing', description: 'How the suite runs', paths: ['test/**'], source: 'user', updated: '2026-09-09T10:00:00.000Z', bytes: 120, hasFrontmatter: true },
    { name: 'style', description: '<b>bold</b>', paths: [], source: 'run:abcd1234', updated: '', bytes: 40, hasFrontmatter: false },
  ];
  const el = renderFileList(files, { doc, selected: 'style' });
  const rows = [...el.querySelectorAll('.mem-row')];
  assert.deepEqual(rows.map((r) => r.dataset.name), ['testing', 'style']);
  assert.equal(rows[0].querySelector('.mem-row-name').textContent, 'testing.md');
  assert.equal(rows[0].querySelector('.mem-row-hook').textContent, 'How the suite runs');
  const main0 = rows[0].querySelector('.mem-row-main');
  assert.equal(main0.getAttribute('role'), 'button');
  assert.equal(main0.tabIndex, 0, 'reachable by keyboard');
  assert.equal(main0.querySelector('button, a'), null, 'no interactive descendant inside role=button');
  assert.equal(rows[0].querySelector('.mem-row-meta').textContent, `${formatWhen(files[0].updated)} · you`);
  assert.equal(rows[1].querySelector('.mem-row-meta').textContent, 'a run · no frontmatter', 'no date: only the source');
  assert.doesNotMatch(rows[0].querySelector('.mem-row-meta').textContent, /no frontmatter/);
  assert.equal(rows[1].querySelector('b'), null, 'hooks are text');
  assert.equal(rows[1].querySelector('.mem-row-hook').textContent, '<b>bold</b>');
  assert.ok(rows[1].classList.contains('on') && !rows[0].classList.contains('on'));
  assert.ok(el.querySelector('.mem-new'));
  const empty = renderFileList([], { doc });
  assert.ok(empty.querySelector('.hist-empty'));
  assert.ok(empty.querySelector('.mem-new'));
});

const RAW = [/run[:-][0-9a-f]{8}/, /\d{8}-\d{6}-run-/];
const runInfo = (pid) => (pid === 'cc3b6fce' ? { title: 'Fix login redirect', href: '#history/alpha-00000001/cc3b6fce' }
  : pid === 'dd000001' ? { title: '', href: '#history/alpha-00000001/dd000001' } : null);

test('parseSnapshotId: UTC stamp, source slug and same-second suffix', () => {
  const s = parseSnapshotId('20261020-054609-run-773718c3');
  assert.equal(s.iso, '2026-10-20T05:46:09.000Z');
  assert.deepEqual(s.source, { kind: 'run', ref: '773718c3' });
  assert.deepEqual(parseSnapshotId('20261020-054609-defrag-ab000001-02').source, { kind: 'run', ref: 'ab000001' });
  assert.deepEqual(parseSnapshotId('20260909-100000-user').source, { kind: 'user', ref: '' });
  assert.deepEqual(parseSnapshotId('20260909-100000-ask-ask_1234abcd').source, { kind: 'chat', ref: 'ask_1234abcd' });
  assert.equal(parseSnapshotId('garbage').iso, '');
});

test('memorySource: run and defrag are runs; user is you; ask is a chat; anything else is Worca', () => {
  assert.deepEqual(memorySource('run:cc3b6fce'), { kind: 'run', ref: 'cc3b6fce' });
  assert.deepEqual(memorySource('defrag:cc3b6fce'), { kind: 'run', ref: 'cc3b6fce' });
  assert.deepEqual(memorySource('user'), { kind: 'user', ref: '' });
  assert.deepEqual(memorySource('ask:ask_1234abcd'), { kind: 'chat', ref: 'ask_1234abcd' });
  assert.deepEqual(memorySource('restore:x'), { kind: 'other', ref: '' });
});

test('renderFileList: meta is the date then the run title as a link; ids only in the tooltip', () => {
  const files = [
    { name: 'testing', description: 'x', source: 'run:cc3b6fce', updated: '2026-09-09T10:00:00.000Z', hasFrontmatter: true },
    { name: 'style', description: 'y', source: 'run:ee000001', updated: '2026-09-09T10:00:00.000Z', hasFrontmatter: false },
    { name: 'traps', description: 'z', source: 'user', updated: '2026-09-09T10:00:00.000Z', hasFrontmatter: true },
  ];
  const el = renderFileList(files, { doc, runInfo });
  const [a, b, c] = [...el.querySelectorAll('.mem-row-meta')];
  assert.equal(a.textContent, `${formatWhen(files[0].updated)} · Fix login redirect`);
  assert.equal(a.querySelector('a').getAttribute('href'), '#history/alpha-00000001/cc3b6fce');
  assert.equal(a.title, 'run:cc3b6fce');
  assert.equal(b.textContent, `${formatWhen(files[1].updated)} · a run · no frontmatter`);
  assert.equal(b.querySelector('a'), null, 'no row known: plain words, no link');
  assert.equal(c.textContent, `${formatWhen(files[2].updated)} · you`);
  for (const m of [a, b, c]) for (const re of RAW) assert.doesNotMatch(m.textContent, re);
  const row = el.querySelector('.mem-row');
  assert.equal(row.getAttribute('role'), null, 'the row is not the control any more');
  const main = row.querySelector('.mem-row-main');
  assert.equal(main.getAttribute('role'), 'button');
  assert.equal(main.tabIndex, 0);
  assert.equal(main.querySelector('a, button'), null, 'no interactive descendant inside role=button');
});

test('renderMemoryHistory: date and time, run title link, file count; raw id only in title and data-id', () => {
  const el = renderMemoryHistory([{ id: '20261020-054609-run-cc3b6fce', files: ['a.md', 'b.md'] },
    { id: '20261020-060000-run-dd000001', files: ['a.md'] }], { doc, runInfo });
  const rows = [...el.querySelectorAll('.mem-snap')];
  assert.equal(rows[0].dataset.id, '20261020-060000-run-dd000001', 'newest first');
  assert.equal(rows[0].title, '20261020-060000-run-dd000001');
  assert.equal(rows[0].querySelector('.mem-snap-when').textContent, formatWhen('2026-10-20T06:00:00.000Z'));
  assert.equal(rows[0].querySelector('.mem-snap-src a').textContent, 'a run', 'known row, empty title');
  assert.equal(rows[0].querySelector('.mem-snap-src a').getAttribute('aria-label'), 'Open this run');
  assert.equal(rows[1].querySelector('.mem-snap-src a').textContent, 'Fix login redirect');
  assert.equal(rows[1].querySelector('.mem-snap-src a').getAttribute('aria-label'), null);
  for (const r of rows) for (const re of RAW) assert.doesNotMatch(r.textContent, re);
  const garbage = renderMemoryHistory([{ id: 'garbage', files: ['a.md'] }], { doc, runInfo });
  assert.equal(garbage.querySelector('.mem-snap-when').textContent, '', 'an unparsable id has no date');
  assert.equal(garbage.querySelector('.mem-snap-src'), null, 'and no source: only the count shows');
});

test('patchRunRefs: a name that lands later replaces "a run" in place', () => {
  const el = renderMemoryHistory([{ id: '20261020-054609-run-cc3b6fce', files: [] }], { doc, runInfo: () => null });
  assert.equal(el.querySelector('.mem-snap-src').textContent, 'a run');
  patchRunRefs(el, runInfo, { doc });
  assert.equal(el.querySelector('.mem-snap-src a').textContent, 'Fix login redirect');
});

test('renderEditor / collectEditor: an existing file is name-locked with Delete; a new one is name-editable without it; the text is a value, never parsed', () => {
  const file = { name: 'testing', text: '---\nname: testing\n---\n<img src=x>\n', meta: { name: 'testing' }, body: '<img src=x>\n' };
  const ed = renderEditor(file, { doc });
  assert.equal(ed.querySelector('.mem-name').value, 'testing');
  assert.equal(ed.querySelector('.mem-name').readOnly, true);
  assert.equal(ed.querySelector('.mem-text').value, file.text);
  assert.equal(ed.querySelector('.mem-text').childNodes.length, 0, 'the text is a value, not a child node');
  assert.equal(ed.querySelector('img'), null);
  assert.ok(ed.querySelector('.mem-save') && ed.querySelector('.mem-cancel') && ed.querySelector('.mem-delete'));
  assert.equal(ed.querySelector('.mem-msg').getAttribute('role'), 'status');
  assert.equal(ed.querySelector('.mem-msg').getAttribute('aria-live'), null, 'role=status is already polite');
  assert.equal(ed.querySelector('.mem-save').disabled, false);
  ed.querySelector('.mem-text').value = 'edited\n';
  assert.deepEqual(collectEditor(ed), { name: 'testing', text: 'edited\n' });
  const fresh = renderEditor({ name: '', text: '' }, { doc, isNew: true, msg: 'pick a name', msgErr: true });
  assert.equal(fresh.querySelector('.mem-name').readOnly, false);
  assert.equal(fresh.querySelector('.mem-delete'), null);
  assert.equal(fresh.querySelector('.mem-text').value, '---\nname: \ndescription: \n---\n', 'a new file starts from the frontmatter stub');
  assert.equal(fresh.querySelector('.mem-msg').textContent, 'pick a name');
  assert.ok(fresh.querySelector('.mem-msg').classList.contains('err'));
  assert.equal(fresh.querySelector('.mem-name-help').textContent, MEMORY_NAME_HELP);
  assert.match(MEMORY_NAME_HELP, /letters, digits/);
  fresh.querySelector('.mem-name').value = '  new-topic ';
  assert.equal(collectEditor(fresh).name, 'new-topic');
});

test('locked (a defragment run is live on this scope): Save, Delete and Restore are disabled', () => {
  const ed = renderEditor({ name: 'testing', text: 'x\n' }, { doc, locked: true });
  assert.equal(ed.querySelector('.mem-save').disabled, true);
  assert.equal(ed.querySelector('.mem-delete').disabled, true);
  assert.equal(ed.querySelector('.mem-cancel').disabled, false, 'closing the editor is always allowed');
  assert.match(ed.querySelector('.mem-msg').textContent, /defragment run is live/);
  const hist = renderMemoryHistory([{ id: '20260909-100000-user', files: ['a.md'] }], { doc, locked: true });
  assert.equal(hist.querySelector('.mem-restore').disabled, true);
});

const TEAM = {
  enabled: true, branch: 'worca-memory', counts: { local: 2, shared: 1, blocked: 1 }, notes: [], seed: { offer: 'pending', last: null },
  remote: { exists: true, headSha: 'abcdef1234', fetchedAt: '2026-10-17T10:00:00.000Z', lastSyncAt: null, lastError: 'remote: error: GH006: Protected branch update failed for refs/heads/worca-memory.',
    lastErrorAt: '2026-10-17T10:05:00.000Z', hint: 'exempt `worca-memory` from branch protection in the repository rules — Worca pushes to it directly, without a pull request', lastFetchError: null },
};

test('Team view basics: the hash segment is never a note name; the badge table; the Notes | Team control', () => {
  assert.equal(MEMORY_TEAM_SUB, '~team');
  assert.equal(encodeURIComponent(MEMORY_TEAM_SUB), MEMORY_TEAM_SUB);
  assert.deepEqual(['shared', 'held', 'blocked', 'nope'].map((s) => teamStateBadge(s).text), ['Shared', 'Held', 'Blocked', 'Local only']);
  const seg = renderMemoryViews('team', { doc });
  assert.deepEqual([...seg.querySelectorAll('.mem-view')].map((b) => [b.dataset.view, b.getAttribute('aria-selected')]), [['notes', 'false'], ['team', 'true']]);
});

test('renderTeamCard: the switch, the branch line, a push error with 1a\'s hint, the counts, the one-time offer — then the plain button and Undo', () => {
  const off = renderTeamCard({ enabled: false, branch: 'worca-memory', seed: { offer: 'pending', last: null } }, { doc });
  const pressed = (card) => [...card.querySelectorAll('.mem-team-load')].map((b) => [b.dataset.load, b.getAttribute('aria-pressed')]);
  assert.deepEqual(pressed(off), [['local', 'true'], ['team', 'false'], ['both', 'false']], 'off is Local');
  assert.match(off.querySelector('.hint').textContent, /^Runs and chats load this machine's notes only/);
  assert.equal(off.querySelector('.mem-team-sync'), null, 'off: nothing else');
  const on = renderTeamCard(TEAM, { doc });
  assert.deepEqual(pressed(on), [['local', 'false'], ['team', 'false'], ['both', 'true']], 'on without a load (an older server) is Both');
  const only = renderTeamCard({ ...TEAM, load: 'team', caps: { teamMaxFiles: 30 } }, { doc });
  assert.deepEqual(pressed(only), [['local', 'false'], ['team', 'true'], ['both', 'false']]);
  assert.match(only.querySelector('.hint').textContent, /^Runs and chats load the team's notes only — your shared notes and teammates', newest 30/);
  assert.match(on.querySelector('.mem-team-sync-text').textContent, /^Branch worca-memory at abcdef1 · fetched \d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.match(on.querySelector('.mem-team-error').textContent, /Last push failed \(.+\): remote: error: GH006/);
  assert.match(on.querySelector('.mem-team-hint').textContent, /^To fix: exempt `worca-memory` from branch protection/);
  assert.equal(on.querySelector('.mem-team-counts').textContent, '1 shared · 2 local only · 1 blocked');
  assert.ok(on.querySelector('.mem-team-offer .mem-team-seed') && on.querySelector('.mem-team-offer .mem-team-dismiss'));
  assert.equal(seedableCount(TEAM), 2);
  const done = renderTeamCard({ ...TEAM, seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 'x', shared: 2, tookTeam: 1, held: 1 } } }, { doc });
  assert.equal(done.querySelector('.mem-team-offer'), null);
  assert.equal(done.querySelector('.mem-team-seed').textContent, 'Share existing notes…');
  assert.ok(done.querySelector('.mem-team-undo'));
  // busy: a request of the view is on its way — every control waits for it (a second Undo would answer "Not undone").
  const controls = (card) => [...card.querySelectorAll('button, input')].map((c) => [[...c.classList].find((k) => k.startsWith('mem-team-')), c.disabled]);
  const loads = [['mem-team-load', true], ['mem-team-load', true], ['mem-team-load', true]];
  assert.deepEqual(controls(renderTeamCard(TEAM, { doc, busy: true })), [...loads, ['mem-team-sync', true], ['mem-team-seed', true], ['mem-team-dismiss', true]]);
  assert.deepEqual(controls(renderTeamCard({ ...TEAM, seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 'x', shared: 2, tookTeam: 1, held: 1 } } }, { doc, busy: true })),
    [...loads, ['mem-team-sync', true], ['mem-team-seed', true], ['mem-team-undo', true]]);
});

test('renderTeamNotes: one label per state (a tracked copy reads Shared), why a note is blocked, a push error, Compare and Remove from team where they apply', () => {
  const list = renderTeamNotes({ notes: [
    { name: 'a', state: 'shared', local: true, team: true, behind: false, author: 'Ana', updated: null },
    { name: 'b', state: 'blocked', local: true, team: false, reason: 'line 4: an email address', findings: [{ rule: 'email', label: 'an email address', field: 'body', line: 4 }] },
    { name: 'c', state: 'pending', local: true, team: false, error: 'PUSH_REJECTED' },
    { name: 'd', state: 'held', local: true, team: true },
    { name: 'e', state: 'local', local: true, team: false, shadows: true },
    { name: 'f', state: 'team', local: false, team: true, mounted: false, author: 'Ana' },
  ] }, { doc });
  const row = (n) => list.querySelector(`.mem-team-row[data-name="${n}"]`);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => row(n).querySelector('.badge').textContent), ['Shared', 'Blocked', 'Pending push', 'Held', 'Local only', 'Team only']);
  assert.match(row('b').querySelector('.mem-team-detail').textContent, /line 4: an email address/);
  assert.equal(row('b').querySelector('.mem-team-findings li').textContent, 'an email address — line 4');
  assert.match(row('c').querySelector('.mem-team-detail').textContent, /PUSH_REJECTED/);
  assert.deepEqual(['d', 'e', 'a'].map((n) => !!row(n).querySelector('.mem-team-compare')), [true, true, false]);
  assert.deepEqual(['a', 'f', 'b'].map((n) => !!row(n).querySelector('.mem-team-remove')), [true, true, false]);
  assert.match(row('f').querySelector('.mem-team-detail').textContent, /not loaded into runs/);
  const busy = renderTeamNotes({ notes: [{ name: 'd', state: 'held', local: true, team: true }, { name: 'f', state: 'team', local: false, team: true, mounted: true }] }, { doc, busy: true });
  assert.deepEqual([...busy.querySelectorAll('button')].map((b) => [[...b.classList].find((k) => k.startsWith('mem-team-')), b.disabled]),
    [['mem-team-compare', true], ['mem-team-remove', true]], 'busy: every action waits');
});

test('renderTeamNotes copy: a team-only delete promises no local copy; a copy the team no longer holds says so; a push error is one line (m10)', () => {
  const list = renderTeamNotes({ notes: [
    { name: 'mine', state: 'deleting', local: true, team: true },
    { name: 'theirs', state: 'deleting', local: false, team: true, error: 'remote: refused\nremote: more detail' },
    { name: 'gone', state: 'shared', local: true, team: false, behind: true },
    { name: 'newer', state: 'shared', local: true, team: true, behind: true },
    { name: 'wait', state: 'pending', local: true, team: false, error: 'fatal: first\nsecond' },
  ] }, { doc });
  const detail = (n) => list.querySelector(`.mem-team-row[data-name="${n}"] .mem-team-detail`).textContent;
  assert.match(detail('mine'), /Your local copy stays here\.$/);
  assert.equal(detail('theirs'), 'Being removed from the team — the last push failed (remote: refused).');
  assert.match(detail('gone'), /^No longer on the team/);
  assert.match(detail('newer'), /^The team has a newer version/);
  assert.equal(detail('wait'), 'Waiting to be pushed — the last push failed (fatal: first).');
});

test('renderTeamNotes in Team mode: a local copy that does not load says so — the team\'s version of a clash is the one loaded', () => {
  const list = renderTeamNotes({ enabled: true, load: 'team', notes: [
    { name: 'mine', state: 'local', local: true, team: false, mounted: false },
    { name: 'clash', state: 'local', local: true, team: false, shadows: true, mounted: false },
    { name: 'held', state: 'held', local: true, team: true, mounted: false },
    { name: 'old', state: 'shared', local: true, team: true, mounted: false },
    { name: 'kept', state: 'shared', local: true, team: true, mounted: true },
  ] }, { doc });
  const detail = (n) => list.querySelector(`.mem-team-row[data-name="${n}"] .mem-team-detail`).textContent;
  assert.equal(detail('mine'), 'On this machine only. Not loaded into runs: Team loads team notes only.');
  assert.match(detail('clash'), /the team's is the one loaded here \(Team loads team notes only\)/);
  assert.match(detail('held'), /Not loaded into runs: Team loads team notes only\.$/);
  assert.match(detail('old'), /Not loaded into runs: over the team note cap\.$/);
  assert.doesNotMatch(detail('kept'), /Not loaded/);
  const both = renderTeamNotes({ enabled: true, load: 'both', notes: [{ name: 'mine', state: 'local', local: true, team: false, mounted: false }] }, { doc });
  assert.equal(both.querySelector('.mem-team-detail').textContent, 'On this machine only.', 'Both: every local note loads');
});

test('renderTeamCard off: a switch that cannot turn on is disabled with one line saying why — no repository copy for a Folder project (m11)', () => {
  const card = (startError) => renderTeamCard({ enabled: false, branch: 'worca-memory', seed: { offer: 'pending', last: null }, canStart: !startError, startError }, { doc });
  const ok = card(null);
  const disabled = (card) => [...card.querySelectorAll('.mem-team-load')].map((b) => b.disabled);
  assert.deepEqual(disabled(ok), [false, false, false]);
  assert.match(ok.querySelector('.hint').textContent, /worca-memory branch of its repository/);
  const folder = card({ code: 'FOLDER_PROJECT', message: 'team memory needs a git project: …' });
  assert.deepEqual(disabled(folder), [false, true, true], 'Team and Both could never turn on; Local stays picked');
  assert.equal(folder.querySelector('.mem-team-cannot').textContent, 'Team memory needs a git project: this is a Folder project.');
  assert.doesNotMatch(folder.textContent, /repository/);
  assert.match(card({ code: 'NO_ORIGIN', message: 'x' }).querySelector('.mem-team-cannot').textContent, /needs an origin remote/);
  assert.deepEqual(disabled(renderTeamCard({ enabled: false, branch: 'worca-memory', seed: {}, canStart: null, startError: null }, { doc })), [false, false, false],
    'no checkout known here (canStart null): the choice says why when it is tried');
});

test('renderSeedReview + collectSeedDecisions: nothing ticked; clashes default to Skip; Keep mine off for a blocked version, Take team off when too big; blocked notes listed', () => {
  const pv = { fetchedAt: '2026-10-17T10:00:00.000Z', fetchError: null, notes: [
    { name: 'alpha', state: 'local', hash: 'a'.repeat(40), description: 'Read first', blocked: null, team: null },
    { name: 'leaky', state: 'local', hash: 'b'.repeat(40), description: 'On-call', blocked: { reason: 'line 4: an email address', findings: [] }, team: null },
    { name: 'build', state: 'held', hash: 'c'.repeat(40), description: 'Build', blocked: null, text: '---\nname: build\n---\nMine.\n',
      team: { name: 'build', hash: 'd'.repeat(40), text: '---\nname: build\n---\nTheirs.\n', author: 'Ana', updated: null, same: false, tooBig: false } },
    { name: 'oncall', state: 'local', hash: 'e'.repeat(40), description: 'Paging', blocked: { reason: 'line 2: an email address', findings: [] }, text: 'x\n',
      team: { name: 'Oncall', hash: 'f'.repeat(40), text: 'y\n', same: false, tooBig: true } },
  ] };
  const box = renderSeedReview(pv, { doc });
  assert.equal(box.querySelector('.mem-seed-check[data-name="alpha"]').checked, false, 'nothing leaves the machine unless picked');
  assert.equal(box.querySelector('.mem-seed-check[data-name="leaky"]'), null);
  assert.match(box.querySelector('.mem-seed-blocked').textContent, /leaky\.md[\s\S]*line 4: an email address/);
  const build = box.querySelector('.mem-seed-clash[data-name="build"]');
  assert.equal(build.querySelector('input[value="skip"]').checked, true, 'never overwrite silently');
  assert.ok(build.querySelector('.mem-cmp-mine .mem-cmp-diff'), 'the differing line is marked');
  const oncall = box.querySelector('.mem-seed-clash[data-name="oncall"]');
  assert.deepEqual(['share', 'take-team'].map((v) => oncall.querySelector(`input[value="${v}"]`).disabled), [true, true]);
  assert.deepEqual(collectSeedDecisions(box), [
    { name: 'build', action: 'skip', hash: 'c'.repeat(40), teamHash: 'd'.repeat(40) },
    { name: 'oncall', action: 'skip', hash: 'e'.repeat(40), teamHash: 'f'.repeat(40) },
  ]);
  doc.body.appendChild(box);   // jsdom fires a checkbox's change on click() only when it is connected — as the dialog body is
  box.querySelector('.mem-seed-all').click();
  build.querySelector('input[value="take-team"]').click();
  assert.deepEqual(collectSeedDecisions(box).map((d) => [d.name, d.action]), [['alpha', 'share'], ['build', 'take-team'], ['oncall', 'skip']]);
  box.remove();
  const rows = (o) => ({ notes: Object.entries(o).map(([name, state]) => ({ name, state })) });
  assert.equal(seedSummary({ shared: ['a', 'b'], tookTeam: ['c'], held: [], blocked: [{ name: 'd' }], status: rows({ a: 'shared', b: 'shared' }) }),
    '2 notes shared · 1 replaced by the team\'s version · 1 blocked by the secret check');
  // What the push did, as the returned status shows it: on the team, still waiting (the push failed, or another push
  // carries it), or refused by the remote's secret scanning.
  assert.equal(seedSummary({ shared: ['a', 'e', 'f'], tookTeam: [], held: ['b'], blocked: [], status: rows({ a: 'pending', e: 'shared', f: 'blocked' }) }),
    '1 note shared · 1 note waiting to be pushed · 1 held · 1 blocked by the secret check');
});

test('renderSeedReview: a note recorded BLOCKED is listed as blocked even when the team holds its name — never a clash, never in the checklist, never a decision', () => {
  const pv = { fetchedAt: '2026-10-17T10:00:00.000Z', fetchError: null, notes: [
    { name: 'oncall', state: 'blocked', hash: 'e'.repeat(40), description: 'Paging', blocked: { reason: 'the remote refused it', findings: [] }, text: 'x\n',
      team: { name: 'oncall', hash: 'f'.repeat(40), text: 'y\n', same: false, tooBig: false } },
    { name: 'odd', state: 'blocked', hash: '1'.repeat(40), description: 'A verdict with no findings', blocked: null, team: null },
  ] };
  const box = renderSeedReview(pv, { doc });
  assert.deepEqual([box.querySelector('.mem-seed-clash'), box.querySelector('.mem-seed-check')], [null, null]);
  assert.match(box.querySelector('.mem-seed-blocked').textContent, /oncall\.md[\s\S]*the remote refused it[\s\S]*odd\.md/);
  assert.deepEqual(collectSeedDecisions(box), []);
});

test('E10: the Overview line — one sentence, Turn on (primary) and Not now (quiet), no dialog; the Team view says the branch is there', () => {
  const line = renderTeamAvailableLine({ doc });
  assert.ok(line.classList.contains('mem-team-offer') && line.classList.contains('mem-team-available'));
  assert.equal(line.querySelector('span').textContent, 'Your team shares memory for this repository');
  const [on, later] = line.querySelectorAll('button');
  assert.deepEqual([on.textContent, on.className], ['Turn on', 'btn btn-primary btn-sm mem-team-turn-on']);
  assert.deepEqual([later.textContent, later.className], ['Not now', 'btn btn-sm btn-quiet mem-team-not-now']);
  assert.ok([on, later].every((b) => b.type === 'button' && !b.disabled));
  assert.ok([...renderTeamAvailableLine({ doc, busy: true }).querySelectorAll('button')].every((b) => b.disabled));
  const off = renderTeamCard({ enabled: false, branch: 'worca-memory', seed: { offer: 'pending', last: null }, available: { branchOnOrigin: true, state: 'pending', offer: true } }, { doc });
  assert.ok(off.querySelector('.hint').textContent.startsWith(`${TEAM_AVAILABLE_TEXT}: its worca-memory branch is on origin.`));
  const plain = renderTeamCard({ enabled: false, branch: 'worca-memory', seed: { offer: 'pending', last: null }, available: { branchOnOrigin: false } }, { doc });
  assert.ok(!plain.querySelector('.hint').textContent.includes(TEAM_AVAILABLE_TEXT));
});
