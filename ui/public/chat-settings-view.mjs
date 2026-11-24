// ui/public/chat-settings-view.mjs
// Pure DOM renderers for the Settings "Chat notifications" card
// (chat-connectivity-design.md §4.8). Same contract as plugins-view.mjs:
// detached elements, no fetch, no listeners — app.js owns I/O and mounting;
// node:test drives these via jsdom. (One exception: the Ask web fields keep their own
// dirty flag with input/change listeners on their detached wrapper — no I/O.)

import { makeSwitch } from './switch.mjs';
import { chip } from './flags.mjs';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const EVENTS = [
  ['question', 'Approval / question needed', 'a pipeline is blocked waiting on you (the one to keep on)'],
  ['done', 'Run finished (done / stopped)', ''],
  ['error', 'Run failed', ''],
  ['paused', 'Run paused (incl. cost limits)', ''],
  ['away', 'Away hours start or end', 'only when a run is answered by worca'],
  ['prWatch', 'Watched pull requests', 'fix started, published, or needs a person'],
];

/**
 * renderChatSettings({prefs, channels}) -> detached card body.
 * prefs = chatPrefs() shape {notify, channels}; channels = /api/chat/status
 * rows. Inputs carry data-ev / data-channel-key; the Test button carries
 * data-plugin + data-channel-id + .chat-test for app.js's delegated listener.
 */
export function renderChatSettings({ prefs, channels } = {}, { doc = globalThis.document } = {}) {
  const p = prefs || { notify: {}, channels: {} };
  const root = h(doc, 'div', 'chat-settings');

  const evBox = h(doc, 'div', 'chat-events drows');
  evBox.appendChild(h(doc, 'div', 'label-row', 'Notify on'));
  for (const [key, label, hint] of EVENTS) {
    const row = h(doc, 'label', 'drow switch-drow chat-event-row');
    const cb = h(doc, 'input', 'sw-input chat-ev');
    cb.type = 'checkbox';
    cb.dataset.ev = key;
    cb.dataset.setting = 'chat';
    cb.checked = p.notify?.[key] !== false;
    cb.setAttribute('aria-label', label);
    row.appendChild(h(doc, 'span', 'drow-label', label));
    if (hint) row.appendChild(h(doc, 'small', 'hint drow-help', hint));
    const ctl = h(doc, 'span', 'drow-control');
    ctl.append(cb, h(doc, 'span', 'switch'));
    row.appendChild(ctl);
    evBox.appendChild(row);
  }
  root.appendChild(evBox);

  const chBox = h(doc, 'div', 'chat-channels drows');
  chBox.appendChild(h(doc, 'div', 'label-row', 'Channels'));
  const rows = channels || [];
  if (!rows.length) {
    chBox.appendChild(h(doc, 'small', 'hint chat-none', 'No chat channels installed. Install a chat plugin (e.g. telegram-chat) on the Marketplace page.'));
  }
  for (const c of rows) {
    const key = `${c.plugin}/${c.channelId}`;
    const row = h(doc, 'div', 'drow chat-channel-row');
    row.dataset.channelKey = key;
    const toggle = h(doc, 'label', 'drow-label chat-channel-toggle');
    const cb = h(doc, 'input', 'sw-input chat-ch');
    cb.type = 'checkbox';
    cb.dataset.channelKey = key;
    cb.dataset.setting = 'chat';
    cb.checked = p.channels?.[key]?.enabled !== false;
    cb.setAttribute('aria-label', `Enable ${c.displayName || c.channelId}`);
    toggle.appendChild(cb);
    toggle.appendChild(h(doc, 'span', 'switch'));
    toggle.appendChild(h(doc, 'span', '', `${c.displayName || c.channelId} (${c.platform})`));
    row.appendChild(toggle);
    const ctl = h(doc, 'span', 'drow-control');
    const stateCls = { connected: 'green', degraded: 'waiting', connecting: 'waiting', unconfigured: 'waiting' }[c.state] || 'red';
    const badge = h(doc, 'span', `badge ${stateCls} chat-state`, c.state);
    badge.dataset.channelKey = key;
    if (c.detail) badge.title = c.detail;
    ctl.appendChild(badge);
    const test = h(doc, 'button', 'btn btn-sm chat-test', 'Test');
    test.type = 'button';
    test.dataset.plugin = c.plugin;
    test.dataset.channelId = c.channelId;
    ctl.appendChild(test);
    row.appendChild(ctl);
    chBox.appendChild(row);
    // Command reach (/api/chat/status `commands`): an inbound channel with an empty
    // allow-list notifies but ignores every reply — the silent failure behind
    // "my /approve did nothing". Say so, and name the last chat that was refused.
    const cmd = c.capabilities?.inbound !== false && c.commands ? c.commands : null;
    if (cmd && cmd.allowed === 0) {
      const off = h(doc, 'small', 'hint warn chat-commands-off',
        `Commands are off: no chat is in Allowed chat IDs, so replies like /approve are ignored. Add the chat ID on the Marketplace page: Installed › ${c.plugin} › Settings.`);
      off.dataset.channelKey = key;
      chBox.appendChild(off);
    }
    if (cmd && cmd.lastRefused) {
      const r = cmd.lastRefused;
      const refused = h(doc, 'small', 'hint warn chat-refused',
        `Ignored /${r.command} from chat ${r.chatId}: it is not in Allowed chat IDs.`);
      refused.dataset.channelKey = key;
      if (r.at) refused.title = r.at;
      chBox.appendChild(refused);
    }
  }
  root.appendChild(chBox);
  return root;
}

/** collectChatSettings(root) -> the POST /api/settings {chat} patch. */
export function collectChatSettings(root) {
  const notify = {};
  for (const cb of root.querySelectorAll('input.chat-ev[data-ev]')) notify[cb.dataset.ev] = cb.checked;
  const channels = {};
  for (const cb of root.querySelectorAll('input.chat-ch[data-channel-key]')) {
    channels[cb.dataset.channelKey] = { enabled: cb.checked };
  }
  return { notify, channels };
}

/**
 * The Settings → Ask Worca "Create and run scripts" row (scripts-workbench W20). Lives here
 * with the other chat-pref controls because the value is one of `chatPrefs()`; it is mounted
 * in the Ask Worca card, not in Chat notifications, and saves with that card's Save button.
 * Default ON: only a stored `false` switches the chat's save_script / test_script off.
 */
export function renderScriptToolsToggle({ prefs } = {}, { doc = globalThis.document } = {}) {
  const { row, input } = makeSwitch(doc, { label: 'Create and run scripts', checked: prefs?.scriptTools !== false, inputClass: 'ask-script-tools' });
  input.id = 'askScriptTools';
  return row;
}

/** collectScriptToolsToggle(root) -> the POST /api/settings {chat} patch of the Ask Worca card. */
export function collectScriptToolsToggle(root) {
  const cb = root && typeof root.querySelector === 'function' ? root.querySelector('input.ask-script-tools') : null;
  return { scriptTools: cb ? cb.checked : true };
}

/** Settings → Ask Worca "Suggest a next prompt" row: the ghost text after each reply (one cheap model call per reply).
 *  Default ON; saved with the Ask Worca card. */
export function renderSuggestionsToggle({ prefs } = {}, { doc = globalThis.document } = {}) {
  const { row, input } = makeSwitch(doc, { label: 'Suggest a next prompt after each reply', checked: prefs?.suggestions !== false, inputClass: 'ask-suggestions' });
  input.id = 'askSuggestions';
  return row;
}

/** collectSuggestionsToggle(root) -> the {chat} patch part for the toggle. */
export function collectSuggestionsToggle(root) {
  const cb = root && typeof root.querySelector === 'function' ? root.querySelector('input.ask-suggestions') : null;
  return { suggestions: cb ? cb.checked : true };
}

/** Settings › Chat "Summarise commands" (#911, flag commandSummaries): chat commands as one-line rows.
 *  Default ON; saved with the Ask Worca card. The host carries data-flag, so the row hides with the flag. */
export function renderSummariesToggle({ prefs } = {}, { doc = globalThis.document } = {}) {
  const wrap = doc.createElement('div');
  const { row, input } = makeSwitch(doc, { label: 'Summarise commands', checked: prefs?.summariseCommands !== false, inputClass: 'ask-summaries' });
  input.id = 'askSummaries';
  const label = row.querySelector('.switch-label');
  label.dataset.flagChip = 'commandSummaries';
  chip(label, doc);
  const hint = doc.createElement('small');
  hint.className = 'hint drow-help';
  hint.textContent = 'Each command shows as one line saying what it does; click it for the command and its output. Off: full command cards.';
  wrap.append(row, hint);
  return wrap;
}

/** collectSummariesToggle(root) -> the {chat} patch part for the switch. */
export function collectSummariesToggle(root) {
  const cb = root && typeof root.querySelector === 'function' ? root.querySelector('input.ask-summaries') : null;
  return { summariseCommands: cb ? cb.checked : true };
}

/** Ask Worca → Web access (docs/guardrails.md "Web access"): off by default; the allowlist is enforced by worca's server. */
export function renderAskWebFields({ askWeb } = {}, { doc = globalThis.document } = {}) {
  const w = askWeb || { enabled: false, anyHost: false, allowedDomains: [], search: null };
  const wrap = h(doc, 'div', 'ask-web drows');
  wrap.append(h(doc, 'div', 'label-row', 'Web access'));
  const { row, input: cb } = makeSwitch(doc, { label: 'Let Chat read web pages', checked: w.enabled === true });
  cb.id = 'askWebEnabled';
  const { row: anyRow, input: any } = makeSwitch(doc, { label: 'Any site, without asking', checked: w.anyHost === true });
  any.id = 'askWebAnyHost';
  const anyHint = h(doc, 'small', 'hint drow-help', 'Risky: a web page or a file Ask reads can then make it send data to any site in a URL. Leave off to approve each new site from the chat.');
  const domains = h(doc, 'textarea', 'textarea'); domains.id = 'askWebDomains'; domains.rows = 4;
  domains.dataset.setting = 'askWeb.allowedDomains'; domains.setAttribute('aria-label', 'Allowed domains');
  domains.placeholder = 'docs.python.org\n*.mozilla.org'; domains.value = (w.allowedDomains || []).join('\n');
  const dHint = h(doc, 'small', 'hint drow-help', 'Sites Ask may read without asking. One host per line: example.com, or *.example.com for its subdomains. For any other site Ask shows a card in the chat: allow it for that chat, always (it is added here), or deny. https only. A site sees every URL Ask requests from it, so only allow sites you trust.');
  const field = (id, label, placeholder, value, setting) => {
    const box = h(doc, 'div', 'field drow');
    const l = h(doc, 'label', 'drow-label', label); l.setAttribute('for', id);
    const i = h(doc, 'input', 'input'); i.id = id; i.placeholder = placeholder; i.value = value || '';
    i.dataset.setting = setting;
    box.append(l, ctlOf(i)); return box;
  };
  const ctlOf = (...kids) => { const c = h(doc, 'div', 'drow-control'); c.append(...kids); return c; };
  const rowOf = (cls, ...kids) => { const r = h(doc, 'div', cls); r.append(...kids); return r; };
  const s = w.search || {};
  // Dirty flag: the card posts askWeb only after the user touched a web field, so saving the other
  // Ask limits never rewrites the stored web settings.
  const markDirty = () => { wrap.dataset.dirty = '1'; };
  wrap.addEventListener('input', markDirty);
  wrap.addEventListener('change', markDirty);
  wrap.append(rowOf('drow drow-wide', ctlOf(row)), rowOf('drow drow-wide', ctlOf(anyRow), anyHint),
    rowOf('field drow drow-wide ask-web-domains', dHint, ctlOf(domains)),
    field('askWebSearchUrl', 'Search endpoint (optional)', 'https://api.search.brave.com/res/v1/web/search?q={query}', s.url, 'askWeb.search.url'),
    field('askWebSearchKey', 'Search key variable', '${BRAVE_API_KEY}', s.key, 'askWeb.search.key'),
    field('askWebSearchHeader', 'Key header', 'X-Subscription-Token', s.keyHeader, 'askWeb.search.keyHeader'),
    field('askWebSearchPrefix', 'Key prefix', 'Bearer ', s.keyPrefix, 'askWeb.search.keyPrefix'),
    h(doc, 'small', 'hint', 'Any GET search API that returns JSON. Use {query} (and optionally {key}) in the URL; the key is always a ${VAR} read from worca\'s environment.'));
  return wrap;
}

/** The askWeb POST value, or null when the user did not touch the web fields (nothing to send). */
export function collectAskWebFields(root) {
  if (root.querySelector('.ask-web')?.dataset.dirty !== '1') return null;
  const q = (id) => root.querySelector(`#${id}`);
  const val = (id) => (q(id) ? q(id).value.trim() : '');
  const url = val('askWebSearchUrl');
  return {
    enabled: !!q('askWebEnabled')?.checked,
    anyHost: !!q('askWebAnyHost')?.checked,
    allowedDomains: (q('askWebDomains')?.value || '').split('\n').map((x) => x.trim()).filter(Boolean),
    search: url ? { url, key: val('askWebSearchKey'), keyHeader: val('askWebSearchHeader'), keyPrefix: q('askWebSearchPrefix') ? q('askWebSearchPrefix').value : '' } : null,
  };
}

// ── Settings › Chat › Chat checkouts (worktree-idle.mjs, GET /api/ask/worktrees) ─────────────────────────────

const DAY_MS = 24 * 60 * 60_000;
const NOT_ON_A_BRANCH_TIP = 'Commits made in this checkout that no branch holds. If it came from a branch that was since deleted, those commits are upstream history.';

/** The chip of one checkout, from separate verdict fields, in one place: { label, tone, tip }. `tone` is a badge class. */
export function chipFor(item) {
  if (item.inUse !== false) return { label: 'In use', tone: 'waiting', tip: 'A live chat turn, command, followed run or terminal is using this checkout.' };
  if (item.loss === 'unknown') return { label: 'Check failed', tone: 'red', tip: 'Git could not be asked what this checkout holds, so it is kept.' };
  if (item.dirty) return { label: 'Uncommitted changes', tone: 'red', tip: 'Files in this checkout are changed or new and not committed.' };
  if (item.ownCommits) return { label: 'Commits not on any branch', tone: 'red', tip: NOT_ON_A_BRANCH_TIP };
  if (item.recent) return { label: 'Used recently', tone: 'waiting', tip: 'Its chat or checkout was used within the last week.' };
  if (item.safe) return { label: 'Safe to remove', tone: 'green', tip: 'Clean, nothing only on it, and untouched for a week.' };
  return { label: 'Kept', tone: 'waiting', tip: '' };
}

/** "12 days ago" for an ISO time; '' when it does not parse. */
export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const ms = Math.max(0, now - t);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY_MS) { const h = Math.floor(ms / 3_600_000); return `${h} ${h === 1 ? 'hour' : 'hours'} ago`; }
  const d = Math.floor(ms / DAY_MS);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/** "12 of 15 slots used · 7 safe to remove" (the hint under the label). */
export function checkoutsSummary(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const safe = items.filter((i) => i.safe).length;
  return `${payload?.used ?? items.length} of ${payload?.capacity ?? 15} slots used · ${safe} safe to remove`;
}

/** Why the Remove button is disabled for this row, or '' when it is enabled. */
function removeBlock(item) {
  if (item.inUse !== false) return 'In use by a live turn, command, run or terminal';
  if (!item.safe && !item.canDiscard) return "Belongs to someone else's chat and isn't safe to remove";
  return '';
}

/**
 * renderCheckoutsList(payload) -> a detached list: one row per checkout with the chat title, owner (only on a shared
 * instance), project and ref, last use, the chip and a Remove button (`.checkout-remove[data-wt]`).
 */
export function renderCheckoutsList(payload, { doc = globalThis.document, now = Date.now() } = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const root = h(doc, 'div', 'checkouts');
  if (!items.length) { root.appendChild(h(doc, 'small', 'hint checkouts-empty', 'No chat checkouts.')); return root; }
  const shared = new Set(items.map((i) => i.createdBy || '')).size > 1;
  for (const item of items) {
    const row = h(doc, 'div', 'checkout-row');
    row.dataset.wt = item.worktreeId;
    row.dataset.thread = item.threadId;
    const main = h(doc, 'div', 'checkout-main');
    main.appendChild(h(doc, 'span', 'checkout-title', item.title || 'Untitled chat'));
    const ago = agoText(item.lastTouchedAt, now);
    const meta = [shared ? (item.createdBy || 'No owner') : null, item.projectKey, item.ref, ago ? `last used ${ago}` : null].filter(Boolean).join(' · ');
    main.appendChild(h(doc, 'small', 'hint checkout-meta', meta));
    row.appendChild(main);
    const c = chipFor(item);
    const badge = h(doc, 'span', `badge ${c.tone} checkout-chip`, c.label);
    if (c.tip) badge.title = c.tip;
    row.appendChild(badge);
    const btn = h(doc, 'button', 'btn btn-sm checkout-remove', 'Remove');
    btn.type = 'button';
    btn.dataset.wt = item.worktreeId;
    const blocked = removeBlock(item);
    if (blocked) { btn.disabled = true; btn.title = blocked; }
    row.appendChild(btn);
    root.appendChild(row);
  }
  return root;
}

/** The text of the danger confirm for a checkout that would lose work (loss !== 'none'). */
export function checkoutConfirmMessage(item) {
  const lost = item.lost || {};
  const lines = [`Remove the checkout of “${item.title || 'Untitled chat'}” (${item.projectKey} · ${item.ref})?`];
  if (item.loss === 'unknown') {
    lines.push('The check could not run, so it cannot say what this checkout holds. Removing it may lose work.');
  } else {
    const files = lost.dirtyFiles || [];
    const commits = lost.commits || [];
    if (files.length) {
      lines.push(`Uncommitted changes (${files.length}${lost.truncated ? '+' : ''}):`);
      for (const f of files.slice(0, 10)) lines.push(`• ${f}`);
      if (files.length > 10) lines.push(`and ${files.length - 10} more`);
    }
    if (commits.length) {
      lines.push(`Commits on no branch (${commits.length}${lost.truncated ? '+' : ''}):`);
      for (const c of commits.slice(0, 10)) lines.push(`• ${String(c.sha).slice(0, 7)} ${c.subject}`);
      if (commits.length > 10) lines.push(`and ${commits.length - 10} more`);
    }
  }
  lines.push('This cannot be undone. The chat stays and can open a fresh checkout later.');
  return lines.join('\n');
}

/**
 * The debounced refresh of the checkouts list: pokes coalesce into ONE trailing `load`, nothing runs while the card is
 * hidden, and a load in flight is never restarted (a poke during it earns one more run after). Each load costs about
 * two git probes per checkout, so it must not follow every frame.
 * @returns {{poke: () => void, cancel: () => void}}
 */
export function createCheckoutsRefresher({ load, visible, waitMs = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let running = false;
  let again = false;
  const run = async () => {
    timer = null;
    if (!visible()) return;
    running = true;
    try { await load(); } finally { running = false; }
    if (again) { again = false; poke(); }
  };
  function poke() {
    if (!visible()) return;
    if (running) { again = true; return; }
    if (timer !== null) clearTimer(timer);
    timer = setTimer(run, waitMs);
    timer?.unref?.();
  }
  return { poke, cancel: () => { if (timer !== null) clearTimer(timer); timer = null; again = false; } };
}
