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
  badgeOf, confirmDialog,
} from './helpers/history-detail-boot.mjs';

// ---------------------------------------------------------------------------
// Header meta
// ---------------------------------------------------------------------------

test('header meta renders status word · day · clock · duration · cost · +A −R', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, results: RESULTS } });
  await openDetail(ctx);
  const meta = ctx.window.document.querySelector('#hist-detail .hd-meta');
  assert.ok(meta, 'the detail header carries a meta line');
  assert.match(meta.textContent, /Done/);
  assert.match(meta.textContent, /\+412/);
  assert.match(meta.textContent, /−188/);            // U+2212, never an ASCII hyphen
  assert.match(meta.textContent, /\$153\.21/);
  assert.match(meta.textContent, /1h 40m/);
  // fmtDate is toLocaleString() — locale- AND timezone-dependent. Assert PRESENCE
  // and segment structure only, never a literal day/clock string.
  assert.ok(meta.querySelector('.hd-day').textContent.length > 0, 'the day segment paints');
  assert.doesNotMatch(meta.textContent, /Invalid Date/);
  const word = meta.querySelector('.hd-status-word');
  assert.equal(word.textContent, 'Done');
  assert.ok(word.classList.contains('st-done'), 'the status word wears its family class');
  // Persisted results win over the list row's live counts.
  assert.equal(meta.querySelector('.diff-add').textContent, '+412');
});

test('meta falls back to the live list counts when results are null', async () => {
  const ctx = await bootDetail();                     // DETAIL.results === null
  await openDetail(ctx);
  const counts = ctx.window.document.querySelector('#hist-detail .hd-diffcounts');
  assert.ok(counts, 'the counts segment falls back to the row');
  assert.equal(counts.querySelector('.diff-add').textContent, '+12');
  assert.equal(counts.querySelector('.diff-del').textContent, '−3');   // U+2212
});

test('meta omits day/clock when nothing carries a timestamp (deep link)', async () => {
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
  assert.match(meta.textContent, /Done/, 'the status word still paints');
});

test('a terminal run with a recorded team-metrics entry shows the "recorded" line', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, teamMetrics: { state: 'recorded', slug: 'acme/billing-api' } } });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tm = doc.querySelector('#hist-detail .hd-tm');
  assert.ok(tm, 'the .hd-tm span renders for a terminal run');
  assert.equal(tm.textContent, 'recorded to team metrics ✓');
  assert.ok(tm.classList.contains('st-ok'));
});

test('a pending team-metrics entry shows the pending-push wording', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, teamMetrics: { state: 'pending', slug: 'acme/billing-api' } } });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tm = doc.querySelector('#hist-detail .hd-tm');
  assert.ok(tm, 'the .hd-tm span renders for a terminal run');
  assert.equal(tm.textContent, 'team metrics · pending push');
  assert.ok(tm.classList.contains('st-warn'));
});

test('omitting teamMetrics entirely renders "not enabled"', async () => {
  const detail = { ...DETAIL };
  delete detail.teamMetrics;
  const ctx = await bootDetail({ detail });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tm = doc.querySelector('#hist-detail .hd-tm');
  assert.ok(tm, 'the .hd-tm span renders for a terminal run even with no teamMetrics field');
  assert.equal(tm.textContent, 'team metrics · not enabled');
  assert.ok(tm.classList.contains('st-muted'));
});

test('a non-terminal (paused) run renders no .hd-tm line', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused' }],
    detail: { ...PAUSED_DETAIL, teamMetrics: { state: 'recorded', slug: 'acme/billing-api' } },
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-tm'), null);
});

test('branch row copies the feature branch and flags .copied', async () => {
  const ctx = await bootDetail();
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  // Stub the clipboard AFTER boot, on the RETURNED window — the boot helper builds
  // the JSDOM itself, and copyBranchToClipboard reads navigator.clipboard at CLICK
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
  // Required, not cosmetic: copyBranchToClipboard awaits writeText and toggles
  // `.copied` a microtask later.
  await settle(window);
  assert.deepEqual(writes, [ROW.branch]);
  assert.ok(btn.classList.contains('copied'), 'the CSS-only "Copied" caption keys off this class');
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

test('a DEEP-LINKED Archive names the run in the confirm copy', async () => {
  const ctx = await bootDetail({ rows: [], deepLink: true });
  await settle(ctx.window, 5);
  await deliverRows(ctx, [ROW]);

  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-archive'));
  await settle(ctx.window);
  assert.match(
    ctx.window.document.querySelector('#confirm-message').textContent,
    new RegExp(`^${ROW.title}`),
    'the run title leads the copy — not the raw id from the stub',
  );
});

// ---------------------------------------------------------------------------
// Retained work
// ---------------------------------------------------------------------------

test('Archive is disabled with a tooltip when the list row reports retained work', async () => {
  const ctx = await bootDetail({ rows: [retainedRow()] });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const archive = doc.querySelector('#hist-detail .hd-archive');
  assert.equal(archive.disabled, true);
  assert.match(archive.title, /Recover or discard/);
  const banner = doc.querySelector('#hist-detail .retained-banner');
  assert.equal(banner.hidden, false);
  // The banner's CONTENT, not just its visibility: this block is the only
  // recovery instruction the user ever gets for work that never reached the
  // branch, so a painter that renders an empty banner must fail here.
  assert.match(banner.textContent, /uncommitted work retained/i);
  assert.match(banner.textContent, /pre-commit hook failed/, "git's own stderr, verbatim");
  assert.match(banner.textContent, /Worktree: \/tmp\/wt/);
  assert.match(banner.textContent, /git -C '\/tmp\/wt' add -A/, 'the copy-paste recovery block');
  assert.equal(doc.querySelector('#hist-detail .hist-retained-badge').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, false,
    'an AUTHORITATIVE retention also offers the action');
});

test('discarding the retained worktree clears the banner and re-enables Archive', async () => {
  const ctx = await bootDetail({
    rows: [retainedRow()],
    arms: (url) => (url.includes('/discard-worktree')
      ? ok({ ok: true, remaining: 0, patches: ['/tmp/p.patch'] })
      : null),
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 5);

  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
  // A discard is not an archive: the run stays listed.
  assert.ok(doc.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${ROW.id}"]`),
    'the discarded run is still listed');
});

test('deep-linked discard still clears the banner after the real row lands', async () => {
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
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, true,
    'a provisional retention binds no Discard');

  // (2) the row agrees: the worktree really is still there
  await deliverRows(ctx, [retainedRow()]);
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, false,
    'the action arrives with the authoritative row');

  // (3) discard acts on THAT row, so the repaint really clears
  click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
  // A discard is not an archive: the run stays listed.
  assert.ok(doc.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${ROW.id}"]`),
    'the discarded run is still listed');
});

test('deep link derives retained work from state.branch.commitFailed, then DEFERS to the row', async () => {
  const ctx = await bootDetail({ rows: [], detail: COMMIT_FAILED_DETAIL, deepLink: true });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true);

  // The server gates retainedWork on existsSync(worktreeDir), so a stale
  // commitFailed stamp must not outlive the row. Authoritative in BOTH directions.
  await deliverRows(ctx, [{ ...ROW, retainedWork: null }]);
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
});

// ---------------------------------------------------------------------------
// Cost-pause banner + resume gating
// ---------------------------------------------------------------------------

test('cost-paused run shows the banner; Continue-without-cap resumes with ignoreCostCap', async () => {
  const posts = [];
  const ctx = await bootDetail({
    // Reasons the product emits: 'cost_pipeline', 'cost_total', 'error', or the
    // usage-limit first line (free text).
    rows: [{ ...ROW, status: 'paused', pauseReason: 'cost_pipeline' }],
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
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd').dataset.pauseReason, 'cost_pipeline');
  const banner = doc.querySelector('#hist-detail .hd-banners .cost-banner');
  assert.ok(banner, 'the cost-pause banner renders on the detail screen');
  assert.ok(banner.classList.contains('cb-pipeline'));

  click(ctx.window, banner.querySelector('.cb-override'));
  await settle(ctx.window);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false,
    'the override asks for confirmation first');
  doc.querySelector('#confirm-ok').click();
  await settle(ctx.window, 6);
  assert.deepEqual(posts, [{ pipelineId: ROW.id, baseCheck: true, ignoreCostCap: true }]);
});

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
test('the Artifacts tab fetches GET /api/runs/:id/artifacts and renders per-node groups', async () => {
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
        ] });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tab = doc.querySelector('#hist-detail .hd-tab[data-sec="artifacts"]');
  assert.ok(tab, 'the Artifacts tab is visible for a run with an indexed artifact');
  click(ctx.window, tab);
  await settle(ctx.window, 6);
  assert.ok(asked, 'buildHdArtifacts fetched the attributed plural endpoint');
  const sec = doc.querySelector('#hist-detail .hd-sec[data-sec="artifacts"]');
  const rows = [...sec.querySelectorAll('.artifact-row')];
  assert.equal(rows.length, 1, 'the fetched artifact renders as a row');
  assert.equal(rows[0].querySelector('.artifact-name').textContent, 'plan.md');
  assert.equal(sec.querySelector('.artifact-group-head b').textContent, 'plan',
    'grouped under its producing node');
});

// 'questions' rows are indexed with attribution but the orchestrator deletes the
// scratch file once the round is answered, so a persisted questions row would 404
// when clicked. isDisplayableArtifact excludes it (like 'live-log'/'pipeline'), so
// the Artifacts tab neither counts nor renders it.
test('the Artifacts tab drops transient questions rows (deleted file would 404)', async () => {
  const detail = {
    ...DETAIL,
    state: { ...DETAIL.state, stepper: null, steps: [], subAgents: [] },
    artifacts: [{ kind: 'plan', relPath: 'plans/plan.md' }],
  };
  const ctx = await bootDetail({
    detail,
    arms: (url) => {
      if (url.endsWith(`/api/runs/${ROW.id}/artifacts`)) {
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
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="artifacts"]'));
  await settle(ctx.window, 6);
  const sec = doc.querySelector('#hist-detail .hd-sec[data-sec="artifacts"]');
  const rows = [...sec.querySelectorAll('.artifact-row')];
  assert.equal(rows.length, 1, 'only the durable plan row renders; questions is dropped');
  assert.equal(rows[0].querySelector('.artifact-name').textContent, 'plan.md');
  assert.doesNotMatch(sec.textContent, /questions-x-clarify/, 'no questions row is shown');
});

test('the Artifacts tab says when the server truncated the list', async () => {
  const detail = { ...DETAIL, state: { ...DETAIL.state, stepper: null, steps: [], subAgents: [] }, artifacts: [{ kind: 'plan', relPath: 'steps/plan-c1/plan.md' }] };
  const ctx = await bootDetail({
    detail,
    arms: (url) => (url.endsWith(`/api/runs/${ROW.id}/artifacts`)
      ? ok({ runId: ROW.id, truncated: true, artifacts: [
        { kind: 'plan', stepKey: 'plan#1', nodeId: 'plan', cycle: 1, relPath: 'steps/plan-c1/plan.md', bytes: 42, createdAt: ROW.startedAt },
        { kind: 'verdict', stepKey: 'review#1', nodeId: 'review', cycle: 1, relPath: 'steps/review-c1/impl-review-cycle1.json', bytes: 9, createdAt: ROW.startedAt },
      ] })
      : null),
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="artifacts"]'));
  await settle(ctx.window, 6);
  const sec = doc.querySelector('#hist-detail .hd-sec[data-sec="artifacts"]');
  assert.equal(sec.querySelectorAll('.artifact-row').length, 2);
  // No nextOffset in the response, so the notice is text, not a load-more control.
  assert.equal(sec.querySelector('.artifact-truncated').textContent, 'Showing the first 2 — this run indexed more.');
  assert.ok([...sec.querySelectorAll('.artifact-kind')].some((k) => k.textContent === 'verdict'), 'the kind chip shows the stored kind');
});

test('clicking a tab switches the visible section and lazy-builds exactly once', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;

  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="agents"]'));
  const agents = secOf(doc, 'agents');
  assert.equal(agents.hidden, false);
  assert.equal(agents.dataset.loaded, '1', 'first activation builds the body');
  for (const k of ['diff', 'overview', 'clarify', 'logs']) {
    assert.equal(secOf(doc, k).hidden, true, `${k} is hidden while Agents is active`);
  }
  // initHdTabs ends with activate(default), which stamps OVERVIEW, and the details/diff
  // route then opens DIFF — so exactly THREE sections are built at this point.
  assert.equal(doc.querySelectorAll('#hist-detail .hd-sec[data-loaded="1"]').length, 3);
  assert.equal(secOf(doc, 'clarify').dataset.loaded, undefined, 'an unvisited tab is never built');
  assert.equal(secOf(doc, 'logs').dataset.loaded, undefined);

  // Revisiting never rebuilds: the SAME node object comes back, still stamped once.
  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]'));
  assert.equal(agents.hidden, true);
  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="agents"]'));
  assert.equal(secOf(doc, 'agents'), agents, 'the section node is reused, never re-created');
  assert.equal(agents.dataset.loaded, '1');
  assert.equal(doc.querySelectorAll('#hist-detail .hd-sec[data-loaded="1"]').length, 3,
    'a second visit builds nothing new');
});

test('tabs are wired for a11y', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx);
  const doc = ctx.window.document;

  assert.equal(doc.querySelector('#hist-detail .hd-tabs').getAttribute('role'), 'tablist');
  const tabs = tabsOf(doc);
  assert.equal(tabs.length, 7);   // the fixture's visible tabs, Actions included
  for (const btn of tabs) {
    const key = btn.dataset.sec;
    const sec = secOf(doc, key);
    assert.ok(btn.id, `${key} tab carries an id for aria-labelledby`);
    assert.equal(btn.getAttribute('role'), 'tab');
    assert.equal(btn.getAttribute('aria-selected'), key === 'diff' ? 'true' : 'false');
    assert.equal(btn.getAttribute('aria-controls'), sec.id);
    assert.equal(sec.getAttribute('role'), 'tabpanel');
    assert.equal(sec.getAttribute('aria-labelledby'), btn.id);
    // Two panels scroll internally (.hd-diff-rows, .hd-sec-logs .log) and neither
    // is reliably reachable by keyboard otherwise. Roving tabindex + Arrow-key
    // navigation on the tablist is a recorded, accepted divergence — no other
    // tablist in this app implements it, so doing it here alone would be an
    // inconsistent partial.
    assert.equal(sec.tabIndex, 0);
  }

  // aria-selected TRACKS the active tab; it is not painted once at build time.
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]'));
  assert.equal(doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]').getAttribute('aria-selected'), 'true');
  assert.equal(doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]').getAttribute('aria-selected'), 'false');
});
