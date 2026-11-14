// experiments/messaging-bus/lib/publish-layers.mjs — the workflow switch for the three publish layers (plan §3.5).
// Product design (not built now): a node config key `busPublish` next to `fanOut`. The workflow-level
// value applies first, then the node override. All layers are inert while `bus.mailbox` (P2) is off.
import { BusError } from './envelope.mjs';

/** When a workflow says nothing: layers 1 and 2 on, layer 3 (prompt rules) opt-in. */
export const DEFAULT_LAYERS = Object.freeze({ lifecycle: true, auto: true, prompt: false });
const KEYS = Object.keys(DEFAULT_LAYERS);

function check(cfg, where) {
  if (cfg === undefined || cfg === null) return {};
  if (typeof cfg !== 'object' || Array.isArray(cfg)) throw new BusError('BUS_BAD_CONFIG', `${where} busPublish must be an object`);
  for (const [k, v] of Object.entries(cfg)) {
    if (!KEYS.includes(k)) throw new BusError('BUS_BAD_CONFIG', `${where} busPublish has an unknown key ${JSON.stringify(k)}`);
    if (typeof v !== 'boolean') throw new BusError('BUS_BAD_CONFIG', `${where} busPublish.${k} must be true or false`);
  }
  return cfg;
}

/** `{ lifecycle, auto, prompt }` for one node: defaults, then the workflow's value, then the node's. */
export function resolvePublishLayers(workflowCfg, nodeCfg) {
  return { ...DEFAULT_LAYERS, ...check(workflowCfg, 'workflow'), ...check(nodeCfg, 'node') };
}
