// ui/public/models/catalogue-model.mjs — the Catalogue tab's view model (models-menu P4, DESIGN CAT-1…CAT-11). Pure:
// no DOM. buildCatalogue turns the GET /api/models body (with `uses`, `hiddenBuiltins`, `testable`), the Providers
// payload and the page's view state (search, filters, folds, open row) into harness groups, one sub-group per way of
// reaching models, and rows; catalogue-view.mjs draws them and app.js keeps the state.
import { harnessesOf, connectionOf, SIGNIN_LABELS, PROVIDER_LABELS } from '../../../src/shared/connections.mjs';
import { MODEL_ENGINE_NAMES, engineLabel, isBetaEngine } from '../../../src/shared/engine-switch.mjs';
import { providerRowOf, TRANSLATED_APIS } from '../bridge-view.mjs';
import { costSummary } from '../models-view.mjs';
import { credentialBadge } from '../credential-badges.mjs';
import { providerState } from './provider-state.mjs';
import { vendorOf, CONNECTION_SUFFIX_RE } from './brand-marks.mjs';

export const CATALOGUE_VIEW_DEFAULT = Object.freeze({ query: '', filter: 'all', source: 'any', fold: Object.freeze({ claude: false }), open: null });

/** The built-in lists and the harness each one runs on: the lists carry no `engine`, and untagged every row would
 *  land in Claude Code. */
const BUILTIN_LISTS = Object.freeze([['predefined', 'claude'], ['codex', 'codex'], ['copilot', 'copilot']]);

/** [list, source, engine] in composeCatalog's precedence (src/core/config.mjs): yours > plugin > a Claude built-in >
 *  team; a Codex or Copilot built-in also loses to a team twin; project models last. The first list holding an id
 *  gives its one row. Project models run on the Claude sign-in. */
const LAYERS = Object.freeze([
  ['models', 'yours', null], ['plugin', 'plugin', null], ['predefined', 'builtin', 'claude'], ['policy', 'team', null],
  ['codex', 'builtin', 'codex'], ['copilot', 'builtin', 'copilot'], ['legacy', 'project', 'claude'],
]);

const CHIPS = Object.freeze({ plugin: 'Plugin', team: 'Team', project: 'Project' });

/** Sub-groups of added models in CAT-6's order; the built-in sub-group comes after them. */
const SUB_ORDER = Object.freeze(['signin', 'env', 'copilot', 'openrouter', 'openai', 'anthropic']);
const PROVIDER_SUBS = Object.freeze(['copilot', 'openrouter', 'openai', 'anthropic']);
const PROVIDER_NAMES = Object.freeze({ ...PROVIDER_LABELS, openrouter: 'OpenRouter' });

const VENDOR_PREFIX_RE = /^[^:/]+:\s+(?=\S)/;

/** A label without the suffix an import added (" (Copilot)", " (OpenRouter)", " (OpenAI-compatible)": the connection,
 *  which the sub-header names; a server's own name such as " (Ollama)" stays) and, when `upstream.model` holds a `/`, without OpenRouter's leading "<Vendor>: " (CAT-10). */
export function displayName(model) {
  const m = model || {};
  const name = String(m.label || m.id || '').replace(CONNECTION_SUFFIX_RE, '');
  return String(m.upstream?.model ?? '').includes('/') ? name.replace(VENDOR_PREFIX_RE, '') : name;
}

const listOf = (list) => (Array.isArray(list) ? list : []).filter((m) => m && typeof m.id === 'string' && m.id);
const secretUnset = (m) => Array.isArray(m.secrets) && m.secrets.some((s) => s && !s.set);
const signinName = (engine) => SIGNIN_LABELS[engine] || `${engineLabel(engine)} sign-in`;

/** The sub-group an added model sits in: its harness's sign-in, a custom endpoint, or the Providers row of its key. */
function subKeyOf(m, providers) {
  const c = connectionOf(m);
  if (c.kind === 'signin' || c.kind === 'env') return c.kind;
  return providerRowOf(m, providers) || c.provider;
}

/** Every catalogue model once, by lower-cased id, with what the groups need to know about it. */
function catalogueRows(data, providers) {
  const builtinIds = new Set(BUILTIN_LISTS.flatMap(([list]) => listOf(data[list]).map((m) => m.id.toLowerCase())));
  const uses = data.uses && typeof data.uses === 'object' ? data.uses : {};
  const hidden = data.hiddenBuiltins && typeof data.hiddenBuiltins === 'object' ? data.hiddenBuiltins : {};
  const imported = Array.isArray(data.justImported) ? new Set(data.justImported.map((id) => String(id).toLowerCase())) : null;
  const seen = new Set();
  const rows = [];
  for (const [list, source, engine] of LAYERS) {
    for (const raw of listOf(data[list])) {
      const lc = raw.id.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      const m = engine ? { ...raw, engine } : raw;
      const u = uses[lc];
      const used = Array.isArray(u) && u.length > 0;
      const vendor = vendorOf(m);
      rows.push({
        m, lc, source,
        chip: source === 'yours' ? (builtinIds.has(lc) ? 'Overrides built-in' : null) : CHIPS[source] || null,
        harnesses: harnessesOf(m),
        // A built-in is a sign-in row too (connectionOf): route it to the built-in sub-group first.
        key: source === 'builtin' ? 'builtin' : subKeyOf(m, providers),
        hidden: source === 'builtin' && !!hidden[engine],
        used,
        usedText: used ? `${String(u[0]?.label ?? '')}${u.length > 1 ? ` +${u.length - 1}` : ''}` : '',
        setup: !!m.needsSignIn || secretUnset(m),
        imported: !!imported && imported.has(lc),
        mark: vendor ? { kind: 'vendor', key: vendor } : source === 'plugin' ? { kind: 'plugin', key: m.plugin } : { kind: 'own', key: m.id },
      });
    }
  }
  return { rows, imported };
}

/** Does a row survive the search, the filter and the source? */
function matcher(view) {
  const q = String(view.query || '').trim().toLowerCase();
  return (r) => {
    if (q && ![displayName(r.m), r.m.id, r.m.plugin, r.m.home, r.m.upstream?.model]
      .some((f) => typeof f === 'string' && f.toLowerCase().includes(q))) return false;
    if (view.filter === 'used' && !r.used) return false;
    if (view.filter === 'setup' && !r.setup) return false;
    if (view.filter === 'imported' && !r.imported) return false;
    return view.source === 'any' || r.source === view.source;
  };
}

/** The built-in sub-group's note while its harness hides them (CAT-8). k = matching ones while finding, else used ones. */
function hiddenNote(finding, k) {
  if (finding) return k === 1 ? '1 matching built-in model is hidden.' : `${k} matching built-in models are hidden.`;
  const tail = k === 0 ? '' : k === 1 ? ' 1 of them is still used by jobs and keeps working.' : ` ${k} of them are still used by jobs and keep working.`;
  return `Hidden from every model picker.${tail}`;
}

/** The harness's state, and whether it can become the default for new runs. `engines` null claims nothing. */
function harnessFacts(data, engine) {
  const engines = Array.isArray(data.engines) ? data.engines : null;
  const ready = !engines || !!engines.find((e) => e && e.name === engine)?.ready;
  const isDefault = (data.runEngine || 'claude') === engine;
  const lock = (Array.isArray(data.engineLocks) ? data.engineLocks : []).find((l) => l && l.name === engine);
  return {
    state: engines ? (ready ? { tone: 'ok', text: 'Ready' } : { tone: 'off', text: 'Not ready' }) : null,
    isDefault,
    canDefault: !isDefault && ready && !lock,
    // A broker-locked harness also reports not ready: the lock says why.
    defaultHint: isDefault ? '' : lock ? String(lock.reason || '') : !ready ? 'Not ready' : '',
  };
}

/**
 * data = the GET /api/models body with `providers` REPLACED by the GET /api/providers payload (a plain object = known;
 *        null or an array = unknown), plus { legacy, projectName, engines: [{name, ready}]|null, runEngine,
 *        engineLocks: [{name, reason}], justImported: string[]|null }
 * view = { query, filter: 'all'|'used'|'setup'|'imported', source: 'any'|'yours'|'plugin'|'team'|'project',
 *          fold: { [engine]: boolean }, open: string|null }
 * → { count, chips: { all, used, setup, imported (null when justImported is null) }, groups, noMatch }
 * Group = { engine, name, beta, state, isDefault, canDefault, defaultHint, nBuilt, customText, hiddenText, open, subs }
 * Sub   = { key, name, builtIn, count (a number, or 'N hidden'), state, fixRow, hide: { on, ariaLabel }|null, note, rows }
 * Row   = { id, name, source, chip, mark: { kind, key }, plugin, used, usedText, state, selected }
 */
export function buildCatalogue(data, view) {
  const d = data || {};
  // A field the caller leaves out or sends as undefined keeps its default.
  const v = Object.fromEntries(Object.entries(CATALOGUE_VIEW_DEFAULT).map(([k, def]) => [k, (view || {})[k] ?? def]));
  const providers = d.providers;
  const known = !!providers && typeof providers === 'object' && !Array.isArray(providers);
  const { rows, imported } = catalogueRows(d, providers);
  const listed = rows.filter((r) => !r.hidden);
  const matches = matcher(v);
  const finding = !!String(v.query || '').trim() || v.filter !== 'all' || v.source !== 'any';
  const fold = v.fold && typeof v.fold === 'object' ? v.fold : {};
  const openLc = typeof v.open === 'string' ? v.open.toLowerCase() : null;

  const subStates = new Map(PROVIDER_SUBS.map((key) => [key, known ? providerState(providers, key, { hasModels: true }) : null]));
  const rowView = (r) => ({
    id: r.m.id, name: displayName(r.m), source: r.source, chip: r.chip, mark: { ...r.mark },
    plugin: r.source === 'plugin' ? r.m.plugin ?? null : null,
    used: r.used, usedText: r.usedText,
    state: (r.m.needsSignIn && subStates.get(r.key)?.tone !== 'need') || secretUnset(r.m) ? { tone: 'need', text: 'Needs setup' } : null,
    selected: openLc !== null && r.lc === openLc,
  });
  const sub = (key, name, extra) => {
    const state = subStates.get(key) || null;
    return { key, name, builtIn: false, count: 0, state, fixRow: state && state.fix ? key : null, hide: null, note: '', rows: [], ...extra };
  };

  const groups = [];
  for (const engine of MODEL_ENGINE_NAMES) {
    const members = rows.filter((r) => r.harnesses.includes(engine));
    if (!members.length) continue;
    const custom = new Map();
    for (const r of members) {
      if (r.key === 'builtin' || !matches(r)) continue;
      if (!custom.has(r.key)) custom.set(r.key, []);
      custom.get(r.key).push(r);
    }
    const rank = (key) => (SUB_ORDER.includes(key) ? SUB_ORDER.indexOf(key) : SUB_ORDER.length);
    const subs = [...custom].sort(([a], [b]) => rank(a) - rank(b)).map(([key, rs]) => sub(key, key === 'signin' ? signinName(engine)
      : key === 'env' ? 'Custom endpoint' : PROVIDER_NAMES[key] || key, { count: rs.length, rows: rs.map(rowView) }));
    const nCustom = subs.reduce((n, s) => n + s.rows.length, 0);

    const built = members.filter((r) => r.key === 'builtin');
    const hid = built.some((r) => r.hidden);
    const hit = built.filter(matches);
    const nBuilt = hid ? 0 : hit.length;
    if (built.length && (hid ? !finding || hit.length : hit.length)) {
      subs.push(sub('builtin', `Built in · ${signinName(engine)}`, {
        builtIn: true,
        count: hid ? `${built.length} hidden` : hit.length,
        hide: { on: hid, ariaLabel: `Hide the models built into ${engineLabel(engine)}` },
        note: hid ? hiddenNote(finding, finding ? hit.length : built.filter((r) => r.used).length) : '',
        rows: hid ? [] : hit.map(rowView),
      }));
    }
    if (finding && !(nBuilt + nCustom + (hid ? hit.length : 0))) continue;

    const folded = !!(fold[engine] ?? (engine !== 'claude'));
    groups.push({
      engine, name: engineLabel(engine), beta: isBetaEngine(engine), ...harnessFacts(d, engine),
      nBuilt,
      customText: nCustom ? `${nBuilt ? '+' : ''}${nCustom} custom` : '',
      hiddenText: hid ? `${built.length} built-in hidden` : '',
      open: finding || !folded,
      subs,
    });
  }

  return {
    count: listed.length,
    chips: {
      all: listed.length,
      used: listed.filter((r) => r.used).length,
      setup: listed.filter((r) => r.setup).length,
      imported: imported ? listed.filter((r) => r.imported).length : null,
    },
    groups,
    noMatch: finding && groups.length === 0,   // CAT-5: only while a search or filter narrows the list
  };
}

/** What each source may do in the panel (PAN-3); Test also needs the row's own `testable`. */
const SOURCE_ACTIONS = Object.freeze({
  yours: Object.freeze({ test: true, edit: true, duplicate: true, del: true }),
  plugin: Object.freeze({ test: true, copy: true }),
  team: Object.freeze({ test: true }),
  project: Object.freeze({ promote: true }),
  builtin: Object.freeze({ test: true }),
});

/** A use's kind as the panel's "Used by" list words it (PAN-6). */
const USE_KINDS = Object.freeze({
  role: 'Role', step: 'Step', helper: 'Helper job', design: 'Design', 'project-step': 'Project step', 'project-node': 'Workflow node',
});
const PROJECT_USES = Object.freeze(['project-step', 'project-node']);

/** The Source fact's words: the source, then the plugin, the policy home or the project it came from. */
function sourceText(r, d) {
  const [word, from] = r.source === 'yours' ? ['Yours', '']
    : r.source === 'plugin' ? ['Plugin', r.m.plugin]
      : r.source === 'team' ? ['Team policy', r.m.home]
        : r.source === 'project' ? ['Project', d.projectName]
          : ['Built-in', ''];
  return typeof from === 'string' && from ? `${word} ${from}` : word;
}

/** PAN-4's facts in order; a fact with no value is left out. `first` = the first harness of the row. */
function panelFacts(r, d, first) {
  const m = r.m;
  const facts = [{ k: 'ID', v: m.id, mono: true, copy: true }];
  const add = (k, v, extra = {}) => { if (v) facts.push({ k, v, ...extra }); };
  add('Sends as', typeof m.upstream?.model === 'string' ? m.upstream.model : '', { mono: true });
  add('Runs on', r.harnesses.map((e) => engineLabel(e)).join(', '), first ? { mark: { kind: 'harness', key: first } } : {});
  const kind = connectionOf(m).kind;
  // A built-in is a sign-in row (it carries its list's engine): the fact names that sign-in, never the built-in
  // sub-group ("Built in · …").
  if (kind === 'signin') add('Sign-in', first ? signinName(first) : '');
  else if (kind === 'env') add('Endpoint', 'Custom endpoint');
  else add('Provider', PROVIDER_NAMES[r.key] || r.key, { mark: { kind: 'provider', key: r.key } });
  add('Efforts', Array.isArray(m.efforts) ? m.efforts.join(', ') : '');
  add('Env vars', m.env && typeof m.env === 'object' ? Object.keys(m.env).join(', ') : '', { mono: true });
  add('Price', costSummary(m.cost) || (m.costUnreliable ? 'Not verified' : ''));
  add('Key', credentialBadge(m.id)?.text || '');
  add('Source', sourceText(r, d));
  return facts;
}

/** PAN-5 for a translated model (an upstream API in bridge-view.mjs's TRANSLATED_APIS, not Codex); [] for every other model. No
 *  context window is stored, so there is no "Context" row. */
function panelLimits(m) {
  const up = m.upstream;
  if (!up || typeof up !== 'object' || m.engine === 'codex' || !TRANSLATED_APIS.includes(up.api)) return [];
  const caps = up.capabilities && typeof up.capabilities === 'object' ? up.capabilities : {};
  const tokens = (n) => `~${Math.round(n / 1000)}k tokens`;
  const limits = [];
  if (Number.isFinite(caps.maxPromptTokens)) limits.push({ k: 'Prompt', v: tokens(caps.maxPromptTokens) });
  if (Number.isFinite(caps.maxOutputTokens)) limits.push({ k: 'Output', v: tokens(caps.maxOutputTokens) });
  limits.push({ k: 'Reasoning', v: up.api === 'openai-responses' ? 'Summaries only' : caps.reasoning ? 'Not carried across turns' : 'None' });
  limits.push({ k: 'Web search', v: 'Not available' });
  return limits;
}

/** PAN-6: { label, kindText, engine, kind } per use of the row (uses are keyed by the lower-cased id). */
function panelUses(d, lc) {
  const raw = d.uses && typeof d.uses === 'object' ? d.uses[lc] : null;
  return (Array.isArray(raw) ? raw : []).filter((u) => u && typeof u === 'object').map((u) => {
    const engine = typeof u.engine === 'string' && u.engine ? u.engine : 'claude';
    const parts = [USE_KINDS[u.kind] || String(u.kind ?? '')];
    if (engine !== 'claude') parts.push(engineLabel(engine));
    if (PROJECT_USES.includes(u.kind) && u.project) parts.push(String(u.project));
    return { label: String(u.label ?? ''), kindText: parts.filter(Boolean).join(' · '), engine, kind: String(u.kind ?? '') };
  });
}

/**
 * The side panel's content for one id (case-insensitive), or null for an unknown id. `data` is buildCatalogue's.
 * → { id, name, source, mark, plugin, state: { tone, text }|null,
 *     actions: { test: { shown, disabled, title }, edit, duplicate, del, copy, promote, delLabel },
 *     facts: [{ k, v, mono?, copy?, mark?: { kind, key } }], secrets: [{ key, set }], limits: [{ k, v }],
 *     uses: [{ label, kindText, engine }] }
 * state (PAN-2): the row's own need, else its provider sub-group's need, else its first harness's state (null while
 * the engines are unknown). Test's reason, the first that holds: a plugin secret not set, a sign-in or provider
 * still to set up, the first harness not ready.
 */
export function buildModelPanel(data, id) {
  const d = data || {};
  if (typeof id !== 'string' || !id) return null;
  const providers = d.providers;
  const known = !!providers && typeof providers === 'object' && !Array.isArray(providers);
  const lc = id.toLowerCase();
  const r = catalogueRows(d, providers).rows.find((row) => row.lc === lc);
  if (!r) return null;
  const m = r.m;
  const first = r.harnesses[0] || null;
  const sub = known && PROVIDER_SUBS.includes(r.key) ? providerState(providers, r.key, { hasModels: true }) : null;
  const subNeed = sub?.tone === 'need';
  const secret = secretUnset(m);
  const harness = first ? harnessFacts(d, first).state : null;
  const state = (m.needsSignIn && !subNeed) || secret ? { tone: 'need', text: 'Needs setup' }
    : subNeed ? { tone: 'need', text: sub.text } : harness;
  const title = secret ? 'Set the plugin secret first'
    : m.needsSignIn || subNeed ? 'Needs setup first'
      : harness?.tone === 'off' ? `${engineLabel(first)} is not ready` : '';
  const may = SOURCE_ACTIONS[r.source] || {};
  return {
    id: m.id, name: displayName(m), source: r.source, mark: { ...r.mark },
    plugin: r.source === 'plugin' ? m.plugin ?? null : null,
    state,
    actions: {
      test: { shown: !!may.test && m.testable === true, disabled: !!title, title },
      edit: !!may.edit, duplicate: !!may.duplicate, del: !!may.del, copy: !!may.copy, promote: !!may.promote,
      delLabel: r.chip === 'Overrides built-in' ? 'Remove override' : 'Delete',
    },
    facts: panelFacts(r, d, first),
    secrets: Array.isArray(m.secrets) ? m.secrets.filter((s) => s && s.key).map((s) => ({ key: String(s.key), set: !!s.set })) : [],
    limits: panelLimits(m),
    uses: panelUses(d, lc),
  };
}
