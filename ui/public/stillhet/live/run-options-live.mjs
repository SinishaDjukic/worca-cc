// ui/public/stillhet/live/run-options-live.mjs — New task's and the proposal's run options (COV-2, docs/rail/forms.md
// form.run-options): every read and write classic's New run makes for its saved defaults, a workflow's defaults, presets,
// a ticket source and the team policy notes, on dev's own routes, through the shared action runner (D13). The pure helpers
// turn dev's answers into what the page draws, in classic's words (app.js, branch-sync.mjs, source-pane.mjs,
// run-presets-picker.mjs, team-policy-view.mjs). Nothing here writes state: callers write only after `ok`.
import { actionRunner } from './chat-live.mjs';
import { setupFromBody } from '../../../../src/shared/run-presets.mjs';
import { ENGINE_NAMES } from '../../../../src/shared/engine-switch.mjs';

const enc = encodeURIComponent;
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const usd = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;

/** The workflows that keep no defaults of their own (classic's composer.mjs isReservedWorkflowId). */
export const RESERVED_WORKFLOWS = Object.freeze(['wf_default', 'wf_lean_build', 'wf_memory_defrag', 'wf_shape', 'wf_shape_ux', 'wf_shape_req', 'wf_shape_ux_req', 'wf_shape_slice_req', 'wf_shape_ux_slice_req', 'wf_auto']);
/** classic's New run, when the engine refusal can be lifted (app.js startRun). */
export const ENGINE_TICK = 'Tick Allow unguarded to run anyway, or pick Claude.';
export const ENGINE_ALLOW = 'Allow unguarded: run without the rules this engine cannot enforce';
export const PICK_FIRST = 'Pick a task from the list first.';
export const START_CANCELLED = 'Start cancelled';

/** A refused `request` as the page reads it: the engine gate, the base sync, a broken preset, or anything else. */
export function refusalOf(res) {
  if (!res || res.ok) return null;
  const d = res.data || {}, code = res.code || d.code || '';
  if (code === 'engine-refused') return { kind: 'engine', error: str(d.error) || str(res.error), overridable: d.overridable === true };
  if (code === 'sync-diverged' || code === 'sync-fetch-failed') {
    const members = arr(d.members), first = members[0] || {};
    return { kind: 'sync', sync: code === 'sync-diverged' ? 'diverged' : 'fetch-failed', options: arr(d.options).length ? arr(d.options) : ['cancel'], members, base: str(first.base), remote: str(first.remote) || 'origin', forbidden: d.forbidden === true, fetchKind: str(d.fetchKind), error: str(d.error) || str(res.error) };
  }
  if (code === 'preset-broken') return { kind: 'preset', broken: arr(d.broken), error: str(d.error) || str(res.error) };
  return { kind: 'other', error: str(res.error) };
}

/** branch-sync.mjs fetchFailureCopy */
const fetchWords = (kind, remote) => ({
  auth: `Sign-in to ${remote} failed. Worca will start from the last fetch instead.`,
  network: `${remote} could not be reached. Worca will start from the last fetch instead.`,
  timeout: `${remote} did not answer in time. Worca will start from the last fetch instead.`,
}[kind] || `Fetching ${remote} failed. Worca will start from the last fetch instead.`);

/** The sync refusal's note in classic's words (branch-sync.mjs chooseSyncRefusal): its title, a line per project, and its
 *  one way to start (`policy` is the `syncPolicy` the resend carries), or none when the project's setting forbids it. */
export function syncNoteOf(r) {
  const { members, remote, base, options } = r, many = members.length > 1;
  const who = (m, line) => (many ? `${m.projectName || m.projectKey}: ${line}` : line);
  if (r.sync === 'diverged') {
    const rows = members.map((m) => who(m, `${m.base} has diverged from ${m.remote || remote}/${m.base} (${m.ahead || 0} ahead, ${m.behind || 0} behind).`));
    if (options.includes('origin')) return { title: `${base} has diverged from ${remote}/${base}`, rows, primary: { label: `Start from ${remote}/${base}`, policy: 'origin' }, note: 'Recommended: your shared folder stays untouched.' };
    return { title: `${base} has diverged from ${remote}/${base}`, rows, primary: null, note: 'This project\'s sync setting does not allow starting from the remote.' };
  }
  const rows = (members.length ? members : [{ remote, fetchKind: r.fetchKind }]).map((m) => who(m, fetchWords(m.fetchKind || r.fetchKind, m.remote || remote)));
  return { title: `Could not reach ${remote}`, rows, primary: options.includes('last-fetch') ? { label: 'Start anyway', policy: 'last-fetch' } : null };
}

/** The form's picks a preset sets (its `setup`), and `carried`: what it holds that the form has no control for. */
export function presetFormOf(preset) {
  const s = preset?.setup || {};
  const carried = {};
  for (const k of ['guardrailsId', 'mcpOptOut', 'mock', 'nightMode', 'overlay', 'humanInLoop']) if (s[k] !== undefined) carried[k] = structuredClone(s[k]);
  return { workflowId: str(s.workflowId), engine: str(s.engine), sourceBranch: str(s.sourceBranch), syncBeforeStart: typeof s.syncBeforeStart === 'boolean' ? s.syncBeforeStart : null,
    pr: s.pr && typeof s.pr === 'object' ? structuredClone(s.pr) : null, tags: arr(s.tags).filter((t) => typeof t === 'string'), featureBranch: str(s.featureBranch), sameAsSource: s.sameAsSource === true, carried };
}

/** Whether the form left what the preset set: any pick it applied now differs. */
export function presetModified(applied, current) {
  if (!applied || !current) return false;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return ['workflowId', 'engine', 'sourceBranch', 'syncBeforeStart', 'pr', 'tags', 'sameAsSource'].some((k) => !same(applied[k], current[k]));
}

/** A preset's own scope fits the form's project: any project, or this one (its key). */
export const presetFits = (preset, projectKey) => preset?.scope?.kind === 'global' || (preset?.scope?.kind === 'project' && !!projectKey && preset.scope.ref === projectKey);

/** The broken note (run-presets-picker.mjs renderBrokenCard): dev's message per item, Reset to default where it may. */
export function brokenNoteOf(broken) {
  return { title: 'This preset needs attention', rows: arr(broken).map((b) => ({ text: str(b.message) || `${b.item} ${b.ref}`, reset: b.reset === true, item: str(b.item), ref: str(b.ref) })) };
}
/** Reset to default (run-presets-picker.mjs resetItem): the pick is dropped, so the project's own default holds. */
export function resetSetup(setup, item, { workflowId = 'wf_default', engine = 'claude' } = {}) {
  const next = structuredClone(setup || {});
  if (item.item === 'guardrails') delete next.guardrailsId;
  else if (item.item === 'engine') next.engine = engine;
  else if (item.item === 'workflow') { next.workflowId = workflowId; delete next.overlay; }
  else if ((item.item === 'model' || item.item === 'node') && next.overlay?.nodes) delete next.overlay.nodes[item.ref];
  else if (item.item === 'loop' && next.overlay?.wires) delete next.overlay.wires[item.ref];
  return next;
}

/** The preset's setup from the form's body (classic presetSetupFromForm): its keys, plus the applied preset's agent picks
 *  and humanInLoop, which the form has no control for. */
export function presetSetupOf(body, preset) {
  const s = preset?.setup || {};
  return { ...setupFromBody(body, { scope: preset?.scope?.kind || 'global' }), ...(s.overlay !== undefined ? { overlay: structuredClone(s.overlay) } : {}), ...(s.humanInLoop !== undefined ? { humanInLoop: s.humanInLoop } : {}) };
}

const capText = (key, c, reset) => (key === 'pipeline' ? `pipeline cap ${usd(c.value)} (${c.kind})` : `total ${usd(c.value)}${reset ? `/${reset === 'weekly' ? 'week' : 'month'}` : ''} (${c.kind})`);
/** The team policy notes line (team-policy-view.mjs renderPolicyNotesLine): null with no policy; amber when a note warns. */
export function policyNoteOf(res) {
  const p = res?.policy; if (!p) return null;
  const notes = arr(res.notes), n = notes.length, caps = p.caps || {};
  const capLine = [...(caps.pipeline ? [capText('pipeline', caps.pipeline)] : []), ...(caps.total ? [capText('total', caps.total, caps.resetPeriod)] : []), ...(caps.pooled ? [`pooled budget ${usd(caps.pooled.value)} / ${caps.pooled.window}`] : [])].join(' · ');
  return { tone: notes.some((x) => x.level === 'warn') ? 'amber' : 'grey', head: `team policy · ${p.home || '—'}${n ? ` · ${n} note${n === 1 ? '' : 's'} · nothing here blocks the run` : ' · nothing to note'}`, rows: notes.map((x) => ({ text: str(x.text), warn: x.level === 'warn' })), caps: capLine };
}

/** POST /api/run's `source` for a picked ticket (app.js startRun): no prompt rides with it. */
export function sourceBodyOf({ plugin, sourceId, taskId, inputs, profile } = {}) {
  return { type: 'plugin', plugin, sourceId, taskId, inputs: inputs || {}, ...(profile ? { profile } : {}) };
}

/** The profile gate (source-pane.mjs renderProfileGate): null once a profile holds (or the source has none to pick). */
export function gateOf(binding, source, scopeLabel = '') {
  if (!source?.multiProfile) return null;
  if (binding && binding.profile) return null;
  const name = source.displayName || source.sourceId || 'This source';
  const profiles = arr(source.profiles).map((p) => (typeof p === 'string' ? p : str(p?.id))).filter(Boolean);
  if (!profiles.length) return { text: `${name} has no profiles configured yet.`, profiles: [], conflict: false };
  if (binding?.via === 'conflict') { const c = arr(binding.candidates); return { text: `The projects in ${scopeLabel || 'this workspace'} disagree about which ${name} profile to use (${c.join(', ')}). Pick the one this run should read from.`, profiles: c.length ? c : profiles, conflict: true }; }
  return { text: `Which ${name} profile does ${scopeLabel || 'this project'} pull from? Asked once, then remembered.`, profiles, conflict: false };
}

/** A run defaults answer, read as the form uses it (classic loadRunDefaults): dev's engine only when it is one of its own. */
export function defaultsOf(data) {
  const e = str(data?.engine?.value);
  return { engine: ENGINE_NAMES.includes(e) ? e : '', tags: arr(data?.tags).filter((t) => typeof t === 'string'), projectKey: str(data?.projectKey) };
}

/** Save as the workflow's defaults (F-cov23-02): classic's promote sends each agent node's FULL effective block (app.js
 *  effectiveDefaultsOf over buildNodeConfigRows), since dev replaces a node's defaults whole. The node's effective
 *  settings resolve as classic's node-tunables resolveNodeTunables does (the project's own pick, then the workflow's,
 *  then the agent registry); `model` (the one pick for every agent) replaces each model, keeping its effort only when it
 *  is the same model. `wf` is GET /api/workflows/:id, `agents` GET /api/agents' list, `nodes` the project's
 *  config.workflows[id].nodes. */
export function workflowDefaultsOf(wf, agents, nodes, model) {
  const reg = Object.fromEntries(arr(agents).filter((a) => a && a.key).map((a) => [a.key, a]));
  const agentNodes = Array.isArray(wf?.nodes) ? wf.nodes.filter((n) => n && n.kind === 'agent' && n.id).map((n) => [n, n.config])
    : arr(wf?.steps).flatMap((g) => arr(g)).filter((n) => n && n.id).map((n) => [n, n.defaults]);
  const own = nodes && typeof nodes === 'object' ? nodes : {};
  return Object.fromEntries(agentNodes.map(([node, authored]) => {
    const saved = own[node.id] || {}, d = authored && typeof authored === 'object' ? authored : {}, meta = reg[node.key] || {};
    const pick = (k, isT, dflt) => (isT(saved[k]) ? saved[k] : isT(d[k]) ? d[k] : dflt);
    const isStr = (v) => typeof v === 'string' && v !== '', isBool = (v) => typeof v === 'boolean';
    const was = isStr(saved.model) ? saved.model : str(d.model);
    const effort = isStr(saved.model) ? str(saved.effort) : isStr(saved.effort) ? saved.effort : typeof d.model === 'string' ? str(d.effort) : '';
    const out = { model, ...(model === was && effort ? { effort } : {}), fanOut: !!pick('fanOut', isBool, meta.fanOut === true) };
    if (meta.asksQuestions && !meta.questionsLocked) out.askQuestions = !!pick('askQuestions', isBool, !!meta.questionsDefault);
    const sub = pick('subagentModel', isStr, '');
    if (sub) out.subagentModel = sub;
    return [node.id, out];
  }));
}

/** `fetch` and `toast` come in; every method answers the runner's `{ok, data}` or `{ok:false, …}`. */
export function startRunOptionsLive({ fetch, toast = () => {} } = {}) {
  const { request } = actionRunner({ fetch, toast });
  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
  // a source call's connector refusal rides a 200 ({ok:false, error:{kind, message}}): it is a refusal here
  async function call(plugin, sourceId, op, args = {}, profile) {
    const r = await request('POST', '/api/sources/call', { plugin, sourceId, op, args, ...(profile ? { profile } : {}) });
    if (r.ok && r.data && r.data.ok === false) return { ok: false, status: 200, error: str(r.data.error?.message) || str(r.data.error) || 'the source refused' };
    return r.ok ? { ok: true, data: r.data?.result } : r;
  }
  return {
    defaults: (projectDir) => request('GET', `/api/run-defaults${projectDir ? `?${qs({ projectDir })}` : ''}`),
    config: (projectDir) => request('GET', `/api/config?${qs({ projectDir })}`),
    setActiveWorkflow: (projectDir, id) => request('PATCH', '/api/config', { projectDir, activeWorkflowId: id }),
    // classic's promote, then its reset: the defaults go to the workflow, the project's own picks are cleared
    // F-cov23-02: the workflow, the agents and the project's own picks are read first, so nothing a node holds is lost
    async saveWorkflowDefaults(id, model, projectDir) {
      const [w, g, c] = await Promise.all([request('GET', `/api/workflows/${enc(id)}`), request('GET', '/api/agents'), request('GET', `/api/config?${qs({ projectDir })}`)]);
      const bad = [w, g, c].find((r) => !r.ok);
      if (bad) return { ...bad, step: 'read the workflow\'s agents' };
      if (!Array.isArray(w.data?.nodes) && !Array.isArray(w.data?.steps)) return { ok: false, error: 'the workflow has no agents', step: 'read the workflow\'s agents' };
      const defaults = workflowDefaultsOf(w.data, g.data?.agents, c.data?.config?.workflows?.[id]?.nodes, model);
      const a = await request('PATCH', `/api/workflows/${enc(id)}/defaults`, { defaults });
      if (!a.ok) return { ...a, step: 'save the workflow\'s defaults' };
      const b = await request('DELETE', `/api/config/workflow?${qs({ projectDir, workflowId: id })}`);
      return b.ok ? b : { ...b, step: 'reset the project\'s agent picks' };
    },
    resetWorkflow: (projectDir, id) => request('DELETE', `/api/config/workflow?${qs({ projectDir, workflowId: id })}`),
    saveTagDefaults: (projectKey, tags) => request('PUT', `/api/projects/${enc(projectKey)}/tags/defaults`, { tags }),
    presets: () => request('GET', '/api/presets'),
    checkPreset: (id, projectDir) => request('POST', `/api/presets/${enc(id)}/check`, { projectDir }),
    updatePreset: (id, setup, projectDir) => request('PUT', `/api/presets/${enc(id)}`, { setup, basis: { projectDir } }),
    duplicatePreset: (id) => request('POST', `/api/presets/${enc(id)}/duplicate`, {}),
    sources: () => request('GET', '/api/sources'),
    binding: (projectDir, plugin, sourceId) => request('GET', `/api/source-bindings?${qs({ projectDir, plugin, sourceId })}`),
    bind: (projectDir, plugin, sourceId, profile) => request('PUT', '/api/source-bindings', { projectDir, plugin, sourceId, profile }),
    call,
    policyNotes: ({ projectKey, guardrailsId, models } = {}) => request('GET', `/api/policy/notes?${qs({ scope: `project:${projectKey}`, guardrailsId, models: arr(models).filter(Boolean).join(',') })}`),
  };
}
