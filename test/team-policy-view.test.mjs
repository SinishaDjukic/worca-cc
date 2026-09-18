// test/team-policy-view.test.mjs — pure renderers of ui/public/team-policy-view.mjs (team-policy
// design §11, boards 2–11) and the cost-banner delegation in stats-view.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  projectTpState, renderProjectTpCell, renderPolicyEnableDialogBody, renderEffectiveTable, renderPolicyEditor, docFromEditor, editorDirty,
  renderPolicyEmptyState, renderPolicySyncChip, renderWsPolicyLine, renderTeamCapsReadout, renderTeamChip, renderPolicyNotesLine,
  renderTeamCapPauseBanner, renderRequiredStrip, renderSetupChecklist, renderPolicyBadgeFor, relTime, POLICY_PAUSE_REASONS,
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
  const chip = renderPolicySyncChip({ policy: { checkedAt: new Date(Date.now() - 4 * 60_000).toISOString(), sha: '3f2a1bc0deadbeef', warnings: [] } }, { doc });
  assert.match(chip.textContent, /synced 4 min ago · 3f2a1bc/);
  assert.ok(chip.querySelector('.tp-check-now'));
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
  const rows = strip.querySelectorAll('.pl-required');
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /acme\/gateway expects acme-jira ≥ 1\.2\.0, not installed\./);
  assert.equal(rows[0].querySelector('.pl-policy-install').dataset.name, 'acme-jira');
  assert.equal(rows[0].querySelector('.pl-policy-install').dataset.marketplace, 'acme/worca-plugins');
  assert.equal(rows[1].querySelector('.pl-policy-update').dataset.name, 'github-source');
  assert.match(rows[2].textContent, /blocks legacy, which is enabled here/);
  assert.ok(strip.querySelector('.pl-policy-setup'));
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
  assert.ok(list.querySelector('.tp-later'));
});
