// ui/public/run-page-head.mjs — the aligned run and group page head (runs navigation, run 3): the kind chip's words,
// the status model without a second PR mention, the h1 text and the facts block (the breadcrumb is nav/crumbs.mjs).
// Pure DOM over the host's ownerDocument; app.js and group-page.mjs own the data.

export const RUN_FACTS = Object.freeze([['group', 'Group'], ['project', 'Project'], ['branch', 'Branch'], ['outcome', 'Outcome'], ['labels', 'Labels'], ['tags', 'Cost tags']]);
export const GROUP_FACTS = Object.freeze([['project', 'Project'], ['runs', 'Runs'], ['cost', 'Total cost'], ['labels', 'Labels']]);

/** The run page's kind chip. `home` is app.js groupHomeOf's answer ({ row, planning, position, total }) or null. */
export function runPositionLabel(home) {
  if (!home) return 'Run';
  if (home.planning) return 'Planning';
  return home.position != null && home.total ? `Run ${home.position} of ${home.total}` : 'Run';
}

/** The group page's kind chip (clarify answer): the group's kind. */
export function groupKindWord(row) {
  const k = row && row.groupKind;
  return k === 'feature' ? 'Feature' : k === 'user' ? 'Group' : 'Chain';
}

export const groupHrefOf = (row) => `${row.groupKind === 'feature' ? '#feature' : '#group'}/${encodeURIComponent(row.groupId)}`;

/** No second PR mention (D10): the PR bar carries "PR #N", so the page's status line drops " · PR #N". */
export function pageModel(m) {
  const n = m && m.pr && m.pr.number;
  if (n == null || !m.line || !m.line.includes(` · PR #${n}`)) return m;
  return { ...m, line: m.line.split(` · PR #${n}`).join('') };
}

/** The run page's h1 text: a slice run's "Run 3 · " prefix goes when the chip already says "Run 3 of N" (say each
 *  fact once). Display only: sliceTitle, branches and PR titles keep it. The prefix format is sliceTitle's
 *  (src/core/shape/features.mjs); a test feeds its real output through here. */
export function runTitleText(title, home) {
  const t = String(title || '');
  if (!home || home.planning || home.position == null) return t;
  const m = /^Run (\d+) · (.+)$/.exec(t);
  return m && Number(m[1]) === home.position ? m[2] : t;
}

/** The facts block for a page built in JS (the group page). The run templates carry the same markup statically. */
export function buildFacts(doc, rows) {
  const dl = doc.createElement('dl');
  dl.className = 'rd-kv';
  for (const [key, label] of rows) {
    const row = doc.createElement('div');
    row.className = 'rd-kv-row';
    row.dataset.fact = key;
    row.hidden = true;
    const dt = doc.createElement('dt');
    dt.className = 'rd-kv-k';
    dt.textContent = label;
    const dd = doc.createElement('dd');
    dd.className = 'rd-kv-v';
    row.append(dt, dd);
    dl.append(row);
  }
  return dl;
}

export const factRow = (kv, key) => (kv ? kv.querySelector(`:scope > .rd-kv-row[data-fact="${key}"]`) : null);

/** A plain text value (the group page's rows). `label` renames the row (Feature / Chain / Group). */
export function setFactText(kv, key, text, label = '') {
  const row = factRow(kv, key);
  if (!row) return;
  if (label) row.querySelector('.rd-kv-k').textContent = label;
  const v = row.querySelector('.rd-kv-v');
  if (v.textContent !== text) v.textContent = text;
}

const filled = (dd) => [...dd.childNodes].some((n) => (n.nodeType === 3 ? n.data.trim() !== '' : n.nodeType === 1 && !n.hidden));
/** Hide every row whose value holds no text and no shown element (the painters own the values). */
export function syncFacts(kv) {
  if (!kv) return;
  for (const row of kv.querySelectorAll(':scope > .rd-kv-row')) row.hidden = !filled(row.querySelector('.rd-kv-v'));
}
