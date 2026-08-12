// src/core/plugin-api.mjs
// Host plugin API versions (plugin spec §10). Integers, bumped on breaking
// change ONLY. WORCA_PLUGIN_API is the current/max API; WORCA_PLUGIN_APIS lists
// every API this host still satisfies, so old manifests (e.g. ">=1 <2") keep
// installing after a bump. Checked against manifests' engines.worca-cc-api at
// install AND at load (plugin-manifest.mjs apiSatisfies). Kept in its own
// dependency-free module so the shim child (Task 11) can import it without the
// core graph.
//
// API 2 adds the chatChannels contribution + persistent channel worker
// protocol; the task-source connector contract is unchanged between 1 and 2.
export const WORCA_PLUGIN_API = 2;
export const WORCA_PLUGIN_APIS = [1, 2];
