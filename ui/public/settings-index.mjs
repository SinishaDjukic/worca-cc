// ui/public/settings-index.mjs — what the top bar search can find in Settings and the Add-ons pages.
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

const addon = (id, title, alts) => ({ id: `addon:${id}`, type: 'addon', title, tabTitle: '', alts, min: 'simple', flags: [], href: `#${id}` });
/** The four former Settings tabs. Never locked (A-9): the page itself says when it is above the mode. */
export const ADDON_ENTRIES = Object.freeze([
  addon('marketplace', 'Marketplace', ['plugins', 'extensions', 'store', 'install', 'catalog']),
  addon('connectors', 'Connectors', ['integrations', 'mcp', 'servers', 'tools', 'skills']),
  addon('models', 'Models', ['model', 'engines', 'helper jobs', 'llm', 'pricing']),
  addon('providers', 'Providers', ['provider', 'api keys', 'keys', 'credentials', 'openrouter', 'anthropic']),
]);

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
