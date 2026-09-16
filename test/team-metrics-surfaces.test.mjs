// test/team-metrics-surfaces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  projectTmState, renderProjectTmCell, renderEnableDialogBody, renderMetricsHomePicker, renderWsMetricsRow, renderRouteResults,
} from '../ui/public/team-metrics-surfaces.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

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

test('cell copy, actions and the Record my runs switch', () => {
  const on = renderProjectTmCell(base, { doc });
  assert.equal(on.className, 'tm-cell');
  assert.match(on.textContent, /On · since Sep 3 · 167 runs recorded/);
  const sw = on.querySelector('input.sw-input.tm-record');
  assert.ok(sw && sw.checked); assert.equal(sw.nextElementSibling.className, 'switch switch-sm');
  assert.equal(on.querySelector('.tm-status').title, 'Disable for the whole team: git push origin --delete worca-metrics');

  const off = renderProjectTmCell({ ...base, enabled: false }, { doc });
  assert.equal(off.querySelector('button.tm-enable').textContent, 'Enable…');
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
  assert.match(list.textContent, /Team metrics on · since Aug 12 · 54 workspace runs already there/);
  assert.equal(list.querySelector('.wiz-row[data-path="/p/device-registry"] button.tm-enable-now').textContent, 'Enable now…');
  assert.ok(list.querySelector('.wiz-row.off[data-path="/p/console"]'));
  assert.match(list.textContent, /No origin remote · cannot host metrics/);
});

test('workspace card metrics home row: ok / stale / unset, members summary, route results', () => {
  const ok = renderWsMetricsRow({ home: { state: 'ok', slug: 'acme/gateway', runs: 54 }, members: [], counts: { recordsHere: 1, routed: 1, notRecording: 1 }, notRecordingNames: ['acme/console has no origin remote'] }, { doc });
  assert.match(ok.textContent, /acme\/gateway/); assert.match(ok.textContent, /origin\/worca-metrics/);
  assert.equal(ok.querySelector('.badge').textContent, '54 runs');
  assert.equal(ok.querySelector('button.ws-home-change').textContent, 'Change…');
  assert.match(ok.textContent, /1 records here · 1 routed to the home · 1 not recording/);
  assert.equal(ok.querySelector('button.ws-route').textContent, 'Route all members here');
  const stale = renderWsMetricsRow({ home: { state: 'stale', slug: 'acme/payments-worker', detail: 'branch missing on origin' }, members: [], counts: {} }, { doc });
  assert.equal(stale.querySelector('.badge.red').textContent, 'branch missing on origin');
  assert.match(stale.textContent, /workspace runs are not being recorded/);
  const unset = renderWsMetricsRow({ home: { state: 'unset' }, members: [], counts: {} }, { doc });
  assert.match(unset.textContent, /Not set · workspace runs are not recorded/);
  assert.equal(unset.querySelector('button.ws-home-change').textContent, 'Choose…');
  const res = renderRouteResults({ results: [{ slug: 'acme/console', result: 'failed', error: 'push rejected', stderr: 'remote: GH006' }, { slug: 'acme/dr', result: 'routed' }] }, { doc });
  assert.equal(res.querySelectorAll('li').length, 2);
  assert.match(res.querySelector('li.failed').textContent, /acme\/console · failed · push rejected/);
});
