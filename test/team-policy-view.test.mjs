// test/team-policy-view.test.mjs — pure renderers of ui/public/team-policy-view.mjs (team-policy
// design §11, boards 2–11) and the cost-banner delegation in stats-view.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  projectTpState, renderProjectTpCell, renderProjectTpChip, projectTpSummary, renderPolicyEnableDialogBody, renderEffectiveTable, renderPolicyEditor, docFromEditor, editorDirty,
  renderPolicyEmptyState, renderPolicySyncChip, renderWsPolicyLine, renderTeamCapsReadout, renderTeamChip, renderPolicyNotesLine,
  renderPolicyHeader, renderPolicyStats, renderPolicyPluginsPanel, renderPolicyCatalogPanel,
  renderTeamCapPauseBanner, renderRequiredStrip, renderSetupChecklist, renderPolicyBadgeFor, relTime, POLICY_PAUSE_REASONS, requiredAllLabel,
} from '../ui/public/team-policy-view.mjs';
import { renderCostPauseBanner } from '../ui/public/stats-view.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
const doc = dom.window.document;
// Editor listeners construct `new window.Event`; jsdom exposes it on the window the document belongs to.
globalThis.window = dom.window;

const base = { key: 'gw-0123abcd', name: 'gateway', path: '/p/gateway', exists: true, slug: 'acme/gateway', hasOrigin: true, present: true, docKnown: true, unknownSchema: false, warnings: [], delegateTo: null, delegateState: null, blocked: null, home: 'acme/gateway', sha: '3f2a1bc0', title: 'Gateway team policy', updatedAt: new Date(Date.now() - 3 * 86400_000).toISOString(), updatedBy: 'Mara', fieldCount: 14, carries: true, caps: { pipeline: { kind: 'soft', value: 10, onBreach: 'pause', requireReason: false }, total: { kind: 'soft', value: 150 }, resetPeriod: 'monthly', pooled: null } };
const REGISTRY = [
  { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', help: 'h', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'] },
  { key: 'cost.totalLimitUsd', group: 'cost', label: 'Total cap per period (USD)', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'] },
  { key: 'cost.resetPeriod', group: 'cost', label: 'Reset period', type: 'enum', values: ['weekly', 'monthly'], kinds: ['default'] },
  { key: 'cost.pooledBudgetUsd', group: 'cost', label: 'Pooled budget (USD)', type: 'usd', kinds: ['soft'], advisory: true, attrs: ['window'] },
  { key: 'ask.maxBudgetUsd', group: 'ask', label: 'Per-turn cost cap (USD)', type: 'usd-or-null', min: 0.1, max: 100, kinds: ['default'] },
  { key: 'guardrails.default', group: 'guardrails', label: 'Default set', type: 'string', kinds: ['default'] },
  { key: 'guardrails.minimum', group: 'guardrails', label: 'Minimum tier', type: 'enum', values: ['permissive', 'normal', 'secure'], kinds: ['soft'] },
  { key: 'models.allowed', group: 'models', label: 'Allowed models', type: 'string[]', kinds: ['soft'] },
  { key: 'models.steps', group: 'models', label: 'Step defaults', type: 'steps', kinds: ['default'] },
  { key: 'models.hideBuiltins', group: 'models', label: 'Hide built-in models', type: 'bool', kinds: ['default'] },
  { key: 'plugins.marketplaces', group: 'plugins', label: 'Marketplaces', type: 'string[]', kinds: ['default'] },
  { key: 'plugins.required', group: 'plugins', label: 'Required plugins', type: 'plugins', kinds: ['soft'] },
  { key: 'workflows.default', group: 'runs', label: 'Default workflow', type: 'string', kinds: ['default'] },
  { key: 'run.humanInLoop', group: 'runs', label: 'Human in the loop', type: 'bool', kinds: ['default'] },
  { key: 'worca.minVersion', group: 'runs', label: 'Minimum Worca version', type: 'semver', kinds: ['soft'] },
];
const SAMPLE_DOC = {
  schema: 1, title: 'Gateway team policy', notes: 'Q4', updatedAt: '2026-09-17T09:12:00Z', updatedBy: 'Mara',
  fields: {
    'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause', requireReason: true },
    'cost.resetPeriod': { kind: 'default', value: 'monthly' },
    'models.allowed': { kind: 'soft', value: ['claude-opus-5', 'claude-sonnet-5'] },
    'models.steps': { kind: 'default', value: { planner: { model: 'claude-opus-5', effort: 'high' } } },
    'plugins.required': { kind: 'soft', value: [{ name: 'acme-jira', marketplace: 'acme/worca-plugins', minVersion: '1.2.0' }] },
    'run.humanInLoop': { kind: 'default', value: true },
  },
  workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25, onBreach: 'pause' } },
  catalogs: { guardrailSets: [{ id: 'gateway-normal', name: 'Gateway normal', honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: ['.env*'], deny: [] }], models: [] },
};

test('project cell states (board 2)', () => {
  assert.equal(projectTpState({ ...base, hasOrigin: false }).kind, 'no-origin');
  assert.equal(projectTpState({ ...base, present: false }).kind, 'off');
  assert.equal(projectTpState({ ...base, unknownSchema: true }).kind, 'unsupported');
  assert.equal(projectTpState({ ...base, delegateTo: 'acme/old', delegateState: 'invalid' }).kind, 'delegate-invalid');
  assert.equal(projectTpState({ ...base, blocked: 'DOC_UNKNOWN' }).kind, 'blocked');
  assert.equal(projectTpState({ ...base, delegateTo: 'acme/gateway', delegateState: 'ok' }).kind, 'follows');
  assert.equal(projectTpState(base).kind, 'home');
});

test('project cell copy, actions and cap hint', () => {
  const off = renderProjectTpCell({ ...base, present: false, caps: null }, { doc });
  assert.equal(off.className, 'tm-cell tp-cell');
  assert.equal(off.firstElementChild.textContent, 'Team policy');
  assert.equal(off.querySelector('.tm-status').textContent, 'Off · your settings apply');
  assert.equal(off.querySelector('.tp-enable').textContent, 'Set up team policy…');
  const home = renderProjectTpCell(base, { doc });
  assert.match(home.querySelector('.tm-status').textContent, /^On · policy home · 14 fields · updated 3 d ago$/);
  assert.ok(home.querySelector('.tp-open'));
  assert.equal(home.querySelector('.tp-change'), null);
  assert.match(home.querySelector('.tm-hint').textContent, /pipeline cap \$10\.00 \(soft\) · total \$150\.00\/month \(soft\)/);
  const follows = renderProjectTpCell({ ...base, delegateTo: 'acme/gateway', delegateState: 'ok', home: 'acme/gateway' }, { doc });
  assert.match(follows.querySelector('.tm-status').textContent, /^On · follows acme\/gateway · 14 fields$/);
  assert.ok(follows.querySelector('.tp-open') && follows.querySelector('.tp-change'));
  const invalid = renderProjectTpCell({ ...base, delegateTo: 'acme/old', delegateState: 'invalid', delegateCode: 'DELEGATE_DANGLING', caps: null }, { doc });
  assert.match(invalid.querySelector('.tm-status').textContent, /Follow invalid · follows acme\/old, which no longer carries a policy/);
  assert.ok(invalid.querySelector('.tm-dot.red') && invalid.querySelector('.tp-change'));
  const newer = renderProjectTpCell({ ...base, unknownSchema: true, warnings: ['schema 2 needs a newer Worca'], caps: null }, { doc });
  assert.match(newer.querySelector('.tm-status').textContent, /Needs a newer Worca/);
  assert.match(newer.querySelector('.tm-hint').textContent, /schema 2/);
});

test('enable dialog body (board 3): here / follow, preselected metrics delegate, protect advice', () => {
  const here = renderPolicyEnableDialogBody({ project: { name: 'billing-api' }, origin: 'github.com/acme/billing-api', candidates: [{ slug: 'acme/gateway', label: 'acme/gateway' }], mode: 'here' }, { doc });
  assert.equal(here.querySelectorAll('input[name="tp-where"]').length, 2);
  assert.equal(here.querySelector('input[name="tp-where"][value="here"]').checked, true);
  assert.equal(here.querySelector('.tp-follow-target'), null);
  assert.match(here.querySelector('.tm-warn').textContent, /Protect worca-policy on your git host so only maintainers can push/);
  assert.match(here.querySelector('.tm-warn').textContent, /opposite of worca-metrics/);
  const follow = renderPolicyEnableDialogBody({ project: { name: 'billing-api', metricsFollow: 'acme/gateway' }, origin: 'x', candidates: [{ slug: 'acme/core', label: 'acme/core' }, { slug: 'acme/gateway', label: 'acme/gateway' }], mode: 'follow' }, { doc });
  const sel = follow.querySelector('.tp-follow-target');
  assert.equal(sel.value, 'acme/gateway');
  assert.match(follow.textContent, /Preselected to match where this project's metrics go/);
  const change = renderPolicyEnableDialogBody({ project: { name: 'x' }, origin: 'x', candidates: [{ slug: 'acme/gateway', label: 'acme/gateway' }], mode: 'follow', change: true }, { doc });
  assert.equal(change.querySelector('input[name="tp-where"][value="here"]').disabled, true);
  assert.match(change.textContent, /pick a new home/);
  const none = renderPolicyEnableDialogBody({ project: { name: 'x' }, origin: 'x', candidates: [], mode: 'here' }, { doc });
  assert.equal(none.querySelector('input[name="tp-where"][value="follow"]').disabled, true);
});

const ROWS = [
  { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap', help: 'pauses the run', type: 'usd', team: { kind: 'soft', declaredKind: 'soft', value: 10, display: '$10.00', onBreach: 'pause', requireReason: true }, local: { value: 25, set: true, display: '$25.00' }, effective: { value: 10, display: '$10.00', source: 'team' }, note: 'yours ($25.00) is looser; the team cap applies', shown: true },
  { key: 'cost.totalLimitUsd', group: 'cost', label: 'Total cap per month', type: 'usd', team: { kind: 'soft', declaredKind: 'hard', value: 150, display: '$150.00' }, local: { value: 120, set: true, display: '$120.00' }, effective: { value: 120, display: '$120.00', source: 'local' }, note: 'yours is tighter', shown: true },
  { key: 'cost.resetPeriod', group: 'cost', label: 'Reset period', type: 'enum', team: null, local: { value: 'monthly', set: false, display: '—' }, effective: { value: 'monthly', display: 'monthly', source: 'default' }, note: null, shown: false },
  { key: 'guardrails.default', group: 'guardrails', label: 'Default set', type: 'string', team: { kind: 'default', declaredKind: 'default', value: 'secure', display: 'secure', fromWorkspaceRuns: true }, local: null, effective: { value: 'secure', display: 'secure', source: 'team-default' }, note: null, shown: true },
];

test('effective table (board 4): groups, kind chips, struck-through looser value, show-all toggle', () => {
  const card = renderEffectiveTable({ rows: ROWS, policy: { workspaceRun: false } }, { doc });
  const tbl = card.querySelector('table.tm-tbl.tp-tbl');
  assert.deepEqual([...tbl.querySelectorAll('tr.tp-group td')].map((x) => x.textContent), ['Cost', 'Guardrails']);
  assert.equal(tbl.querySelectorAll('tbody tr[data-key]').length, 3, 'hidden rows (no team value) are not painted');
  const r1 = tbl.querySelector('tr[data-key="cost.pipelineLimitUsd"]');
  assert.equal(r1.querySelector('.tp-kind').className, 'tp-kind soft');
  assert.ok(r1.querySelector('td.tp-eff.loose'), 'the looser local value is struck through');
  assert.ok(r1.querySelector('td.tp-eff.tight'), 'the effective cell is tight when the team number binds');
  assert.match(r1.querySelector('td.tp-team small').textContent, /on breach: pause · reason required/);
  const r2 = tbl.querySelector('tr[data-key="cost.totalLimitUsd"]');
  assert.equal(r2.querySelector('.tp-kind').textContent, 'hard');
  assert.match(r2.querySelector('.tp-kind').title, /treated as soft/);
  const r4 = tbl.querySelector('tr[data-key="guardrails.default"]');
  assert.ok(r4.querySelector('.badge.grey'), 'workspace-runs chip');
  const toggle = card.querySelector('.tp-show-all');
  assert.equal(toggle.textContent, 'show all 4 fields');
  const holder = doc.createElement('div'); holder.append(card);
  toggle.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(holder.querySelectorAll('tbody tr[data-key]').length, 4, 'show-all repaints with every row');
  const empty = renderEffectiveTable({ rows: ROWS.map((r) => ({ ...r, team: null, shown: false })), policy: {} }, { doc });
  assert.match(empty.textContent, /sets no fields yet/);
});

test('editor (board 5): registry-driven rows, kind segments, docFromEditor round-trips the sample document', () => {
  const root = renderPolicyEditor(SAMPLE_DOC, { registry: REGISTRY, doc });
  doc.body.append(root);
  assert.equal(root.querySelectorAll('.tp-group-card').length, 6);
  const rows = root.querySelectorAll('.tp-edit-row[data-scope="fields"]');
  assert.equal(rows.length, REGISTRY.length);
  const cap = root.querySelector('.tp-edit-row[data-key="cost.pipelineLimitUsd"][data-scope="fields"]');
  assert.equal(cap.querySelector('.tp-val').value, '10');
  assert.equal(cap.querySelector('.tp-kind-seg .on').dataset.kind, 'soft');
  assert.equal(cap.querySelector('.tp-kind-btn[data-kind="hard"]').disabled, true);
  assert.match(cap.querySelector('.tp-kind-btn[data-kind="hard"]').title, /later version/);
  assert.equal(cap.querySelector('.tp-require-reason').checked, true);
  const period = root.querySelector('.tp-edit-row[data-key="cost.resetPeriod"][data-scope="fields"]');
  assert.equal(period.querySelector('.tp-kind-btn[data-kind="soft"]').disabled, true, 'a default-only field cannot be soft');
  const allowed = root.querySelector('.tp-edit-row[data-key="models.allowed"][data-scope="fields"]');
  assert.equal(allowed.querySelectorAll('.tp-chip').length, 2);
  const ws = root.querySelector('.tp-ws-card');
  assert.equal(ws.open, true, 'a document with workspace values opens the card');
  assert.equal(ws.querySelector('.tp-edit-row[data-key="cost.pipelineLimitUsd"][data-scope="workspaceRuns"] .tp-val').value, '25');
  assert.equal(root.querySelector('.tp-publish').disabled, true, 'nothing changed yet');
  assert.equal(editorDirty(root, SAMPLE_DOC, { registry: REGISTRY }), false);
  const back = docFromEditor(root, { registry: REGISTRY });
  assert.deepEqual(back.fields, SAMPLE_DOC.fields);
  assert.deepEqual(back.workspaceRuns, SAMPLE_DOC.workspaceRuns);
  assert.deepEqual(back.catalogs, SAMPLE_DOC.catalogs);
  assert.equal(back.title, 'Gateway team policy');
  // Edit: unset the pipeline cap, add a marketplace (auto-picks its only kind), flip a kind.
  cap.querySelector('.tp-unset').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const mkt = root.querySelector('.tp-edit-row[data-key="plugins.marketplaces"][data-scope="fields"]');
  mkt.querySelector('.tp-add').value = 'acme/worca-plugins';
  mkt.querySelector('.tp-add-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(mkt.querySelector('.tp-kind-seg .on').dataset.kind, 'default', 'adding a value picks the first allowed kind');
  const after = docFromEditor(root, { registry: REGISTRY });
  assert.equal(after.fields['cost.pipelineLimitUsd'], undefined);
  assert.deepEqual(after.fields['plugins.marketplaces'], { kind: 'default', value: ['acme/worca-plugins'] });
  assert.equal(editorDirty(root, SAMPLE_DOC, { registry: REGISTRY }), true);
  assert.equal(root.querySelector('.tp-publish').disabled, false);
  assert.match(root.querySelector('.tp-change-count').textContent, /^2 changes$/);
  root.remove();
});

test('empty state, sync chip, badge', () => {
  const empty = renderPolicyEmptyState({ doc });
  assert.equal(empty.querySelectorAll('.tm-step').length, 2);
  assert.match(empty.textContent, /Set up team policy on a project/);
  assert.match(empty.textContent, /Pick a policy home for a workspace/);
  assert.ok(empty.querySelector('.tp-check-now'));
  // The team-metrics chip's words: freshness and Refresh only — the commit id lives on the panel.
  const chip = renderPolicySyncChip({ policy: { checkedAt: new Date(Date.now() - 4 * 60_000).toISOString(), sha: '3f2a1bc0deadbeef', warnings: [] } }, { doc });
  assert.equal(chip.textContent, 'Synced 4 min agoRefresh');
  assert.ok(!chip.textContent.includes('3f2a1bc'), 'no commit id in the chip');
  assert.ok(chip.querySelector('.dot.green') && chip.querySelector('.tp-check-now'));
  const busy = renderPolicySyncChip({ policy: { checkedAt: null, warnings: [] } }, { doc, busy: true });
  assert.match(busy.textContent, /^Checking origin…/);
  assert.equal(busy.querySelector('.tp-check-now').disabled, true);
  const warn = renderPolicySyncChip({ policy: { checkedAt: new Date().toISOString(), warnings: ['cost.totalLimitUsd: dropped'] } }, { doc });
  assert.ok(warn.querySelector('.dot.amber'));
  assert.match(warn.textContent, /1 warning/);
  assert.match(warn.querySelector('.tm-sync-error').textContent, /dropped/);
  assert.equal(renderPolicyBadgeFor('acme/gateway', { doc }).className, 'badge blue tp-origin');
  assert.equal(relTime(new Date(Date.now() - 30_000).toISOString()), 'just now');
});

test('workspace line (board 6)', () => {
  const unset = renderWsPolicyLine({ id: 'w', name: 'IoT', home: { state: 'unset' }, members: [] }, { doc });
  assert.match(unset.textContent, /no policy home/);
  assert.equal(unset.querySelector('.wsp-home-change').textContent, 'Choose policy home…');
  assert.match(unset.querySelector('.ws-home-hint').textContent, /use your local settings until a policy home is chosen/);
  // Only what the workspaceRuns block CHANGES, by name (the agreed board-6 copy); a home that is a
  // following member names the project it follows through.
  const ok = renderWsPolicyLine({ id: 'w', name: 'IoT', home: { state: 'ok', slug: 'acme/gateway', follows: null, workspaceRuns: [
    { key: 'cost.pipelineLimitUsd', label: 'Per-pipeline cap (USD)', display: '$25.00' },
    { key: 'guardrails.default', label: 'Default set', display: 'Strict' },
  ] }, members: [{ state: 'home' }, { state: 'none' }] }, { doc });
  assert.equal(ok.querySelector('.ws-policy-line').textContent.trim(), 'follows acme/gateway · for workspace runs: pipeline cap $25.00, guardrails Strict');
  const via = renderWsPolicyLine({ id: 'w', name: 'IoT', home: { state: 'ok', slug: 'acme/gateway', follows: 'acme/billing', workspaceRuns: [] }, members: [] }, { doc });
  assert.equal(via.querySelector('.ws-policy-line').textContent.trim(), 'follows acme/gateway via acme/billing · same values as project runs');
  assert.ok(ok.querySelector('.wsp-open') && ok.querySelector('.wsp-route'));
  assert.equal(ok.querySelector('.wsp-home-change').textContent, 'Change policy home…');
  const stale = renderWsPolicyLine({ id: 'w', name: 'IoT', home: { state: 'stale', detail: 'the policy home is no longer a workspace member' }, members: [] }, { doc });
  assert.ok(stale.querySelector('.tm-dot.red'));
  assert.equal(stale.querySelector('.wsp-route'), null);
});

test('settings readout + chip (board 7)', () => {
  assert.equal(renderTeamCapsReadout([], { doc }), null);
  const node = renderTeamCapsReadout([{ slug: 'acme/gateway', caps: { pipeline: { kind: 'soft', value: 10 }, total: { kind: 'soft', value: 150 }, resetPeriod: 'monthly' }, usedBy: ['acme/gateway', 'acme/billing-api'] }], { doc });
  assert.equal(node.className, 'team-readout');
  assert.equal(node.querySelector('.badge.blue').textContent, 'acme/gateway');
  assert.match(node.textContent, /pipeline \$10\.00 \(soft\) · total \$150\.00\/month \(soft\) · also used by acme\/billing-api/);
  assert.equal(node.querySelector('a.tp-open-page').getAttribute('href'), '#team-policy');
  const chip = renderTeamChip({ kind: 'soft', display: '$10.00' }, { doc });
  assert.equal(chip.className, 'team-chip');
  assert.equal(chip.textContent, 'soft team $10.00');
});

test('New pipeline notes line (board 8)', () => {
  const line = renderPolicyNotesLine({ policy: { home: 'acme/gateway', caps: { pipeline: { kind: 'soft', value: 10 }, pooled: { value: 1200, window: 'monthly' } } }, notes: [{ code: 'model:x', text: 'Model x is not allowed.', level: 'warn' }, { code: 'metrics-off', text: 'Include my runs is off.', level: 'info' }] }, { doc });
  assert.equal(line.className, 'policy-line');
  assert.equal(line.querySelector('.badge.blue').textContent, 'team policy');
  assert.match(line.querySelector('.pl-head-row').textContent, /acme\/gateway · 2 notes · nothing here blocks the run/);
  const notes = line.querySelectorAll('.pl-note');
  assert.equal(notes.length, 3, 'two notes + the caps line');
  assert.ok(notes[0].classList.contains('warn') && notes[0].querySelector('.tm-dot.amber'));
  assert.ok(!notes[1].classList.contains('warn') && notes[1].querySelector('.tm-dot.grey'));
  assert.match(notes[2].textContent, /pipeline cap \$10\.00 \(soft\) · pooled budget \$1,200\.00 \/ monthly/);
});

test('team-cap pause banner (board 9) and the stats-view delegation', () => {
  const rec = { pauseReason: 'cost_pipeline_policy', pauseDetail: 'team cost cap reached ($10.00 >= $10.00, acme/gateway)', pipelineId: 'p1', totalCostUsd: 10 };
  const b = renderTeamCapPauseBanner(rec, { doc, budget: { pipelineLimitUsd: 25 } });
  assert.equal(b.className, 'cost-banner cb-policy cb-policy-pipeline');
  assert.equal(b.querySelector('b').textContent, 'Paused — team cost cap reached');
  // Board 9: the figures and the home from the harness detail, and the developer's own limit.
  assert.equal(b.querySelector('.cb-text').textContent,
    "This pipeline's estimated cost hit $10.00, the per-pipeline cap of $10.00 set by acme/gateway's team policy. Your own limit is $25.00. You can continue past the team cap for this pipeline; the overshoot is recorded to team metrics.");
  assert.equal(b.querySelector('.cb-home').textContent, 'acme/gateway', 'the home is inline, not a block <b>');
  const tot = renderTeamCapPauseBanner({ pauseReason: 'cost_total_policy', pauseDetail: 'team total cap reached ($160.00 >= $150.00 this month, acme/gateway)' }, { doc, budget: {} });
  assert.match(tot.querySelector('.cb-text').textContent, /^Estimated spend is \$160\.00 this month, past the \$150\.00 total cap set by acme\/gateway's team policy\. You can continue past the team cap once for this period/);
  assert.equal(b.querySelector('.cb-past-team-cap').textContent, 'Continue past team cap (this pipeline)');
  assert.equal(b.querySelector('.cb-past-team-cap').dataset.pipelineId, 'p1');
  assert.ok(b.querySelector('.cb-policy-open'));
  assert.equal(b.querySelector('.cb-override'), null, 'never the local-cap action');
  const t = renderTeamCapPauseBanner({ pauseReason: 'cost_total_policy', pauseDetail: '' }, { doc });
  assert.equal(t.querySelector('b').textContent, 'Paused — team total cap reached');
  assert.equal(t.querySelector('.cb-past-team-cap').textContent, 'Continue past team cap (this period)');
  for (const reason of POLICY_PAUSE_REASONS) {
    const via = renderCostPauseBanner({ pauseReason: reason, pipelineId: 'p1', totalCostUsd: 1 }, { doc, budget: {} });
    assert.ok(via.classList.contains('cb-policy'), `${reason} delegates to the policy variant`);
  }
  const local = renderCostPauseBanner({ pauseReason: 'cost_pipeline', pipelineId: 'p1', totalCostUsd: 1 }, { doc, budget: { pipelineLimitUsd: 1 } });
  assert.ok(local.classList.contains('cb-pipeline'), 'the local variant is untouched');
});

test('plugins strip + setup checklist (boards 10–11)', () => {
  assert.equal(renderRequiredStrip([{ name: 'a', state: 'ok', homes: ['h'] }], [], { doc }), null);
  const reqs = [
    { name: 'acme-jira', marketplace: 'acme/worca-plugins', minVersion: '1.2.0', homes: ['acme/gateway'], installed: null, state: 'missing', config: { baseUrl: 'x' } },
    { name: 'github-source', marketplace: 'worca-cc', minVersion: '1.2.0', homes: ['acme/gateway'], installed: { version: '1.1.0', enabled: true }, state: 'outdated' },
  ];
  const strip = renderRequiredStrip(reqs, [{ name: 'legacy', home: 'acme/gateway' }], { doc });
  assert.equal(strip.className, 'card pl-required-card', 'one panel, not a strip per plugin');
  assert.match(strip.querySelector('.card-head').textContent, /team policyRequired by team policy3/);
  const rows = strip.querySelectorAll('.pl-required');
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /acme-jira ≥ 1\.2\.0expected by acme\/gatewaynot installed/);
  assert.equal(rows[0].querySelector('.pl-policy-install').dataset.name, 'acme-jira');
  assert.equal(rows[0].querySelector('.pl-policy-install').dataset.marketplace, 'acme/worca-plugins');
  assert.ok(!rows[0].querySelector('.pl-policy-install').classList.contains('btn-primary'), 'per-row actions are quiet; the head carries the primary one');
  assert.equal(rows[1].querySelector('.pl-policy-update').dataset.name, 'github-source');
  assert.match(rows[1].querySelector('.pl-required-state').textContent, /installed 1\.1\.0 · below the floor/);
  assert.match(rows[2].textContent, /legacyblocked by acme\/gateway · runs proceed and are recorded as off-policyenabled here/);
  assert.ok(strip.querySelector('.card-head .pl-policy-setup'));
  assert.equal(strip.querySelector('.pl-policy-all').textContent, 'Install & update all…', 'one missing + one outdated: both verbs');
  assert.ok(strip.querySelector('.pl-policy-all').classList.contains('btn-primary'), 'the all button is the primary action');
  const list = renderSetupChecklist({ home: 'acme/gateway', requirements: reqs, seeds: [{ url: 'https://github.com/acme/worca-plugins', added: true }], trusted: false }, { doc });
  const srows = list.querySelectorAll('.tp-setup-row');
  assert.equal(srows.length, 4, 'marketplace + install + configure + update');
  assert.match(srows[0].textContent, /Marketplace added/);
  assert.equal(srows[1].querySelector('.pl-policy-install').dataset.name, 'acme-jira');
  assert.equal(srows[2].querySelector('.pl-policy-configure').disabled, true, 'configure waits for the install');
  assert.equal(srows[3].querySelector('.pl-policy-update').dataset.name, 'github-source');
  const trust = list.querySelector('.tp-trust');
  assert.equal(trust.checked, false);
  assert.equal(trust.dataset.home, 'acme/gateway');
  assert.match(list.querySelector('.tp-trust-row').textContent, /Plugins run with your user privileges/);
  assert.equal(list.querySelector('.tp-install-all').disabled, false);
  assert.equal(list.querySelector('.tp-install-all').textContent, 'Install & update all…', 'the checklist button says the same');
  assert.ok(list.querySelector('.tp-later'));
});

test('requiredAllLabel: the verb follows what is left to do; nothing left → no button', () => {
  const missing = { name: 'a', state: 'missing' }; const outdated = { name: 'b', state: 'outdated' }; const ok = { name: 'c', state: 'ok' };
  assert.equal(requiredAllLabel([missing, ok]), 'Install all…');
  assert.equal(requiredAllLabel([outdated, ok]), 'Update all…');
  assert.equal(requiredAllLabel([missing, outdated]), 'Install & update all…');
  assert.equal(requiredAllLabel([ok]), null);
  assert.equal(requiredAllLabel([]), null);
  const done = renderRequiredStrip([ok, { name: 'd', state: 'disabled', homes: ['h'], installed: { version: '1' } }], [], { doc });
  assert.equal(done.querySelector('.pl-policy-all'), null, 'a disabled plugin is not something the button can do');
  assert.ok(done.querySelector('.pl-policy-setup'));
  const updates = renderPolicyPluginsPanel({ requirements: [outdated], blockedPlugins: [] }, { doc });
  assert.equal(updates.querySelector('.tp-plugins .card-head .pl-policy-all').textContent, 'Update all…');
  const clean = renderSetupChecklist({ home: 'h', requirements: [ok], seeds: [], trusted: false }, { doc });
  assert.equal(clean.querySelector('.tp-install-all').disabled, true);
});

// ---- Team policy page: the shared document, this machine, the tabs ---------------------------
const PAYLOAD = {
  scope: { kind: 'project', id: 'bl-00000001', name: 'billing-api' },
  policy: {
    home: 'gateway', sha: '3fc3cee0deadbeef', delegated: true, from: 'billing-api', warnings: [], checkedAt: new Date().toISOString(), workspaceRun: false,
    doc: { title: 'Gateway team policy', notes: 'Q4 budget. Ask Mara before raising anything.', updatedAt: new Date(Date.now() - 11 * 60_000).toISOString(), updatedBy: 'Mara Lindqvist',
      catalogs: { guardrailSets: [{ id: 'gateway-normal', name: 'Gateway normal', envScrub: true, protectedPaths: ['.env*'], deny: ['Bash(git push)'] }], models: [{ id: 'acme-proxy-opus', label: 'Opus via Acme', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'https://llm' } }] } },
  },
  rows: [
    { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', shown: true, team: { kind: 'soft', value: 10, display: '$10.00' }, local: { set: true, value: 25, display: '$25.00' }, effective: { value: 10, display: '$10.00', source: 'team' }, note: 'yours ($25.00) is looser; the team cap applies' },
    { key: 'cost.totalLimitUsd', group: 'cost', label: 'Total cap per period (USD)', shown: true, team: { kind: 'soft', value: 150, display: '$150.00' }, local: { set: true, value: 120, display: '$120.00' }, effective: { value: 120, display: '$120.00', source: 'local' }, note: 'yours is tighter' },
    { key: 'cost.resetPeriod', group: 'cost', label: 'Reset period', shown: true, team: { kind: 'default', value: 'monthly', display: 'monthly' }, local: null, effective: { value: 'monthly', display: 'monthly', source: 'team-default' }, note: null },
    { key: 'run.humanInLoop', group: 'runs', label: 'Human in the loop', shown: false, team: null, local: null, effective: { value: true, display: 'on', source: 'default' }, note: null },
  ],
  requirements: [
    { name: 'acme-jira', marketplace: 'acme', minVersion: '1.2.0', state: 'outdated', installed: { version: '1.1.0', enabled: true }, homes: ['gateway'] },
    { name: 'github-source', marketplace: 'acme', minVersion: null, state: 'missing', installed: null, homes: ['gateway'] },
    { name: 'linear', marketplace: null, minVersion: null, state: 'ok', installed: { version: '2.0.0', enabled: true }, homes: ['gateway'] },
  ],
  blockedPlugins: [{ name: 'shell-runner', home: 'gateway' }],
  deviations: [{ code: 'plugin-missing:github-source', level: 'warn', text: 'Required plugin github-source is not installed.' }],
  canPublish: false, worcaVersion: '1.4.0',
};

test('header panel: the published document — title, source, version, notes, and the Edit action', () => {
  const card = renderPolicyHeader(PAYLOAD, { doc });
  assert.equal(card.className, 'card tp-head');
  assert.equal(card.querySelector('.tp-head-kicker').textContent, 'SHARED WITH THE TEAM');
  assert.equal(card.querySelector('.tp-head-title').textContent, 'Gateway team policy');
  const facts = [...card.querySelectorAll('.tp-facts dt')].map((dt, i) => [dt.textContent, card.querySelectorAll('.tp-facts dd')[i].textContent]);
  assert.deepEqual(facts.map((f) => f[0]), ['SOURCE', 'APPLIES TO', 'VERSION', 'NOTES']);
  assert.equal(facts[0][1], 'Follows gateway — the document lives there');
  assert.equal(facts[1][1], 'Runs on billing-api');
  assert.match(facts[2][1], /^3fc3cee · updated 11 min ago by Mara Lindqvist$/);
  assert.match(card.querySelectorAll('.tp-facts dd')[2].querySelector('code').title, /commit 3fc3cee on gateway's worca-policy branch/);
  assert.equal(facts[3][1], 'Q4 budget. Ask Mara before raising anything.');
  const edit = card.querySelector('.tp-edit');
  assert.equal(edit.textContent, 'Edit policy');
  assert.equal(edit.disabled, true, 'a follower cannot publish from here');
  assert.match(card.querySelector('.tp-head-actions .hint').textContent, /Edit it where gateway is registered/);
  // The carrier and a workspace read differently, and the version is the only place the id shows.
  const carrier = renderPolicyHeader({ ...PAYLOAD, policy: { ...PAYLOAD.policy, delegated: false, from: 'gateway' }, scope: { kind: 'project', id: 'gw', name: 'gateway' }, canPublish: true }, { doc });
  assert.match(carrier.querySelector('.tp-facts dd').textContent, /^This project's own worca-policy branch$/);
  assert.equal(carrier.querySelector('.tp-edit').disabled, false);
  assert.equal(carrier.querySelector('.tp-head-actions .hint'), null);
  assert.equal(renderPolicyHeader(PAYLOAD, { doc, editing: true }).querySelector('.tp-edit').textContent, 'Cancel editing');
  const ws = renderPolicyHeader({ ...PAYLOAD, scope: { kind: 'workspace', id: 'w', name: 'IoT SP' }, policy: { ...PAYLOAD.policy, workspaceRun: true } }, { doc });
  assert.match(ws.querySelectorAll('.tp-facts dd')[0].textContent, /^Policy home gateway · the home follows it through billing-api$/);
  assert.match(ws.querySelectorAll('.tp-facts dd')[1].textContent, /^Workspace runs of IoT SP/);
});

test('stat cards: what this machine will use, with the source and what needs attention', () => {
  const grid = renderPolicyStats(PAYLOAD, { doc });
  const cards = [...grid.querySelectorAll('.tp-ov-card')].map((c) => [c.querySelector('.tp-ov-label').textContent, c.querySelector('.tp-ov-value').textContent, c.querySelector('.tp-ov-sub')?.textContent]);
  assert.deepEqual(cards, [
    ['PER-PIPELINE CAP', '$10.00', 'the team cap · yours ($25.00) is looser; the team cap applies'],
    ['TOTAL CAP', '$120.00', 'your own limit · yours is tighter · per month'],
    ['REQUIRED PLUGINS', '1/3', '1 missing · 1 below the floor — see the Plugins tab'],
    ['OFF-POLICY HERE', '1', 'Required plugin github-source is not installed.'],
  ]);
  const warns = [...grid.querySelectorAll('.tp-ov-sub.is-warn')].length;
  assert.equal(warns, 2, 'only the two that need attention are amber');
  const clean = renderPolicyStats({ rows: [], requirements: [], blockedPlugins: [], deviations: [] }, { doc });
  assert.deepEqual([...clean.querySelectorAll('.tp-ov-value')].map((v) => v.textContent), ['none', 'none', 'none', 'none']);
  assert.equal(clean.querySelector('.tp-ov-sub.is-warn'), null);
  assert.match(clean.querySelectorAll('.tp-ov-sub')[3].textContent, /your setup matches/);
});

test('Plugins tab: a row per expected plugin with its state and action, then what the policy blocks', () => {
  const root = renderPolicyPluginsPanel(PAYLOAD, { doc });
  assert.ok(root.querySelector('.tp-plugins .card-head .pl-policy-setup'), 'Set up… opens the checklist');
  assert.equal(root.querySelector('.tp-plugins .card-head .pl-policy-all').textContent, 'Install & update all…', 'one missing + one outdated in the fixture');
  const rows = [...root.querySelectorAll('.tp-plugins-tbl tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  assert.deepEqual(rows[0].slice(0, 4), ['acme-jiraexpected by gateway · from acme', '≥ 1.2.0', '1.1.0', 'below the floor']);
  assert.deepEqual(rows[1].slice(1, 4), ['any version', '—', 'not installed']);
  assert.deepEqual(rows[2].slice(1, 4), ['any version', '2.0.0', 'installed']);
  assert.equal(root.querySelector('tr[data-name="acme-jira"] .pl-policy-update').dataset.name, 'acme-jira');
  const install = root.querySelector('tr[data-name="github-source"] .pl-policy-install');
  assert.deepEqual([install.dataset.name, install.dataset.marketplace], ['github-source', 'acme']);
  assert.equal(root.querySelector('tr[data-name="linear"] .tp-plugin-act').textContent, '');
  assert.match(root.querySelector('.tp-blocked-row').textContent, /shell-runner.*enabled here.*blocked by gateway/s);
  assert.ok(root.querySelector('.tp-plugins-msg'), 'the tab has its own message line');
  const none = renderPolicyPluginsPanel({ requirements: [], blockedPlugins: [] }, { doc });
  assert.match(none.querySelector('.hist-empty').textContent, /expects no plugins/);
  assert.equal(none.querySelector('.tp-blocked'), null);
});

test('Catalog tab: the guardrail sets and models the policy ships', () => {
  const root = renderPolicyCatalogPanel(PAYLOAD, { doc });
  const set = root.querySelector('.tp-catalog-sets .tp-cat-row');
  assert.match(set.textContent, /Gateway normal.*gp:gateway-normal/s);
  assert.match(set.querySelector('small').textContent, /env scrubbed · 1 protected path · 1 deny rule/);
  const model = root.querySelector('.tp-catalog-models .tp-cat-row');
  assert.match(model.textContent, /Opus via Acme.*acme-proxy-opus/s);
  assert.match(model.querySelector('small').textContent, /medium · high · 1 env var · routes via base URL/);
  assert.equal(root.querySelectorAll('.badge.blue').length, 2);
  const empty = renderPolicyCatalogPanel({ policy: { doc: { catalogs: {} } } }, { doc });
  assert.equal(empty.querySelectorAll('.hist-empty').length, 2);
});

test('row chip + summary (policy): a dot, the word and the short state; the cap line rides the title', () => {
  const home = renderProjectTpChip(base, { doc });
  assert.equal(home.className, 'pl-team-item pl-tp');
  assert.equal(home.dataset.kind, 'home');
  assert.equal(home.textContent, 'Policy home');
  assert.ok(home.querySelector('.tm-dot.green'));
  assert.match(home.title, /^Team policy: Home · 14 fields · updated 3 d ago · pipeline cap \$10\.00 \(soft\)/);
  const follows = renderProjectTpChip({ ...base, delegateTo: 'acme/gateway', delegateState: 'ok', home: 'acme/gateway' }, { doc });
  assert.equal(follows.textContent, 'Policy follows acme/gateway');
  const off = renderProjectTpChip({ ...base, present: false, caps: null }, { doc });
  assert.equal(off.textContent, 'Policy off');
  assert.equal(off.title, 'Team policy: Off · your settings apply');
  assert.ok(off.querySelector('.tm-dot.grey'));
  const none = renderProjectTpChip({ ...base, hasOrigin: false }, { doc });
  assert.equal(none.textContent, 'Policy not available');
  assert.equal(none.querySelector('.tm-dot'), null);
  const invalid = projectTpSummary({ ...base, delegateTo: 'acme/old', delegateState: 'invalid', delegateCode: 'DELEGATE_DANGLING', caps: null });
  assert.deepEqual([invalid.kind, invalid.tone, invalid.short], ['delegate-invalid', 'red', 'follow invalid']);
  const unsupported = projectTpSummary({ ...base, unknownSchema: true, warnings: ['schema 9 is newer than this Worca reads'] });
  assert.deepEqual([unsupported.tone, unsupported.short, unsupported.detail], ['red', 'needs a newer Worca', 'schema 9 is newer than this Worca reads']);
  const cell = renderProjectTpCell(base, { doc, heading: false });
  assert.equal(cell.querySelector('.tm-label'), null);
  assert.ok(cell.querySelector('.tp-open'));
});
