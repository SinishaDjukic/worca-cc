// WorkflowStory (docs/rail/panels.md › panel.workflow-story): a workflow told in plain words, as a storyboard. A panel a
// step, saying what happens to your task there, with its time and cost; a loop drawn back under the steps it joins, in
// words; then how a task goes through it, from its last tasks. Simple's drawing of a workflow; above the graph elsewhere.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { list, listRow } from './list.mjs';
import { kindMark } from './kind-mark.mjs';

/**
 * @param {object} o
 * @param {{name:string, says:string, meta?:string, check?:boolean}[]} o.steps   in order; a check carries the loop's colour
 * @param {{from:number, to:number, text:string}} [o.loop]   the step that sends work back (index), where to, in words
 * @param {{from:number, to:number, text:string}[]} [o.loops]   every loop: one between two steps is an arc, one under the other;
 *   a step that sends work back to itself (from === to) says so in its own panel, never as an arc
 *   more than five steps read as a list, as on a narrow screen: a column each would break their words (F-G-fid-09)
 * @param {{title:string, meta:string, tone:string, stage?:number}[]} [o.ways]   how a task goes through it
 * @param {string} [o.byline]   who told it (a small model, from the workflow and its tasks)
 * @param {object} [o.attrs]
 */
export function workflowStory({ steps, loop = null, loops = null, ways = [], byline = '', attrs: a = {} }) {
  const n = steps.length || 1, all = loops || (loop ? [loop] : []);
  const arcs = all.filter((l) => l.from !== l.to), again = (i) => all.filter((l) => l.from === i && l.to === i).map((l) => `<div class="ws-again">${esc(l.text)}</div>`).join('');
  const panels = steps.map((s, i) => `<div class="ws-p${s.check ? ' is-check' : ''}"><div class="ws-n"><span class="ws-k">${i + 1}</span><span class="ws-name">${esc(s.name)}</span></div>${s.says ? `<div class="ws-t">${esc(s.says)}</div>` : ''}${s.meta ? `<div class="ws-m">${esc(s.meta)}</div>` : ''}${again(i)}</div>`).join('');
  const arcOf = (l, k) => {
    const lo = Math.min(l.from, l.to), hi = Math.max(l.from, l.to);
    return `<div class="ws-loop" style="--ws-a:${((lo + 0.5) / n) * 100}%;--ws-w:${((hi - lo) / n) * 100}%${k ? `;--ws-row:${k}` : ''}"><svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M100 0 C100 14 0 14 0 0" vector-effect="non-scaling-stroke"/></svg><span>${esc(l.text)}</span></div>`;
  };
  const how = ways.length ? list({ groups: [{ title: 'How a task goes through it', rows: ways.map((w) => listRow({ title: w.title, meta: w.meta, mark: kindMark({ kind: 'workflow', tone: 'idle', advisory: true }) })) }] }) : '';   // a way through is not a state: one ink, no state's sign (look.one-icon)
  return `<section class="ws"${attrs({ 'aria-label': 'This workflow in plain words', ...a })}><div class="ws-board${arcs.length ? ' has-loop' : ''}${n > 5 ? ' is-long' : ''}" style="--ws-n:${n}${arcs.length > 1 ? `;--ws-loops:${arcs.length}` : ''}">${panels}${arcs.map(arcOf).join('')}</div>${how}${byline ? `<p class="ws-by">${icon('sparkle', 12)} ${esc(byline)}</p>` : ''}</section>`;
}
