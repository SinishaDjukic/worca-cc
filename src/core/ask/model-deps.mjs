// src/core/ask/model-deps.mjs
// The models + providers dependency bundle of the Ask Worca tools (docs/models.md "Ask Worca"):
// the ONE module that touches the catalog and the bridge on the tools' behalf (tools.mjs may not
// import anything). Two callers:
//   • the MCP child (mcp-stdio.mjs): deps.models.* behind list_models, get_providers,
//     test_provider, list_copilot_models and propose_model_change (validate only);
//   • the parent: turn.mjs re-validates a proposal with validateModelChange, and the cards route
//     applies a confirmed card with applyModelChange.
// Never a credential out: env values and keys are masked unless they are ${VAR} references.
import { listModels, PREDEFINED_MODELS, EFFORTS, globalModelRefs, removeGlobalModelAndRefs } from '../config.mjs';
import { listGlobalModels, addGlobalModel, updateGlobalModel, updateProvider, providerConfig } from '../settings.mjs';
import { listPluginModels } from '../plugin-models.mjs';
import { policyCatalogModels } from '../policy/cache.mjs';
import { providerReadiness } from '../bridge/registry.mjs';
import {
  providersState, patchProvider, copilotModelsForImport, importCopilotModels, testProviderConnection,
  endpointModelsForImport, importEndpointModels,
} from '../bridge/provider-ops.mjs';
import { UPSTREAM_PROVIDERS } from '../model-env.mjs';
import { createModelChangeValidator, mergeEditPatch, maskEntry } from './model-proposal.mjs';

const envHas = (name) => typeof process.env[name] === 'string' && process.env[name].trim() !== '';

/** The authoritative validator, over the real readers (the turn's default; the child's too). */
export const validateModelChange = createModelChangeValidator({
  listGlobalModels, listPluginModels, policyModels: policyCatalogModels, predefined: PREDEFINED_MODELS,
  addModel: addGlobalModel, updateModel: updateGlobalModel, updateProvider,
  providerConfig, providerReadiness, modelRefs: globalModelRefs, envHas,
  copilotModels: () => copilotModelsForImport(),
  endpointModels: (baseUrl) => endpointModelsForImport({ baseUrl }),
});

/**
 * Every catalog model as list_models shows it: the picker row (source, efforts, bridge facts,
 * readiness) joined with the entry's own masked config when it is a user (global) entry.
 */
export async function listModelsForAsk() {
  const rows = await listModels('');
  const globals = new Map(listGlobalModels().map((m) => [m.id.toLowerCase(), m]));
  const plugins = new Map(listPluginModels().map((m) => [m.id.toLowerCase(), m]));
  const source = { false: 'built-in', global: 'user', plugin: 'plugin', policy: 'team policy', project: 'project (legacy)' };
  const models = rows.map((row) => {
    const g = globals.get(row.id.toLowerCase());
    const p = !g ? plugins.get(row.id.toLowerCase()) : null;
    const entry = g ? maskEntry(g) : null;
    const up = (g && g.upstream) || (p && p.upstream) || null;
    return {
      id: row.id, label: row.label, source: source[String(row.custom)] || String(row.custom),
      ...(row.plugin ? { plugin: row.plugin } : {}), ...(row.policy ? { policyHome: row.policy } : {}),
      editable: !!g, efforts: row.efforts,
      connection: up ? 'provider' : row.routed ? 'env' : 'default',
      ...(row.bridged ? { provider: row.bridged, upstreamApi: row.upstreamApi, upstreamModel: row.upstreamModel } : {}),
      ...(row.bridged ? { ready: !row.needsSignIn, ...(row.needsSignIn && up ? { notReady: providerReadiness(up).message } : {}) } : {}),
      ...(row.capabilities ? { capabilities: row.capabilities } : {}),
      ...(row.hidden ? { hidden: true } : {}), ...(row.costUnreliable ? { costUnreliable: true } : {}),
      ...(entry ? { entry: { env: entry.env || {}, ...(entry.upstream ? { upstream: entry.upstream } : {}), ...(entry.cost ? { cost: entry.cost } : {}) } } : {}),
    };
  });
  return { models, efforts: [...EFFORTS], providers: [...UPSTREAM_PROVIDERS] };
}

/**
 * Apply a CONFIRMED model card (ui/server.mjs cards route, after the user's click). Every setter
 * re-validates; an edit re-merges its patch onto the entry as it is NOW. Returns a result the card
 * renders and the event turn quotes; throws on failure.
 */
export async function applyModelChange(card, io = {}) {
  const c = card.change || {};
  switch (card.kind) {
    case 'add_model': {
      const m = await (io.addModel ?? addGlobalModel)(c.model);
      return { ok: true, detail: `${m.id} is in the catalog` };
    }
    case 'edit_model': {
      const current = (io.listGlobalModels ?? listGlobalModels)().find((m) => m.id.toLowerCase() === String(c.id).toLowerCase());
      if (!current) throw new Error(`model "${c.id}" is no longer in the catalog`);
      await (io.updateModel ?? updateGlobalModel)(current.id, mergeEditPatch(current, c.patch || {}));
      return { ok: true, detail: `${current.id} updated` };
    }
    case 'remove_model': {
      const r = await (io.removeModel ?? removeGlobalModelAndRefs)(c.id);
      const n = (r?.clearedSteps || 0) + (r?.clearedNodes || 0);
      return { ok: true, detail: `${c.id} removed${n ? ` · ${n} workflow selection${n === 1 ? '' : 's'} cleared` : ''}` };
    }
    case 'provider': {
      await (io.patchProvider ?? patchProvider)(c.provider, c.set || {});
      return { ok: true, detail: `${c.provider} provider saved` };
    }
    case 'import_endpoint': {
      const r = await (io.importEndpoint ?? importEndpointModels)(c.ids || [], { baseUrl: c.baseUrl || '' });
      const bits = [];
      if (r.created?.length) bits.push(`added ${r.created.join(', ')}`);
      if (r.updated?.length) bits.push(`refreshed ${r.updated.join(', ')}`);
      // The endpoint's skips carry a reason (an embedding model, no tool calls); Copilot's are ids.
      if (r.skipped?.length) bits.push(`skipped ${r.skipped.map((s) => (typeof s === 'string' ? s : `${s.id} (${s.why})`)).join(', ')}`);
      return { ok: true, detail: `${bits.join(' · ') || 'nothing to import'} — from ${r.serverLabel || r.baseUrl || 'the endpoint'}` };
    }
    case 'import_copilot': {
      const r = await (io.importCopilot ?? importCopilotModels)(c.ids || []);
      const bits = [];
      if (r.created?.length) bits.push(`added ${r.created.join(', ')}`);
      if (r.updated?.length) bits.push(`refreshed ${r.updated.join(', ')}`);
      if (r.skipped?.length) bits.push(`skipped ${r.skipped.join(', ')}`);
      return { ok: true, detail: bits.join(' · ') || 'nothing to import' };
    }
    default:
      throw new Error(`unknown model change kind "${card.kind}"`);
  }
}

/**
 * @param {{threadId?:string|null}} [o]  threadId unused today; keeps the *-deps.mjs signature uniform
 */
export function defaultModelDeps({ threadId = null } = {}) {   // eslint-disable-line no-unused-vars
  return {
    models: {
      list: listModelsForAsk,
      providers: () => providersState(),
      test: (name) => testProviderConnection(name),
      copilotModels: () => copilotModelsForImport(),
      endpointModels: (baseUrl) => endpointModelsForImport({ baseUrl }),
      validateChange: validateModelChange,
    },
  };
}
