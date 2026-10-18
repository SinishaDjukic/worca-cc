// src/shared/shape/route.mjs — Shaper s5: the "Where does this go?" card's guess (D7), the question test (D9) and the
// verbs the two s5 card types accept (D5, D6). Pure, no imports.
const FIX = /\b(hotfix|urgent|asap|broken|crash(es|ed)?|prod(uction)?)\b/i;
const ASK = /^(what|why|how|when|where|who|which|can|could|does|did|is|are|should)\b/i;
const STOP = new Set(['this', 'that', 'with', 'from', 'into', 'also', 'make', 'have', 'every', 'there', 'their', 'when', 'what', 'should', 'would', 'could']);
const words = (t) => new Set(String(t || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter((w) => !STOP.has(w)) || []);
const NOT_STARTED = new Set(['planned', 'missed']);

/** D9: a question goes to Ask, never to a step or a card. */
export function isQuestion(text) {
  const t = String(text || '').trim();
  return t.endsWith('?') || ASK.test(t);
}

/** @returns {{choice: 'add'|'own'|'save', where: 'next'|'extra'|null, reason: string}} */
export function routeGuess(text, feature) {
  const title = (feature && feature.title) || 'the feature';
  if (FIX.test(String(text || ''))) return { choice: 'own', where: null, reason: `reads like a fix that should not wait for ${title}` };
  const upcoming = ((feature && feature.slices) || []).filter((s) => s.state !== 'done' && s.state !== 'canceled');
  const said = words(text);
  for (const s of upcoming) {
    const hit = [...words(`${s.title} ${s.goal || ''}`)].find((w) => said.has(w));
    if (hit) return { choice: 'add', where: NOT_STARTED.has(s.state) ? 'next' : 'extra', reason: `touches "${hit}", which run ${s.index} changes` };
  }
  const next = upcoming.find((s) => NOT_STARTED.has(s.state));
  if (next) return { choice: 'add', where: 'next', reason: `Run ${next.index} has not started yet: its plan can take it` };
  return { choice: 'save', where: null, reason: `nothing in ${title} is still to plan` };
}

export function routeLabel(choice, title) {
  return choice === 'add' ? `Add to ${title}` : choice === 'own' ? 'Own run now' : 'Save for later';
}

export function routeCardVerb(body) {
  const v = body && body.verb;
  if (v === 'add') {
    const where = body.where;
    return where === 'next' || where === 'extra' ? { ok: true, verb: 'add', where } : { ok: false, error: 'where must be "next" or "extra"' };
  }
  if (v === 'own' || v === 'save' || v === 'not-now') return { ok: true, verb: v };
  return { ok: false, error: 'verb must be add, own, save or not-now' };
}

export function changesCardVerb(body) {
  const v = body && body.verb;
  return v === 'start' || v === 'not-now' ? { ok: true, verb: v } : { ok: false, error: 'verb must be start or not-now' };
}
