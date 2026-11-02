// test/ui-history-detail.test.mjs
// Behavior tests for the History DETAIL header: the meta line, the branch-copy
// row, Resume, Archive (honest copy through confirmModal), and the retained-work
// + cost-paused banners — including the deep-link path, where the screen starts
// from the minimal `{id, projectKey}` stub `histRecordFor` mints and is corrected
// once the authoritative list row arrives — and the tab strip.
//
// The Diff tab is in ui-history-detail-diff.test.mjs; the Overview, Agents, Clarify, Logs, form and
// bar sections and the Actions tab in ui-history-detail-tabs.test.mjs; the shared boot and fixtures
// in helpers/history-detail-boot.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boot, settle, KEY, ROW, DETAIL, PAUSED_DETAIL, COMMIT_FAILED_DETAIL, RESULTS, retainedRow,
  blockedBudget, ok, fail, bootDetail, openDetail, deliverRows, click, TABS_DETAIL, tabsOf, secOf,
  badgeOf, confirmDialog, go,
} from './helpers/history-detail-boot.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// ---------------------------------------------------------------------------
// Header meta
// ---------------------------------------------------------------------------

test('header meta: status word · day · clock · duration · cost · +A −R, falling back to list counts, omitting day/clock without timestamps', async () => {
  await checkRows([
    { name: 'header meta renders status word · day · clock · duration · cost · +A −R', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, results: RESULTS } });
      await openDetail(ctx);
      const meta = ctx.window.document.querySelector('#hist-detail .hd-meta');
      assert.ok(meta, 'the detail header carries a meta line');
      assert.match(meta.textContent, /Ready to ship/);
      assert.match(meta.textContent, /\+412/);
      assert.match(meta.textContent, /−188/);            // U+2212, never an ASCII hyphen
      assert.match(meta.textContent, /\$153\.21/);
      assert.match(meta.textContent, /1h 40m/);
      // fmtDate is toLocaleString() — locale- AND timezone-dependent. Assert PRESENCE
      // and segment structure only, never a literal day/clock string.
      assert.ok(meta.querySelector('.hd-day').textContent.length > 0, 'the day segment paints');
      assert.doesNotMatch(meta.textContent, /Invalid Date/);
      const word = meta.querySelector('.hd-status-word');
      assert.equal(word.textContent, 'Ready to ship');
      assert.ok(word.classList.contains('st-done'), 'the status word wears its family class');
      // Persisted results win over the list row's live counts.
      assert.equal(meta.querySelector('.diff-add').textContent, '+412');
    } },
    { name: 'meta falls back to the live list counts when results are null', run: async () => {
      const ctx = await bootDetail();                     // DETAIL.results === null
      await openDetail(ctx);
      const counts = ctx.window.document.querySelector('#hist-detail .hd-diffcounts');
      assert.ok(counts, 'the counts segment falls back to the row');
      assert.equal(counts.querySelector('.diff-add').textContent, '+12');
      assert.equal(counts.querySelector('.diff-del').textContent, '−3');   // U+2212
    } },
    { name: 'meta omits day/clock when nothing carries a timestamp (deep link)', run: async () => {
      // The row never lands, so the record stays the minimal {id, projectKey} stub and
      // the payload has no startedAt either — the painter must skip both segments
      // rather than render "Invalid Date".
      const ctx = await bootDetail({
        rows: [],
        detail: { ...DETAIL, state: { ...DETAIL.state, startedAt: null } },
      });
      await openDetail(ctx);
      const meta = ctx.window.document.querySelector('#hist-detail .hd-meta');
      assert.equal(meta.querySelector('.hd-day'), null);
      assert.equal(meta.querySelector('.hd-clock'), null);
      assert.doesNotMatch(meta.textContent, /Invalid Date/);
      assert.match(meta.textContent, /Ready to ship|Done/, 'the status word still paints');
    } },
  ]);
});

test('team-metrics line: recorded / pending push / not enabled on terminal runs, absent on a paused run', async () => {
  await checkRows([
    { name: 'a terminal run with a recorded team-metrics entry shows the "recorded" line', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, teamMetrics: { state: 'recorded', slug: 'acme/billing-api' } } });
      await openDetail(ctx);
      const doc = ctx.window.document;
      const tm = doc.querySelector('#hist-detail .hd-tm');
      assert.ok(tm, 'the .hd-tm span renders for a terminal run');
      assert.equal(tm.textContent, 'recorded to team metrics');
      assert.ok(tm.classList.contains('st-ok'));
    } },
    { name: 'a pending team-metrics entry shows the pending-push wording', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, teamMetrics: { state: 'pending', slug: 'acme/billing-api' } } });
      await openDetail(ctx);
      const doc = ctx.window.document;
      const tm = doc.querySelector('#hist-detail .hd-tm');
      assert.ok(tm, 'the .hd-tm span renders for a terminal run');
      assert.equal(tm.textContent, 'team metrics · pending push');
      assert.ok(tm.classList.contains('st-warn'));
    } },
    { name: 'omitting teamMetrics entirely renders "not enabled"', run: async () => {
      const detail = { ...DETAIL };
      delete detail.teamMetrics;
      const ctx = await bootDetail({ detail });
      await openDetail(ctx);
      const doc = ctx.window.document;
      const tm = doc.querySelector('#hist-detail .hd-tm');
      assert.ok(tm, 'the .hd-tm span renders for a terminal run even with no teamMetrics field');
      assert.equal(tm.textContent, 'team metrics · not enabled');
      assert.ok(tm.classList.contains('st-muted'));
    } },
    { name: 'a non-terminal (paused) run renders no .hd-tm line', run: async () => {
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'paused' }],
        detail: { ...PAUSED_DETAIL, teamMetrics: { state: 'recorded', slug: 'acme/billing-api' } },
      });
      await openDetail(ctx);
      const doc = ctx.window.document;
      assert.equal(doc.querySelector('#hist-detail .hd-tm'), null);
    } },
  ]);
});

test('branch row copies the feature branch and flags .copied', async () => {
  const ctx = await bootDetail();
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  // Stub the clipboard AFTER boot, on the RETURNED window — the boot helper builds
  // the JSDOM itself, and copyFromButton reads navigator.clipboard at CLICK
  // time. Precedent: test/ui-history-pr.test.mjs:95-98.
  const writes = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (t) => { writes.push(t); } },
    configurable: true,
  });

  const btn = doc.querySelector('#hist-detail .hd-branch-copy');
  assert.equal(btn.hidden, false, 'the copy button is revealed for a run with a branch');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-name').textContent, ROW.branch);
  const base = doc.querySelector('#hist-detail .hd-base');
  assert.equal(base.hidden, false);
  assert.match(base.textContent, /^feat\/log-ux/);

  click(window, btn);
  // Required, not cosmetic: copyFromButton awaits writeText and toggles
  // `.copied` a microtask later.
  await settle(window);
  assert.deepEqual(writes, [ROW.branch]);
  assert.ok(btn.classList.contains('copied'), 'the tick and the "Copied" caption key off this class');
  assert.equal(btn.querySelector('.copy-btn-msg').textContent, 'Copied');
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

test('Resume renders for paused AND interrupted, hidden for done/stopped/error', async () => {
  for (const [status, shown] of [
    ['paused', true], ['interrupted', true], ['done', false], ['stopped', false], ['error', false],
  ]) {
    const ctx = await bootDetail({
      rows: [{ ...ROW, status }],
      detail: { ...DETAIL, state: { ...DETAIL.state, status } },
    });
    await openDetail(ctx);
    assert.equal(
      ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, !shown,
      `status "${status}" -> Resume ${shown ? 'visible' : 'hidden'}`,
    );
  }
});

test('Resume POSTs exactly { pipelineId } and lands on running/<newRunId>', async () => {
  const posts = [];
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused' }],
    detail: PAUSED_DETAIL,
    arms: (url, opts) => {
      if (url === '/api/resume') {
        posts.push(JSON.parse(opts.body));
        return ok({ ok: true, runId: 'r-9', pipelineId: ROW.id });
      }
      return null;
    },
  });
  await openDetail(ctx);
  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-resume'));
  await settle(ctx.window, 5);
  // The body assertion test/ui-pause-resume.test.mjs:70 owns for the list card.
  assert.deepEqual(posts, [{ pipelineId: ROW.id, baseCheck: true }]);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running/r-9');
});

test('a DEEP-LINKED Resume acts on the authoritative row, not the minimal stub', async () => {
  // setupHdActions binds Resume ONCE and refreshHdFromRow deliberately never
  // re-runs it, so a handler closing over the load-time `record` would keep the
  // deep link's {id, projectKey} stub forever — upsertRun would then land a running
  // card titled with the raw run id and projectDir ''.
  const ctx = await bootDetail({
    rows: [],                                   // the list is withheld at boot
    detail: PAUSED_DETAIL,
    deepLink: true,
    arms: (url) => (url === '/api/resume' ? ok({ ok: true, runId: 'r-9', pipelineId: ROW.id }) : null),
  });
  await settle(ctx.window, 5);
  await deliverRows(ctx, [{ ...ROW, status: 'paused' }]);

  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-resume'));
  await settle(ctx.window, 6);
  const r = ctx.window.__np.getRun('r-9');
  assert.ok(r, 'the resumed run was upserted');
  assert.equal(r.title, ROW.title, 'titled from the authoritative row, not the raw run id');
  assert.equal(r.projectDir, ROW.projectDir, "projectDir from the row, not ''");
});

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

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
});

test('Archive is hidden while the run is still live (running/pausing)', async () => {
  // isDeletableEntry's negative direction. The server 409s a live DELETE
  // (ui/server.mjs:1594), but a row left `running` in the DB by a restart has no
  // live process behind it — the button is the only thing standing between the
  // user and an archive of a run that is still mid-flight.
  for (const [status, shown] of [
    ['running', false], ['pausing', false], ['starting', false], ['created', false],
    ['done', true], ['stopped', true], ['error', true],
  ]) {
    const ctx = await bootDetail({
      rows: [{ ...ROW, status }],
      detail: { ...DETAIL, state: { ...DETAIL.state, status } },
    });
    await openDetail(ctx);
    assert.equal(
      ctx.window.document.querySelector('#hist-detail .hd-archive').hidden, !shown,
      `status "${status}" -> Archive ${shown ? 'visible' : 'hidden'}`,
    );
  }
});

test('an in-flight Archive survives a concurrent repaint (never a second DELETE)', async () => {
  // The DELETE removes a worktree and a branch — seconds, not milliseconds. Any
  // repaint inside that window (a `pipelines-changed` broadcast for ANOTHER
  // pipeline) reaches hdSetArchiveGate, which must not re-enable a button that
  // still reads "Archiving…": the click guard would then pass and fire a second
  // DELETE, whose 404 stamps `.hd-error` for an archive that in fact succeeded.
  // The mirror of refreshHistResumeGating's `resumeState === 'busy'` guard.
  const deletes = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await bootDetail({
    arms: (url, opts, box) => {
      if (url.startsWith(`/api/runs/${ROW.id}`) && opts.method === 'DELETE') {
        deletes.push(url);
        return gate.then(() => { box.rows = []; return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  const archive = doc.querySelector('#hist-detail .hd-archive');

  click(window, archive);
  await settle(window);
  doc.querySelector('#confirm-ok').click();
  await settle(window, 3);
  assert.equal(deletes.length, 1, 'the DELETE is in flight');
  assert.equal(archive.disabled, true);
  assert.match(archive.textContent, /Archiving…/);

  await deliverRows(ctx, [ROW]);                     // an unrelated broadcast repaints
  assert.equal(archive.disabled, true, 'the repaint must not re-enable it mid-DELETE');
  assert.match(archive.textContent, /Archiving…/, 'and the label still says so');

  click(window, archive);
  await settle(window);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), true,
    'a second click is swallowed by the disabled guard — no second confirm');

  // Take the error node BEFORE the DELETE lands: the archive's goRunsList() closes the
  // saved page at once in the split layout, so it is gone from #hist-detail afterwards.
  const err = doc.querySelector('#hist-detail .hd-error');
  assert.ok(err, 'the saved page is still open while the DELETE is in flight');
  release();
  await settle(window, 6);
  assert.equal(deletes.length, 1, 'exactly one DELETE for one archive');
  assert.equal(err.hidden, true, 'and no error stamped');
});

// ---------------------------------------------------------------------------
// Retained work
// ---------------------------------------------------------------------------

// Slice 3 (D13): kept work has no banner; the card head carries Discard · Apply to branch, the route its patch and
// commands.
const KEPT_LINE = 'Needs you · the changes could not be committed';
const keptBtn = (doc, id) => doc.querySelector(`#hist-detail .hd-glance .rd-head-acts [data-head="${id}"]`);
const statusLine = (doc) => doc.querySelector('#hist-detail .hd-glance .rd-sheet .run-status').dataset.line;
const keptShown = (doc) => statusLine(doc) === KEPT_LINE;
const PATCH_DETAIL = { ...DETAIL, artifacts: [{ kind: 'retained-work-patch', relPath: 'retained-work.patch' }] };

test('Archive is disabled with a tooltip when the list row reports retained work', async () => {
  const ctx = await bootDetail({ rows: [retainedRow()], detail: PATCH_DETAIL });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const archive = doc.querySelector('#hist-detail .hd-archive');
  assert.equal(archive.disabled, true);
  assert.equal(archive.title, 'Recover or discard the kept work first');
  assert.equal(doc.querySelector('#hist-detail .retained-banner'), null);
  assert.equal(doc.querySelector('#hist-detail .hist-retained-badge'), null);
  assert.equal(statusLine(doc), KEPT_LINE);
  // An AUTHORITATIVE retention offers the actions in the head, Apply as the one primary.
  assert.ok(keptBtn(doc, 'discard-kept'));
  assert.ok(keptBtn(doc, 'apply-kept').classList.contains('btn-primary'));
  // The route's branch row is the only recovery instruction: the patch and the copy-paste commands.
  const step = doc.querySelector('#hist-detail .hd-glance .rd-route .rd-route-row');
  assert.ok(step.classList.contains('is-problem'));
  const kept = step.querySelector('.rd-route-second');
  const patch = [...kept.querySelectorAll('a.rd-fact-link')].find((a) => a.textContent === 'Download patch');
  assert.match(patch.getAttribute('href'), /\/recovery-patch\?/);
  click(ctx.window, [...kept.querySelectorAll('button.rd-fact-act')].find((b) => b.textContent === 'Commit it yourself'));
  assert.equal(doc.getElementById('viewer-title').textContent, 'Commit it yourself');
  const text = doc.getElementById('viewer').textContent;
  assert.match(text, /pre-commit hook failed/, "git's own stderr, verbatim");
  assert.match(text, /git -C '\/tmp\/wt' add -A/, 'the copy-paste recovery block');
  assert.doesNotMatch(doc.querySelector('#hist-detail .hd-glance .rd-sheet').textContent, /worktree/i);
});

test('kept work on a stopped or a failed saved run: the head offers Discard and Apply to branch, the route its patch', async () => {
  await checkRows(['stopped', 'error'].map((status) => ({ name: status, run: async () => {
    const ctx = await bootDetail({ rows: [retainedRow({ status })], detail: { ...PATCH_DETAIL, state: { ...DETAIL.state, status } } });
    await openDetail(ctx);
    const doc = ctx.window.document;
    assert.ok(keptBtn(doc, 'apply-kept'), `${status}: Apply to branch`);
    assert.ok(keptBtn(doc, 'discard-kept'), `${status}: Discard`);
    const patch = [...doc.querySelectorAll('#hist-detail .hd-glance .rd-route .rd-route-row:first-child .rd-route-second a.rd-fact-link')].find((a) => a.textContent === 'Download patch');
    assert.ok(patch, `${status}: the route's Download patch`);
  } })));
});

test('discarding the kept work clears the head and re-enables Archive, also on a deep link once the real row lands', async () => {
  await checkRows([
    { name: 'discarding the retained worktree clears the banner and re-enables Archive', run: async () => {
      const ctx = await bootDetail({
        rows: [retainedRow()],
        arms: (url) => (url.includes('/discard-worktree')
          ? ok({ ok: true, remaining: 0, patches: ['/tmp/p.patch'] })
          : null),
      });
      await openDetail(ctx);
      const doc = ctx.window.document;
      click(ctx.window, keptBtn(doc, 'discard-kept'));
      await confirmDialog(ctx.window);
      await settle(ctx.window, 5);

      assert.equal(keptShown(doc), false);
      assert.equal(keptBtn(doc, 'discard-kept'), null);
      assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
      // A discard is not an archive: the run stays listed.
      assert.ok(doc.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${ROW.id}"]`),
        'the discarded run is still listed');
    } },
    { name: 'deep-linked discard still clears the banner after the real row lands', run: async () => {
      const ctx = await bootDetail({
        rows: [], detail: COMMIT_FAILED_DETAIL, deepLink: true,
        arms: (url) => (url.includes('/discard-worktree')
          ? ok({ ok: true, remaining: 0, patches: ['/tmp/p.patch'] })
          : null),
      });
      await settle(ctx.window, 5);
      const doc = ctx.window.document;

      // (1) PROVISIONAL retention: banner up and Archive blocked, but NO action —
      // discarding must act on the authoritative row, not on an inferred retention.
      assert.equal(keptShown(doc), true);
      assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true);
      assert.equal(keptBtn(doc, 'discard-kept'), null, 'a provisional retention binds no Discard');

      // (2) the row agrees: the worktree really is still there
      await deliverRows(ctx, [retainedRow()]);
      assert.equal(keptShown(doc), true);
      assert.ok(keptBtn(doc, 'discard-kept'), 'the action arrives with the authoritative row');

      // (3) discard acts on THAT row, so the repaint really clears
      click(ctx.window, keptBtn(doc, 'discard-kept'));
      await confirmDialog(ctx.window);
      await settle(ctx.window, 6);
      assert.equal(keptShown(doc), false);
      assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
      // A discard is not an archive: the run stays listed.
      assert.ok(doc.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${ROW.id}"]`),
        'the discarded run is still listed');
    } },
  ]);
});

test('deep link derives retained work from state.branch.commitFailed, then DEFERS to the row', async () => {
  const ctx = await bootDetail({ rows: [], detail: COMMIT_FAILED_DETAIL, deepLink: true });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(keptShown(doc), true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true);

  // The server gates retainedWork on existsSync(worktreeDir), so a stale
  // commitFailed stamp must not outlive the row. Authoritative in BOTH directions.
  await deliverRows(ctx, [{ ...ROW, retainedWork: null }]);
  assert.equal(keptShown(doc), false);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
});

// ---------------------------------------------------------------------------
// Cost-pause banner + resume gating
// ---------------------------------------------------------------------------

test('a deep-linked cost-paused run gains its banner exactly once when the row arrives', async () => {
  const ctx = await bootDetail({ rows: [], detail: PAUSED_DETAIL, deepLink: true });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-banners .cost-banner'), null,
    'the stub carries no pauseReason and the detail payload none either');

  await deliverRows(ctx, [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }]);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-banners .cost-banner').length, 1);

  // An idempotent repaint must not stack a second banner.
  await deliverRows(ctx, [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }]);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-banners .cost-banner').length, 1);
});

test('a failed resume keeps its title across a repaint; a later budget block still disables it', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }],
    detail: PAUSED_DETAIL,
    arms: (url) => (url === '/api/resume' ? fail(500, { error: 'worktree is gone' }) : null),
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const btn = doc.querySelector('#hist-detail .hd-resume');
  assert.equal(btn.hidden, false);
  assert.equal(btn.disabled, false, 'an unblocked budget leaves a cost_total pause resumable');

  click(ctx.window, btn);
  await settle(ctx.window, 5);
  assert.match(btn.title, /Could not resume/, "D3: the server's 400/500 surfaces on the button");
  assert.equal(btn.disabled, false, 'the user may retry');

  // A repaint (pipelines-changed -> loadHistoryView(force) -> paintHistory ->
  // refreshHdFromRow -> refreshHistResumeGating) must not wipe that title.
  await deliverRows(ctx, [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }]);
  assert.match(btn.title, /Could not resume/, 'the failure survives the repaint');

  // ...but a failed resume does NOT opt out of budget gating for the life of the screen.
  ctx.box.budget = blockedBudget();
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'budget-changed', action: null }) });
  await settle(ctx.window, 6);
  assert.equal(btn.disabled, true, 'a later total-budget block still wins');
  assert.match(btn.title, /Total budget reached/);
});

// ---------------------------------------------------------------------------
// Section tabs
// ---------------------------------------------------------------------------

test('tabs render with badges; Details opens on Overview, and a tab route opens that tab', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx);
  const doc = ctx.window.document;

  assert.deepEqual(
    tabsOf(doc).map((b) => b.dataset.sec),
    ['overview', 'diff', 'actions', 'workflow', 'clarify', 'logs', 'agents'],   // one order on both run pages: results, then how it ran
  );
  // filesNew(1) + filesChanged(13). NEVER + filesDeleted: results.mjs:32 buckets
  // 'D' rows into changedFiles (NEW_STATUS is {A,C}) while :29 ALSO counts them in
  // filesDeleted, so adding it double-counts every deletion against the file list.
  assert.equal(badgeOf(doc, 'diff'), '14');
  assert.equal(badgeOf(doc, 'agents'), '2');
  assert.equal(badgeOf(doc, 'clarify'), '1');
  assert.equal(badgeOf(doc, 'overview'), null, 'Overview carries no count');
  assert.equal(badgeOf(doc, 'logs'), null, 'Logs carries no count');

  assert.ok(doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]').classList.contains('active'),
    'the details/diff route opens Diff');
  assert.equal(secOf(doc, 'diff').hidden, false);
  assert.equal(secOf(doc, 'overview').hidden, true);

  // ...and with nothing to show: DETAIL is results-null, clarify-empty, artifact-free. The
  // plain Details route opens on the first tab, Overview.
  const bare = await bootDetail();
  await openDetail(bare, 'details');
  const bareDoc = bare.window.document;
  assert.deepEqual(tabsOf(bareDoc).map((b) => b.dataset.sec), ['overview', 'diff', 'actions', 'workflow', 'agents']);
  assert.equal(secOf(bareDoc, 'clarify'), null, 'no Q&A -> no Clarify section either');
  assert.equal(secOf(bareDoc, 'logs'), null, 'no live-log artifact -> no Logs section either');
  assert.ok(bareDoc.querySelector('#hist-detail .hd-tab[data-sec="overview"]').classList.contains('active'));
  assert.equal(secOf(bareDoc, 'overview').hidden, false);
  assert.equal(badgeOf(bareDoc, 'agents'), null, 'an empty sub-agent list carries no badge');
});

// The saved detail payload's `artifacts` (listArtifacts' [{kind, relPath}]) carries
// no step attribution, so the Artifacts tab must fetch the ATTRIBUTED plural
// endpoint before rendering. This proves that wiring, not just the pure grouping.
// 'questions' rows are indexed with attribution but the orchestrator deletes the
// scratch file once the round is answered, so a persisted questions row would 404
// when clicked. isDisplayableArtifact excludes it (like 'live-log'/'pipeline'), so
// the Artifacts tab neither counts nor renders it.
test('Artifacts tab GETs /api/runs/:id/artifacts, renders per-node groups and drops transient questions rows', async () => {
  const detail = {
    ...DETAIL,
    state: { ...DETAIL.state, stepper: null, steps: [], subAgents: [] },
    // A non-live-log indexed artifact gates the tab's visibility.
    artifacts: [{ kind: 'plan', relPath: 'plans/plan.md' }],
  };
  let asked = null;
  const ctx = await bootDetail({
    detail,
    arms: (url) => {
      if (url.endsWith(`/api/runs/${ROW.id}/artifacts`)) {
        asked = url;
        return ok({ runId: ROW.id, artifacts: [
          { kind: 'plan', stepKey: 'plan#1', nodeId: 'plan', cycle: 0, relPath: 'plans/plan.md', bytes: 42, createdAt: ROW.startedAt },
          { kind: 'questions', stepKey: 'clarify#1', nodeId: 'clarify', cycle: 0, relPath: 'questions-x-clarify-c1-r1.json', bytes: 0, createdAt: ROW.startedAt },
        ] });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tab = doc.querySelector('#hist-detail .hd-tab[data-sec="artifacts"]');
  if (tab) { click(ctx.window, tab); await settle(ctx.window, 6); }
  const sec = doc.querySelector('#hist-detail .hd-sec[data-sec="artifacts"]');
  await checkRows([
    { name: 'the Artifacts tab fetches GET /api/runs/:id/artifacts and renders per-node groups', run: () => {
      assert.ok(tab, 'the Artifacts tab is visible for a run with an indexed artifact');
      assert.ok(asked, 'buildHdArtifacts fetched the attributed plural endpoint');
      const rows = [...sec.querySelectorAll('.afb-file')];
      assert.equal(rows.length, 1, 'the fetched artifact renders as a row');
      assert.equal(rows[0].querySelector('.afb-name').textContent, 'plan.md');
      assert.equal(sec.querySelector('.afb-folder.is-step .afb-fname').textContent, 'plan',
        'grouped under its producing node');
    } },
    { name: 'the Artifacts tab drops transient questions rows (deleted file would 404)', run: () => {
      const rows = [...sec.querySelectorAll('.afb-file')];
      assert.equal(rows.length, 1, 'only the durable plan row renders; questions is dropped');
      assert.equal(rows[0].querySelector('.afb-name').textContent, 'plan.md');
      assert.doesNotMatch(sec.textContent, /questions-x-clarify/, 'no questions row is shown');
    } },
  ]);
});

// Chat P5: the saved run's Details has the same capture-phase Escape arm as Running (Details → glance). A row opened
// from its Artifacts tab owns Escape: one press closes the popup and the page stays on the tab.
test('the History Artifacts tab opens a row in the popup, and Escape closes only the popup', async () => {
  const detail = { ...DETAIL, artifacts: [{ kind: 'plan', relPath: 'plans/plan.md' }] };
  const ctx = await bootDetail({
    detail,
    arms: (url) => {
      if (url.endsWith(`/api/runs/${ROW.id}/artifacts`)) {
        return ok({ runId: ROW.id, artifacts: [{ kind: 'plan', stepKey: 'plan#1', nodeId: 'plan', cycle: 1, relPath: 'plans/plan.md', bytes: 42 }] });
      }
      if (url.startsWith(`/api/runs/${ROW.id}/artifact?rel=`)) return ok({ rel: 'plans/plan.md', text: '# plan' });
      return null;
    },
  });
  await openDetail(ctx, 'details/artifacts');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const hash = ctx.window.location.hash;
  assert.match(hash, /\/details\/artifacts$/);
  const main = [...doc.querySelectorAll('#hist-detail .hd-sec[data-sec="artifacts"] .afb-main')]
    .find((m) => m.querySelector('.afb-name').textContent === 'plan.md');
  click(ctx.window, main);
  await settle(ctx.window, 8);
  assert.ok(doc.querySelector('.apv'), 'the popup opened');
  (doc.activeElement || doc.body).dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle(ctx.window, 4);
  assert.equal(doc.querySelector('.apv'), null, 'Escape closed the popup');
  assert.equal(ctx.window.location.hash, hash, 'and left the saved run on its Artifacts tab');
});

// Refine cycle 2: with a saved run open, an opener that names only the pipeline (the Chat, the Agents tab's rows) reads
// the step labels from that run's saved state.
test('with a saved run open, the popup for that run names the step from its saved state', async () => {
  const stepper = { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 'plan', key: 'plan', uiPhase: 'plan', label: 'Planner' }] }], feedbacks: [] };
  const ctx = await bootDetail({
    detail: { ...DETAIL, state: { ...DETAIL.state, stepper } },
    arms: (url) => (url.startsWith(`/api/runs/${ROW.id}/artifact?rel=`) ? ok({ rel: 'plans/plan.md', text: '# plan' }) : null),
  });
  await openDetail(ctx);
  await settle(ctx.window, 6);
  await ctx.window.__np.openRunArtifactPopup({ pipelineId: ROW.id }, { kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', cycle: 1 });
  await settle(ctx.window, 8);
  assert.equal(ctx.window.document.querySelector('.apv .apv-meta').textContent, 'Planner · cycle 1');
});

// ---------------------------------------------------------------------------
// The summary card: the checkout's Actions row (Simple: a plain row with Discard / Unlink), the retained notice
// ---------------------------------------------------------------------------

// Seeded "now": whenLabel then reads HH:MM (today), even near midnight.
const checkoutRow = (member = {}) => ({ ...ROW, checkout: { members: [{ projectKey: KEY, worktreeDir: '/tmp/co', branch: ROW.branch,
  at: new Date().toISOString(), policy: 'on-demand', setup: { status: 'ok' }, ...member }] } });
const glanceOf = (doc) => doc.querySelector('#hist-detail .hd-glance');
const actionsRowOf = (doc) => doc.querySelector('#hist-detail .hd-glance .rd-result .rd-srow[data-rd-tab="actions"]');
const actionsValueOf = (doc) => { const v = actionsRowOf(doc)?.querySelector('.rd-srow-v'); return v ? v.textContent : ''; };
const simpleRowOf = (doc) => doc.querySelector('#hist-detail .hd-glance .rd-result .rd-srow-checkout');
const buttonsOf = (el) => [...el.querySelectorAll('button')].map((b) => b.textContent);
const atSimple = (ctx) => { ctx.window.document.documentElement.dataset.level = 'simple'; };
const atAdvanced = (ctx) => { ctx.window.document.documentElement.dataset.level = 'advanced'; };
/** Browsers blur a focused button the moment it becomes disabled; jsdom does not. Blur first: jsdom's blur() does
 *  nothing on a button that is already disabled. */
function blurOnDisable(btn) {
  const proto = Object.getPrototypeOf(btn);
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'disabled');
  Object.defineProperty(btn, 'disabled', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { if (v) this.blur(); desc.set.call(this, v); },
  });
}

test('checkout: no box on the glance; the Actions row says where the local copy stands; Archive stays blocked', async () => {
  const ctx = await bootDetail({ rows: [checkoutRow()] });
  atAdvanced(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(keptShown(doc), false);
  assert.equal(keptBtn(doc, 'apply-kept'), null);
  assert.match(actionsValueOf(doc), /^Local copy open · since \d{1,2}:\d{2}$/);
  const v = actionsRowOf(doc).querySelector('.rd-srow-v');
  assert.equal(actionsRowOf(doc).lastElementChild, v, 'the value is the row\'s last child, before the CSS chevron');
  assert.equal(simpleRowOf(doc), null, 'the tab row owns it at Advanced');
  assert.doesNotMatch(glanceOf(doc).textContent, /worktree/i);
  const archive = doc.querySelector('#hist-detail .hd-archive');
  assert.equal(archive.disabled, true);
  assert.equal(archive.title, 'Close the local copy in Actions first');
});

test('checkout row: before Check out it offers the try; a linked folder reads as yours', async () => {
  const ctx = await bootDetail({ rows: [ROW] });
  atAdvanced(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(actionsValueOf(doc), 'Try it on this machine');
  await deliverRows(ctx, [checkoutRow({ worktreeDir: '/Users/ada/app', external: true, policy: 'external' })]);
  assert.match(actionsValueOf(doc), /^Linked to your folder · since \d{1,2}:\d{2}$/);
  assert.equal(actionsRowOf(doc).querySelectorAll('.rd-srow-v').length, 1, 'patched in place, never stacked');
});

test('checkout row: a workspace with two local copies; at Simple one Discard per member', async () => {
  const ws = { ...ROW, target: 'workspace', projectKey: 'workspaces/ws1', projectDir: null,
    members: [{ memberKey: 'app-11111111', name: 'App' }, { memberKey: 'api-22222222', name: 'API' }],
    checkout: { members: [
      { projectKey: 'app-11111111', worktreeDir: '/tmp/a', branch: ROW.branch, at: new Date().toISOString() },
      { projectKey: 'api-22222222', worktreeDir: '/tmp/b', branch: ROW.branch, at: new Date().toISOString() }] } };
  const ctx = await bootDetail({
    rows: [ws],
    arms: (url) => (new URL(url, 'http://localhost:4317').pathname === `/api/workspaces/ws1/runs/${ROW.id}` ? ok(DETAIL) : null),
  });
  atAdvanced(ctx);
  go(ctx.window, `history/workspaces/ws1/${ROW.id}`);
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.match(actionsValueOf(doc), /^2 local copies open · since /);
  atSimple(ctx);
  await deliverRows(ctx, [structuredClone(ws)]);
  const row = simpleRowOf(doc);
  assert.ok(row, 'at Simple a plain row carries the way out');
  assert.match(row.textContent, /^2 local copies open · since /);
  assert.deepEqual([...row.querySelectorAll('.rd-srow-acts button')].map((b) => b.textContent), ['Discard app', 'Discard api']);
  // At 375px the buttons wrap under the text: the text keeps a basis instead of shrinking into a narrow column.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rd-srow-checkout \.rd-srow-tx\{flex:1 1 \d+em;\}/);
});

test('checkout row: retained work shows the kept head and no Actions row value', async () => {
  const ctx = await bootDetail({ rows: [retainedRow()] });
  atAdvanced(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(keptShown(doc), true);
  assert.ok(keptBtn(doc, 'apply-kept'));
  assert.ok(actionsRowOf(doc), 'the Actions tab row is there');
  assert.equal(actionsRowOf(doc).querySelector('.rd-srow-v'), null);
});

test('Simple: Discard on the checkout row uses the Actions tab\'s confirm and DELETE, then the row goes', async () => {
  const calls = [];
  const ctx = await bootDetail({
    rows: [checkoutRow()],
    arms: (url, opts = {}) => {
      if (!url.includes(`/api/runs/${ROW.id}/checkout`) || url.includes('/diff')) return null;
      calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
      return ok({ removed: [KEY], patches: [], unlinked: [] });
    },
  });
  atSimple(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(actionsRowOf(doc), null, 'no Actions tab at Simple');
  const row = simpleRowOf(doc);
  assert.match(row.textContent, /^Local copy open · since /);
  assert.deepEqual(buttonsOf(row), ['Discard']);
  assert.doesNotMatch(glanceOf(doc).textContent, /worktree/i);
  click(ctx.window, row.querySelector('button'));
  await settle(ctx.window, 2);
  assert.equal(doc.getElementById('confirm-title').textContent, 'Discard the checkout?');
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.deepEqual(calls.filter((c) => c[0] === 'DELETE'), [['DELETE', `/api/runs/${ROW.id}/checkout?projectKey=${KEY}`, { members: [KEY] }]]);
  await deliverRows(ctx, [ROW]);
  assert.equal(simpleRowOf(doc), null);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
});

test('Simple: a linked folder\'s row offers Unlink with its own confirm, and only unlinks', async () => {
  const calls = [];
  const ctx = await bootDetail({
    rows: [checkoutRow({ worktreeDir: '/Users/ada/app', external: true, policy: 'external' })],
    arms: (url, opts = {}) => {
      if (!url.includes(`/api/runs/${ROW.id}/checkout?`)) return null;
      calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
      return ok({ removed: [], patches: [], unlinked: [KEY] });
    },
  });
  atSimple(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const row = simpleRowOf(doc);
  assert.match(row.textContent, /^Linked to your folder · since /);
  assert.deepEqual(buttonsOf(row), ['Unlink']);
  assert.doesNotMatch(glanceOf(doc).textContent, /worktree/i);
  click(ctx.window, row.querySelector('button'));
  await settle(ctx.window, 2);
  assert.equal(doc.getElementById('confirm-title').textContent, 'Stop using this folder?');
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.deepEqual(calls, [['DELETE', `/api/runs/${ROW.id}/checkout?projectKey=${KEY}`, { members: [KEY] }]]);
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Folder unlinked', detail: 'The folder stays as it was.', action: '' });
  await deliverRows(ctx, [ROW]);
  assert.equal(simpleRowOf(doc), null);
});

test('Simple: an unchanged row repainted keeps the same checkout button node (D14)', async () => {
  const row = checkoutRow();
  const ctx = await bootDetail({ rows: [row] });
  atSimple(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const before = simpleRowOf(doc).querySelector('button');
  before.focus();
  await deliverRows(ctx, [structuredClone(row)]);
  assert.equal(simpleRowOf(doc).querySelector('button'), before, 'a button replaced between press and release drops its click');
  assert.equal(before.isConnected, true);
  assert.equal(doc.activeElement, before, 'the Results rebuild detaches the row for a moment; focus comes back');
});

test('Actions tab: Download patch asks for the member\'s diff; a clean folder says so and keeps focus', async () => {
  const actModel = {
    runId: ROW.id, workspace: false, finished: true, enabled: true,
    members: [{ projectKey: KEY, projectName: 'Alpha', branch: ROW.branch, state: 'checked-out',
      checkout: { setup: { status: 'ok' }, worktreeDir: '/tmp/co' }, actions: [], builtins: [] }],
    instances: [], stacks: [], stackStates: [],
  };
  const ctx = await bootDetail({
    rows: [checkoutRow()],
    arms: (url) => {
      if (url.endsWith('/api/actions/running')) return ok([]);
      if (url.includes(`/api/runs/${ROW.id}/actions?`)) return ok(actModel);
      if (url.includes(`/api/runs/${ROW.id}/checkout/diff?`)) return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      return null;
    },
  });
  atAdvanced(ctx);
  await openDetail(ctx, 'details/actions');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const btn = secOf(doc, 'actions').querySelector('.act-diff');
  assert.equal(btn.textContent, 'Download patch');
  blurOnDisable(btn);
  btn.focus();
  click(ctx.window, btn);
  await settle(ctx.window, 4);
  const req = ctx.calls.find((c) => c.url.includes('/checkout/diff'));
  assert.match(req.url, new RegExp(`^/api/runs/${ROW.id}/checkout/diff\\?projectKey=${KEY}&member=${KEY}$`));
  assert.equal(lastToast(doc).title, 'Nothing uncommitted');
  assert.equal(doc.activeElement, btn, 'focus is back on the button');
});

test('kept work: Apply to branch commits the retained work and clears the head', async () => {
  let posted = null;
  const ctx = await bootDetail({
    rows: [retainedRow()],
    arms: (url, opts = {}) => {
      if (!url.includes('/apply-retained')) return null;
      posted = [opts.method, url];
      return ok({ ok: true, id: ROW.id, applied: [{ projectKey: KEY, branch: ROW.branch, sha: 'abcdef0123456789', committed: true, hooksBypassed: false }],
        failed: [], remaining: 0, worktrees: ['/tmp/wt'], runRoot: null, warnings: [] });
    },
  });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(keptShown(doc), true);
  const actionsGets = () => ctx.calls.filter((c) => c.url.includes(`/api/runs/${ROW.id}/actions`)).length;
  const getsBefore = actionsGets();
  click(ctx.window, keptBtn(doc, 'apply-kept'));
  await settle(ctx.window, 2);
  assert.equal(doc.getElementById('confirm-title').textContent, 'Apply the work to the branch?');
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.deepEqual(posted, ['POST', `/api/runs/${ROW.id}/apply-retained?projectKey=${KEY}`]);
  assert.equal(keptShown(doc), false);
  assert.equal(keptBtn(doc, 'apply-kept'), null);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Work applied to the branch',
    detail: `Committed abcdef0123 on ${ROW.branch}.`, action: '' });
  assert.ok(actionsGets() > getsBefore, 'the Actions model is refetched: it no longer offers the released worktree');
});


test('kept work: a commit that fails again keeps the head and shows git\'s message', async () => {
  const ctx = await bootDetail({
    rows: [retainedRow()],
    arms: (url) => (url.includes('/apply-retained')
      ? fail(409, { ok: false, code: 'COMMIT_FAILED', error: 'lint failed: 3 errors', applied: [],
        failed: [{ projectKey: KEY, branch: ROW.branch, step: 'commit', message: 'lint failed: 3 errors' }], remaining: 1 })
      : null),
  });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  click(ctx.window, keptBtn(doc, 'apply-kept'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.equal(keptShown(doc), true, 'the retained state stays');
  assert.ok(keptBtn(doc, 'apply-kept'));
  const t = lastToast(doc);
  assert.equal(t.tone, 'err');
  assert.equal(t.title, 'The commit failed again');
  assert.equal(t.detail, 'lint failed: 3 errors');
});


test('kept work: after a discard, a cache-warm row (no retainedWork key) does not bring back a provisional head', async () => {
  const ctx = await bootDetail({
    rows: [], detail: structuredClone(COMMIT_FAILED_DETAIL), deepLink: true,
    arms: (url) => (url.includes('/discard-worktree') ? ok({ ok: true, remaining: 0, patches: [] }) : null),
  });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  await deliverRows(ctx, [retainedRow()]);
  click(ctx.window, keptBtn(doc, 'discard-kept'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.equal(keptShown(doc), false);
  const { retainedWork: _gone, ...cacheWarm } = ROW;
  await deliverRows(ctx, [cacheWarm]);
  assert.equal(keptShown(doc), false, 'hdForgetRetained: the stale commitFailed stamp is released');
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
});


test('F-2: the Actions row, the Overview WORKTREE row and the Actions strip read one checkout', async () => {
  const actModel = (checkedOut) => ({
    runId: ROW.id, workspace: false, finished: true, enabled: true,
    members: [{ projectKey: KEY, projectName: 'Alpha', branch: ROW.branch, state: checkedOut ? 'checked-out' : 'not-checked-out',
      checkout: checkedOut ? { setup: { status: 'ok' } } : null, actions: [], builtins: [] }],
    instances: [], stacks: [], stackStates: [],
  });
  let model = actModel(true);
  const ctx = await bootDetail({
    rows: [checkoutRow()],
    arms: (url) => {
      if (url.endsWith('/api/actions/running')) return ok([]);
      if (url.includes(`/api/runs/${ROW.id}/actions?`)) return ok(model);
      return null;
    },
  });
  atAdvanced(ctx);
  await openDetail(ctx, 'details/overview');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const wt = () => doc.querySelector('#hist-detail .hd-ov-wt');
  assert.match(wt().textContent, /checked out/);
  assert.doesNotMatch(wt().textContent, /released/);
  assert.match(wt().querySelector('.hd-ov-wt-path').title, /\/tmp\/co/);
  assert.match(actionsValueOf(doc), /^Local copy open · since /);
  const strip = () => secOf(doc, 'overview').querySelector('.act-strip');
  assert.ok(![...strip().querySelectorAll('button')].some((b) => b.textContent === 'Check out'), 'no Check out while checked out');
  // Discarded: the row, then both change events
  model = actModel(false);
  await deliverRows(ctx, [ROW]);
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'actions-changed', action: 'checkout' }) });
  await settle(ctx.window, 6);
  assert.match(wt().textContent, /released/);
  assert.equal(actionsValueOf(doc), 'Try it on this machine');
  assert.ok([...strip().querySelectorAll('button')].some((b) => b.textContent === 'Check out'));
});

test('F-11: a finished run with no PR reads Ready to ship; an open PR reads In review', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, results: RESULTS } });
  await openDetail(ctx);
  const word = () => ctx.window.document.querySelector('#hist-detail .hd-status-word').textContent;
  assert.equal(word(), 'Ready to ship');
  await deliverRows(ctx, [{ ...ROW, pr: { url: 'https://github.com/acme/web/pull/7', number: 7, state: 'OPEN' } }]);
  await settle(ctx.window, 4);
  assert.equal(word(), 'In review');
});

test('F-1 / F-10 style rules: the header row wraps, the meta line is sans', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.hd-row1,\.pd-row1\{[^}]*flex-wrap:wrap/);
  assert.match(css, /@media \(max-width:640px\)\{\.hd-row1 > \.hd-title,\.pd-row1 > \.pd-title\{flex:1 1 100%;\}\}/);
  assert.match(css, /\.hd-meta\{[^}]*var\(--sans\)/);
});

// ---------------------------------------------------------------------------
// Slice 2: the run page's one ⋯ (needle test e, saved page)
// ---------------------------------------------------------------------------

const openMore = (ctx, sel = '#hist-detail .hd-bar-more') => {
  const doc = ctx.window.document;
  doc.querySelector(sel).dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  return doc.querySelector('body > .wfv-menu');
};
const itemsOf = (menu) => [...menu.querySelectorAll('.menu-item')];
const labelOf = (b) => b.querySelector('.wfv-menu-l').textContent;
// A control a person can reach: not inside (or itself) [hidden].
const reachableArchive = (root) => [...root.querySelectorAll('button')]
  .filter((b) => b.textContent.trim() === 'Archive' && !b.closest('[hidden]'));

for (const level of ['simple', 'advanced', 'expert']) {
  test(`needle (e) at ${level}: one Archive, in ⋯, confirmed; none in .rd-actions`, async () => {
    const ctx = await bootDetail({ rows: [{ ...ROW, status: 'stopped' }] });
    ctx.window.document.documentElement.dataset.level = level;
    await openDetail(ctx, '');
    await settle(ctx.window, 6);
    const doc = ctx.window.document;
    const screen = doc.querySelector('#hist-detail');
    assert.equal(reachableArchive(screen).length, 0, 'no Archive on the page outside the ⋯');
    assert.equal(screen.querySelectorAll('.rd-actions [data-model-action="archive"], .rd-actions [data-model-action="report"]').length, 0);
    assert.equal(screen.querySelector('.hd-more, .hd-menu'), null, 'the Details ⋯ is gone');
    const menu = openMore(ctx);
    const items = itemsOf(menu);
    assert.equal(items.filter((b) => labelOf(b) === 'Archive').length, 1);
    assert.deepEqual(items.map(labelOf).slice(-2), ['Report this run', 'Archive']);
    assert.equal(items.find((b) => labelOf(b) === 'Terminal').querySelector('.wfv-menu-hint').textContent, 'Ctrl+`');
    const archive = items.find((b) => labelOf(b) === 'Archive');
    assert.ok(archive.classList.contains('is-danger'));
    archive.click();
    await settle(ctx.window, 4);
    assert.equal(doc.getElementById('confirm-title').textContent, 'Archive this run?');
  });
}

test('needle (e): checked out, the ⋯ Archive is disabled with "Close the local copy in Actions first"', async () => {
  const ctx = await bootDetail({ rows: [checkoutRow()] });
  atSimple(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const archive = itemsOf(openMore(ctx)).find((b) => labelOf(b) === 'Archive');
  assert.equal(archive.disabled, true);
  assert.equal(archive.title, 'Close the local copy in Actions first');
  archive.click();
  await settle(ctx.window, 2);
  assert.equal(ctx.window.document.querySelector('#confirm-modal').classList.contains('hidden'), true, 'no confirm opens');
});

test('slice 2: an archived saved run\'s ⋯ ends with Restore and has no Archive', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, archivedAt: '2026-10-18T10:00:00Z' } } });
  atSimple(ctx);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const labels = itemsOf(openMore(ctx)).map(labelOf);
  assert.equal(labels.at(-1), 'Restore');
  assert.equal(labels.includes('Archive'), false);
});
