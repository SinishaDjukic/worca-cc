// src/core/workflow-validator.mjs
// Pure validator (imports only the channel constants from channels.mjs) for a
// WorkflowTemplate against an agent registry. Collects ALL violations (does not
// short-circuit) so the UI/API can show every problem at once. Returns
// { ok, errors:string[], warnings:string[] } (warnings are soft: reachability/
// governance/multi-producer hints that never set ok=false, so saved
// topology-only pipelines stay valid).
//
// Rules (CONTRACT §workflow-validator):
//   1. template is a non-null object with a non-empty steps array;
//   2. no empty steps (every step has >= 1 node);
//   3. every node has a non-blank string id, and ids are unique workflow-wide;
//   4. every node.key exists in the registry;
//   5. feedback from/to reference existing node ids;
//   6. a feedback's target step index < its source step index
//      (a same-node self-loop, from===to, is allowed; the forward graph is
//       otherwise acyclic so only back-edges are legal feedbacks);
//   7. feedback ids are unique.

import { CHANNEL_IDS, PRESEEDED_CHANNELS } from './channels.mjs';

/**
 * @param {object} tpl  WorkflowTemplate { steps:[[{id,key}]], feedbacks:[{id,from,to}] }
 * @param {Record<string,{key:string}>} registry  loadAgentRegistry() output
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateWorkflow(tpl, registry) {
  const errors = [];
  const reg = registry && typeof registry === 'object' ? registry : {};

  if (!tpl || typeof tpl !== 'object' || !Array.isArray(tpl.steps)) {
    return { ok: false, errors: ['workflow must be an object with a steps array'], warnings: [] };
  }
  if (tpl.steps.length === 0) {
    errors.push('workflow must have at least one step');
  }

  // Pass 1: nodes — shape, unique ids, known keys. Build id -> stepIndex map.
  const stepOfNode = new Map(); // nodeId -> step index
  const seenIds = new Set();
  for (let i = 0; i < tpl.steps.length; i++) {
    const group = tpl.steps[i];
    if (!Array.isArray(group) || group.length === 0) {
      errors.push(`step ${i} is empty (a step must contain at least one node)`);
      continue;
    }
    for (const node of group) {
      if (!node || typeof node !== 'object') {
        errors.push(`step ${i} contains a non-object node`);
        continue;
      }
      const id = typeof node.id === 'string' ? node.id.trim() : '';
      if (!id) {
        errors.push(`step ${i} has a node with a missing or blank id`);
        continue;
      }
      if (seenIds.has(id)) {
        errors.push(`duplicate node id "${id}"`);
      } else {
        seenIds.add(id);
        stepOfNode.set(id, i);
      }
      const key = typeof node.key === 'string' ? node.key.trim() : '';
      if (!key) {
        errors.push(`node "${id}" has a missing or blank key`);
      } else if (!Object.prototype.hasOwnProperty.call(reg, key)) {
        errors.push(`node "${id}" has key "${key}" which is not in the agent registry`);
      }
    }
  }

  // Pass 2: feedbacks — unique ids, endpoints exist, target precedes source.
  const feedbacks = Array.isArray(tpl.feedbacks) ? tpl.feedbacks : [];
  const seenFb = new Set();
  for (const fb of feedbacks) {
    if (!fb || typeof fb !== 'object') {
      errors.push('feedbacks contains a non-object entry');
      continue;
    }
    const fid = typeof fb.id === 'string' ? fb.id.trim() : '';
    if (!fid) {
      errors.push('a feedback has a missing or blank id');
    } else if (seenFb.has(fid)) {
      errors.push(`duplicate feedback id "${fid}"`);
    } else {
      seenFb.add(fid);
    }
    const from = typeof fb.from === 'string' ? fb.from.trim() : '';
    const to = typeof fb.to === 'string' ? fb.to.trim() : '';
    const hasFrom = stepOfNode.has(from);
    const hasTo = stepOfNode.has(to);
    if (!hasFrom) errors.push(`feedback "${fid || '?'}" from "${from}" does not exist`);
    if (!hasTo) errors.push(`feedback "${fid || '?'}" to "${to}" does not exist`);
    if (hasFrom && hasTo) {
      const sFrom = stepOfNode.get(from);
      const sTo = stepOfNode.get(to);
      // A same-node self-loop (from === to) is legal (the refine loop). Otherwise
      // the target step must strictly precede the source step (a back-edge).
      if (from !== to && sTo >= sFrom) {
        errors.push(
          `feedback "${fid || '?'}" target step (${sTo}) must precede its source step (${sFrom})`,
        );
      }
    }
  }

  // Pass 3: WARNINGS (never block saves, so existing topology-only pipelines stay
  // valid). Forward order = step order.
  const warnings = [];
  // Pre-seeded channels (derived from channels.mjs — the dispatcher's bus literal)
  // are always reachable and never warn.
  const PRESEEDED = new Set(PRESEEDED_CHANNELS);
  const NON_MULTIPLEXABLE = new Set(['code', 'plan']); // one producer per step
  const produced = new Set();
  for (let i = 0; i < tpl.steps.length; i++) {
    const group = Array.isArray(tpl.steps[i]) ? tpl.steps[i] : [];
    // (a) reachability: a required, non-pre-seeded channel must be produced earlier
    for (const node of group) {
      const meta = reg[node?.key] || {};
      const optional = new Set(meta.optionalConsumes || []);
      for (const c of meta.consumes || []) {
        if (optional.has(c) || PRESEEDED.has(c) || produced.has(c)) continue;
        warnings.push(`node "${node.id}" consumes "${c}" but no upstream step produces it`);
      }
    }
    // (b) multi-producer (D2) + stale-sibling (D3): scan within the step
    const stepProducers = new Map(); // channel -> count
    for (const node of group) for (const c of (reg[node?.key]?.produces || [])) {
      stepProducers.set(c, (stepProducers.get(c) || 0) + 1);
    }
    for (const [c, n] of stepProducers) {
      if (n > 1 && NON_MULTIPLEXABLE.has(c)) {
        warnings.push(`step ${i} has ${n} producers of "${c}" (only one producer per step is well-defined)`);
      }
    }
    for (const node of group) {
      const meta = reg[node?.key] || {};
      const optional = new Set(meta.optionalConsumes || []);
      for (const c of meta.consumes || []) {
        // a channel produced ONLY by a same-step sibling is read stale (pre-step snapshot)
        if (!optional.has(c) && !produced.has(c) && !PRESEEDED.has(c) && stepProducers.has(c)) {
          warnings.push(`node "${node.id}" consumes "${c}" produced only by a same-step sibling; it reads the pre-step value`);
        }
      }
    }
    // commit this step's production AFTER the step (matches the frozen-snapshot model)
    for (const [c] of stepProducers) produced.add(c);
  }
  // (d) custom-channel hygiene: a PRODUCED channel that is neither built-in nor
  // declared by any registry channelDef silently defaults to a generic markdown
  // artifact — surface that once per channel so a wizard/meta typo is visible.
  const builtinChannels = new Set(CHANNEL_IDS);
  const definedCustom = new Set();
  for (const m of Object.values(reg)) {
    for (const d of m?.channelDefs || []) if (d?.id) definedCustom.add(d.id);
  }
  const flaggedDefless = new Set();
  for (const group of tpl.steps) {
    for (const node of Array.isArray(group) ? group : []) {
      for (const c of reg[node?.key]?.produces || []) {
        if (builtinChannels.has(c) || definedCustom.has(c) || flaggedDefless.has(c)) continue;
        flaggedDefless.add(c);
        warnings.push(`custom channel "${c}" (produced by "${node.id}") has no channelDef; it defaults to markdown "${c}.md"`);
      }
    }
  }
  // (c) governance: every adjacent forward edge + every feedback edge must be allowed
  const keyOf = new Map();
  tpl.steps.forEach((g) => (Array.isArray(g) ? g : []).forEach((n) => keyOf.set(n.id, n.key)));
  const allows = (fromKey, toKey) => {
    const ct = reg[fromKey]?.connectsTo;
    return ct === '*' || ct === undefined || !Array.isArray(ct) || ct.includes(toKey);
  };
  for (let i = 0; i < tpl.steps.length - 1; i++) {
    for (const a of tpl.steps[i] || []) for (const b of tpl.steps[i + 1] || []) {
      if (!allows(a.key, b.key)) warnings.push(`"${a.key}" is not allowed to connect to "${b.key}" (connectsTo)`);
    }
  }
  for (const fb of Array.isArray(tpl.feedbacks) ? tpl.feedbacks : []) {
    const fk = keyOf.get(fb?.from), tk = keyOf.get(fb?.to);
    if (fk && tk && !allows(fk, tk)) warnings.push(`feedback "${fb.id || '?'}": "${fk}" is not allowed to connect to "${tk}" (connectsTo)`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
