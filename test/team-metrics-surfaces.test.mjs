// test/team-metrics-surfaces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  projectTmState, renderProjectTmCell, renderProjectTmChip, projectTmSummary, renderEnableDialogBody, renderMetricsHomePicker, renderWsMetricsRow, renderWsSummary, renderRouteResults, WS_MEMBERS_COLLAPSED, renderWsMetricsPending } from '../ui/public/team-metrics-surfaces.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const h = (d, tag) => d.createElement(tag);

const base = { key: 'billing-api-0123abcd', name: 'billing-api', path: '/p/billing-api', exists: true, slug: 'acme/billing-api', hasOrigin: true, enabled: true, enabledAt: '2026-09-03T08:00:00Z', record: true, pending: 0, runs: 167, delegateTo: null, delegateState: null, lastError: null, recordsLocally: true };

test('status variants (§4.11 / board 4)', () => {
  assert.equal(projectTmState({ ...base, hasOrigin: false }).kind, 'no-origin');
  assert.equal(projectTmState({ ...base, enabled: false }).kind, 'off');
  assert.equal(projectTmState({ ...base, pending: 3 }).kind, 'pending');
  assert.equal(projectTmState({ ...base, pending: 2, lastError: 'remote: protected branch hook declined', lastErrorCode: 'PUSH_REJECTED' }).kind, 'rejected');
  assert.equal(projectTmState({ ...base, pending: 0, lastError: 'old error' }).kind, 'on', 'nothing pending → no Retry');
  assert.equal(projectTmState({ ...base, delegateTo: 'acme/gateway', delegateState: 'ok', runs: 12, recordsLocally: false }).kind, 'delegated');
  assert.equal(projectTmState({ ...base, delegateTo: 'acme/legacy-api', delegateState: 'invalid', recordsLocally: false }).kind, 'delegate-invalid');
  // Enabled but unresolvable (the branch exists and has never been fetched): runs are skipped,
  // so the cell must not read plain "On".
  assert.equal(projectTmState({ ...base, blocked: 'CONFIG_UNKNOWN', delegateCode: 'CONFIG_UNKNOWN' }).kind, 'blocked');
  assert.equal(projectTmState(base).kind, 'on');
});

test('cell copy, actions and the Include my runs switch', () => {
  const on = renderProjectTmCell(base, { doc });
  assert.equal(on.dataset.kind, 'on', 'the cell names its state for the Getting started guide');
  assert.equal(on.className, 'tm-cell');
  // Two-row block: the title is the cell's FIRST child (its own grid row), the status line
  // follows it, and the control sits in its own child, never inside the status line.
  assert.equal(on.firstElementChild.className, 'tm-label');
  assert.equal(on.firstElementChild.textContent, 'Team metrics');
  assert.equal(on.firstElementChild.nextElementSibling.className, 'tm-line');
  assert.equal(on.querySelector('.tm-line .tm-label'), null);
  assert.equal(on.querySelector('.tm-line .tm-actions'), null);
  assert.equal(on.querySelector(':scope > .tm-actions .tm-record-row .txt').textContent, 'Include my runs');
  assert.match(renderProjectTmCell({ ...base, runs: 1 }, { doc }).textContent, /· 1 run recorded/, 'singular');
  // A metrics home says which workspaces it carries and that its switch covers them too.
  assert.equal(on.querySelector('.tm-home-for'), null, 'no hint when the project is nobody\'s home');
  const home = renderProjectTmCell({ ...base, homeFor: ['IoT SP Platform'] }, { doc });
  assert.equal(home.querySelector('.tm-home-for').textContent, 'Metrics home for IoT SP Platform · "Include my runs" covers its workspace runs too');
  assert.equal(renderProjectTmCell({ ...base, enabled: false, homeFor: ['X'] }, { doc }).querySelector('.tm-home-for'), null, 'an Off project cannot be a live home');
  // "Include my runs" off: still on for the team, but the row must not read as a green "On".
  const mine = renderProjectTmCell({ ...base, record: false }, { doc });
  assert.ok(mine.querySelector('.tm-dot.grey') && !mine.querySelector('.tm-dot.green'));
  assert.equal(mine.querySelector('.tm-status').textContent, 'On for the team · yours excluded');
  assert.equal(mine.querySelector('input.tm-record').checked, false);
  const mineDel = renderProjectTmCell({ ...base, record: false, delegateTo: 'acme/gateway', delegateState: 'ok', runs: 12 }, { doc });
  assert.match(mineDel.textContent, /On for the team · in acme\/gateway · yours excluded/);
  assert.ok(mineDel.querySelector('.tm-dot.grey'));
  assert.match(on.textContent, /On · since Sep 3 · 167 runs recorded/);
  const sw = on.querySelector('input.sw-input.tm-record');
  assert.ok(sw && sw.checked); assert.equal(sw.nextElementSibling.className, 'switch switch-sm');
  assert.equal(on.querySelector('.tm-status').title, 'Disable for the whole team: git push origin --delete worca-metrics');

  const off = renderProjectTmCell({ ...base, enabled: false }, { doc });
  assert.equal(off.querySelector('button.tm-enable').textContent, 'Set up team metrics…', 'the button names what it sets up');
  assert.match(off.querySelector('.tm-status').textContent, /^Off · runs stay on this machine$/);
  assert.equal(off.querySelector('.tm-record'), null);

  const pend = renderProjectTmCell({ ...base, pending: 3, enabledAt: '2026-08-12T00:00:00Z' }, { doc });
  assert.equal(pend.querySelector('.badge.amber').textContent, '3 pending push');
  assert.equal(pend.querySelector('button.tm-push').textContent, 'Push now');

  const rej = renderProjectTmCell({ ...base, pending: 2, lastError: 'remote: protected branch hook declined', lastErrorCode: 'PUSH_REJECTED', lastErrorHint: 'exempt `worca-metrics`…' }, { doc });
  assert.match(rej.textContent, /Push rejected · branch protection/);
  assert.match(rej.querySelector('.tm-hint').textContent, /remote: protected branch hook declined/);
  assert.equal(rej.querySelector('button.tm-push').textContent, 'Retry');

  const del = renderProjectTmCell({ ...base, delegateTo: 'acme/gateway', delegateState: 'ok', runs: 12 }, { doc });
  assert.match(del.textContent, /On · recorded in acme\/gateway · 12 runs/);

  const bad = renderProjectTmCell({ ...base, delegateTo: 'acme/legacy-api', delegateState: 'invalid' }, { doc });
  assert.match(bad.textContent, /Delegate invalid · points at acme\/legacy-api, which no longer records/);
  assert.equal(bad.querySelector('button.tm-change').textContent, 'Change…');

  assert.match(renderProjectTmCell({ ...base, hasOrigin: false }, { doc }).textContent, /Not available · no origin remote/);
  const noGit = renderProjectTmCell({ ...base, enabled: false, hasOrigin: false, noGit: true }, { doc });
  assert.match(noGit.textContent, /Not available · not a git repository/);
  assert.equal(noGit.querySelector('button.tm-enable'), null, 'a non-git folder is never offered setup');
});

test('enable dialog: record here shows attribution; delegate mode shows the target select and hides attribution', () => {
  const candidates = [{ slug: 'acme/gateway', label: 'acme/gateway · metrics home of IoT SP Platform · 54 runs' }];
  const here = renderEnableDialogBody({ project: { name: 'internal-tools' }, origin: 'github.com/acme/internal-tools', candidates, mode: 'here', attribution: 'git-user' }, { doc });
  assert.equal(here.querySelectorAll('input[name="tm-where"]').length, 2);
  assert.ok(here.querySelector('input[name="tm-where"][value="here"]').checked);
  assert.equal(here.querySelectorAll('input[name="tm-attribution"]').length, 2);
  assert.match(here.textContent, /exempt worca-metrics first/);
  const del = renderEnableDialogBody({ project: { name: 'console' }, origin: 'github.com/acme/console', candidates, mode: 'delegate' }, { doc });
  assert.equal(del.querySelector('input[name="tm-attribution"]'), null);
  assert.equal(del.querySelector('select.tm-delegate-target option').textContent, candidates[0].label);
  assert.match(del.textContent, /Attribution follows the target's policy/);
  const none = renderEnableDialogBody({ project: { name: 'x' }, origin: 'o', candidates: [], mode: 'delegate' }, { doc });
  assert.ok(none.querySelector('input[name="tm-where"][value="delegate"]').disabled || /No project records locally yet/.test(none.textContent));
});

test('metrics home picker (wizard step / Change sheet): enabled radios, Enable now…, disabled no-origin row, single enabled pre-selected', () => {
  const members = [
    { path: '/p/gateway', key: 'gateway-1', slug: 'acme/gateway', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-08-12T00:00:00Z', workspaceRuns: 54 },
    { path: '/p/device-registry', key: 'dr-2', slug: 'acme/device-registry', hasOrigin: true, enabled: false },
    { path: '/p/console', key: 'co-3', slug: 'acme/console', hasOrigin: false, enabled: false },
  ];
  const list = renderMetricsHomePicker(members, { selectedPath: undefined, doc });
  const radios = [...list.querySelectorAll('input[name="tm-home"]')];
  assert.equal(radios.length, 1);
  assert.ok(radios[0].checked, 'the only recording member is pre-selected');
  const gw = list.querySelector('.wiz-row[data-path="/p/gateway"] .wiz-row-status');
  assert.equal(gw.querySelector('.wiz-row-status-main').textContent, 'On · since Aug 12');
  assert.equal(gw.querySelector('.wiz-row-status-sub').textContent, '54 workspace runs recorded', 'the run count is its own line');
  assert.equal(list.querySelector('.wiz-row[data-path="/p/device-registry"] button.tm-enable-now').textContent, 'Enable now…');
  assert.ok(list.querySelector('.wiz-row.off[data-path="/p/console"]'));
  assert.match(list.textContent, /No origin remote · cannot host metrics/);
});

test('workspace card: one projects table (project · metrics branch · status), the home marked by the icon, actions in the table head', () => {
  const members = [
    { path: '/p/billing', slug: 'acme/billing', state: 'routed', reason: null, recordsOn: 'acme/gateway' },
    { path: '/p/gateway', slug: 'acme/gateway', state: 'home', reason: null, recordsOn: 'acme/gateway' },
    { path: '/p/console', slug: 'acme/console', state: 'not-recording', reason: 'no origin remote', recordsOn: null },
    { path: '/p/legacy', slug: 'acme/legacy', state: 'records-elsewhere', reason: 'records on its own branch', recordsOn: 'acme/legacy' },
    { path: '/p/edge', slug: 'acme/edge', state: 'records-elsewhere', reason: 'delegates to acme/other', recordsOn: 'acme/other' },
    { path: '/p/new', slug: 'acme/new', state: 'not-recording', reason: 'no worca-metrics branch', recordsOn: null },
  ];
  const ok = renderWsMetricsRow({ home: { state: 'ok', slug: 'acme/gateway', runs: 54 }, members, counts: {} }, { doc });
  assert.equal(ok.querySelector('.ws-tbl-head .badge').textContent, '6');
  assert.deepEqual([...ok.querySelectorAll('.ws-projects-tbl th')].map((t) => t.textContent), ['Project', 'Metrics status', 'Metrics branch', 'Workspace runs']);
  // Metrics status: which metrics exist for the project — "–", ✓ Project metrics, ✓ Workspace
  // metrics, or both (workspace first). Routing is told by the branch column, not the status.
  const status = (td) => td.querySelector('.ws-metric') ? [...td.querySelectorAll('.ws-metric')].map((l) => `${l.querySelector('.ws-mark').classList.contains('ok') ? '✓' : '✗'} ${l.textContent}`) : td.textContent;
  const rows = [...ok.querySelectorAll('tbody tr.ws-member')].map((tr) => [
    tr.classList.contains('home'), tr.querySelector('.ws-member-slug').textContent,
    tr.querySelector('.ws-col-branch').textContent, tr.querySelector('.ws-col-runs').textContent, status(tr.querySelector('.ws-col-status')),
  ]);
  assert.deepEqual(rows, [
    [true, 'acme/gateway', 'origin/worca-metrics', '54', ['✓ Workspace metrics', '✓ Project metrics']],
    [false, 'acme/console', 'no origin remote', '–', '–'],
    [false, 'acme/legacy', 'origin/worca-metrics', '–', ['✓ Project metrics']],
    [false, 'acme/edge', 'worca-metrics on acme/other', '–', ['✓ Project metrics']],
    [false, 'acme/new', 'not set', '–', '–'],
    [false, 'acme/billing', 'worca-metrics on acme/gateway', '–', ['✓ Project metrics']],
  ], 'home first (never the word "home" on the row), then members needing attention, routed last');
  assert.ok(!/\bhome\b/i.test(ok.querySelector('tr.ws-member.home').textContent), 'the home row is marked by the icon, not labelled');
  assert.equal(ok.querySelector('.ws-tbl-actions button.ws-route').textContent, 'Route all to metrics home');
  assert.equal(ok.querySelector('.ws-tbl-actions button.ws-home-change').textContent, 'Change metrics home…');
  assert.ok(!ok.querySelector('.ws-home-hint'), 'a healthy home with "Include my runs" on needs no sentence');

  // Own-branch / no-origin members are skipped by routing, so they alone do not earn the button.
  const unroutable = renderWsMetricsRow({ home: { state: 'ok', slug: 'acme/gateway', runs: 1 }, members: [members[1], members[2], members[3]], counts: {} }, { doc });
  assert.ok(!unroutable.querySelector('button.ws-route'));

  // The home's "Include my runs" off: the one warning worth a sentence.
  const off = renderWsMetricsRow({ home: { state: 'ok', slug: 'acme/gateway', runs: 54, record: false }, members: [members[1]], counts: {} }, { doc });
  assert.match(off.querySelector('.ws-home-hint.warn').textContent, /Your workspace runs are not recorded: "Include my runs" is off on acme\/gateway\./);
  assert.ok(off.querySelector('.ws-home-hint .tm-dot.amber'));

  const stale = renderWsMetricsRow({ home: { state: 'stale', slug: 'acme/payments-worker', detail: 'branch missing on origin' }, members: [{ path: '/p/pw', slug: 'acme/payments-worker', state: 'home', reason: null, recordsOn: 'acme/payments-worker' }], counts: {} }, { doc });
  assert.equal(stale.querySelector('tr.ws-member.home .ws-metric.bad').textContent, 'Workspace metrics · branch missing on origin');
  assert.ok(!stale.querySelector('tr.ws-member.home .ws-metric.ok'), 'a stale home records nothing');
  assert.match(stale.querySelector('.ws-home-hint.warn').textContent, /Workspace runs are not being recorded: branch missing on origin\./);

  const unset = renderWsMetricsRow({ home: { state: 'unset' }, members: [members[3], members[5]], counts: {} }, { doc });
  assert.equal(unset.querySelector('button.ws-home-change').textContent, 'Choose metrics home…');
  assert.ok(!unset.querySelector('button.ws-route'), 'nothing to route to without a home');
  assert.equal(unset.querySelectorAll('tbody tr').length, 2, 'the table still lists every member');
  assert.match(unset.querySelector('.ws-home-hint').textContent, /not recorded until a metrics home is chosen/);

  const list = renderRouteResults({ results: [{ slug: 'acme/a', result: 'routed' }, { slug: 'acme/b', result: 'failed', error: 'push rejected', stderr: 'remote: denied', hint: 'exempt worca-metrics from branch protection' }] }, { doc });
  assert.equal(list.querySelectorAll('li').length, 2);
  assert.match(list.querySelector('li.failed').textContent, /push rejected/);
  assert.match(list.querySelector('li.failed .tm-stderr').textContent, /remote: denied/);
});

test('workspace card header summary: size, where runs go, what needs attention', () => {
  const text = (frag) => { const d = h(doc, 'div'); d.append(frag); return d; };
  const members = [
    { path: '/p/gateway', slug: 'acme/gateway', state: 'home', reason: null, recordsOn: 'acme/gateway' },
    { path: '/p/billing', slug: 'acme/billing', state: 'routed', reason: null, recordsOn: 'acme/gateway' },
    { path: '/p/new', slug: 'acme/new', state: 'not-recording', reason: 'no worca-metrics branch', recordsOn: null },
  ];
  const ok = text(renderWsSummary({ projectPaths: ['/p/gateway', '/p/billing', '/p/new'], home: { state: 'ok', slug: 'acme/gateway', runs: 12 }, members }, { doc }));
  assert.equal(ok.textContent, '3 projects · acme/gateway · 12 workspace runs · 1 not recording', 'a member on its own branch is not a problem — only one with no metrics at all counts');
  assert.ok(ok.querySelector('.tm-icon'), 'the home is marked by the Team metrics icon');
  assert.equal(ok.querySelector('.tm-home-mark').title, 'Metrics home: workspace runs are recorded on this project\'s worca-metrics branch');
  assert.equal(ok.querySelector('.tm-home-mark').getAttribute('aria-label'), 'Metrics home');
  assert.equal(ok.querySelector('.ws-sum-warn').textContent, '1 not recording');
  const unset = text(renderWsSummary({ projectPaths: ['/p/a', '/p/b'], home: { state: 'unset' }, members: [] }, { doc }));
  assert.equal(unset.textContent, '2 projects · no metrics home');
  assert.ok(!unset.querySelector('.tm-icon'));
  const stale = text(renderWsSummary({ projectPaths: ['/p/a'], home: { state: 'stale', slug: 'acme/a', detail: 'branch missing on origin' }, members: [] }, { doc }));
  assert.equal(stale.textContent, '1 project · acme/a · branch missing on origin');
  assert.equal(stale.querySelector('.ws-sum-bad').textContent, 'branch missing on origin');
});

test('enable dialog radio cards keep their flex layout under the generic .field > label rule', () => {
  // The cards are <label>s rendered directly inside .field. `.field > label{display:block}`
  // (specificity 0,1,1) used to beat `.radio-card{display:flex}` (0,1,0), stacking the radio
  // on its own line above the title — the card rule must carry the same specificity.
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'), 'utf8');
  const m = css.match(/\.radio-card,\s*\.field\s*>\s*label\.radio-card\s*\{([^}]*)\}/);
  assert.ok(m, 'a `.radio-card,.field > label.radio-card` rule must exist');
  assert.match(m[1], /display:\s*flex/);
  assert.match(m[1], /gap:\s*12px/);
  assert.match(m[1], /align-items:\s*flex-start/);
  const radio = css.match(/\.radio-card input\[type="radio"\]\s*\{([^}]*)\}/);
  assert.ok(radio, 'the card radio must be pinned (no shrink, aligned with the title line)');
  assert.match(radio[1], /flex:\s*0 0 auto/);
});

test('workspace card projects table: long lists collapse to the home + attention rows with a Show more toggle', () => {
  // 1 home, 3 not routed, 8 routed — a 12-project workspace.
  const members = [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `/p/r${i}`, slug: `acme/routed-${i}`, state: 'routed', reason: null })),
    { path: '/p/own', slug: 'acme/own', state: 'records-elsewhere', reason: 'records on its own branch' },
    { path: '/p/gateway', slug: 'acme/gateway', state: 'home', reason: null },
    { path: '/p/new-a', slug: 'acme/new-a', state: 'not-recording', reason: 'no worca-metrics branch' },
    { path: '/p/new-b', slug: 'acme/new-b', state: 'not-recording', reason: 'no worca-metrics branch' },
  ];
  const el = renderWsMetricsRow({ home: { state: 'ok', slug: 'acme/gateway', runs: 3 }, members, counts: {} }, { doc });
  const rows = [...el.querySelectorAll('.ws-member')];
  assert.equal(rows.length, 12, 'every member is in the DOM');
  assert.deepEqual(rows.slice(0, 4).map((li) => li.querySelector('.ws-member-slug').textContent), ['acme/gateway', 'acme/own', 'acme/new-a', 'acme/new-b'], 'home, then members needing attention, then routed');
  assert.deepEqual(rows.map((li) => li.hidden), rows.map((_, i) => i >= WS_MEMBERS_COLLAPSED), `only the first ${WS_MEMBERS_COLLAPSED} rows show`);
  assert.equal(el.querySelector('.ws-tbl-head .ws-members-summary').textContent, '8 routed · 3 not routed');
  const more = el.querySelector('button.ws-members-more');
  assert.equal(more.textContent, 'Show 6 more');
  more.click();
  assert.ok(rows.every((li) => !li.hidden)); assert.equal(more.textContent, 'Show less'); assert.equal(more.getAttribute('aria-expanded'), 'true');
  more.click();
  assert.ok(rows[WS_MEMBERS_COLLAPSED].hidden); assert.equal(more.textContent, 'Show 6 more');
  // Short lists: no summary, no toggle, nothing hidden.
  const short = renderWsMetricsRow({ home: { state: 'ok', slug: 'acme/gateway', runs: 3 }, members: members.slice(8), counts: {} }, { doc });
  assert.ok(!short.querySelector('.ws-members-summary') && !short.querySelector('.ws-members-more'));
  assert.ok([...short.querySelectorAll('.ws-member')].every((li) => !li.hidden));
});

test('pending (before /scopes answers): "checking metrics…" in the summary; the block is the same table with shimmer cells', () => {
  const text = (frag) => { const d = doc.createElement('div'); d.append(frag); return d; };
  const sum = text(renderWsSummary({ projectPaths: ['/p/a', '/p/b'], home: { state: 'ok', slug: 'x' }, members: [] }, { doc, pending: true }));
  assert.equal(sum.textContent, '2 projects · checking metrics…');
  assert.ok(sum.querySelector('.ws-sum-pending'));
  const block = renderWsMetricsPending({ projectPaths: ['/p/gateway', '/p/billing'] }, { doc });
  assert.equal(block.getAttribute('aria-hidden'), 'true');
  assert.ok(block.classList.contains('is-pending'));
  assert.deepEqual([...block.querySelectorAll('th')].map((t) => t.textContent), ['Project', 'Metrics status', 'Metrics branch', 'Workspace runs'], 'the real table\'s columns, so nothing jumps');
  assert.deepEqual([...block.querySelectorAll('.ws-member-slug')].map((s) => s.textContent), ['gateway', 'billing'], 'folder names until the slugs are known');
  assert.equal(block.querySelectorAll('tbody tr').length, 2);
  assert.equal(block.querySelectorAll('.skel').length, 6, 'three shimmer cells per row');
  assert.equal(block.querySelector('.badge').textContent, '2');
  assert.equal(block.querySelector('button'), null, 'no actions before the statuses are known');
  const many = renderWsMetricsPending({ projectPaths: Array.from({ length: 9 }, (_, i) => `/p/m${i}`) }, { doc });
  assert.equal(many.querySelectorAll('tbody tr').length, 6, 'capped like the real table');
});

test('row chip + summary: a dot, the word and the short state; the sentence rides the title', () => {
  const on = renderProjectTmChip({ key: 'k1', name: 'a', slug: 'me/a', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-09-19T00:00:00.000Z', record: true, runs: 3, pending: 0 }, { doc });
  assert.equal(on.className, 'pl-team-item pl-tm');
  assert.equal(on.dataset.key, 'k1');
  assert.equal(on.dataset.kind, 'on');
  assert.equal(on.textContent, 'Metrics on · 3 runs');
  assert.ok(on.querySelector('.tm-dot.green'));
  assert.equal(on.title, 'Team metrics: On · 3 runs · since Sep 19');
  const off = renderProjectTmChip({ key: 'k2', hasOrigin: true, enabled: false }, { doc });
  assert.equal(off.textContent, 'Metrics off');
  assert.ok(off.querySelector('.tm-dot.grey'));
  assert.equal(off.title, 'Team metrics: Off · runs stay on this machine');
  const none = renderProjectTmChip({ key: 'k3', hasOrigin: false }, { doc });
  assert.equal(none.textContent, 'Metrics not available');
  assert.equal(none.querySelector('.tm-dot'), null, 'no dot for a project the feature cannot reach');
  assert.ok(none.querySelector('.pl-team-state.muted'));
  const via = projectTmSummary({ key: 'k4', hasOrigin: true, enabled: true, delegateTo: 'me/hub', delegateState: 'ok', record: false, runs: 2, pending: 0 });
  assert.deepEqual([via.kind, via.tone, via.short], ['delegated', 'grey', 'via me/hub · yours excluded']);
  const pending = projectTmSummary({ key: 'k5', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-09-19T00:00:00.000Z', pending: 2 });
  assert.deepEqual([pending.kind, pending.tone, pending.short], ['pending', 'amber', 'on · 2 pending push']);
  const rejected = projectTmSummary({ key: 'k6', hasOrigin: true, enabled: true, recordsLocally: true, pending: 1, lastError: 'remote: protected branch\nmore', lastErrorCode: 'PUSH_REJECTED', lastErrorHint: 'exempt worca-metrics' });
  assert.deepEqual([rejected.kind, rejected.tone, rejected.short, rejected.detail], ['rejected', 'red', 'push failed', 'branch protection']);
});

test('the cell without its heading: the panel head names the feature', () => {
  const cell = renderProjectTmCell({ key: 'k1', hasOrigin: true, enabled: false }, { doc, heading: false });
  assert.equal(cell.querySelector('.tm-label'), null);
  assert.ok(cell.querySelector('.tm-enable'));
});
