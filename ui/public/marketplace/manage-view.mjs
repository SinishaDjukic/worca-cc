// ui/public/marketplace/manage-view.mjs — P6: the installed plugin sheet's pure renderers (board 3.3): the head with the
// Enabled switch and the update row, Health (Doctor), Adds, Source, the Remove row and a Test connection result. Pure:
// every function takes `doc` and returns detached DOM; no fetch, no state, no listeners.
import { KINDS, kindCounts, pluginIconKind, kindTile, chip, landing } from './kinds.mjs';
import { icon } from '../icons.mjs';
import { addsRows } from './install-view.mjs';

const sha7 = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, 7) : '');

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function secHead(doc, id, label) {
  const h = make(doc, 'h3', 'section-title', label);
  if (id) h.id = id;
  return h;
}

/** P3's head slot for the manage sheet: icon, name, "version · marketplace", the Enabled switch, then the update row. */
export function renderManageHead(doc, row) {
  const head = make(doc, 'div', 'mk-manage-head');
  const id = make(doc, 'div', 'mk-sheet-id');
  const main = make(doc, 'div', 'mk-sheet-id-main');
  const title = make(doc, 'h2', 'subpage-title', row.name);
  title.id = 'mk-sheet-title';
  const meta = make(doc, 'div', 'mk-meta mk-manage-meta');
  if (row.version) meta.append(make(doc, 'span', 'mk-ver', row.version));
  const where = row.linked ? chip(doc, 'n', 'linked', { icon: 'link' })
    : (row.marketplaceName || row.marketplace) ? make(doc, 'span', null, row.marketplaceName || row.marketplace) : null;
  if (where) {
    if (row.version) {
      const dot = make(doc, 'span', null, ' · ');
      dot.setAttribute('aria-hidden', 'true');
      meta.append(dot);
    }
    meta.append(where);
  }
  main.append(title, meta);
  const sw = make(doc, 'label', 'switch-row mk-manage-switch');
  const input = make(doc, 'input', 'sw-input mk-manage-enable');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = row.enabled !== false;
  sw.append(make(doc, 'span', null, 'Enabled'), input, make(doc, 'span', 'switch'));
  id.append(kindTile(doc, pluginIconKind(kindCounts(row)), { size: 'lg' }), main, sw);
  head.append(id);
  const upd = renderUpdateRow(doc, row);
  if (upd) head.append(upd);
  return head;
}

// The head's update row (chip + Review update), or null without `row.latest`.
function renderUpdateRow(doc, row) {
  if (!row?.latest) return null;
  const upd = make(doc, 'div', 'mk-manage-upd');
  const btn = make(doc, 'button', 'btn btn-sm mk-review-update', 'Review update');
  btn.type = 'button';
  upd.append(chip(doc, 'upd', `Update ${row.latest.version}`, { icon: 'arrow-up' }), btn);
  return upd;
}

/** Doctor's report in numbers: passed / total, ok only when the report is ok and every check passed. */
export function healthSummary(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const passed = checks.filter((c) => c?.ok).length;
  return { passed, total: checks.length, ok: !!report?.ok && passed === checks.length };
}

/** section.mk-sec[data-sec=health]: the run button, the summary chip, one row per check in Doctor order. */
export function renderHealth(doc, { report = null, running = false } = {}) {
  const sec = make(doc, 'section', 'mk-sec');
  sec.dataset.sec = 'health';
  sec.setAttribute('aria-labelledby', 'mk-sec-health');
  const head = make(doc, 'div', 'mk-sec-head');
  const run = make(doc, 'button', 'btn btn-sm btn-quiet mk-health-run');
  run.type = 'button';
  run.disabled = !!running;
  run.append(icon(doc, 'refresh', 14), doc.createTextNode(report ? 'Run again' : 'Run checks'));
  head.append(secHead(doc, 'mk-sec-health', 'Health'), run);
  sec.append(head);
  if (running) {
    sec.append(chip(doc, 'off', 'Running checks…', { icon: 'spinner' }));
    return sec;
  }
  if (!report) return sec;
  const s = healthSummary(report);
  sec.append(chip(doc, s.ok ? 'ok' : 'bad', `${s.passed} of ${s.total} checks passed`));
  const ul = make(doc, 'ul', 'mk-checks');
  ul.setAttribute('aria-label', 'Health checks');
  for (const c of Array.isArray(report.checks) ? report.checks : []) {
    const li = make(doc, 'li', c?.ok ? 'mk-check' : 'mk-check mk-check-fail');
    li.dataset.check = String(c?.id ?? '');
    const ic = make(doc, 'span', 'mk-check-ic');
    ic.setAttribute('role', 'img');
    ic.setAttribute('aria-label', c?.ok ? 'ok' : 'fail');
    ic.append(icon(doc, c?.ok ? 'check' : 'alert', 14));
    li.append(ic, make(doc, 'span', 'mk-mono mk-check-id', String(c?.id ?? '')), doc.createTextNode(' '),
      make(doc, 'span', 'mk-meta', String(c?.detail ?? '')));
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

/** section.mk-sec[data-sec=adds]: one neutral-wash row per contribution (P4's addsRows), or null when there is none. */
export function renderAdds(doc, inventory) {
  const rows = addsRows(inventory || {});
  if (!rows.length) return null;
  const sec = make(doc, 'section', 'mk-sec');
  sec.dataset.sec = 'adds';
  sec.setAttribute('aria-labelledby', 'mk-sec-adds');
  sec.append(secHead(doc, 'mk-sec-adds', 'Adds'));
  for (const r of rows) {
    const row = make(doc, 'div', 'mk-wash mk-add-row');
    row.dataset.kind = r.kind;
    const main = make(doc, 'div');
    main.append(make(doc, 'span', 'mk-add-name', r.title), make(doc, 'span', 'mk-meta', KINDS[r.kind].one));
    row.append(kindTile(doc, r.kind, { size: 'sm' }), main);
    const l = landing(r.kind);
    if (l) {
      const a = make(doc, 'a', 'mk-link', l.label);
      a.href = l.href;
      a.append(icon(doc, 'chevron', 14));
      row.append(a);
    }
    sec.append(row);
  }
  return sec;
}

/** "host/path · subdir" of the pinned source (board 3.3), or null for a plugin without a repo (linked). */
export function sourceLine(detail) {
  const repo = detail?.repo;
  if (!repo) return null;
  const url = String(repo).replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/+$/, '').replace(/\.git$/, '');
  return detail.subdir ? `${url} · ${detail.subdir}` : url;
}

/** section.mk-sec[data-sec=source]: P4's source row (url, @ sha7, View on GitHub), or the linked chip. */
export function renderSource(doc, detail) {
  const sec = make(doc, 'section', 'mk-sec');
  sec.dataset.sec = 'source';
  sec.setAttribute('aria-labelledby', 'mk-sec-source');
  sec.append(secHead(doc, 'mk-sec-source', 'Source'));
  const line = sourceLine(detail);
  if (!line) {
    sec.append(chip(doc, 'n', 'linked', { icon: 'link' }));
    return sec;
  }
  const src = make(doc, 'div', 'mk-src');
  const main = make(doc, 'div', 'mk-src-main');
  main.append(make(doc, 'span', 'mk-src-url mk-mono', line));
  if (detail.sha) main.append(make(doc, 'span', 'mk-src-sha mk-mono', `@ ${sha7(detail.sha)}`));
  src.append(icon(doc, 'git', 16), main);
  if (detail.webUrl) {
    const a = make(doc, 'a', 'mk-link', 'View on GitHub');
    a.href = detail.webUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.append(icon(doc, 'external', 14));
    src.append(a);
  }
  sec.append(src);
  return sec;
}

/** div.mk-sec.mk-remove-row: the danger button that opens P5's Remove dialog. */
export function renderRemoveRow(doc, name) {
  const row = make(doc, 'div', 'mk-sec mk-remove-row');
  const b = make(doc, 'button', 'btn btn-danger mk-remove');
  b.type = 'button';
  b.dataset.name = name;
  b.append(icon(doc, 'trash', 14), doc.createTextNode(`Remove ${name}…`));
  row.append(b);
  return row;
}

/** div.mk-test-out: a validateConfig result (or { testing: true }); errors on a field listed in `placed` are left out. */
export function renderTestResult(doc, result, { placed = [] } = {}) {
  const r = result || {};
  const out = make(doc, 'div', 'mk-test-out');
  if (r.testing) {
    out.append(chip(doc, 'off', 'Testing…', { icon: 'spinner' }));
    return out;
  }
  if (r.ok) {
    out.append(chip(doc, 'ok', r.identity ? `Connected · signed in as ${r.identity}` : 'Connected', { icon: 'check' }));
    if (r.instance?.baseUrl) {
      out.append(make(doc, 'span', 'mk-meta mk-mono', r.instance.project ? `${r.instance.baseUrl} · ${r.instance.project}` : r.instance.baseUrl));
    }
    return out;
  }
  if (r.pending) {
    out.append(chip(doc, 'off', 'Waiting'));
    if (r.message) out.append(make(doc, 'span', 'mk-meta', r.message));
    return out;
  }
  out.append(chip(doc, 'bad', 'Not connected', { icon: 'alert' }));
  // A connector failure rides the 200 envelope as { error: { kind, message } }; a caller error (400 / 404 / 500) is
  // { error: '<string>' }.
  const errors = Array.isArray(r.errors) && r.errors.length ? r.errors
    : [{ message: (typeof r.error === 'string' ? r.error : r.error?.message) || r.message || 'connection failed' }];
  const skip = new Set(placed);
  for (const e of errors) {
    if (e?.field && skip.has(e.field)) continue;
    out.append(make(doc, 'span', 'mk-test-err', String(e?.message ?? '')));
  }
  return out;
}
