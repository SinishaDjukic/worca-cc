// src/shared/graph/self-review.mjs — the engine rule "no node reviews its own output" (small runs C2, D10). Pure and
// browser-safe: any workflow can check a graph with it; Shaper's Care graphs are one caller.
import { roleReviewOf, roleTargetOf } from './role-review-step.mjs';
import { classifyLoops } from './loops.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The reviewers of `template` that review their own output. A reviewer is a node with a `roleReview` config or a
 * verifier sidecar (`runnerType: 'verifier'`). Its writers are the source nodes of the wires into its reviewed port and
 * its continue port (ROLE_REVIEW_TARGETS); a verifier without `roleReview` reviews every wired non-loop input. For a
 * `target: 'diff'` review, or a verifier with a code node (`sideEffect: 'code'`) upstream, every code node is a writer
 * too. Session groups are out of scope.
 * @param {{nodes?: object[], wires?: object[]}} template
 * @param {(node: object) => object|undefined} metaOf the agent sidecar of an agent node
 * @returns {Array<{reviewer: string, output: string}>} `output` is `node.port` of the wire, or `code`
 */
export function selfReviewViolations(template, metaOf) {
  const nodes = (Array.isArray(template?.nodes) ? template.nodes : []).filter((n) => isObj(n) && typeof n.id === 'string');
  const wires = (Array.isArray(template?.wires) ? template.wires : []).filter((w) => isObj(w?.from) && isObj(w?.to));
  const meta = (n) => (n.kind === 'agent' && typeof metaOf === 'function' ? metaOf(n) || null : null);
  const portsFn = (n) => { const m = meta(n); return m ? { inputs: m.inputs || [], outputs: m.outputs || [] } : undefined; };
  const { loopWireIds, loopInputs } = classifyLoops({ nodes, wires }, portsFn);
  const isCode = (n) => meta(n)?.sideEffect === 'code';
  const codeIds = nodes.filter(isCode).map((n) => n.id);

  const upstream = (id) => {
    const seen = new Set();
    const todo = [id];
    while (todo.length) {
      const cur = todo.pop();
      for (const w of wires) {
        if (w.to.node !== cur || seen.has(w.from.node)) continue;
        seen.add(w.from.node);
        todo.push(w.from.node);
      }
    }
    return seen;
  };

  const out = [];
  for (const n of nodes) {
    const spec = n.kind === 'agent' ? roleReviewOf(n.config) : null;
    const verifier = meta(n)?.runnerType === 'verifier';
    if (!spec && !verifier) continue;
    let reviewed;
    if (spec) {
      const t = roleTargetOf(spec);
      const ports = new Set([t.reviewedPort, t.continuePort]);
      reviewed = wires.filter((w) => w.to.node === n.id && ports.has(w.to.port));
    } else {
      // A loop input carries work back for another round, not the reviewed output; a wire from the node itself is
      // always its own output, loop or not.
      reviewed = wires.filter((w) => w.to.node === n.id
        && (w.from.node === n.id || (!loopWireIds.has(w.id) && !loopInputs.has(`${n.id}.${w.to.port}`))));
    }
    const writers = reviewed.map((w) => ({ id: w.from.node, output: `${w.from.node}.${w.from.port}` }));
    const ups = spec?.target === 'diff' || (!spec && codeIds.some((id) => upstream(n.id).has(id)));
    if (ups) for (const id of codeIds) writers.push({ id, output: 'code' });
    const own = writers.find((x) => x.id === n.id);
    if (own) out.push({ reviewer: n.id, output: own.output });
  }
  return out;
}
