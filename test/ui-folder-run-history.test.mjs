// test/ui-folder-run-history.test.mjs — Projects, any way (P1b): a Folder project's saved run. Changes in place of
// Diff and Actions, no git chrome, the glance of board 10 (FolderRun.dc.html), Apply to folder and Discard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDetail, openDetail, deliverRows, settle, click, go, ROW, DETAIL, ok, fail, tabsOf, secOf, badgeOf } from './helpers/history-detail-boot.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

const ID = ROW.id;
const COUNTS = { added: 9, modified: 4, deleted: 1 };
const FROW = (over = {}) => ({ ...ROW, title: 'Rename receipts by date and vendor', projectName: 'Tax papers 2026', projectDir: '/tmp/tax',
  branch: null, sourceBranch: null, survived: false, workMode: 'folder', changes: { state: 'pending', counts: COUNTS }, ...over });
// P1a rowToState: the detail payload carries the mode and the changes on `state` (state.workMode, state.changes).
const FDETAIL = (over = {}, stateOver = {}) => ({ ...DETAIL,
  state: { ...DETAIL.state, title: 'Rename receipts by date and vendor', workMode: 'folder',
    branch: { workMode: 'folder', copyDir: `/tmp/worca/runs/${ID}/repos/tax` }, changes: { state: 'pending', counts: COUNTS }, ...stateOver },
  ...over });
const CHANGES = { state: 'pending', counts: { added: 1, modified: 1, deleted: 1 }, files: [
  { path: '2026-03/2026-03-12 Acme.pdf', change: 'added', size: 48213 },
  { path: 'index.csv', change: 'modified', size: 312 },
  { path: 'old/notes.txt', change: 'deleted', size: 5 }] };
const PATCH = ['diff --git a/index.csv b/index.csv', '--- a/index.csv', '+++ b/index.csv', '@@ -1,2 +1,2 @@', ' date,vendor', '-03-12,acme', '+2026-03-12,Acme',
  'diff --git a/old/notes.txt b/old/notes.txt', '--- a/old/notes.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-todo', ''].join('\n');
const PLAN = {
  target: '/Users/me/Documents/Tax papers 2026',
  add: ['2026-03/a.pdf', '2026-03/b.pdf', '2026-03/c.pdf', '2026-03/d.pdf', '2026-03/e.pdf', '2026-03/f.pdf', '2026-03/g.pdf', '2026-03/h.pdf', '2026-03/i.pdf'],
  update: ['index.csv', 'totals.csv', 'vendors.csv', '2026-03/receipt-0312.pdf'], delete: ['old/notes.txt'],
  skipped: [{ path: '2026-03/receipt-0312.pdf', reason: 'changed-in-folder' }],
};
const text = (body) => Promise.resolve({ ok: true, status: 200, text: async () => body });
function folderArms({ changes = () => ok(CHANGES), patch = () => text(PATCH), apply = () => ok({ applied: 13, skipped: PLAN.skipped }), discard = () => ok({ ok: true }) } = {}) {
  return (url, opts = {}) => {
    const u = url.split('?')[0];
    const base = `/api/runs/${ID}`;
    if (u.endsWith(`${base}/changes/patch`)) return patch();
    if (u.endsWith(`${base}/changes`)) return changes();
    if (u.endsWith(`${base}/apply-plan`)) return ok(PLAN);
    if (u.endsWith(`${base}/apply`) && opts.method === 'POST') return apply();
    if (u.endsWith(`${base}/discard`) && opts.method === 'POST') return discard();
    return null;
  };
}
const boot = (over = {}) => bootDetail({ rows: [FROW()], detail: FDETAIL(), arms: folderArms(), ...over });
const glanceRows = (doc) => [...doc.querySelectorAll('#hist-detail .hd-result .rd-srow')]
  .map((r) => [r.dataset.rdTab, (r.querySelector('.rd-srow-v') || { textContent: '' }).textContent]);

test('a folder run: Changes in place of Diff and Actions, at Simple level, the file count on its pill and its glance row', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  doc.documentElement.dataset.level = 'simple';
  await openDetail(ctx, 'details');
  assert.deepEqual(tabsOf(doc).map((b) => b.dataset.sec), ['overview', 'changes', 'workflow', 'agents']);
  const pill = doc.querySelector('#hist-detail .hd-tab[data-sec="changes"]');
  assert.equal(pill.dataset.minLevel, 'simple');
  assert.ok(pill.querySelector('svg'), 'the tab carries its icon');
  assert.equal(badgeOf(doc, 'changes'), '14');
  await openDetail(ctx, '');
  assert.deepEqual(glanceRows(doc), [['overview', ''], ['changes', '14 files'], ['workflow', '']]);
});

test('Changes tab: one row per file the run changed on its copy; a file opens in the diff pane', async () => {
  const small = { state: 'pending', counts: CHANGES.counts };
  const ctx = await boot({ rows: [FROW({ changes: small })], detail: FDETAIL({}, { changes: small }) });
  await openDetail(ctx, 'details/changes');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const sec = secOf(doc, 'changes');
  assert.ok(sec.querySelector('.fc-bar-host'), 'the Apply bar host leads the tab');
  assert.equal(sec.querySelector('.hd-diff-list-head .fc-counts').textContent, '+1 ~1 −1');
  const rows = [...sec.querySelectorAll('.rd-diff-row.fc-file')];
  assert.deepEqual(rows.map((b) => [b.dataset.change, b.querySelector('.fc-sign').textContent, b.querySelector('.rd-diff-row-path').textContent, b.getAttribute('aria-label')]), [
    ['added', '+', '2026-03/2026-03-12 Acme.pdf', 'Added 2026-03/2026-03-12 Acme.pdf'],
    ['modified', '~', 'index.csv', 'Updated index.csv'],
    ['deleted', '−', 'old/notes.txt', 'Deleted old/notes.txt']]);
  const pane = sec.querySelector('.hd-diff-pane');
  assert.ok(rows[0].classList.contains('active'), 'the first file opens');
  assert.equal(pane.querySelector('.hd-diff-path').textContent, '2026-03/2026-03-12 Acme.pdf');
  assert.equal(pane.querySelector('.hd-diff-note').textContent, '(no textual diff for this file)', 'a binary receipt');
  click(ctx.window, rows[1]);
  const kinds = [...pane.querySelectorAll('.hd-dl-row')].map((r) => [...r.classList].find((c) => /^hd-dl-(ctx|add|del)$/.test(c)));
  assert.deepEqual(kinds, ['hd-dl-ctx', 'hd-dl-del', 'hd-dl-add']);
  click(ctx.window, rows[2]);
  assert.deepEqual([...pane.querySelectorAll('.hd-dl-row')].map((r) => [...r.classList].find((c) => /^hd-dl-(ctx|add|del)$/.test(c))), ['hd-dl-del']);
  const urls = ctx.calls.map((c) => c.url);
  assert.ok(urls.includes(`/api/runs/${ID}/changes`) && urls.includes(`/api/runs/${ID}/changes/patch`));
  assert.ok(!urls.some((u) => /\/diff$|\/live-diff/.test(u)), 'a folder run never reads a git diff');
});

test('Changes tab empty states: nothing changed, not finished, a load failure', async () => {
  await checkRows([
    { name: 'no files', run: async () => {
      const ctx = await boot({ arms: folderArms({ changes: () => ok({ state: 'pending', counts: { added: 0 }, files: [] }) }) });
      await openDetail(ctx, 'details/changes');
      await settle(ctx.window, 4);
      assert.equal(secOf(ctx.window.document, 'changes').querySelector('.hd-diff-empty').textContent, 'No files changed');
    } },
    { name: 'a paused run has nothing to show yet and asks nothing', run: async () => {
      const ctx = await boot({ rows: [FROW({ status: 'paused' })], detail: FDETAIL({}, { status: 'paused' }) });
      await openDetail(ctx, 'details/changes');
      await settle(ctx.window, 4);
      assert.equal(secOf(ctx.window.document, 'changes').querySelector('.hd-diff-empty').textContent, 'No changes yet.');
      assert.ok(!ctx.calls.some((c) => c.url.includes('/changes')));
    } },
    { name: 'a refused read', run: async () => {
      const ctx = await boot({ arms: folderArms({ changes: () => fail(500, { error: 'boom' }) }) });
      await openDetail(ctx, 'details/changes');
      await settle(ctx.window, 4);
      assert.equal(secOf(ctx.window.document, 'changes').querySelector('.hist-empty').textContent, 'Could not load the changes: boom');
    } },
    { name: 'a git run keeps Diff and Actions and has no Changes', run: async () => {
      const ctx = await bootDetail();
      await openDetail(ctx, 'details');
      assert.deepEqual(tabsOf(ctx.window.document).map((b) => b.dataset.sec), ['overview', 'diff', 'actions', 'workflow', 'agents']);
    } },
  ]);
});

test('Changes tab: no changes.json yet — the 404 no changes reads No files changed', async () => {
  const ctx = await boot({ arms: folderArms({ changes: () => fail(404, { error: 'no changes' }) }) });
  await openDetail(ctx, 'details/changes');
  await settle(ctx.window, 4);
  assert.equal(secOf(ctx.window.document, 'changes').querySelector('.hd-diff-empty').textContent, 'No files changed');
});

test('Changes tab: a restored archived run (its changes.json went with the archive) says what became of its changes', async () => {
  const two = { added: 2, modified: 0, deleted: 0 };
  await checkRows([
    [{ state: 'discarded', counts: two }, 'These changes were discarded.'],
    [{ state: 'applied', counts: two }, 'These changes were already applied to the folder.'],
    [{ state: 'discarded', counts: { added: 0, modified: 0, deleted: 0 } }, 'No files changed'],
  ].map(([gone, text]) => ({ name: `${gone.state} ${gone.counts.added}`, run: async () => {
    const ctx = await boot({ rows: [FROW({ changes: gone })], detail: FDETAIL({}, { changes: gone }), arms: folderArms({ changes: () => fail(404, { error: 'no changes' }) }) });
    await openDetail(ctx, 'details/changes');
    await settle(ctx.window, 4);
    assert.equal(secOf(ctx.window.document, 'changes').querySelector('.hd-diff-empty').textContent, text);
  } })));
});

const FRESULTS = { summary: { filesNew: 1, filesChanged: 2, filesDeleted: 1, linesAdded: 1, linesRemoved: 2, blockingIssues: 0, nitpicks: 0 },
  newFiles: [{ path: '2026-03/2026-03-12 Acme.pdf', status: 'A', binary: true }],
  changedFiles: [{ path: 'index.csv', status: 'M', added: 1, removed: 1 }, { path: 'old/notes.txt', status: 'D', added: 0, removed: 1 }],
  keyThingsToCheck: [], nitpicks: [] };

test('the folder run glance (board 10): Ready · 14 files changed in a copy, time · cost · +9 ~4 −1 files changed, the Folder chip', async () => {
  const ctx = await boot();
  await openDetail(ctx, '');
  const doc = ctx.window.document;
  const g = doc.querySelector('#hist-detail .hd-glance');
  // Runs redesign: the one status block (run-model.mjs) words the run.
  // Slice 3: the card head words a pending copy, and the route has the folder path's 2 rows (s2).
  assert.equal(g.querySelector('.rd-now-top').dataset.word, 'Ready');
  assert.equal(g.querySelector('.rd-now-top').dataset.text, 'Ready · 14 files changed in a copy');
  const rows = g.querySelectorAll('.rd-route .rd-route-row');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].classList.contains('is-done'));
  const tile = [...doc.querySelectorAll('#hist-detail .rd-facts .rd-stats > div')].at(-1);
  assert.equal(tile.lastElementChild.textContent, 'files changed');
  assert.equal(tile.querySelector('b').className, 'fc-tile');
  assert.equal(tile.querySelector('b').textContent, '+9 ~4 −1');
  assert.equal(g.querySelector('.rd-page-meta .kind-chip.kind-folder').textContent, 'Folder');
  await deliverRows(ctx, [FROW()]);                                     // a second paint: the old chip must go
  assert.equal(g.querySelectorAll('.rd-page-meta .kind-chip').length, 1, 'one chip after every repaint');
});

test('a folder run shows no git chrome and asks git or a forge nothing', async () => {
  await checkRows([
    { name: 'glance and Details header', run: async () => {
      const ctx = await boot({ detail: FDETAIL({ results: FRESULTS }) });
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      const g = doc.querySelector('#hist-detail .hd-glance');
      assert.equal(g.querySelector('.rd-route .rd-route-copy'), null);
      assert.equal(g.querySelector('.rd-pr-slot').hidden, true);
      for (const sel of ['.hd-base', '.hd-branch-copy', '.hd-pr', '.hd-publish', '.hd-pr-link', '.hd-push', '.hd-base-check']) {
        assert.equal(doc.querySelector(`#hist-detail ${sel}`).hidden, true, sel);
      }
      assert.ok(!ctx.calls.some((c) => /\/publish|\/base-check|\/api\/pr\//.test(c.url)));
    } },
    { name: 'Overview: no Actions strip, no worktree row, files listed without Open the diff', run: async () => {
      const ctx = await boot({ detail: FDETAIL({ results: FRESULTS }) });
      await openDetail(ctx, 'details/overview');
      const sec = secOf(ctx.window.document, 'overview');
      assert.equal(sec.querySelector('.act-strip'), null);
      assert.equal(sec.querySelector('.hd-ov-wt'), null);
      const box = sec.querySelector('.hd-ov-files');
      assert.equal(box.querySelector('.hd-ov-label').textContent, 'Files changed · 3');
      assert.equal(box.querySelector('.link-btn'), null);
    } },
    { name: 'a deep link: the saved state names the mode before any row lands', run: async () => {
      const ctx = await boot({ rows: [] });
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-page-meta .kind-chip').textContent, 'Folder');
      assert.equal(doc.querySelector('#hist-detail .hd-base').hidden, true);
      await openDetail(ctx, 'details');
      assert.deepEqual(tabsOf(doc).map((b) => b.dataset.sec), ['overview', 'changes', 'workflow', 'agents']);
      assert.equal(badgeOf(doc, 'changes'), '14', 'the detail payload counts');
    } },
    { name: 'a git run keeps its glance', run: async () => {
      const ctx = await bootDetail();
      await openDetail(ctx, '');
      const g = ctx.window.document.querySelector('#hist-detail .hd-glance');
      assert.equal(g.querySelector('.rd-page-meta .kind-chip'), null);
      assert.ok(g.querySelector('.rd-route .rd-route-copy'));
    } },
    { name: 'a git run while git is missing: the same predicates (gitOn() && isGitRun) hide its chrome; the line names nothing hidden', run: async () => {
      const ctx = await bootDetail();
      ctx.window.document.documentElement.dataset.git = 'off';
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      const g = doc.querySelector('#hist-detail .hd-glance');
      assert.equal(g.querySelector('.rd-route .rd-route-copy'), null);
      assert.equal(g.querySelector('.rd-pr-slot').hidden, true);
      for (const sel of ['.hd-base', '.hd-branch-copy', '.hd-pr', '.hd-publish', '.hd-push']) assert.equal(doc.querySelector(`#hist-detail ${sel}`).hidden, true, sel);
      assert.equal(g.querySelector('.rd-now-top').dataset.text, 'Finished', 'not "Ready to ship": Ship it is hidden');
      assert.equal(g.querySelector('.rd-page-meta .kind-chip'), null, 'still a git run: no Folder chip');
      assert.ok(!ctx.calls.some((c) => /\/publish|\/base-check/.test(c.url)));
    } },
    { name: 'git comes back: the git run gets its chrome back without a reload (the onGitFlip re-read)', run: async () => {
      const ctx = await bootDetail();
      const doc = ctx.window.document;
      doc.documentElement.dataset.git = 'off';
      // s2 (D2): the head names the landing branch once the group lists answered; the hello loads them, as in the app.
      ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
      await openDetail(ctx, '');
      assert.equal(doc.querySelector('#hist-detail .hd-base').hidden, true);
      ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'git', git: { available: true } }) });
      await settle(ctx.window, 2);
      const g = doc.querySelector('#hist-detail .hd-glance');
      assert.equal(doc.querySelector('#hist-detail .hd-base').hidden, false);
      assert.ok(g.querySelector('.rd-route .rd-route-copy'));
      assert.equal(g.querySelector('.rd-now-top').dataset.text, 'Ready to ship · not in feat/log-ux yet');
    } },
    { name: 'git missing hides a git run\'s pull request link and slot (paintHdPr / the !gitChrome return)', run: async () => {
      const ctx = await bootDetail({ rows: [{ ...ROW, pr: { state: 'OPEN', url: 'https://github.com/a/b/pull/1' } }] });
      ctx.window.document.documentElement.dataset.git = 'off';
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      assert.equal(doc.querySelector('#hist-detail .hd-pr-link').hidden, true);
      assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-pr-slot').hidden, true);
    } },
  ]);
});

test('a folder run on a machine with gh shows no pull request placeholder', async () => {
  const ctx = await boot({ arms: (url, opts, box) => (url.endsWith('/api/history') ? ok({ pipelines: box.rows, ghAvailable: true }) : folderArms()(url, opts)) });
  await openDetail(ctx, '');
  const slot = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-pr-slot');
  assert.equal(slot.querySelector('.rd-pr-spin'), null, 'no Checking the pull request… spinner');
  assert.equal(slot.hidden, true);
});

test('git comes back: Publish is offered again (the paintHdPublish re-read)', async () => {
  const ctx = await bootDetail({ arms: (url) => (url.includes(`/api/runs/${ID}/publish`) ? ok({ members: [{ memberKey: ROW.projectKey, branch: ROW.branch, state: 'unpublished' }] }) : null) });
  const doc = ctx.window.document;
  doc.documentElement.dataset.git = 'off';
  await openDetail(ctx, '');
  assert.equal(doc.querySelector('#hist-detail .hd-publish').hidden, true);
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'git', git: { available: true } }) });
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('#hist-detail .hd-publish').hidden, false);
});

test('a git run while git is missing: no Actions strip or worktree row on Overview', async () => {
  const ctx = await bootDetail();
  ctx.window.document.documentElement.dataset.git = 'off';
  await openDetail(ctx, 'details/overview');
  const sec = secOf(ctx.window.document, 'overview');
  assert.equal(sec.querySelector('.act-strip'), null);
  assert.equal(sec.querySelector('.hd-ov-wt'), null);
});

test('a folder row that carries git-looking fields still shows no branch row and no pull request (the isGitRun half)', async () => {
  const ctx = await boot({ rows: [FROW({ branch: 'worca-cc/rename-fcec04e8', sourceBranch: 'main', survived: true, pr: null })],
    arms: (url, opts, box) => (url.endsWith('/api/history') ? ok({ pipelines: box.rows, ghAvailable: true }) : folderArms()(url, opts)) });
  await openDetail(ctx, '');
  const doc = ctx.window.document;
  for (const sel of ['.hd-base', '.hd-branch-copy', '.hd-pr']) assert.equal(doc.querySelector(`#hist-detail ${sel}`).hidden, true, sel);
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-route .rd-route-copy'), null);
});

// Slice 3 (D14): the glance's Apply bar is the card head's Discard · Apply to folder; the Changes tab keeps its bar.
const headOf = (doc) => doc.querySelector('#hist-detail .hd-glance .rd-head-acts');
const headBtn = (doc, id) => headOf(doc).querySelector(`[data-head="${id}"]`);
const headLabels = (doc) => [...headOf(doc).querySelectorAll('[data-head]')].map((b) => b.textContent);
const lineOf = (doc) => doc.querySelector('#hist-detail .hd-glance .rd-now-top').dataset.text;

test('the head\'s Apply on the glance and the bar on Changes; Apply to folder applies 13 files, toasts, and settles to Applied', async () => {
  const ctx = await boot();
  await openDetail(ctx, '');
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-apply-slot'), null, 'no Apply bar on the glance');
  assert.equal(lineOf(doc), 'Ready · 14 files changed in a copy');
  assert.deepEqual(headLabels(doc), ['Discard', 'Apply to folder']);
  assert.ok(headBtn(doc, 'apply-folder').classList.contains('btn-primary'));
  assert.doesNotMatch(doc.querySelector('#hist-detail .hd-glance .rd-sheet').textContent, /worktree/i);
  click(ctx.window, headBtn(doc, 'apply-folder'));
  await settle(ctx.window, 4);
  const modal = doc.querySelector('.fc-modal');
  assert.equal(modal.querySelector('.fc-go').textContent, 'Apply 13 files');
  click(ctx.window, modal.querySelector('.fc-go'));
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('.fc-modal'), null);
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Applied to folder', detail: '13 files · 1 skipped', action: '' });
  assert.deepEqual(headLabels(doc), [], 'nothing left to apply or discard');
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-now-top').dataset.word, 'Applied');
  ctx.window.localStorage.setItem('worca-cc.run.showRoute', '1');   // the applied route's rows, not its fold
  await deliverRows(ctx, ctx.box.rows);
  assert.deepEqual([...doc.querySelectorAll('#hist-detail .hd-glance .rd-route .rd-route-row')].map((x) => x.classList.contains('is-done')), [true, true]);
  ctx.window.localStorage.removeItem('worca-cc.run.showRoute');
  assert.deepEqual(ctx.calls.filter((c) => c.opts.method === 'POST' && c.url.includes(`/api/runs/${ID}/`)).map((c) => c.url), [`/api/runs/${ID}/apply`]);
  await openDetail(ctx, 'details/changes');
  await settle(ctx.window, 4);
  assert.equal(secOf(doc, 'changes').querySelector('.fc-bar-host .fc-bar-l').textContent, '14 files · Applied');
});

test('Discard asks once (destructive, no prose), discards and toasts; a refusal keeps the bar and offers Retry', async () => {
  await checkRows([
    { name: 'discarded', run: async () => {
      const ctx = await boot();
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      click(ctx.window, headBtn(doc, 'discard-folder'));
      await settle(ctx.window, 2);
      assert.equal(doc.querySelector('#confirm-title').textContent, 'Discard 14 files?');
      assert.ok(doc.querySelector('#confirm-title').classList.contains('danger'));
      assert.equal(doc.querySelector('#confirm-ok').textContent, 'Discard');
      assert.equal(doc.querySelector('#confirm-message').hidden, true);
      doc.querySelector('#confirm-ok').click();
      await settle(ctx.window, 6);
      assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Changes discarded', detail: '', action: '' });
      assert.deepEqual(headLabels(doc), []);
      assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-now-top').dataset.word, 'Discarded');
    } },
    { name: 'refused', run: async () => {
      const ctx = await boot({ arms: folderArms({ discard: () => fail(409, { error: 'The run has not finished.', code: 'RUN_NOT_FINISHED' }) }) });
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      click(ctx.window, headBtn(doc, 'discard-folder'));
      await settle(ctx.window, 2);
      doc.querySelector('#confirm-ok').click();
      await settle(ctx.window, 6);
      assert.deepEqual(lastToast(doc), { tone: 'err', title: 'Could not discard the changes', detail: 'The run has not finished.', action: 'Retry' });
      assert.deepEqual(headLabels(doc), ['Discard', 'Apply to folder']);
    } },
    { name: 'Cancel posts nothing', run: async () => {
      const ctx = await boot();
      await openDetail(ctx, '');
      const doc = ctx.window.document;
      click(ctx.window, headBtn(doc, 'discard-folder'));
      await settle(ctx.window, 2);
      doc.querySelector('#confirm-cancel').click();
      await settle(ctx.window, 2);
      assert.ok(!ctx.calls.some((c) => c.url.endsWith('/discard')));
    } },
  ]);
});

test('the head follows the server: another tab applied it; none while not finished; none for a git run', async () => {
  await checkRows([
    { name: 'pipelines-changed brings the settled row', run: async () => {
      const ctx = await boot();
      await openDetail(ctx, '');
      await deliverRows(ctx, [FROW({ changes: { state: 'applied', counts: COUNTS } })]);
      assert.equal(ctx.window.document.querySelector('#hist-detail .hd-glance .rd-now-top').dataset.word, 'Applied');
      assert.deepEqual(headLabels(ctx.window.document), []);
    } },
    { name: 'paused', run: async () => {
      const ctx = await boot({ rows: [FROW({ status: 'paused' })], detail: FDETAIL({}, { status: 'paused' }) });
      await openDetail(ctx, '');
      assert.equal(headBtn(ctx.window.document, 'apply-folder'), null);
    } },
    { name: 'git', run: async () => {
      const ctx = await bootDetail();
      await openDetail(ctx, '');
      assert.equal(headBtn(ctx.window.document, 'apply-folder'), null);
    } },
    { name: 'Escape in the Apply dialog closes it; the page stays on Changes', run: async () => {
      const ctx = await boot();
      await openDetail(ctx, 'details/changes');
      await settle(ctx.window, 4);
      const doc = ctx.window.document;
      click(ctx.window, secOf(doc, 'changes').querySelector('.fc-bar-host .fc-apply'));
      await settle(ctx.window, 4);
      doc.querySelector('.fc-modal .fc-cancel').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle(ctx.window, 3);
      assert.equal(doc.querySelector('.fc-modal'), null);
      assert.equal(ctx.window.location.hash, `#history/${ROW.projectKey}/${ID}/details/changes`);
    } },
  ]);
});

test('a deep link with no saved row yet: Apply settles the bar from the detail payload', async () => {
  const ctx = await boot({ rows: [] });
  await openDetail(ctx, '');
  const doc = ctx.window.document;
  click(ctx.window, headBtn(doc, 'apply-folder'));
  await settle(ctx.window, 4);
  click(ctx.window, doc.querySelector('.fc-modal .fc-go'));
  await settle(ctx.window, 6);
  assert.deepEqual(headLabels(doc), []);
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-now-top').dataset.word, 'Applied');
});

test('files the OS refused: Close on the result toasts warn with the counts', async () => {
  const result = { applied: 11, skipped: [PLAN.skipped[0], { path: 'totals.csv', reason: 'failed', message: 'EACCES: permission denied' },
    { path: '2026-03/i.pdf', reason: 'failed', message: 'ENOSPC: no space left on device' }] };
  const ctx = await boot({ arms: folderArms({ apply: () => ok(result) }) });
  await openDetail(ctx, '');
  const doc = ctx.window.document;
  click(ctx.window, headBtn(doc, 'apply-folder'));
  await settle(ctx.window, 4);
  click(ctx.window, doc.querySelector('.fc-modal .fc-go'));
  await settle(ctx.window, 6);
  click(ctx.window, doc.querySelector('.fc-modal .fc-cancel'));
  await settle(ctx.window, 4);
  assert.deepEqual(lastToast(doc), { tone: 'warn', title: 'Applied to folder', detail: '11 files · 1 skipped · 2 failed', action: '' });
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-now-top').dataset.word, 'Applied');
});

test('Retry on a refused discard asks again and posts again', async () => {
  const ctx = await boot({ arms: folderArms({ discard: () => fail(409, { error: 'The run has not finished.', code: 'RUN_NOT_FINISHED' }) }) });
  await openDetail(ctx, '');
  const doc = ctx.window.document;
  click(ctx.window, headBtn(doc, 'discard-folder'));
  await settle(ctx.window, 2);
  doc.querySelector('#confirm-ok').click();
  await settle(ctx.window, 6);
  doc.querySelector('#toasts .toast-act').click();
  await settle(ctx.window, 2);
  assert.equal(doc.querySelector('#confirm-title').textContent, 'Discard 14 files?');
  doc.querySelector('#confirm-ok').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/discard')).length, 2);
});

test('the Runs list in the app: the Folder chip lands when /api/projects answers after the rows; the row reads Applied', async () => {
  const PROJ = [{ name: 'Tax papers 2026', path: '/tmp/tax', exists: true, vcs: 'none', workMode: 'folder', key: ROW.projectKey }];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await bootDetail({ rows: [FROW({ changes: { state: 'applied', counts: COUNTS } })], detail: DETAIL, local: { 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'project', person: '' }) },
    arms: (url) => (url.includes('/api/projects') ? gate.then(() => ({ ok: true, status: 200, json: async () => ({ projects: PROJ }) })) : null) });
  go(ctx.window, 'runs');
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  const group = () => doc.querySelector(`#runs-list .runs-sec[data-section="project:${ROW.projectKey}"]`);   // View › Group by Project
  assert.equal(group().querySelector('.kind-chip'), null, 'no project row yet: no chip');
  assert.match(group().querySelector('.runs-row-sub').textContent, /^Applied/);
  release();
  await settle(ctx.window, 8);
  assert.equal(group().querySelector('.runs-sec-head .kind-chip').textContent, 'Folder');
});
