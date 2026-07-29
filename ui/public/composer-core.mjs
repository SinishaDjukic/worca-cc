// ui/public/composer-core.mjs
// Framework-free, DOM-free helpers for the Pipeline Composer. Imported by
// ui/public/app.js (browser, type="module") AND by test/composer-ui.test.mjs
// (node:test, no jsdom). KEEP THIS FILE FREE OF document/window references so it
// stays unit-testable in isolation — DOM wiring lives in app.js.

// ---------------------------------------------------------------------------
// topology(steps, feedbacks) -> WorkflowTemplate {steps,feedbacks} body.
// Canvas model uses throwaway local ids (n1, n7…). The persisted contract uses
// stable instance ids "s{stepIndex}_{memberIndex}" (e.g. "s0_0"); feedback
// from/to reference those instance ids. We rebuild the id map and remap edges,
// dropping any edge whose endpoint is gone (defensive; the UI prunes these too).
// ---------------------------------------------------------------------------
export function topology(steps, feedbacks) {
  const idMap = {}; // localId -> "sI_J"
  const outSteps = steps.map((col, i) =>
    col.map((node, j) => {
      const id = `s${i}_${j}`;
      idMap[node.id] = id;
      return { id, key: node.key };
    }),
  );
  const outFeedbacks = [];
  (feedbacks || []).forEach((fb) => {
    const from = idMap[fb.from];
    const to = idMap[fb.to];
    if (from && to) outFeedbacks.push({ id: `fb_${outFeedbacks.length}`, from, to });
  });
  return { steps: outSteps, feedbacks: outFeedbacks };
}

// metaLine(steps, feedbacks) -> "N steps · M agents[ · K feedback loop(s)]"
// (saved-pipelines card meta line). Mirrors the mockup's renderList meta string.
export function metaLine(steps, feedbacks) {
  const nSteps = steps.length;
  const nAgents = steps.reduce((sum, col) => sum + col.length, 0);
  const nLoops = (feedbacks || []).length;
  let s = `${nSteps} steps · ${nAgents} agents`;
  if (nLoops) s += ` · ${nLoops} feedback loop${nLoops > 1 ? 's' : ''}`;
  return s;
}

// distinctAgents(steps) -> ordered unique role keys (for the chip row).
export function distinctAgents(steps) {
  const seen = [];
  steps.forEach((col) => col.forEach((node) => {
    if (!seen.includes(node.key)) seen.push(node.key);
  }));
  return seen;
}

// Embedded agent registry — fallback for the palette when /api/agents is
// unavailable (e.g. a sibling phase's endpoint not yet wired). Keys are the
// canonical camelCase agent keys; icon = inner SVG markup, viewBox "0 0 24 24"
// (glyphs copied from the standalone mockup's ICON map). The live registry from
// GET /api/agents overrides this whenever present (see mergePalette).
export const EMBEDDED_AGENTS = {
  clarify: {
    key: 'clarify', displayName: 'Clarify', description: 'surface open decisions before planning',
    color: 'red', order: 0, connectsTo: ['planner'],
    icon: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.1-2.6 3.6" stroke-linecap="round" fill="none"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>',
  },
  planner: {
    key: 'planner', displayName: 'Plan', description: 'architecture & breakdown',
    color: 'violet', order: 1, connectsTo: ['refiner', 'implementer', 'decomposer'],
    icon: '<path d="M8 6h11M8 12h11M8 18h8" stroke-linecap="round"/><circle cx="4" cy="6" r="1.1"/><circle cx="4" cy="12" r="1.1"/><circle cx="4" cy="18" r="1.1"/>',
  },
  refiner: {
    key: 'refiner', displayName: 'Refine Plan', description: 'tighten the plan',
    color: 'green', order: 2, connectsTo: ['implementer', 'refiner', 'decomposer'],
    icon: '<path d="M12 3v3M12 18v3M4.5 7.5l2 1M17.5 15.5l2 1M4.5 16.5l2-1M17.5 8.5l2-1" stroke-linecap="round"/><path d="M12 8.2l1.2 2.6L16 12l-2.8 1.2L12 15.8l-1.2-2.6L8 12l2.8-1.2L12 8.2Z" stroke-linejoin="round"/>',
  },
  decomposer: {
    key: 'decomposer', displayName: 'Decompose', description: 'break plan into vertical-slice tasks',
    color: 'blue', order: 2.5, connectsTo: ['implementer'],
  },
  implementer: {
    key: 'implementer', displayName: 'Implementation', description: 'write the code',
    color: 'peach', order: 3, connectsTo: ['reviewer', 'manualTestsChecklist'],
    icon: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  reviewer: {
    key: 'reviewer', displayName: 'Review Implementation', description: 'verify & report',
    color: 'blue', order: 4, connectsTo: ['implementer', 'manualTestsChecklist'],
    icon: '<path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  manualTestsChecklist: {
    key: 'manualTestsChecklist', displayName: 'Manual Tests Checklist', description: 'draft manual cases',
    color: 'blue', order: 5, connectsTo: ['manualWebUiTesting'],
    icon: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V2.8h5V4" stroke-linejoin="round"/><path d="M8.8 12l1.6 1.6L13.4 10" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  manualWebUiTesting: {
    key: 'manualWebUiTesting', displayName: 'Manual web UI testing', description: 'run cases via Playwright',
    color: 'violet', order: 6, connectsTo: ['implementer'],
    icon: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5V8.5Z" fill="currentColor" stroke="none"/>',
  },
  planReviewer: {
    key: 'planReviewer', displayName: 'Plan Review', description: 'review the plan, bounce to planner',
    color: 'amber', order: 7, connectsTo: ['planner', 'implementer', 'decomposer'],
    icon: '<path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z"/><path d="M15.5 15.5L21 21" stroke-linecap="round"/><path d="M7.6 10.3l2 2 3.3-3.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
};

// mergePalette(agentsResponse) -> ordered Array<{key,displayName,description,color,icon,origin,order}>.
// Prefers the live registry (GET /api/agents -> { agents:[…] } or a bare array);
// falls back to EMBEDDED_AGENTS. Always sorted by .order so the palette is stable.
export function mergePalette(agentsResponse) {
  let list = null;
  if (Array.isArray(agentsResponse)) list = agentsResponse;
  else if (agentsResponse && Array.isArray(agentsResponse.agents)) list = agentsResponse.agents;
  if (!list || !list.length) list = Object.values(EMBEDDED_AGENTS);
  return list
    .map((a) => ({
      key: a.key,
      displayName: a.displayName || a.key,
      description: a.description || '',
      color: a.color || 'blue',
      icon: a.icon || '',
      // Trusted-icon gate: only 'user' is untrusted; the EMBEDDED_AGENTS
      // fallback has no origin and is repo-shipped -> 'builtin' is correct.
      origin: a.origin === 'user' ? 'user' : 'builtin',
      order: typeof a.order === 'number' ? a.order : 99,
      domain: typeof a.domain === 'string' && a.domain ? a.domain : 'general',
      connectsTo: a.connectsTo === undefined ? '*' : a.connectsTo,
      produces: Array.isArray(a.produces) ? a.produces : [],
      consumes: Array.isArray(a.consumes) ? a.consumes : [],
      optionalConsumes: Array.isArray(a.optionalConsumes) ? a.optionalConsumes : [],
    }))
    .sort((x, y) => x.order - y.order);
}

// groupPaletteByDomain(palette, domains) -> ordered [{domain, agents:[...]}].
// Each group = that domain's own agents PLUS every `shared` agent prepended,
// then sorted by .order. Pure: no DOM. `domains` is the ordered header list
// (general last, shared excluded) — see collectDomains / paletteDomains.
export function groupPaletteByDomain(palette, domains) {
  const list = Array.isArray(palette) ? palette : [];
  const shared = list.filter((a) => a.domain === 'shared');
  const byOrder = (x, y) => x.order - y.order;
  return (Array.isArray(domains) ? domains : []).map((domain) => ({
    domain,
    agents: [...shared, ...list.filter((a) => a.domain === domain)].sort(byOrder),
  }));
}

// defaultTopologyFromTemplate(tpl, mk) -> canvas model {steps,feedbacks} with
// FRESH local ids (mk(key) -> {id,key}). The server template's instance ids
// (s*_*) are deliberately discarded: once on the canvas, nodes get throwaway
// local ids and topology() re-stamps contract ids on save. Feedback edges are
// rewired from server ids to the new local ids by walking the same order.
export function defaultTopologyFromTemplate(tpl, mk) {
  if (!tpl || !Array.isArray(tpl.steps) || !tpl.steps.length) {
    return { steps: [], feedbacks: [] };
  }
  const remap = {}; // serverId -> localId
  const steps = tpl.steps.map((col) =>
    col.map((node) => {
      const local = mk(node.key);
      remap[node.id] = local.id;
      return local;
    }),
  );
  const feedbacks = (tpl.feedbacks || [])
    .filter((fb) => remap[fb.from] && remap[fb.to])
    .map((fb) => ({ from: remap[fb.from], to: remap[fb.to] }));
  return { steps, feedbacks };
}

// Channels a pipeline gets without any producing NODE adjacent on the canvas: the
// user prompt, the shared worktree, the frozen workspace snapshot, and the clarify
// pre-step. Module-local on purpose — this is NOT channels.mjs PRESEEDED_CHANNELS
// (that one lists the validator's value-bearing bus seeds and includes
// plan/checklist; here plan/checklist stay checkable so a producer-less consumer
// of real content still warns, while this no-build browser module keeps zero
// imports from src/core).
const SOFT_PRESEEDED = ['userPrompt', 'code', 'workspace', 'clarify'];

// canConnect(fromKey, toKey, agents) -> { ok, reason, warn? }.
// Governance (connectsTo) is the HARD gate, exactly as before — and an explicit
// allowlist that admits the target is treated as AUTHOR-CURATED: the soft channel
// check is skipped (e.g. decomposer -> implementer, where the plan flows through
// from upstream via the bus). Only wildcard links get the soft pairwise check:
// when the source produces nothing the target consumes AND the target's required
// inputs are not all pre-seeded, we return ok:true with a `warn` string the UI
// surfaces as a toast.
export function canConnect(fromKey, toKey, agents) {
  const from = agents && agents[fromKey];
  const ct = from ? from.connectsTo : '*';
  if (Array.isArray(ct)) {
    if (!ct.includes(toKey)) {
      const fn = (from && from.displayName) || fromKey;
      const tn = (agents[toKey] && agents[toKey].displayName) || toKey;
      return { ok: false, reason: `${fn} can’t connect to ${tn}` };
    }
    return { ok: true, reason: '' }; // curated allowlist: author vetted this link
  }
  const to = agents && agents[toKey];
  if (from && to && Array.isArray(from.produces) && Array.isArray(to.consumes)
      && from.produces.length && to.consumes.length) {
    const feeds = from.produces.some((c) => to.consumes.includes(c));
    const required = to.consumes.filter((c) =>
      !(Array.isArray(to.optionalConsumes) && to.optionalConsumes.includes(c)) &&
      !SOFT_PRESEEDED.includes(c));
    if (!feeds && required.length) {
      const fn = from.displayName || fromKey;
      const tn = to.displayName || toKey;
      return { ok: true, reason: '', warn: `${fn} produces [${from.produces.join(', ')}] but ${tn} needs [${required.join(', ')}]` };
    }
  }
  return { ok: true, reason: '' };
}
