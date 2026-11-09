// The prototype's graph: dev's own renderer (ui/public/graph/view.mjs, the one the chat's workflow proposals draw with) and
// its auto-layout (src/shared/graph/layout.mjs), on the prototype's workflows. Bundled to graph.js by
// gates/components-js.mjs; it sets window.RailGraph. Rail is the skin (rail.css › .gv-skin): plain words on the view, ports
// and their types on the Expert canvas. The engine is dev's, unchanged.
import { createGraphView } from '../../../../ui/public/graph/view.mjs';
import { buildGraphManifest, manifestPortsFn, manifestTemplate } from '../../../../src/shared/graph/manifest.mjs';
import { manifestAgents } from '../../../../ui/public/graph/run-decor.mjs';
import { autoLayout } from '../../../../src/shared/graph/layout.mjs';

const md = (id, extra = {}) => ({ id, type: 'md', ...extra });
const MODEL_IDS = { 'Opus 5.5': 'claude-opus-5-5', 'Sonnet 5.5': 'claude-sonnet-5-5', 'Haiku 5.5': 'claude-haiku-5-5' };
const MODEL_WORDS = Object.fromEntries(Object.entries(MODEL_IDS).map(([k, v]) => [v, k]));

/** A prototype workflow ({steps:[[name, ref, model, effort]], loops:[[from, to, n]]}) as dev's template and its agents. */
function build(wf, says) {
  const names = wf.steps.map((s) => s[0]), agents = {};
  const sends = (i) => wf.loops.find((l) => l[0] === names[i]), takes = (i) => wf.loops.some((l) => l[1] === names[i]);
  wf.steps.forEach(([name, ref], i) => {
    agents[`s${i}`] = { key: `s${i}`, displayName: name, color: sends(i) ? 'amber' : ['violet', 'blue', 'green', 'slate'][i % 4],
      ...(sends(i) ? { verdict: { filename: `s${i}.json` } } : {}),
      inputs: [md('in', { required: true }), ...(takes(i) ? [md('back', { required: false, loop: true })] : [])],
      outputs: sends(i) ? [md('fix', { when: 'blocking' }), md('ok', { when: 'clean' })] : [md('out', { when: 'always' })] };
  });
  // two rows when it loops: the step that sends work back, and what follows it, sit under the step it sends back to, so
  // the graph draws large and the loop is a short return (Auto-align lays it out as dev does)
  const src = wf.loops.length ? names.indexOf(wf.loops[0][0]) : -1, dst = src >= 0 ? names.indexOf(wf.loops[0][1]) : -1, two = src > 0 && dst >= 0 && dst < src;
  const at = (i) => (two && i >= src ? [320 + (dst + i - src) * 280, 300] : [320 + i * 280, 40]);
  const endAt = at(wf.steps.length - 1);
  const nodes = [{ id: 'n_task', kind: 'task', x: 40, y: 40, config: {} },
    ...wf.steps.map(([, , model, effort], i) => ({ id: `n${i}`, kind: 'agent', key: `s${i}`, x: at(i)[0], y: at(i)[1], config: model ? { model: MODEL_IDS[model] || model, effort } : {} })),
    { id: 'n_end', kind: 'end', x: endAt[0] + 280, y: endAt[1], config: {} }];
  const outOf = (i) => (sends(i) ? 'ok' : 'out');
  const wires = [{ id: 'w_in', from: { node: 'n_task', port: 'task' }, to: { node: 'n0', port: 'in' } },
    ...wf.steps.slice(1).map((_, k) => ({ id: `w${k}`, from: { node: `n${k}`, port: outOf(k) }, to: { node: `n${k + 1}`, port: 'in' } })),
    { id: 'w_end', from: { node: `n${wf.steps.length - 1}`, port: outOf(wf.steps.length - 1) }, to: { node: 'n_end', port: 'result' } },
    ...wf.loops.map(([from, to, n], k) => ({ id: `wl${k}`, from: { node: `n${names.indexOf(from)}`, port: 'fix' }, to: { node: `n${names.indexOf(to)}`, port: 'back' }, config: { maxCycles: +n } }))];
  const m = buildGraphManifest({ id: `wf_${wf.id}`, name: wf.title, version: 2, domain: 'coding', nodes, wires }, agents);
  const meta = manifestAgents(m); wf.steps.forEach(([, ref], i) => { if (meta[`s${i}`]) { meta[`s${i}`].description = says?.(ref) || ''; meta[`s${i}`].icon = meta[`s${i}`].icon || '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.2-5.4 12.8-5.4 14 0"/>'; } });
  return { tpl: manifestTemplate(m), portsFn: manifestPortsFn(m), agents: meta };
}

/** Lays the template out as dev's Auto-layout does (the canvas's Auto-align). */
function align(g) { const pos = autoLayout(g.tpl, g.portsFn, { describe: true }); g.tpl = { ...g.tpl, nodes: g.tpl.nodes.map((n) => (pos[n.id] ? { ...n, ...pos[n.id] } : n)) }; return g; }

/**
 * Draws a workflow into host, fitted to width.
 * @param {HTMLElement} host
 * @param {object} wf          the prototype's workflow
 * @param {{width?:number, zoom?:number, mode?:'static'|'edit', aligned?:boolean, select?:string, says?:(ref:string)=>string, g?:object}} [o]
 *   zoom: the graph's real size (1 is full size; the view never magnifies past it) and the host takes its width; 0 fits width
 * @returns {{g:object, view:object, fit:number}}   g is the drawn template (keep it for Undo); fit is the zoom that fits width
 */
function mount(host, wf, { width = 680, zoom, mode = 'static', aligned = false, select = '', says = null, g = null } = {}) {
  let graph = g || build(wf, says); if (!g && aligned) graph = align(graph);
  host.innerHTML = '';
  const view = createGraphView(host, { doc: host.ownerDocument, mode, portsFn: graph.portsFn, agents: graph.agents, describe: true, modelLabel: (id) => MODEL_WORDS[id] || id });
  view.render(graph.tpl, {});
  const full = view.bounds(60)?.w || width, fit = Math.min(1, width / full);   // fitToWidth measures with this padding
  if (zoom !== undefined) { width = Math.round(full * (zoom || fit)); host.style.width = `${width}px`; }
  const b = view.bounds(24); if (b) host.style.height = `${Math.ceil(b.h * Math.min(1, width / b.w)) + 8}px`;
  view.fitToWidth(width);
  host.querySelectorAll('.wbadge').forEach((w) => { if (mode === 'static') w.textContent = w.textContent.replace(/≤\s*(\d+)/, 'sends fixes back, up to $1×'); });
  if (mode === 'static') host.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));   // a drawing: nothing in it takes a key
  if (select) host.querySelector(`[data-node-id="${select}"]`)?.classList.add('is-picked');
  return { g: graph, view, fit };
}

window.RailGraph = { mount, build, align };
