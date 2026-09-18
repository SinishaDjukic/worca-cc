// src/core/ask/source-spec.mjs
// Plugin task sources in Ask Worca: "fix jira bug PROJ-123" as a run whose task is the ISSUE,
// not a copy of it. The card stores a reference (plugin, source, task id, profile, inputs) and
// the run fetches the task when it starts — exactly what New pipeline's source pane sends to
// POST /api/run, so a scheduled run reads the issue as it is at start time.
//
// Pure: every reader is injected (source-deps.mjs binds the real ones), so the MCP child and the
// parent's authoritative re-validation build the same card. Nothing here writes or fetches; the
// optional `lookupTask` (the parent only) is how the card learns the task's title and link.
import { ASK_LIMITS } from './limits.mjs';

// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/** Plugin failures that mean "try again later", not "this task is wrong". */
export const TRANSIENT_SOURCE_KINDS = Object.freeze(['network', 'rate-limit', 'timeout']);
/** The input a task browser fills — the task id itself, never a run input. */
const TASK_INPUT_TYPES = new Set(['task-browser']);

/** The model-facing view of the installed plugin task sources (list_task_sources). */
export function shapeSources(sources) {
  return (Array.isArray(sources) ? sources : []).filter((s) => s && s.type === 'plugin').map((s) => ({
    plugin: s.plugin, sourceId: s.sourceId, displayName: clip(s.displayName, 120),
    inputs: (s.inputs || []).filter((i) => i && !TASK_INPUT_TYPES.has(i.type)).map((i) => ({
      key: i.key, type: i.type, label: clip(i.label || i.key, 80),
      ...(i.default !== undefined ? { default: i.default } : {}),
      ...(Array.isArray(i.options) ? { options: i.options.slice(0, 20) } : {}),
    })),
    multiProfile: s.multiProfile === true,
    profiles: s.multiProfile === true ? (s.profiles || []).map((p) => (typeof p === 'string' ? p : p && p.id)).filter(Boolean) : [],
  }));
}

/**
 * Validate the `source` of a propose_run input against the installed sources and the target.
 * @param {object|undefined} raw  { plugin, sourceId, taskId, profile?, inputs? }
 * @param {{target:object, listTaskSources:() => Array, resolveProfile:(ref) => {profile, via, candidates?}}} readers
 * @returns {{ok:true, source:object|null}|{ok:false, errors:string[]}}
 */
export function validateRunSource(raw, { target, listTaskSources, resolveProfile }) {
  if (raw === undefined || raw === null) return { ok: true, source: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['source must be an object: { plugin, sourceId, taskId, profile?, inputs? }'] };
  const plugin = str(raw.plugin);
  const sourceId = str(raw.sourceId);
  const taskId = clip(raw.taskId, 200);
  for (const [k, v] of [['plugin', plugin], ['sourceId', sourceId], ['taskId', taskId]]) {
    if (!v) return { ok: false, errors: [`source.${k} is required — list_task_sources and find_tasks give it`] };
  }
  let all = [];
  try { all = listTaskSources() || []; } catch { all = []; }
  const src = all.find((s) => s && s.type === 'plugin' && s.plugin === plugin && s.sourceId === sourceId);
  if (!src) {
    const known = all.filter((s) => s && s.type === 'plugin').map((s) => `${s.plugin}/${s.sourceId}`);
    return { ok: false, errors: [`no task source ${plugin}/${sourceId} is installed and enabled${known.length ? ` (installed: ${known.join(', ')})` : ' — none is installed'}`] };
  }
  const errors = [];
  // Inputs: only the ones the source declares (never the task browser), string or boolean
  // values; a declared default fills an absent one, as the New pipeline pane pre-fills it.
  const inputs = {};
  const declared = (src.inputs || []).filter((i) => i && i.key && !TASK_INPUT_TYPES.has(i.type));
  const given = raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs) ? raw.inputs : {};
  for (const k of Object.keys(given)) {
    if (!declared.some((i) => i.key === k)) errors.push(`source.inputs.${k} is not an input of ${src.displayName} (inputs: ${declared.map((i) => i.key).join(', ') || 'none'})`);
  }
  for (const i of declared) {
    const v = Object.prototype.hasOwnProperty.call(given, i.key) ? given[i.key] : i.default;
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && typeof v !== 'boolean' && typeof v !== 'number') { errors.push(`source.inputs.${i.key} must be a string`); continue; }
    if (Array.isArray(i.options) && i.options.length && !i.options.map(String).includes(String(v))) {
      errors.push(`source.inputs.${i.key} must be one of ${i.options.join(' | ')}`);
      continue;
    }
    inputs[i.key] = typeof v === 'string' ? clip(v, 500) : v;
  }
  // Profile: which configuration (tracker instance) of a multi-profile source. The project's
  // binding decides when the model names none; two candidates are the user's call, never a guess.
  let profile = null;
  let profileVia = null;
  const available = (src.profiles || []).map((p) => (typeof p === 'string' ? p : p && p.id)).filter(Boolean);
  const named = str(raw.profile);
  if (src.multiProfile) {
    if (named) {
      if (!PROFILE_RE.test(named) || !available.includes(named)) errors.push(`${src.displayName} has no profile "${named}" (profiles: ${available.join(', ') || 'none — set one up in Settings › Plugins'})`);
      else { profile = named; profileVia = 'named'; }
    } else {
      const scope = target.workspaceId ? { scopeType: 'workspace', scopeKey: target.workspaceId, memberKeys: (target.members || []).map((m) => m.projectKey) }
        : { scopeType: 'project', scopeKey: target.projectKey };
      let r = { profile: null, via: 'none' };
      try { r = resolveProfile({ ...scope, plugin, sourceId, available }) || r; } catch { /* unresolved */ }
      if (r.profile) { profile = r.profile; profileVia = r.via; }
      else if (!available.length) errors.push(`${src.displayName} has no profile yet — the user sets one up in Settings › Plugins`);
      else errors.push(`${src.displayName} has several profiles and this ${target.workspaceId ? 'workspace' : 'project'} is not bound to one — ask the user which: ${(r.candidates && r.candidates.length ? r.candidates : available).join(', ')}`);
    }
  } else if (named) errors.push(`${src.displayName} does not use profiles — omit source.profile`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    source: {
      type: 'plugin', plugin, sourceId, taskId, displayName: clip(src.displayName, 120),
      ...(profile ? { profile, profileVia } : {}),
      ...(Object.keys(inputs).length ? { inputs } : {}),
    },
  };
}

/**
 * The parent's check that the task exists, and its title and link for the card. A transient
 * failure keeps the card (the run fetches it again at start) and says so; anything else refuses.
 * @param {(ref) => Promise<object|null>} lookupTask  getTask through the plugin shim
 * @returns {Promise<{ok:true, task:{title, url}|null, warning?:string}|{ok:false, error:string}>}
 */
export async function checkTask(source, lookupTask) {
  if (typeof lookupTask !== 'function') return { ok: true, task: null };
  try {
    const t = await lookupTask({ plugin: source.plugin, sourceId: source.sourceId, taskId: source.taskId, profile: source.profile });
    if (!t) return { ok: false, error: `${source.displayName} has no task "${source.taskId}" — find_tasks lists what it has` };
    return { ok: true, task: { title: clip(t.title || '', 200) || null, url: typeof t.url === 'string' && /^https?:\/\//i.test(t.url) ? t.url.slice(0, 500) : null } };
  } catch (err) {
    const kind = err && err.kind;
    if (TRANSIENT_SOURCE_KINDS.includes(kind)) {
      return { ok: true, task: null, warning: `could not reach ${source.displayName} just now (${kind}); the run fetches the task when it starts` };
    }
    return { ok: false, error: `${source.displayName}: ${clip(err && err.message ? err.message : String(err), 300)}` };
  }
}

/** The POST /api/run `source` a card's reference becomes. */
export function runSourceOf(s) {
  if (!s || s.type !== 'plugin') return null;
  return {
    type: 'plugin', plugin: s.plugin, sourceId: s.sourceId, taskId: s.taskId,
    ...(s.profile ? { profile: s.profile } : {}), ...(s.inputs ? { inputs: s.inputs } : {}),
  };
}

/** A task as the model reads it (find_tasks rows / get_task): untrusted text, clipped. */
export function shapeTask(t, { redact = (x) => x, withBody = false } = {}) {
  if (!t || typeof t !== 'object') return null;
  const out = {
    id: clip(t.id, 200), title: redact(clip(t.title, 300)),
    ...(typeof t.url === 'string' ? { url: t.url.slice(0, 500) } : {}),
    ...(t.state || t.status ? { state: clip(t.state || t.status, 40) } : {}),
    ...(Array.isArray(t.labels) ? { labels: t.labels.slice(0, 12).map((l) => clip(typeof l === 'string' ? l : l && l.name, 60)) } : {}),
    ...(t.updatedAt ? { updatedAt: clip(t.updatedAt, 40) } : {}),
  };
  if (withBody) {
    const body = String(t.body ?? '');
    out.body = redact(body.slice(0, ASK_LIMITS.taskBodyMaxChars ?? 20000));
    if (body.length > (ASK_LIMITS.taskBodyMaxChars ?? 20000)) out.truncated = true;
    if (t.meta && typeof t.meta === 'object') {
      try { out.meta = JSON.parse(redact(JSON.stringify(t.meta).slice(0, 4000))); } catch { /* an unparsable clip is dropped */ }
    }
  }
  return out;
}
