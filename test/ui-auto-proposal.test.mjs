import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAutoProposal, proposalLoops, proposalBands, fingerprintLine, AUTO_PROPOSAL_ORDER_QPANEL } from '../ui/public/auto-proposal.mjs';
import { proposalFor, WEB_TASK } from './helpers/auto-proposal-fixture.mjs';
import { FLOW_PAD_Y } from '../src/shared/graph/flow-layout.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const xy = (el) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform); return { x: Number(m[1]), y: Number(m[2]) }; };

test('proposal body: card order, real graph rows agree with p.order, 4-per-row at 702px / 1 at 310px, and a bare relayout() keeps the construction width', async () => {
  await checkRows([
    { name: 'body parts in card order, real graph at chat scale: 4 cards per row in a 702px host, 1 per row in 310', run: () => {
      const p = proposalFor();
      const h = renderAutoProposal(p, { doc, width: 702 });
      assert.deepEqual([...h.el.children].map((c) => c.className.split(' ')[0]), ['ask-wfcard-namewrap', 'ask-wfcard-reason', 'ask-wfcard-signals', 'ask-wfcard-fp', 'ask-wfcard-graph', 'ask-wfcard-loops', 'ask-wfcard-match', 'ask-wfcard-meta']);
      const stage = h.parts.graph.querySelector('.gv-stage.gv-static.gv-flow');
      assert.ok(stage); assert.equal(stage.style.getPropertyValue('--gv-scale'), '0.65'); assert.equal(stage.style.getPropertyValue('--gv-node-w'), '143px');
      const lay = h.graph.flowLayout();
      assert.equal(lay.perRow, 4);
      const firstRow = lay.order.slice(0, 4).map((id) => xy(h.graph.nodeEl(id)));
      assert.deepEqual(firstRow.map((q) => q.y), [FLOW_PAD_Y, FLOW_PAD_Y, FLOW_PAD_Y, FLOW_PAD_Y]);
      assert.deepEqual(firstRow.map((q) => q.x), [20, 189, 358, 527]);
      assert.equal(lay.order[0], p.manifest.graph.nodes.find((n) => n.kind === 'task').id, 'Task first');
      assert.deepEqual(lay.order.slice(1, 1 + p.order.length), p.order, 'agents in dispatch order');
      assert.deepEqual(lay.order.filter((id) => p.nodes[id]), p.order, 'the graph rows and the tunables table (p.order) agree — A5 rank-first must reproduce the proposal order');
      assert.equal(lay.order.at(-1), p.manifest.graph.nodes.find((n) => n.kind === 'end').id, 'End last');
      assert.equal(h.parts.graph.style.height, `${lay.height}px`);
      assert.equal(h.parts.graph.querySelectorAll('.nband').length, p.order.length, 'one band per agent');
      assert.ok([...h.parts.graph.querySelectorAll('.bchip.model')].some((c) => c.textContent === 'Sonnet 5'));
      assert.ok([...h.parts.graph.querySelectorAll('.wbadge')].every((b) => /^\d+×$/.test(b.textContent)));
      const aria = h.parts.graph.getAttribute('aria-label');
      assert.match(aria, /^Workflow graph: Task → /);
      assert.ok(aria.includes(' → OR → End'), 'every card in placement order, the valve included');
      h.destroy();
      const narrow = renderAutoProposal(p, { doc, width: 310 });
      assert.equal(narrow.graph.flowLayout().perRow, 1);
      assert.ok(narrow.graph.flowLayout().order.every((id) => xy(narrow.graph.nodeEl(id)).x === 20));
      narrow.destroy();
    } },
    { name: 'a bare relayout() keeps the construction width when the host still measures 0', run: () => {
      // The host that supplies an explicit `width` is the one whose element is not attached yet,
      // so clientWidth is 0 there — a bare relayout() must not fall through to the 702 default and
      // undo the width the host asked for.
      const p = proposalFor();
      const h = renderAutoProposal(p, { doc, width: 310 });
      assert.equal(h.graph.flowLayout().perRow, 1);
      h.relayout();
      assert.equal(h.graph.flowLayout().perRow, 1, 'still one card per row');
      h.relayout(702);
      assert.equal(h.graph.flowLayout().perRow, 4, 'an explicit width still wins');
      h.destroy();
    } },
  ]);
});

test('chips, fingerprint, loops (through the OR valve), match line, meta; name editing updates the match line', () => {
  const p = proposalFor();
  const h = renderAutoProposal(p, { doc, width: 702, order: AUTO_PROPOSAL_ORDER_QPANEL, rounds: 2, costUsd: 0.04 });
  assert.deepEqual([...h.el.children].map((c) => c.className.split(' ')[0]).slice(0, 4), ['ask-wfcard-reason', 'ask-wfcard-signals', 'ask-wfcard-fp', 'ask-wfcard-namewrap'], 'the question-panel order puts the name after the fingerprint');
  assert.deepEqual([...h.parts.signals.children].map((c) => c.textContent), ['prompt', 'medium', 'web UI']);
  assert.equal(h.parts.fp.textContent, 'fingerprintweb-ui likely (react); tests: jsdom');
  const loops = proposalLoops(p.manifest);
  assert.ok(loops.length >= 2);
  assert.ok(loops.every((l) => p.manifest.graph.nodes.find((n) => n.id === l.to).kind === 'agent'), 'loop targets resolve through the valve to an agent');
  assert.equal(h.parts.loops.children.length, loops.length);
  assert.match(h.parts.match.textContent, /No saved workflow has this shape — will be saved as "/);
  assert.match(h.parts.meta.textContent, /^classifier ≈ \$0\.04 · \d+ agents · \d+ loops · 2 rounds$/);
  h.parts.name.querySelector('.ask-wfcard-edit').click();
  const field = h.parts.name.querySelector('.ask-wfcard-field');
  assert.equal(h.parts.name.querySelector('.ask-wfcard-nameedit').hidden, false);
  field.value = 'Theme switch'; field.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(h.getName(), 'Theme switch');
  assert.match(h.parts.match.textContent, /"Theme switch"/);
  h.parts.name.querySelector('.ask-wfcard-edit').click(); field.value = 'zzz'; field.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(h.getName(), 'Theme switch', 'Esc reverts');
  h.setNodeTunables(p.order[1], { model: 'claude-opus-5-5', effort: 'max', askQuestions: true });
  const band = h.graph.nodeEl(p.order[1]).querySelector('.nband');
  assert.deepEqual([...band.querySelectorAll('.bchip')].map((c) => c.textContent).slice(0, 3), ['Opus 5.5', 'max', 'asks']);
  h.destroy();
});

test('a matched proposal reads "Same as your saved workflow"; an empty graph mounts nothing; helpers are pure', () => {
  const p = proposalFor(WEB_TASK, { match: { id: 'wf_x', name: 'Web feature' } });
  const h = renderAutoProposal(p, { doc, width: 702 });
  assert.ok(h.parts.match.classList.contains('is-hit')); assert.match(h.parts.match.textContent, /Same as your saved workflow "Web feature"/);
  h.destroy();
  const empty = renderAutoProposal({ round: 1, name: 'x', manifest: { graph: { nodes: [], wires: [] } }, nodes: {}, order: [] }, { doc });
  assert.equal(empty.graph, null);
  assert.equal(fingerprintLine({ signals: ['fingerprint: node 22 · npm'], fingerprint: 'top-level: a' }), 'node 22 · npm');
  assert.equal(fingerprintLine({ fingerprint: 'top-level: a' }), 'top-level: a');
  assert.equal(fingerprintLine({}), '');
  assert.deepEqual(proposalBands({ models: [{ id: 'm', label: 'M' }], nodes: { n: { model: '', effort: '', askQuestions: false } }, manifest: { graph: { nodes: [], wires: [] } } }), { n: { model: '', effort: '', flags: [] } });
});

test('workspace proposal: target chip first with member names, "per project" band flag on locked nodes, workspace header as fingerprint', () => {
  const empty = { graph: { nodes: [], wires: [] } };
  const ws = renderAutoProposal({ round: 1, name: 'x', target: 'workspace', members: ['Alpha', 'Beta'], taskKind: 'prompt', manifest: empty, nodes: {}, order: [] }, { doc });
  const first = ws.parts.signals.children[0];
  assert.equal(first.className, 'ask-wfcard-sig target');
  assert.equal(first.textContent, 'workspace · 2 projects');
  assert.equal(first.title, 'Alpha, Beta');
  assert.equal(ws.parts.signals.children[1].textContent, 'prompt');
  ws.destroy();
  for (const target of ['project', undefined]) {
    const pr = renderAutoProposal({ round: 1, name: 'x', target, members: ['Alpha'], taskKind: 'prompt', manifest: empty, nodes: {}, order: [] }, { doc });
    assert.equal(pr.parts.signals.querySelector('.target'), null, `no target chip for target=${target}`);
    pr.destroy();
  }
  const bands = proposalBands({ nodes: { a: { model: '', effort: '', fanOutLocked: true, runKey: 'a' }, b: { model: '', effort: '' } }, manifest: empty });
  assert.deepEqual(bands.a.flags, [{ text: 'per project', cls: 'fan', title: 'Runs per project on a workspace' }]);
  assert.deepEqual(bands.b.flags, []);
  const fingerprint = 'workspace: Team — 2 projects\ndescription: shared\n## A (a)\nhints: x\n## B (b)\nhints: y';
  assert.equal(fingerprintLine({ target: 'workspace', fingerprint }), 'workspace: Team — 2 projects');
  assert.equal(fingerprintLine({ target: 'workspace', signals: ['fingerprint: ws sig'], fingerprint }), 'ws sig', 'a fingerprint: signal still wins');
  assert.equal(fingerprintLine({ target: 'project', fingerprint: 'top-level: a\nhints: web-ui' }), 'web-ui');
});
