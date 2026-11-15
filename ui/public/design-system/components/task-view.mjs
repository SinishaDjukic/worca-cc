// TaskView (docs/rail/thing-page.md › thing.read-only): a task that is not yours (a teammate's synced record), read only.
// The task page's own pieces: the head, the metadata line, the StatusLine (its word and why, an empty action slot, no ⋯),
// the Figures, its PR and its runs. Never an action, a step or a log.
import { esc } from './html.mjs';
import { textLink } from './text-link.mjs';
import { statusDot, statusLine } from './status-line.mjs';
import { figure, figures as figuresLine } from './figures.mjs';
import { gitMark } from './kind-mark.mjs';
import { isWebUrl } from './time-track.mjs';
import { table } from './table.mjs';

/**
 * @param {object} o
 * @param {{label:string, attrs?:object}} o.back       the way back, a text link
 * @param {string} o.mark                               the task's KindMark
 * @param {string} o.title
 * @param {string[]} o.meta                             person, project, workflow, ticket, branch, lines changed
 * @param {{tone:string, word:string, detail?:string}} o.state   the StatusLine's dot tone, word and why
 * @param {{k:string, v:string}[]} o.figures
 * @param {{status:string, label:string, url:string}|null} [o.pr]
 * @param {{columns:object[], rows:object[]}} o.runs   one row per run (Table)
 */
export function taskView({ back, mark, title, meta, state, figures, pr = null, runs }) {
  const prLine = pr ? `<p class="tv-pr">${gitMark({ status: pr.status, size: 14 })}${isWebUrl(pr.url) ? `<a class="tv-pr-link" href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">${esc(pr.label)}</a>` : `<span class="tv-pr-link">${esc(pr.label)}</span>`}</p>` : '';
  return `<div class="task-view"><p class="tv-back">${textLink(back)}</p><h2 class="tv-title">${mark}<span>${esc(title)}</span></h2><p class="tv-meta">${esc(meta.filter(Boolean).join(' · '))}</p>${statusLine({ dot: statusDot({ tone: state.tone }), word: state.word, detail: state.detail || '', action: '' })}${figuresLine(figures.map((f) => figure({ k: f.k, v: f.v })))}${prLine}${table({ label: 'Runs', columns: runs.columns, rows: runs.rows })}</div>`;
}
