// ui/public/team-metrics-leaderboard.mjs
// Team metrics → By person → Leaderboard card and the Worca level badge. Pure DOM, same style as
// team-metrics-view.mjs: every function takes a buildLeaderboard() result (or a level) and
// returns detached elements; app.js owns data, state and the delegated clicks. Every name comes
// from a run record, so it only ever reaches the page through textContent.
import { setAvatarSrc } from './worca-level/model.mjs';

const DAY = 86_400_000;
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PERIODS = [['all', 'All time'], ['year', 'This year'], ['quarter', 'This quarter'], ['last-month', 'Last month'], ['this-month', 'This month']];
const LEVEL_TEXT = { none: 'No level yet', unknown: 'Level unknown' };
const GLYPH = { none: '○', unknown: '?' };
const COLUMNS = ['#', 'Person', 'Score / 100', 'Runs (15%)', 'Per run (15%)', 'Merged (35%)', 'Success (35%)'];

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayLabel = (ms) => { const d = new Date(ms); return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A person's Worca level: the real one (icon + name), or a neutral icon with "No level yet" / "Level unknown". */
export function renderLevelBadge(level, { doc = globalThis.document } = {}) {
  const state = level?.state === 'known' ? 'known' : level?.state === 'none' ? 'none' : 'unknown';
  const badge = h(doc, 'span', 'tm-level');
  badge.dataset.levelState = state;
  if (state === 'known') {
    if (level.key) badge.dataset.worcaLevel = level.key;
    const img = h(doc, 'img', 'tm-level-ava');
    img.alt = level.name || '';
    setAvatarSrc(img, level.avatar);
    badge.append(img, h(doc, 'span', 'tm-level-name', level.name || ''));
  } else {
    const glyph = h(doc, 'span', 'tm-level-ava tm-level-glyph', GLYPH[state]);
    glyph.setAttribute('aria-hidden', 'true');
    badge.append(glyph, h(doc, 'span', 'tm-level-name', LEVEL_TEXT[state]));
  }
  return badge;
}

/** The period buttons; the pressed one is the card's current period. */
export function renderPeriodSelector(lbRange, { doc = globalThis.document } = {}) {
  const seg = h(doc, 'div', 'seg seg-sm tm-lb-range');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Leaderboard period');
  for (const [range, text] of PERIODS) {
    const b = h(doc, 'button', range === lbRange ? 'on' : null, text);
    b.type = 'button';
    b.dataset.lbRange = range;
    b.setAttribute('aria-pressed', String(range === lbRange));
    seg.append(b);
  }
  return seg;
}

/** What the card says about the top of the ranking. Pure text. */
export function leaderboardBanner(lb, { now = Date.now() } = {}) {
  if (lb.status === 'no-runs') return { kind: 'none', headline: 'No winner yet — no finished runs in this period', detail: '' };
  if (lb.status === 'none-eligible') return { kind: 'none', headline: 'No winner for this period — nobody has 3 runs yet', detail: '' };
  const names = lb.rows.filter((r) => lb.winners.includes(r.key)).map((r) => r.label).join(', ');
  const joint = lb.winners.length > 1;
  if (lb.phase === 'closed') {
    return { kind: 'winner', headline: `${joint ? 'Joint winners' : 'Winner'}: ${names}`, detail: `Closed ${dayLabel(lb.endMs - 1)}, final ranking` };
  }
  if (lb.phase === 'all-time') {
    return { kind: 'all-time', headline: `${joint ? 'Joint all-time leaders' : 'All-time leader'}: ${names}`, detail: '' };
  }
  const days = Math.max(1, Math.ceil((lb.endMs - now) / DAY));
  return { kind: 'leading', headline: `${joint ? 'Joint leaders so far' : 'Leading so far'}: ${names}`, detail: `Ends in ${plural(days, 'day')}, ranking can still change` };
}

function partCell(doc, label, part, raw, extra) {
  const td = h(doc, 'td', 'num mono');
  td.dataset.label = label;
  td.append(h(doc, 'span', 'tm-lb-pts', `${part.points.toFixed(1)} / ${part.weight}`), h(doc, 'small', 'hint', raw));
  if (extra) td.append(h(doc, 'small', 'hint', extra));
  return td;
}

function renderRows(lb, { doc, levelFor }) {
  const table = h(doc, 'table', 'table tm-tbl tm-lb-tbl');
  const thr = h(doc, 'tr');
  for (const text of COLUMNS) thr.append(h(doc, 'th', text === '#' || text === 'Person' ? null : 'num', text));
  const thead = h(doc, 'thead');
  thead.append(thr);
  const tbody = h(doc, 'tbody');
  for (const r of lb.rows) {
    const tr = h(doc, 'tr');
    if (lb.winners.includes(r.key)) tr.dataset.winner = 'true';
    tr.dataset.lbKey = r.key;
    const rank = h(doc, 'td', 'num mono', String(r.rank));
    rank.dataset.label = '#';
    const who = h(doc, 'td', 'table-main');
    const name = h(doc, 'span', 'tm-person', r.label);
    name.title = r.label;
    who.append(name, ' ', renderLevelBadge(levelFor(r.label), { doc }));
    const score = h(doc, 'td', 'num mono tm-lb-score', r.score.toFixed(1));
    score.dataset.label = 'Score';
    tr.append(
      rank, who, score,
      partCell(doc, 'Runs', r.parts.runs, String(r.runs)),
      partCell(doc, 'Per run', r.parts.perRun, r.perRunUsd == null ? '—' : `${usd(r.perRunUsd)} per run`, r.costed < r.runs ? `${r.costed} of ${r.runs} costed` : null),
      partCell(doc, 'Merged', r.parts.merged, String(r.merged)),
      partCell(doc, 'Success', r.parts.success, `${Math.round(r.successRate * 100)}%`),
    );
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = h(doc, 'div', 'table-wrap');
  wrap.append(table);
  return wrap;
}

function renderNotEligible(lb, { doc, levelFor }) {
  const box = h(doc, 'div', 'tm-lb-todo');
  box.append(h(doc, 'h3', null, 'Not eligible yet'));
  const list = h(doc, 'ul', 'tm-lb-todo-list');
  for (const p of lb.notEligible) {
    const li = h(doc, 'li', 'tm-lb-todo-row');
    const name = h(doc, 'span', 'tm-person', p.label);
    name.title = p.label;
    li.append(renderLevelBadge(levelFor(p.label), { doc }), name, h(doc, 'small', 'hint', `Not eligible yet — needs ${plural(p.needs, 'more run')}`));
    list.append(li);
  }
  box.append(list);
  return box;
}

const MERGED_NOTE = {
  loading: 'Checking merged pull requests…',
  unreachable: 'GitHub could not be reached — runs whose pull request could not be checked count as not merged.',
};

export function renderLeaderboardCard(lb, { doc = globalThis.document, levelFor, mergedState = 'ok', lbRange, now = Date.now() } = {}) {
  const card = h(doc, 'section', 'card chart-card tm-lb');
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'h2', null, 'Leaderboard'), renderPeriodSelector(lbRange ?? lb.range, { doc }));
  card.append(head);
  const banner = leaderboardBanner(lb, { now });
  const bar = h(doc, 'div', 'tm-lb-banner');
  bar.dataset.kind = banner.kind;
  bar.append(h(doc, 'strong', null, banner.headline));
  if (banner.detail) bar.append(' ', h(doc, 'small', 'hint', banner.detail));
  card.append(bar);
  if (lb.rows.length) card.append(renderRows(lb, { doc, levelFor }));
  if (lb.notEligible.length) card.append(renderNotEligible(lb, { doc, levelFor }));
  const note = h(doc, 'small', 'hint tm-lb-foot');
  note.append('Score out of 100: merged 35, success 35, runs 15, spend per run 15. Each part is compared with the best person on the team in the same period; a person needs 3 runs in the period to be ranked. Runs without a recorded cost are left out of spend per run only.');
  if (MERGED_NOTE[mergedState]) note.append(' ', h(doc, 'span', 'tm-lb-merged-note', MERGED_NOTE[mergedState]));
  card.append(note);
  return card;
}
