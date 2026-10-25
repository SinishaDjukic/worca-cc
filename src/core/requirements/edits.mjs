// src/core/requirements/edits.mjs
// The product owner's edits (plans/requirements-design.md D6): ground truth the model may ask about but
// never undo. Every edit is a turn, so the next round sees it in the thread.
import { RequirementsError, SECTIONS, SCOPE_TYPES, ASSUMPTION_STATUSES, LIMITS, clip, normalizeSection, nextIdNumber } from './spec.mjs';
import { requireFeature, updateFeature, appendTurn, listTurns, listStarts, latestStart, usableBrief, setBriefSections } from './store.mjs';
import { BRIEF_LIMITS, relPath } from './brief.mjs';
import { tx } from '../db.mjs';
import { isBusy } from './interview.mjs';
import { isStarting, STARTING_MESSAGE as STARTING } from './starting.mjs';

/** A feature the product owner may edit: not busy (the A1 lock), not archived. The file routes use it too (A8 D10). */
export function editable(seq) {
  const f = requireFeature(seq);
  if (isBusy(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', 'this feature is archived; restore it first');
  return f;
}
const itemText = (v) => {
  const s = clip(v, LIMITS.item);
  if (!s) throw new RequirementsError('BAD_REQUEST', 'text is required');
  return s;
};

export function updateHeader(seq, { title, description, scopeType, scopeKey } = {}, { by = null } = {}) {
  editable(seq);
  const patch = {};
  if (title !== undefined) {
    const t = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';   // one line, as on create
    if (!t || t.length > LIMITS.title) throw new RequirementsError('BAD_REQUEST', `title must be 1 to ${LIMITS.title} characters`);
    patch.title = t;
  }
  if (description !== undefined) {
    const d = typeof description === 'string' ? description.trim() : '';
    if (!d || d.length > LIMITS.description) throw new RequirementsError('BAD_REQUEST', `description must be 1 to ${LIMITS.description} characters`);
    patch.description = d;
  }
  if (scopeType !== undefined || scopeKey !== undefined) {
    if (!SCOPE_TYPES.includes(scopeType) || typeof scopeKey !== 'string' || !scopeKey.trim()) {
      throw new RequirementsError('BAD_REQUEST', 'give scopeType ("project" or "workspace") and scopeKey together');
    }
    patch.scopeType = scopeType;
    patch.scopeKey = scopeKey.trim();
  }
  const f = requireFeature(seq);
  const header = [];
  if (patch.title !== undefined && patch.title !== f.title) header.push('title');
  if (patch.description !== undefined && patch.description !== f.description) header.push('description');
  if (patch.scopeType !== undefined && (patch.scopeType !== f.scopeType || patch.scopeKey !== f.scopeKey)) {
    // A run works on the target it was started for (A2 D8): the scope is fixed from the first start on,
    // and while a start is in flight (its row is not written yet).
    if (isStarting(seq)) throw new RequirementsError('BUSY', STARTING);
    if (latestStart(seq)) throw new RequirementsError('CONFLICT', 'this feature has been started; its project or workspace can no longer change');
    header.push('scope');
  }
  if (!header.length) return updateFeature(seq, patch, { by });
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { header } }, { by });
    return updateFeature(seq, patch, { by });
  });
}

export function setSection(seq, section, value, { by = null } = {}) {
  const f = editable(seq);
  if (!SECTIONS.includes(section)) throw new RequirementsError('BAD_REQUEST', `unknown section "${String(section).slice(0, 40)}"`);
  const spec = { ...f.spec, [section]: normalizeSection(section, value), edited: { ...f.spec.edited, [section]: true } };
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { section } }, { by });
    return updateFeature(seq, { spec }, { by });
  });
}

export function releaseSection(seq, section, { by = null } = {}) {
  const f = editable(seq);
  if (!SECTIONS.includes(section)) throw new RequirementsError('BAD_REQUEST', `unknown section "${String(section).slice(0, 40)}"`);
  const edited = { ...f.spec.edited };
  delete edited[section];
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { section, released: true } }, { by });
    return updateFeature(seq, { spec: { ...f.spec, edited } }, { by });
  });
}

export function addCriterion(seq, text, { by = null } = {}) {
  const f = editable(seq);
  const t = itemText(text);
  const n = nextIdNumber(f.criteriaSeq, f.spec.criteria, 'R-po-');
  const id = `R-po-${n}`;
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { criterion: id, action: 'added' } }, { by });
    return updateFeature(seq, { criteriaSeq: n, spec: { ...f.spec, criteria: [...f.spec.criteria, { id, text: t, edited: true }] } }, { by });
  });
}

export function editCriterion(seq, id, text, { by = null } = {}) {
  const f = editable(seq);
  const t = itemText(text);
  if (!f.spec.criteria.some((c) => c.id === id)) throw new RequirementsError('NOT_FOUND', `no criterion ${String(id).slice(0, 20)}`);
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { criterion: id, action: 'edited' } }, { by });
    return updateFeature(seq, { spec: { ...f.spec, criteria: f.spec.criteria.map((c) => (c.id === id ? { id, text: t, edited: true, ...(c.source ? { source: c.source } : {}) } : c)) } }, { by });
  });
}

export function removeCriterion(seq, id, { by = null } = {}) {
  const f = editable(seq);
  const gone = f.spec.criteria.find((c) => c.id === id);
  if (!gone) throw new RequirementsError('NOT_FOUND', `no criterion ${String(id).slice(0, 20)}`);
  return tx(() => {
    // The text rides on the turn: the next rounds see what was removed and Worca never re-adds it (D6).
    appendTurn(seq, { kind: 'edit', payload: { criterion: id, action: 'removed', text: gone.text } }, { by });
    return updateFeature(seq, { spec: { ...f.spec, criteria: f.spec.criteria.filter((c) => c.id !== id) } }, { by });
  });
}

export function setAssumption(seq, id, status, { by = null } = {}) {
  const f = editable(seq);
  if (!ASSUMPTION_STATUSES.includes(status)) throw new RequirementsError('BAD_REQUEST', 'status must be open, confirmed or rejected');
  if (!f.spec.assumptions.some((a) => a.id === id)) throw new RequirementsError('NOT_FOUND', `no assumption ${String(id).slice(0, 20)}`);
  return tx(() => {
    appendTurn(seq, { kind: 'assumption', payload: { id, status } }, { by });
    return updateFeature(seq, { spec: { ...f.spec, assumptions: f.spec.assumptions.map((a) => (a.id === id ? { ...a, status } : a)) } }, { by });
  });
}

export function confirmOpenAssumptions(seq, { by = null } = {}) {
  const f = editable(seq);
  const ids = f.spec.assumptions.filter((a) => a.status === 'open').map((a) => a.id);
  if (!ids.length) throw new RequirementsError('CONFLICT', 'no open assumptions');
  return tx(() => {
    appendTurn(seq, { kind: 'assumption', payload: { ids, status: 'confirmed' } }, { by });
    return updateFeature(seq, { spec: { ...f.spec, assumptions: f.spec.assumptions.map((a) => (ids.includes(a.id) ? { ...a, status: 'confirmed' } : a)) } }, { by });
  });
}

/** Undo the changes made since a start (A2 D11): the spec goes back to that start's frozen copy. The id
 *  counters stay where they are (A1-D3), so an id given out after the start is never reused. */
export function revertToStart(seq, version, { by = null } = {}) {
  editable(seq);
  const start = listStarts(seq).find((s) => s.version === Number(version));
  if (!start) throw new RequirementsError('NOT_FOUND', `no build v${String(version).slice(0, 12)} of this feature`);
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { reverted: start.version } }, { by });
    return updateFeature(seq, { spec: start.spec }, { by });
  });
}

/**
 * **Add this to the brief** (A7 D11): the feature's closer look becomes an area of its scope's brief, named after
 * the feature and filed under the area the look named. The feature's own added area, if any (from an earlier
 * closer look), is updated in place; any other area, and every area Worca wrote (`added` null), is never
 * replaced. "What exists today" is not marked edited (D6), so the area survives a refresh as an added one.
 * The look's paths are the temporary checkout's, absolute: they are made relative. A workspace keeps
 * `repos/<member>/…` of the brief's own members (its `sources`), on purpose: files of a member added after
 * the brief are dropped, as staleness (D9) checks only those members. A look made for another scope (the feature
 * moved since), or before this brief (no brief id, or an earlier brief's), is refused. Returns the brief's scope,
 * for its frame.
 */
export function addToBrief(seq, { by = null } = {}) {
  const f = editable(seq);
  const where = f.scopeType === 'workspace' ? 'workspace' : 'project';
  const b = usableBrief(f.scopeType, f.scopeKey);
  if (!b) throw new RequirementsError('CONFLICT', `This ${where} has no product brief.`);
  const o = f.orientation;
  if (!o || !o.summary) throw new RequirementsError('CONFLICT', 'There is no closer look to add.');
  if (o.addedToBrief) throw new RequirementsError('CONFLICT', 'Already added to the brief.');
  // The look must be of this scope and of this brief: runOrientation stamps both (a look without a stamp, or one
  // made before the brief or against a brief deleted since, has no say in this brief).
  if (o.scopeType !== f.scopeType || o.scopeKey !== f.scopeKey) {
    if (o.scopeType != null || o.scopeKey != null) throw new RequirementsError('CONFLICT', 'This closer look was made for another project or workspace. Look again first.');
  }
  if (o.briefId == null || o.briefId !== b.id) throw new RequirementsError('CONFLICT', 'This closer look was made before the product brief. Look again first.');
  const areas = b.sections.areas || [];
  const own = areas.findIndex((a) => a && a.added && a.added.feature === f.id);
  if (own < 0 && areas.length >= BRIEF_LIMITS.areas) throw new RequirementsError('CONFLICT', `The brief already has ${BRIEF_LIMITS.areas} areas.`);
  const members = f.scopeType === 'workspace' ? (b.sources || []).map((s) => s && s.project).filter(Boolean) : null;
  const files = [];
  for (const p of Array.isArray(o.files) ? o.files : []) {
    const r = relPath(p, { cwds: [], members });
    if (r && !files.includes(r)) files.push(r);
  }
  const at = new Date().toISOString();
  const area = {
    name: clip(f.title, BRIEF_LIMITS.name), belongsTo: clip(o.area, BRIEF_LIMITS.name) || null, text: clip(o.summary, BRIEF_LIMITS.addedText),
    status: null, files: files.slice(0, BRIEF_LIMITS.areaFiles), added: { feature: f.id, at },
  };
  const next = own >= 0 ? areas.map((a, i) => (i === own ? area : a)) : [...areas, area];   // same place, new `added.at`
  tx(() => {
    setBriefSections(b.id, { sections: { ...b.sections, areas: next }, edited: b.edited }, { by });
    updateFeature(seq, { orientation: { ...o, addedToBrief: at } }, { by });
  });
  return { scopeType: f.scopeType, scopeKey: f.scopeKey };
}

export function setArchived(seq, archived, { by = null } = {}) {
  const f = requireFeature(seq);
  if (isBusy(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  if (isStarting(seq)) throw new RequirementsError('BUSY', STARTING);
  if (archived) return f.status === 'archived' ? f : updateFeature(seq, { status: 'archived' }, { by });
  if (f.status !== 'archived') return f;
  const lastRound = listTurns(seq).filter((t) => t.kind === 'round').at(-1);
  return updateFeature(seq, { status: lastRound?.payload.done ? 'done' : 'your_turn' }, { by });
}
