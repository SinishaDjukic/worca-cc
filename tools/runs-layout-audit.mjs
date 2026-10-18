// tools/runs-layout-audit.mjs — the Runs list layout rules (runs redesign §3.3a, Known bugs 5, 8, 9) as one function
// that runs in a real page (tools/verify-runs-list-cdp.mjs, env = null) and in jsdom with injected rects
// (test/runs-layout-audit.test.mjs). Self-contained: the CDP script injects its source text, so no imports.
export function auditRunsLayout(root, env, doc = root.ownerDocument) {
  const win = doc.defaultView;
  const rect = env && env.rect ? env.rect : (n) => n.getBoundingClientRect();
  const vp = env && env.viewport ? env.viewport : { width: win.innerWidth, height: win.innerHeight };
  const out = [];
  const ends = [];
  for (const item of root.querySelectorAll('.runs-item')) {
    for (const n of item.querySelectorAll(':scope > a.runs-row > .runs-row-right, :scope > a.runs-row > .runs-stage .run-prog-track, :scope > a.runs-row > .runs-row-prog')) {
      const r = rect(n);
      if (r.width > 0) ends.push({ n, x: r.right });
    }
    // The bar marks ("Plan Build Review Ready") are labels, not statements: only the line and the right column count.
    const text = (sel) => [...item.querySelectorAll(`:scope > a.runs-row > ${sel}`)].map((n) => n.textContent).join(' ');
    const said = `${text('.runs-row-sub')} ${text('.runs-row-right')}`;
    const facts = [item.dataset.stateWord, ...[...item.querySelectorAll(':scope > a.runs-row .runs-count')].map((n) => n.textContent)].filter(Boolean);
    for (const f of facts) {
      const times = said.split(f).length - 1;
      if (times > 1) out.push({ rule: 'fact-twice', got: `"${f}" x${times}`, text: item.querySelector('.runs-row-title')?.textContent || '' });
    }
  }
  if (ends.length) {
    const x0 = Math.max(...ends.map((e) => e.x));
    for (const e of ends) if (Math.abs(e.x - x0) > 1) out.push({ rule: 'right-edge', got: `${e.x} vs ${x0}`, text: e.n.className });
  }
  for (const m of doc.querySelectorAll('.wfv-menu, .group-picker')) {
    const r = rect(m);
    if (!r.width) continue;
    if (r.left < 0 || r.top < 0 || r.right > vp.width || r.bottom > vp.height) out.push({ rule: 'off-screen', got: `${r.left},${r.top} to ${r.right},${r.bottom}`, text: m.className });
  }
  return out;
}
