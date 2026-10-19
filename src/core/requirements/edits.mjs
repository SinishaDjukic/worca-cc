// src/core/requirements/edits.mjs
// The product owner's edits (plans/requirements-design.md D6): ground truth the model may ask about but
// never undo. Every edit is a turn, so the next round sees it in the thread.
import { RequirementsError, SECTIONS, SCOPE_TYPES, ASSUMPTION_STATUSES, LIMITS, clip, normalizeSection, nextIdNumber } from './spec.mjs';
import { requireFeature, updateFeature, appendTurn, listTurns } from './store.mjs';
import { tx } from '../db.mjs';
import { isBusy } from './interview.mjs';

function editable(seq) {
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
    const t = typeof title === 'string' ? title.trim() : '';
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
  if (patch.scopeType !== undefined && (patch.scopeType !== f.scopeType || patch.scopeKey !== f.scopeKey)) header.push('scope');
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
    return updateFeature(seq, { spec: { ...f.spec, criteria: f.spec.criteria.map((c) => (c.id === id ? { id, text: t, edited: true } : c)) } }, { by });
  });
}

export function removeCriterion(seq, id, { by = null } = {}) {
  const f = editable(seq);
  if (!f.spec.criteria.some((c) => c.id === id)) throw new RequirementsError('NOT_FOUND', `no criterion ${String(id).slice(0, 20)}`);
  return tx(() => {
    appendTurn(seq, { kind: 'edit', payload: { criterion: id, action: 'removed' } }, { by });
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

export function setArchived(seq, archived, { by = null } = {}) {
  const f = requireFeature(seq);
  if (isBusy(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  if (archived) return f.status === 'archived' ? f : updateFeature(seq, { status: 'archived' }, { by });
  if (f.status !== 'archived') return f;
  const lastRound = listTurns(seq).filter((t) => t.kind === 'round').at(-1);
  return updateFeature(seq, { status: lastRound?.payload.done ? 'done' : 'your_turn' }, { by });
}
