// test/marketplace-kinds.test.mjs — kinds, the plugin icon rule (U7) and the kind / status tones (marketplace P3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { KIND_ORDER, KINDS, MIX, NONE, MKT, TILE_PX, CHIP_TONES, kindCounts, pluginIconKind, kindTile, glyphTile, chip, addsSummary, secretsSummary, landing }
  from '../ui/public/marketplace/kinds.mjs';
import { ICONS } from '../ui/public/icons.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const CSS = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');

test('the eight kinds in order, with labels, tones and glyphs; Mix and None', () => {
  assert.deepEqual(KIND_ORDER, ['taskSources', 'chatChannels', 'mcpServers', 'models', 'agents', 'scripts', 'skills', 'workflows']);
  assert.deepEqual(KIND_ORDER.map((k) => [KINDS[k].one, KINDS[k].many, KINDS[k].tone, KINDS[k].glyph]), [
    ['Task source', 'Task sources', 'src', 'tray'], ['Chat channel', 'Chat channels', 'chat', 'chat'],
    ['MCP server', 'MCP servers', 'mcp', 'plug'], ['Model', 'Models', 'model', 'cube'], ['Agent', 'Agents', 'agent', 'agent'],
    ['Script', 'Scripts', 'script', 'script'], ['Skill', 'Skills', 'skill', 'skill'], ['Workflow', 'Workflows', 'wf', 'workflow']]);
  assert.deepEqual([MIX.many, MIX.tone, MIX.glyph, NONE.many, NONE.tone, NONE.glyph], ['Mixed', 'mix', 'layers', 'Other', 'none', 'none']);
  assert.ok(Object.isFrozen(KIND_ORDER));
  assert.deepEqual([MKT, TILE_PX], [{ tone: 'mkt', glyph: 'bag' }, { sm: 30, md: 40, lg: 56 }]);
});

test('kindCounts: row counts minus ignored agent/script/workflow files, snapshot arrays, a missing kind is 0', () => {
  const row = { contributions: { taskSources: 0, chatChannels: 0, models: 0, mcpServers: 1, agents: 3, scripts: 1, skills: 0, workflows: 2 },
    ignored: [{ file: 'agents/a.meta.json', reason: 'x' }, { file: 'agents/b.meta.json', reason: 'x' }, { file: 'scripts/s.meta.json', reason: 'x' },
      { file: 'workflows/w.json', reason: 'x' }, { file: 'worca-cc-plugin.json', reason: 'y' }] };
  assert.deepEqual(kindCounts(row), { taskSources: 0, chatChannels: 0, mcpServers: 1, models: 0, agents: 1, scripts: 0, skills: 0, workflows: 1 });
  assert.equal(kindCounts({ contributions: { agents: 0 }, ignored: [{ file: 'agents/x.meta.json', reason: 'x' }] }).agents, 0, 'floor 0');
  assert.deepEqual(kindCounts({ inventory: { taskSources: [{ id: 'g' }], models: [{}, {}] } }),   // an old snapshot: no scripts, no mcpServers
    { taskSources: 1, chatChannels: 0, mcpServers: 0, models: 2, agents: 0, scripts: 0, skills: 0, workflows: 0 });
  assert.deepEqual(Object.values(kindCounts(null)), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('pluginIconKind: one kind → that kind, two or more → mix, nothing → none (U7)', () => {
  assert.equal(pluginIconKind({ taskSources: 1 }), 'taskSources');
  assert.equal(pluginIconKind({ agents: 2, skills: 1, workflows: 1 }), 'mix');
  assert.equal(pluginIconKind({ agents: 0 }), 'none');
});

test('kindTile / glyphTile: size and tone classes, the icons.mjs glyph at 16 / 20 / 28px, aria-hidden', () => {
  const t = kindTile(doc, 'taskSources');
  assert.deepEqual([t.tagName, t.className, t.getAttribute('aria-hidden'), t.querySelector('svg').getAttribute('width')], ['SPAN', 'mk-mt mk-mt-md mk-t-src', 'true', '20']);
  assert.ok(t.innerHTML.includes(ICONS.tray));
  const mix = kindTile(doc, 'mix', { size: 'sm' });
  assert.deepEqual([mix.className, mix.querySelector('svg').getAttribute('width')], ['mk-mt mk-mt-sm mk-t-mix', '16']);
  const none = kindTile(doc, 'none', { size: 'lg' });
  assert.deepEqual([none.className, none.querySelector('svg').getAttribute('width'), none.innerHTML.includes(ICONS.none)], ['mk-mt mk-mt-lg mk-t-none', '28', true]);
  assert.ok(kindTile(doc, 'scripts').innerHTML.includes(ICONS.script), 'L20: worca\'s own script glyph');
  const mkt = kindTile(doc, 'mkt', { size: 'lg' });
  assert.deepEqual([mkt.className, mkt.innerHTML.includes(ICONS.bag)], ['mk-mt mk-mt-lg mk-t-mkt', true], 'SM18');
  const n = glyphTile(doc, 'search', 'n', { size: 'lg' });
  assert.deepEqual([n.className, n.innerHTML.includes(ICONS.search)], ['mk-mt mk-mt-lg mk-t-n', true]);
});

test('chip (SM19): the one .badge with a tone class and an optional 12px icons.mjs glyph first', () => {
  assert.deepEqual(CHIP_TONES, ['n', 'ok', 'upd', 'warn', 'bad', 'off', 'built']);
  const plain = chip(doc, 'n', 'Task source');
  assert.equal(plain.outerHTML, '<span class="badge mk-chip mk-chip-n">Task source</span>');
  const upd = chip(doc, 'upd', 'Update 0.3.0', { icon: 'arrow-up' });
  assert.deepEqual([upd.className, upd.textContent, upd.firstChild.className, upd.firstChild.getAttribute('aria-hidden'), upd.querySelector('svg').getAttribute('width')],
    ['badge mk-chip mk-chip-upd', 'Update 0.3.0', 'ic', 'true', '12']);
});

test('addsSummary: one task source or chat channel reads as the kind; the rest is counted; mixed joins with " · "', () => {
  for (const [c, want] of [[{ taskSources: 1 }, 'Task source'], [{ taskSources: 2 }, '2 task sources'], [{ chatChannels: 1 }, 'Chat channel'],
    [{ mcpServers: 1 }, '1 MCP server'], [{ mcpServers: 2 }, '2 MCP servers'], [{ models: 5 }, '5 models'], [{ models: 1 }, '1 model'],
    [{ agents: 2, skills: 1, workflows: 1 }, '2 agents · 1 skill · 1 workflow'], [{ taskSources: 1, agents: 1 }, '1 task source · 1 agent'], [{}, '']]) {
    assert.equal(addsSummary(c), want, JSON.stringify(c));
  }
});

test('secretsSummary: one key in words (acronyms kept), several tokens or secrets counted, none → null', () => {
  for (const [keys, want] of [[[], null], [['token'], 'Token'], [['pat'], 'PAT'], [['botToken'], 'Bot token'], [['apiKey'], 'API key'],
    [['botToken', 'appToken'], '2 tokens'], [['appPassword', 'ingressToken'], '2 secrets'], [['token', 'token'], 'Token'],
    [['tokenUrl', 'botToken'], '2 secrets'], [['clientId'], 'Client ID'], [['webhookUrl'], 'Webhook URL'], [['ssh_key'], 'SSH key'],
    [['constructor'], 'Constructor'], [['apiConstructor'], 'API constructor'], [['toString'], 'To string'], [['__proto__'], 'Proto']]) {
    assert.equal(secretsSummary(keys), want, keys.join());
  }
});

test('landing: where each kind shows up in worca', () => {
  assert.deepEqual(KIND_ORDER.map(landing), [
    { label: 'Pick it in New run', href: '#new' }, { label: 'Chat notifications', href: '#settings/runs' },
    { label: 'Open in Connectors', href: '#connectors/servers' }, { label: 'Open in Models', href: '#models' },
    { label: 'Open in Workflows', href: '#workflows/agents' }, { label: 'Open in Workflows', href: '#workflows/scripts' },
    { label: 'Open in Connectors', href: '#connectors/skills' }, { label: 'Open in Workflows', href: '#workflows' }]);
});

test('style.css: tile sizes, kind tones on the hue families, status chips on the strong shades (L19)', () => {
  for (const re of [/\.mk-mt\{[^}]*width:40px;height:40px;border-radius:var\(--r-md\);/, /\.mk-mt-sm\{width:30px;height:30px;border-radius:var\(--r-sm\);\}/,
    /\.mk-mt-lg\{width:56px;height:56px;\}/, /\.mk-t-chat\{background:var\(--violet-bg\);color:var\(--violet-ink-strong\);\}/,
    /\.mk-t-mix\{background:var\(--pink-bg\);color:var\(--pink-ink-strong\);\}/, /\.mk-dot-src\{background:var\(--blue\);\}/,
    /\.badge\.mk-chip-upd\{background:var\(--blue-bg\);color:var\(--blue-ink-strong\);\}/,
    /\.badge\.mk-chip-warn\{background:var\(--amber-bg\);color:var\(--amber-ink-strong\);\}/,
    /\.badge\.mk-chip-built\{background:var\(--slate-bg\);color:var\(--slate-ink-strong\);\}/,
    /--violet-ink-strong:light-dark\(#5B4BB0,#B3A8EE\);/, /\/\* ── marketplace P3 ── \*\//]) assert.match(CSS, re);
});
