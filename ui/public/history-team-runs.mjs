// ui/public/history-team-runs.mjs — teammates' runs in the Runs list (run sharing s2): the wire rows of
// GET /api/team-runs turned into list items, the row title, and the read-only summary a team row opens. Pure DOM (every
// builder takes a `doc`), no fetch. Every record string reaches the page through textContent; the only attribute a
// record value fills is the https PR link's href (D23).
import { runModel } from '../../src/shared/run-model.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { formatWhen } from './memory-view.mjs';

const isHttps = (u) => {
  if (typeof u !== 'string' || !u) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};

/** The team rows of a GET /api/team-runs body: `local === false` only, minus runs listed here (D16), http links nulled. */
export function teamRunItems(payload, { localIds = new Set() } = {}) {
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  return rows.filter((r) => r && typeof r === 'object' && r.local === false && typeof r.runId === 'string' && !localIds.has(r.runId))
    .map((r) => ({ ...r, prUrl: isHttps(r.prUrl) ? r.prUrl : null }));
}

/** A record has no title: the workflow id, else "Run" (D19). */
export function teamRunTitle(item) {
  return (item && typeof item.workflowId === 'string' && item.workflowId) || 'Run';
}

/** The state word the row's dot says ("Running", "Ready", "Failed"…). */
export function teamRunWord(item) {
  try { return runModel({ status: String((item && item.status) || '') }).word || ''; } catch { return ''; }
}

function textEl(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
}

/** The read-only summary (D20): a `dl` of the record, the https PR link, the stale note. No button, no input. */
export function renderTeamRunSummary(doc, item) {
  const it = item || {};
  const box = doc.createElement('div');
  box.className = 'team-run-sum';
  const dl = doc.createElement('dl');
  const row = (label, value) => {
    const dt = textEl(doc, 'dt', '', label);
    const dd = doc.createElement('dd');
    if (typeof value === 'string') dd.textContent = value; else dd.append(value);
    dl.append(dt, dd);
  };
  row('Status', teamRunWord(it) || '—');
  row('Phase', it.phase || '—');
  row('Cost', fmtUsd(it.costUsd));
  row('Started by', it.startedBy || 'Teammate');
  row('Project', it.projectName || it.projectKey || '—');
  row('Started', formatWhen(it.startedAt) || '—');
  row('Updated', formatWhen(it.updatedAt) || '—');
  if (isHttps(it.prUrl)) {
    const a = doc.createElement('a');
    a.className = 'team-run-pr';
    a.setAttribute('href', it.prUrl);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.textContent = it.prUrl.replace(/^https:\/\//, '');
    row('Pull request', a);
  }
  box.append(dl);
  if (it.stale) box.append(textEl(doc, 'p', 'team-run-stale', 'No update for over 20 minutes'));
  return box;
}
