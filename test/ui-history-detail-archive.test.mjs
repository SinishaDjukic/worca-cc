// test/ui-history-detail-archive.test.mjs — the Archive test of test/ui-history-detail.test.mjs: honest copy and
// danger styling, the DELETE, back to the list, the row dropped, and the archived run's tool tabs closed. The tool
// panel reads its tabs from storage once, when app.js loads, so this test has an app of its own, booted with them
// (test/helpers/shared-app-boot.mjs). Shared boot and fixtures: helpers/history-detail-boot.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  settle, KEY, ROW, ok, openDetail, click, detailOn, historyFetch,
} from './helpers/history-detail-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

// The tool panel's tabs (issue 1064), there when the app loads: the archived run's go, another run's stay.
const tools = { v: 1, tabs: [{ id: 'tab_arch1', kind: 'files', scope: { type: 'run', id: ROW.id }, state: {}, at: 1 },
  { id: 'tab_other1', kind: 'files', scope: { type: 'run', id: 'ffff9999' }, state: {}, at: 2 }], active: {}, prefs: { open: false, width: 460 } };
const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: historyFetch(), local: { 'worca-cc.tools': JSON.stringify(tools) } });
const bootDetail = detailOn(app).detail;

test('Archive: honest copy + danger styling, DELETE, back to the list, row dropped', async () => {
  const deletes = [];
  const ctx = await bootDetail({
    arms: (url, opts, box) => {
      if (url.startsWith(`/api/runs/${ROW.id}`) && opts.method === 'DELETE') {
        deletes.push(url);
        box.rows = [];        // stateful: a later forced reload must not resurrect it
        return ok({ ok: true });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  const rowSel = `#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${ROW.id}"]`;
  assert.ok(doc.querySelector(rowSel), 'the run is listed before the archive');
  const archive = doc.querySelector('#hist-detail .hd-archive');
  assert.equal(archive.hidden, false, 'a finished run is archivable');

  click(window, archive);
  await settle(window);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false);
  const msg = doc.querySelector('#confirm-message').textContent;
  assert.match(msg, /local branch/, 'the copy is honest about the local branch');
  assert.match(msg, /remote branch/, 'and about the remote branch surviving');
  assert.ok(doc.querySelector('#confirm-ok').classList.contains('danger'), 'destructive styling while open');

  doc.querySelector('#confirm-cancel').click();
  await settle(window);
  assert.equal(doc.querySelector('#confirm-ok').classList.contains('danger'), false,
    'the tint must never leak to the next confirmModal caller');
  assert.equal(deletes.length, 0, 'cancelling archives nothing');

  click(window, archive);
  await settle(window);
  doc.querySelector('#confirm-ok').click();
  await settle(window, 5);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0], `/api/runs/${ROW.id}?projectKey=${KEY}`);
  // goRunsList(): the bare list, not the remembered (now archived) run.
  assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
  assert.equal(doc.querySelector(rowSel), null, 'the row is dropped from the list');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('worca-cc.tools')).tabs.map((t) => t.id), ['tab_other1'], 'its tool tabs closed');
});
