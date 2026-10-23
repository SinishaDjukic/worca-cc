// test/ui-folder-changes.test.mjs — Projects, any way (P1b): folder-changes.mjs (counts, words, the Apply bar,
// the Apply to folder dialog, Discard) and run-glance's headline for a finished folder run.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  filesWord, changesCounts, folderDoneWords, applyBarModel, renderCountsNode, renderApplyBar, paintApplyBar,
  runChangesUrl, openApplyDialog, discardChanges, CHANGE_SIGN, CHANGE_WORD,
} from '../ui/public/folder-changes.mjs';
import { glanceCopy } from '../ui/public/run-glance.mjs';

const trackDom = useDomRelease(afterEach);
const COUNTS = { added: 9, modified: 4, deleted: 1 };
const PENDING = { state: 'pending', counts: COUNTS };
const tick = () => new Promise((r) => setTimeout(r, 0));
const mkDoc = () => trackDom(new JSDOM('<!doctype html><html><body><button id="opener">Apply to folder</button></body></html>'));
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const PLAN = {
  target: '/Users/me/Documents/Tax papers 2026', displayTarget: '~/Documents/Tax papers 2026',
  add: ['2026-03/a.pdf', '2026-03/b.pdf', '2026-03/c.pdf', '2026-03/d.pdf', '2026-03/e.pdf', '2026-03/f.pdf', '2026-03/g.pdf', '2026-03/h.pdf', '2026-03/i.pdf'],
  update: ['index.csv', 'totals.csv', 'vendors.csv', '2026-03/receipt-0312.pdf'],
  delete: ['old/notes.txt'],
  skipped: [{ path: '2026-03/receipt-0312.pdf', reason: 'changed-in-folder' }],
};
const planFetch = (calls, { plan = PLAN, apply = () => json(200, { applied: 13, skipped: PLAN.skipped }) } = {}) => (url, opts = {}) => {
  calls.push([opts.method || 'GET', url]);
  if (url.endsWith('/apply-plan')) return typeof plan === 'function' ? plan() : json(200, plan);
  if (url.endsWith('/apply')) return apply();
  return json(404, { error: 'no route' });
};
const keydown = (win, node, key, shiftKey = false) => node.dispatchEvent(new win.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

test('counts and words read like the canvas', () => {
  assert.deepEqual(changesCounts(PENDING), { added: 9, modified: 4, deleted: 1, total: 14 });
  assert.deepEqual(changesCounts({ state: 'pending', counts: { added: 2 } }), { added: 2, modified: 0, deleted: 0, total: 2 });
  assert.equal(changesCounts(null), null);
  assert.equal(changesCounts({ state: 'pending' }), null);
  assert.deepEqual([filesWord(0), filesWord(1), filesWord(13)], ['0 files', '1 file', '13 files']);
  assert.deepEqual(folderDoneWords('pending', 14), { lead: 'Finished', sub: '14 files changed' });
  assert.deepEqual(folderDoneWords('applied', 1), { lead: 'Applied', sub: '1 file changed' });
  assert.deepEqual(folderDoneWords('discarded', 14), { lead: 'Discarded', sub: '14 files changed' });
  assert.deepEqual(folderDoneWords('pending', 0), { lead: 'Finished', sub: 'No files changed' });
  assert.deepEqual(folderDoneWords('discarded', 0), { lead: 'Finished', sub: 'No files changed' }, 'a run that changed nothing was never discarded');
  assert.deepEqual(folderDoneWords(undefined, null), { lead: 'Finished', sub: '' });
  assert.deepEqual(CHANGE_SIGN, { added: '+', modified: '~', deleted: '−' });
  assert.deepEqual(CHANGE_WORD, { added: 'Added', modified: 'Updated', deleted: 'Deleted' });
  const doc = mkDoc().window.document;
  const n = renderCountsNode(doc, COUNTS);
  assert.equal(n.className, 'fc-counts mono');
  assert.equal(n.textContent, '+9 ~4 −1');
  assert.deepEqual([...n.children].map((c) => c.className), ['fc-add', 'fc-upd', 'fc-del']);
});

test('glanceCopy: a finished folder run is Finished / Applied / Discarded, never a pull request word', () => {
  const done = { status: 'done', steps: [] };
  const pick = (c) => [c.lead, c.sub, c.icon];
  assert.deepEqual(pick(glanceCopy(done, { files: 14, pr: 'PENDING', checks: 0, changes: { state: 'pending' } })), ['Finished', '14 files changed', 'finished']);
  assert.deepEqual(pick(glanceCopy(done, { files: 14, changes: { state: 'applied' } })), ['Applied', '14 files changed', 'finished']);
  assert.deepEqual(pick(glanceCopy(done, { files: 14, changes: { state: 'discarded' } })), ['Discarded', '14 files changed', 'finished']);
  assert.deepEqual(pick(glanceCopy(done, { files: 0, changes: { state: 'discarded' } })), ['Finished', 'No files changed', 'finished'], 'a run that changed nothing');
  assert.equal(glanceCopy(done, { files: 14, pr: 'NONE', checks: 0 }).lead, 'Ready to ship', 'a git run keeps its words');
  assert.equal(glanceCopy({ status: 'stopped', steps: [] }, { changes: { state: 'pending' } }).lead, 'Stopped');
});

test('glanceCopy: a git run while git is missing names no hidden control (gitChrome false)', () => {
  const done = { status: 'done', steps: [] };
  const pick = (c) => [c.lead, c.sub];
  assert.deepEqual(pick(glanceCopy(done, { files: null, pr: 'UNAVAILABLE', gitChrome: false })), ['Finished', '']);
  assert.deepEqual(pick(glanceCopy(done, { files: 3, pr: 'PENDING', checks: null, gitChrome: false })), ['Finished', '3 files changed']);
  assert.deepEqual(pick(glanceCopy(done, { files: 0, pr: 'NONE', checks: 0, gitChrome: false })), ['Finished', 'No files changed']);
  assert.equal(glanceCopy(done, { pr: 'MERGED', gitChrome: false }).lead, 'Merged', 'a PR fact stays a fact');
  assert.equal(glanceCopy(done, { files: null, pr: 'UNAVAILABLE' }).sub, 'Review the changes in Diff', 'with git it is unchanged');
  assert.equal(glanceCopy({ status: 'starting', steps: [] }, { workMode: 'folder' }).sub, 'Copying the folder');
  assert.equal(glanceCopy({ status: 'starting', steps: [] }, { workMode: 'none' }).sub, '');   // S29: P3's 'none' run reads no worktree words
  assert.equal(glanceCopy({ status: 'starting', steps: [] }, {}).sub, 'Setting up the worktree');
});

test('applyBarModel: a finished run with changes on its copy; only the state word once it is settled', () => {
  assert.deepEqual(applyBarModel({ status: 'done', changes: PENDING }), { state: 'pending', label: '14 files · on a copy', actions: true });
  assert.deepEqual(applyBarModel({ status: 'stopped', changes: { state: 'pending', counts: { added: 1 } } }), { state: 'pending', label: '1 file · on a copy', actions: true });
  assert.deepEqual(applyBarModel({ status: 'done', changes: { ...PENDING, state: 'applied' } }), { state: 'applied', label: '14 files · Applied', actions: false });
  assert.deepEqual(applyBarModel({ status: 'error', changes: { ...PENDING, state: 'discarded' } }), { state: 'discarded', label: '14 files · Discarded', actions: false });
  for (const status of ['running', 'starting', 'paused', 'pausing', 'interrupted']) assert.equal(applyBarModel({ status, changes: PENDING }), null, status);
  assert.equal(applyBarModel({ status: 'done', changes: { state: 'pending', counts: { added: 0 } } }), null, 'nothing changed: nothing to apply');
  assert.equal(applyBarModel({ status: 'done', changes: null }), null);
});

test('the Apply bar: Discard · ink Apply to folder as real buttons; a settled run keeps only its line; no rebuild while unchanged', () => {
  const doc = mkDoc().window.document;
  const calls = [];
  const bar = renderApplyBar(doc, applyBarModel({ status: 'done', changes: PENDING }), { onApply: () => calls.push('apply'), onDiscard: () => calls.push('discard') });
  assert.equal(bar.className, 'fc-bar');
  assert.equal(bar.getAttribute('role'), 'group');
  assert.equal(bar.getAttribute('aria-label'), 'Changes');
  assert.equal(bar.querySelector('.fc-bar-l').textContent, '14 files · on a copy');
  assert.equal(bar.querySelector('.fc-bar-l svg').getAttribute('aria-hidden'), 'true');
  assert.deepEqual(['width', 'height', 'fill'].map((k) => bar.querySelector('.fc-bar-l svg').getAttribute(k)), ['16', '16', 'none'], 'style.css has no .ico: the glyph sizes itself');
  const btns = [...bar.querySelectorAll('.fc-bar-r button')];
  assert.deepEqual(btns.map((b) => [b.type, b.className, b.textContent]),
    [['button', 'btn fc-discard', 'Discard'], ['button', 'btn btn-primary fc-apply', 'Apply to folder']]);
  btns[1].click();
  btns[0].click();
  assert.deepEqual(calls, ['apply', 'discard']);
  const settled = renderApplyBar(doc, applyBarModel({ status: 'done', changes: { ...PENDING, state: 'applied' } }), {});
  assert.equal(settled.querySelector('.fc-bar-r'), null);
  assert.equal(settled.textContent, '14 files · Applied');
  const host = doc.createElement('div');
  paintApplyBar(host, applyBarModel({ status: 'done', changes: PENDING }), {});
  const first = host.firstElementChild;
  paintApplyBar(host, applyBarModel({ status: 'done', changes: PENDING }), {});
  assert.equal(host.firstElementChild, first, 'an unchanged bar is not rebuilt (a press would lose its release)');
  assert.equal(host.hidden, false);
  paintApplyBar(host, null, {});
  assert.equal(host.hidden, true);
  assert.equal(host.childElementCount, 0);
  paintApplyBar(host, applyBarModel({ status: 'done', changes: PENDING }), {});
  assert.equal(host.querySelector('.fc-bar-l').textContent, '14 files · on a copy', 'a bar hidden and shown again is rebuilt');
  const hits = [];
  const reused = doc.createElement('div');
  paintApplyBar(reused, applyBarModel({ status: 'done', changes: PENDING }), { onApply: () => hits.push('run 1') });
  paintApplyBar(reused, applyBarModel({ status: 'done', changes: PENDING }), { onApply: () => hits.push('run 2') });
  reused.querySelector('.fc-apply').click();
  assert.deepEqual(hits, ['run 2'], 'a host reused for another run with the same model calls that run\'s handler');
});

test('runChangesUrl: the key-free run routes by pipeline id, memberKey for a workspace member', () => {
  assert.equal(runChangesUrl('fcec04e8', 'changes'), '/api/runs/fcec04e8/changes');
  assert.equal(runChangesUrl('fcec04e8', 'changes/patch'), '/api/runs/fcec04e8/changes/patch');
  assert.equal(runChangesUrl('fcec04e8', 'apply-plan', { memberKey: 'tax-papers-1a2b3c4d' }), '/api/runs/fcec04e8/apply-plan?memberKey=tax-papers-1a2b3c4d');
  assert.equal(runChangesUrl('a b', 'discard'), '/api/runs/a%20b/discard');
});

test('Apply to folder dialog (board 10): the folder, Add / Update / Delete, the skipped file inside it, Apply 13 files', async () => {
  const win = mkDoc().window;
  const doc = win.document;
  const calls = [];
  const opener = doc.getElementById('opener');
  opener.focus();
  const done = openApplyDialog({ doc, fetch: planFetch(calls), pipelineId: 'fcec04e8', opener });
  const modal = doc.querySelector('.fc-modal');
  assert.deepEqual([modal.getAttribute('role'), modal.getAttribute('aria-modal')], ['dialog', 'true']);
  assert.ok(modal.classList.contains('viewer-modal') && modal.classList.contains('confirm-modal'), 'the app modal shell');
  assert.equal(doc.getElementById(modal.getAttribute('aria-labelledby')).textContent, 'Apply to folder');
  const go = modal.querySelector('.fc-go');
  assert.deepEqual([go.textContent, go.disabled], ['Apply to folder', true], 'nothing to apply until the plan lands');
  assert.ok(modal.querySelector('.fc-dlg.dlg > .dlg-head .fc-dlg-title') && modal.querySelector('.fc-dlg.dlg > .dlg-body .fc-plan') && modal.querySelector('.fc-dlg.dlg > .dlg-foot .fc-go'), 'the shared dialog anatomy');
  assert.equal(modal.querySelector('.fc-loading').textContent, 'Loading…');
  await tick(); await tick();
  assert.equal(modal.querySelector('.fc-loading'), null);
  assert.equal(modal.querySelector('.fc-target').textContent, '~/Documents/Tax papers 2026', 'the home-relative folder (board 10)');
  assert.deepEqual([...modal.querySelectorAll('.fc-plan-row')].map((r) => [r.querySelector('.fc-sign').textContent, r.querySelector('.fc-plan-w').textContent, r.querySelector('.fc-plan-n').textContent]),
    [['+', 'Add', '9 files'], ['~', 'Update', '4 files'], ['−', 'Delete', '1 file']]);
  assert.equal(modal.querySelector('.fc-skipped').hidden, false);
  assert.equal(modal.querySelector('.fc-skipped-h').textContent, 'Changed in the folder since the run started');
  assert.deepEqual([...modal.querySelectorAll('.fc-sfile')].map((li) => [li.querySelector('.fc-sfile-path').textContent, li.querySelector('.fc-skip').textContent]),
    [['2026-03/receipt-0312.pdf', 'Skipped']]);
  assert.deepEqual([...modal.querySelectorAll('.fc-foot button')].map((b) => [b.textContent, b.disabled]), [['Cancel', false], ['Apply 13 files', false]]);
  go.click();
  assert.equal(go.textContent, 'Applying…');
  assert.equal(modal.querySelector('.fc-cancel').disabled, true, 'no cancel while the files are being written');
  assert.deepEqual(await done, { applied: 13, skipped: PLAN.skipped });
  assert.deepEqual(calls, [['GET', '/api/runs/fcec04e8/apply-plan'], ['POST', '/api/runs/fcec04e8/apply']]);
  assert.equal(doc.querySelector('.fc-modal'), null);
  assert.equal(doc.activeElement, opener, 'focus goes back to the button that opened it');
});

test('Apply to folder dialog: keyboard, scrim and every error stay inside the dialog', async () => {
  await checkRows([
    { name: 'Escape is the dialog\'s alone: a document capture listener (the run pages\' Escape) never sees it', run: async () => {
      const win = mkDoc().window; const doc = win.document; const page = [];
      doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') page.push('back'); }, true);
      const done = openApplyDialog({ doc, fetch: planFetch([]), pipelineId: 'p1' });
      await tick(); await tick();
      keydown(win, doc.querySelector('.fc-cancel'), 'Escape');
      assert.equal(await done, null);
      assert.deepEqual(page, [], 'the page under the dialog does not step back');
    } },
    { name: 'Tab cycles inside, Escape cancels and posts nothing', run: async () => {
      const win = mkDoc().window; const doc = win.document; const calls = [];
      const done = openApplyDialog({ doc, fetch: planFetch(calls), pipelineId: 'p1' });
      await tick(); await tick();
      const cancel = doc.querySelector('.fc-cancel'); const go = doc.querySelector('.fc-go');
      assert.equal(doc.activeElement, cancel, 'opens on Cancel');
      go.focus(); keydown(win, go, 'Tab');
      assert.equal(doc.activeElement, cancel, 'Tab from the last button wraps to the first');
      keydown(win, cancel, 'Tab', true);
      assert.equal(doc.activeElement, go, 'Shift+Tab from the first wraps to the last');
      keydown(win, go, 'Escape');
      assert.equal(await done, null);
      assert.equal(doc.querySelector('.fc-modal'), null);
      assert.deepEqual(calls.map((c) => c[0]), ['GET']);
    } },
    { name: 'a scrim click cancels', run: async () => {
      const win = mkDoc().window; const doc = win.document;
      const done = openApplyDialog({ doc, fetch: planFetch([]), pipelineId: 'p1' });
      doc.querySelector('.fc-modal').dispatchEvent(new win.Event('click', { bubbles: true }));
      assert.equal(await done, null);
    } },
    { name: 'a refused apply says why inside the dialog and lets the person try again', run: async () => {
      const win = mkDoc().window; const doc = win.document;
      let settled = false;
      const done = openApplyDialog({ doc, pipelineId: 'p1',
        fetch: planFetch([], { apply: () => json(409, { error: 'The folder is missing: /Users/me/Documents/Tax papers 2026', code: 'FOLDER_MISSING' }) }) });
      done.then(() => { settled = true; });
      await tick(); await tick();
      doc.querySelector('.fc-go').click();
      await tick(); await tick();
      const err = doc.querySelector('.fc-err');
      assert.deepEqual([err.hidden, err.textContent, err.getAttribute('role')], [false, 'The folder is missing: /Users/me/Documents/Tax papers 2026', 'alert']);
      assert.deepEqual([doc.querySelector('.fc-go').textContent, doc.querySelector('.fc-go').disabled, doc.querySelector('.fc-cancel').disabled], ['Apply 13 files', false, false]);
      assert.equal(settled, false, 'the dialog stays open');
      doc.querySelector('.fc-cancel').click();
      assert.equal(await done, null);
    } },
    { name: 'a refusal a retry cannot fix (already settled, copy gone, changes gone) keeps Apply disabled', run: async () => {
      for (const [code, error] of [['CHANGES_SETTLED', 'These changes were already applied to the folder.'], ['COPY_MISSING', 'The run\'s copy is gone.'],
        ['NO_CHANGES', 'The run\'s changes are gone.']]) {
        const win = mkDoc().window; const doc = win.document;
        const done = openApplyDialog({ doc, pipelineId: 'p1', fetch: planFetch([], { apply: () => json(code === 'NO_CHANGES' ? 404 : 409, { error, code }) }) });
        await tick(); await tick();
        doc.querySelector('.fc-go').click();
        await tick(); await tick();
        assert.equal(doc.querySelector('.fc-err').textContent, error, code);
        assert.deepEqual([doc.querySelector('.fc-go').textContent, doc.querySelector('.fc-go').disabled, doc.querySelector('.fc-cancel').disabled], ['Apply 13 files', true, false], code);
        doc.querySelector('.fc-cancel').click();
        assert.equal(await done, null, code);
      }
    } },
    { name: 'files the OS refused stay in the dialog (S55): Failed with its reason beside Skipped; Close returns the result', run: async () => {
      const win = mkDoc().window; const doc = win.document;
      const result = { applied: 11, skipped: [PLAN.skipped[0], { path: 'totals.csv', reason: 'failed', message: 'EACCES: permission denied' },
        { path: '2026-03/i.pdf', reason: 'failed', message: 'ENOSPC: no space left on device' }] };
      const done = openApplyDialog({ doc, pipelineId: 'p1', fetch: planFetch([], { apply: () => json(200, result) }) });
      await tick(); await tick();
      doc.querySelector('.fc-go').focus();   // jsdom's click() moves no focus: without this the Close-focus check below could not fail
      doc.querySelector('.fc-go').click();
      await tick(); await tick();
      const modal = doc.querySelector('.fc-modal');
      assert.ok(modal, 'the dialog stays open on its result');
      assert.equal(modal.querySelector('.fc-skipped-h').textContent, 'Not applied');
      assert.deepEqual([...modal.querySelectorAll('.fc-sfile')].map((li) => [li.querySelector('.fc-sfile-path').textContent,
        li.querySelector('.fc-skip').textContent, (li.querySelector('.fc-sfile-msg') || { textContent: '' }).textContent]), [
        ['2026-03/receipt-0312.pdf', 'Skipped', ''],
        ['totals.csv', 'Failed', 'EACCES: permission denied'],
        ['2026-03/i.pdf', 'Failed', 'ENOSPC: no space left on device']]);
      assert.ok(modal.querySelector('.fc-sfile .fc-skip.fc-fail'), 'a failed file wears the Failed chip');
      assert.equal(modal.querySelector('.fc-go'), null, 'nothing left to apply');
      assert.equal(modal.querySelector('.fc-plan'), null, 'the plan rows go with the button');
      const close = modal.querySelector('.fc-cancel');
      assert.deepEqual([close.textContent, close.disabled, doc.activeElement === close], ['Close', false, true]);
      keydown(win, close, 'Escape');
      assert.deepEqual(await done, result, 'Escape on a result returns it');
    } },
    { name: 'a plan that cannot be read: the reason, nothing to apply', run: async () => {
      const win = mkDoc().window; const doc = win.document;
      openApplyDialog({ doc, pipelineId: 'p1', fetch: planFetch([], { plan: () => json(404, { error: 'The copy is gone.' }) }) });
      await tick(); await tick();
      assert.equal(doc.querySelector('.fc-err').textContent, 'The copy is gone.');
      assert.deepEqual([doc.querySelector('.fc-go').textContent, doc.querySelector('.fc-go').disabled], ['Apply to folder', true]);
      assert.equal(doc.querySelectorAll('.fc-plan-row').length, 0);
    } },
    { name: 'a server with no reason, and a plan where every file is skipped', run: async () => {
      const win = mkDoc().window; const doc = win.document;
      openApplyDialog({ doc, pipelineId: 'p1', fetch: planFetch([], { plan: () => json(500, {}) }) });
      await tick(); await tick();
      assert.equal(doc.querySelector('.fc-err').textContent, 'The server answered 500.');
      doc.querySelector('.fc-cancel').click();
      openApplyDialog({ doc, pipelineId: 'p1', fetch: planFetch([], { plan: { target: '/x', add: [], update: ['a.txt'], delete: [], skipped: [{ path: 'a.txt', reason: 'changed-in-folder' }] } }) });
      await tick(); await tick();
      assert.deepEqual([doc.querySelector('.fc-go').textContent, doc.querySelector('.fc-go').disabled], ['Apply 0 files', true]);
      assert.equal(doc.querySelector('.fc-target').textContent, '/x', 'no displayTarget: the absolute path');
      assert.deepEqual([...doc.querySelectorAll('.fc-plan-row')].map((r) => r.querySelector('.fc-plan-w').textContent), ['Update'], 'rows with nothing to do are not drawn');
      doc.querySelector('.fc-cancel').click();
      openApplyDialog({ doc, pipelineId: 'p1', fetch: planFetch([], { plan: { target: '/x', add: ['a.txt', 'b.txt'], update: [], delete: [], skipped: [{ path: 'c.txt', reason: 'changed-in-folder' }] } }) });
      await tick(); await tick();
      assert.equal(doc.querySelector('.fc-go').textContent, 'Apply 2 files', 'the union minus the skipped paths, whichever lists hold them (S4)');
    } },
  ]);
});

test('discardChanges: POST discard; the server\'s reason when it refuses', async () => {
  const seen = [];
  assert.deepEqual(await discardChanges({ fetch: (u, o) => { seen.push([o.method, u]); return json(200, { ok: true }); }, pipelineId: 'fcec04e8' }), { ok: true });
  assert.deepEqual(seen, [['POST', '/api/runs/fcec04e8/discard']]);
  assert.deepEqual(await discardChanges({ fetch: () => json(409, { error: 'The run has not finished.', code: 'RUN_NOT_FINISHED' }), pipelineId: 'x' }), { error: 'The run has not finished.' });
  assert.deepEqual(await discardChanges({ fetch: () => json(500, {}), pipelineId: 'x' }), { error: 'The server answered 500.' });
  assert.deepEqual(await discardChanges({ fetch: () => Promise.reject(new Error('offline')), pipelineId: 'x' }), { error: 'offline' });
});

test('folder CSS: the bar and dialog use theme tokens, no amber wash, no accent edge', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Folder runs (Projects, any way)'), css.indexOf('/* end Folder runs */'));
  assert.ok(block.length > 200, 'the block is there');
  assert.match(block, /\.fc-bar\{[^}]*background:color-mix\(in srgb,var\(--teal-bg\) 60%,var\(--panel\)\)/);
  assert.match(block, /\.confirm-modal \.fc-dlg\{width:min\(520px,100%\)/);
  assert.match(block, /\.fc-skipped\{[^}]*background:var\(--field\)/, 'the skipped list is a field panel, not an amber wash');
  assert.match(block, /\.fc-err\{[^}]*overflow-wrap:anywhere/, 'a long path in a refusal wraps inside the dialog');
  assert.doesNotMatch(block, /border-left|amber-wash/);
  assert.match(block, /\.fc-plan\{[^}]*flex:none/, 'a long skipped list never crushes the plan rows');
  assert.match(block, /\.fc-plan:empty\{display:none;\}/, 'no empty bordered box while the plan loads');
  assert.match(block, /\.fc-skipped ul\{[^}]*max-height:[^;]+;overflow:auto;/, 'the skipped list scrolls, the buttons stay in view');
  assert.match(block, /\.fc-file \.rd-diff-row-path\{white-space:normal;overflow-wrap:anywhere;\}/, 'a long path in the Changes list wraps, never clipped');
});
