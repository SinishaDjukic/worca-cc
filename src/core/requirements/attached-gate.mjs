// src/core/requirements/attached-gate.mjs — the agreement gate for Requirements features attached to a run.
// Pure: no imports, no I/O, no mutation. An item needs the person's agreement until it is Ready or agreed.
// attached: [{ seq, id, title, version, ready, criteriaCount, agreed }]

const asList = (attached) => (Array.isArray(attached) ? attached : []);

/** An answer problem in the shape every plan body shows (`message`): never a bare string. */
const problem = (message) => ({ path: 'agreedSeqs', code: 'invalid', message });

const needsAgreement = (item) => item.ready !== true && item.agreed !== true;

/** The items that still need the person's agreement before any work starts. */
export function pendingAgreement(attached) {
  return asList(attached).filter(needsAgreement);
}

/** A new attached list with `agreed: true` on the listed seqs. The input is never mutated. */
export function applyAgreement(attached, seqs) {
  const agreed = new Set(Array.isArray(seqs) ? seqs : []);
  return asList(attached).map((item) => (agreed.has(item.seq) ? { ...item, agreed: true } : item));
}

/** Validate a plan answer against the attached list: `approve` must agree to every pending seq. */
export function validateAgreement(attached, answer) {
  const decision = answer && answer.decision;
  if (decision === 'stop') return { ok: true, errors: [] };
  if (decision !== 'approve') return { ok: false, errors: [problem(`unsupported decision: ${String(decision)}`)] };
  const agreed = new Set(Array.isArray(answer.agreedSeqs) ? answer.agreedSeqs : []);
  const missing = pendingAgreement(attached).map((item) => item.seq).filter((seq) => !agreed.has(seq));
  if (missing.length === 0) return { ok: true, errors: [] };
  return { ok: false, errors: [problem(`agreedSeqs is missing pending seq(s): ${missing.join(', ')}`)] };
}
