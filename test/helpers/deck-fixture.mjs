// test/helpers/deck-fixture.mjs
// The Presentation (Deck) workflow: 14 cards, 29 wires, six reviewers whose
// blocking findings collect in one OR that loops back into Deck Builder — the
// graph the 2026-10-10 wire-lanes study was measured on. Positions are the
// hand-placed ones (48px gaps, OR under Deck Audit / Deck Review); autoLayout
// gives the roomy one.
import { portsFnFor } from '../../src/shared/graph/ports.mjs';

const md = (id, x = {}) => ({ id, type: 'md', required: true, ...x });
const out = (id, type = 'md', when = 'always') => ({ id, type, when });
const reviewer = (ins, first) => ({ inputs: ins, outputs: [...first, out('findings', 'md', 'blocking'), out('pass', 'void', 'clean')] });
const REG = {
  clarify: { inputs: [md('task')], outputs: [out('answers', 'json')] },
  narr: { inputs: [md('task'), { id: 'answers', type: 'json', required: true }], outputs: [out('spine')] },
  system: { inputs: [md('spine')], outputs: [out('system')] },
  build: { inputs: [md('spine'), md('system'), { id: 'answers', type: 'json', required: false }, md('fixes', { required: false, loop: true })], outputs: [out('built')] },
  audit: reviewer([md('built')], []),
  review: { inputs: [md('system'), md('task')], outputs: [out('review', 'md', 'blocking'), out('pass', 'void', 'clean')] },
  outputs: { inputs: [md('task')], outputs: [out('answers', 'json')] },
  pdf: reviewer([md('built')], [out('report')]),
  audio: reviewer([md('built')], [out('report')]),
  bundle: reviewer([md('built')], [out('bundle')]),
  export: reviewer([md('built'), md('task')], [out('report')]),
};
export const deckPortsFn = portsFnFor(Object.fromEntries(Object.entries(REG).map(([key, m]) => [key, { key, ...m }])));

const card = (id, kind, key, x, y, config = {}) => ({ id, kind, ...(key ? { key } : {}), x, y, config });
const W = (id, fn, fp, tn, tp, config) => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp }, ...(config ? { config } : {}) });

export function deckTemplate() {
  return {
    id: 'wf_presentation', name: 'Presentation', version: 2, domain: '',
    nodes: [
      card('n_task', 'task', null, 40, 200), card('n_clarify', 'agent', 'clarify', 320, 200),
      card('n_narr', 'agent', 'narr', 600, 200), card('n_system', 'agent', 'system', 880, 200),
      card('n_build', 'agent', 'build', 1160, 200), card('n_audit', 'agent', 'audit', 1440, 200),
      card('n_review', 'agent', 'review', 1720, 200), card('n_outputs', 'agent', 'outputs', 320, 430),
      card('n_pdf', 'agent', 'pdf', 2000, 200), card('n_audio', 'agent', 'audio', 2280, 200),
      card('n_bundle', 'agent', 'bundle', 2560, 200), card('n_export', 'agent', 'export', 2840, 200),
      card('n_or', 'or', null, 1580, 430, { arity: 6 }), card('n_end', 'end', null, 3120, 200),
    ],
    wires: [
      W('w1', 'n_task', 'task', 'n_clarify', 'task'), W('w2', 'n_task', 'task', 'n_narr', 'task'),
      W('w3', 'n_clarify', 'answers', 'n_narr', 'answers'), W('w4', 'n_narr', 'spine', 'n_system', 'spine'),
      W('w5', 'n_narr', 'spine', 'n_build', 'spine'), W('w6', 'n_system', 'system', 'n_build', 'system'),
      W('w7', 'n_system', 'system', 'n_review', 'system'), W('w8', 'n_build', 'built', 'n_audit', 'built'),
      W('w9', 'n_audit', 'pass', 'n_review', 'await'), W('w12', 'n_audit', 'findings', 'n_or', 'in1', { maxCycles: 3 }),
      W('w14', 'n_review', 'review', 'n_or', 'in2', { maxCycles: 3 }), W('w15', 'n_or', 'out', 'n_build', 'fixes'),
      W('w17', 'n_build', 'built', 'n_export', 'built'), W('w18', 'n_task', 'task', 'n_export', 'task'),
      W('w19', 'n_export', 'findings', 'n_or', 'in3', { maxCycles: 2 }), W('w20', 'n_export', 'pass', 'n_end', 'result'),
      W('w21', 'n_task', 'task', 'n_review', 'task'), W('w22', 'n_audio', 'pass', 'n_bundle', 'await'),
      W('w23', 'n_build', 'built', 'n_bundle', 'built'), W('w24', 'n_bundle', 'pass', 'n_export', 'await'),
      W('w25', 'n_bundle', 'findings', 'n_or', 'in4', { maxCycles: 2 }), W('w26', 'n_task', 'task', 'n_outputs', 'task'),
      W('w27', 'n_review', 'pass', 'n_pdf', 'await'), W('w28', 'n_build', 'built', 'n_pdf', 'built'),
      W('w30', 'n_pdf', 'pass', 'n_audio', 'await'), W('w31', 'n_build', 'built', 'n_audio', 'built'),
      W('w37', 'n_outputs', 'answers', 'n_build', 'answers'), W('w35', 'n_pdf', 'findings', 'n_or', 'in5', { maxCycles: 2 }),
      W('w36', 'n_audio', 'findings', 'n_or', 'in6', { maxCycles: 2 }),
    ],
  };
}
