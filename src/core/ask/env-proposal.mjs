// src/core/ask/env-proposal.mjs
// The environment cards (docs/environment-spec.md "From Chat"): the validators behind propose_environment_spec_change,
// propose_environment_build and propose_project_change kind "sandbox", the event and notice text of the card, and the
// Apply. One card type, `environment`, with three kinds:
//   spec    set or clear a project's pinned tools and apt packages (normalizeEnvSpec; Apply = the put and delete …/exec-env/spec routes' code)
//   build   build a project's template or image from its spec      (Apply = POST …/exec-env/build)
//   config  a project's sandbox network (open | allow) and its template / image field (Apply = PATCH …/exec-env/config)
// The MCP child validates for the model's self-correction; the parent turn re-validates and mints the card; the card
// route applies it behind the user's click, through the same functions the routes call. A spec names tools and Debian
// packages only: never a file, an env value or a secret.
import { normalizeEnvSpec } from '../exec-env/env-spec.mjs';
import { listExecBackends, getExecBackend } from '../exec-env/registry.mjs';
import { readProjectExecEnv } from '../config.mjs';
import { listProjects } from '../projects.mjs';
import { setProjectEnvSpec, clearProjectEnvSpec, setProjectBackendConfig } from '../exec-env/project-env.mjs';

export const ENV_CARD_TYPE = 'environment';
/** The tools whose result mints an environment card (events.mjs / turn.mjs). */
export const ENV_PROPOSAL_TOOLS = Object.freeze(['propose_environment_spec_change', 'propose_environment_build']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const toolsText = (s) => (s && Array.isArray(s.tools) && s.tools.length ? s.tools.map((t) => `${t.name} ${t.version}`).join(', ') : 'none');
const aptText = (s) => (s && Array.isArray(s.apt) && s.apt.length ? s.apt.join(', ') : 'none');
const noteOf = (inp) => clip(str(inp.note), 200);

/**
 * @param {object} [r]
 * @param {() => Promise<object[]>} [r.listProjects]
 * @param {(key:string) => {config:object, spec:object|null, builds:object}} [r.readProjectExecEnv]
 * @param {() => object[]} [r.backends]   the registered execution backends
 */
export function createEnvProposalValidators(r = {}) {
  const R = { listProjects, readProjectExecEnv, backends: listExecBackends, ...r };
  async function projectOf(inp) {
    const key = str(inp.projectKey);
    if (!key) return { error: 'projectKey is required (list_projects gives it), or pin the project as the chat\'s scope' };
    const p = (await R.listProjects()).find((x) => x && x.key === key);
    if (!p) return { error: `unknown project "${key}"` };
    if (p.vcs && p.vcs !== 'git') return { error: `${p.name || key} is a Folder project: a sandbox takes git projects only, so it has no sandbox environment` };
    let rec;
    try { rec = R.readProjectExecEnv(key); } catch (err) { return { error: String(err && err.message ? err.message : err) }; }
    return { project: p, rec };
  }
  const backendOf = (name, { build = false } = {}) => {
    const all = R.backends();
    const b = name ? all.find((x) => x.name === name) : (build ? all.find((x) => x.capabilities.buildEnvironment) : null);
    if (!b) return { error: name ? `unknown backend "${name}" — one of ${all.map((x) => x.name).join(', ')}` : 'backend is required — one of ' + all.map((x) => x.name).join(', ') };
    return { backend: b };
  };
  const target = (p) => ({ projectKey: p.key, projectName: p.name || p.key });

  /** propose_environment_spec_change: {projectKey, tools?, apt?, clear?, note?}. */
  async function validateSpecChange(input) {
    const inp = isObj(input) ? input : {};
    const { project, rec, error } = await projectOf(inp);
    if (error) return { ok: false, errors: [error] };
    const before = rec.spec || null;
    if (inp.clear !== undefined && typeof inp.clear !== 'boolean') return { ok: false, errors: ['clear must be true or false'] };
    if (inp.clear === true) {
      if (inp.tools !== undefined || inp.apt !== undefined) return { ok: false, errors: ['clear takes no tools or apt: it removes the whole spec'] };
      if (!before) return { ok: false, errors: [`${project.name || project.key} has no environment spec to clear`] };
      return { ok: true, card: { type: ENV_CARD_TYPE, kind: 'spec', ...target(project), summary: `Clear the environment spec of ${clip(project.name || project.key, 80)}`,
        change: { clear: true }, changes: [{ label: 'Tools', before: toolsText(before), after: 'none' }, { label: 'Apt packages', before: aptText(before), after: 'none' }],
        ...(noteOf(inp) ? { note: noteOf(inp) } : {}) } };
    }
    if (inp.tools === undefined && inp.apt === undefined) return { ok: false, errors: ['give tools and/or apt (the whole new list of each), or clear: true'] };
    let spec;
    // Omitted keeps the current list: the card still shows and saves the whole spec.
    try { spec = normalizeEnvSpec({ tools: inp.tools !== undefined ? inp.tools : (before ? before.tools : []), apt: inp.apt !== undefined ? inp.apt : (before ? before.apt : []) }); }
    catch (err) { return { ok: false, errors: [String(err && err.message ? err.message : err)] }; }
    if (before && before.hash === spec.hash) return { ok: false, errors: ['the spec already holds exactly these tools and packages'] };
    const { hash, ...body } = spec;
    return { ok: true, card: { type: ENV_CARD_TYPE, kind: 'spec', ...target(project), summary: `Set the environment spec of ${clip(project.name || project.key, 80)}`,
      change: { clear: false, spec: body }, changes: [{ label: 'Tools', before: toolsText(before), after: toolsText(spec) }, { label: 'Apt packages', before: aptText(before), after: aptText(spec) }],
      rebuildNote: 'A saved spec changes nothing until its template or image is built again (propose_environment_build).',
      ...(noteOf(inp) ? { note: noteOf(inp) } : {}) } };
  }

  /** propose_environment_build: {projectKey, backend?, note?}. */
  async function validateBuild(input) {
    const inp = isObj(input) ? input : {};
    const { project, rec, error } = await projectOf(inp);
    if (error) return { ok: false, errors: [error] };
    const { backend: b, error: berr } = backendOf(str(inp.backend), { build: true });
    if (berr) return { ok: false, errors: [berr] };
    if (!b.capabilities.buildEnvironment) return { ok: false, errors: [`${b.label} cannot build project environments`] };
    if (!rec.spec) return { ok: false, errors: [`${project.name || project.key} has no environment spec yet: set one first (propose_environment_spec_change)`] };
    const name = typeof b.environmentName === 'function' ? b.environmentName(project.key) : null;
    const build = rec.builds && rec.builds[b.name];
    return { ok: true, card: { type: ENV_CARD_TYPE, kind: 'build', ...target(project), backend: b.name, backendLabel: b.label, noun: b.environmentNoun,
      summary: `Build the ${b.environmentNoun} of ${clip(project.name || project.key, 80)} on ${b.label}`,
      change: { backend: b.name },
      changes: [{ label: `${b.environmentNoun[0].toUpperCase()}${b.environmentNoun.slice(1)}`, before: build && build.name ? build.name : 'none built yet', after: name || 'a new build' },
        { label: 'Tools', before: '', after: toolsText(rec.spec) }, { label: 'Apt packages', before: '', after: aptText(rec.spec) }],
      buildNote: `The build runs on this Worca server, in the background, and uses ${b.title} credit. Runs keep the previous ${b.environmentNoun} until it succeeds.`,
      ...(noteOf(inp) ? { note: noteOf(inp) } : {}) } };
  }

  /** propose_project_change kind "sandbox": {projectKey, backend, network?: open|allow, template?, image?, note?}. */
  async function validateSandboxConfig(input) {
    const inp = isObj(input) ? input : {};
    const { project, rec, error } = await projectOf(inp);
    if (error) return { ok: false, errors: [error] };
    const { backend: b, error: berr } = backendOf(str(inp.backend));
    if (berr) return { ok: false, errors: [berr] };
    const fields = new Map((b.projectFields || []).map((f) => [f.key, f]));
    const values = {};
    const asked = { network: 'egress', template: 'template', image: 'image' };
    for (const [k, key] of Object.entries(asked)) {
      if (inp[k] === undefined) continue;
      if (!fields.has(key)) return { ok: false, errors: [`${b.label} has no ${k} setting${fields.size ? ` (it has ${[...fields.keys()].map((x) => (x === 'egress' ? 'network' : x)).join(', ')})` : ''}`] };
      const v = inp[k] === null ? null : str(inp[k]);
      if (v && !fields.get(key).validate(v)) return { ok: false, errors: [`${k}: must be ${fields.get(key).hint}`] };
      values[key] = v || null;
    }
    if (!Object.keys(values).length) return { ok: false, errors: ['give network ("open" | "allow"), and/or the template or image field the backend has'] };
    const cur = (rec.config && rec.config[b.name]) || {};
    const word = (key, v) => (key === 'egress' ? (v === 'allow' ? 'Allow listed hosts only' : 'Open') : v || 'default');
    const changes = Object.entries(values).map(([key, v]) => ({ label: fields.get(key).label, before: word(key, cur[key] ?? null), after: word(key, v) }))
      .filter((c) => c.before !== c.after);
    if (!changes.length) return { ok: false, errors: ['the project already has these sandbox settings'] };
    return { ok: true, card: { type: ENV_CARD_TYPE, kind: 'config', ...target(project), backend: b.name, backendLabel: b.label,
      summary: `Change the ${b.label} settings of ${clip(project.name || project.key, 80)}`, change: { backend: b.name, values }, changes,
      ...(values.egress === 'allow' ? { networkNote: 'Allow reaches only the hosts the operator listed (WORCA_EGRESS_ALLOW); the model relay still works.' } : {}),
      ...(noteOf(inp) ? { note: noteOf(inp) } : {}) } };
  }

  return { validateSpecChange, validateBuild, validateSandboxConfig };
}

const real = createEnvProposalValidators();
/** The parent's (and the MCP child's) validators, bound to the real registry. */
export const validateEnvSpecChange = real.validateSpecChange;
export const validateEnvBuild = real.validateBuild;
export const validateSandboxConfig = real.validateSandboxConfig;
/** One validator per tool name (turn.mjs _onEnvProposal). */
export function validateEnvProposal(name, input, validators = real) {
  if (name === 'propose_environment_spec_change') return validators.validateSpecChange(input);
  if (name === 'propose_environment_build') return validators.validateBuild(input);
  if (name === 'propose_project_change') return validators.validateSandboxConfig(input);
  return Promise.resolve({ ok: false, errors: [`unknown environment tool ${name}`] });
}

/**
 * Behind the card's Apply: re-validates against the project as it is now, then writes through the routes' own code.
 * @param {object} card
 * @param {{startBuild?: (o:{projectKey:string, backend:string}) => object, validators?: object, setSpec?: Function, clearSpec?: Function, setConfig?: Function}} [io]
 * @returns {Promise<{ok:true, detail:string, jobId?:string}>}
 */
export async function applyEnvironmentChange(card, io = {}) {
  const v = io.validators || real;
  const invalid = (r) => Object.assign(new Error((r && r.errors ? r.errors : ['invalid proposal']).join('; ')), { code: 'INVALID' });
  const ch = (card && card.change) || {};
  if (card.kind === 'spec') {
    if (ch.clear === true) {
      (io.clearSpec || clearProjectEnvSpec)(card.projectKey);
      return { ok: true, detail: 'The environment spec is cleared. Builds made from it stay until you build again.' };
    }
    const r = await v.validateSpecChange({ projectKey: card.projectKey, tools: ch.spec?.tools ?? [], apt: ch.spec?.apt ?? [] });
    if (!r.ok && !/already holds exactly/.test((r.errors || []).join(' '))) throw invalid(r);
    (io.setSpec || setProjectEnvSpec)(card.projectKey, ch.spec || {});
    return { ok: true, detail: 'Saved. Build the template or image again to use it.' };
  }
  if (card.kind === 'build') {
    const r = await v.validateBuild({ projectKey: card.projectKey, backend: ch.backend });
    if (!r.ok) throw invalid(r);
    if (typeof io.startBuild !== 'function') throw new Error('environment builds run only in the worca server');
    const job = io.startBuild({ projectKey: card.projectKey, backend: ch.backend });
    return { ok: true, jobId: job && job.id ? job.id : null, detail: `The build started (${job && job.id ? job.id : 'a background job'}). The project page shows its progress.` };
  }
  if (card.kind === 'config') {
    getExecBackend(ch.backend);   // throws for a backend this build no longer has
    (io.setConfig || setProjectBackendConfig)(card.projectKey, ch.backend, ch.values || {});
    return { ok: true, detail: 'Saved. New runs of the project use it.' };
  }
  throw new Error(`unknown environment change kind "${card && card.kind}"`);
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');
/** `[worca event] environment card …` — the synthetic turn's prompt after the user acted on the card. */
export function envEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 160);
  if (state === 'declined') return `[worca event] environment card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] environment card ${cardId} failed${result?.code ? ` (${eventText(result.code, 40)})` : ''}: ${eventText(result?.error || 'unknown error', 300)}; "${summary}"`;
  return `[worca event] environment card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}
/** The user-row notice above the event turn. */
export function envNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 120);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
