// ui/public/chat-settings-view.mjs
// Pure DOM renderers for the Settings "Chat notifications" card
// (chat-connectivity-design.md §4.8). Same contract as plugins-view.mjs:
// detached elements, no fetch, no listeners — app.js owns I/O and mounting;
// node:test drives these via jsdom. (One exception: the Ask web fields keep their own
// dirty flag with input/change listeners on their detached wrapper — no I/O.)

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const EVENTS = [
  ['question', 'Approval / question needed', 'a pipeline is blocked waiting on you — the one to keep on'],
  ['done', 'Run finished (done / stopped)', ''],
  ['error', 'Run failed', ''],
  ['paused', 'Run paused (incl. cost limits)', ''],
  ['away', 'Away hours start or end', 'only when a run is answered by worca'],
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

  const evBox = h(doc, 'div', 'chat-events');
  evBox.appendChild(h(doc, 'div', 'label-row', 'Notify on'));
  for (const [key, label, hint] of EVENTS) {
    const row = h(doc, 'label', 'chat-event-row');
    const cb = h(doc, 'input', 'sw-input chat-ev');
    cb.type = 'checkbox';
    cb.dataset.ev = key;
    cb.dataset.setting = 'chat';
    cb.checked = p.notify?.[key] !== false;
    cb.setAttribute('aria-label', label);
    row.appendChild(cb);
    row.appendChild(h(doc, 'span', 'switch switch-sm'));
    row.appendChild(h(doc, 'span', '', label));
    if (hint) row.appendChild(h(doc, 'small', 'hint', hint));
    evBox.appendChild(row);
  }
  root.appendChild(evBox);

  const chBox = h(doc, 'div', 'chat-channels');
  chBox.appendChild(h(doc, 'div', 'label-row', 'Channels'));
  const rows = channels || [];
  if (!rows.length) {
    chBox.appendChild(h(doc, 'small', 'hint chat-none', 'No chat channels installed. Install a chat plugin (e.g. telegram-chat) on the Marketplace page.'));
  }
  for (const c of rows) {
    const key = `${c.plugin}/${c.channelId}`;
    const row = h(doc, 'div', 'chat-channel-row');
    row.dataset.channelKey = key;
    const toggle = h(doc, 'label', 'chat-channel-toggle');
    const cb = h(doc, 'input', 'sw-input chat-ch');
    cb.type = 'checkbox';
    cb.dataset.channelKey = key;
    cb.dataset.setting = 'chat';
    cb.checked = p.channels?.[key]?.enabled !== false;
    cb.setAttribute('aria-label', `Enable ${c.displayName || c.channelId}`);
    toggle.appendChild(cb);
    toggle.appendChild(h(doc, 'span', 'switch switch-sm'));
    toggle.appendChild(h(doc, 'span', '', `${c.displayName || c.channelId} (${c.platform})`));
    row.appendChild(toggle);
    const stateCls = { connected: 'green', degraded: 'waiting', connecting: 'waiting', unconfigured: 'waiting' }[c.state] || 'red';
    const badge = h(doc, 'span', `badge ${stateCls} chat-state`, c.state);
    badge.dataset.channelKey = key;
    if (c.detail) badge.title = c.detail;
    row.appendChild(badge);
    const test = h(doc, 'button', 'btn-ghost btn-mini chat-test', 'Test');
    test.type = 'button';
    test.dataset.plugin = c.plugin;
    test.dataset.channelId = c.channelId;
    row.appendChild(test);
    chBox.appendChild(row);
    // Command reach (/api/chat/status `commands`): an inbound channel with an empty
    // allow-list notifies but ignores every reply — the silent failure behind
    // "my /approve did nothing". Say so, and name the last chat that was refused.
    const cmd = c.capabilities?.inbound !== false && c.commands ? c.commands : null;
    if (cmd && cmd.allowed === 0) {
      const off = h(doc, 'small', 'hint warn chat-commands-off',
        `Commands are off: no chat is in Allowed chat IDs, so replies like /approve are ignored. Add the chat ID on the Marketplace page: ${c.plugin} › Settings.`);
      off.dataset.channelKey = key;
      chBox.appendChild(off);
    }
    if (cmd && cmd.lastRefused) {
      const r = cmd.lastRefused;
      const refused = h(doc, 'small', 'hint warn chat-refused',
        `Ignored /${r.command} from chat ${r.chatId} — it is not in Allowed chat IDs.`);
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
  const row = h(doc, 'label', 'check-row');
  row.setAttribute('for', 'askScriptTools');
  const cb = h(doc, 'input', 'ask-script-tools');
  cb.type = 'checkbox';
  cb.id = 'askScriptTools';
  cb.checked = prefs?.scriptTools !== false;
  row.appendChild(cb);
  row.appendChild(doc.createTextNode(' Create and run scripts'));
  return row;
}

/** collectScriptToolsToggle(root) -> the POST /api/settings {chat} patch of the Ask Worca card. */
export function collectScriptToolsToggle(root) {
  const cb = root && typeof root.querySelector === 'function' ? root.querySelector('input.ask-script-tools') : null;
  return { scriptTools: cb ? cb.checked : true };
}

/** Ask Worca → Web access (docs/guardrails.md "Web access"): off by default; the allowlist is enforced by worca's server. */
export function renderAskWebFields({ askWeb } = {}, { doc = globalThis.document } = {}) {
  const w = askWeb || { enabled: false, anyHost: false, allowedDomains: [], search: null };
  const wrap = h(doc, 'div', 'ask-web');
  wrap.append(h(doc, 'div', 'label-row', 'Web access'));
  const row = h(doc, 'label', 'check-row'); row.setAttribute('for', 'askWebEnabled');
  const cb = h(doc, 'input'); cb.type = 'checkbox'; cb.id = 'askWebEnabled'; cb.checked = w.enabled === true;
  row.append(cb, doc.createTextNode(' Let Ask Worca read web pages'));
  const anyRow = h(doc, 'label', 'check-row'); anyRow.setAttribute('for', 'askWebAnyHost');
  const any = h(doc, 'input'); any.type = 'checkbox'; any.id = 'askWebAnyHost'; any.checked = w.anyHost === true;
  anyRow.append(any, doc.createTextNode(' Any site, without asking'));
  const anyHint = h(doc, 'small', 'hint', 'Risky: a web page or a file Ask reads can then make it send data to any site in a URL. Leave off to approve each new site from the chat.');
  const domains = h(doc, 'textarea', 'input'); domains.id = 'askWebDomains'; domains.rows = 4;
  domains.dataset.setting = 'askWeb.allowedDomains'; domains.setAttribute('aria-label', 'Allowed domains');
  domains.placeholder = 'docs.python.org\n*.mozilla.org'; domains.value = (w.allowedDomains || []).join('\n');
  const dHint = h(doc, 'small', 'hint', 'Sites Ask may read without asking. One host per line: example.com, or *.example.com for its subdomains. For any other site Ask shows a card in the chat: allow it for that chat, always (it is added here), or deny. https only. A site sees every URL Ask requests from it, so only allow sites you trust.');
  const field = (id, label, placeholder, value, setting) => {
    const box = h(doc, 'div', 'field');
    const l = h(doc, 'label', null, label); l.setAttribute('for', id);
    const i = h(doc, 'input', 'input'); i.id = id; i.placeholder = placeholder; i.value = value || '';
    i.dataset.setting = setting;
    box.append(l, i); return box;
  };
  const s = w.search || {};
  // Dirty flag: the card posts askWeb only after the user touched a web field, so saving the other
  // Ask limits never rewrites the stored web settings.
  const markDirty = () => { wrap.dataset.dirty = '1'; };
  wrap.addEventListener('input', markDirty);
  wrap.addEventListener('change', markDirty);
  wrap.append(row, anyRow, anyHint, domains, dHint,
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
