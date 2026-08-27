// src/core/graph/registry-ports.mjs
// Engine-side glue: a loaded agent registry -> the shared portsFn. Lives in
// src/core (not src/shared) because it exists only to bridge the Node-side
// registry shape; the resolution logic itself is shared.
import { portsFnFor } from '../../shared/graph/ports.mjs';
import { indexByKey } from '../../shared/graph/agent-meta.mjs';

/** @param {Record<string,object>|object[]} registry loadAgentRegistry() output (or a list) */
export function registryPortsFn(registry) {
  const list = Array.isArray(registry) ? registry : Object.values(registry || {});
  return portsFnFor(indexByKey(list));
}
