// ui/public/shape/check-row.mjs — the shape/outline check row (spec D6, §3.8): passing checks as chips, each failing
// one with its detail and, when given, a Fix button.
export function buildCheckRow(doc, check, { onFix = null } = {}) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const row = h('div', 'plan-check');
  for (const it of check.items) {
    if (it.pass) { row.appendChild(h('span', 'plan-check-ok', `✓ ${it.label}`)); continue; }
    const bad = h('div', 'plan-check-bad');
    bad.append(h('span', 'plan-check-label', it.label), h('span', 'plan-check-detail', it.detail || ''));
    if (onFix) {
      const fix = h('button', 'btn plan-fix', 'Fix'); fix.type = 'button';
      fix.addEventListener('click', () => onFix(it));
      bad.appendChild(fix);
    }
    row.appendChild(bad);
  }
  return row;
}
