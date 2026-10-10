// src/shared/graph/canvas-summary.mjs
// The [composer canvas] block the composer chat reads at the top of each turn (D11): the open workflow
// as the user sees it — nodes with their ports and what feeds them, wires, what is broken, what is still
// to wire, the warnings worth acting on, and the selection. Compact; clipped; pure.
import { portsOf } from './ports.mjs';
import { validateGraph, CANVAS_WARNING_CODES } from './validate.mjs';
import { classifyLoops } from './loops.mjs';
import { DEFAULT_MAX_CYCLES } from './constants.mjs';

const CONFIG_KEYS = ['model', 'effort', 'fanOut', 'askQuestions', 'awaitAll', 'subagentModel', 'timeoutMs', 'arity', 'planStoreSeed'];
/** The block's last line: the model reads the canvas up to here, and the user's message after it. */
export const CANVAS_BLOCK_END = '[/composer canvas]';
// Every value in the block is the user's or the model's (names, ids, keys, ports, settings): one line, capped. C0,
// DEL, C1 (U+0085) and U+2028/U+2029 all break a line somewhere downstream (prompt.mjs flattenBreaks).
const one = (s, n = 80) => String(s ?? '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, n);
// The markers are the one piece of syntax the block owns (and Ask's header beside it): a line spelling one — in a value,
// or across two values side by side — gets it rewritten, so nothing inside can close the block or open another.
export const MARKER_RE = /\[\/?(composer canvas|worca context)\]/gi;
const line = (s) => s.replace(MARKER_RE, '($1)');

/**
 * @param {object} tpl
 * @param {Function} portsFn
 * @param {{selection?:{kind,id}|null, maxChars?:number}} [o]
 * @returns {string}
 */
export function summarizeCanvas(tpl, portsFn, { selection = null, maxChars = 6000 } = {}) {
  const nodes = Array.isArray(tpl && tpl.nodes) ? tpl.nodes : [];
  const wires = Array.isArray(tpl && tpl.wires) ? tpl.wires : [];
  const end = (e) => `${one(e.node, 40)}.${one(e.port, 40)}`;
  const inbound = new Map(wires.map((w) => [`${w.to.node}.${w.to.port}`, end(w.from)]));
  const loops = classifyLoops({ ...tpl, nodes, wires }, portsFn).loopWireIds;
  const report = validateGraph({ ...tpl, nodes, wires }, portsFn);
  const head = [
    '[composer canvas]',
    line(`workflow: "${one(tpl && tpl.name, 60) || 'Untitled pipeline'}" (${one(tpl && tpl.id, 80) || 'unsaved'})`),
    line(`selected: ${selection ? `${one(selection.kind, 8)} ${one(selection.id, 40)}` : 'nothing'}`),
    `nodes (${nodes.length}):`,
  ];
  const nodeLines = nodes.map((n) => {
    const p = portsOf(portsFn, n);
    const title = p.meta && p.meta.displayName ? ` "${one(p.meta.displayName, 40)}"` : '';
    const ins = p.inputs.map((q) => `${one(q.id, 40)}:${one(q.type, 16)}${inbound.has(`${n.id}.${q.id}`) ? `←${inbound.get(`${n.id}.${q.id}`)}` : ''}`).join(', ');
    const outs = p.outputs.map((q) => `${one(q.id, 40)}:${one(q.type, 16)}${q.when && q.when !== 'always' ? `(${one(q.when, 16)})` : ''}`).join(', ');
    const cfg = CONFIG_KEYS.filter((k) => n.config && n.config[k] !== undefined).map((k) => `${k}=${one(typeof n.config[k] === 'object' ? JSON.stringify(n.config[k]) : n.config[k])}`).join(' ');
    return line(`- ${one(n.id, 40)} ${one(n.kind, 16)}${n.key ? ` ${one(n.key, 64)}` : ''}${title}${p.known === false ? ' (unknown key)' : ''}${ins ? ` · in ${ins}` : ''}${outs ? ` · out ${outs}` : ''}${cfg ? ` · ${cfg}` : ''}`);
  });
  const wireLines = wires.map((w) => line(`- ${one(w.id, 40)} ${end(w.from)} → ${end(w.to)}${loops.has(w.id) ? ` (loop ≤${one((w.config && w.config.maxCycles) || DEFAULT_MAX_CYCLES, 40)})` : ''}`));
  const real = report.errors.filter((e) => !e.incomplete);
  const todo = report.errors.filter((e) => e.incomplete);
  const warns = report.warnings.filter((w) => CANVAS_WARNING_CODES.includes(w.code));
  // Some messages never name their node (V4 "unknown agent …"): the model needs the id to act on it.
  const at = (e) => (e.nodeId && !String(e.message || '').includes(e.nodeId) ? ` (node ${one(e.nodeId, 40)})` : '');
  const tail = [
    `wires (${wires.length}):`, ...wireLines,
    `errors: ${real.length ? '' : 'none'}`, ...real.map((e) => line(`- ${e.code} ${one(e.message, 160)}${at(e)}`)),
    line(`to wire: ${todo.length ? todo.map((e) => `${one(e.message, 120)}${at(e)}`).join(' | ') : 'nothing'}`),
    `warnings: ${warns.length ? '' : 'none'}`, ...warns.map((w) => line(`- ${w.code} ${one(w.message, 160)}${at(w)}`)),
  ];
  const all = [...head, ...nodeLines, ...tail, CANVAS_BLOCK_END].join('\n');
  if (all.length <= maxChars) return all;
  const out = [...head];
  let used = head.join('\n').length;
  let shown = 0;
  const note = (left) => `… (${left} more nodes and the wires — call get_canvas for the rest)`;
  for (const l of nodeLines) {
    if (used + l.length + 1 + note(nodes.length - shown).length + 1 + CANVAS_BLOCK_END.length + 1 > maxChars) break;
    out.push(l); used += l.length + 1; shown += 1;
  }
  out.push(note(nodes.length - shown), CANVAS_BLOCK_END);
  return out.join('\n');
}
