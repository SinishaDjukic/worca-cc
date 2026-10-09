// ui/public/models-view.mjs
// Pure DOM renderers for the Models view (configurable-models-design.md §4.10).
// Mirrors guardrails-view.mjs: every function takes `doc` via opts (defaults to
// the browser global) and returns DETACHED elements — no fetch, no listeners
// outside the returned tree. app.js owns endpoint calls and mounting.
// Interactive elements carry data-id + a routing class (mv-edit, mv-delete,
// mv-promote, mv-save, mv-cancel, mv-env-add, mv-env-rm) so app.js wires ONE
// delegated listener on the list container.

import { bridgedBadge, needsSignInPill, degradationLine, renderConnectionSection, collectConnection, applyConnectionMode } from './bridge-view.mjs';
import { credentialBadge } from './credential-badges.mjs';
import { engineLabel, engineChoiceLabel, isBetaEngine, MODEL_ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';
import { harnessesOf, runsOn, suggestModelHandle } from '../../src/shared/connections.mjs';

/** The sign-in choices of the model editor: which subscription, in the harness that holds it. */
const SIGNIN_CHOICES = { claude: 'Claude Code — your Claude login', codex: 'Codex — your ChatGPT sign-in', cursor: 'Cursor — your Cursor sign-in' };

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** "medium · high" or "all efforts" (the full set carries no signal). */
/** Credential broker: "your key / no key" for the signed-in person, after a model's name. */
function keyBadge(parent, m, doc) {
  const b = credentialBadge(m.id);
  if (!b) return;
  const el = h(doc, 'span', `badge ${b.tone} mv-key-badge`, b.text);
  el.title = b.title;
  parent.appendChild(el);
}

export function effortsSummary(efforts, allEfforts) {
  const list = Array.isArray(efforts) ? efforts : [];
  if (!list.length || (allEfforts && list.length === allEfforts.length)) return 'all efforts';
  return list.join(' · ');
}

/** "2 env vars · routes via base URL" | "1 env var" | '' (none). */
export function envSummary(env) {
  const keys = Object.keys(env || {});
  if (!keys.length) return '';
  const n = `${keys.length} env var${keys.length === 1 ? '' : 's'}`;
  return keys.includes('ANTHROPIC_BASE_URL') ? `${n} · routes via base URL` : n;
}

/** The per-Mtok rate keys, in editor order, with their display labels. Mirrors
 *  settings.mjs COST_RATE_KEYS — the server is the validator, this is the form. */
export const COST_RATES = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write (5m)'],
  ['cacheWrite1h', 'Cache write (1h)'],
];

/** One-line pricing summary for a card, or '' when the model has no override
 *  (the overwhelming default — the CLI's own figure is trusted). */
export function costSummary(cost) {
  if (!cost || typeof cost !== 'object') return '';
  if (cost.free) return 'priced free';
  const p = cost.perMtok;
  if (!p || typeof p !== 'object') return '';
  const set = COST_RATES.filter(([k]) => p[k] != null);
  if (!set.length) return '';
  return `${set.map(([k, lab]) => `${lab.toLowerCase()} $${p[k]}`).join(' · ')} /Mtok`;
}

/**
 * A free id for a duplicate of `id`: `<id>-copy`, then `-copy-2`, `-copy-3`…
 * Compared case-insensitively against EVERY id the catalog knows (global,
 * plugin, built-in, legacy) — the add would be rejected for colliding with any
 * of them, and a suggestion the server refuses is worse than no suggestion.
 * @param {string} id  the source model's id
 * @param {Iterable<string>} takenIds
 * @returns {string}
 */
export function suggestDuplicateId(id, takenIds = []) {
  const taken = new Set([...takenIds].map((t) => String(t).toLowerCase()));
  const base = `${id}-copy`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const c = `${base}-${n}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return base; // 998 copies of one model: let the server reject the duplicate
}

/**
 * The Models view body: global entries (editable), the selected project's
 * legacy custom models (promotable), and the built-in catalog (read-only).
 * `globals` come MASKED from GET /api/models. `predefinedShadowedIds` marks
 * built-ins currently overridden by a global entry.
 */
/**
 * The catalog. `query` / `filter` narrow it and `collapsed` folds a group away: with the built-ins,
 * a plugin's models and a team policy's all listed at once the page ran to several screens, and the
 * entry you came for was never the one on top.
 * @param {{query?:string, filter?:string, collapsed?:object, highlight?:string[]}} [o]
 */
export function renderModelsList({ globals = [], legacy = [], plugins = [], policy = [], predefined = [], codex = [], codexEfforts = [], cursorEfforts = [], efforts = [], hideBuiltin = false, projectName = '', query = '', filter = 'all', collapsed = {}, highlight = [] } = {}, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'mv-list');
  const predefLc = new Set(predefined.map((m) => m.id.toLowerCase()));
  const pluginLc = new Set(plugins.map((m) => m.id.toLowerCase()));
  const codexLc = new Set(codex.map((m) => m.id.toLowerCase()));
  // A model names the harnesses that run it (src/shared/connections.mjs) when that is not Claude Code alone; its
  // efforts are its own engine's.
  const engineBadge = (m) => {
    const hs = harnessesOf(m);
    if (hs.length === 1 && hs[0] === 'claude') return null;
    const b = h(doc, 'span', 'badge blue mv-engine', hs.map(engineLabel).join(' · '));
    b.title = `Runs on ${hs.map(engineLabel).join(' and ')}`;
    return b;
  };
  const effortsOf = (m) => effortsSummary(m.efforts, ({ claude: efforts, codex: codexEfforts, cursor: cursorEfforts })[m.engine || 'claude'] || efforts);
  const q = String(query || '').trim().toLowerCase();
  const hi = new Set((highlight || []).map((x) => String(x).toLowerCase()));
  const searching = !!q || filter !== 'all';

  /** Does this entry survive the search box and the chip? */
  const keep = (m, source) => {
    if (filter === 'imported' && !hi.has(String(m.id).toLowerCase())) return false;
    if (filter === 'needs-setup' && !m.needsSignIn) return false;
    // "Codex": every model Codex can run, whichever group it sits in (its built-ins, an endpoint model of yours).
    if (filter === 'codex') { if (!runsOn(m, 'codex')) return false; } else if (!['all', 'imported', 'needs-setup'].includes(filter) && filter !== source) return false;
    if (!q) return true;
    return [m.id, m.label, m.plugin, m.home, m.upstream && m.upstream.model].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  };

  // Each group can fold: the header is the control, and its count is the answer to "is my model
  // in there?" without opening it.
  const sections = [];
  const section = (title, hint, key = '') => {
    const s = h(doc, 'div', 'mv-section');
    s.dataset.section = key;
    const head = h(doc, 'div', 'mv-section-head');
    const btn = h(doc, 'button', 'mv-sec-toggle');
    btn.type = 'button';
    btn.dataset.section = key;
    // The shared disclosure chevron (style.css .adv-chev), turned down while the group is open.
    const caret = h(doc, 'span', 'mv-sec-caret adv-chev');
    caret.setAttribute('aria-hidden', 'true');
    btn.appendChild(caret);
    btn.appendChild(h(doc, 'h3', 'mv-section-title', title));
    btn.appendChild(h(doc, 'span', 'mv-sec-count', ''));
    head.appendChild(btn);
    s.appendChild(head);
    if (hint) s.appendChild(h(doc, 'small', 'hint mv-sec-hint', hint));
    const body = h(doc, 'div', 'mv-sec-body');
    s.appendChild(body);
    // Searching opens every group that still has a hit — a match hidden inside a fold is a bug.
    const folded = !searching && !!collapsed[key];
    s.classList.toggle('is-folded', folded);
    btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
    sections.push({ el: s, body, btn, key });
    // The rows go into the body; every caller appends to the section, so proxy it.
    s.appendChild = (node) => body.appendChild(node);
    return s;
  };

  // The endpoint-routed badge (#422): honest disclosure that worca points the
  // CLI's internal haiku/sonnet/opus/fable lookups at this model's own id
  // (config.mjs#resolveModelEnv), so nothing falls back to the Anthropic API.
  // The masked env still carries its KEYS, so presence is decidable here.
  const routedBadge = (m) => {
    if (!m.env || !Object.prototype.hasOwnProperty.call(m.env, 'ANTHROPIC_BASE_URL')) return null;
    const b = h(doc, 'span', 'badge waiting mv-routed', 'endpoint-routed');
    b.title = "worca points Claude Code's internal haiku/sonnet/opus/fable lookups at this model, so it never falls back to the Anthropic API.";
    return b;
  };

  // ── Toolbar: search + the chip that says which layer you are looking at ──
  const bar = h(doc, 'div', 'mv-toolbar');
  const search = h(doc, 'input', 'input mv-search');
  search.type = 'search';
  search.placeholder = 'Search models by id, label or upstream…';
  search.value = query || '';
  search.setAttribute('aria-label', 'Search models');
  bar.appendChild(search);
  const chips = h(doc, 'div', 'mv-filters');
  const CHIPS = [['all', 'All'], ['global', 'Yours'], ['builtin', 'Built-in'], ['codex', 'Codex'], ['plugin', 'Plugin'], ['policy', 'Team'], ['needs-setup', 'Needs setup']];
  if (highlight.length) CHIPS.push(['imported', 'Just imported']);
  for (const [id, label] of CHIPS) {
    const c = h(doc, 'button', `mv-filter${filter === id ? ' on' : ''}`, label);
    c.type = 'button'; c.dataset.filter = id;
    c.setAttribute('aria-pressed', filter === id ? 'true' : 'false');
    chips.appendChild(c);
  }
  bar.appendChild(chips);
  root.appendChild(bar);

  // ── Hide built-in models (#422) — one checkbox, top of the pane ──
  const hideRow = h(doc, 'div', 'mv-hide-builtin-row');
  const hideLabel = h(doc, 'label', 'check-row');
  const hideCb = h(doc, 'input', 'mv-hide-builtin');
  hideCb.type = 'checkbox';
  hideCb.checked = !!hideBuiltin;
  hideLabel.appendChild(hideCb);
  hideLabel.appendChild(doc.createTextNode(" Hide built-in models (you don't use a first-party Anthropic account)"));
  hideRow.appendChild(hideLabel);
  hideRow.appendChild(h(doc, 'small', 'hint',
    'Drops the built-ins from every model picker — New run, the composer, Ask Worca, title generation. Cosmetic only: a run or reference that already names one keeps working.'));
  root.appendChild(hideRow);

  // ── Your models (global) ──
  const yours = section('Your models', 'Defined once, available in every project. An entry with a built-in id overrides that built-in.', 'global');
  if (!globals.length) {
    yours.appendChild(h(doc, 'div', 'hist-empty', 'No global models yet — Add model to define one.'));
  }
  for (const m of globals.filter((x) => keep(x, 'global'))) {
    const card = h(doc, 'section', 'card mv-card');
    card.dataset.id = m.id;
    const body = h(doc, 'div', 'mv-body');
    const head = h(doc, 'div', 'mv-head');
    head.appendChild(h(doc, 'b', 'mv-name', m.label || m.id));
    keyBadge(head, m, doc);
    const eb = engineBadge(m); if (eb) head.appendChild(eb);
    if (predefLc.has(m.id.toLowerCase()) || (m.engine === 'codex' && codexLc.has(m.id.toLowerCase()))) head.appendChild(h(doc, 'span', 'badge violet mv-shadow', 'overrides built-in'));
    else if (pluginLc.has(m.id.toLowerCase())) head.appendChild(h(doc, 'span', 'badge violet mv-shadow', 'overrides plugin'));
    const rb = routedBadge(m);
    if (rb) head.appendChild(rb);
    // Model bridge (model-bridge-design.md §8.5): the provider badge, and the
    // blocking "needs sign-in" pill when that provider is not usable yet.
    const bb = bridgedBadge(m, { doc });
    if (bb) head.appendChild(bb);
    const ns = needsSignInPill(m, { doc });
    if (ns) head.appendChild(ns);
    // The §4.6 "unreliable" badge is meaningless once an override GOVERNS this
    // model's spend — and the backend only lifts the stored flag on the model's
    // next result event, so suppress it here the moment pricing is pinned.
    if (m.costUnreliable && !m.cost) head.appendChild(h(doc, 'span', 'badge waiting mv-cost', 'cost not verified'));
    if (m.cost) head.appendChild(h(doc, 'span', 'badge violet mv-cost-pinned', m.cost.free ? 'free' : 'priced'));
    body.appendChild(head);
    const bits = [m.id, effortsOf(m), m.upstream ? `→ ${m.upstream.model}` : '', envSummary(m.env), costSummary(m.cost)].filter(Boolean);
    body.appendChild(h(doc, 'small', 'mv-summary hint', bits.join(' — ')));
    const deg = degradationLine(m);
    if (deg) body.appendChild(h(doc, 'small', 'mv-degradation hint', deg));
    body.appendChild(h(doc, 'small', 'mv-test-result hint')); // app.js paints the Test outcome here
    card.appendChild(body);
    const del = h(doc, 'button', 'btn-ghost mv-delete', 'Delete');
    del.type = 'button'; del.dataset.id = m.id;
    card.appendChild(del);
    const edit = h(doc, 'button', 'btn-ghost mv-edit', 'Edit');
    edit.type = 'button'; edit.dataset.id = m.id;
    card.appendChild(edit);
    // Duplicate opens a CREATE editor seeded from this entry (app.js fetches the
    // raw env values first — the card only ever holds masked ones). The point is
    // deriving a sibling: same routing, one parameter changed.
    const dup = h(doc, 'button', 'btn-ghost mv-duplicate', 'Duplicate');
    dup.type = 'button'; dup.dataset.id = m.id;
    card.appendChild(dup);
    const tst = h(doc, 'button', 'btn-ghost mv-test', 'Test');
    tst.type = 'button'; tst.dataset.id = m.id;
    card.appendChild(tst);
    yours.appendChild(card);
  }
  root.appendChild(yours);

  // ── Legacy per-project models (promotable) ──
  if (legacy.length) {
    const leg = section(
      `Project models${projectName ? ` — ${projectName}` : ''} (legacy)`,
      'Defined only for this project. Promote to make them global; the id keeps working everywhere it is referenced.'
    );
    for (const m of legacy) {
      const card = h(doc, 'section', 'card mv-card mv-legacy');
      card.dataset.id = m.id;
      const body = h(doc, 'div', 'mv-body');
      const head = h(doc, 'div', 'mv-head');
      head.appendChild(h(doc, 'b', 'mv-name', m.label || m.id));
    keyBadge(head, m, doc);
      head.appendChild(h(doc, 'span', 'badge waiting mv-origin', 'project (legacy)'));
      body.appendChild(head);
      body.appendChild(h(doc, 'small', 'mv-summary hint', m.id));
      card.appendChild(body);
      const promote = h(doc, 'button', 'btn-ghost mv-promote', 'Promote to global');
      promote.type = 'button'; promote.dataset.id = m.id;
      card.appendChild(promote);
      leg.appendChild(card);
    }
    root.appendChild(leg);
  }

  // ── From plugins (read-only; design §9.6) ──
  const globalLc = new Set(globals.map((m) => m.id.toLowerCase()));
  if (plugins.length) {
    const plug = section('From plugins',
      'Installed by plugins — read-only and updated with the plugin. "Edit a copy" clones one into Your models, which then overrides it.', 'plugin');
    for (const m of plugins.filter((x) => keep(x, 'plugin'))) {
      const card = h(doc, 'section', 'card mv-card mv-plugin');
      card.dataset.id = m.id;
      card.dataset.plugin = m.plugin;
      const body = h(doc, 'div', 'mv-body');
      const head = h(doc, 'div', 'mv-head');
      head.appendChild(h(doc, 'b', 'mv-name', m.label || m.id));
    keyBadge(head, m, doc);
      const peb = engineBadge(m); if (peb) head.appendChild(peb);
      head.appendChild(h(doc, 'span', 'badge waiting mv-origin', `plugin: ${m.plugin}`));
      if (globalLc.has(m.id.toLowerCase())) head.appendChild(h(doc, 'span', 'badge violet mv-shadowed', 'overridden by your copy'));
      const prb = routedBadge(m);
      if (prb) head.appendChild(prb);
      const pbb = bridgedBadge(m, { doc });
      if (pbb) head.appendChild(pbb);
      const pns = needsSignInPill(m, { doc });
      if (pns) head.appendChild(pns);
      // Same rule as a global card: a manifest-pinned price governs the spend,
      // so the §4.6 "unreliable" flag says nothing about it.
      if (m.costUnreliable && !m.cost) head.appendChild(h(doc, 'span', 'badge waiting mv-cost', 'cost not verified'));
      if (m.cost) head.appendChild(h(doc, 'span', 'badge violet mv-cost-pinned', m.cost.free ? 'free' : 'priced'));
      body.appendChild(head);
      const bits = [m.id, effortsOf(m), m.upstream ? `→ ${m.upstream.model}` : '', envSummary(m.env), costSummary(m.cost)].filter(Boolean);
      body.appendChild(h(doc, 'small', 'mv-summary hint', bits.join(' — ')));
      const pdeg = degradationLine(m);
      if (pdeg) body.appendChild(h(doc, 'small', 'mv-degradation hint', pdeg));
      for (const s of m.secrets || []) {
        body.appendChild(h(doc, 'small', `mv-secret hint${s.set ? '' : ' err'}`,
          s.set ? `secret ${s.key}: set` : `secret ${s.key}: NOT SET — configure it in the plugin's settings`));
      }
      body.appendChild(h(doc, 'small', 'mv-test-result hint')); // app.js paints the Test outcome here
      card.appendChild(body);
      const copy = h(doc, 'button', 'btn-ghost mv-copy', 'Edit a copy');
      copy.type = 'button'; copy.dataset.id = m.id; copy.dataset.plugin = m.plugin;
      card.appendChild(copy);
      const tst = h(doc, 'button', 'btn-ghost mv-test', 'Test');
      tst.type = 'button'; tst.dataset.id = m.id; tst.dataset.plugin = m.plugin;
      if ((m.secrets || []).some((s) => !s.set)) {
        // A test would only prove what the NOT SET line already says.
        tst.disabled = true;
        tst.title = 'set the plugin secret first';
      }
      card.appendChild(tst);
      plug.appendChild(card);
    }
    root.appendChild(plug);
  }

  // ── From team policy (read-only; team-policy design §8) ──
  if (policy.length) {
    const pol = section('From team policy',
      'Shipped by a team policy — read-only and updated when the policy changes. Add a model with the same id to Your models to override one on this machine.', 'policy');
    for (const m of policy.filter((x) => keep(x, 'policy'))) {
      const card = h(doc, 'section', 'card mv-card mv-policy');
      card.dataset.id = m.id;
      const body = h(doc, 'div', 'mv-body');
      const head = h(doc, 'div', 'mv-head');
      head.appendChild(h(doc, 'b', 'mv-name', m.label || m.id));
    keyBadge(head, m, doc);
    const teb = engineBadge(m); if (teb) head.appendChild(teb);
      const badge = h(doc, 'span', 'badge blue mv-origin', 'policy');
      badge.title = `Team policy on ${m.home}`;
      head.appendChild(badge);
      if (globalLc.has(m.id.toLowerCase())) head.appendChild(h(doc, 'span', 'badge violet mv-shadowed', 'overridden by your copy'));
      const rb = routedBadge(m);
      if (rb) head.appendChild(rb);
      body.appendChild(head);
      const bits = [m.id, effortsOf(m), envSummary(m.env), m.home ? `policy ${m.home}` : ''].filter(Boolean);
      body.appendChild(h(doc, 'small', 'mv-summary hint', bits.join(' — ')));
      body.appendChild(h(doc, 'small', 'mv-test-result hint'));
      card.appendChild(body);
      const tst = h(doc, 'button', 'btn-ghost mv-test', 'Test');
      tst.type = 'button'; tst.dataset.id = m.id;
      card.appendChild(tst);
      pol.appendChild(card);
    }
    root.appendChild(pol);
  }

  // ── Built-ins (read-only) ──
  const builtins = section('Built-in models', hideBuiltin
    ? `Hidden from every picker (${predefined.length} built-in${predefined.length === 1 ? '' : 's'}) — untick the box above to show them.`
    : 'Shipped with worca. Add a model with the same id to override its label, efforts, or routing.', 'builtin');
  builtins.classList.add(hideBuiltin ? 'mv-builtins-hidden' : 'mv-builtins-shown');
  for (const m of (hideBuiltin ? [] : predefined).filter((x) => keep(x, 'builtin'))) {
    const row = h(doc, 'div', 'mv-builtin');
    row.dataset.id = m.id;
    row.appendChild(h(doc, 'b', 'mv-name', m.label));
    keyBadge(row, m, doc);
    if (globalLc.has(m.id.toLowerCase()) || pluginLc.has(m.id.toLowerCase())) {
      row.appendChild(h(doc, 'span', 'badge violet mv-shadowed', 'overridden'));
    }
    row.appendChild(h(doc, 'small', 'mv-summary hint', `${m.id} — ${effortsSummary(m.efforts, efforts)}`));
    builtins.appendChild(row);
  }
  root.appendChild(builtins);

  // ── Codex built-ins (read-only; §3.1a) ──
  if (codex.length) {
    // One catalog row per id (config.mjs composeCatalog): a global, plugin or team-policy model of
    // EITHER engine with a built-in's id owns that id, so the built-in row says it is overridden.
    const ownedLc = new Set([...globals, ...plugins, ...policy].map((m) => m.id.toLowerCase()));
    const cx = section('Codex built-in models',
      'Shipped with worca for Codex runs. Add a Codex model with the same id to override its label or efforts.', 'codex');
    for (const m of codex.filter((x) => keep(x, 'codex'))) {
      const row = h(doc, 'div', 'mv-builtin mv-codex');
      row.dataset.id = m.id;
      row.appendChild(h(doc, 'b', 'mv-name', m.label));
      if (ownedLc.has(m.id.toLowerCase())) row.appendChild(h(doc, 'span', 'badge violet mv-shadowed', 'overridden'));
      row.appendChild(h(doc, 'small', 'mv-summary hint', `${m.id} — ${effortsSummary(m.efforts, codexEfforts)}`));
      cx.appendChild(row);
    }
    root.appendChild(cx);
  }

  // Counts on every header, and a group with nothing left drops out while a search is on.
  let shown = 0;
  for (const sec of sections) {
    const n = sec.body.querySelectorAll('.mv-card, .mv-builtin').length;
    shown += n;
    sec.btn.querySelector('.mv-sec-count').textContent = String(n);
    if (searching && !n) sec.el.classList.add('hidden');
  }
  if (searching && !shown) {
    root.appendChild(h(doc, 'div', 'hist-empty mv-no-hits', q ? `No model matches “${query}”.` : 'No model in this group.'));
  }
  return root;
}

/** One env key/value editor row. Existing values arrive MASKED; leaving a
 *  masked value untouched means "keep" (the server drops masked echoes).
 *  STORED rows (a key was persisted) also get a copy button that fetches the
 *  RAW value — the user owns it on disk anyway (design note: same trust
 *  boundary as ~/.worca-cc/settings.json, made deliberate by the click). */
function envRow(doc, key = '', value = '') {
  const row = h(doc, 'div', 'mv-env-row');
  const k = h(doc, 'input', 'input mv-env-key');
  k.type = 'text'; k.placeholder = 'ANTHROPIC_BASE_URL'; k.value = key;
  const v = h(doc, 'input', 'input mv-env-val');
  v.type = 'text'; v.placeholder = 'value, or ${VAR} to read your shell env'; v.value = value;
  if (value) v.dataset.original = value; // masked echo detection on collect
  row.appendChild(k); row.appendChild(v);
  if (key) {
    // The STORED key, frozen at render time — the copy must reveal what is on
    // disk even after the user edits the key input.
    row.dataset.key = key;
    const cp = h(doc, 'button', 'btn-ghost mv-env-copy', '⧉');
    cp.type = 'button';
    cp.title = 'Copy the real (unmasked) value';
    row.appendChild(cp);
  }
  const rm = h(doc, 'button', 'btn-ghost mv-env-rm', '✕');
  rm.type = 'button';
  row.appendChild(rm);
  return row;
}

/**
 * The add/edit form. `model` is a MASKED global entry, or null for create.
 * Returns detached DOM; app.js wires mv-save / mv-cancel / mv-env-add /
 * mv-env-rm and calls collectModelEditor on save.
 */
export function renderModelEditor(model, efforts, { doc = globalThis.document, providers = null, copilotModels = [], codexEfforts = ['minimal', 'low', 'medium', 'high'], cursorEfforts = [] } = {}) {
  const editing = !!model;
  const root = h(doc, 'section', 'card mv-editor');
  // Both engines' effort lists ride the root so setModelEngine can swap them (§3.1a).
  root.dataset.effortLists = JSON.stringify({ claude: efforts, codex: codexEfforts, cursor: cursorEfforts });
  const engineNow = editing && MODEL_ENGINE_NAMES.includes(model.engine) ? model.engine : 'claude';
  root.dataset.mode = editing ? 'edit' : 'create';
  if (editing) {
    root.dataset.id = model.id;
    // The stored env keys, so collect can send null (= delete) for rows the
    // user removed — the write-only PATCH can't infer deletions otherwise.
    root.dataset.envKeys = Object.keys(model.env || {}).join('\n');
  }
  root.appendChild(h(doc, 'h3', 'mv-editor-title', editing ? `Edit ${model.label || model.id}` : 'Add model'));

  const grid = h(doc, 'div', 'mv-editor-grid');
  const field = (labelText, input, hint) => {
    const wrap = h(doc, 'label', 'mv-field');
    wrap.appendChild(h(doc, 'span', 'mv-field-label', labelText));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(h(doc, 'small', 'hint', hint));
    return wrap;
  };

  const idInput = h(doc, 'input', 'input mv-id');
  idInput.type = 'text';
  idInput.placeholder = 'claude-opus-4-8, glm-4.7, a fine-tune id…';
  idInput.value = editing ? model.id : '';
  idInput.disabled = editing; // the id IS the reference — delete + re-add to rename
  // Typing an id stops the editor from deriving one from the provider and upstream model (applyConnectionModeIn).
  if (!editing && typeof idInput.addEventListener === 'function') idInput.addEventListener('input', () => { idInput.dataset.auto = 'off'; });
  grid.appendChild(field('Model id (worca’s handle)', idInput,
    editing ? '' : 'What runs and settings name this entry by. A sign-in model uses the model’s own id (a built-in id overrides that built-in); through a provider the id is yours, and the endpoint is sent the upstream model id below.'));

  const labelInput = h(doc, 'input', 'input mv-label');
  labelInput.type = 'text';
  labelInput.placeholder = 'Display name (defaults to the id)';
  labelInput.value = editing ? (model.label === model.id ? '' : model.label) : '';
  grid.appendChild(field('Label', labelInput));
  // ── Connection (model-bridge-design.md §8.3): a harness's sign-in / env / provider ──
  // It decides which harnesses can run the model (src/shared/connections.mjs): a sign-in only its own, routing env
  // Claude Code, a provider Claude Code through the bridge and Codex an OpenAI Responses endpoint directly.
  const connEl = renderConnectionSection(model, { doc, providers, copilotModels });
  if (editing) connEl.dataset.editing = '1';
  grid.appendChild(field('Connection', connEl));
  // Whose subscription a sign-in model runs on — the harness it is bound to. Only the sign-in connection asks;
  // an env or provider entry is stored as Claude Code's (its harnesses follow from the connection).
  const engineSel = h(doc, 'select', 'select mv-engine');
  for (const v of MODEL_ENGINE_NAMES) {
    const o = doc.createElement('option');
    o.value = v; o.textContent = SIGNIN_CHOICES[v] ? `${SIGNIN_CHOICES[v]}${isBetaEngine(v) ? ' (beta)' : ''}` : engineChoiceLabel(v);
    engineSel.appendChild(o);
  }
  engineSel.value = engineNow;
  engineSel.disabled = editing;
  const signinField = field('Sign-in', engineSel, editing
    ? 'Fixed once created — delete the model and add it again to change it.'
    : 'The harness whose sign-in runs this model. A Cursor model takes no effort, and Worca cannot price it.');
  signinField.classList.add('mv-signin-field');
  grid.appendChild(signinField);

  const effWrap = h(doc, 'div', 'mv-efforts');
  const effortList = ({ claude: efforts, codex: codexEfforts, cursor: cursorEfforts })[engineNow] || efforts;
  const selected = new Set(editing && Array.isArray(model.efforts) ? model.efforts : effortList);
  for (const lab of effortBoxes(doc, effortList, selected)) effWrap.appendChild(lab);
  const effField = field('Supported efforts', effWrap, 'All checked = every effort (the default).');
  effField.querySelector('.hint').classList.add('mv-efforts-hint');   // applyConnectionMode rewrites it
  grid.appendChild(effField);

  const envWrap = h(doc, 'div', 'mv-env');
  const rows = editing && model.env ? Object.entries(model.env) : [];
  for (const [k, v] of rows) envWrap.appendChild(envRow(doc, k, v));
  const add = h(doc, 'button', 'btn-ghost mv-env-add', '+ env var');
  add.type = 'button';
  grid.appendChild(field('Routing env (merged into the claude spawn for this model)', envWrap,
    'e.g. ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN. ANTHROPIC_MODEL sets the wire id sent to --model (the id above stays worca’s handle). Stored values show masked; leave masked to keep. WORCA_* and process keys are reserved. Through a provider, the bridge owns ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_MODEL — setting them here is refused.'));
  const envBtns = h(doc, 'div', 'mv-env-btns');
  envBtns.appendChild(add);
  if (rows.length) {
    // Reveal toggle: swaps the masked inputs to the REAL stored values (the
    // user owns them on disk in ~/.worca-cc/settings.json). app.js wires it.
    const reveal = h(doc, 'button', 'btn-ghost mv-env-reveal', 'Show values');
    reveal.type = 'button';
    reveal.title = 'Reveal the real stored values';
    envBtns.appendChild(reveal);
  }
  grid.appendChild(envBtns);

  // ── Pricing (opt-in per-model cost override, config.mjs resolveModelCost) ──
  // The CLI computes total_cost_usd from its OWN table keyed on the model NAME,
  // so an on-prem/proxied endpoint gets a fabricated figure worca cannot tell
  // from a real one. Three mutually exclusive modes; the default is unchanged
  // behavior. Rendered detached like everything else here — app.js wires the
  // mode change to applyCostMode.
  const costWrap = h(doc, 'div', 'mv-cost-edit');
  const modes = h(doc, 'div', 'mv-cost-modes');
  const groupName = `mv-cost-mode-${editing ? model.id : 'new'}`;
  for (const [value, text] of [
    ['cli', 'Trust the CLI'],
    ['free', 'Free ($0)'],
    ['perMtok', 'Per million tokens'],
  ]) {
    const lab = h(doc, 'label', 'mv-cost-mode');
    const rb = h(doc, 'input', 'mv-cost-mode-rb');
    rb.type = 'radio'; rb.name = groupName; rb.value = value;
    lab.appendChild(rb);
    lab.appendChild(h(doc, 'span', null, text));
    modes.appendChild(lab);
  }
  costWrap.appendChild(modes);

  const rates = h(doc, 'div', 'mv-cost-rates');
  for (const [key, labelText] of COST_RATES) {
    const lab = h(doc, 'label', 'mv-cost-rate');
    lab.appendChild(h(doc, 'span', 'mv-cost-rate-label', labelText));
    const inp = h(doc, 'input', 'input mv-cost-rate-in');
    inp.type = 'number'; inp.min = '0'; inp.step = '0.01'; inp.placeholder = '0';
    inp.dataset.rate = key;
    lab.appendChild(inp);
    lab.appendChild(h(doc, 'span', 'mv-cost-rate-unit', '$/Mtok'));
    rates.appendChild(lab);
  }
  costWrap.appendChild(rates);
  grid.appendChild(field('Pricing', costWrap,
    'Only for an endpoint the CLI prices by NAME rather than from what the endpoint reports — an on-prem or proxied model. '
    + 'Trust the CLI is the default and leaves spend exactly as today. Blank rates count as $0, except Cache write (1h), '
    + 'which falls back to the 5m rate when blank.'));

  root.appendChild(grid);
  setModelCost(root, editing ? model.cost : null); // grid is attached now — the block is reachable from root
  applyConnectionModeIn(root);                       // efforts hint + collapse follow the Connection (now reachable)
  root.dataset.engine = engineNow;
  setModelEngine(root, engineNow);                   // hides the env rows and narrows the Connection for a Codex entry
  const msg = h(doc, 'p', 'form-msg mv-editor-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);

  const btns = h(doc, 'div', 'mv-editor-btns');
  const save = h(doc, 'button', 'btn-go mv-save', editing ? 'Save' : 'Add model');
  save.type = 'button';
  const cancel = h(doc, 'button', 'btn-ghost mv-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(save); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/** The effort checkboxes for one engine's list; `selected` null = all checked. */
function effortBoxes(doc, list, selected) {
  return list.map((e) => {
    const lab = h(doc, 'label', 'mv-effort');
    const cb = h(doc, 'input', 'mv-effort-cb');
    cb.type = 'checkbox'; cb.value = e; cb.checked = selected ? selected.has(e) : true;
    lab.appendChild(cb);
    lab.appendChild(h(doc, 'span', null, e));
    return lab;
  });
}

/**
 * Put an editor on an engine (§3.1a): the effort checkboxes become that engine's list (all
 * checked) when the engine changes, the routing env hides for Codex, and the Connection offers a
 * Codex model only its own default or an OpenAI-compatible endpoint (bridge-view applyConnectionMode).
 * The ONE place that knows the rule — the initial render, the select's change handler (app.js)
 * and "+ Add model…" from a Codex New pipeline all go through it. Safe on any editor.
 * @param {Element} rootEl the .mv-editor root
 * @param {'claude'|'codex'|'cursor'} engine
 */
export function setModelEngine(rootEl, engine) {
  const sel = rootEl && rootEl.querySelector('.mv-engine');
  if (!sel) return;
  const next = MODEL_ENGINE_NAMES.includes(engine) ? engine : 'claude';
  sel.value = next;
  if (rootEl.dataset.engine !== next) {
    let lists = {};
    try { lists = JSON.parse(rootEl.dataset.effortLists || '{}') || {}; } catch { lists = {}; }
    const wrap = rootEl.querySelector('.mv-efforts');
    if (wrap) wrap.replaceChildren(...effortBoxes(rootEl.ownerDocument, lists[next] || [], null));
    rootEl.dataset.engine = next;
  }
  const noEnv = next !== 'claude';
  const envField = rootEl.querySelector('.mv-env')?.closest('.mv-field');
  if (envField) envField.hidden = noEnv;
  const btns = rootEl.querySelector('.mv-env-btns');
  if (btns) btns.hidden = noEnv;
  // A Cursor model takes no effort and worca cannot price it: the whole fields hide (and come back off Cursor).
  const cursor = next === 'cursor';
  const pricing = rootEl.querySelector('.mv-cost-edit')?.closest('.mv-field');
  if (pricing) pricing.hidden = cursor;
  const effField = rootEl.querySelector('.mv-efforts')?.closest('.mv-field');
  if (effField) effField.hidden = cursor;
  const conn = rootEl.querySelector('.mv-conn');
  if (conn) { conn.dataset.engine = next; applyConnectionMode(conn); }
  const signin = rootEl.querySelector('.mv-signin-field');
  if (signin && conn) signin.hidden = (conn.querySelector('.mv-conn-mode-rb:checked')?.value || 'direct') !== 'direct';
}

/**
 * Load a `cost` override into an editor: pick the matching mode and fill the
 * rates. The ONE place that maps a stored cost onto the form, shared by the
 * initial render and by "Edit a copy"'s prefill of a plugin model's pricing —
 * a second implementation of this mapping is exactly how the two would drift.
 * Safe on an editor with no pricing block. Pass null/undefined for no override.
 * @param {Element} rootEl  the .mv-editor root
 * @param {{free?:boolean, perMtok?:Record<string,number>}|null} [cost]
 */
export function setModelCost(rootEl, cost) {
  const rates = rootEl && rootEl.querySelector('.mv-cost-rates');
  if (!rates) return;
  const mode = !cost ? 'cli' : (cost.free ? 'free' : 'perMtok');
  for (const rb of rootEl.querySelectorAll('.mv-cost-mode-rb')) rb.checked = rb.value === mode;
  const p = cost && cost.perMtok && typeof cost.perMtok === 'object' ? cost.perMtok : {};
  for (const inp of rootEl.querySelectorAll('.mv-cost-rate-in')) {
    const v = p[inp.dataset.rate];
    inp.value = v == null ? '' : String(v);
  }
  applyCostMode(rootEl);
}

/**
 * Show the per-Mtok rate inputs only in that mode. The single place that knows
 * the rule, so the initial render and the delegated `change` handler in app.js
 * can never drift apart. Safe on an editor with no pricing block.
 * @param {Element} rootEl  the .mv-editor root
 */
export function applyCostMode(rootEl) {
  const rates = rootEl && rootEl.querySelector('.mv-cost-rates');
  if (!rates) return;
  const picked = rootEl.querySelector('.mv-cost-mode-rb:checked');
  rates.hidden = (picked ? picked.value : 'cli') !== 'perMtok';
}

/** app.js exposes envRow creation to the delegated mv-env-add handler. */
export function makeEnvRow({ doc = globalThis.document } = {}) {
  return envRow(doc);
}

/**
 * Collect the editor into a request body. For EDIT mode the env is a write-only
 * PATCH: unchanged masked values are echoed (the server treats them as "keep"),
 * removed keys are sent as null. Returns { id, body } — id is null in create
 * mode (POST carries it in the body instead).
 */
export function collectModelEditor(rootEl) {
  const editing = rootEl.dataset.mode === 'edit';
  const id = editing ? rootEl.dataset.id : (rootEl.querySelector('.mv-id')?.value || '').trim();
  const label = (rootEl.querySelector('.mv-label')?.value || '').trim();
  const efforts = [...rootEl.querySelectorAll('.mv-effort-cb')].filter((c) => c.checked).map((c) => c.value);
  const allCount = rootEl.querySelectorAll('.mv-effort-cb').length;
  const engineValue = rootEl.querySelector('.mv-engine')?.value;
  const engine = MODEL_ENGINE_NAMES.includes(engineValue) ? engineValue : 'claude';

  const env = {};
  const seen = new Set();
  for (const row of rootEl.querySelectorAll('.mv-env-row')) {
    const k = (row.querySelector('.mv-env-key')?.value || '').trim();
    const v = row.querySelector('.mv-env-val')?.value ?? '';
    if (!k) continue;
    seen.add(k);
    env[k] = v;
  }
  if (editing) {
    // Keys the stored entry had but the editor no longer shows -> delete (null).
    for (const k of (rootEl.dataset.envKeys || '').split('\n').filter(Boolean)) {
      if (!seen.has(k)) env[k] = null;
    }
  }

  // Pricing. The editor renders the STORED override, so it round-trips: a user
  // who came to change a label leaves it untouched. 'cli' is therefore an
  // explicit CLEAR (null), not an omission — it is what the form now shows.
  // Rate values are sent raw for the server to validate (settings.mjs
  // assertModelCost owns the rules; duplicating them here would let them drift).
  const mode = rootEl.querySelector('.mv-cost-mode-rb:checked')?.value || 'cli';
  let cost = null;
  if (mode === 'free') cost = { free: true };
  else if (mode === 'perMtok') {
    const perMtok = {};
    for (const inp of rootEl.querySelectorAll('.mv-cost-rate-in')) {
      const raw = (inp.value ?? '').trim();
      if (raw !== '') perMtok[inp.dataset.rate] = Number(raw);
    }
    cost = { perMtok };   // empty -> the server rejects it by name, surfaced in the form
  }

  // Connection (model-bridge-design.md §8.3): the object to store, or null to
  // clear — like 'cli' for pricing, the form shows the truth.
  const { upstream } = collectConnection(rootEl);

  const body = {
    ...(editing ? {} : { id }),
    ...(!editing && engine !== 'claude' ? { engine } : {}),
    label,
    // All boxes checked = the full set = store the default (empty).
    efforts: efforts.length === allCount ? [] : efforts,
    env: engine !== 'claude' ? {} : env,
    cost,
    // Create mode has nothing to clear, so a null upstream is simply omitted
    // and the POST body stays byte-identical for a non-bridged entry.
    ...(upstream === undefined || (!editing && upstream === null) ? {} : { upstream }),
  };
  return { id: editing ? id : null, body };
}

/** applyConnectionMode over an editor root (re-exported here so app.js's one
 *  delegated `change` handler for the editor needs a single import). */
export function applyConnectionModeIn(rootEl) {
  const conn = rootEl && rootEl.querySelector && rootEl.querySelector('.mv-conn');
  if (!conn) return;
  applyConnectionMode(conn);
  const mode = conn.querySelector('.mv-conn-mode-rb:checked')?.value || 'direct';
  const creating = rootEl.dataset.mode !== 'edit';
  // An env or provider entry is Claude Code's (its other harnesses follow from the connection): a new one leaves the
  // sign-in choice, and the efforts follow Claude Code's list.
  if (creating && mode !== 'direct' && rootEl.dataset.engine && rootEl.dataset.engine !== 'claude') setModelEngine(rootEl, 'claude');
  const signin = rootEl.querySelector('.mv-signin-field');
  if (signin) signin.hidden = mode !== 'direct';
  // Through a provider, a new entry's id defaults to <provider>-<upstream id> until the user types one: a built-in
  // id names a harness's own sign-in, so the gateway's twin of gpt-5.5 is openai-gpt-5.5.
  const idIn = rootEl.querySelector('.mv-id');
  const upstreamId = (conn.querySelector('.mv-conn-model')?.value || '').trim();
  if (creating && idIn && idIn.dataset.auto !== 'off' && mode === 'provider' && upstreamId) {
    idIn.value = suggestModelHandle(upstreamId, conn.querySelector('.mv-conn-provider')?.value || 'openai');
    idIn.dataset.auto = 'on';
  }
}

// ── Share-as-plugin export wizard (design §9.5) ─────────────────────────────

// Credential-looking env keys default to "Require at install". Word-ish
// boundaries keep limits like MAX_OUTPUT_TOKENS or MAX_THINKING_TOKENS (a
// count, not a credential) out of the net.
const SECRETISH_RE = /auth|secret|password|credential|api_?key|(?:^|_)key(?:_|$)|(?:^|_)token(?:_|$)/i;

/**
 * The export wizard: pick global models, set the per-env-key policy, name the
 * plugin, choose a destination folder. `globals` are MASKED entries from
 * GET /api/models (only KEYS matter here — values are read server-side at
 * export). Detached DOM; app.js wires mvx-export / mvx-cancel.
 */
export function renderExportWizard(globals, { doc = globalThis.document } = {}) {
  const root = h(doc, 'section', 'card mv-editor mvx');
  root.appendChild(h(doc, 'h3', 'mv-editor-title', 'Share models as a plugin'));

  const step = (title, hint) => {
    const s = h(doc, 'div', 'mvx-step');
    s.appendChild(h(doc, 'h4', 'mvx-step-title', title));
    if (hint) s.appendChild(h(doc, 'small', 'hint', hint));
    root.appendChild(s);
    return s;
  };

  const pick = step('1 — Models to include', 'Only your global models can be shared.');
  for (const m of globals) {
    const lab = h(doc, 'label', 'mvx-model opt-row');
    const cb = h(doc, 'input', 'mvx-model-cb');
    cb.type = 'checkbox'; cb.value = m.id;
    cb.dataset.envKeys = Object.keys(m.env || {}).join('\n');
    lab.appendChild(cb);
    lab.appendChild(h(doc, 'span', 'opt-name', `${m.label || m.id} `));
    lab.appendChild(h(doc, 'small', 'hint opt-sub', m.id));
    pick.appendChild(lab);
  }
  if (!globals.length) pick.appendChild(h(doc, 'div', 'hist-empty', 'No global models to share yet.'));

  const envKeys = [...new Set(globals.flatMap((m) => Object.keys(m.env || {})))];
  const pol = step('2 — Env var policy',
    'Include value commits the stored value to the plugin (it will live in a git repo). ' +
    'Require at install strips it — teammates are prompted once and the value stays on their machine.');
  for (const k of envKeys) {
    const row = h(doc, 'div', 'mvx-env-row');
    row.dataset.key = k;
    row.appendChild(h(doc, 'span', 'mono mvx-env-key', k));
    const sel = h(doc, 'select', 'select mvx-mode');
    for (const [v, label] of [['include', 'Include value'], ['secret', 'Require at install'], ['omit', 'Omit']]) {
      const opt = h(doc, 'option', null, label);
      opt.value = v;
      sel.appendChild(opt);
    }
    sel.value = SECRETISH_RE.test(k) ? 'secret' : 'include';
    row.appendChild(sel);
    if (SECRETISH_RE.test(k)) row.appendChild(h(doc, 'small', 'hint mvx-warn', 'looks like a credential'));
    pol.appendChild(row);
  }
  if (!envKeys.length) pol.appendChild(h(doc, 'small', 'hint', 'No env vars on your models — nothing to decide.'));

  const meta = step('3 — Plugin metadata + destination');
  const field = (labelText, cls, placeholder, hint) => {
    const wrap = h(doc, 'label', 'mv-field');
    wrap.appendChild(h(doc, 'span', 'mv-field-label', labelText));
    const input = h(doc, 'input', `input ${cls}`);
    input.type = 'text'; input.placeholder = placeholder;
    wrap.appendChild(input);
    if (hint) wrap.appendChild(h(doc, 'small', 'hint', hint));
    meta.appendChild(wrap);
    return input;
  };
  field('Plugin name', 'mvx-name', 'discretestack-models', 'kebab-case; becomes the folder + install name');
  field('Description', 'mvx-desc', 'Team routing for …');
  field('Version', 'mvx-version', '0.1.0');
  field('Destination folder', 'mvx-dest', '~/dev/discretestack-models',
    'Must be new or empty. The scaffold goes here — git init + push it to share.');

  const msg = h(doc, 'p', 'form-msg mvx-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const go = h(doc, 'button', 'btn-go mvx-export', 'Export scaffold');
  go.type = 'button';
  const cancel = h(doc, 'button', 'btn-ghost mvx-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(go); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/** Collect the wizard into the POST /api/models/export-plugin body. */
export function collectExportWizard(rootEl) {
  const modes = {};
  for (const row of rootEl.querySelectorAll('.mvx-env-row')) {
    modes[row.dataset.key] = row.querySelector('.mvx-mode')?.value || 'include';
  }
  const models = [...rootEl.querySelectorAll('.mvx-model-cb')]
    .filter((cb) => cb.checked)
    .map((cb) => ({
      id: cb.value,
      env: Object.fromEntries((cb.dataset.envKeys || '').split('\n').filter(Boolean)
        .map((k) => [k, modes[k] || 'include'])),
    }));
  const val = (cls) => (rootEl.querySelector(`.${cls}`)?.value || '').trim();
  return {
    name: val('mvx-name'),
    description: val('mvx-desc'),
    ...(val('mvx-version') ? { version: val('mvx-version') } : {}),
    dest: val('mvx-dest'),
    models,
  };
}

/** Human summary of what deleting `id` clears, for the confirmation prompt. */
export function deleteRefsSummary(id, refs) {
  if (refs && refs.predefinedShadow) {
    return `Remove the override of built-in "${id}"? The built-in entry comes back; nothing else changes.`;
  }
  const nodes = refs && Array.isArray(refs.nodes) ? refs.nodes.length : 0;
  const steps = refs && Array.isArray(refs.steps) ? refs.steps.length : 0;
  const projects = new Set([
    ...((refs && refs.nodes) || []).map((n) => n.projectKey),
    ...((refs && refs.steps) || []).map((s) => s.projectKey),
  ]).size;
  // Settings › Memory's defragment model is the one GLOBAL ref (globalModelRefs `memoryDefrag`).
  const defrag = !!(refs && refs.memoryDefrag);
  if (!nodes && !steps) {
    return defrag
      ? `Delete model "${id}"? Memory defragment runs use it (Settings › Memory) — that setting is cleared and they fall back to the default.`
      : `Delete model "${id}"? No pipeline configuration references it.`;
  }
  return `Delete model "${id}"? This also clears ${nodes} node selection${nodes === 1 ? '' : 's'} and ` +
    `${steps} role selection${steps === 1 ? '' : 's'} across ${projects} project${projects === 1 ? '' : 's'}` +
    (defrag ? ', and the Memory defragment model (Settings › Memory).' : '.');
}
