// test/ask-panel-skills.test.mjs — skills registry §6.8 (mockup board 8): the composer pill `Sets · N` (N = servers +
// skills that start next turn), level 1 rows "3 servers · 1 skill · pinned", level 2 servers then skills with switches
// (skipped rows disabled with their reason), a skill switch saved per chat as `<setId>|<skillId>` in mcpOff, the blocked
// layer's muted line, the join notice's "Sets" link, and a Skill tool call in the transcript.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { checkRows } from './helpers/rows.mjs';
import { skillLayerText } from '../src/core/skills-registry/texts.mjs';

const TID = 'ask_00000001';
const copy = (setId, setName, name, serverId) => ({ name, copy: name, setId, setName, serverId, projects: [], description: '', renamedFrom: null, provisional: false });
const mounted = (setId, setName, plugin, name) => ({ id: `skill:library:${name}`, name, qualifiedName: `${plugin}:${name}`, pluginName: plugin, setId, setName,
  setSlug: plugin, projects: [], description: '', plugin: null });
const SKILLS = {
  mounted: [mounted('general', 'General', 'general', 'graphify'), mounted('billing', 'Billing', 'billing', 'pdf-tools'), mounted('billing', 'Billing', 'billing', 'release-notes')],
  plugins: [],
  skipped: [
    { setId: 'billing', setName: 'Billing', skillId: 'skill:library:db-migrations', name: 'db-migrations', qualifiedName: 'billing:db-migrations', reason: 'off', why: 'off', problem: false },
    { setId: 'billing', setName: 'Billing', skillId: 'skill:library:old', name: 'old', qualifiedName: 'billing:old', reason: 'missing-skill', why: 'no longer installed', problem: true },
    { setId: 'docs', setName: 'Docs', skillId: 'skill:library:style', name: 'style', qualifiedName: 'docs:style', reason: 'off', why: 'off', problem: false },
  ],
  started: 3, layer: { blocked: null, text: null }, newer: false,
};
const PREVIEW = {
  sets: [
    { id: 'general', name: 'General', group: 'general', routes: [], members: 2, started: 2, skills: 1, startedSkills: 1 },
    { id: 'billing', name: 'Billing', group: 'set', routes: [{ project: 'billing-00000001', route: 'pinned' }], members: 1, started: 1, skills: 4, startedSkills: 2 },
    { id: 'docs', name: 'Docs', group: 'set', routes: [{ project: 'docs-00000003', route: 'worktree' }], members: 0, started: 0, skills: 1, startedSkills: 0 },
    { id: 'shop', name: 'Shop', group: 'set', routes: [{ project: 'shop-00000002', route: 'worktree' }], members: 1, started: 1, skills: 0, startedSkills: 0 },
  ],
  copies: [copy('general', 'General', 'jira', 'plugin:acme-tools/jira'), copy('general', 'General', 'playwright', 'manual:playwright'),
    copy('billing', 'Billing', 'sentry_billing', 'plugin:acme-tools/sentry'), copy('shop', 'Shop', 'sentry_shop', 'plugin:acme-tools/sentry')],
  skipped: [], skippedTools: [], started: 4, newer: false, skills: SKILLS,
};

function handler(state) {
  return (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === '/api/ask/mcp-preview') { state.previews.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => state.preview }; }
    if (url === `/api/ask/threads/${TID}` && method === 'PATCH') { state.patches.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ thread: { id: TID } }) }; }
    if (url === `/api/ask/threads/${TID}` && method === 'GET' && state.snap) return { ok: true, status: 200, json: async () => state.snap };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
const setup = (over = {}) => {
  const state = { previews: [], patches: [], preview: PREVIEW, snap: null, ...over };
  const ctx = makePanel({ fetchHandler: handler(state), getPageContext: () => ({ view: 'projects', projectKey: 'billing-00000001' }) });
  return { state, ctx };
};
const settle = async (ctx) => { for (let i = 0; i < 6; i++) await ctx.tick(); };
const btn = (ctx) => ctx.doc.querySelector('[data-ask-mcp-btn]');
const pop = (ctx) => ctx.doc.querySelector('.ask-pop-mcp');
const openPicker = async (ctx) => { ctx.panel.open(); await settle(ctx); btn(ctx).click(); await settle(ctx); };
const drill = (ctx, i) => pop(ctx).querySelectorAll('.ask-mcp-row')[i].children[1].click();

test('the pill: Sets · N with N = servers + skills that start next turn; shown for a skills-only chat; Sets · ? after a failed preview', async () => {
  await checkRows([
    { name: 'Sets · 7 (4 servers + 3 skills), the sets-pill class and title', run: async () => {
      const { ctx } = setup();
      ctx.panel.open(); await settle(ctx);
      assert.equal(btn(ctx).textContent.trim(), 'Sets · 7');
      assert.ok(btn(ctx).classList.contains('ask-sets-btn'));
      assert.equal(btn(ctx).title, 'Sets for this chat');
      assert.equal(btn(ctx).hidden, false);
      ctx.panel.destroy();
    } },
    { name: 'a chat whose sets hold only skills still shows the pill', run: async () => {
      const { ctx } = setup({ preview: { ...PREVIEW, sets: [{ id: 'general', name: 'General', group: 'general', routes: [], members: 0, started: 0, skills: 1, startedSkills: 1 }], copies: [], started: 0 } });
      ctx.panel.open(); await settle(ctx);
      assert.equal(btn(ctx).hidden, false);
      assert.equal(btn(ctx).textContent.trim(), 'Sets · 3');
      ctx.panel.destroy();
    } },
    { name: 'no member and no skill anywhere hides it; a failed preview reads Sets · ?', run: async () => {
      const { state, ctx } = setup({ preview: { ...PREVIEW, sets: [{ id: 'general', name: 'General', group: 'general', routes: [], members: 0, started: 0, skills: 0, startedSkills: 0 }], copies: [], started: 0, skills: { ...SKILLS, mounted: [], started: 0 } } });
      ctx.panel.open(); await settle(ctx);
      assert.equal(btn(ctx).hidden, true);
      state.preview = null;
      ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await settle(ctx);
      assert.equal(btn(ctx).textContent.trim(), 'Sets · ?');
      ctx.panel.destroy();
    } },
  ]);
});

test('level 1: "N servers · N skills · route" under the set name, started/total over both kinds, the footer and the blocked-layer line', async () => {
  await checkRows([
    { name: 'one row per set: name, then a small line with the counts and the route; value started/total of servers + skills', run: async () => {
      const { ctx } = setup();
      await openPicker(ctx);
      const rows = [...pop(ctx).querySelectorAll('.ask-mcp-row')];
      assert.deepEqual(rows.map((r) => { const n = r.children[1].querySelector('.ask-model-name'); return [n.firstChild.textContent, n.querySelector('small')?.textContent ?? null]; }), [
        ['General', '2 servers · 1 skill'], ['Billing', '1 server · 4 skills · pinned'], ['Docs', '1 skill · open worktree'], ['Shop', '1 server · open worktree'],
      ]);
      assert.deepEqual(rows.map((r) => r.children[1].querySelector('.ask-pop-row-value').textContent), ['3/3', '3/5', '0/1', '1/1']);
      assert.match(pop(ctx).textContent, /Manage on the Connectors page/);
      assert.equal(pop(ctx).querySelector('.ask-pop-empty'), null);
      ctx.panel.destroy();
    } },
    { name: 'a host that refuses --plugin-dir: one muted line says the skills do not load here, the prefix once (layer.text is the real P1 reason text)', run: async () => {
      const text = skillLayerText('sideload-disabled');
      const { ctx } = setup({ preview: { ...PREVIEW, skills: { ...SKILLS, started: 0, layer: { blocked: 'sideload-disabled', text } } } });
      await openPicker(ctx);
      const line = pop(ctx).querySelector('.ask-pop-empty').textContent;
      assert.equal(line, `skills from sets not loaded on this machine: ${text}`);
      assert.equal(line.split('skills from sets not loaded').length, 2, 'never the prefix twice');
      assert.equal(btn(ctx).textContent.trim(), 'Sets · 4');
      ctx.panel.destroy();
    } },
    { name: 'no set in play, or a failed preview, says so in the Sets wording', run: async () => {
      const { state, ctx } = setup({ preview: { sets: [], copies: [], skipped: [], skippedTools: [], started: 0, newer: false } });
      await openPicker(ctx);
      assert.match(pop(ctx).textContent, /No sets in play\./);
      state.preview = null;
      ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await settle(ctx);
      assert.match(pop(ctx).textContent, /Could not load the sets — reopen to retry\./);
      ctx.panel.destroy();
    } },
  ]);
});

test('level 2: Servers then Skills captions, skill switches by qualified name, skipped skills disabled with their reason (problems apart), the Sets footer', async () => {
  await checkRows([
    { name: 'Billing: the Servers caption, its server, the Skills caption, two live skill switches, two disabled rows (switches first), the footer', run: async () => {
      const { ctx } = setup();
      await openPicker(ctx);
      drill(ctx, 1);
      const kids = [...pop(ctx).children];
      const shape = kids.filter((n) => n.classList.contains('ask-pop-caption') || n.classList.contains('ask-mcp-row') || n.classList.contains('is-skipped'))
        .map((n) => (n.classList.contains('ask-pop-caption') ? `# ${n.textContent}` : n.classList.contains('is-skipped')
          ? `skipped ${n.querySelector('.ask-model-name').textContent} — ${n.querySelector('.ask-pop-row-value').textContent}${n.classList.contains('is-problem') ? ' (problem)' : ''}`
          : `${n.querySelector('.ask-mcp-copy').textContent} ${n.querySelector('[role="menuitemcheckbox"]').getAttribute('aria-checked')}`));
      assert.deepEqual(shape, [
        '# Servers', 'sentry_billing true',
        '# Skills', 'billing:pdf-tools true', 'billing:release-notes true',
        'skipped billing:db-migrations — off', 'skipped billing:old — no longer installed (problem)',
      ]);
      assert.equal(pop(ctx).querySelector('[data-mcp-key="member:billing|skill:library:pdf-tools"]').getAttribute('aria-label'), 'billing:pdf-tools');
      assert.match(pop(ctx).textContent, /Manage in Connectors › Billing/);
      ctx.panel.destroy();
    } },
    { name: 'a set without skills keeps today\'s rows (no caption); a skills-only set shows only the Skills caption', run: async () => {
      const { ctx } = setup();
      await openPicker(ctx);
      drill(ctx, 3);                                                            // Shop: one server, no skill
      assert.equal(pop(ctx).querySelector('.ask-pop-caption'), null);
      pop(ctx).querySelector('[data-ask-pane-back]').click();
      drill(ctx, 2);                                                            // Docs: one skipped skill, no server
      assert.deepEqual([...pop(ctx).querySelectorAll('.ask-pop-caption')].map((c) => c.textContent), ['Skills']);
      ctx.panel.destroy();
    } },
    { name: 'a blocked layer: the pane says so once under Skills and lists no skill switch', run: async () => {
      const text = skillLayerText('sideload-disabled');
      const { ctx } = setup({ preview: { ...PREVIEW, skills: { ...SKILLS, started: 0, layer: { blocked: 'sideload-disabled', text } } } });
      await openPicker(ctx);
      drill(ctx, 1);
      assert.deepEqual([...pop(ctx).querySelectorAll('.ask-pop-caption')].map((c) => c.textContent), ['Servers', 'Skills']);
      assert.deepEqual([...pop(ctx).querySelectorAll('.ask-pop-empty')].map((n) => n.textContent), [`skills from sets not loaded on this machine: ${text}`]);
      assert.equal(pop(ctx).querySelector('[data-mcp-key^="member:billing|skill:"]'), null);
      assert.equal(pop(ctx).querySelectorAll('.is-skipped').length, 0, 'no skipped skill row either');
      ctx.panel.destroy();
    } },
    { name: 'a never-consented Team skill reads like P4 and like the Team server beside it: off — turn it on in the team checklist', run: async () => {
      const team = { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', routes: [], members: 1, started: 0, skills: 1, startedSkills: 0 };
      const why = 'turn it on in the team checklist';
      const { ctx } = setup({ preview: { ...PREVIEW, sets: [...PREVIEW.sets, team],
        skipped: [{ setId: team.id, setName: team.name, serverId: 'policy:acme/platform/datadog', copy: 'datadog_team-platfor', reason: 'needs-consent', why }],
        skills: { ...SKILLS, skipped: [...SKILLS.skipped, { setId: team.id, setName: team.name, skillId: 'skill:plugin:acme/deploy-checklist', name: 'deploy-checklist',
          qualifiedName: 'team-platfor:deploy-checklist', reason: 'needs-consent', why, problem: false }] } } });
      await openPicker(ctx);
      drill(ctx, 4);
      assert.deepEqual([...pop(ctx).querySelectorAll('.is-skipped')].map((n) => [n.querySelector('.ask-model-name').textContent, n.querySelector('.ask-pop-row-value').textContent, n.classList.contains('is-problem')]),
        [['datadog_team-platfor', `off — ${why}`, false], ['team-platfor:deploy-checklist', `off — ${why}`, false]]);
      ctx.panel.destroy();
    } },
  ]);
});

test('a skill switch: saved per chat as <setId>|<skillId> in mcpOff (preview + PATCH), comes back on from chat-off, and is disabled while its set is off', async () => {
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, mcpOff: null },
    messages: [], attachments: [], runLinks: [], worktrees: [], inFlight: null };
  const { state, ctx } = setup({ snap });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  await openPicker(ctx);
  drill(ctx, 1);
  const sw = () => pop(ctx).querySelector('[data-mcp-key="member:billing|skill:library:pdf-tools"]');
  state.preview = { ...PREVIEW, skills: { ...SKILLS, mounted: SKILLS.mounted.filter((m) => m.name !== 'pdf-tools'),
    skipped: [...SKILLS.skipped, { setId: 'billing', setName: 'Billing', skillId: 'skill:library:pdf-tools', name: 'pdf-tools', qualifiedName: 'billing:pdf-tools', reason: 'chat-off', why: 'switched off for this chat', problem: false }] } };
  sw().click();
  await settle(ctx);
  assert.deepEqual(state.previews.at(-1).mcpOff, { sets: [], members: ['billing|skill:library:pdf-tools'] });
  assert.deepEqual(state.patches.at(-1), { mcpOff: { sets: [], members: ['billing|skill:library:pdf-tools'] } });
  assert.ok(sw(), 'a chat-off skill stays a live switch');
  assert.equal(sw().getAttribute('aria-checked'), 'false');
  assert.equal(sw().disabled, false);
  sw().click();
  await settle(ctx);
  assert.deepEqual(state.patches.at(-1), { mcpOff: { sets: [], members: [] } });
  pop(ctx).querySelector('[data-ask-pane-back]').click();
  pop(ctx).querySelectorAll('.ask-mcp-row')[1].children[0].click();              // Billing off
  await settle(ctx);
  drill(ctx, 1);
  assert.equal(sw().disabled, true);
  assert.equal(sw().getAttribute('aria-checked'), 'false');
  assert.equal(sw().title, 'Billing is off in this chat');
  ctx.panel.destroy();
});

test('transcript: the join notice links "Sets"; a Skill tool call reads skill · <qualified name> (args after it)', async () => {
  const notice = { kind: 'notice', text: "shop's skills (shop:notes) join from the next message", mcp: true };
  const blocks = [notice,
    { kind: 'tool', id: 't1', name: 'Skill', input: { skill: 'billing:deploy-checklist' }, status: 'done', durationMs: 200 },
    { kind: 'tool', id: 't2', name: 'Skill', input: { skill: 'general:graphify', args: 'the run graph' }, status: 'done', durationMs: 100 },
    { kind: 'tool', id: 't3', name: 'Skill', input: { skill: 'general:graphify', args: 'x'.repeat(70) }, status: 'done', durationMs: 1 }];
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'done', blocks, status: 'done', createdAt: 't' }],
    attachments: [], runLinks: [], worktrees: [], inFlight: null };
  const { ctx } = setup({ snap });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await settle(ctx); ctx.flush(); await settle(ctx);
  const link = ctx.doc.querySelector('.ask-notice .ask-notice-mcp');
  assert.equal(link.textContent, 'Sets');
  const rows = [...ctx.doc.querySelectorAll('.ask-tool-row')].map((r) => [r.querySelector('.ask-tool-op').textContent, r.querySelector('.ask-tool-target').textContent]);
  assert.deepEqual(rows, [['skill', 'billing:deploy-checklist'], ['skill', 'general:graphify · the run graph'], ['skill', `general:graphify · ${'x'.repeat(60)}…`]]);
  link.click();
  await settle(ctx);
  assert.ok(pop(ctx), 'the picker is open');
  ctx.panel.destroy();
});

test('the activity label names the skill; the level-1 small line has its own style rule (no comment in the body)', async () => {
  const { labelForTool } = await import('../src/core/ask/events.mjs');
  assert.equal(labelForTool('Skill', { skill: 'billing:deploy-checklist' }), 'Using billing:deploy-checklist');
  assert.equal(labelForTool('Skill', {}), 'Using a skill');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\n\.ask-pop-mcp \.ask-model-name small\{display:block;font-size:11\.5px;font-weight:400;color:var\(--ink-3\);\}\n/);
});
