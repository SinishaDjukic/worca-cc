// test/agent-capabilities.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgentCapabilities, planRunAgentCapabilities, buildCapabilityCatalog, warningLines, toolId, knownToolsByServer } from '../src/core/agent-capabilities.mjs';

const GH = 'plugin:gh/github', DOCS = 'manual:docs', POL = 'policy:acme/audit', LIN = 'native:linear';
const mcp = () => ({
  sets: [{ id: 'general', group: 'general' }, { id: 'set-1', group: 'set' }, { id: 'team-x', group: 'team' }],
  copies: [
    { name: 'github', copy: 'github', setId: 'set-1', serverId: GH, tools: ['search', 'create_pr', 'merge'] },
    { name: 'docs', copy: 'docs', setId: 'general', serverId: DOCS, tools: ['read'] },
    { name: 'audit', copy: 'audit', setId: 'team-x', serverId: POL, tools: ['scan', 'report'] },
  ],
  skipped: [],
  skippedTools: [],
});
const skills = () => ({
  sets: [{ id: 'set-1', group: 'set' }, { id: 'team-x', group: 'team' }],
  mounted: [
    { id: 'skill:library:lint', name: 'lint', qualifiedName: 'p:lint', setId: 'set-1' },
    { id: 'skill:library:fmt', name: 'fmt', qualifiedName: 'p:fmt', setId: 'set-1' },
    { id: 'skill:plugin:acme/sec', name: 'sec', qualifiedName: 'team:sec', setId: 'team-x' },
  ],
  skipped: [],
});
const native = () => [
  { name: 'linear', raw: 'linear', eligible: true },     // choosable (listed in .mcp.json)
  { name: 'stray', raw: 'stray', eligible: false },      // a source the catalog cannot list
];

test('empty selection changes nothing but still reports team-required items (R-po-8, 12)', () => {
  const p = planAgentCapabilities({ access: {}, mcp: mcp(), skills: skills(), native: native() });
  assert.equal(p.grants, undefined); assert.equal(p.disallowed, undefined); assert.equal(p.skillKeep, undefined);
  assert.deepEqual(p.record.requiredServers.map((s) => s.server), [POL]);
  assert.deepEqual(p.record.requiredSkills.map((s) => s.skill), ['skill:plugin:acme/sec']);
  assert.ok(p.record.emptyServers && p.record.emptySkills);
});

test('servers chosen, no skills: every skill stays (R-po-11)', () => {
  const p = planAgentCapabilities({ access: { mcpAccess: [{ server: GH, tools: 'all' }] }, mcp: mcp(), skills: skills() });
  assert.equal(p.skillKeep, undefined);
});

test('chosen server + required server; others denied; required gets ALL tools (R-po-6, 12, 18; A-6)', () => {
  const p = planAgentCapabilities({
    access: { mcpAccess: [{ server: GH, tools: ['search'] }, { server: POL, tools: ['scan'] }] },
    mcp: mcp(), skills: skills(),
  });
  assert.ok(p.grants.includes(toolId('github', 'search')));
  assert.ok(!p.grants.includes('mcp__github'));
  assert.ok(p.grants.includes('mcp__audit'));                       // team-required => wildcard
  assert.ok(p.disallowed.includes('mcp__docs'));                    // not chosen, not required
  assert.ok(p.disallowed.includes(toolId('github', 'merge')));      // known, not chosen: explicit deny
  assert.equal(p.record.servers.find((s) => s.server === POL).tools, 'all');
  assert.deepEqual(p.record.servers.find((s) => s.server === POL).toolNames, ['scan', 'report']);
});

test('All tools + excluded: wildcard grant, explicit deny per excluded tool, new tool flows in (R-po-15, 16; A-1)', () => {
  const m = mcp();
  m.copies[0].tools.push('brand_new');
  const p = planAgentCapabilities({
    access: { mcpAccess: [{ server: GH, tools: 'all', reviewedTools: ['search', 'create_pr', 'merge'], excludedTools: ['merge'] }] },
    mcp: m, skills: skills(),
  });
  assert.ok(p.grants.includes('mcp__github'));
  assert.ok(p.disallowed.includes(toolId('github', 'merge')));
  const rec = p.record.servers.find((s) => s.server === GH);
  assert.deepEqual(rec.toolNames, ['search', 'create_pr', 'brand_new']);   // new tool received while still unreviewed
  assert.deepEqual(rec.excluded, ['merge']);
});

test('a required server ignores excludedTools (A-6)', () => {
  const p = planAgentCapabilities({ access: { mcpAccess: [{ server: POL, tools: 'all', excludedTools: ['scan'] }] }, mcp: mcp(), skills: skills() });
  assert.ok(p.grants.includes('mcp__audit'));
  assert.ok(!p.disallowed.includes(toolId('audit', 'scan')));
});

test('native servers: chosen is granted, unchosen eligible is denied, ineligible passes through (M4)', () => {
  const p = planAgentCapabilities({ access: { mcpAccess: [{ server: GH, tools: 'all' }] }, mcp: mcp(), skills: skills(), native: native() });
  assert.ok(p.disallowed.includes('mcp__linear'));
  assert.ok(p.grants.includes('mcp__stray'));                       // not choosable => not hidden
  assert.ok(!p.disallowed.includes('mcp__stray'));
  const q = planAgentCapabilities({ access: { mcpAccess: [{ server: LIN, tools: 'all' }] }, mcp: mcp(), skills: skills(), native: native() });
  assert.ok(q.grants.includes('mcp__linear'));
  assert.ok(q.disallowed.includes('mcp__github'));
  const gone = planAgentCapabilities({ access: { mcpAccess: [{ server: 'native:old', name: 'old', tools: 'all' }] }, mcp: mcp(), skills: skills(), native: native() });
  assert.ok(gone.missing.some((x) => x.kind === 'server' && x.label === 'old'));
});

test('a provided server the catalog did not offer (eligible:false) is never denied, even when the agent picks other servers (cycle-3 M1)', () => {
  // e.g. the pre-run stand-in thought it unapproved, but the run provides it: it is in the run's grants, not choosable
  const nat = [{ name: 'linear', raw: 'linear', eligible: true }, { name: 'wip', raw: 'wip', eligible: false }];
  const p = planAgentCapabilities({ access: { mcpAccess: [{ server: GH, tools: 'all' }] }, mcp: mcp(), skills: skills(), native: nat });
  assert.ok(p.disallowed.includes('mcp__linear'));
  assert.ok(!p.disallowed.includes('mcp__wip'));
  assert.ok(p.grants.includes('mcp__wip'));
});

test('a chosen native server the run does not provide is missing, with the caller-supplied reason (cycle-2 #1, #6)', () => {
  const p = planAgentCapabilities({
    access: { mcpAccess: [{ server: 'native:wip', name: 'wip', tools: 'all' }] }, mcp: mcp(), skills: skills(), native: native(),
    notProvided: { 'native:wip': 'not approved in Claude Code yet' },
  });
  assert.deepEqual(p.missing.map((x) => [x.kind, x.label, x.reason]), [['server', 'wip', 'not approved in Claude Code yet']]);
  assert.ok(!p.grants.includes('mcp__wip'));
});

test('a team-required server the agent did not choose is still received (R-po-12)', () => {
  const p = planAgentCapabilities({ access: { mcpAccess: [{ server: DOCS, tools: 'all' }] }, mcp: mcp(), skills: skills() });
  assert.ok(p.grants.includes('mcp__audit'));
});

test('skills: chosen + team-required only (R-po-6, 12)', () => {
  const p = planAgentCapabilities({ access: { skillAccess: [{ skill: 'skill:library:lint' }] }, mcp: mcp(), skills: skills() });
  assert.deepEqual(p.skillKeep.map((m) => m.name).sort(), ['lint', 'sec']);
  assert.equal(p.grants, undefined);                                // no servers chosen => everything (R-po-11)
});

test('missing items are listed, never fatal (R-po-10, 13; A-10)', () => {
  const m = mcp();
  m.copies = m.copies.filter((c) => c.serverId !== GH);
  m.skipped = [{ serverId: GH, setId: 'set-1', reason: 'opted-out' }];
  m.skippedTools = [{ name: 'docs', tool: 'read', reason: 'tool-name-too-long:read' }];
  const p = planAgentCapabilities({
    access: { mcpAccess: [{ server: GH, name: 'github', tools: 'all' }, { server: DOCS, tools: ['read', 'gone'] }],
              skillAccess: [{ skill: 'skill:library:old', name: 'old' }] },
    mcp: m, skills: skills(),
  });
  const labels = p.missing.map((x) => `${x.kind}:${x.label}`);
  assert.ok(labels.includes('server:github'));
  assert.ok(labels.some((l) => l.startsWith('tool:read')));         // held back at run level
  assert.ok(labels.some((l) => l.startsWith('tool:gone')));
  assert.ok(labels.includes('skill:old'));
  assert.ok(warningLines(p, 'Reviewer').every((l) => l.startsWith('Agent "Reviewer"')));
});

test('other engines record but do not enforce (no lists leave the plan); bypassPermissions leaks are noted (m7, cycle-2 #2)', () => {
  const sel = { mcpAccess: [{ server: GH, tools: ['search'] }], skillAccess: [{ skill: 'skill:library:lint' }] };
  const codex = planAgentCapabilities({ access: sel, mcp: mcp(), skills: skills(), engine: 'codex' });
  assert.equal(codex.enforced, false);
  assert.equal(codex.grants, undefined); assert.equal(codex.disallowed, undefined); assert.equal(codex.skillKeep, undefined);
  assert.ok(codex.record.servers.length && codex.record.skills.length);       // still recorded for the run details
  assert.ok(warningLines(codex, 'R').some((l) => /engine/.test(l)));
  const m = mcp(); m.copies[0].tools = null;                        // untested server, explicit picks
  const bypass = planAgentCapabilities({ access: sel, mcp: m, skills: skills(), permissionMode: 'bypassPermissions' });
  assert.match(bypass.note, /bypassPermissions/);
  assert.equal(planAgentCapabilities({ access: sel, mcp: mcp(), skills: skills() }).note, undefined);
});

test('planRunAgentCapabilities plans every node, empty selections included', () => {
  const plans = planRunAgentCapabilities({ nodes: [{ id: 'a', access: {} }, { id: 'b', access: { skillAccess: [{ skill: 'skill:library:lint' }] } }], mcp: mcp(), skills: skills() });
  assert.deepEqual([...plans.keys()], ['a', 'b']);
});

test('catalog groups Project, Team, Personal and marks required, held-back, native and unavailable (R-po-1, 4, 7, 14)', () => {
  const m = mcp();
  m.skippedTools = [{ name: 'github', tool: 'merge', reason: 'tool-name-too-long:merge' }];
  m.skipped = [{ serverId: 'manual:gone', setId: 'general', reason: 'plugin-disabled' }];
  const c = buildCapabilityCatalog({ mcp: m, skills: skills(), native: [
    { name: 'linear', group: 'project', approval: 'approved' },
    { name: 'wip', group: 'project', approval: 'unapproved' },       // committed-identical .mcp.json server Claude has not approved: not in the run
    { name: 'off', group: 'project', approval: 'disabled' },         // committed-identical and listed in disabledMcpjsonServers
    { name: 'me', group: 'personal', approval: 'approved' },         // local-scope server
  ] });
  assert.deepEqual(c.servers.map((s) => [s.id, s.group, s.required]),
    [[GH, 'project', false], [LIN, 'project', false], [POL, 'team', true], [DOCS, 'personal', false], ['native:me', 'personal', false]]);
  assert.equal(c.unavailable.servers['native:wip'], 'not approved in Claude Code yet');   // shown as Unavailable if already picked
  assert.equal(c.unavailable.servers['native:off'], 'turned off in Claude Code');
  assert.equal(c.servers.find((s) => s.id === GH).tools.find((t) => t.name === 'merge').heldBack, 'name too long');
  assert.equal(c.servers.find((s) => s.id === LIN).tools, null);    // native servers: no tool list
  assert.equal(c.unavailable.servers['manual:gone'], 'its plugin is turned off');
});

test('knownToolsByServer takes ok Test results, later wins', () => {
  const k = knownToolsByServer({
    's1|plugin:gh/github': { ok: true, at: '2026-01-01', tools: ['a'] },
    's2|plugin:gh/github': { ok: true, at: '2026-02-01', tools: ['a', 'b'] },
    's1|manual:x': { ok: false, at: '2026-03-01', tools: ['z'] },
  });
  assert.deepEqual(k.get('plugin:gh/github'), ['a', 'b']);
  assert.equal(k.has('manual:x'), false);
});
