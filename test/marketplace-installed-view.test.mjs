// test/marketplace-installed-view.test.mjs — the Installed tab's pure renderers (board 3.1, 4.2 third panel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  renderInstalledHeader, renderPolicyCard, renderAttention, renderAllInstalled, renderLeftover, renderNothingInstalled, renderInstalledTab,
} from '../ui/public/marketplace/installed-view.mjs';
import { attention } from '../ui/public/marketplace/installed-model.mjs';
import { kindTile, glyphTile, KINDS } from '../ui/public/marketplace/kinds.mjs';
import { channelBadge } from '../ui/public/plugins-view.mjs';
import { renderRemoveDialog, renderBlockedDialog, renderPurgeDialog } from '../ui/public/marketplace/remove-view.mjs';
import { BUTTON_SPEC, STRAY_SPEC } from '../tools/button-audit.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const ZERO = { taskSources: 0, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 };
const row = (name, extra = {}) => ({ name, version: '0.1.0', pinnedSha: 'a'.repeat(40), marketplace: 'worca-cc', marketplaceName: 'Worca CC Official',
  enabled: true, linked: false, broken: false, apiMismatch: null, pythonMissing: false, ignored: [], mcpSets: [], skillSets: [],
  contributions: { ...ZERO }, latest: null, setup: { ok: true, missing: [], noProfiles: [] }, notes: [], ...extra });
const L = (version, access = []) => ({ version, sha: 'b'.repeat(40), marketplace: 'worca-cc', access });
const SECRET = { kind: 'secret', id: 'github.webhookSecret', red: true };
const SLACK_SETUP = { ok: false, missing: [{ kind: 'chatChannel', id: 'slack', keys: ['botToken'] }], noProfiles: [] };
const MSG = 'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)';
// P1 row notes carry the relative manifest prefix (SM5); noteText strips it for display.
const NOTE = (i, id) => `plugins/discretestack-models/worca-cc-plugin.json: models[${i}] ("${id}"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored`;
const chips = (el) => [...el.querySelectorAll('.badge')].map((b) => [b.className, b.textContent]);

test('header: Refresh marketplaces (icon), then Update all · n (primary, arrow-up) only when there are updates', () => {
  const [refresh, all] = renderInstalledHeader(doc, { updates: 2 });
  assert.ok(refresh.matches('button.btn.btn-quiet.btn-icon.mk-refresh[aria-label="Refresh marketplaces"]'));
  assert.ok(refresh.querySelector('.ic'));
  assert.deepEqual([refresh.dataset.focusKey, all.dataset.focusKey], ['refresh', 'update-all']);
  assert.ok(all.matches('button.btn.btn-primary.mk-update-all'));
  assert.equal(all.textContent, 'Update all · 2');
  assert.ok(all.querySelector('.ic'), 'arrow-up icon');
  assert.equal(renderInstalledHeader(doc, { updates: 0 }).length, 1);
});

test('All installed: alphabetical calm rows — tile, name button, version, chips, meta (MCP link), switch, ⋯', () => {
  const el = renderAllInstalled(doc, [
    row('github-source', { version: '0.2.0', contributions: { ...ZERO, taskSources: 1 } }),
    row('atlassian-mcp', { contributions: { ...ZERO, mcpServers: 1 }, latest: L('0.1.1') }),
    row('discretestack-models', { version: '0.4.0', contributions: { ...ZERO, models: 2 }, marketplaceName: 'example/worca-marketplace',
      notes: [NOTE(0, 'discretestack-stable'), NOTE(1, 'discretestack-stable-fast')] }),
    row('jira-source', { version: null, pinnedSha: 'deadbeef99', enabled: false, broken: true, contributions: {} }),
    row('local-dev', { version: 'dev', pinnedSha: null, linked: true, marketplace: null, marketplaceName: null, contributions: { agents: ['a'], workflows: ['w'] } }),
  ]);
  assert.ok(el.matches('section.mk-all'));
  assert.equal(el.querySelector('.mk-sec-head h2.section-title').textContent, 'All installed');
  assert.equal(el.querySelector('.mk-sec-head .mk-count').textContent, '5');
  const rows = [...el.querySelectorAll('ul.mk-rows.card > li.mk-row')];
  assert.deepEqual(rows.map((r) => r.dataset.name), ['atlassian-mcp', 'discretestack-models', 'github-source', 'jira-source', 'local-dev']);
  const [a, d, , j, l] = rows;
  assert.ok(a.querySelector('.mk-mt.mk-mt-sm.mk-t-mcp'));
  assert.equal(a.querySelector('button.mk-name[data-name="atlassian-mcp"]').textContent, 'atlassian-mcp');
  assert.equal(a.querySelector('.mk-ver').textContent, '0.1.0');
  assert.equal(a.querySelector('.mk-ver').matches('.mk-mono, .mk-sha'), false, 'SM30: a version is UI sans (tabular numerals)');
  assert.deepEqual(chips(a), [], 'calm: updates live in Needs attention');
  assert.equal(a.querySelector('.mk-meta').textContent, '1 MCP server · Worca CC Official');
  assert.deepEqual([a.querySelector('.mk-meta a').textContent, a.querySelector('.mk-meta a').getAttribute('href')], ['1 MCP server', '#connectors/servers']);
  const sw = a.querySelector('label.mk-switch > input.sw-input.mk-enable[type="checkbox"][role="switch"]');
  assert.deepEqual([sw.dataset.name, sw.checked, sw.getAttribute('aria-label')], ['atlassian-mcp', true, 'Enable atlassian-mcp']);
  assert.ok(sw.nextElementSibling.classList.contains('switch'), '.switch is the input’s next sibling');
  const more = a.querySelector('button.btn.btn-sm.btn-quiet.btn-icon.mk-more');
  assert.deepEqual([more.dataset.name, more.getAttribute('aria-label'), more.getAttribute('aria-haspopup'), more.getAttribute('aria-expanded')],
    ['atlassian-mcp', 'More actions for atlassian-mcp', 'menu', 'false']);
  assert.deepEqual([a.querySelector('button.mk-name').dataset.focusKey, sw.dataset.focusKey, more.dataset.focusKey],
    ['name:atlassian-mcp', 'enable:atlassian-mcp', 'more:atlassian-mcp'], 'P3 refocuses the same key after a re-render');
  assert.equal(d.querySelector('.mk-meta').textContent, '2 models · example/worca-marketplace');
  assert.equal(d.querySelector('.mk-meta a'), null);
  const notes = d.querySelector('.badge.mk-chip-n.mk-notes-chip');
  assert.deepEqual([notes.textContent, notes.title], ['2 manifest notes',
    'models[0] ("discretestack-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored\nmodels[1] ("discretestack-stable-fast"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored']);
  assert.deepEqual([j.querySelector('.mk-ver').textContent, j.querySelector('.mk-ver').classList.contains('mk-sha'), j.querySelector('.mk-enable').checked],
    ['deadbee', true, false], 'sha7 stands in (a sha is mono through P3\u2019s .mk-ver.mk-sha, SM30); the switch says off');
  assert.equal(j.querySelector('.mk-meta').textContent, 'Worca CC Official');
  assert.ok(j.querySelector('.mk-mt.mk-t-none'));
  assert.equal(l.querySelector('.badge.mk-chip-n.mk-linked').textContent, 'linked');
  assert.ok(l.querySelector('.badge.mk-linked .ic'), 'link glyph');
  assert.equal(l.querySelector('.mk-meta').textContent, '1 agent · 1 workflow');
  assert.ok(l.querySelector('.mk-mt.mk-t-mix'), 'two kinds → Mix (U7)');
  assert.equal(el.querySelector('.btn-danger'), null, 'destructive actions live in the menu and its dialog');
  assert.equal(el.querySelector('[data-min-level]'), null, 'everyone (U5)');
});

test('a version that is the pinned sha7 (the server’s stand-in) reads as a sha (SM30)', () => {
  const el = renderAllInstalled(doc, [row('k', { version: 'deadbee', pinnedSha: 'deadbee' + '0'.repeat(33) }), row('v')]);
  const ver = (n) => el.querySelector(`li.mk-row[data-name="${n}"] .mk-ver`);
  assert.deepEqual([ver('k').textContent, ver('k').classList.contains('mk-sha')], ['deadbee', true], 'manifest.version ?? pin.slice(0, 7)');
  assert.deepEqual([ver('v').textContent, ver('v').classList.contains('mk-sha')], ['0.1.0', false], 'a real version stays UI sans');
});

test('edge rows: no `enabled` key is on; one manifest note; the ignored chip’s glyph; Browse 1 plugin; nameless leftovers; a linked plugin below the floor', () => {
  assert.equal(renderAllInstalled(doc, [{ name: 'bare' }]).querySelector('.mk-enable').checked, true, 'enabled !== false: older rows lack the key');
  assert.equal(renderAllInstalled(doc, [row('n', { notes: [NOTE(0, 'x')] })]).querySelector('.mk-notes-chip').textContent, '1 manifest note');
  const py = renderAttention(doc, attention([row('py', { ignored: [{ file: 'agents/x.md', reason: 'collides with a built-in agent' }] })]), { channelStatus: [] });
  assert.ok(py.querySelector('li[data-name="py"] .badge.mk-chip-bad .ic'), 'the ignored chip carries the alert glyph');
  assert.equal(renderNothingInstalled(doc, { total: 1 }).querySelector('a').textContent, 'Browse 1 plugin');
  assert.equal(renderLeftover(doc, [null, { dataDir: '/x' }], { catalog: [] }), null, 'a leftover without a name draws nothing');
  const card = renderPolicyCard(doc, [{ name: 'local-dev', state: 'outdated', minVersion: '1.0.0', marketplace: '', config: null }],
    { plugins: [row('local-dev', { version: 'dev', pinnedSha: null, linked: true })], catalog: [] });
  const li = card.querySelector('li.mk-policy-row[data-name="local-dev"]');
  assert.deepEqual([li.querySelector('.badge').textContent, li.querySelector('button')], ['Outdated', null], 'a linked plugin has no repo to update from');
});

test('Needs attention: Update / Review by access (L7), Needs setup with the live channel chip, problems with chips and lines', () => {
  const items = attention([
    row('slack-chat', { contributions: { ...ZERO, chatChannels: 1 }, setup: SLACK_SETUP }),
    row('github-source', { version: '0.2.0', contributions: { ...ZERO, taskSources: 1 }, latest: L('0.3.0', [SECRET]) }),
    row('atlassian-mcp', { contributions: { ...ZERO, mcpServers: 1 }, latest: L('0.1.1') }),
    row('old-plugin', { version: '0.2.0', broken: true, apiMismatch: { builtFor: 2, host: 3, message: MSG } }),
    row('py', { pythonMissing: true, ignored: [{ file: 'agents/x.md', reason: 'collides with a built-in agent' }, { file: 'workflows/y.json', reason: 'v1 steps template' }] }),
  ]);
  const el = renderAttention(doc, items, { channelStatus: [
    { plugin: 'slack-chat', channelId: 'slack', displayName: 'Slack', platform: 'slack', state: 'unconfigured', detail: 'missing config: botToken', missingConfig: ['botToken'] },
    { plugin: 'other', channelId: 'tg', displayName: 'Telegram', state: 'connected' },
  ] });
  assert.ok(el.matches('section.mk-attention[aria-labelledby="mk-h-attn"]'));
  assert.equal(el.querySelector('h2#mk-h-attn').textContent, 'Needs attention');
  assert.deepEqual([el.querySelector('h2.section-title').textContent, el.querySelector('.mk-count').textContent], ['Needs attention', '5']);
  const li = (n) => el.querySelector(`ul.mk-rows.card > li.mk-row[data-name="${n}"]`);
  assert.deepEqual([...el.querySelectorAll('li.mk-row')].map((r) => [r.dataset.name, r.dataset.reason]),
    [['atlassian-mcp', 'update'], ['github-source', 'update'], ['slack-chat', 'setup'], ['old-plugin', 'problem'], ['py', 'problem']]);
  const act = (r) => { const b = r.querySelector('button[data-act]'); return [b.className, b.dataset.act, b.dataset.name, b.textContent]; };
  assert.deepEqual([li('atlassian-mcp').querySelector('.mk-pname').textContent, li('atlassian-mcp').querySelector('.mk-ver').textContent], ['atlassian-mcp', '0.1.0 → 0.1.1']);
  assert.deepEqual(chips(li('atlassian-mcp')), [['badge mk-chip mk-chip-upd', 'Update 0.1.1']]);
  assert.ok(li('atlassian-mcp').querySelector('.badge.mk-chip-upd .ic'), 'arrow-up glyph');
  assert.deepEqual(act(li('atlassian-mcp')), ['btn btn-sm', 'update', 'atlassian-mcp', 'Update']);
  assert.equal(li('atlassian-mcp').querySelector('button[data-act]').dataset.focusKey, 'update:atlassian-mcp');
  assert.equal(li('github-source').querySelector('.mk-ver').textContent, '0.2.0 → 0.3.0');
  assert.deepEqual(act(li('github-source')), ['btn btn-sm', 'review', 'github-source', 'Review']);
  assert.equal(li('slack-chat').querySelector('.mk-ver').textContent, '0.1.0');
  assert.deepEqual(chips(li('slack-chat')), [['badge mk-chip mk-chip-warn', 'Needs setup'], ['badge mk-chip mk-chip-off pl-channel', 'Slack · unconfigured']]);
  assert.equal(li('slack-chat').querySelector('.pl-channel').dataset.channelKey, 'slack-chat/slack');
  assert.deepEqual(act(li('slack-chat')), ['btn btn-sm', 'setup', 'slack-chat', 'Set up']);
  assert.deepEqual(chips(li('old-plugin')), [['badge mk-chip mk-chip-warn', 'Needs update']], 'needs update WINS: never also Broken');
  assert.deepEqual([...li('old-plugin').querySelectorAll('ul.mk-lines > li')].map((n) => n.textContent), [MSG]);
  assert.deepEqual(act(li('old-plugin')), ['btn btn-sm', 'health', 'old-plugin', 'Check health']);
  assert.deepEqual(chips(li('py')), [['badge mk-chip mk-chip-warn', 'Python not found'], ['badge mk-chip mk-chip-bad', '2 ignored']]);
  assert.deepEqual([...li('py').querySelectorAll('ul.mk-lines > li')].map((n) => n.textContent),
    ['agents/x.md: collides with a built-in agent', 'workflows/y.json: v1 steps template']);
  assert.equal(renderAttention(doc, [], { channelStatus: [] }), null);
});

test('channelBadge: one chip per channel — tone by state, a dot, "<name> · <state>", the WS patch key, the detail as title', () => {
  const tones = { connected: 'ok', connecting: 'off', degraded: 'warn', unconfigured: 'off', disconnected: 'off', failed: 'bad' };
  for (const [state, tone] of Object.entries(tones)) {
    const b = channelBadge(doc, { plugin: 'slack-chat', channelId: 'slack', displayName: 'Slack', state, detail: null });
    assert.deepEqual([b.className, b.dataset.channelKey, b.textContent], [`badge mk-chip mk-chip-${tone} pl-channel`, 'slack-chat/slack', `Slack · ${state}`]);
    assert.ok(b.firstElementChild.matches('span.mk-live-dot[aria-hidden="true"]'));
  }
  assert.equal(channelBadge(doc, { plugin: 'p', channelId: 'tg', state: 'failed', detail: 'auth failed' }).title, 'auth failed');
  assert.equal(channelBadge(doc, { plugin: 'p', channelId: 'tg', state: 'connected' }).textContent, 'tg · connected', 'no display name → the channel id');
});

test('Team policy card: summary, Set up…, one row per item with its chip and button; no card when nothing is open', () => {
  const items = [
    { name: 'azure-boards-source', state: 'missing', minVersion: '0.1.0', marketplace: 'worca-cc', config: null },
    { name: 'jira', state: 'outdated', minVersion: '2.0.0', marketplace: '', config: null },
    { name: 'teams-chat', state: 'disabled', minVersion: null, marketplace: '', config: null },
    { name: 'slack-chat', state: 'needs-setup', minVersion: null, marketplace: '', config: null },
    { name: 'legacy', state: 'blocked', minVersion: null, marketplace: '', config: null },
  ];
  const el = renderPolicyCard(doc, items, { plugins: [row('slack-chat', { contributions: { ...ZERO, chatChannels: 1 } })],
    catalog: [{ name: 'azure-boards-source', iconKind: 'taskSources' }] });
  assert.ok(el.matches('section.card.mk-policy[aria-label="Team policy"]'));
  const head = el.querySelector('.mk-policy-head');
  assert.ok(head.querySelector('.mk-mt.mk-mt-sm.mk-t-none'), 'neutral shield tile');
  assert.equal(head.querySelector('.mk-policy-title').textContent, 'Team policy');
  assert.equal(head.querySelector('.mk-meta').textContent, '1 missing · 1 outdated · 1 disabled · 1 needs setup · 1 blocked');
  assert.ok(head.querySelector('button.btn.btn-sm.btn-quiet.mk-policy-setup'));
  assert.deepEqual([head.querySelector('.mk-policy-setup').textContent, head.querySelector('.mk-policy-setup').dataset.focusKey], ['Set up…', 'policy-checklist']);
  const rows = [...el.querySelectorAll('ul.mk-rows > li.mk-row.mk-policy-row')];
  assert.deepEqual(rows.map((r) => [r.dataset.name, r.dataset.state, r.querySelector('.mk-ver')?.textContent ?? null, ...chips(r)[0],
    r.querySelector('button')?.dataset.act ?? null, r.querySelector('button')?.textContent ?? null]), [
    ['azure-boards-source', 'missing', '≥ 0.1.0', 'badge mk-chip mk-chip-warn', 'Not installed', 'policy-install', 'Install'],
    ['jira', 'outdated', '≥ 2.0.0', 'badge mk-chip mk-chip-warn', 'Outdated', 'policy-update', 'Update'],
    ['teams-chat', 'disabled', null, 'badge mk-chip mk-chip-off', 'Disabled', 'policy-on', 'Turn on'],
    ['slack-chat', 'needs-setup', null, 'badge mk-chip mk-chip-warn', 'Needs setup', 'policy-setup', 'Set up'],
    ['legacy', 'blocked', null, 'badge mk-chip mk-chip-bad', 'Blocked', null, null],
  ]);
  assert.ok(rows[0].querySelector('.mk-mt.mk-t-src'), 'a snapshot decides a missing plugin’s tile');
  assert.ok(rows[3].querySelector('.mk-mt.mk-t-chat'), 'the installed row decides an installed one’s');
  assert.ok(rows[4].querySelector('.mk-mt.mk-t-none'));
  assert.equal(renderPolicyCard(doc, [], { plugins: [], catalog: [] }), null);
});

test('Leftover data: a neutral tile with the old glyph, the name, "Removed · settings and secrets remain", Purge', () => {
  const el = renderLeftover(doc, [{ name: 'telegram-chat', dataDir: '/h/.worca-cc/plugins/telegram-chat/data' }], { catalog: [{ name: 'telegram-chat', iconKind: 'chatChannels' }] });
  assert.ok(el.matches('section.mk-leftover[aria-labelledby="mk-h-left"]'));
  assert.equal(el.querySelector('h3.subsection-title').textContent, 'Leftover data');
  const li = el.querySelector('ul.mk-rows.card > li.mk-row.mk-orphan[data-name="telegram-chat"]');
  const tile = li.querySelector('.mk-mt.mk-mt-sm');
  assert.ok(tile.classList.contains('mk-t-none') && !tile.classList.contains('mk-t-chat'), 'neutral tone');
  assert.equal(tile.innerHTML, glyphTile(doc, KINDS.chatChannels.glyph, 'none', { size: 'sm' }).innerHTML, 'the chat glyph');
  assert.equal(li.querySelector('.mk-pname').textContent, 'telegram-chat');
  assert.equal(li.querySelector('.mk-meta').textContent, 'Removed · settings and secrets remain');
  const b = li.querySelector('button.btn.btn-sm.btn-quiet.mk-purge[data-act="purge"][data-name="telegram-chat"]');
  assert.deepEqual([b.textContent, b.dataset.focusKey], ['Purge', 'purge:telegram-chat']);
  assert.equal(el.textContent.includes('/h/.worca-cc'), false, 'no path on screen');
  assert.equal(renderLeftover(doc, [], { catalog: [] }), null);
  assert.equal(renderLeftover(doc, undefined, { catalog: [] }), null);
});

test('Nothing installed yet: tile, title, Browse {n} plugins → Browse; no button when there is nothing to browse', () => {
  const el = renderNothingInstalled(doc, { total: 14 });
  assert.ok(el.matches('div.mk-empty'));
  assert.ok(el.querySelector('.mk-mt.mk-mt-lg.mk-t-n'), 'the neutral bordered empty-state tile (P3 glyphTile tone n)');
  assert.equal(el.querySelector('h3.mk-empty-title').textContent, 'Nothing installed yet');
  const a = el.querySelector('a.btn.btn-primary.mk-browse-all');
  assert.deepEqual([a.textContent, a.getAttribute('href')], ['Browse 14 plugins', '#marketplace/browse']);
  assert.equal(renderNothingInstalled(doc, { total: 0 }).querySelector('a'), null);
});

test('renderInstalledTab: policy card, Needs attention, All installed, Leftover data in that order; the empty state keeps the card and the leftovers', () => {
  const state = {
    plugins: [row('atlassian-mcp', { contributions: { ...ZERO, mcpServers: 1 }, latest: L('0.1.1') })],
    orphans: [{ name: 'telegram-chat', dataDir: '/x' }],
    policy: { requirements: [{ name: 'azure-boards-source', marketplace: 'worca-cc', minVersion: '0.1.0', state: 'missing', homes: ['h'] }], blockedPlugins: [] },
    catalog: Array.from({ length: 14 }, (_, i) => ({ name: `p${i}`, iconKind: 'none' })), channelStatus: [],
  };
  const el = renderInstalledTab(doc, state);
  assert.ok(el.matches('div.mk-installed'));
  assert.deepEqual([...el.children].map((c) => c.className), ['card mk-policy', 'mk-attention', 'mk-all', 'mk-leftover']);
  const empty = renderInstalledTab(doc, { ...state, plugins: [] });
  assert.deepEqual([...empty.children].map((c) => c.className), ['card mk-policy', 'mk-empty', 'mk-leftover']);
  assert.equal(empty.querySelector('.mk-empty a').textContent, 'Browse 14 plugins');
  assert.deepEqual([...renderInstalledTab(doc, { plugins: [row('a')] }).children].map((c) => c.className), ['mk-all'], 'missing state keys default');
});

const foot = (parts) => parts.foot.map((b) => [b.className, b.dataset.dlg, b.textContent, b.disabled]);

test('Remove dialog (board 3.4): tile + "Remove {plugin}?" + Close; Goes away; Changes; the purge box + Cannot be undone.; Cancel / Remove', () => {
  const parts = renderRemoveDialog(doc, { name: 'atlassian-mcp', iconKind: 'mcpServers',
    goesAway: [{ kind: 'mcpServers', text: 'MCP server', id: 'atlassian' }, { kind: 'models', text: '2 models', id: null }],
    changes: [{ set: 'Havn', text: 'loses the atlassian server with its values and secrets' }] });
  const [tile, title, close] = parts.head;
  assert.ok(tile.matches('.mk-mt.mk-mt-md.mk-t-mcp'));
  assert.deepEqual([title.tagName, title.id, title.className, title.textContent], ['H2', 'mk-dialog-title', 'section-title', 'Remove atlassian-mcp?']);
  assert.ok(close.matches('button.btn.btn-quiet.btn-icon.mk-dlg-close[data-dlg="close"][aria-label="Close"]'));
  assert.deepEqual([...parts.body.querySelectorAll('section.mk-sec > h3.subsection-title')].map((x) => x.textContent), ['Goes away', 'Changes']);
  const goes = [...parts.body.querySelectorAll('ul.mk-goes > li')];
  assert.deepEqual(goes.map((li) => [li.querySelector('.mk-goes-k').textContent, li.querySelector('.mk-id.mk-mono')?.textContent ?? null]),
    [['MCP server', 'atlassian'], ['2 models', null]]);
  assert.deepEqual([goes[0].querySelector('.mk-mt.mk-mt-sm.mk-t-mcp') !== null, goes[1].querySelector('.mk-mt.mk-mt-sm.mk-t-model') !== null], [true, true]);
  assert.deepEqual([...parts.body.querySelectorAll('ul.mk-changes > li')].map((li) => [li.querySelector('.badge.mk-chip-n').textContent, li.querySelector('.mk-meta').textContent]),
    [['Havn', 'loses the atlassian server with its values and secrets']]);
  const box = parts.body.querySelector('.mk-purge-opt > label.mk-check > input[type="checkbox"].mk-purge-box');
  assert.equal(box.checked, false);
  assert.equal(box.parentElement.textContent, 'Also delete its config, secrets and state');
  assert.equal(parts.body.querySelector('.mk-purge-opt > p.mk-meta.mk-consequence').textContent, 'Cannot be undone.');
  assert.equal(parts.body.querySelector('p.hint.err.mk-dlg-err[role="alert"]').hidden, true);
  assert.deepEqual(foot(parts), [['btn btn-quiet', 'cancel', 'Cancel', false], ['btn btn-danger mk-confirm', 'remove', 'Remove', false]]);
  assert.deepEqual([...renderRemoveDialog(doc, { name: 'x', iconKind: 'none', goesAway: [], changes: [] }).body.querySelectorAll('h3')].map((x) => x.textContent), [], 'no empty sections');
});

test('Blocked dialog: "{plugin} is still in use", Used by rows (P4 list rows) with Open links, the note, Remove disabled', () => {
  const parts = renderBlockedDialog(doc, { name: 'discretestack-models', iconKind: 'models', note: 'Clear those selections first.', rows: [
    { kind: 'models', title: 'discretestack-stable', meta: 'Model · 2 pipeline selections', href: '#models' },
    { kind: 'models', title: 'discretestack-stable-fast', meta: 'Model · 1 pipeline selection', href: '#models' },
    { kind: 'agents', title: 'triager', meta: 'Agent · in Docs Flow', href: null },
  ] });
  assert.ok(parts.head[0].matches('.mk-mt.mk-mt-md.mk-t-model'));
  assert.equal(parts.head[1].textContent, 'discretestack-models is still in use');
  assert.equal(parts.body.querySelector('section.mk-sec > h3.subsection-title').textContent, 'Used by');
  const rows = [...parts.body.querySelectorAll('ul.mk-list.mk-used > li.mk-list-row')];
  assert.deepEqual(rows.map((li) => [li.querySelector('.mk-row-main > .mk-row-title.mk-mono').textContent, li.querySelector('.mk-row-main > .mk-meta').textContent,
    li.querySelector('a.mk-link.mk-open[data-dlg="open"]')?.getAttribute('href') ?? null, li.querySelector('a.mk-open')?.textContent ?? null]), [
    ['discretestack-stable', 'Model · 2 pipeline selections', '#models', 'Open'],
    ['discretestack-stable-fast', 'Model · 1 pipeline selection', '#models', 'Open'],
    ['triager', 'Agent · in Docs Flow', null, null],
  ]);
  assert.deepEqual(rows.map((li) => [...li.querySelector('.mk-mt.mk-mt-sm').classList].find((c) => c.startsWith('mk-t-'))), ['mk-t-model', 'mk-t-model', 'mk-t-agent']);
  assert.equal(parts.body.querySelector('p.mk-meta.mk-used-note').textContent, 'Clear those selections first.');
  assert.deepEqual(foot(parts), [['btn btn-quiet', 'cancel', 'Cancel', false], ['btn btn-danger mk-confirm', 'remove', 'Remove', true]]);
});

test('Purge dialog (L11): neutral tile, "Purge {plugin}?", what goes + Cannot be undone., Cancel / Purge', () => {
  const parts = renderPurgeDialog(doc, { name: 'telegram-chat', iconKind: 'chatChannels' });
  assert.ok(parts.head[0].matches('.mk-mt.mk-mt-md.mk-t-none'));
  assert.equal(parts.head[0].innerHTML, glyphTile(doc, KINDS.chatChannels.glyph, 'none', { size: 'md' }).innerHTML, 'the removed plugin’s glyph');
  assert.equal(parts.head[1].textContent, 'Purge telegram-chat?');
  assert.deepEqual([...parts.body.querySelectorAll('p')].map((p) => [p.className, p.textContent]),
    [['', 'Deletes its config, secrets and state.'], ['mk-meta mk-consequence', 'Cannot be undone.'], ['hint err mk-dlg-err', '']]);
  assert.deepEqual(foot(parts), [['btn btn-quiet', 'cancel', 'Cancel', false], ['btn btn-danger mk-confirm', 'purge', 'Purge', false]]);
});

test('style.css P5 block: tokens only; one divider between rows; the name button; the dot; P4’s shared classes not restated', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* ── marketplace P5 ── */');
  assert.ok(at > 0, 'the P5 block marker');
  const next = css.indexOf('/* ── marketplace', at + 8);   // SM69: to the next marketplace marker or EOF
  const block = css.slice(at, next > 0 ? next : undefined);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|box-shadow/, 'colour tokens only, no shadow');
  for (const rule of ['.mk-rows > .mk-row + .mk-row{border-top:1px solid var(--line);}', '.mk-rows.card{padding:0;}',
    '.pl-channel .mk-live-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}',
    '.mk-row > .mk-row-main{display:flex;flex-direction:column;gap:2px;}']) assert.ok(block.includes(rule), rule);
  assert.match(block, /button\.mk-name\{[^}]*font-weight:600;/);
  assert.doesNotMatch(block, /(?:^|\n)\.(?:mk-meta|mk-mono|mk-ver|mk-row-main|mk-row-title|mk-list|mk-list-row|mk-sec|mk-link|mk-more|mk-req|mk-disc|mk-notes|mk-chip|mk-empty|mk-count)[{,]/,
    'SM22/SM23/SM26/SM57: P3’s and P4’s classes are reused, not restated');
  assert.ok(BUTTON_SPEC.controls.includes('button.mk-name') && STRAY_SPEC.allow.includes('button.mk-name'), 'the name opens a sheet: a control, not a §1.2 button');
});
