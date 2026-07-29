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
    [n(c && c.skills), 'skill'], [n(c && c.workflows), 'workflow'],
  ].filter(([k]) => k > 0).map(([k, w]) => `${k} ${w}${k > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'no contributions';
}

// renderPluginList(plugins) -> <div.pl-list> of cards. Action buttons + the
// enable checkbox carry data-name and a pl-* class so app.js can wire ONE
// delegated listener on the list container.
export function renderPluginList(plugins, { doc = globalThis.document } = {}) {
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
    root.appendChild(h(doc, 'div', 'hist-empty', 'No plugins installed. Add a GitHub repo to get started.'));
  }
  return root;
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
// entry: { name, repoUrl, sha } (a /api/plugins/repo discovery row + repo/sha);
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

// renderConfigForm(sources: [{id, schema, values}]) — one <form.pl-config-form>
// per task source. secret:true fields (text-only per normalizeManifest) render
// type=password, NEVER prefilled; a stored value arrives redacted as {set:true}
// -> placeholder '(set)' + data-set="1" so collect can skip it untouched.
export function renderConfigForm(sources, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-config');
  for (const src of sources || []) {
    const form = h(doc, 'form', 'pl-config-form');
    form.dataset.sourceId = src.id || '';
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

// collectConfigForm(formEl) -> { sourceId, values }. An untouched {set:true}
// secret (data-set="1", still empty) is OMITTED — saving never wipes a secret.
export function collectConfigForm(formEl) {
  const values = {};
  for (const input of formEl.querySelectorAll('[data-key]')) {
    if (input.dataset.set === '1' && input.value === '') continue;
    values[input.dataset.key] = input.value;
  }
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
    const text = typeof ref === 'string' ? ref
      : `${ref.type || 'workflow'}: ${ref.name || ref.id || JSON.stringify(ref)}`;
    ul.appendChild(h(doc, 'li', 'mono', text));
  }
  root.appendChild(ul);
  return root;
}
