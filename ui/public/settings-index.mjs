// ui/public/settings-index.mjs — what the top bar search can find in Settings and among the settings inside the
// Add-ons pages (Marketplace, Connectors, Models, Providers).
// Hand-written (the product team owns the alternative words); test/ui-settings-index.test.mjs pins every
// tab / card id, its mode and its Labs gate to ui/public/index.html, so a moved or re-gated card fails there.
import { flagByKey } from '../../src/shared/flags/registry.mjs';
import { levelRank, LEVEL_INFO } from './ui-level.mjs';

const tab = (id, title, o = {}) => ({ id, title, min: 'simple', flag: '', alts: [], ...o });
const card = (tabId, id, title, o = {}) => ({ tab: tabId, id, title, min: 'simple', flag: '', alts: [], ...o });

export const TABS = Object.freeze([
  tab('general', 'General', { alts: ['preferences', 'options', 'configuration', 'config'] }),
  tab('tags', 'Labels & cost tags', { alts: ['labels', 'tags', 'cost centres', 'tagging'] }),
  tab('presets', 'Presets', { min: 'advanced', alts: ['run presets', 'templates', 'saved setups'] }),
  tab('runs', 'Runs', { alts: ['pipeline', 'run options'] }),
  tab('automations', 'Automations', { min: 'advanced', flag: 'gitAutomations', alts: ['git events', 'auto-handle', 'triggers', 'issues', 'webhook'] }),
  tab('experimental', 'Labs', { alts: ['experimental', 'beta', 'feature flags', 'flags', 'early access', 'features'] }),
  tab('ask', 'Chat', { min: 'advanced', alts: ['ask', 'assistant', 'conversation'] }),
  tab('guardrails', 'Guardrails', { min: 'advanced', alts: ['guardrail', 'permissions', 'safety', 'rules', 'allow', 'deny', 'sets'] }),
  tab('memory', 'Memory', { min: 'advanced', alts: ['remember', 'notes', 'defragment', 'context'] }),
]);

export const CARDS = Object.freeze([
  card('general', 'setup-assistant-card', 'Setup assistant', { alts: ['setup', 'install', 'onboarding', 'wizard', 'configure'] }),
  card('general', 'appearance-card', 'Appearance', { alts: ['theme', 'dark mode', 'light mode', 'dark theme', 'colour', 'color', 'look', 'night mode', 'display'] }),
  card('general', 'alerts-card', 'Alerts', { alts: ['notifications', 'sound', 'desktop notifications', 'notify'] }),
  card('general', 'extension-settings-card', 'Browser extension', { alts: ['chrome', 'browser', 'pinpoint'] }),
  card('general', 'mode-settings-card', 'Interface mode', { alts: ['mode', 'simple', 'advanced', 'expert', 'level', 'complexity'] }),
  card('general', 'root-settings-card', 'Worca root folder', { min: 'advanced', alts: ['data folder', 'storage', 'directory', 'history store', 'path'] }),
  card('general', 'debug-spawn-settings-card', 'Spawn diagnostics', { min: 'expert', alts: ['debug', 'diagnostics', 'process', 'logging'] }),
  card('general', 'getting-started-card', 'Getting started', { alts: ['tour', 'onboarding', 'guide', 'tutorial', 'welcome'] }),
  card('general', 'about-card', 'About', { alts: ['version', 'update', 'licence', 'license'] }),
  card('tags', 'tag-dims-settings-card', 'Cost tags', { alts: ['cost dimensions', 'tags', 'tagging'] }),
  card('tags', 'labels-settings-card', 'Labels', { flag: 'runLabels', alts: ['label', 'tags', 'categories'] }),
  card('runs', 'budget-settings-card', 'Budget & cost limits', { alts: ['budget', 'cost', 'spend', 'money', 'limit', 'cap', 'price'] }),
  card('runs', 'night-settings-card', 'Away mode', { min: 'advanced', alts: ['night', 'overnight', 'unattended', 'away', 'autopilot'] }),
  card('runs', 'smart-naming-settings-card', 'Smart run naming', { alts: ['title', 'branch name', 'naming', 'rename'] }),
  card('runs', 'sync-settings-card', 'Sync before run', { min: 'advanced', alts: ['git', 'pull', 'fetch', 'up to date', 'rebase'] }),
  card('runs', 'schedule-settings-card', 'Scheduled runs', { min: 'advanced', alts: ['schedule', 'cron', 'timer', 'recurring', 'repeat'] }),
  card('runs', 'network-proxy-settings-card', 'Network proxy', { alts: ['proxy', 'corporate proxy', 'ntlm', 'firewall', 'network'] }),
  card('runs', 'network-wait-settings-card', 'Wait for the network', { min: 'advanced', alts: ['offline', 'internet', 'connection', 'retry', 'wifi'] }),
  card('runs', 'run-limits-settings-card', 'Machine load', { min: 'advanced', alts: ['queue', 'concurrent', 'parallel', 'cpu', 'workers', 'retention', 'prune', 'disk', 'cleanup'] }),
  card('runs', 'actions-settings-card', 'Actions', { min: 'advanced', alts: ['ci', 'checks', 'github actions'] }),
  card('runs', 'pr-settings-card', 'Pull requests', { alts: ['pr', 'merge', 'github', 'review', 'draft'] }),
  card('runs', 'ws-scan-models-card', 'Workspaces', { min: 'advanced', alts: ['scan', 'workspace', 'monorepo'] }),
  card('runs', 'chat-settings-card', 'Chat notifications', { min: 'advanced', alts: ['chat alerts', 'replies', 'notify'] }),
  card('ask', 'ask-engine-card', 'Engine & models', { alts: ['engine', 'model', 'claude', 'codex', 'llm'] }),
  card('ask', 'ask-settings-card', 'Limits & access', { alts: ['limits', 'access', 'tools', 'spend', 'read only'] }),
]);

/** Settings cards the search leaves out on purpose: shown only with a credential broker. */
export const UNLISTED_CARDS = Object.freeze(['credentials-card']);

const TAB_BY_ID = new Map(TABS.map((t) => [t.id, t]));
const uniq = (a) => [...new Set(a.filter(Boolean))];

/** Settings rows' source: tabs first, then cards, each with its effective mode and Labs gates. */
export const SETTING_ENTRIES = Object.freeze([
  ...TABS.map((t) => ({
    id: `tab:${t.id}`, type: 'tab', title: t.title, tabTitle: '', alts: t.alts, min: t.min, flags: uniq([t.flag]),
    href: t.id === 'general' ? '#settings' : `#settings/${t.id}`,
  })),
  ...CARDS.map((c) => {
    const t = TAB_BY_ID.get(c.tab);
    return {
      id: `card:${c.id}`, type: 'card', title: c.title, tabTitle: t.title, alts: c.alts,
      min: levelRank(c.min) >= levelRank(t.min) ? c.min : t.min, flags: uniq([t.flag, c.flag]),
      href: `#settings/${c.tab}/${c.id}`,
    };
  }),
]);

/** The four Add-ons pages (the former Settings tabs), by their view name. */
export const ADDON_PAGES = Object.freeze({ marketplace: 'Marketplace', connectors: 'Connectors', models: 'Models', providers: 'Providers' });

const addon = (page, key, title, href, o = {}) => ({
  id: `addon:${page}/${key}`, type: 'addon', page, title, tabTitle: ADDON_PAGES[page], meta: '', alts: [], min: 'simple', flags: [],
  href, card: '', ...o,
});
/** The settings INSIDE the Add-ons pages (the pages themselves are in the left menu). A row on a static card locks by
 *  that card's own mode (`card` names it; test/ui-settings-index.test.mjs pins both); every other row is page-level and
 *  never locks (A-9: the page's own banner says when it is above the mode). */
export const ADDON_ENTRIES = Object.freeze([
  addon('marketplace', 'browse', 'Browse plugins', '#marketplace', { alts: ['plugins', 'extensions', 'store', 'install', 'catalog', 'add-ons'] }),
  addon('marketplace', 'installed', 'Installed plugins', '#marketplace/installed', { alts: ['plugins', 'update', 'uninstall', 'remove', 'enable', 'disable'] }),
  addon('marketplace', 'marketplaces', 'Marketplaces', '#marketplace/marketplaces', { alts: ['plugin sources', 'repositories', 'add marketplace', 'refresh', 'sync'] }),
  addon('connectors', 'sets', 'MCP sets', '#connectors', { alts: ['mcp', 'integrations', 'tools', 'servers', 'general set'] }),
  addon('connectors', 'servers', 'MCP servers', '#connectors/servers', { alts: ['mcp', 'integrations', 'tools', 'add server', 'servers'] }),
  addon('connectors', 'skills', 'Skills', '#connectors/skills', { alts: ['skill', 'skill.md', 'import skill', 'integrations'] }),
  addon('models', 'catalogue', 'Model catalogue', '#models', { alts: ['models', 'model', 'add model', 'import models', 'llm', 'pricing', 'cost', 'built-in models', 'your models'] }),
  addon('models', 'roles', 'Roles', '#models/model-roles-card', { card: 'model-roles-card', alts: ['model roles', 'default model', 'fallback model', 'llm'] }),
  addon('models', 'engines', 'Engines', '#models/engine-settings-card', { card: 'engine-settings-card', min: 'expert', alts: ['engine', 'default engine', 'step models', 'models per engine', 'claude', 'codex'] }),
  addon('models', 'helper-jobs', 'Helper job models', '#models/engine-settings-card', { card: 'engine-settings-card', min: 'expert',
    alts: ['helper model', 'helper jobs', 'utility model', 'titles', 'title model', 'classifier', 'auto workflow model', 'pr description', 'memory defragment', 'workspace scan'] }),
  addon('providers', 'copilot', 'GitHub Copilot', '#providers/copilot', { alts: ['copilot', 'sign in', 'github', 'account', 'quota', 'premium requests'] }),
  addon('providers', 'openai', 'OpenAI-compatible', '#providers/openai', { alts: ['openai', 'api key', 'key', 'base url', 'endpoint', 'gpt', 'local models', 'ollama', 'lm studio'] }),
  addon('providers', 'openrouter', 'OpenRouter', '#providers/openai', { alts: ['openrouter', 'api key', 'key', 'free models', 'openai-compatible'] }),
  addon('providers', 'anthropic', 'Anthropic-compatible', '#providers/anthropic', { alts: ['anthropic', 'claude api', 'api key', 'key', 'base url', 'endpoint', 'gateway'] }),
  addon('providers', 'speech', 'Speech (Chat voice)', '#providers/speech', { alts: ['speech', 'voice', 'speech to text', 'text to speech', 'stt', 'tts', 'whisper', 'microphone'] }),
]);

const MODEL_SOURCE = Object.freeze({ global: 'Your model', plugin: 'From a plugin', policy: 'Team policy' });
const named = (v) => typeof v === 'string' && v !== '';
/** Add-ons rows built from data the app already has (global-search.mjs sources): one "<plugin> settings" row per
 *  installed plugin that has settings (its manage sheet at Settings), one row per MCP server, one per own, plugin or
 *  team-policy model (built-ins are found through the catalogue and card rows). Page-level: never locked. */
export function addonEntriesFrom({ plugins = [], connectors = [], models = [] } = {}) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const out = [];
  for (const p of list(plugins)) {
    if (p.hasSettings !== true || !named(p.name)) continue;
    out.push(addon('marketplace', `settings:${p.name}`, `${p.name} settings`, `#marketplace/installed/${encodeURIComponent(p.name)}/settings`,
      { meta: 'Marketplace · Plugin settings', alts: ['plugin settings', 'configure', 'setup', 'token', 'api key', 'secrets'] }));
  }
  for (const s of list(connectors)) {
    if (!named(s.id) || !named(s.name)) continue;
    out.push(addon('connectors', `server:${s.id}`, s.name, `#connectors/servers/${encodeURIComponent(s.id)}`,
      { meta: 'Connectors · MCP server', alts: ['mcp', 'server', 'connector', ...(named(s.description) ? [s.description] : [])] }));
  }
  for (const m of list(models)) {
    if (!Object.hasOwn(MODEL_SOURCE, m.source) || !named(m.id)) continue;
    const from = m.source === 'plugin' && named(m.plugin) ? `From ${m.plugin}` : MODEL_SOURCE[m.source];
    out.push(addon('models', `model:${m.id}`, named(m.label) ? m.label : m.id, `#models/model/${encodeURIComponent(m.id)}`,
      { meta: `Models · ${from}`, alts: [m.id, 'model', ...(named(m.plugin) ? [m.plugin] : [])] }));
  }
  return out;
}

/** What still stands between the user and `entry`: a mode lock first, then each Labs flag that is off.
 *  A missing or unknown level reads as Expert (ui-level.mjs normalizeLevel): nothing is mode-locked. */
export function locksFor(entry, { level, flags } = {}) {
  const locks = [];
  if (levelRank(level) < levelRank(entry.min)) locks.push({ type: 'mode', min: entry.min });
  for (const key of entry.flags) {
    if (!(flags && flags[key] === true)) locks.push({ type: 'flag', key, title: flagByKey(key)?.title || key });
  }
  return locks;
}

/** The row's unlock note: "Switch to Advanced mode · Turn on Labs: Cost tags, Run labels". */
export function lockNote(locks) {
  const mode = locks.find((l) => l.type === 'mode');
  const flags = locks.filter((l) => l.type === 'flag').map((l) => l.title);
  return [mode ? `Switch to ${LEVEL_INFO[mode.min].label} mode` : '', flags.length ? `Turn on Labs: ${flags.join(', ')}` : '']
    .filter(Boolean).join(' · ');
}
