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
// protocol; API 3 changes the DATA contract: agent sidecars are meta v2 (typed
// ports) and workflows/*.json are v2 graphs. The task-source connector and the
// channel-worker protocols are unchanged across 1 -> 2 -> 3, so a connector-only
// ">=1 <2" plugin and a chat plugin's ">=2 <3" keep negotiating 1 and 2 and keep
// working untouched. The set is what makes that possible: never collapse it to a
// single integer.
export const WORCA_PLUGIN_API = 3;
export const WORCA_PLUGIN_APIS = [1, 2, 3];
