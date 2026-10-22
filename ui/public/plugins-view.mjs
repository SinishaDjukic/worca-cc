// ui/public/plugins-view.mjs
// Pure DOM renderers for the Plugins view. Every function takes the target
// `document` via opts (defaults to the browser global) and returns DETACHED
// elements — no fetch, no listeners outside the returned tree. app.js owns
// endpoint calls, the modal shell, and mounting; node:test drives these via jsdom.

import { engineLabel } from '../../src/shared/engine-switch.mjs';
function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const sha7 = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : '');

/** The `Needs git` chip (U17: a chip inside the action's own dialog, never a wash): a source off GitHub, no git here. */
export function renderNeedsGit(doc = globalThis.document) {
  return h(doc, 'span', 'badge waiting pl-needs-git', 'Needs git');
}

// The live channel chip (board 3.1; also the install sheet's Done chip): onChannelStatus replaces it by
// key and recovers the name from the text before ' · '. The classes are P3's chip (SM19), written out so
// plugins-view.mjs does not import the marketplace modules.
const CHANNEL_TONE = { connected: 'ok', degraded: 'warn', failed: 'bad' };
export function channelBadge(doc, c) {
  const b = h(doc, 'span', `badge mk-chip mk-chip-${CHANNEL_TONE[c.state] || 'off'} pl-channel`);
  const dot = h(doc, 'span', 'mk-live-dot');
  dot.setAttribute('aria-hidden', 'true');
  b.append(dot, doc.createTextNode(`${c.displayName || c.channelId} · ${c.state}`));
  b.dataset.channelKey = `${c.plugin}/${c.channelId}`;
  if (c.detail) b.title = c.detail;
  return b;
}

// renderInstallConsent(entry, inventory) — spec §6.1 "Will install" ceremony.
// entry: { name, repoUrl, sha } (a marketplace snapshot plugin + the marketplace's url/lastSync.sha);
// inventory: buildInstallInventory shape. Secrets render red; setup commands verbatim.
export function renderInstallConsent(entry, inventory, { doc = globalThis.document, needsGit = false } = {}) {
  const inv = inventory || {};
  const root = h(doc, 'div', 'pl-consent');
  const src = root.appendChild(h(doc, 'div', 'pl-consent-src mono', `${entry.repoUrl} @ ${sha7(entry.sha)}`));
  if (needsGit) src.append(' ', renderNeedsGit(doc));
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
    // Ask forms (spec §10): how many question forms this agent can put on
    // screen, and which file types they may display from the run folder. An
    // older snapshot has neither key, so both are read defensively.
    const forms = Array.isArray(a.forms) ? a.forms : [];
    if (forms.length) {
      const types = Array.isArray(a.fileTypes) ? a.fileTypes : [];
      agents.appendChild(h(doc, 'div', 'pl-consent-row pl-consent-forms',
        `${forms.length} form${forms.length === 1 ? '' : 's'}: ${forms.join(', ')}`
        + (types.length ? ` · may display ${types.join(', ')} from the run folder` : '')));
    }
  }
  if ((inv.scripts || []).length) {
    const scripts = section(`Scripts (${inv.scripts.length})`);
    for (const s of inv.scripts) {
      scripts.appendChild(h(doc, 'div', 'pl-consent-row mono',
        `${s.key} — ${s.runtime}${s.command ? ` · ${s.command}` : s.file ? ` · ${s.file}` : ''}`
        + `${s.cases ? ` · ${s.cases} case${s.cases === 1 ? '' : 's'}` : ''}`));
    }
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
      if (m.engine && m.engine !== 'claude') row.appendChild(h(doc, 'span', 'badge blue pl-engine', engineLabel(m.engine)));
      if (m.baseUrl) row.appendChild(h(doc, 'span', 'pl-secret pl-baseurl', ` routes to: ${m.baseUrl}`));
      if ((m.envKeys || []).length) row.appendChild(h(doc, 'small', 'hint', ` env: ${m.envKeys.join(', ')}`));
      models.appendChild(row);
    }
    for (const s of inv.modelSecrets || []) {
      models.appendChild(h(doc, 'div', 'pl-consent-row')).appendChild(
        h(doc, 'span', 'pl-secret', `requests model secret: ${s.key}${s.label && s.label !== s.key ? ` (${s.label})` : ''}`));
    }
  }
  // MCP servers (MCP registry §4.1): a snapshot persisted before API 5 has no
  // key at all — that is "unknown", never "none".
  if (!Array.isArray(inv.mcpServers)) section('MCP servers: unknown — refresh the marketplace');
  else if (inv.mcpServers.length) {
    const mcp = section(`MCP servers (${inv.mcpServers.length})`);
    for (const s of inv.mcpServers) {
      mcp.appendChild(h(doc, 'div', 'pl-consent-row mono', `${s.name} (${s.type}) — ${s.command || s.url}`));
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
// Also takes the route's body as app.js passes it: POST /api/plugins/:name/update
// answers `{ preview }`.
export function renderUpdatePreview(preview, { doc = globalThis.document } = {}) {
  const p = (preview && preview.preview) || preview || {};
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
    ...(d.newChannelSecrets || []).map((k) => ['pl-delta-secret', `NEW CHAT SECRET requested: ${k}`]),
    ...(d.newTaskSources || []).map((s) => ['pl-delta', `new task source: ${s}`]),
    ...(d.newChatChannels || []).map((s) => ['pl-delta', `new chat channel: ${s}`]),
    ...(d.newAgents || []).map((a) => ['pl-delta', `new agent: ${a}`]),
    ...(d.setupChanged ? [['pl-delta', 'setup commands changed']] : []),
    // Model delta (design §9.4): an env change can silently reroute API traffic
    // — red-flag it like a new secret.
    ...(d.envChangedModels || []).map((m) => ['pl-delta-secret', `MODEL ENV CHANGED (check its base URL): ${m}`]),
    ...(d.newModelSecrets || []).map((k) => ['pl-delta-secret', `NEW MODEL SECRET requested: ${k}`]),
    ...(d.newModels || []).map((m) => ['pl-delta', `new model: ${m}`]),
    ...(d.removedModels || []).map((m) => ['pl-delta', `removed model: ${m}`]),
    // MCP servers (registry §4.6) and skills (skills registry §5): lines built server-side, where the sets are known.
    ...(d.mcpLines || []).map((l) => [l.red ? 'pl-delta-secret' : 'pl-delta', l.text]),
    ...(d.skillLines || []).map((l) => [l.red ? 'pl-delta-secret' : 'pl-delta', l.text]),
  ];
  if (flags.length) {
    const box = h(doc, 'div', 'pl-manifest-delta');
    for (const [cls, text] of flags) box.appendChild(h(doc, 'div', cls, text));
    root.appendChild(box);
  }
  const btn = h(doc, 'button', 'btn btn-primary btn-sm pl-confirm-update', 'Apply update');
  btn.type = 'button';
  root.appendChild(btn);
  return root;
}

// The roster row for a multiProfile source: which configuration is being
// edited, plus add/remove. app.js owns the actions (each is a server round trip
// that re-opens the pane), so this only renders the controls and marks them.
function profileBar(doc, src) {
  const bar = h(doc, 'div', 'pl-profile-bar');
  bar.dataset.sourceId = src.id || '';
  bar.appendChild(h(doc, 'label', '', 'Profile'));
  const sel = h(doc, 'select', 'select pl-profile-sel');
  sel.dataset.sourceId = src.id || '';
  for (const p of src.profiles || []) {
    const id = typeof p === 'string' ? p : String(p.id || '');
    const label = typeof p === 'string' ? '' : (p.label || '');
    const opt = h(doc, 'option', '', label ? `${label} (${id})` : id);
    opt.value = id;
    sel.appendChild(opt);
  }
  if (src.profile) sel.value = src.profile;
  if (!(src.profiles || []).length) sel.disabled = true;
  bar.appendChild(sel);
  const add = h(doc, 'button', 'btn btn-sm pl-profile-add', 'Add');
  add.type = 'button';
  add.dataset.sourceId = src.id || '';
  bar.appendChild(add);
  const del = h(doc, 'button', 'btn btn-sm pl-profile-del', 'Remove');
  del.type = 'button';
  del.dataset.sourceId = src.id || '';
  if (!src.profile) del.disabled = true;
  bar.appendChild(del);
  return bar;
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
    // A multiProfile source is a ROSTER of configurations, not one form: the
    // bar picks which profile the form below edits. Rendered before the form so
    // "which instance am I editing" is answered above the fields, not after.
    if (src._kind === 'source' && src.multiProfile) {
      root.appendChild(profileBar(doc, src));
      // Nothing to write into: creating the profile is a separate call, and the
      // server rejects a save without one. Offer the add button, not a form.
      if (!src.profile) {
        root.appendChild(h(doc, 'p', 'hint', 'No profiles yet — add one to configure this source.'));
        continue;
      }
    }
    const form = h(doc, 'form', 'pl-config-form');
    if (src._kind === 'channel') {
      form.dataset.channelId = src.id || '';
      form.appendChild(h(doc, 'div', 'pl-config-h', `${src.displayName || src.id} (${src.platform || 'chat'} channel)`));
    } else {
      form.dataset.sourceId = src.id || '';
      if (src.multiProfile) form.dataset.profile = src.profile;
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

// collectConfigForm(formEl) -> { sourceId | channelId, values } (+ profile for
// a multiProfile source; the key is ABSENT otherwise, so a single-profile save
// stays byte-identical to what it sent before profiles existed). An untouched
// {set:true} secret (data-set="1", still empty) is OMITTED — saving never
// wipes a secret. Channel forms carry data-channel-id instead of data-source-id.
export function collectConfigForm(formEl) {
  const values = {};
  for (const input of formEl.querySelectorAll('[data-key]')) {
    if (input.dataset.set === '1' && input.value === '') continue;
    values[input.dataset.key] = input.value;
  }
  if (formEl.dataset.channelId) return { channelId: formEl.dataset.channelId, values };
  const out = { sourceId: formEl.dataset.sourceId || '', values };
  if (formEl.dataset.profile) out.profile = formEl.dataset.profile;
  return out;
}

// renderConnectResult(result) — outcome of a source's validateConfig, rendered
// under the settings form. Three states, because setup can legitimately be
// mid-flight: connected (ok), waiting (ok:false + pending — the caller keeps
// polling), or failed (ok:false + errors[], each pinned to its config field).
// A connector may return no envelope at all on a transport error; `result`
// then carries { error: { kind, message } } from the /api/sources/call frame.
export function renderConnectResult(result, { doc = globalThis.document } = {}) {
  const r = result || {};
  const root = h(doc, 'div', 'pl-connect-result');
  if (r.ok) {
    root.appendChild(h(doc, 'div', 'badge green', 'connected'));
    if (r.identity) root.appendChild(h(doc, 'span', 'hint', `signed in as ${r.identity}`));
    // Which server/project the connector actually resolved — a mistyped sample
    // URL otherwise connects successfully to the wrong instance.
    if (r.instance && r.instance.baseUrl) {
      const where = r.instance.project ? `${r.instance.baseUrl} · ${r.instance.project}` : r.instance.baseUrl;
      root.appendChild(h(doc, 'div', 'hint mono', where));
    }
    return root;
  }
  if (r.pending) {
    root.appendChild(h(doc, 'div', 'badge', 'waiting'));
    root.appendChild(h(doc, 'span', 'hint', r.message || 'Waiting…'));
    return root;
  }
  root.appendChild(h(doc, 'div', 'badge red', 'not connected'));
  const errors = Array.isArray(r.errors) && r.errors.length
    ? r.errors
    : [{ message: (r.error && r.error.message) || r.message || 'connection failed' }];
  for (const e of errors) {
    const row = h(doc, 'div', 'pl-connect-err');
    if (e.field) row.appendChild(h(doc, 'span', 'mono', e.field));
    row.appendChild(h(doc, 'span', 'hint err', e.message || ''));
    root.appendChild(row);
  }
  return root;
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
