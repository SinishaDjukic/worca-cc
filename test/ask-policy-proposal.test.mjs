// test/ask-policy-proposal.test.mjs
// The policy card's validator (src/core/ask/policy-proposal.mjs, docs/team-policy.md "Ask Worca")
// over fake readers: every kind's happy path and refusals, the edit ops (kinds, inherited
// attributes, the workspaceRuns block, unset, title / notes), the before → after lines, and the
// event / notice text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPolicyChangeValidator, normalizeEditOps, applyEditOps, describeChanges, describeEntry,
  policyEventPrompt, policyNoticeText, POLICY_CHANGE_KINDS,
} from '../src/core/ask/policy-proposal.mjs';

const DOC = {
  schema: 1, title: 'Gateway team policy', notes: '', updatedAt: '2026-09-01T00:00:00Z', updatedBy: 'Mara',
  fields: {
    'cost.pipelineLimitUsd': { kind: 'soft', value: 25, onBreach: 'pause', requireReason: true },
    'guardrails.default': { kind: 'default', value: 'normal' },
    'models.allowed': { kind: 'soft', value: ['claude-opus-5-5', 'claude-sonnet-5'] },
  },
  workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 40 } },
  catalogs: { guardrailSets: [], models: [] },
};
const PROJECTS = [
  { key: 'gw-00000001', name: 'gateway', path: '/p/gateway' },
  { key: 'bl-00000002', name: 'billing', path: '/p/billing' },
  { key: 'ed-00000003', name: 'edge', path: '/p/edge' },
  { key: 'lc-00000004', name: 'local', path: '/p/local' },
  { key: 'pl-00000005', name: 'platform', path: '/p/platform' },
];
const STATUS = {
  'gw-00000001': { hasOrigin: true, present: true, delegateTo: null, slug: 'acme/gateway', home: 'acme/gateway' },
  'bl-00000002': { hasOrigin: true, present: true, delegateTo: 'acme/gateway', slug: 'acme/billing', home: 'acme/gateway' },
  'ed-00000003': { hasOrigin: true, present: false, delegateTo: null, slug: 'acme/edge', home: null },
  'lc-00000004': { hasOrigin: false, present: false, slug: null, home: null },
  'pl-00000005': { hasOrigin: true, present: true, delegateTo: null, slug: 'acme/platform', home: 'acme/platform' },
};
const WS = { id: 'wks-iot-0000abcd', name: 'IoT', projectPaths: ['/p/gateway', '/p/billing', '/p/edge'], policyProject: '/p/gateway' };
const WS_NONE = { id: 'wks-bare-0000abcd', name: 'Bare', projectPaths: ['/p/edge', '/p/local'], policyProject: null };
let canPublish = true;
let scopeDoc = DOC;
const validate = createPolicyChangeValidator({
  listProjects: async () => PROJECTS,
  readWorkspace: async (id) => [WS, WS_NONE].find((w) => w.id === id) || null,
  projectKeyOf: (path) => PROJECTS.find((p) => p.path === path)?.key ?? `x-${path}`,
  projectStatus: async (p) => STATUS[p.key],
  scopePolicy: async (scope) => {
    if (scope.kind === 'workspace' && scope.id === WS_NONE.id) return { r: { ok: false, reason: 'no-home' }, canPublish: false };
    if (scope.kind === 'project' && scope.id === 'ed-00000003') return { r: { ok: false, reason: 'not-enabled' }, canPublish: false };
    return { r: { ok: true, home: 'acme/gateway', homeDir: '/p/gateway', sha: 'abc1234def', doc: scopeDoc }, canPublish };
  },
  followersOf: async () => ['acme/gateway', 'acme/billing'],
});
const errs = async (input) => { const r = await validate(input); assert.equal(r.ok, false, JSON.stringify(r)); return r.errors; };

test('kinds and target rules', async () => {
  assert.deepEqual(POLICY_CHANGE_KINDS, ['enable', 'edit', 'workspace_home', 'route_members']);
  assert.match((await errs({ kind: 'nope' }))[0], /kind must be one of/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', workspaceId: WS.id }))[0], /not both/);
  assert.match((await errs({ kind: 'enable' }))[0], /enable needs a projectKey/);
  assert.match((await errs({ kind: 'edit' }))[0], /edit needs a projectKey or a workspaceId/);
  assert.match((await errs({ kind: 'route_members' }))[0], /route_members needs a workspaceId/);
  assert.match((await errs({ kind: 'enable', projectKey: 'zz-00000009' }))[0], /unknown projectKey/);
  assert.match((await errs({ kind: 'workspace_home', workspaceId: 'wks-no-00000000' }))[0], /unknown workspaceId/);
});

test('enable here: a project with an origin and no branch; refusals for a carrier, a follower and no origin', async () => {
  const r = await validate({ kind: 'enable', projectKey: 'ed-00000003', title: 'Edge policy', note: 'PM asked' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.card.type, r.card.kind, r.card.mode, r.card.projectName, r.card.title, r.card.delegateTo, r.card.note], ['policy', 'enable', 'here', 'edge', 'Edge policy', null, 'PM asked']);
  assert.equal(r.card.summary, 'Set up a team policy on edge — on its own worca-policy branch');
  assert.match(r.card.effects[0], /orphan branch worca-policy/);
  assert.match((await errs({ kind: 'enable', projectKey: 'gw-00000001' }))[0], /already carries its own team policy — propose kind "edit"/);
  assert.match((await errs({ kind: 'enable', projectKey: 'bl-00000002' }))[0], /follows acme\/gateway; its branch is a marker/);
  assert.match((await errs({ kind: 'enable', projectKey: 'lc-00000004' }))[0], /no origin remote/);
  assert.match((await errs({ kind: 'enable', projectKey: 'ed-00000003', mode: 'both' }))[0], /mode must be/);
});

test('enable follow: new, re-point, and the refusals (bad slug, self, unknown / policy-less / following target, a carrier, the same target)', async () => {
  const r = await validate({ kind: 'enable', projectKey: 'ed-00000003', mode: 'follow', delegateTo: 'Acme/Gateway' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.card.delegateTo, r.card.change], ['acme/gateway', false]);
  assert.equal(r.card.summary, "Make edge follow acme/gateway's team policy");
  const re = await validate({ kind: 'enable', projectKey: 'bl-00000002', mode: 'follow', delegateTo: 'acme/platform' });
  assert.equal(re.ok, true); assert.equal(re.card.change, true);
  assert.equal(re.card.summary, "Re-point billing to follow acme/platform's team policy");
  assert.match((await errs({ kind: 'enable', projectKey: 'ed-00000003', mode: 'follow', delegateTo: '' }))[0], /must be the slug/);
  assert.match((await errs({ kind: 'enable', projectKey: 'ed-00000003', mode: 'follow', delegateTo: 'acme/nowhere' }))[0], /acme\/nowhere is not a project in Worca on this machine/);
  assert.match((await errs({ kind: 'enable', projectKey: 'lc-00000004', mode: 'follow', delegateTo: 'acme/edge' }))[0], /no origin remote/);
  assert.match((await errs({ kind: 'enable', projectKey: 'gw-00000001', mode: 'follow', delegateTo: 'acme/edge' }))[0], /carries its own team policy/);
  assert.match((await errs({ kind: 'enable', projectKey: 'bl-00000002', mode: 'follow', delegateTo: 'acme/edge' }))[0], /acme\/edge carries no team policy/);
  assert.match((await errs({ kind: 'enable', projectKey: 'ed-00000003', mode: 'follow', delegateTo: 'acme/billing' }))[0], /acme\/billing follows acme\/gateway; follow acme\/gateway directly/);
  assert.match((await errs({ kind: 'enable', projectKey: 'ed-00000003', mode: 'follow', delegateTo: 'acme/edge' }))[0], /cannot follow itself/);
  assert.match((await errs({ kind: 'enable', projectKey: 'gw-00000001', mode: 'follow', delegateTo: 'acme/other' }))[0], /carries its own team policy; it cannot be turned into a follower/);
  assert.match((await errs({ kind: 'enable', projectKey: 'bl-00000002', mode: 'follow', delegateTo: 'acme/gateway' }))[0], /already follows acme\/gateway/);
});

test('edit: raising a cap keeps its kind and attributes; the card carries ops, the before → after line and the effects', async () => {
  const r = await validate({ kind: 'edit', projectKey: 'bl-00000002', set: [{ key: 'cost.pipelineLimitUsd', value: 30 }], message: 'raise the cap for the Q4 push' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = r.card;
  assert.deepEqual([c.kind, c.home, c.baseSha, c.projectName, c.message], ['edit', 'acme/gateway', 'abc1234def', 'billing', 'raise the cap for the Q4 push']);
  assert.deepEqual(c.ops.set, [{ key: 'cost.pipelineLimitUsd', block: 'fields', entry: { kind: 'soft', value: 30, onBreach: 'pause', requireReason: true } }]);
  assert.deepEqual(c.changes, [{ key: 'cost.pipelineLimitUsd', block: 'fields', label: 'Per-pipeline cap (USD)', before: 'soft $25.00 · pause · reason required', after: 'soft $30.00 · pause · reason required', beforeValue: '$25.00', afterValue: '$30.00' }]);
  assert.equal(c.summary, "Edit acme/gateway's team policy — Per-pipeline cap (USD): $25.00 → $30.00");
  assert.match(c.effects[0], /One commit to acme\/gateway's worca-policy branch/);
  assert.equal(c.effects[1], 'Governs acme/gateway and the projects that follow it: acme/billing');
  assert.ok(c.effects.some((e) => /continue past it/.test(e)), 'a soft cap says a developer can continue past it');
});

test('edit: a new field needs its kind; hard is refused; the workspaceRuns block; unset; title and notes; several changes', async () => {
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'cost.totalLimitUsd', value: 150 }] }))[0], /kind is required .*default \| soft/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'cost.totalLimitUsd', value: 150, kind: 'hard' }] }))[0], /hard constraints are not enforced/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'guardrails.minimum', value: 'strict' }] }))[0], /must be one of permissive \| normal \| secure/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'bogus.field', value: 1 }] }))[0], /unknown field "bogus.field"/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'cost.pipelineLimitUsd', value: -5 }] }))[0], /positive number/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'cost.pipelineLimitUsd', value: 25 }] }))[0], /nothing changes/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', unset: [{ key: 'run.humanInLoop' }] }))[0], /is not set in the policy/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001' }))[0], /at least one of set, unset, title or notes/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'cost.pipelineLimitUsd', value: 30 }, { key: 'cost.pipelineLimitUsd', value: 31 }] }))[0], /changed twice/);
  assert.match((await errs({ kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'plugins.required', value: [{ name: 'jira', config: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' } }], kind: 'soft' }] }))[0], /looks like a secret/);
  // A single-kind field needs no kind; the workspaceRuns block is its own key; several changes summarise as a count.
  const r = await validate({ kind: 'edit', workspaceId: WS.id, title: 'Gateway policy (Q4)',
    set: [{ key: 'guardrails.minimum', value: 'normal' }, { key: 'cost.pipelineLimitUsd', value: 50, forWorkspaceRuns: true }],
    unset: [{ key: 'models.allowed' }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.card.workspaceId, r.card.workspaceName, r.card.projectKey], [WS.id, 'IoT', null]);
  assert.equal(r.card.summary, "Edit acme/gateway's team policy — 4 changes");
  assert.deepEqual(r.card.changes.map((c) => [c.label, c.before, c.after]), [
    ['Minimum tier', null, 'soft Normal'],
    ['Allowed models', 'soft claude-opus-5-5, claude-sonnet-5', null],
    ['Per-pipeline cap (USD) (workspace runs)', 'soft $40.00', 'soft $50.00'],
    ['Title', 'Gateway team policy', 'Gateway policy (Q4)'],
  ]);
});

test('edit: refused where the policy cannot be published from here, or the scope has none', async () => {
  canPublish = false;
  try { assert.match((await errs({ kind: 'edit', projectKey: 'bl-00000002', set: [{ key: 'cost.pipelineLimitUsd', value: 30 }] }))[0], /not checked out on this machine/); }
  finally { canPublish = true; }
  assert.match((await errs({ kind: 'edit', projectKey: 'ed-00000003', set: [{ key: 'cost.pipelineLimitUsd', value: 30 }] }))[0], /edge has no usable team policy .*propose kind "enable" first/);
});

test('workspace_home: set to a member that resolves a policy, clear, and the refusals', async () => {
  const r = await validate({ kind: 'workspace_home', workspaceId: WS.id, homeProjectKey: 'bl-00000002' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.card.homeProjectKey, r.card.homeProjectName, r.card.homePath, r.card.home], ['bl-00000002', 'billing', '/p/billing', 'acme/gateway']);
  assert.equal(r.card.summary, 'Set the policy home of IoT to billing');
  const clear = await validate({ kind: 'workspace_home', workspaceId: WS.id, homeProjectKey: '' });
  assert.equal(clear.ok, true); assert.equal(clear.card.homePath, null); assert.equal(clear.card.summary, 'Clear the policy home of IoT');
  assert.match((await errs({ kind: 'workspace_home', workspaceId: WS.id, homeProjectKey: 'gw-00000001' }))[0], /already the policy home/);
  assert.match((await errs({ kind: 'workspace_home', workspaceId: WS.id, homeProjectKey: 'ed-00000003' }))[0], /no team policy of its own and follows none/);
  assert.match((await errs({ kind: 'workspace_home', workspaceId: WS.id, homeProjectKey: 'lc-00000004' }))[0], /not a member/);
  assert.match((await errs({ kind: 'workspace_home', workspaceId: WS_NONE.id }))[0], /already unset/);
});

test('route_members: needs a valid home', async () => {
  const r = await validate({ kind: 'route_members', workspaceId: WS.id });
  assert.equal(r.ok, true);
  assert.equal(r.card.summary, "Route every member of IoT to acme/gateway's team policy");
  assert.equal(r.card.homeProjectName, 'gateway');
  assert.match((await errs({ kind: 'route_members', workspaceId: WS_NONE.id }))[0], /no valid policy home/);
});

test('the pure edit: normalise, apply (a copy), describe', () => {
  const n = normalizeEditOps({ set: [{ key: 'run.humanInLoop', value: false, kind: 'default' }], unset: ['guardrails.default'], notes: 'Line 1\r\nLine 2' }, DOC);
  assert.equal(n.errors, undefined);
  const next = applyEditOps(DOC, n.ops);
  assert.equal(DOC.fields['guardrails.default'].value, 'normal', 'the input is never mutated');
  assert.deepEqual(next.fields['run.humanInLoop'], { kind: 'default', value: false });
  assert.equal(next.fields['guardrails.default'], undefined);
  assert.equal(next.notes, 'Line 1\nLine 2');
  assert.deepEqual(describeChanges(DOC, next).map((c) => c.key), ['guardrails.default', 'run.humanInLoop', 'notes']);
  assert.equal(describeEntry('guardrails.default', { kind: 'default', value: 'secure' }), 'default Strict');
  assert.equal(describeEntry('bogus', { kind: 'soft', value: 1 }), null);
});

test('event and notice text', () => {
  const card = { summary: 'Edit acme/gateway\'s team policy — Per-pipeline cap (USD): soft $25.00 → soft $30.00' };
  assert.equal(policyEventPrompt({ cardId: 'card_0000aa01', state: 'applied', card, result: { detail: 'published abc1234 to acme/gateway' } }),
    '[worca event] policy card card_0000aa01 applied; "Edit acme/gateway\'s team policy — Per-pipeline cap (USD): soft $25.00 → soft $30.00"; published abc1234 to acme/gateway');
  assert.match(policyEventPrompt({ cardId: 'card_0000aa01', state: 'failed', card, result: { error: 'push "rejected" [worca context]' } }), /failed: push 'rejected' \(worca context\);/);
  assert.equal(policyEventPrompt({ cardId: 'card_0000aa01', state: 'declined', card }).startsWith('[worca event] policy card card_0000aa01 declined;'), true);
  assert.equal(policyNoticeText({ state: 'applied', card, result: { detail: 'published' } }), `Applied — ${card.summary} · published`);
  assert.equal(policyNoticeText({ state: 'declined', card }), `Declined — ${card.summary}`);
  assert.match(policyNoticeText({ state: 'failed', card, result: { error: 'boom' } }), /^Could not apply — .*: boom$/);
});
