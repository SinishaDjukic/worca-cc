// ui/public/marketplace/update-view.mjs — the Update review sheet's pure renderers (marketplace P6, board 3.2): one card
// per update and the footer. Pure: every function takes `doc` and returns detached DOM; no fetch, no state, no listeners.
import { kindCounts, pluginIconKind, kindTile, chip } from './kinds.mjs';
import { icon } from '../icons.mjs';
import { renderNeedsGit } from '../plugins-view.mjs';
import { errorWash } from './install-view.mjs';
import { accessChip, deltaLines, parseDiffstat, needsTick, versionRange } from './update-model.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const sha7 = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, 7) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The state chip(s) of a card: what it is doing, or what its preview asks for; a stale preview adds a second. */
function stateChips(doc, card) {
  switch (card.state) {
    case 'loading': return [chip(doc, 'off', 'Previewing…', { icon: 'spinner' })];
    case 'applying': return [chip(doc, 'off', 'Updating…', { icon: 'spinner' })];
    case 'done': return [chip(doc, 'ok', 'Updated', { icon: 'check' })];
    case 'uptodate': return [chip(doc, 'off', 'Up to date')];
    case 'failed':
      if (card.error?.gitMissing) return [renderNeedsGit(doc)];
      return [chip(doc, 'bad', card.error?.phase === 'preview' ? 'Preview failed' : 'Update failed', { icon: 'alert' })];
    default: {
      const a = accessChip(card.preview?.access);
      const out = [a ? (a.red ? chip(doc, 'bad', a.label, { icon: 'key' }) : chip(doc, 'warn', a.label, { icon: 'alert' }))
        : chip(doc, 'ok', 'No new access', { icon: 'check' })];
      if (card.stale) out.push(chip(doc, 'warn', 'Changed since preview'));
      return out;
    }
  }
}

/** p.mk-mono.mk-diffstat: "<n> file(s) changed", then each present half, singular at 1 as git prints. */
function diffstatLine(doc, ds) {
  const p = make(doc, 'p', 'mk-mono mk-diffstat', plural(ds.files, 'file changed', 'files changed'));
  if (ds.insertions != null) p.append(doc.createTextNode(', '), make(doc, 'span', 'mk-ins', plural(ds.insertions, 'insertion(+)', 'insertions(+)')));
  if (ds.deletions != null) p.append(doc.createTextNode(', '), make(doc, 'span', 'mk-del', plural(ds.deletions, 'deletion(-)', 'deletions(-)')));
  return p;
}

/** The fold under the commits button: commits, diffstat, What changes and — when it must be ticked — the review tick. */
function panel(doc, card) {
  const p = card.preview;
  const box = make(doc, 'div', 'mk-upd-panel');
  box.id = `mk-upd-panel-${card.name}`;
  box.hidden = !card.expanded;
  const commits = make(doc, 'div');
  const ul = make(doc, 'ul', 'mk-commits');
  for (const c of list(p.commits)) {
    const li = make(doc, 'li');
    li.append(make(doc, 'span', 'mk-mono mk-sha', sha7(c?.sha)), doc.createTextNode(' '), make(doc, 'span', null, String(c?.subject ?? '')));
    ul.append(li);
  }
  commits.append(make(doc, 'h4', 'subsection-title', 'Commits'), ul);
  box.append(commits);
  const ds = parseDiffstat(p.diffstat);
  if (ds) box.append(diffstatLine(doc, ds));
  const lines = deltaLines(p);
  if (lines.length) {
    const deltas = make(doc, 'div', 'mk-deltas');
    deltas.append(make(doc, 'h4', 'subsection-title', 'What changes'));
    for (const l of lines) {
      const row = make(doc, 'div', l.red ? 'mk-delta is-red' : 'mk-delta');
      row.append(icon(doc, l.glyph, 14), make(doc, 'span', null, l.text));
      if (l.mono != null) row.append(make(doc, 'span', 'mk-mono', l.mono));
      deltas.append(row);
    }
    box.append(deltas);
  }
  if (card.state === 'review' && needsTick(card)) {
    const label = make(doc, 'label', 'mk-review');
    const tick = make(doc, 'input', 'mk-reviewed');
    tick.type = 'checkbox';
    tick.dataset.name = card.name;
    tick.checked = !!card.reviewed;
    label.append(tick, make(doc, 'span', null, "I've reviewed these changes"));
    box.append(label);
  }
  return box;
}

/** section.mk-upd: the plugin icon, name, version range, state chip(s) and Include; the error; commits and their fold. */
export function renderUpdateCard(doc, card) {
  const el = make(doc, 'section', 'mk-upd');
  el.dataset.name = card.name;
  el.dataset.state = card.state;
  el.setAttribute('aria-label', `${card.name} update`);
  const top = make(doc, 'div', 'mk-upd-top');
  top.append(kindTile(doc, pluginIconKind(kindCounts(card.row)), { size: 'sm' }), make(doc, 'span', 'mk-upd-name', card.name),
    make(doc, 'span', 'mk-ver mk-upd-ver', versionRange(card)), ...stateChips(doc, card));
  if (card.state === 'review' && !needsTick(card)) {
    const label = make(doc, 'label', 'mk-incl');
    const inc = make(doc, 'input', 'mk-include');
    inc.type = 'checkbox';
    inc.dataset.name = card.name;
    inc.checked = !!card.include;
    label.append(inc, make(doc, 'span', null, 'Include'));
    top.append(label);
  }
  el.append(top);
  if (card.state === 'failed' && card.error?.message && !card.error.gitMissing) {
    const wash = errorWash(doc, card.error.message);
    wash.classList.add('mk-upd-err');
    el.append(wash);
  }
  if (card.preview) {
    const p = card.preview;
    const disc = make(doc, 'button', 'mk-disc');
    disc.type = 'button';
    disc.dataset.name = card.name;
    disc.setAttribute('aria-expanded', String(!!card.expanded));
    disc.setAttribute('aria-controls', `mk-upd-panel-${card.name}`);
    const n = list(p.commits).length;
    disc.append(icon(doc, 'chevron', 14), make(doc, 'span', 'mk-disc-n', plural(n, 'commit', 'commits')), doc.createTextNode(' '),
      make(doc, 'span', 'mk-mono', `${sha7(p.pinnedSha)} → ${sha7(p.candidateSha)}`));
    el.append(disc, panel(doc, card));
  }
  return el;
}

/** The footer: [the "k of n ready" meta, the "only" button, the primary]; `fs` = footState(cards). */
export function renderUpdateFoot(doc, fs) {
  const meta = make(doc, 'span', 'mk-meta mk-upd-meta mk-foot-start', fs.meta);
  const only = make(doc, 'button', 'btn mk-upd-only', fs.only || '');
  only.type = 'button';
  only.dataset.act = 'only';
  only.hidden = !fs.only;
  const go = make(doc, 'button', 'btn btn-primary mk-upd-go', fs.primary);
  go.type = 'button';
  go.dataset.act = 'go';
  go.disabled = !fs.enabled;
  return [meta, only, go];
}
