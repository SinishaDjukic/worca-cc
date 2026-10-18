// src/shared/shape/route.mjs — Shaper s5: the Route card's labels and the verbs the two s5 card types accept (D5, D6).
// Pure, no imports. What a message means is Ask Worca's call (route_message), never a regex here.
export const ROUTE_CHOICES = Object.freeze(['add', 'own', 'save']);

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
