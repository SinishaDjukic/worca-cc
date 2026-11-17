// ui/public/run-scope-line.mjs — E9 on the run page: every path the run's agents touched outside their checkout,
// folded into ONE quiet line under the banners ("3 steps touched 4 files outside the checkout · Details"). Details
// opens an inline list grouped by step. Muted, not a banner: a path in another run's folder or another session's
// scratch (the data channel E9 exists for) turns the one line amber. Expected paths never reach it (exec-manifest.mjs).
import { scopeSummaryText } from './graph/run-decor.mjs';

let seq = 0;

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function fillDetails(doc, details, scope) {
  details.replaceChildren();
  for (const g of scope.groups) {
    const step = el(doc, 'div', 'run-scope-step');
    step.appendChild(el(doc, 'div', 'run-scope-step-name', g.label));
    const ul = el(doc, 'ul', 'run-scope-paths');
    for (const p of g.paths) {
      const li = el(doc, 'li');
      li.appendChild(el(doc, 'code', 'run-scope-path', p.path));
      if (p.tool) { li.appendChild(doc.createTextNode(' ')); li.appendChild(el(doc, 'span', 'run-scope-tool', p.tool)); }
      if (p.cross) { li.appendChild(doc.createTextNode(' ')); li.appendChild(el(doc, 'span', 'run-scope-x', 'another run or session')); }
      ul.appendChild(li);
    }
    const more = g.count - g.paths.length;
    if (more > 0) ul.appendChild(el(doc, 'li', 'run-scope-more', `and ${more} more`));
    step.appendChild(ul);
    details.appendChild(step);
  }
  details.appendChild(el(doc, 'p', 'run-scope-note',
    'Each step\'s full list, with the paths it was expected to touch, is in executions.ndjson in the run\'s pipeline folder.'));
}

/**
 * Paint `scope` (decor.scope: `{steps, files, cross, groups}` or null) as the host's one `.run-scope` line, after its
 * banners. Idempotent; an open Details list stays open across repaints; null removes the line.
 */
export function paintRunScope(host, scope, { doc = host?.ownerDocument } = {}) {
  if (!host) return;
  let line = host.querySelector(':scope > .run-scope');
  if (!scope || !Array.isArray(scope.groups) || !scope.groups.length) { if (line) line.remove(); return; }
  if (!line) {
    line = el(doc, 'div', 'run-scope');
    line.setAttribute('role', 'status');
    const sum = el(doc, 'span', 'run-scope-sum');
    const btn = el(doc, 'button', 'run-scope-toggle', 'Details');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    const details = el(doc, 'div', 'run-scope-details');
    details.id = `run-scope-details-${++seq}`;
    details.hidden = true;
    btn.setAttribute('aria-controls', details.id);
    btn.addEventListener('click', () => {
      details.hidden = !details.hidden;
      btn.setAttribute('aria-expanded', String(!details.hidden));
    });
    line.append(sum, doc.createTextNode(' · '), btn, details);
    host.appendChild(line);
  }
  line.classList.toggle('run-scope-cross', scope.cross === true);
  line.querySelector('.run-scope-sum').textContent = scopeSummaryText(scope)
    + (scope.cross === true ? ', some in another run or session' : '');
  fillDetails(doc, line.querySelector('.run-scope-details'), scope);
}
