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
// ports) and workflows/*.json are v2 graphs. API 4 adds ONE thing: an agent
// sidecar's `ask` block (declared question forms) is honoured. It does NOT
// touch the sidecar or template contract, which is why WORCA_AGENT_DATA_API
// exists and is 3 — comparing the data contract against WORCA_PLUGIN_API would
// silently demote every current ">=3 <4" plugin's v1 sidecars from error to
// warning on this bump. The task-source connector and the channel-worker
// protocols are unchanged across 1 -> 2 -> 3 -> 4, so a connector-only
// ">=1 <2" plugin and a chat plugin's ">=2 <3" keep negotiating 1 and 2 and
// keep working untouched. The set is what makes that possible: never collapse
// it to a single integer.
export const WORCA_PLUGIN_API = 4;
export const WORCA_PLUGIN_APIS = [1, 2, 3, 4];

/** The API whose DATA contract agent sidecars and pipeline templates must meet:
 *  meta v2 (typed ports) + version-2 graphs. Introduced by API 3, UNCHANGED by
 *  4. `validatePluginDir`'s hard/soft split and the apiMismatch sentence are
 *  about THIS, never about the newest host API. */
export const WORCA_AGENT_DATA_API = 3;

/** The API a plugin must NEGOTIATE (highest member its range admits) for the
 *  `ask` blocks of the agents it ships to be honoured. Below it the block is
 *  stripped at load and reported as an ignored contribution; the agent keeps
 *  working with generic questions (ask-forms spec §10). */
export const WORCA_ASK_FORMS_API = 4;
