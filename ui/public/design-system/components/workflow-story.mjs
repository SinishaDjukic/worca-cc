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
 * @param {{title:string, meta:string, tone:string, stage?:number}[]} [o.ways]   how a task goes through it
 * @param {string} [o.byline]   who told it (a small model, from the workflow and its tasks)
 * @param {object} [o.attrs]
 */
export function workflowStory({ steps, loop = null, ways = [], byline = '', attrs: a = {} }) {
  const n = steps.length || 1;
  const panels = steps.map((s, i) => `<div class="ws-p${s.check ? ' is-check' : ''}"><div class="ws-n"><span class="ws-k">${i + 1}</span>${esc(s.name)}</div><div class="ws-t">${esc(s.says)}</div>${s.meta ? `<div class="ws-m">${esc(s.meta)}</div>` : ''}</div>`).join('');
  const lo = loop ? Math.min(loop.from, loop.to) : 0, hi = loop ? Math.max(loop.from, loop.to) : 0;
  const arc = loop ? `<div class="ws-loop" style="left:${((lo + 0.5) / n) * 100}%;width:${((hi - lo) / n) * 100}%"><svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M100 0 C100 14 0 14 0 0" vector-effect="non-scaling-stroke"/></svg><span>${esc(loop.text)}</span></div>` : '';
  const how = ways.length ? list({ groups: [{ title: 'How a task goes through it', rows: ways.map((w) => listRow({ title: w.title, meta: w.meta, mark: kindMark({ kind: 'workflow', tone: 'idle', advisory: true }) })) }] }) : '';   // a way through is not a state: one ink, no state's sign (look.one-icon)
  return `<section class="ws"${attrs({ 'aria-label': 'This workflow in plain words', ...a })}><div class="ws-board${loop ? ' has-loop' : ''}" style="--ws-n:${n}">${panels}${arc}</div>${how}${byline ? `<p class="ws-by">${icon('sparkle', 12)} ${esc(byline)}</p>` : ''}</section>`;
}
