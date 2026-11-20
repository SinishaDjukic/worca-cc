// src/core/requirements/attach.mjs
// Attaching started features to a run or a chat (FEAT-21): resolve the seqs to content, search features for the picker and the
// `#` popover, and compose the prompt text. Content comes ONLY from the latest started version (req_starts), never from the
// feature's draft spec. Imports leaf siblings only (never routes.mjs); no top-level side effects.
import { realpath } from 'node:fs/promises';
import { RequirementsError, SCOPE_TYPES, parseFeatureSeq, featureId } from './spec.mjs';
import { getFeature, latestStart, listFeatures } from './store.mjs';
import { renderSpecMarkdown } from './markdown.mjs';
import { checkTarget } from './target.mjs';
import { liveRunId } from './start.mjs';

export const MAX_ATTACHED = 10;
export const NOT_STARTED_LABEL = 'Not started yet';

/** Distinct seqs in the order given; a bad one is BAD_REQUEST, more than MAX_ATTACHED is REQUIREMENTS_LIMIT. */
function parseSeqs(seqs) {
  if (!Array.isArray(seqs)) throw new RequirementsError('BAD_REQUEST', 'seqs must be a list');
  const out = [];
  for (const v of seqs) {
    const seq = parseFeatureSeq(v);
    if (seq === null) throw new RequirementsError('BAD_REQUEST', `"${String(v).slice(0, 40)}" is not a feature number`);
    if (!out.includes(seq)) out.push(seq);
  }
  if (out.length > MAX_ATTACHED) {
    throw new RequirementsError('BAD_REQUEST', `You can attach up to ${MAX_ATTACHED} features.`, { code: 'REQUIREMENTS_LIMIT' });
  }
  return out;
}

const realOrNull = async (p) => { try { return await realpath(p); } catch { return null; } };

/** Whether a feature belongs to `scope` ({ type, key, projectDir? }): same type and key; a project also matches by the folder
 *  its key registers when the scope names a projectDir. A workspace is never matched by folder. */
async function inScope(feature, scope) {
  if (feature.scopeType !== scope.type) return false;
  if (scope.key && feature.scopeKey === scope.key) return true;
  if (scope.type !== 'project' || !scope.projectDir) return false;
  try {
    const target = await checkTarget('project', feature.scopeKey);
    const [a, b] = await Promise.all([realOrNull(target.path), realOrNull(scope.projectDir)]);
    return Boolean(a) && a === b;
  } catch { return false; }
}

/** `# FEAT-7 v2: title` as the first line, then the started spec as renderSpecMarkdown renders it. The heading carries the
 *  title the start froze, so a later rename never relabels a version. */
function startedMarkdown(feature, start) {
  const title = start.title || feature.title;
  const lines = renderSpecMarkdown({ ...feature, title, spec: start.spec }).split('\n');
  lines[0] = `# ${feature.id} v${start.version}: ${title}`;
  return lines.join('\n');
}

const blank = (seq, status, title = null) => ({
  seq, id: featureId(seq), title, status, version: null, ready: null, criteriaCount: null, markdown: null, liveRunId: null,
});

async function resolveOne(seq, { scope, runSummary, withMarkdown }) {
  const feature = getFeature(seq);
  if (!feature) return blank(seq, 'missing');
  const start = latestStart(seq);
  const item = {
    ...blank(seq, 'ok', feature.title),
    version: start ? start.version : null, ready: start ? Boolean(start.ready) : null,
    criteriaCount: start ? start.spec.criteria.length : null,
  };
  if (feature.status === 'archived') return { ...item, status: 'archived' };
  if (!start) return { ...item, status: 'not_started' };
  if (scope && !(await inScope(feature, scope))) return { ...item, status: 'wrong_scope' };
  return {
    ...item,
    markdown: withMarkdown ? startedMarkdown(feature, start) : null,
    liveRunId: runSummary ? await liveRunId(seq, runSummary) : null,
  };
}

/** Each seq's state and, when asked, its markdown, from the newest STARTED version. */
export async function resolveAttachments(seqs, { scope = null, runSummary = null, withMarkdown = false } = {}) {
  const parsed = parseSeqs(seqs);
  const items = [];
  for (const seq of parsed) items.push(await resolveOne(seq, { scope, runSummary, withMarkdown }));
  return { items };
}

const rank = (r) => (!r.startable ? 2 : r.ready ? 0 : 1);

/** Features of one scope for the picker and the `#` popover: archived and `exclude` left out; `q` is a case-insensitive title
 *  substring or an id (`FEAT-7`, `7`); Ready started first, then started, then not started; ties by seq, newest first. */
export function searchFeatures({ scopeType, scopeKey, q = '', exclude = [], limit = 50 } = {}) {
  if (!SCOPE_TYPES.includes(scopeType)) throw new RequirementsError('BAD_REQUEST', 'scopeType must be "project" or "workspace"');
  if (typeof scopeKey !== 'string' || !scopeKey.trim()) throw new RequirementsError('BAD_REQUEST', 'scopeKey is required');
  const skip = new Set((Array.isArray(exclude) ? exclude : []).map(parseFeatureSeq).filter((s) => s !== null));
  const needle = String(q ?? '').trim().toLowerCase();
  const idMatch = parseFeatureSeq(needle.toUpperCase());
  const max = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const rows = [];
  for (const f of listFeatures({ scopeType, scopeKey })) {
    if (skip.has(f.seq)) continue;
    if (needle && !f.title.toLowerCase().includes(needle) && f.seq !== idMatch) continue;
    const start = latestStart(f.seq);
    rows.push({
      seq: f.seq, id: f.id, title: f.title, criteriaCount: start ? start.spec.criteria.length : null,
      ready: Boolean(start && start.ready), startable: Boolean(start), label: start ? null : NOT_STARTED_LABEL,
    });
  }
  rows.sort((a, b) => rank(a) - rank(b) || b.seq - a.seq);
  return { features: rows.slice(0, max) };
}

/** The user's text, then each attached feature's markdown under one heading. Pure. */
export function composeAttachedPrompt(items, userText) {
  return `${userText || ''}\n\n## Attached requirements\n\n${items.map((i) => i.markdown).join('\n')}`;
}

const UNAVAILABLE_WHY = { archived: 'archived', missing: 'deleted', not_started: 'not started', wrong_scope: 'not in this target' };
const refuse = (status, body) => ({ refusal: { status, body } });
const featureLabel = (f) => `${f.id}${f.title ? ` "${f.title}"` : ''}`;

/** The 409 REQUIREMENTS_UNAVAILABLE refusal for the resolved `items` that are not `ok`, or null when every one is usable.
 *  One shape for a run start and a chat message. */
export function unavailableRefusal(items) {
  const gone = items.filter((i) => i.status !== 'ok');
  if (!gone.length) return null;
  const features = gone.map((i) => ({ seq: i.seq, id: i.id, title: i.title, reason: UNAVAILABLE_WHY[i.status] || i.status }));
  return refuse(409, { code: 'REQUIREMENTS_UNAVAILABLE', features,
    error: `Remove ${featureLabel(features[0])} (${features[0].reason}) to continue.` });
}

/** A run start's attached requirements: `body.requirements` is `[{seq}]` and nothing else of it is read. Resolved now, from each
 *  feature's newest STARTED version, against this run's own target. `{ attached: [], items: [] }` when the field is absent or
 *  empty (the start is unchanged); `{ refusal: { status, body } }` when it must not go on. `deps` carries the server's own
 *  `flagEnabled`, `resolveProjectDir`, `projectKey`, `runSummary` and the error-code `httpStatus` table. */
export async function resolveRunAttachments(body, { noProject, hasWorkspace, source }, deps) {
  const none = { attached: [], items: [] };
  if (body.requirements === undefined || body.requirements === null) return none;
  if (!Array.isArray(body.requirements)) return refuse(400, { error: 'requirements must be a list of { seq }' });
  if (!body.requirements.length) return none;
  if (!deps.flagEnabled('requirements')) return refuse(403, { error: 'Requirements disabled', code: 'REQUIREMENTS_DISABLED' });
  if (noProject) return refuse(400, { error: 'Requirements attach to a project or workspace run, not to a run without a project.', code: 'REQUIREMENTS_SCOPE' });
  if (source) return refuse(400, { error: 'Requirements cannot be attached to a run that starts from a plugin task.', code: 'REQUIREMENTS_SOURCE' });
  const dir = hasWorkspace ? null : deps.resolveProjectDir(body.projectDir);
  const scope = hasWorkspace
    ? { type: 'workspace', key: String(body.workspaceId).trim().replace(/^workspaces\//, '') }
    : { type: 'project', key: dir ? deps.projectKey(dir) : null, projectDir: dir };
  let items;
  try {
    ({ items } = await resolveAttachments(body.requirements.map((r) => (r && typeof r === 'object' ? r.seq : undefined)),
      { scope, runSummary: deps.runSummary, withMarkdown: true }));
  } catch (err) {
    if (!(err instanceof RequirementsError)) throw err;
    return refuse(deps.httpStatus[err.code] || 500, { ...(err.data || {}), error: err.message });
  }
  const unavailable = unavailableRefusal(items);
  if (unavailable) return unavailable;
  const busy = items.filter((i) => i.liveRunId);
  if (busy.length && body.confirmAttachedRunning !== true) {
    return refuse(409, { code: 'RUN_IN_PROGRESS', runId: busy[0].liveRunId,
      error: `${featureLabel(busy[0])} already has a run in progress. Start another run anyway?`,
      features: busy.map((i) => ({ seq: i.seq, id: i.id, title: i.title, runId: i.liveRunId })) });
  }
  const attached = items.map((i) => ({ seq: i.seq, id: i.id, title: i.title, version: i.version, ready: i.ready,
    criteriaCount: i.criteriaCount, agreed: i.ready }));
  return { attached, items };
}
