// ui/public/plugins-view.mjs
// Pure DOM renderers for the Plugins view. Every function takes the target
// `document` via opts (defaults to the browser global) and returns DETACHED
// elements — no fetch, no listeners outside the returned tree. app.js owns
// endpoint calls, the modal shell, and mounting; node:test drives these via jsdom.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const sha7 = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : '');

// contributions -> "2 agents · 1 source · 1 skill". Arrays (listInstalledPlugins)
// or plain counts are both tolerated.
function contribSummary(c) {
  const n = (v) => (Array.isArray(v) ? v.length : (Number.isFinite(v) ? v : 0));
  const parts = [
    [n(c && c.agents), 'agent'], [n(c && c.taskSources), 'source'],
    [n(c && c.chatChannels), 'chat channel'], [n(c && c.models), 'model'],
    [n(c && c.skills), 'skill'], [n(c && c.workflows), 'workflow'],
  ].filter(([k]) => k > 0).map(([k, w]) => `${k} ${w}${k > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'no contributions';
}

// renderPluginList(plugins, {channelStatus}) -> <div.pl-list> of cards.
// Action buttons + the enable checkbox carry data-name and a pl-* class so
// app.js can wire ONE delegated listener on the list container. channelStatus
// rows (GET /api/chat/status) add per-channel live badges; the badge carries
// data-channel-key="<plugin>/<id>" so a channel-status WS event can patch it
// in place.
export function renderPluginList(plugins, { doc = globalThis.document, channelStatus = [] } = {}) {
  const root = h(doc, 'div', 'pl-list');
  for (const p of plugins || []) {
    const card = h(doc, 'section', 'card plugin-card');
    card.dataset.name = p.name;
    if (p.enabled === false) card.classList.add('pl-disabled');
    const head = h(doc, 'div', 'pl-head');
    head.appendChild(h(doc, 'b', 'pl-name', p.name));
    head.appendChild(h(doc, 'span', 'pl-version mono', p.version || sha7(p.pinnedSha)));
    if (p.linked) head.appendChild(h(doc, 'span', 'badge waiting pl-linked', 'linked'));
    if (p.broken) head.appendChild(h(doc, 'span', 'badge red pl-broken', 'broken'));
    const toggle = h(doc, 'label', 'pl-enable');
    const cb = h(doc, 'input', 'pl-toggle');
    cb.type = 'checkbox';
    cb.checked = p.enabled !== false;
    cb.dataset.name = p.name;
    toggle.appendChild(cb);
    toggle.appendChild(h(doc, 'span', '', p.enabled !== false ? 'enabled' : 'disabled'));
    head.appendChild(toggle);
    card.appendChild(head);
    card.appendChild(h(doc, 'small', 'pl-contrib hint', contribSummary(p.contributions)));
    if (p.repo || p.marketplaceName) {
      const prov = [p.marketplaceName, p.repo].filter(Boolean).join(' · ');
      card.appendChild(h(doc, 'small', 'pl-provenance hint mono',
        p.pinnedSha ? `${prov} @ ${sha7(p.pinnedSha)}` : prov));
    }
    const chRows = (channelStatus || []).filter((c) => c.plugin === p.name);
    if (chRows.length) {
      const chans = h(doc, 'div', 'pl-channels');
      for (const c of chRows) chans.appendChild(channelBadge(doc, c));
      card.appendChild(chans);
    }
    const actions = h(doc, 'div', 'pl-actions');
    for (const [cls, label] of [['pl-settings', 'Settings'], ['pl-doctor', 'Doctor'], ['pl-update', 'Update'], ['pl-remove', 'Remove']]) {
      const b = h(doc, 'button', `btn-ghost ${cls}`, label);
      b.type = 'button';
      b.dataset.name = p.name;
      actions.appendChild(b);
    }
    card.appendChild(actions);
    root.appendChild(card);
  }
  if (!plugins || !plugins.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'No plugins installed. Browse Available below or add a marketplace.'));
  }
  return root;
}

// One live channel badge: dot color by connection state + platform label.
// Exported so app.js can re-render a single badge on a channel-status event.
export function channelBadge(doc, c) {
  const stateCls = { connected: 'green', degraded: 'waiting', connecting: 'waiting' }[c.state] || 'red';
  const b = h(doc, 'span', `badge ${stateCls} pl-channel`, `${c.displayName || c.channelId} · ${c.state}`);
  b.dataset.channelKey = `${c.plugin}/${c.channelId}`;
  if (c.detail) b.title = c.detail;
  return b;
}

// renderOrphanList(orphans) -> <div.pl-orphans> of "leftover data" rows.
// Purge buttons carry data-name + .pl-purge-orphan for app.js's delegated
// listener. Empty/nullish input -> childless container (app.js skips mounting).
export function renderOrphanList(orphans, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-orphans');
  if (!orphans || !orphans.length) return root;
  root.appendChild(h(doc, 'h3', 'pl-orphans-title', 'Leftover data'));
  for (const o of orphans) {
    const row = h(doc, 'div', 'card pl-orphan-row');
    row.dataset.name = o.name;
    row.appendChild(h(doc, 'b', 'pl-name', o.name));
    row.appendChild(h(doc, 'small', 'hint', 'uninstalled — config/secrets remain'));
    const btn = h(doc, 'button', 'btn-ghost pl-purge-orphan', 'Purge');
    btn.type = 'button';
    btn.dataset.name = o.name;
    row.appendChild(btn);
    root.appendChild(row);
  }
  return root;
}

// renderInstallConsent(entry, inventory) — spec §6.1 "Will install" ceremony.
// entry: { name, repoUrl, sha } (a marketplace snapshot plugin + the marketplace's url/lastSync.sha);
// inventory: buildInstallInventory shape. Secrets render red; setup commands verbatim.
export function renderInstallConsent(entry, inventory, { doc = globalThis.document } = {}) {
  const inv = inventory || {};
  const root = h(doc, 'div', 'pl-consent');
  root.appendChild(h(doc, 'div', 'pl-consent-src mono', `${entry.repoUrl} @ ${sha7(entry.sha)}`));
  const section = (label) => {
    const s = h(doc, 'div', 'pl-consent-sec');
    s.appendChild(h(doc, 'div', 'pl-consent-h', label));
    root.appendChild(s);
    return s;
  };
  const agents = section(`Agents (${(inv.agents || []).length})`);
  for (const a of inv.agents || []) {
    agents.appendChild(h(doc, 'div', 'pl-consent-row mono',
      `${a.key} — tools: ${(a.tools || []).join(', ') || 'none declared'}`));
  }
  const sources = section(`Task sources (${(inv.taskSources || []).length})`);
  for (const s of inv.taskSources || []) {
    const row = h(doc, 'div', 'pl-consent-row', s.displayName || s.id);
    for (const key of s.secrets || []) row.appendChild(h(doc, 'span', 'pl-secret', `requests secret: ${key}`));
    sources.appendChild(row);
  }
  if ((inv.chatChannels || []).length) {
    const channels = section(`Chat channels (${inv.chatChannels.length})`);
    for (const ch of inv.chatChannels) {
      const dirs = [ch.inbound && 'inbound', ch.outbound && 'outbound'].filter(Boolean).join(' + ');
      const row = h(doc, 'div', 'pl-consent-row',
        `${ch.displayName || ch.id} (${ch.platform}, ${dirs}) — runs a persistent worker`);
      for (const key of ch.secrets || []) row.appendChild(h(doc, 'span', 'pl-secret', `requests secret: ${key}`));
      channels.appendChild(row);
    }
    channels.appendChild(h(doc, 'div', 'pl-consent-row pl-channel-warn',
      'Inbound chat can pause/stop/approve runs: anyone holding the bot token or in an allowed chat controls worca-cc.'));
  }
  // Models (design §9.4): the base URL renders VERBATIM — a model's env can
  // redirect all API traffic for that model, so the reviewer must see where.
  if ((inv.models || []).length) {
    const models = section(`Models (${inv.models.length})`);
    for (const m of inv.models) {
      const row = h(doc, 'div', 'pl-consent-row', `${m.label || m.id} `);
      row.appendChild(h(doc, 'span', 'mono', `(${m.id})`));
      if (m.baseUrl) row.appendChild(h(doc, 'span', 'pl-secret pl-baseurl', ` routes to: ${m.baseUrl}`));
      if ((m.envKeys || []).length) row.appendChild(h(doc, 'small', 'hint', ` env: ${m.envKeys.join(', ')}`));
      models.appendChild(row);
    }
    for (const s of inv.modelSecrets || []) {
      models.appendChild(h(doc, 'div', 'pl-consent-row')).appendChild(
        h(doc, 'span', 'pl-secret', `requests model secret: ${s.key}${s.label && s.label !== s.key ? ` (${s.label})` : ''}`));
    }
  }
  const skills = section(`Skills (${(inv.skills || []).length})`);
  for (const s of inv.skills || []) skills.appendChild(h(doc, 'div', 'pl-consent-row mono', s));
  const wfs = section(`Workflows (${(inv.workflows || []).length})`);
  for (const w of inv.workflows || []) wfs.appendChild(h(doc, 'div', 'pl-consent-row mono', w));
  const setup = section('Setup');
  setup.appendChild(h(doc, 'div', 'pl-consent-row',
    inv.depCount == null ? 'no dependencies' : `${inv.depCount} npm dependencies (from lockfile)`));
  for (const cmd of inv.setupCommands || []) setup.appendChild(h(doc, 'div', 'pl-consent-row mono pl-setup-cmd', cmd));
  root.appendChild(h(doc, 'p', 'hint', 'Plugins run with your user privileges. Install only sources you trust.'));
  return root;
}

// renderUpdatePreview(preview) — fetchCandidate result: pinned→candidate shas,
// commit log, diffstat, confirm button (.pl-confirm-update; app.js wires it).
// No new commits -> a plain up-to-date state: badge + hint, no shas/diffstat/button.
export function renderUpdatePreview(preview, { doc = globalThis.document } = {}) {
  const p = preview || {};
  const root = h(doc, 'div', 'pl-update');
  if (!(p.commits || []).length) {
    const row = h(doc, 'div', 'pl-uptodate');
    row.appendChild(h(doc, 'span', 'badge green', 'up to date'));
    const at = sha7(p.pinnedSha || p.candidateSha);
    row.appendChild(h(doc, 'span', 'hint', `You are on the latest version${at ? ` (${at})` : ''}.`));
    root.appendChild(row);
    return root;
  }
  root.appendChild(h(doc, 'div', 'pl-update-shas mono', `${sha7(p.pinnedSha)} → ${sha7(p.candidateSha)}`));
  const list = h(doc, 'div', 'pl-commits');
  for (const c of p.commits) list.appendChild(h(doc, 'div', 'pl-commit mono', `${sha7(c.sha)} ${c.subject}`));
  root.appendChild(list);
  if (p.diffstat) root.appendChild(h(doc, 'pre', 'pl-diffstat mono', p.diffstat));
  // Manifest delta — the §6.2 red-flag review lines: new secrets/agents/sources.
  const d = p.manifestDelta || {};
  const flags = [
    ...(d.newSecrets || []).map((k) => ['pl-delta-secret', `NEW SECRET requested: ${k}`]),
    ...(d.newTaskSources || []).map((s) => ['pl-delta', `new task source: ${s}`]),
    ...(d.newAgents || []).map((a) => ['pl-delta', `new agent: ${a}`]),
    ...(d.setupChanged ? [['pl-delta', 'setup commands changed']] : []),
    // Model delta (design §9.4): an env change can silently reroute API traffic
    // — red-flag it like a new secret.
    ...(d.envChangedModels || []).map((m) => ['pl-delta-secret', `MODEL ENV CHANGED (check its base URL): ${m}`]),
    ...(d.newModelSecrets || []).map((k) => ['pl-delta-secret', `NEW MODEL SECRET requested: ${k}`]),
    ...(d.newModels || []).map((m) => ['pl-delta', `new model: ${m}`]),
    ...(d.removedModels || []).map((m) => ['pl-delta', `removed model: ${m}`]),
  ];
  if (flags.length) {
    const box = h(doc, 'div', 'pl-manifest-delta');
    for (const [cls, text] of flags) box.appendChild(h(doc, 'div', cls, text));
    root.appendChild(box);
  }
  const btn = h(doc, 'button', 'btn btn-primary btn-mini pl-confirm-update', 'Apply update');
  btn.type = 'button';
  root.appendChild(btn);
  return root;
}

// renderConfigForm(sections) — one <form.pl-config-form>
// per task source. secret:true fields (text-only per normalizeManifest) render
// type=password, NEVER prefilled; a stored value arrives redacted as {set:true}
// -> placeholder '(set)' + data-set="1" so collect can skip it untouched.
// Accepts the legacy array of sources OR the full { sources, channels } config
// payload. Channel forms carry data-channel-id (collectConfigForm routes the
// PUT accordingly) and a small platform heading so mixed plugins stay legible.
export function renderConfigForm(sections, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-config');
  const sources = Array.isArray(sections) ? sections : (sections?.sources || []);
  const channels = Array.isArray(sections) ? [] : (sections?.channels || []);
  const rows = [
    ...sources.map((x) => ({ ...x, _kind: 'source' })),
    ...channels.map((x) => ({ ...x, _kind: 'channel' })),
  ];
  for (const src of rows) {
    const form = h(doc, 'form', 'pl-config-form');
    if (src._kind === 'channel') {
      form.dataset.channelId = src.id || '';
      form.appendChild(h(doc, 'div', 'pl-config-h', `${src.displayName || src.id} (${src.platform || 'chat'} channel)`));
    } else {
      form.dataset.sourceId = src.id || '';
    }
    for (const f of src.schema || []) {
      const field = h(doc, 'div', 'field');
      field.appendChild(h(doc, 'label', '', f.label || f.key));
      let input;
      const val = (src.values || {})[f.key];
      if (f.type === 'select') {
        input = h(doc, 'select', 'select');
        for (const o of f.options || []) {
          const opt = h(doc, 'option', '', typeof o === 'object' ? (o.label ?? o.value) : String(o));
          opt.value = typeof o === 'object' ? String(o.value) : String(o);
          input.appendChild(opt);
        }
        if (typeof val === 'string') input.value = val;
      } else if (f.secret) {
        input = h(doc, 'input', 'input');
        input.type = 'password';
        input.value = '';
        if (val && val.set === true) { input.placeholder = '(set)'; input.dataset.set = '1'; }
      } else {
        input = h(doc, 'input', 'input');
        input.type = 'text';
        input.value = typeof val === 'string' ? val : (f.default != null ? String(f.default) : '');
      }
      input.dataset.key = f.key;
      if (f.required) input.dataset.required = '1';
      field.appendChild(input);
      if (f.help) field.appendChild(h(doc, 'small', 'hint', f.help));
      form.appendChild(field);
    }
    root.appendChild(form);
  }
  return root;
}

// collectConfigForm(formEl) -> { sourceId | channelId, values }. An untouched
// {set:true} secret (data-set="1", still empty) is OMITTED — saving never
// wipes a secret. Channel forms carry data-channel-id instead of data-source-id.
export function collectConfigForm(formEl) {
  const values = {};
  for (const input of formEl.querySelectorAll('[data-key]')) {
    if (input.dataset.set === '1' && input.value === '') continue;
    values[input.dataset.key] = input.value;
  }
  if (formEl.dataset.channelId) return { channelId: formEl.dataset.channelId, values };
  return { sourceId: formEl.dataset.sourceId || '', values };
}

// renderDoctorReport(report: {ok, checks:[{id,ok,detail}]}) — row per check.
export function renderDoctorReport(report, { doc = globalThis.document } = {}) {
  const r = report || {};
  const root = h(doc, 'div', 'pl-doctor-report');
  root.appendChild(h(doc, 'div', `badge ${r.ok ? 'green' : 'red'}`, r.ok ? 'healthy' : 'problems found'));
  for (const c of r.checks || []) {
    const row = h(doc, 'div', 'pl-doc-row');
    row.appendChild(h(doc, 'span', `badge ${c.ok ? 'green' : 'red'}`, c.ok ? 'ok' : 'fail'));
    row.appendChild(h(doc, 'span', 'mono', c.id));
    if (c.detail) row.appendChild(h(doc, 'span', 'hint', c.detail));
    root.appendChild(row);
  }
  return root;
}

// renderReferences409(refs) — uninstall guard: who still references the plugin.
export function renderReferences409(refs, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-refs');
  root.appendChild(h(doc, 'p', 'hint err', 'Cannot uninstall: still referenced by'));
  const ul = h(doc, 'ul', 'pl-refs-list');
  for (const ref of refs || []) {
    let text;
    if (typeof ref === 'string') {
      text = ref;
    } else if (Array.isArray(ref.nodes) || Array.isArray(ref.steps)) {
      // A model-guard reference (design §9.4): { id, steps, nodes }.
      const count = (ref.nodes || []).length + (ref.steps || []).length;
      text = `model: ${ref.id} (${count} pipeline selection${count === 1 ? '' : 's'})`;
    } else {
      text = `${ref.type || 'workflow'}: ${ref.name || ref.id || JSON.stringify(ref)}`;
    }
    ul.appendChild(h(doc, 'li', 'mono', text));
  }
  root.appendChild(ul);
  return root;
}

// relTime(iso) -> "just now"/"5m ago"/"3h ago"/"2d ago"/ISO date fallback. Pure,
// jsdom-safe (tests pass a fixed `now`). Exported for reuse + unit tests (C4).
export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso || 'unknown');
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return String(iso).slice(0, 10);
}

// renderAvailableList(marketplaces) -> <div.pl-available> of installable cards
// across every marketplace snapshot (GET /api/marketplaces). Install buttons
// carry data-name + data-marketplace for app.js's delegated listener; installed
// plugins render a badge instead; a never-synced marketplace renders no button
// (there is no sha to pin yet — Refresh first).
export function renderAvailableList(marketplaces, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-available');
  const mkts = marketplaces || [];
  let cards = 0;
  for (const m of mkts) {
    for (const p of m.plugins || []) {
      cards++;
      const card = h(doc, 'section', 'card pl-avail-card');
      card.dataset.name = p.name;
      card.dataset.marketplace = m.id;
      const head = h(doc, 'div', 'pl-head');
      head.appendChild(h(doc, 'b', 'pl-name', p.name));
      head.appendChild(h(doc, 'span', 'pl-version mono', p.version || sha7(m.lastSync && m.lastSync.sha)));
      head.appendChild(h(doc, 'span', 'badge waiting pl-mkt-badge', m.name || m.id));
      if (p.installed) {
        head.appendChild(h(doc, 'span', 'badge green pl-installed', 'Installed'));
      } else if (m.lastSync) {
        const b = h(doc, 'button', 'btn btn-primary btn-mini pl-install-avail', 'Install…');
        b.type = 'button';
        b.dataset.name = p.name;
        b.dataset.marketplace = m.id;
        head.appendChild(b);
      }
      card.appendChild(head);
      if (p.description) card.appendChild(h(doc, 'small', 'hint', p.description));
      card.appendChild(h(doc, 'small', 'pl-avail-src hint mono', m.url)); // C10: unspoofable source url
      root.appendChild(card);
    }
  }
  if (!mkts.length) root.appendChild(h(doc, 'div', 'hist-empty', 'No marketplaces yet — add one below.'));
  else if (!cards) root.appendChild(h(doc, 'div', 'hist-empty', 'No plugins discovered in your marketplaces.'));
  return root;
}

// renderMarketplaceList(marketplaces) -> <div.pl-mkts> of registry rows with
// Refresh/Remove buttons (data-id). Sync failures surface as .pl-mkt-warning
// lines; the snapshot stays usable (stale) per spec §4.6.
export function renderMarketplaceList(marketplaces, { doc = globalThis.document, now = Date.now() } = {}) {
  const root = h(doc, 'div', 'pl-mkts');
  for (const m of marketplaces || []) {
    const row = h(doc, 'div', 'card pl-mkt-row');
    row.dataset.id = m.id;
    const head = h(doc, 'div', 'pl-head');
    head.appendChild(h(doc, 'b', 'pl-name', m.name || m.id));
    if (m.builtin) head.appendChild(h(doc, 'span', 'badge waiting pl-mkt-builtin', 'built-in'));
    for (const [cls, label] of [['pl-mkt-refresh', 'Refresh'], ['pl-mkt-remove', 'Remove']]) {
      const b = h(doc, 'button', `btn-ghost ${cls}`, label);
      b.type = 'button';
      b.dataset.id = m.id;
      head.appendChild(b);
    }
    row.appendChild(head);
    row.appendChild(h(doc, 'small', 'pl-mkt-url hint mono', m.url));
    const n = (m.plugins || []).length;
    row.appendChild(h(doc, 'small', 'pl-mkt-sync hint', m.lastSync
      ? `${sha7(m.lastSync.sha)} · synced ${relTime(m.lastSync.at, now)} · ${n} plugin${n === 1 ? '' : 's'}`
      : 'never synced — refresh to discover plugins'));
    for (const w of m.warnings || []) row.appendChild(h(doc, 'div', 'pl-mkt-warning hint err', w));
    root.appendChild(row);
  }
  if (!(marketplaces || []).length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'No marketplaces registered.'));
  }
  return root;
}
