// test/ui-git-hide-set.test.mjs (part 1) — the shell's git-only markup carries data-needs-git and is gated at first
// paint while git is off; the U2a surfaces never are.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const MARKUP = ['#branch-fields', '#proj-add-tab-clone', '#sync-settings-card', '#actions-settings-card', '.rd-page-branch',
  '.retained-banner', '.rd-pr-box', '.rd-base', '.rd-branch-copy', '.rd-sync', '.merge-back-banner', '.hist-merge', '.hd-pr',
  '.hd-publish', '.hd-pr-link', '.hd-push', '.hd-published', '.hd-base-check', '.hd-pr-repos', '.hd-base', '.hd-branch-copy',
  '.wiz-import', '[data-pdest="marketplace"]', '#export-marketplace-field'];   // dev's git-spawning workspace import and #717 export
const KEPT = ['[data-nav="workspaces"]', '[data-nav="marketplace"]', '[data-nav="team-metrics"]', '[data-nav="team-policy"]',
  '#mk-root', '#proj-add-tab-folder', '#projectSelect'];
const doc = (git) => trackDom(new JSDOM(renderIndexHtml(html, 'system', 'expert', undefined, { git }))).window.document;
const gated = (el, d = el.ownerDocument) => d.documentElement.dataset.git === 'off' && !!el.closest('[data-needs-git]');
// The run and History pages are <template>s (#run-detail-tpl, #hist-detail-tpl): querySelectorAll never enters a
// template's content, whose nodes belong to an inert document — search every template too and read data-git off the shell.
const all = (d, s) => [d, ...[...d.querySelectorAll('template')].map((t) => t.content)].flatMap((r) => [...r.querySelectorAll(s)]);

test('hide set: static markup', async () => {
  await checkRows([
    { name: 'every git-only element is tagged and gated while off; none while on', run: () => {
      const off = doc(false); const on = doc(true);
      for (const s of MARKUP) {
        const els = all(off, s);
        assert.ok(els.length > 0, `${s} exists`);
        for (const e of els) assert.ok(gated(e, off), `${s} gated`);
        for (const e of all(on, s)) assert.ok(!gated(e, on), `${s} shown with git`);
      }
    } },
    { name: 'U2a and the rest stay', run: () => { const off = doc(false); for (const s of KEPT) assert.ok(!gated(off.querySelector(s)), s); } },
    { name: 'the Projects grid drops its sync column at every width', run: () => {
      assert.match(css, /:root\[data-git="off"\] #projects-list \.proj-cols,\n:root\[data-git="off"\] #projects-list \.pl-row\{grid-template-columns:minmax\(0,1fr\) var\(--pl-team-col\) 30px;\}/);
      assert.match(css, /:root\[data-git="off"\] #projects-list \.pl-row\{grid-template-areas:"proj team chev";\}/);
      assert.match(css, /@container pl-list \(max-width:1000px\)\{\s*:root\[data-git="off"\] #projects-list \.pl-row\{grid-template-columns:minmax\(0,1fr\) auto 30px;grid-template-areas:"proj team chev";\}/);
      assert.match(css, /@container pl-list \(max-width:560px\)\{\s*:root\[data-git="off"\] #projects-list \.pl-row\{grid-template-columns:minmax\(0,1fr\) auto;grid-template-areas:"proj chev" "team team";\}/);
    } },
  ]);
});

import { bootGitApp } from './helpers/git-app-boot.mjs';
import * as homeActions from '../ui/public/chat/home-actions.mjs';   // namespace: a missing ACTION_NEEDS_GIT is a row failure, not a link error
import { buildPullRequestCard } from '../ui/public/chat/action-cards.mjs';
import { renderFeature } from '../ui/public/shape/feature-view.mjs';
import { createSchedulesView } from '../ui/public/schedules-view.mjs';
const bootApp = (o = {}) => bootGitApp({ trackDom, ...o });
const appSrc = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');
const askSrc = readFileSync(fileURLToPath(new URL('../ui/public/ask-panel.mjs', import.meta.url)), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const pastCoalesce = () => new Promise((r) => setTimeout(r, 400));   // refreshSyncChips is coalesced (SYNC_CHIPS_MS = 300)

test('hide set: JS-built surfaces and requests', async () => {
  await checkRows([
    { name: 'Projects without git: no sync request; bars, filters, Checked and Sync all gated; Team stays', run: async () => {
      const { window, doc, calls } = await bootApp({ git: false });
      window.location.hash = 'projects'; await pastCoalesce();
      assert.ok(!calls.some((u) => u.startsWith('/api/sync/projects')));
      for (const s of ['.pl-sync', '.proj-filters', '.sync-checked', '#projects-sync-all', '.proj-cols-sync']) assert.ok(gated(doc.querySelector(s)), s);
      assert.ok(!gated(doc.querySelector('.pl-team')));
    } },
    { name: 'Add project without git and without a folder picker opens on New', run: async () => {
      const { window, doc } = await bootApp({ git: false });
      window.location.hash = 'projects'; await tick(); await tick();
      doc.querySelector('#project-add-btn').dispatchEvent(new window.Event('click', { bubbles: true })); for (let i = 0; i < 4; i++) await tick();
      assert.equal([...doc.querySelectorAll('#proj-add-tabs .md-tab')].find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.mode, 'new');
    } },
    { name: 'New workspace without git: the step 1 hint names no hidden Add… or paste box', run: async () => {
      const hint = async (git) => {
        const { window, doc } = await bootApp({ git });
        window.location.hash = 'workspace-create'; for (let i = 0; i < 8; i++) await tick();
        return doc.querySelector('#wiz-step1-hint').textContent;
      };
      assert.equal(await hint(false), 'Pick at least two projects.');
      assert.match(await hint(true), /Add… or the paste box/);
    } },
    { name: 'New run without git: picking a project asks for no branch list', run: async () => {
      const { window, doc, calls } = await bootApp({ git: false });
      window.location.hash = 'new'; for (let i = 0; i < 6; i++) await tick();
      const sel = doc.querySelector('#projectSelect');                   // a fresh boot selects nothing: pick the project
      sel.value = '/data/alpha'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      for (let i = 0; i < 6; i++) await tick();
      assert.ok(!calls.some((u) => u.startsWith('/api/branches')));
    } },
    { name: 'git arrives: the sync read happens without a reload (and not before)', run: async () => {
      const { window, calls, ws } = await bootApp({ git: false });
      window.location.hash = 'projects'; await pastCoalesce();
      assert.ok(!calls.some((u) => u.startsWith('/api/sync/projects')), 'nothing while git is missing');
      ws._msg({ type: 'git', git: { available: true, version: '2.47.0' } });
      await pastCoalesce();
      assert.ok(calls.some((u) => u.startsWith('/api/sync/projects')));
    } },
    { name: 'project page: Actions tab gated; a deep link opens Overview; git going missing moves an open Actions tab', run: async () => {
      const active = (doc) => doc.querySelector('.pd-tab.active')?.dataset.sec;
      const off = await bootApp({ git: false });
      off.window.location.hash = 'projects'; for (let i = 0; i < 6; i++) await tick();
      off.window.location.hash = 'projects/alpha-00000001/actions'; for (let i = 0; i < 10; i++) await tick();
      assert.ok(gated(off.doc.querySelector('#pd-tab-actions')));
      assert.equal(active(off.doc), 'overview');
      const on = await bootApp({ git: true });
      on.window.location.hash = 'projects'; for (let i = 0; i < 6; i++) await tick();
      on.window.location.hash = 'projects/alpha-00000001/actions'; for (let i = 0; i < 10; i++) await tick();
      assert.equal(active(on.doc), 'actions');
      on.ws._msg({ type: 'git', git: { available: false, version: null } }); await tick();
      assert.equal(active(on.doc), 'overview');
    } },
    { name: 'chat tile Explain a diff carries the gate; Add project does not', run: () => {
      const { document: d } = trackDom(new JSDOM('<!doctype html><html><body></body></html>')).window;
      const qa = homeActions.createQuickActions({ doc: d, deps: { setIntent: () => {} } });
      assert.deepEqual(homeActions.ACTION_NEEDS_GIT, ['diff']);
      const tagged = [...qa.el.querySelectorAll('[data-needs-git]')].map((b) => b.textContent);
      assert.deepEqual(tagged.sort(), ['Explain a diff']);
    } },
    { name: 'chat PR card buttons, Shape Ship as box and merge-order line carry the gate', run: () => {
      const { window: w } = trackDom(new JSDOM('<!doctype html><html><body></body></html>'));
      const ctx = { doc: w.document, win: w, threadId: () => 'ask_aaaaaaaa', postCard: async () => ({}), announce: () => {} };
      const pr = buildPullRequestCard({ kind: 'card', id: 'card_00000004', state: 'proposed',
        card: { type: 'pull-request', pipelineId: 'aaaa0005', projectKey: 'shop-1a2b3c4d', title: 'Fix login', branch: 'worca/fix-login', base: 'main' } }, ctx).el;
      assert.ok(pr.querySelector('.ask-mcard-actions').closest('[data-needs-git]'));
      const slices = [1, 2].map((index) => ({ index, title: `S${index}`, state: 'done', pipelineId: `p${index}`, pr: null }));
      const f = renderFeature(w.document, { id: 'f1', title: 'Add billing', status: 'done', total: 2, done: 2, approveEach: false, open: true, halted: null, slices,
        ship: { ready: true, mode: null, suggested: 'one', linesAdded: 10, prUrl: null } },
        { page: true, act: async () => ({ ok: true }), openSlice() {}, openRun() {}, confirm: async () => true });
      for (const s of ['.shape-feature-order', '.ask-shipcard']) assert.ok(f.querySelector(s)?.closest('[data-needs-git]'), s);
    } },
    { name: 'schedules view: no from <branch> / Feature branch while git is off', run: async () => {
      const { window: w } = trackDom(new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#schedules' }));
      for (const k of ['document', 'location', 'DOMParser']) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
      const at = new Date(Date.now() + 3600_000).toISOString();
      const ticket = { id: 't1', kind: 'once', scheduleId: null, title: 't1', runAt: at, scheduledFor: at, status: 'scheduled', ifMissed: 'run', graceMin: 360,
        summary: { target: 'project', workflowId: 'wf_default', prompt: 'p', source: null, sourceBranch: 'main', featureBranch: 'feat-x', mock: false } };
      const text = async (git) => {
        const prev = globalThis.fetch;
        globalThis.fetch = async (url) => ({ ok: true, status: 200,
          json: async () => (String(url).split('?')[0] === '/api/schedules' ? { schedules: [], tickets: [ticket], counts: {} } : { notifications: [], unread: 0 }) });
        const hosts = { feedHost: w.document.createElement('div'), onceHost: w.document.createElement('div'), repeatingHost: w.document.createElement('div') };
        w.document.body.replaceChildren(hosts.feedHost, hosts.onceHost, hosts.repeatingHost);
        const view = createSchedulesView({ ...hosts, msgEl: w.document.createElement('p'),
          deps: { confirmModal: async () => true, targetLabel: () => 'Project · shop', workflowLabel: () => 'Default', gitOn: () => git } });
        try { await view.load(); return hosts.onceHost.textContent; } finally { view.destroy(); globalThis.fetch = prev; }
      };
      assert.match(await text(true), /from main[\s\S]*Feature branch/);
      assert.doesNotMatch(await text(false), /from main|Feature branch/);
    } },
    { name: 'app.js / ask-panel wiring the boot cannot reach cheaply (source rows)', run: () => {
      for (const re of [/function prHostAvailable\(\) \{ return gitOn\(\) && /, /if \(t\.needsGit\) btn\.dataset\.needsGit = '';/,
        /base: gitOn\(\) \? baseRowNote\(p\.baseCheck\) : ''/, /function syncApplies\(\) \{\n  if \(!gitOn\(\)\) return false;/,
        /async function refreshSyncStatusQuiet\(\) \{\n  if \(!gitOn\(\)\) return;/,
        /levelAtLeast\(cells\.get\(k\)\.tab\.level \|\| 'simple'\) && \(gitOn\(\) \|\| !cells\.get\(k\)\.tab\.needsGit\)/,
        /if \(!box \|\| !list\) return;\n  if \(!gitOn\(\)\) \{ box\.hidden = true; return; \}/,
        /const pre = gitOn\(\) \? null : await pluginApi\('POST', '\/api\/plugins\/install', req\);\n\s+if \(pre && !pre\.ok && pre\.data && pre\.data\.code === 'GIT_MISSING'\) \{ err\.textContent = pre\.data\.error \|\| GIT_MISSING_TEXT; err\.hidden = false; if \(btn\) btn\.disabled = false; return; \}\n\s+closePluginModal\(\);/,
        /import \{[^}]*\bGIT_MISSING_TEXT\b[^}]*\} from '\.\/git-gate\.mjs';/,
        /if \(!gitOn\(\)\) for \(const k of \['sourceBranch', 'sourceBranchByKey', 'featureBranch', 'sameAsSource', 'sourceFromPrevious', 'syncBeforeStart', 'syncOnDiverged'\]\) delete body\[k\];/,
        /gitOn: \(\) => gitOn\(\),/,
        /const row = rdSheetRow\(\{ label: cell\.tab\.label, value, tab: key, icon: icon \? icon\.cloneNode\(true\) : null \}\);\n\s+if \(cell\.tab\.needsGit\) row\.dataset\.needsGit = '';/,
        /open\.textContent = 'Open the diff';\n\s+open\.dataset\.needsGit = '';/, /row\.className = 'hd-ov-wt';\n\s+row\.dataset\.needsGit = '';/]) assert.match(appSrc, re);
      for (const v of ['tab', 'want']) {   // setHdMode / setRdMode (tab) and the two wantTab hand-offs (want): deep links …/details/diff|actions
        const n = (appSrc.match(new RegExp(`levelAtLeast\\(tabs\\.cells\\.get\\(${v}\\)\\.tab\\.level \\|\\| 'simple'\\) && \\(gitOn\\(\\) \\|\\| !tabs\\.cells\\.get\\(${v}\\)\\.tab\\.needsGit\\)\\) tabs\\.activate\\(${v}\\);`, 'g')) || []).length;
        assert.equal(n, 2, `${v} activations gated: ${n}`);
      }
      for (const re of [/if \(!st\.worktrees\.length \|\| !gitOn\(doc\)\) return null;/, /const off = noBranches\(projSel\.value\);\n\s+for \(const f of \[srcField, featureField, sameField\]\) f\.hidden = off;\n\s+if \(!off\) loadBranchesInto\(srcSel, projSel\.value, want\)\.then\(updateTargetSub\); else updateTargetSub\(\);/, /=== 'folder' \|\| !gitOn\(doc\);/]) assert.match(askSrc, re);
      for (const key of ['diff', 'actions']) {
        const n = (appSrc.match(new RegExp(`key: '${key}'[^\\n]*needsGit: true`, 'g')) || []).length;
        assert.ok(n >= (key === 'diff' ? 2 : 4), `${key} tabs tagged: ${n}`);
      }
    } },
  ]);
});

// Part 3 — the plugin install sheet while git is off: the server decides (P6 installs GitHub repos over HTTPS
// without git), and its GIT_MISSING refusal stays inside the sheet (U17).
const MKT = { id: 'gh', url: 'https://github.com/acme/m', name: 'GH', builtin: false, warnings: [],
  lastSync: { sha: 'a'.repeat(40), at: '2026-10-01T00:00:00.000Z' }, plugins: [{ name: 'gh-plugin', subdir: 'p', inventory: {} }] };
const sheetOpen = (doc) => { const h = doc.getElementById('mk-sheet-host'); return !!h && !h.hidden && !h.classList.contains('hidden'); };
const sheetFoot = (doc) => [...doc.querySelectorAll('#mk-sheet .mk-sheet-foot [data-act]')].map((b) => b.textContent);
async function installScenario(git, answer) {
  const { window, doc } = await bootApp({ git });
  for (const k of ['Element', 'HTMLElement', 'Node', 'Event', 'CustomEvent']) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const posts = []; const seq = []; const base = window.fetch;
  const fake = (url, opts = {}) => {
    const u = String(url); seq.push(u);
    const j = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.startsWith('/api/plugins/install')) { posts.push(JSON.parse(opts.body)); return j(answer.status, answer.body); }
    if (u.startsWith('/api/marketplaces')) return j(200, { ok: true, marketplaces: [MKT] });
    if (u.startsWith('/api/plugins')) return j(200, { plugins: [], orphans: [] });
    if (u.startsWith('/api/chat/status')) return j(200, { channels: [] });
    return base(url, opts);
  };
  window.fetch = fake; globalThis.fetch = fake;
  window.location.hash = '#marketplace'; for (let i = 0; i < 8; i++) await wait(5);
  doc.querySelector('button.mk-tile[data-key="gh/gh-plugin"]').click(); await wait(5);
  const install = doc.querySelector('#mk-sheet .mk-sheet-foot [data-act="install"]');
  install.click(); if (!git) install.click();   // no git: a double click while the request runs must not POST twice
  for (let i = 0; i < 20; i++) await wait(10);
  const chipEl = doc.querySelector('#mk-sheet .mk-src .pl-needs-git');
  return { posts: posts.length, sheetOpen: sheetOpen(doc), chip: chipEl ? chipEl.textContent : null,
    step: doc.querySelector('#mk-sheet .mk-step[aria-current="step"] .mk-step-label')?.textContent ?? null,
    reloaded: seq.slice(seq.indexOf('/api/plugins/install') + 1).some((x) => x.startsWith('/api/plugins')) };
}

test('hide set: the plugin install sheet while git is off', async () => {
  await checkRows([
    { name: 'the server answers GIT_MISSING: the Needs git chip stays in the sheet, one POST', run: async () => {
      const r = await installScenario(false, { status: 409, body: { error: 'git is not installed on this machine', code: 'GIT_MISSING' } });
      assert.deepEqual([r.posts, r.sheetOpen, r.chip], [1, true, 'Needs git']);
    } },
    { name: 'the server installs anyway (P6: a GitHub repo over HTTPS): one POST, the sheet lands on Done, the page reloads', run: async () => {
      const r = await installScenario(false, { status: 200, body: { ok: true } });
      assert.deepEqual([r.posts, r.step, r.reloaded], [1, 'Done', true]);
    } },
    { name: 'git on: the same sheet (one POST, Done, the page reloads)', run: async () => {
      const r = await installScenario(true, { status: 200, body: { ok: true } });
      assert.deepEqual([r.posts, r.step, r.reloaded], [1, 'Done', true]);
    } },
    { name: 'the second click of a double click (detail 2) lands after the 409: no second POST', run: async () => {
      const { window, doc } = await bootApp({ git: false });
      for (const k of ['Element', 'HTMLElement', 'Node', 'Event', 'CustomEvent']) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let posts = 0; const base = window.fetch;
      const fake = (url, opts = {}) => {
        const u = String(url); const j = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
        if (u.startsWith('/api/plugins/install')) { posts += 1; return j(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }); }
        if (u.startsWith('/api/marketplaces')) return j(200, { ok: true, marketplaces: [MKT] });
        if (u.startsWith('/api/plugins')) return j(200, { plugins: [], orphans: [] });
        if (u.startsWith('/api/chat/status')) return j(200, { channels: [] });
        return base(url, opts);
      };
      window.fetch = fake; globalThis.fetch = fake;
      window.location.hash = '#marketplace'; for (let i = 0; i < 8; i++) await wait(5);
      doc.querySelector('button.mk-tile[data-key="gh/gh-plugin"]').click(); await wait(5);
      const install = doc.querySelector('#mk-sheet .mk-sheet-foot [data-act="install"]');
      install.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
      for (let i = 0; i < 5; i++) await wait(5);
      assert.deepEqual(sheetFoot(doc), ['Cancel'], 'the refusal leaves Cancel only');
      install.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 2 }));
      for (let i = 0; i < 5; i++) await wait(5);
      assert.equal(posts, 1);
    } },
  ]);
});

// Part 4 — gates the rows above leave unpinned (review cycle 1: each row fails with its gate deleted).
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

test('hide set: chained tickets, a live flip on New run, the workspace Actions link, the Ask card project change', async () => {
  await checkRows([
    { name: 'schedules view: no "from the run before it" (meta line, Source branch detail) while git is off', run: async () => {
      const { window: w } = trackDom(new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#schedules' }));
      for (const k of ['document', 'location', 'DOMParser']) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
      const ticket = { id: 't2', kind: 'once', scheduleId: null, title: 't2', runAt: '9999-12-31T00:00:00.000Z', scheduledFor: null, status: 'scheduled',
        ifMissed: 'run', graceMin: 360, after: { kind: 'pipeline', id: 'abcdef12', policy: 'done', title: 'A', status: 'running', pipelineId: 'abcdef12' },
        sourceFromPrevious: true, summary: { target: 'project', workflowId: 'wf_default', prompt: 'p', source: null, mock: false } };
      const text = async (git) => {
        const prev = globalThis.fetch;
        globalThis.fetch = async (url) => ({ ok: true, status: 200,
          json: async () => (String(url).split('?')[0] === '/api/schedules' ? { schedules: [], tickets: [ticket], counts: {} } : { notifications: [], unread: 0 }) });
        const hosts = { feedHost: w.document.createElement('div'), onceHost: w.document.createElement('div'), repeatingHost: w.document.createElement('div') };
        w.document.body.replaceChildren(hosts.feedHost, hosts.onceHost, hosts.repeatingHost);
        const view = createSchedulesView({ ...hosts, msgEl: w.document.createElement('p'),
          deps: { confirmModal: async () => true, targetLabel: () => 'Project · shop', workflowLabel: () => 'Default', gitOn: () => git } });
        try {
          await view.load();
          return { meta: [...hosts.onceHost.querySelectorAll('.sched-target')].map((m) => m.textContent).join('\n'), all: hosts.onceHost.textContent };
        } finally { view.destroy(); globalThis.fetch = prev; }
      };
      const on = await text(true);
      assert.match(on.meta, /from the run before it/, 'git on: the meta line names it');
      assert.match(on.all, /Source branch\s*the run before it/, 'git on: the details name it');
      const off = await text(false);
      assert.doesNotMatch(off.meta, /the run before it/);
      assert.doesNotMatch(off.all, /the run before it/);
    } },
    { name: 'git arrives on New run with a project picked: the branch list is asked without a reload (and not before)', run: async () => {
      const { window, doc, calls, ws } = await bootApp({ git: false });
      window.location.hash = 'new'; for (let i = 0; i < 6; i++) await tick();
      const sel = doc.querySelector('#projectSelect');
      sel.value = '/data/alpha'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      for (let i = 0; i < 6; i++) await tick();
      assert.ok(!calls.some((u) => u.startsWith('/api/branches')), 'nothing while git is missing');
      ws._msg({ type: 'git', git: { available: true, version: '2.47.0' } });
      for (let i = 0; i < 6; i++) await tick();
      assert.ok(calls.some((u) => u.startsWith('/api/branches?projectDir=%2Fdata%2Falpha')), calls.filter((u) => u.includes('branch')).join(', '));
    } },
    { name: 'workspace page: a deep link to the Actions tab opens Overview while git is off (activateWsTab)', run: async () => {
      const WS = [{ id: 'wks-shop-00000001', name: 'Shop', description: '', projectPaths: ['/data/alpha'], projectKeys: ['alpha-00000001'], exists: [true],
        createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' }];
      const open = async (git) => {
        const { window, doc } = await bootApp({ git });
        const base = window.fetch;
        const f = (url, o) => { const u = String(url); return u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: WS }) }) : base(url, o); };
        window.fetch = f; globalThis.fetch = f;
        window.location.hash = 'workspaces'; for (let i = 0; i < 6; i++) await tick();
        window.location.hash = 'workspaces/wks-shop-00000001/actions'; for (let i = 0; i < 10; i++) await tick();
        return doc.querySelector('#ws-detail .pd-tab.active')?.dataset.sec;
      };
      assert.equal(await open(true), 'actions', 'git on: the deep link opens Actions');
      assert.equal(await open(false), 'overview');
    } },
    { name: 'Ask Start-run card: changing the project asks for no branch list while git is off', run: async () => {
      const TID = 'ask_00000001';
      const card = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null,
        members: null, workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'Fix it', title: 'Fix', sourceBranch: '',
        featureBranch: 'worca/fix', sourceBranchByKey: null, note: '', attachments: [] };
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      const fetchHandler = (url, opts) => {
        const method = ((opts && opts.method) || 'GET').toUpperCase();
        if (url === '/api/projects') return ok({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }, { name: 'proj2', path: '/repos/proj2', exists: true }] });
        if (url === '/api/workflows') return ok({ workflows: [{ id: 'wf_default', name: 'Default' }] });
        if (url === '/api/guardrails') return ok({ guardrails: [{ id: 'normal', name: 'Normal' }] });
        if (url === '/api/workspaces') return ok({ workspaces: [] });
        if (url.startsWith('/api/branches')) return ok({ branches: ['main', 'dev'] });
        if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') return ok({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null,
          effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null });
        if (url.startsWith('/api/ask/threads') && method === 'GET') return ok({ threads: [] });
        return ok({});
      };
      const proj2Asks = async (git) => {
        const ctx = makePanel({ fetchHandler });
        ctx.storage.setItem('worca-cc.ask.thread', TID);
        ctx.panel.open();
        for (let i = 0; i < 3; i++) await ctx.tick();
        for (const fr of stampFrames([{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
          { type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'proposed', card } }], { threadId: TID, messageId: 'askm_00000001' })) ctx.panel.pushServerFrame(fr);
        ctx.flush(); await ctx.tick(); await ctx.tick(); ctx.flush();
        ctx.doc.documentElement.dataset.git = git ? 'on' : 'off';       // the card was built with git on: only the change listener decides
        const sel = ctx.doc.querySelector('.ask-card-project-select');
        sel.value = '/repos/proj2'; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
        for (let i = 0; i < 4; i++) await ctx.tick();
        try { return ctx.fetchCalls.some((c) => c.url === '/api/branches?projectDir=%2Frepos%2Fproj2'); } finally { ctx.panel.destroy(); ctx.window.close(); }
      };
      assert.equal(await proj2Asks(true), true, 'git on: the new project\'s branches load');
      assert.equal(await proj2Asks(false), false);
    } },
  ]);
});
