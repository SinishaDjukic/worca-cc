// src/core/graph/registry-ports.mjs
// Engine-side glue: the loaded agent registry AND the loaded script registry ->
// the shared portsFn. Lives in src/core (not src/shared) because it exists only
// to bridge the Node-side registry shapes; the resolution logic itself is shared.
import { portsFnFor } from '../../shared/graph/ports.mjs';
import { indexByKey } from '../../shared/graph/agent-meta.mjs';

/**
 * @param {Record<string,object>|object[]} registry loadAgentRegistry() output (or a list)
 * @param {Record<string,object>|object[]} [scripts] loadScriptRegistry() output (or a list); absent = no scripts resolve
 */
export function registryPortsFn(registry, scripts = {}) {
  const list = Array.isArray(registry) ? registry : Object.values(registry || {});
  const scriptList = Array.isArray(scripts) ? scripts : Object.values(scripts || {});
  return portsFnFor(indexByKey(list), indexByKey(scriptList));
}
