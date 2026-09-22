// ui/public/chat-settings-view.mjs
// Pure DOM renderers for the Settings "Chat notifications" card
// (chat-connectivity-design.md §4.8). Same contract as plugins-view.mjs:
// detached elements, no fetch, no listeners — app.js owns I/O and mounting;
// node:test drives these via jsdom.

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
    chBox.appendChild(h(doc, 'small', 'hint chat-none', 'No chat channels installed. Install a chat plugin (e.g. telegram-chat) in the Plugins view.'));
  }
  for (const c of rows) {
    const key = `${c.plugin}/${c.channelId}`;
    const row = h(doc, 'div', 'chat-channel-row');
    row.dataset.channelKey = key;
    const toggle = h(doc, 'label', 'chat-channel-toggle');
    const cb = h(doc, 'input', 'sw-input chat-ch');
    cb.type = 'checkbox';
    cb.dataset.channelKey = key;
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
