// New pipeline › the pre-run model check (src/core/model-check.mjs via GET /api/run/model-check):
// the warning line's text. Pure — no DOM, unit-tested.

/** @returns {string|null} the line, or null when there is nothing to warn about */
export function modelCheckNote(data) {
  if (!data || data.ok !== false || !Array.isArray(data.problems) || !data.problems.length) return null;
  const parts = data.problems.map((p) => {
    const who = p.model || 'Claude Code\'s default model';
    const nodes = Array.isArray(p.nodes) && p.nodes.length ? ` (${p.nodes.join(', ')})` : '';
    return `${who}${nodes} — ${p.message}. Fix: ${p.fix}.`;
  });
  return `This run can't start yet: ${parts.join(' ')}`;
}
