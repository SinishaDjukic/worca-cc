// test/marketplace-add-dialog.test.mjs — P7: the Add marketplace dialog (boards 2.1–2.3, F9, F10; U3, U4/L1, L6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';
import { phaseLines, createAddMarketplaceDialog, ADD_POLL_MS } from '../ui/public/marketplace/add-dialog.mjs';
import { kindCounts, addsSummary, secretsSummary } from '../ui/public/marketplace/kinds.mjs';
import { OFFICIAL, EXAMPLE, NOTE0, row } from './helpers/mk-marketplaces-fixtures.mjs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
const doc = window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const ADDED = { ...EXAMPLE, lastError: null, warnings: [NOTE0] };
const JOB = 'mkt_0a1b2c3d';
const job = (o = {}) => ({ id: JOB, url: 'example/worca-marketplace', state: 'running', phase: 'resolving', resolvedUrl: null, sha: null,
  done: 0, total: null, plugin: null, error: null, code: null, existing: null, marketplace: null, startedAt: '2026-10-20T12:00:00Z', endedAt: null, ...o });
const R = (status, data) => ({ ok: status >= 200 && status < 300, status, data });
const ACCEPTED = (o = {}) => R(202, { jobId: JOB, job: job(o) });

function harness({ answers = {}, plugins = [], onLoad = null } = {}) {
  const calls = []; const acts = []; const focused = []; const polls = [];
  let loads = 0;
  const page = { state: { marketplaces: [OFFICIAL], plugins }, act: (...a) => acts.push(a), setTab: () => {},
    load: async () => { loads += 1; onLoad?.(page); } };
  const deps = { notify: () => {}, openMenu: () => {}, gitOn: () => true,
    api: async (method, url, body) => {
      calls.push([method, url, body]);
      const a = answers[`${method} ${url}`];
      return (typeof a === 'function' ? a(body) : a) || R(0, { error: 'Worca did not answer (offline).' });
    } };
  const timers = { set: (fn, ms) => { polls.push({ fn, ms }); return polls.length; }, clear: () => { polls.length = 0; } };
  const dlg = createAddMarketplaceDialog({ doc, win: window, deps, page, focusMarketplace: (id) => focused.push(id), timers });
  return { dlg, calls, acts, focused, polls, loads: () => loads, page };
}
const D = () => doc.getElementById('mk-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const foot = () => qa('.mk-add-secondary, .mk-add-primary').map((b) => [b.textContent.trim(), b.disabled]);
const type = (v) => { const i = doc.getElementById('mk-add-url'); i.value = v; i.dispatchEvent(new window.Event('input', { bubbles: true })); };
const submit = async () => { q('.mk-add-primary').click(); await settle(); };
async function toResult(h, marketplace = ADDED) {
  h.dlg.open(); type('example/worca-marketplace'); await submit();
  h.dlg.onJob(job({ state: 'done', phase: 'saved', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, marketplace })); await settle();
}

test('phaseLines: four lines from the job phase (resolving · fetching · reading · checking); saved = all done', () => {
  assert.deepEqual(phaseLines(job()), [
    { state: 'current', text: 'Found', value: 'example/worca-marketplace' },
    { state: 'pending', text: 'Fetched', value: '' },
    { state: 'pending', text: 'Reading plugins…', value: '' },
    { state: 'pending', text: 'Checking what each plugin asks for', value: '' }]);
  assert.deepEqual(phaseLines(job({ phase: 'reading', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha })).map((l) => [l.state, l.value]),
    [['done', 'github.com/example/worca-marketplace'], ['done', '16b6363'], ['current', ''], ['pending', '']]);
  assert.deepEqual(phaseLines(job({ phase: 'saved' })).map((l) => l.state), ['done', 'done', 'done', 'done']);
});

test('idle: lg dialog, title, own Close, field, placeholder; Add waits for a value; Enter adds; open() answers undefined', async () => {
  const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
  assert.equal(h.dlg.open(), undefined, 'renderNoMarketplaces leaves its form alone (LC-P3-23)');
  assert.deepEqual([D().dataset.kind, D().dataset.state, D().dataset.width, q('h2#mk-add-title.section-title').textContent, D().getAttribute('aria-labelledby')],
    ['add-marketplace', 'idle', 'lg', 'Add marketplace', 'mk-add-title']);
  assert.equal(q('.mk-dialog-head > .mk-mt').className, 'mk-mt mk-mt-md mk-t-mkt');
  assert.equal(q('button.mk-dlg-close').getAttribute('aria-label'), 'Close');
  assert.equal(q('label[for="mk-add-url"]').textContent, 'Repository or folder');
  const input = doc.getElementById('mk-add-url');
  assert.deepEqual([input.placeholder, input.value, input.readOnly, doc.activeElement === input], ['owner/repo, GitHub URL or folder', '', false, true]);
  assert.deepEqual(foot(), [['Cancel', false], ['Add', true]]);
  type('   '); assert.deepEqual(foot(), [['Cancel', false], ['Add', true]]);
  type('example/worca-marketplace'); assert.deepEqual(foot(), [['Cancel', false], ['Add', false]]);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
  assert.deepEqual(h.calls[0], ['POST', '/api/marketplaces', { url: 'example/worca-marketplace', progress: true }]);
  q('button.mk-dlg-close').click();
  assert.deepEqual([h.dlg.isOpen(), D()], [false, null], 'close removes the dialog (SM21)');
});

test('adding: real progress lines from the job (U3, board 2.1); done → the result lists the plugins (board 2.2)', async () => {
  const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() }, plugins: [row('example-models')] });
  h.dlg.open(); type('example/worca-marketplace'); await submit();
  assert.deepEqual([D().dataset.state, D().getAttribute('aria-busy'), doc.getElementById('mk-add-url').readOnly], ['adding', null, true]);
  assert.deepEqual(foot(), [['Cancel', false], ['Adding…', true]]);
  assert.equal(q('.mk-add-primary').getAttribute('aria-busy'), 'true');
  const ol = q('ol.mk-progress');
  assert.equal(ol.closest('[aria-busy]'), null, 'the live region is never inside a busy region (assistive tech may hold its news back)');
  assert.deepEqual([ol.getAttribute('aria-label'), ol.getAttribute('aria-live')], ['Progress', 'polite']);
  assert.deepEqual([h.polls.length, h.polls[0].ms, ADD_POLL_MS], [1, 2000, 2000]);
  h.dlg.onJob(job({ id: 'mkt_ffffffff', phase: 'checking' }));                 // another dialog's job
  assert.equal(q('li[aria-current="step"]').textContent, 'Found example/worca-marketplace');
  h.dlg.onJob(job({ phase: 'reading', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha }));
  assert.deepEqual(qa('ol.mk-progress > li').map((l) => [l.dataset.state, l.textContent]), [
    ['done', 'Found github.com/example/worca-marketplace'], ['done', 'Fetched 16b6363'],
    ['current', 'Reading plugins…'], ['pending', 'Checking what each plugin asks for']]);
  assert.equal(q('li[aria-current="step"]').textContent, 'Reading plugins…');
  h.dlg.onJob(job({ state: 'done', phase: 'saved', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, marketplace: ADDED })); await settle();
  assert.deepEqual([h.loads(), h.polls.length, D().dataset.state, D().hasAttribute('aria-busy')], [1, 0, 'result', false]);
  assert.equal(q('#mk-add-title').textContent, 'Added example/worca-marketplace');
  assert.ok(q('.mk-dialog-head > .mk-mt.mk-t-ok'), 'the success tile');
  assert.deepEqual([...q('.mk-add-meta').children].map((c) => c.textContent).filter(Boolean),
    ['github.com/example/worca-marketplace', '@ 16b6363', '·', '3 plugins']);
  assert.equal(q('.mk-add-meta > .mk-add-path').textContent, 'github.com/example/worca-marketplace', 'only the URL wraps');
  assert.equal(q('ul.mk-list.mk-plist').getAttribute('aria-label'), 'Plugins in this marketplace');
  const bits = (li) => [li.querySelector('.mk-prow-name').textContent, li.querySelector('.mk-prow-ver').textContent,
    ...[...li.querySelectorAll('.mk-prow-main .badge')].map((b) => b.textContent)];
  const adds = (i) => addsSummary(kindCounts(ADDED.plugins[i].inventory));
  assert.deepEqual(qa('li.mk-prow').map(bits), [
    ['bmf-models', '0.2.0', adds(0)],
    ['example-models', '0.4.0', adds(1), '1 note'],
    ['jira-source', '1.0.0', adds(2), secretsSummary(['pat'])]]);
  assert.equal(qa('li.mk-prow .mk-prow-ver.mk-mono').length, 0, 'versions are sans (SM30)');
  assert.deepEqual(qa('li.mk-prow > button').map((b) => [b.textContent, b.getAttribute('aria-label')]),
    [['Install', 'Install bmf-models'], ['Install', 'Install jira-source']]);
  assert.equal(qa('li.mk-prow')[1].querySelector(':scope > .mk-chip-ok').textContent, 'Installed');
  const disc = q('button.mk-disc');
  const notes = doc.getElementById(disc.getAttribute('aria-controls'));
  assert.deepEqual([disc.textContent, disc.getAttribute('aria-expanded'), notes.hidden], ['1 note from the manifest', 'false', true]);
  disc.click();
  assert.deepEqual([notes.hidden, notes.textContent],
    [false, 'example-models · models[0] ("example-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored']);
  assert.deepEqual(foot(), [['Add another', false], ['Browse these 3 plugins', false]]);
  h.dlg.close();
});

test('result: Install closes first and opens the plugin sheet; Browse these n filters Browse; Add another starts over', async () => {
  await checkRows([
    { name: 'Install', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(h);
      q('button[aria-label="Install jira-source"]').click();
      assert.deepEqual([h.dlg.isOpen(), h.acts[0][0], h.acts[0][1].key, h.acts[0][1].name], [false, 'openPlugin', `${EXAMPLE.id}/jira-source`, 'jira-source']);
    } },
    { name: 'Install acts on the page\'s own item when a read landed meanwhile (installed elsewhere: the sheet opens Manage) (cycle 6)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(h);
      const fresh = { key: `${EXAMPLE.id}/jira-source`, name: 'jira-source', installed: true };
      h.page.state.catalog = [{ key: `${OFFICIAL.id}/jira-source`, name: 'jira-source' }, fresh];
      q('button[aria-label="Install jira-source"]').click();
      assert.deepEqual([h.dlg.isOpen(), h.acts[0][0]], [false, 'openPlugin']);
      assert.equal(h.acts[0][1], fresh);
    } },
    { name: 'Browse these n', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(h);
      q('.mk-add-primary').click();
      assert.deepEqual([h.dlg.isOpen(), h.acts], [false, [['browse', { from: EXAMPLE.id }]]]);
    } },
    { name: 'Add another', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(h);
      q('.mk-add-secondary').click();
      const input = doc.getElementById('mk-add-url');
      assert.deepEqual([D().dataset.state, input.value, doc.activeElement === input, foot()], ['idle', '', true, [['Cancel', false], ['Add', true]]]);
      h.dlg.close();
    } },
    { name: 'one plugin / none', run: async () => {
      const one = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(one, { ...ADDED, plugins: [ADDED.plugins[0]], warnings: [] });
      assert.deepEqual(foot(), [['Add another', false], ['Browse 1 plugin', false]]);
      one.dlg.close();
      const none = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(none, { ...ADDED, plugins: [], warnings: [] });
      assert.deepEqual([foot(), q('ul.mk-plist')], [[['Add another', false], ['Done', false]], null]);
      q('.mk-add-primary').click(); assert.equal(none.dlg.isOpen(), false);
    } },
  ]);
});

test('errors stay in the dialog: Already added, Can’t reach, Needs git, 400, any other failure (F10)', async () => {
  const EXISTS = { error: 'marketplace already added: https://github.com/SinishaDjukic/worca-cc', code: 'EXISTS', existing: { id: OFFICIAL.id, name: 'Worca CC Official' } };
  const sameAsExists = (h) => {
    assert.equal(D().dataset.state, 'error');
    assert.deepEqual([q('.mk-add-msg .mk-wash-text').textContent, q('.mk-add-msg .mk-chip-built').textContent, q('.mk-add-msg').classList.contains('mk-wash-bad')],
      ['Already added as Worca CC Official', 'Built-in', false]);
    assert.equal(doc.getElementById('mk-add-url').readOnly, false);
    assert.deepEqual(foot(), [['Cancel', false], ['Open it', false]]);
    assert.equal(q('.mk-add-msg').getAttribute('role'), 'alert', 'the reason is read out: the focus lands on Open it (cycle 5)');
    q('.mk-add-primary').click();
    assert.deepEqual([h.focused, h.dlg.isOpen(), h.loads()], [[OFFICIAL.id], false, 0]);
  };
  await checkRows([
    { name: 'EXISTS answered at once (Built-in from page state, SM7)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': R(409, EXISTS) } });
      h.dlg.open(); type('SinishaDjukic/worca-cc'); await submit(); sameAsExists(h);
    } },
    { name: 'EXISTS from the job (caught after the sync)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('SinishaDjukic/worca-cc'); await submit();
      h.dlg.onJob(job({ state: 'error', code: 'EXISTS', error: EXISTS.error, existing: EXISTS.existing })); await settle(); sameAsExists(h);
    } },
    { name: 'EXISTS for a marketplace this page never read: Open it reads the page again (cycle 5)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': R(409, { error: `marketplace already added: ${EXAMPLE.url}`, code: 'EXISTS', existing: { id: EXAMPLE.id, name: EXAMPLE.name } }) } });
      h.dlg.open(); type('example/worca-marketplace'); await submit();
      assert.deepEqual([q('.mk-add-msg .mk-wash-text').textContent, q('.mk-add-msg .mk-chip-built')], [`Already added as ${EXAMPLE.name}`, null]);
      q('.mk-add-primary').click(); await settle();
      assert.deepEqual([h.focused, h.dlg.isOpen(), h.loads()], [[EXAMPLE.id], false, 1]);
    } },
    { name: 'UNREACHABLE: red wash, field refocused, Try again re-adds', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED({ url: 'acme/worca-plugins' }) } });
      h.dlg.open(); type('acme/worca-plugins'); await submit();
      h.dlg.onJob(job({ url: 'acme/worca-plugins', state: 'error', phase: 'fetching', resolvedUrl: 'https://github.com/acme/worca-plugins', code: 'UNREACHABLE', error: 'HTTP 403' })); await settle();
      const msg = q('.mk-add-msg');
      assert.deepEqual([msg.classList.contains('mk-wash-bad'), msg.getAttribute('role'), q('.mk-add-msg .mk-wash-text').textContent, q('.mk-add-msg-detail').textContent],
        [true, 'alert', 'Can’t reach github.com/acme/worca-plugins', 'HTTP 403']);
      assert.equal(q('.mk-add-msg .mk-wash-text > .mk-mono').textContent, 'github.com/acme/worca-plugins', 'the url is mono (board 2.3)');
      const input = doc.getElementById('mk-add-url');
      assert.deepEqual([input.readOnly, doc.activeElement === input, h.polls.length, foot()], [false, true, 0, [['Cancel', false], ['Try again', false]]]);
      await submit();
      assert.deepEqual(h.calls.map((c) => c[2]), [{ url: 'acme/worca-plugins', progress: true }, { url: 'acme/worca-plugins', progress: true }]);
      h.dlg.close();
    } },
    { name: 'SYNC_FAILED reads like Can’t reach, with the detail (SM4)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED({ url: 'acme/m' }) } });
      h.dlg.open(); type('acme/m'); await submit();
      h.dlg.onJob(job({ url: 'acme/m', resolvedUrl: 'https://github.com/acme/m', state: 'error', code: 'SYNC_FAILED', error: 'repository has no commits yet' })); await settle();
      assert.deepEqual([q('.mk-add-msg .mk-wash-text').textContent, q('.mk-add-msg-detail').textContent, foot()],
        ['Can’t reach github.com/acme/m', 'repository has no commits yet', [['Cancel', false], ['Try again', false]]]);
      h.dlg.close();
    } },
    { name: 'editing the field after an error goes back to Add', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': R(409, EXISTS) } });
      h.dlg.open(); type('SinishaDjukic/worca-cc'); await submit(); type('acme/other');
      assert.deepEqual([D().dataset.state, q('.mk-add-msg'), foot()], ['idle', null, [['Cancel', false], ['Add', false]]]);
      h.dlg.close();
    } },
    { name: 'GIT_MISSING (answered at once or ending the job): one Needs git chip, never a wash; typing removes it', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': R(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }) } });
      h.dlg.open(); type('https://gitlab.com/a/m'); await submit(); await submit();
      assert.deepEqual([qa('.pl-needs-git').map((c) => c.textContent), q('.mk-add-msg'), foot()], [['Needs git'], null, [['Cancel', false], ['Add', false]]]);
      assert.equal(D().closest('[data-needs-git]'), null);
      type('https://gitlab.com/a/n'); assert.equal(q('.pl-needs-git'), null);
      h.dlg.close();
      const late = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      late.dlg.open(); type('acme/m'); await submit();
      late.dlg.onJob(job({ state: 'error', code: 'GIT_MISSING', error: 'git is not installed on this machine' })); await settle();
      assert.deepEqual([qa('.pl-needs-git').length, D().dataset.state], [1, 'idle']);
      late.dlg.close();
    } },
    { name: '400: the field says why', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': R(400, { error: 'not a git repository: /tmp/nope' }) } });
      h.dlg.open(); type('/tmp/nope'); await submit();
      assert.deepEqual([D().dataset.state, q('.field-error .fe-text').textContent, doc.getElementById('mk-add-url').getAttribute('aria-invalid'), foot()],
        ['idle', 'not a git repository: /tmp/nope', 'true', [['Cancel', false], ['Add', false]]]);
      h.dlg.close();
    } },
    { name: 'any other failure: the server\'s words in the wash, Try again', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      h.dlg.onJob(job({ state: 'error', code: 'ERROR', error: 'marketplaces.json is locked' })); await settle();
      assert.deepEqual([q('.mk-add-msg').classList.contains('mk-wash-bad'), q('.mk-add-msg .mk-wash-text').textContent, q('.mk-add-msg-detail'), foot()],
        [true, 'marketplaces.json is locked', null, [['Cancel', false], ['Try again', false]]]);
      h.dlg.close();
      const off = harness();
      off.dlg.open(); type('acme/m'); await submit();
      assert.equal(q('.mk-add-msg .mk-wash-text').textContent, 'Worca did not answer (offline).');
      off.dlg.close();
    } },
  ]);
});

test('a single plugin folder is linked at once; the dialog reports it (U4, L1)', async () => {
  const ROW = row('release-notes', { version: '0.1.0', linked: true,
    contributions: { agents: 2, scripts: 0, taskSources: 0, chatChannels: 0, models: 0, mcpServers: 0, skills: 1, workflows: 1 } });
  const h = harness({ answers: { 'POST /api/marketplaces': R(200, { ok: true, linked: true,
    plugin: { name: 'release-notes', dir: '/Users/dp/exports/release-notes', workflows: { imported: ['Release notes'], skipped: [] } } }) },
    onLoad: (page) => { page.state.plugins = [ROW]; } });
  h.dlg.open(); type('/Users/dp/exports/release-notes'); await submit();
  assert.deepEqual([h.loads(), D().dataset.state, q('#mk-add-title').textContent], [1, 'linked', 'Added release-notes']);
  assert.deepEqual([...q('.mk-add-meta').children].map((c) => c.textContent).filter(Boolean), ['/Users/dp/exports/release-notes']);
  assert.equal(q('.mk-add-meta > .mk-add-path').textContent, '/Users/dp/exports/release-notes', 'only the path wraps');
  assert.deepEqual(qa('li.mk-prow').map((li) => [li.querySelector('.mk-prow-name').textContent, li.querySelector('.mk-prow-ver').textContent,
    ...[...li.querySelectorAll('.badge')].map((b) => b.textContent)]), [['release-notes', '0.1.0', 'linked', addsSummary(kindCounts(ROW))]]);
  assert.deepEqual([qa('li.mk-prow button').length, foot()], [0, [['Done', false]]]);
  q('.mk-add-primary').click(); assert.equal(h.dlg.isOpen(), false);
});

test('Cancel closes while the add runs (L6); the poll is the fallback for a quiet socket; open({ url }) adds at once', async () => {
  await checkRows([
    { name: 'cancel: later frames are ignored', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      q('.mk-add-secondary').click();
      assert.deepEqual([h.dlg.isOpen(), h.polls.length], [false, 0]);
      h.dlg.onJob(job({ state: 'done', phase: 'saved', marketplace: ADDED })); await settle();
      assert.deepEqual([h.dlg.isOpen(), h.loads()], [false, 0]);
    } },
    { name: 'poll', run: async () => {
      let n = 0;
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED(),
        [`GET /api/marketplaces/jobs/${JOB}`]: () => R(200, { job: (n += 1) === 1
          ? job({ phase: 'checking', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha })
          : job({ state: 'done', phase: 'saved', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, marketplace: ADDED }) }) } });
      h.dlg.open(); type('example/worca-marketplace'); await submit();
      const poll = h.polls[0].fn;
      await poll(); await settle();
      assert.equal(q('li[aria-current="step"]').textContent, 'Checking what each plugin asks for');
      await poll(); await settle();
      assert.equal(D().dataset.state, 'result');
      h.dlg.close();
    } },
    { name: 'a vanished job ends inside the dialog', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED(), [`GET /api/marketplaces/jobs/${JOB}`]: R(404, { error: 'marketplace add job not found' }) } });
      h.dlg.open(); type('acme/m'); await submit();
      await h.polls[0].fn(); await settle();
      assert.deepEqual([q('.mk-add-msg .mk-wash-text').textContent, foot()], ['marketplace add job not found', [['Cancel', false], ['Try again', false]]]);
      h.dlg.close();
    } },
    { name: 'open({ url }) from the empty state adds at once', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED({ url: 'acme/worca-plugins' }) } });
      h.dlg.open({ url: 'acme/worca-plugins' }); await settle();
      assert.deepEqual([h.calls[0][2], doc.getElementById('mk-add-url').value, D().dataset.state],
        [{ url: 'acme/worca-plugins', progress: true }, 'acme/worca-plugins', 'adding']);
      h.dlg.close();
    } },
  ]);
});

test('focus, the guard kind, late answers and leaving the page stay right (refine killers)', async () => {
  const EXISTS = R(409, { error: 'marketplace already added', code: 'EXISTS', existing: { id: OFFICIAL.id, name: 'Worca CC Official' } });
  const esc = () => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const go = async (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  await checkRows([
    { name: 'focus: Cancel while adding, the primary on the result, Open it on EXISTS', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      assert.equal(doc.activeElement, q('.mk-add-secondary'));
      h.dlg.onJob(job({ state: 'done', phase: 'saved', marketplace: ADDED })); await settle();
      assert.equal(doc.activeElement, q('.mk-add-primary'));
      h.dlg.close();
      const x = harness({ answers: { 'POST /api/marketplaces': EXISTS } });
      x.dlg.open(); type('SinishaDjukic/worca-cc'); await submit();
      assert.equal(doc.activeElement, q('.mk-add-primary'));
      x.dlg.close();
    } },
    { name: 'typing after an error keeps focus in the field', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': EXISTS } });
      h.dlg.open(); type('SinishaDjukic/worca-cc'); await submit();
      const input = doc.getElementById('mk-add-url');
      input.focus(); type('acme/other');
      assert.equal(doc.activeElement, input);
      h.dlg.close();
    } },
    { name: 'Escape closes while adding (decision); a typed idle asks first (form)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      esc(); await settle();
      assert.equal(h.dlg.isOpen(), false);
      const t = harness();
      t.dlg.open(); type('acme/m'); esc(); await settle();
      const ask = doc.querySelector('dialog.discard-modal');
      assert.deepEqual([t.dlg.isOpen(), !!ask], [true, true]);
      ask?.querySelector('.discard-keep').click(); t.dlg.close();
    } },
    { name: 'Add another: a field typed in and cleared again is no change, so Escape closes without asking (cycle 4)', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      await toResult(h);
      q('.mk-add-secondary').click();
      type('a'); type('');
      esc(); await settle();
      assert.deepEqual([h.dlg.isOpen(), doc.querySelector('dialog.discard-modal')], [false, null]);
    } },
    { name: 'the job ends once: a second done frame loads nothing', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      const done = job({ state: 'done', phase: 'saved', marketplace: ADDED });
      h.dlg.onJob(done); h.dlg.onJob(done); await settle();
      assert.equal(h.loads(), 1);
      h.dlg.close();
    } },
    { name: 'a done job without its marketplace ends in the dialog, never on Adding…', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      h.dlg.onJob(job({ state: 'done', phase: 'saved', marketplace: null })); await settle();
      assert.deepEqual([h.loads(), D().dataset.state, q('.mk-add-msg.mk-wash-bad .mk-wash-text').textContent, foot()],
        [1, 'error', 'add failed', [['Cancel', false], ['Try again', false]]]);
      h.dlg.close();
    } },
    { name: 'a late answer or a late result never lands in the next dialog', run: async () => {
      let answer = null;
      const h = harness({ answers: { 'POST /api/marketplaces': () => new Promise((r) => { answer = r; }) } });
      h.dlg.open(); type('acme/m'); q('.mk-add-primary').click(); await settle();
      h.dlg.close(); h.dlg.open();
      answer(R(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' })); await settle();
      assert.deepEqual([D().dataset.state, qa('.pl-needs-git').length], ['idle', 0]);
      h.dlg.close();
      const g = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      g.dlg.open(); type('acme/m'); await submit();
      g.dlg.onJob(job({ state: 'done', phase: 'saved', marketplace: ADDED })); g.dlg.open(); await settle();
      assert.equal(D().dataset.state, 'idle');
      g.dlg.close();
    } },
    { name: 'a field error goes when the add is sent again', run: async () => {
      let n = 0;
      const h = harness({ answers: { 'POST /api/marketplaces': () => ((n += 1) === 1 ? R(400, { error: 'not a git repository: /tmp/nope' }) : ACCEPTED()) } });
      h.dlg.open(); type('/tmp/nope'); await submit(); await submit();
      assert.deepEqual([D().dataset.state, q('.field-error')], ['adding', null]);
      h.dlg.close();
    } },
    { name: 'one poll at a time', run: async () => {
      let release = null;
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED(), [`GET /api/marketplaces/jobs/${JOB}`]: () => new Promise((r) => { release = r; }) } });
      h.dlg.open(); type('acme/m'); await submit();
      const p1 = h.polls[0].fn(); const p2 = h.polls[0].fn();
      assert.equal(h.calls.filter((c) => c[0] === 'GET').length, 1);
      release(R(200, { job: job({ phase: 'fetching' }) })); await p1; await p2;
      h.dlg.close();
    } },
    { name: 'SM70: leaving #marketplace closes the dialog without asking', run: async () => {
      const h = harness();
      h.dlg.open(); type('acme/m');
      await go('#settings');
      assert.deepEqual([h.dlg.isOpen(), D(), doc.querySelector('dialog.discard-modal')], [false, null, null]);
      await go('');
    } },
    { name: 'SM70: moving inside #marketplace keeps the dialog open', run: async () => {
      const h = harness();
      h.dlg.open(); type('acme/m');
      await go('#marketplace/marketplaces');
      assert.equal(h.dlg.isOpen(), true);
      h.dlg.close();
      await go('');
      assert.equal(window.location.hash, '');
    } },
  ]);
});

test('SM70: every #marketplace address keeps the dialog open (Browse, Installed), only leaving closes it (refine killer)', async () => {
  const go = async (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  const h = harness();
  h.dlg.open(); type('acme/m');
  await go('#marketplace');
  await go('#marketplace/installed');
  assert.deepEqual([h.dlg.isOpen(), doc.getElementById('mk-add-url')?.value], [true, 'acme/m']);
  await go('#runs');
  assert.equal(h.dlg.isOpen(), false);
  await go('');
});

test('a close after the opener left the page puts the focus on the header\'s Add marketplace, never <body> (cycle 2 killer)', async () => {
  const root = doc.createElement('div');
  root.id = 'mk-root';
  const actions = doc.createElement('div');
  actions.className = 'mk-head-actions';
  const add = doc.createElement('button');
  add.className = 'btn btn-primary mk-add-mkt';
  actions.append(add);
  root.append(actions);
  doc.body.append(root);
  try {
    await checkRows([
      { name: 'the opener is still there: focus goes back to it', run: async () => {
        const opener = doc.createElement('button');
        doc.body.append(opener);
        const h = harness();
        h.dlg.open({ opener });
        q('.mk-dlg-close').click();
        assert.equal(doc.activeElement, opener);
        opener.remove();
      } },
      { name: 'the opener left with a render: focus lands on the header\'s Add marketplace', run: async () => {
        const opener = doc.createElement('button');
        doc.body.append(opener);
        const h = harness();
        h.dlg.open({ opener });
        opener.remove();
        q('.mk-add-secondary').click();
        assert.equal(doc.activeElement, add);
      } },
    ]);
  } finally {
    root.remove();
  }
});

test('frames that land before the 202 are kept: the dialog starts from the furthest one, and never steps back (cycle 3)', async () => {
  const late = (answer) => { let release; const p = new Promise((r) => { release = () => r(answer); }); return { fn: () => p, release: () => release() }; };
  await checkRows([
    { name: 'a fetching frame that beat the 202 is current at once, with its sha', run: async () => {
      const post = late(ACCEPTED());
      const h = harness({ answers: { 'POST /api/marketplaces': post.fn } });
      h.dlg.open(); type('example/worca-marketplace'); q('.mk-add-primary').click(); await settle();
      h.dlg.onJob(job({ id: 'mkt_ffffffff', phase: 'checking' }));                 // another tab's job: never shown
      h.dlg.onJob(job({ phase: 'fetching', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha }));
      h.dlg.onJob(job({ phase: 'resolving' }));                                      // an older frame never steps back
      assert.equal(q('li[aria-current="step"]').textContent, 'Found example/worca-marketplace', 'nothing paints before the answer');
      post.release(); await settle();
      assert.deepEqual([q('li[aria-current="step"]').textContent, h.polls.length], ['Fetched 16b6363', 1]);
      h.dlg.close();
    } },
    { name: 'a job that ended before its 202 ends the dialog at once: no poll, one load', run: async () => {
      const post = late(ACCEPTED());
      const h = harness({ answers: { 'POST /api/marketplaces': post.fn } });
      h.dlg.open(); type('example/worca-marketplace'); q('.mk-add-primary').click(); await settle();
      h.dlg.onJob(job({ phase: 'saved', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha }));   // core's last phase, still running
      h.dlg.onJob(job({ state: 'done', phase: 'saved', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, marketplace: ADDED }));
      post.release(); await settle();
      assert.deepEqual([D().dataset.state, h.polls.length, h.loads()], ['result', 0, 1]);
      h.dlg.close();
    } },
    { name: 'a joined job: the 202 snapshot is further on than an early frame, so it wins', run: async () => {
      const post = late(ACCEPTED({ phase: 'reading', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha }));
      const h = harness({ answers: { 'POST /api/marketplaces': post.fn } });
      h.dlg.open(); type('example/worca-marketplace'); q('.mk-add-primary').click(); await settle();
      h.dlg.onJob(job({ phase: 'fetching', resolvedUrl: EXAMPLE.url }));
      post.release(); await settle();
      assert.equal(q('li[aria-current="step"]').textContent, 'Reading plugins…');
      h.dlg.close();
    } },
    { name: 'a poll answer that lost the race with the socket never moves the lines back; a later phase still lands', run: async () => {
      let polled = job({ phase: 'fetching', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha });
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED(), [`GET /api/marketplaces/jobs/${JOB}`]: () => R(200, { job: polled }) } });
      h.dlg.open(); type('example/worca-marketplace'); await submit();
      h.dlg.onJob(job({ phase: 'fetching', resolvedUrl: EXAMPLE.url }));
      h.dlg.onJob(job({ phase: 'fetching', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha }));   // the same phase, with more: painted
      assert.equal(q('li[aria-current="step"]').textContent, 'Fetched 16b6363');
      h.dlg.onJob(job({ phase: 'checking', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, done: 1, total: 3 }));
      await h.polls[0].fn(); await settle();
      assert.equal(q('li[aria-current="step"]').textContent, 'Checking what each plugin asks for');
      polled = job({ state: 'done', phase: 'saved', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, marketplace: ADDED });
      await h.polls[0].fn(); await settle();
      assert.equal(D().dataset.state, 'result');
      h.dlg.close();
    } },
    { name: 'frames kept for a refused add are dropped with it', run: async () => {
      const post = late(R(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }));
      const h = harness({ answers: { 'POST /api/marketplaces': post.fn } });
      h.dlg.open(); type('acme/m'); q('.mk-add-primary').click(); await settle();
      h.dlg.onJob(job({ phase: 'fetching' }));
      post.release(); await settle();
      h.dlg.onJob(job({ state: 'done', phase: 'saved', marketplace: ADDED })); await settle();
      assert.deepEqual([D().dataset.state, h.loads(), qa('.pl-needs-git').length], ['idle', 0, 1]);
      h.dlg.close();
    } },
  ]);
});

test('a job ends once, late reloads, the fields and marks each view leaves, and focus after Adding… (cycle 6)', async () => {
  const LINKED = R(200, { ok: true, linked: true, plugin: { name: 'release-notes', dir: '/x/release-notes' } });
  const input = () => doc.getElementById('mk-add-url');
  const busyOf = () => { const p = q('.mk-add-primary'); return [p.classList.contains('is-busy'), p.dataset.fbState ?? null, p.getAttribute('aria-busy')]; };
  await checkRows([
    { name: 'a poll answer that lands after the socket ended the job changes nothing, a 404 included', run: async () => {
      let release = null;
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED(), [`GET /api/marketplaces/jobs/${JOB}`]: () => new Promise((r) => { release = r; }) } });
      h.dlg.open(); type('acme/m'); await submit();
      const p = h.polls[0].fn();
      h.dlg.onJob(job({ state: 'done', phase: 'saved', marketplace: ADDED })); await settle();
      release(R(404, { error: 'marketplace add job not found' })); await p; await settle();
      assert.deepEqual([D().dataset.state, q('.mk-add-msg'), h.loads()], ['result', null, 1]);
      h.dlg.close();
    } },
    { name: 'an error frame that beat the 202 ends the dialog when the 202 snapshot is at the same phase', run: async () => {
      let release = null;
      const answer = new Promise((r) => { release = () => r(ACCEPTED()); });
      const h = harness({ answers: { 'POST /api/marketplaces': () => answer } });
      h.dlg.open(); type('acme/m'); q('.mk-add-primary').click(); await settle();
      h.dlg.onJob(job({ state: 'error', phase: 'resolving', code: 'ERROR', error: 'marketplaces.json is locked' }));
      release(); await settle();
      assert.deepEqual([D().dataset.state, q('.mk-add-msg .mk-wash-text')?.textContent, h.polls.length], ['error', 'marketplaces.json is locked', 0]);
      h.dlg.close();
    } },
    { name: 'a reload that outlives its dialog never paints into the next one', run: async () => {
      for (const answer of [LINKED, R(200, { ok: true, marketplace: ADDED })]) {
        const h = harness({ answers: { 'POST /api/marketplaces': answer } });
        let loaded = null;
        h.page.load = () => new Promise((r) => { loaded = r; });
        h.dlg.open(); type('acme/m'); await submit();
        h.dlg.close(); h.dlg.open();
        loaded(); await settle();
        assert.deepEqual([D().dataset.state, q('#mk-add-title').textContent], ['idle', 'Add marketplace']);
        h.dlg.close();
      }
    } },
    { name: 'an answer at once paints from the reloaded page: the linked row\'s version and adds, the result\'s Installed', run: async () => {
      const ROW = row('release-notes', { version: '0.1.0', linked: true,
        contributions: { agents: 2, scripts: 0, taskSources: 0, chatChannels: 0, models: 0, mcpServers: 0, skills: 1, workflows: 1 } });
      const lk = harness({ answers: { 'POST /api/marketplaces': LINKED } });
      lk.page.load = async () => { await tick(); lk.page.state.plugins = [ROW]; };
      lk.dlg.open(); type('/x/release-notes'); await submit();
      assert.deepEqual([...q('li.mk-prow').querySelectorAll('.mk-prow-ver, .badge')].map((b) => b.textContent), ['0.1.0', 'linked', addsSummary(kindCounts(ROW))]);
      lk.dlg.close();
      const mk = harness({ answers: { 'POST /api/marketplaces': R(200, { ok: true, marketplace: ADDED }) } });
      mk.page.load = async () => { await tick(); mk.page.state.plugins = [row('jira-source')]; };
      mk.dlg.open(); type('example/worca-marketplace'); await submit();
      const jira = qa('li.mk-prow').find((li) => li.dataset.name === 'jira-source');
      assert.deepEqual([jira.querySelector(':scope > .mk-chip-ok')?.textContent, jira.querySelector('button')], ['Installed', null]);
      mk.dlg.close();
    } },
    { name: 'every view after Adding… frees the field and the primary, and keeps the focus inside the dialog', run: async () => {
      const a = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      a.dlg.open(); type('acme/m'); await submit();
      assert.deepEqual(busyOf(), [true, 'busy', 'true']);
      a.dlg.onJob(job({ state: 'error', code: 'UNREACHABLE', error: 'HTTP 403' })); await settle();
      assert.deepEqual(busyOf(), [false, null, null]);
      a.dlg.close();
      for (const answer of [R(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }), R(400, { error: 'not a git repository: /tmp/nope' })]) {
        const h = harness({ answers: { 'POST /api/marketplaces': answer } });
        h.dlg.open(); type('/tmp/nope'); await submit();
        assert.deepEqual([input().readOnly, doc.activeElement === input(), busyOf()], [false, true, [false, null, null]], answer.data.code || '400');
        h.dlg.close();
      }
      const lk = harness({ answers: { 'POST /api/marketplaces': LINKED } });
      lk.dlg.open(); type('/x/release-notes'); await submit();
      assert.equal(doc.activeElement, q('.mk-add-primary'), 'Cancel left the foot: the focus is on Done, never <body>');
      lk.dlg.close();
      assert.deepEqual([lk.dlg.isOpen(), D()], [false, null]);
    } },
    { name: 'the field: Enter while an IME composes adds nothing; the url sent is trimmed', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('  acme/m  ');
      input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); await settle();
      assert.equal(h.calls.length, 0, 'an IME confirming its text is not a submit');
      await submit();
      assert.deepEqual(h.calls.map((c) => c[2]), [{ url: 'acme/m', progress: true }]);
      h.dlg.close();
    } },
    { name: 'progress marks: a check per done line, a spinner on the current one, a dot per pending one; a running "saved" frame marks all four done', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
      h.dlg.open(); type('acme/m'); await submit();
      h.dlg.onJob(job({ phase: 'fetching', resolvedUrl: EXAMPLE.url }));
      const marks = () => qa('ol.mk-progress > li').map((li) => [li.dataset.state, li.firstElementChild.className]);
      assert.deepEqual(marks(), [['done', 'ic'], ['current', 'mk-phase-spin'], ['pending', 'mk-phase-dot'], ['pending', 'mk-phase-dot']]);
      h.dlg.onJob(job({ phase: 'checking', resolvedUrl: EXAMPLE.url }));
      h.dlg.onJob(job({ phase: 'saved', resolvedUrl: EXAMPLE.url }));
      assert.deepEqual([marks().map((m) => m[0]), q('li[aria-current="step"]')], [['done', 'done', 'done', 'done'], null]);
      h.dlg.close();
    } },
    { name: 'Install: the dialog is gone before the plugin sheet opens; Done at 0 plugins only closes', run: async () => {
      const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(h);
      let openAtAct = null;
      h.page.act = () => { openAtAct = h.dlg.isOpen(); };
      q('button[aria-label="Install jira-source"]').click();
      assert.equal(openAtAct, false);
      const none = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(none, { ...ADDED, plugins: [], warnings: [] });
      q('.mk-add-primary').click();
      assert.deepEqual([none.dlg.isOpen(), none.acts], [false, []]);
    } },
    { name: 'a folder marketplace\'s result shows the folder icon the linked view shows, never the git one', run: async () => {
      const lk = harness({ answers: { 'POST /api/marketplaces': LINKED } });
      lk.dlg.open(); type('/x/release-notes'); await submit();
      const folder = q('.mk-add-meta > .ic').innerHTML;
      lk.dlg.close();
      const fold = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } }); await toResult(fold, { ...ADDED, url: '/Users/dp/mkt' });
      assert.deepEqual([q('.mk-add-meta > .mk-add-path').textContent, q('.mk-add-meta > .ic').innerHTML === folder], ['/Users/dp/mkt', true]);
      fold.dlg.close();
    } },
    { name: 'Adding… again after Needs git drops the chip; a vanished job stops its poll; Open it on an unread marketplace reads in the background', run: async () => {
      let n = 0;
      const g = harness({ answers: { 'POST /api/marketplaces': () => ((n += 1) === 1 ? R(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }) : ACCEPTED()) } });
      g.dlg.open(); type('https://gitlab.com/a/m'); await submit(); await submit();
      assert.deepEqual([D().dataset.state, qa('.pl-needs-git').length], ['adding', 0]);
      g.dlg.close();
      const v = harness({ answers: { 'POST /api/marketplaces': ACCEPTED(), [`GET /api/marketplaces/jobs/${JOB}`]: R(404, { error: 'marketplace add job not found' }) } });
      v.dlg.open(); type('acme/m'); await submit();
      await v.polls[0].fn(); await settle();
      assert.equal(v.polls.length, 0, 'the vanished job stops its poll');
      v.dlg.close();
      const loads = [];
      const x = harness({ answers: { 'POST /api/marketplaces': R(409, { error: 'marketplace already added', code: 'EXISTS', existing: { id: EXAMPLE.id, name: EXAMPLE.name } }) } });
      x.page.load = async (o) => { loads.push(o); };
      x.dlg.open(); type('example/worca-marketplace'); await submit();
      q('.mk-add-primary').click(); await settle();
      assert.deepEqual(loads, [{ background: true }]);
    } },
  ]);
});

test('P7 CSS: progress lines stay readable and whole; long titles wrap; the card name sits on the actions row (cycle 2); the meta line\'s icon stays by its path (cycle 3); a field error\'s long path wraps (cycle 4); the result fits a 290px screen and the spinner keeps its gap in forced colours (cycle 5)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* ── marketplace P7 ── */'));
  const rule = (sel) => {
    const at = block.indexOf(`\n${sel}{`);
    assert.ok(at >= 0, sel);
    return block.slice(at + sel.length + 2, block.indexOf('}', at));
  };
  assert.doesNotMatch(block, /var\(--ink-3\)/, 'no --ink-3 text on the --field ground (2.58:1 in light)');
  assert.doesNotMatch(rule('.mk-phase'), /overflow-wrap/, 'the label (an anonymous flex item) never breaks per letter');
  assert.equal(rule('.mk-phase .mk-mono'), 'min-width:0;font-size:var(--fs-meta);color:var(--ink);overflow-wrap:anywhere;');
  assert.equal(rule('.mk-mkt .mk-mkt-name'), 'margin:0;overflow-wrap:anywhere;', 'beats .card h2\'s 18px bottom margin');
  assert.equal(rule('#mk-dialog[data-kind="add-marketplace"] > .mk-dialog-head > .section-title'), 'min-width:0;overflow-wrap:anywhere;');
  assert.equal(rule('.mk-add-field'), 'margin:0;');
  assert.equal(rule('.mk-add-field .fe-text'), 'min-width:0;overflow-wrap:anywhere;', 'a 400 naming a long path never widens the dialog past the screen');
  assert.doesNotMatch(rule('.mk-add-meta'), /flex-wrap/, 'one line: a wrap would leave the icon alone above a long path');
  assert.equal(rule('.mk-add-meta > .mk-add-path'), 'min-width:0;overflow-wrap:anywhere;');
  assert.equal(rule('.mk-add-meta > :not(.mk-add-path)'), 'flex:none;');
  // Under ~390px the one-line result foot and plugin rows widened the dialog past the screen (cycle 5, measured at 290).
  assert.equal(rule('#mk-dialog[data-kind="add-marketplace"] > .mk-dialog-foot'), 'flex-wrap:wrap;');
  assert.equal(rule('.mk-plist > .mk-prow'), 'flex-wrap:wrap;');
  assert.equal(rule('.mk-plist > .mk-prow > .mk-prow-main'), 'flex:1 1 120px;');
  assert.equal(rule('.mk-plist > .mk-prow > :last-child:not(.mk-prow-main)'), 'margin-left:auto;');
  assert.ok(block.includes('\n@media (forced-colors:active){.mk-phase-spin{border-right-color:Canvas;}}'), 'the current step keeps its open ring');
});

test('frames that change no line leave the progress list in place; Try again paints its own lines (fix cycle 1, m1)', async () => {
  const h = harness({ answers: { 'POST /api/marketplaces': ACCEPTED() } });
  h.dlg.open(); type('example/worca-marketplace'); await submit();
  const checking = (done) => job({ phase: 'checking', resolvedUrl: EXAMPLE.url, sha: EXAMPLE.lastSync.sha, done, total: 3, plugin: `p${done}` });
  h.dlg.onJob(checking(1));
  const before = qa('ol.mk-progress > li');
  h.dlg.onJob(checking(2));
  h.dlg.onJob(checking(2));   // the poll's copy of the socket frame
  assert.deepEqual(qa('ol.mk-progress > li').map((li, i) => li === before[i]), [true, true, true, true], 'the same li nodes');
  h.dlg.onJob(job({ state: 'error', code: 'SYNC_FAILED', error: 'boom', resolvedUrl: EXAMPLE.url })); await settle();
  q('.mk-add-primary').click(); await settle();   // Try again
  assert.equal(D().dataset.state, 'adding');
  assert.deepEqual(qa('ol.mk-progress > li').map((l) => l.dataset.state), ['current', 'pending', 'pending', 'pending'], 'a new attempt paints its own lines');
  h.dlg.close();
});
