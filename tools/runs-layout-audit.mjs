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
    // QA 2 / 8: no two row cells overlap, and the title keeps half the row while the right column shares its line.
    const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const rowEl = item.querySelector(':scope > a.runs-row');
    const titleEl = rowEl && rowEl.querySelector(':scope > .runs-row-title');
    if (titleEl) {
      const t = rect(titleEl);
      for (const c of rowEl.querySelectorAll(':scope > .runs-row-right > *')) {
        if (hit(t, rect(c))) out.push({ rule: 'overlap', got: c.className, text: titleEl.textContent });
      }
      const rightEl = rowEl.querySelector(':scope > .runs-row-right');
      const rr = rect(rowEl);
      const rt = rightEl ? rect(rightEl) : null;
      if (rt && rt.width > 0 && rt.top < t.bottom - 1 && t.width < rr.width / 2 - 1) out.push({ rule: 'title-share', got: `${t.width} of ${rr.width}`, text: titleEl.textContent });
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

/** Spec §3.3a: on the group page, title, status card, tabs and the Runs table share left and right edges, and every
 *  row's Open button ends at one x. `env.rect(el)` / `env.viewport` are injectable for jsdom; else the real layout. */
export function auditGroupPageLayout(root, env, doc) {
  const rect = (env && env.rect) || ((e) => e.getBoundingClientRect());
  const out = [];
  const blocks = ['.gpage > .ph', '.gpage-card', '.gpage-tabs', '.run-members.is-table'];
  const found = blocks.map((s) => [s, root.querySelector(s)]).filter(([, e]) => e && !e.closest('[hidden]'));
  const ref = found.length ? rect(found[0][1]) : null;
  for (const [s, e] of found.slice(1)) {
    const r = rect(e);
    if (Math.abs(r.left - ref.left) > 1 || Math.abs(r.right - ref.right) > 1) {
      out.push({ rule: 'edges', selector: s === '.run-members.is-table' ? '.run-members' : s, left: r.left, right: r.right, want: [ref.left, ref.right] });
    }
  }
  const opens = [...root.querySelectorAll('.run-members.is-table .run-member-go')].filter((e) => !e.closest('[hidden]'));
  const rights = opens.map((e) => rect(e).right);
  if (rights.length > 1 && Math.max(...rights) - Math.min(...rights) > 1) out.push({ rule: 'open-column', rights });
  const vw = (env && env.viewport && env.viewport.width) || (doc && doc.defaultView ? doc.defaultView.innerWidth : Infinity);
  for (const [s, e] of found) { const r = rect(e); if (r.right > vw + 1) out.push({ rule: 'off-screen', selector: s, right: r.right }); }
  // QA 8: inside each table row, the title, the PR chip and the cost never overlap, and no row runs past its table.
  const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  for (const li of root.querySelectorAll('.run-members.is-table > .run-member')) {
    const tr = rect(li.parentElement), lr = rect(li);
    if (lr && tr && lr.width > 0 && (lr.right > tr.right + 1 || lr.left < tr.left - 1)) out.push({ rule: 'row-overflow', got: `${lr.left}-${lr.right} vs ${tr.left}-${tr.right}`, text: li.querySelector('.run-member-title')?.textContent || '' });
    const cells = [li.querySelector('.run-member-title'), li.querySelector('.run-member-pr .runs-pr'), li.querySelector('.run-member-cost')]
      .filter((n) => n && n.textContent.trim()).map((n) => [n, rect(n)]);
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      if (hit(cells[i][1], cells[j][1])) out.push({ rule: 'overlap', got: `${cells[i][0].className} × ${cells[j][0].className}`, text: li.querySelector('.run-member-title')?.textContent || '' });
    }
    // Bundle QA 2: the number shares the title's first line, and the chip's icon and word share one line.
    const titleEl = li.querySelector('.run-member-title');
    const numEl = li.querySelector('.run-member-num');
    if (titleEl && numEl && numEl.textContent.trim()) {
      const n = rect(numEl), t = rect(titleEl);
      if (n.width > 0 && t.width > 0 && n.top >= t.bottom - 1) out.push({ rule: 'num-line', got: `${n.top} vs title ${t.top}-${t.bottom}`, text: titleEl.textContent });
    }
    const icEl = li.querySelector('.run-member-pr .runs-pr > .ic');
    const wordEl = li.querySelector('.run-member-pr .runs-pr-word');
    if (icEl && wordEl) {
      const a = rect(icEl), b = rect(wordEl);
      if (a.width > 0 && b.width > 0 && (a.top >= b.bottom - 1 || b.top >= a.bottom - 1)) out.push({ rule: 'chip-wrap', got: `icon ${a.top}-${a.bottom} word ${b.top}-${b.bottom}`, text: wordEl.textContent });
    }
  }
  return out;
}
