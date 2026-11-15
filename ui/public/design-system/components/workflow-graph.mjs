// WorkflowGraph (docs/rail/components.md): a run's workflow at full size, the view inside a Dialog without a form. A lane
// per stage, a node per step in its status colour, a pip on a gate, its rounds, and at the end what it came to. A node
// opens that step's log drawer under the graph. Wraps on a narrow screen; nothing scrolls sideways.
import { attrs, cls, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { stepLook } from './run-state.mjs';
import { stepDot } from './stepper.mjs';

/**
 * @param {object} o
 * @param {string} [o.label]
 * @param {{label:string, nodes:{key:string, name:string, state:string, meta?:string, loops?:number, gate?:boolean, selected?:boolean}[]}[]} o.stages
 * @param {string} [o.end]    what the workflow came to ("End · Ready"); none while it runs
 * @param {''|'small'|'large'} [o.zoom]
 * @param {object} [o.attrs]
 */
export function workflowGraph({ label = 'Workflow', stages, end = '', zoom = '', attrs: a = {} }) {
  const node = (n) => { const look = stepLook(n);
    return `<button type="button" class="${cls('wg-node', `is-${n.state}`, n.selected && 'is-open')}"${attrs({ 'data-node': n.key, 'data-key': `node:${n.key}`, 'aria-pressed': String(!!n.selected), title: `${n.name}: ${look.word}${n.gate ? ' · a gate' : ''}` })}>${stepDot(look)}<span class="wg-name">${esc(n.name)}</span>${n.gate ? '<span class="wg-pip" aria-hidden="true"></span>' : ''}${n.loops ? `<span class="wg-loop">${icon('refresh', 11)}${esc(n.loops)}</span>` : ''}${n.meta ? `<span class="wg-meta">${esc(n.meta)}</span>` : ''}</button>`; };
  const lanes = stages.map((st) => `<li class="wg-stage"><span class="wg-l">${esc(st.label)}</span><div class="wg-nodes">${st.nodes.map(node).join('')}</div></li>`).join('');
  return `<div class="${cls('wg', zoom && `is-${zoom}`)}" role="group"${attrs({ 'aria-label': label, ...a })}><ol class="wg-stages">${lanes}${end ? `<li class="wg-stage wg-end"><span class="wg-l">${esc(end)}</span></li>` : ''}</ol></div>`;
}
