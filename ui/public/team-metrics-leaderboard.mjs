// ui/public/team-metrics-leaderboard.mjs
// Team metrics → By person → Leaderboard card and the Worca level badge. Pure DOM, same style as
// team-metrics-view.mjs: every function takes a buildLeaderboard() result (or a level) and
// returns detached elements; app.js owns data, state and the delegated clicks. Every name comes
// from a run record, so it only ever reaches the page through textContent.
import { setAvatarSrc } from './worca-level/model.mjs';

const DAY = 86_400_000;
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PERIODS = [['this-month', 'This month'], ['last-month', 'Last month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'All time']];
const LEVEL_TEXT = { none: 'No level yet', unknown: 'Level unknown' };
const GLYPH = { none: '○', unknown: '?' };
// The four parts in column order; their colours are the --tm-lb-<part> custom properties in team-metrics.css.
const PARTS = [['runs', 'Runs', 15], ['perRun', 'Per run', 15], ['merged', 'Merged', 35], ['success', 'Success', 35]];
const MIN_RUNS = 3;

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayLabel = (ms) => { const d = new Date(ms); return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const levelState = (level) => (level?.state === 'known' ? 'known' : level?.state === 'none' ? 'none' : 'unknown');

/** A person's Worca level: the real one (icon + name), or a neutral icon with "No level yet" / "Level unknown". */
export function renderLevelBadge(level, { doc = globalThis.document } = {}) {
  const state = levelState(level);
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

/** The period a leaderboard covers, in words: "November 2026", "Q4 2026", "2026" or "All time". */
export function leaderboardPeriodLabel(lb) {
  if (lb.startMs == null) return 'All time';
  const d = new Date(lb.startMs);
  const y = d.getUTCFullYear();
  if (lb.range === 'year') return String(y);
  if (lb.range === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`;
  return `${MONTH[d.getUTCMonth()]} ${y}`;
}

/** What the card says about the top of the ranking. Pure text; `score` is null when nobody is ranked. */
export function leaderboardBanner(lb, { now = Date.now() } = {}) {
  if (lb.status === 'no-runs') return { kind: 'none', kicker: null, headline: 'No winner yet — no finished runs in this period', detail: '', score: null };
  if (lb.status === 'none-eligible') return { kind: 'none', kicker: null, headline: 'No winner for this period — nobody has 3 runs yet', detail: '', score: null };
  const names = lb.rows.filter((r) => lb.winners.includes(r.key)).map((r) => r.label).join(', ');
  const joint = lb.winners.length > 1;
  const score = lb.rows[0].score.toFixed(1);
  const period = leaderboardPeriodLabel(lb);
  if (lb.phase === 'closed') {
    return { kind: 'winner', kicker: joint ? 'Joint winners' : 'Winner', headline: `${names} won ${period}`, detail: `Closed ${dayLabel(lb.endMs - 1)} · final ranking`, score };
  }
  if (lb.phase === 'all-time') {
    return { kind: 'all-time', kicker: joint ? 'Joint all-time leaders' : 'All-time leader', headline: `${names} ${joint ? 'lead' : 'leads'} all time`, detail: '', score };
  }
  const days = Math.max(1, Math.ceil((lb.endMs - now) / DAY));
  return { kind: 'leading', kicker: joint ? 'Joint leaders so far' : 'Leading so far', headline: `${names} ${joint ? 'are' : 'is'} leading ${period}`, detail: `Ends in ${plural(days, 'day')} · ranking can still change`, score };
}

/** A person's avatar: the level avatar when the level is known, else the neutral glyph. */
function renderAvatar(doc, level) {
  const state = levelState(level);
  if (state === 'known') {
    const img = h(doc, 'img', 'tm-lb-ava');
    img.alt = level.name || '';
    if (level.key) img.dataset.worcaLevel = level.key;
    setAvatarSrc(img, level.avatar);
    return img;
  }
  const glyph = h(doc, 'span', 'tm-lb-ava tm-lb-glyph', GLYPH[state]);
  glyph.setAttribute('aria-hidden', 'true');
  return glyph;
}

const levelName = (level) => (levelState(level) === 'known' ? level.name || '' : LEVEL_TEXT[levelState(level)]);

/** Avatar, then the name with a second line under it. Without a `level` (levels are off) there is no avatar, and no second line when `subText` is null. */
function renderWho(doc, label, level, subText) {
  const who = h(doc, 'div', 'tm-lb-who');
  const name = h(doc, 'span', 'tm-person', label);
  name.title = label;
  const sub = subText == null ? null : h(doc, 'span', 'tm-lb-sub-line', subText);
  const text = h(doc, 'div', 'tm-lb-who-text');
  text.append(name);
  if (sub) text.append(sub);
  if (level) who.append(renderAvatar(doc, level));
  who.append(text);
  return { who, sub };
}

function renderLeader(lb, { doc, levelFor, now }) {
  const banner = leaderboardBanner(lb, { now });
  const box = h(doc, 'div', 'tm-lb-leader');
  box.dataset.kind = banner.kind;
  if (lb.winners.length && levelFor) {
    const avas = h(doc, 'div', 'tm-lb-leader-avas');
    for (const r of lb.rows.filter((row) => lb.winners.includes(row.key))) avas.append(renderAvatar(doc, levelFor(r.label)));
    box.append(avas);
  }
  const text = h(doc, 'div', 'tm-lb-leader-text');
  if (banner.kicker) text.append(h(doc, 'div', 'tm-lb-kicker', banner.kicker));
  text.append(h(doc, 'div', 'tm-lb-headline', banner.headline));
  if (banner.detail) text.append(h(doc, 'div', 'tm-lb-detail', banner.detail));
  box.append(text);
  if (banner.score != null) {
    const score = h(doc, 'div', 'tm-lb-leader-score');
    score.append(h(doc, 'div', 'tm-lb-leader-num', banner.score), h(doc, 'div', 'tm-lb-leader-of', 'score of 100'));
    box.append(score);
  }
  return box;
}

function cell(doc, cls, text) {
  const c = h(doc, 'div', cls ? `tm-lb-cell ${cls}` : 'tm-lb-cell', text);
  c.setAttribute('role', 'cell');
  return c;
}

function partCell(doc, key, part, raw, extra) {
  const c = cell(doc, 'tm-lb-num');
  c.dataset.part = key;
  c.dataset.label = PARTS.find(([k]) => k === key)[1];   // the stacked layout (<= 720px) shows it in place of the head row
  c.append(h(doc, 'div', 'tm-lb-val', raw), h(doc, 'div', 'tm-lb-pts', `${part.points.toFixed(1)} / ${part.weight}`));
  if (extra) c.append(h(doc, 'div', 'tm-lb-note', extra));
  return c;
}

function renderHead(doc) {
  const head = h(doc, 'div', 'tm-lb-grid-head');
  head.setAttribute('role', 'row');
  const th = (cls, text) => {
    const c = h(doc, 'div', cls, text);
    c.setAttribute('role', 'columnheader');
    head.append(c);
    return c;
  };
  th(null, '#');
  th(null, 'Person');
  th(null, 'Score');
  for (const [key, label, weight] of PARTS) {
    const c = th('tm-lb-num');
    c.dataset.part = key;
    const dot = h(doc, 'span', 'tm-lb-dot');
    dot.dataset.part = key;
    dot.setAttribute('aria-hidden', 'true');
    c.append(dot, label, h(doc, 'span', 'tm-lb-weight', `${weight}%`));
  }
  return head;
}

function renderRows(lb, { doc, levelFor }) {
  const grid = h(doc, 'div', 'tm-lb-grid');
  grid.setAttribute('role', 'table');
  grid.setAttribute('aria-label', 'Leaderboard ranking');
  grid.append(renderHead(doc));
  for (const r of lb.rows) {
    const row = h(doc, 'div', 'tm-lb-row');
    row.setAttribute('role', 'row');
    if (lb.winners.includes(r.key)) row.dataset.winner = 'true';
    row.dataset.lbKey = r.key;
    const level = levelFor?.(r.label);
    const person = cell(doc, 'tm-lb-person');
    const { who, sub } = renderWho(doc, r.label, level, level ? levelName(level) : null);
    if (sub) {
      sub.classList.add('tm-lb-level');
      sub.dataset.levelState = levelState(level);
    }
    person.append(who);
    const score = cell(doc, 'tm-lb-score');
    const bar = h(doc, 'div', 'tm-lb-bar');
    bar.setAttribute('aria-hidden', 'true');
    for (const [key] of PARTS) {
      const seg = h(doc, 'span', 'tm-lb-seg');
      seg.dataset.part = key;
      seg.style.width = `${r.parts[key].points}%`;
      bar.append(seg);
    }
    score.append(h(doc, 'div', 'tm-lb-score-num', r.score.toFixed(1)), bar);
    row.append(
      cell(doc, 'tm-lb-rank', String(r.rank)), person, score,
      partCell(doc, 'runs', r.parts.runs, String(r.runs)),
      partCell(doc, 'perRun', r.parts.perRun, r.perRunUsd == null ? '—' : usd(r.perRunUsd), r.costed < r.runs ? `${r.costed} of ${r.runs} costed` : null),
      partCell(doc, 'merged', r.parts.merged, String(r.merged)),
      partCell(doc, 'success', r.parts.success, `${Math.round(r.successRate * 100)}%`),
    );
    grid.append(row);
  }
  const wrap = h(doc, 'div', 'tm-lb-scroll');
  wrap.tabIndex = 0;                                        // a keyboard can scroll it sideways between 721 and 920px
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Leaderboard (scrolls sideways)');
  wrap.append(grid);
  return wrap;
}

function renderNotEligible(lb, { doc, levelFor }) {
  const box = h(doc, 'div', 'tm-lb-todo');
  const head = h(doc, 'h3', 'tm-lb-todo-head', 'Not eligible yet');
  head.append(h(doc, 'span', 'tm-lb-dim', lb.startMs == null ? ` · fewer than ${MIN_RUNS} runs so far` : ` · fewer than ${MIN_RUNS} runs in ${leaderboardPeriodLabel(lb)}`));
  const list = h(doc, 'div', 'tm-lb-todo-list');
  for (const p of lb.notEligible) {
    const card = h(doc, 'div', 'tm-lb-todo-card');
    const level = levelFor?.(p.label);
    card.append(renderWho(doc, p.label, level, level ? `${levelName(level)} · ${plural(p.runs, 'run')}` : plural(p.runs, 'run')).who, h(doc, 'span', 'tm-lb-tag', `needs ${plural(p.needs, 'more run')}`));
    list.append(card);
  }
  box.append(head, list);
  return box;
}

const NO_GAPS = Object.freeze({ providers: Object.freeze([]), reasons: Object.freeze({}), truncated: Object.freeze([]), worcaError: null });
// One clause per reason a provider could not answer; the reasons keep this order.
const REASONS = Object.freeze([['missing', 'no sign-in on this machine', 'has', 'have'], ['unauthenticated', 'refused the sign-in', '', ''], ['error', 'could not be reached', '', '']]);
const listOf = (names) => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);

/** The footer's note on merged runs: "checking" while the lookup runs, then what it could not cover (leaderboard.mjs mergedLookupGaps). */
function mergedNote(mergedState, gaps) {
  if (mergedState === 'loading') return 'Checking merged pull requests…';
  const providers = gaps?.providers || [];
  const truncated = gaps?.truncated || [];
  const parts = [];
  if (gaps?.worcaError) parts.push('Worca could not look up pull requests — pull requests it could not check count as not merged.');
  const clauses = REASONS.map(([reason, text, one, many]) => {
    const names = providers.filter((name) => (gaps.reasons?.[name] || 'error') === reason);
    return names.length ? `${listOf(names)} ${[names.length === 1 ? one : many, text].filter(Boolean).join(' ')}` : null;
  }).filter(Boolean);
  if (clauses.length) parts.push(`${clauses.join('; ')} — runs whose pull request could not be checked count as not merged.`);
  if (truncated.length) parts.push(`${truncated.join(', ')} ${truncated.length === 1 ? 'has' : 'have'} more pull requests than one listing covers — older runs there may count as not merged.`);
  return parts.join(' ') || null;
}

export function renderLeaderboardCard(lb, { doc = globalThis.document, levelFor, mergedState = 'ok', mergedGaps = NO_GAPS, lbRange, now = Date.now() } = {}) {
  const card = h(doc, 'section', 'card chart-card tm-lb');
  const head = h(doc, 'div', 'card-head');
  const title = h(doc, 'div', 'tm-lb-title');
  title.append(h(doc, 'h2', null, 'Worca Orchestrator Leaderboard'), h(doc, 'p', 'tm-lb-sub', `${leaderboardPeriodLabel(lb)} · ranked by score · ${MIN_RUNS} runs to qualify`));
  head.append(title, renderPeriodSelector(lbRange ?? lb.range, { doc }));
  card.append(head, renderLeader(lb, { doc, levelFor, now }));
  if (lb.rows.length) card.append(renderRows(lb, { doc, levelFor }));
  if (lb.notEligible.length) card.append(renderNotEligible(lb, { doc, levelFor }));
  const note = h(doc, 'p', 'tm-lb-foot');
  note.append('Each part is compared with the best person in the same period. Merged pull requests and success rate 35% each, runs and spend per run 15% each. Runs without a recorded cost are left out of spend per run.');
  const merged = mergedNote(mergedState, mergedGaps);
  if (merged) note.append(' ', h(doc, 'span', 'tm-lb-merged-note', merged));
  card.append(note);
  return card;
}
