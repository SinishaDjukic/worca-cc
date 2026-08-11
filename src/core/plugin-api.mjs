// src/core/plugin-api.mjs
// Host plugin API version (plugin spec §10). An INTEGER, bumped on breaking
// change ONLY. Checked against manifests' engines.worca-cc-api at install AND at
// load (plugin-manifest.mjs apiSatisfies). Kept in its own dependency-free
// module so the shim child (Task 11) can import it without the core graph.
//
// 2 (node-graph engine, spec §5): agent sidecars must be meta v2 (ports, not
// channels) and `workflows/*.json` must be v2 graphs. Both are hard breaks for
// an API-1 plugin, so the integer moves rather than the host growing a compat
// path — an installed API-1 plugin drops out at the engines gate (its manifest
// stops normalizing) and the Plugins view says how to fix it.
export const WORCA_PLUGIN_API = 2;
