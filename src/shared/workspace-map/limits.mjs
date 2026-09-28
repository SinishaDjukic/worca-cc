// src/shared/workspace-map/limits.mjs
// Every size, time and count ceiling of the workspace interconnection map, in ONE frozen table
// (spec §9). Pure and import-free: the server (extract, catalog, join, graph merge) and the
// browser read the same numbers.

/** Version of every workspace-map JSON document (extract, survey, catalog, usage, map, synthesis,
 *  overrides). */
export const MAP_VERSION = 1;

export const LIMITS = Object.freeze({
  MAX_FILES_PER_MEMBER: 50000, MAX_FILE_BYTES: 1048576, MEMBER_BUDGET_MS: 60000,
  MAX_FACTS_PER_MEMBER: 5000, MATCH_MAX: 200, DETAIL_MAX: 200, LABEL_MAX: 60, ROLE_MAX: 160,
  OTHER_KEY_MAX: 120, EVIDENCE_WINDOW: 3, EVIDENCE_PER_SIDE: 3,
  MAX_CANDIDATES_PER_ENTRY: 20, MAX_CANDIDATES_PER_MEMBER: 400,
  BRIEF_MAX_BYTES: 40960, SYNTH_BRIEF_MAX_BYTES: 61440,
  INVESTIGATOR_CONCURRENCY: 8, EXTRACT_POOL: 4,
  GRAPH_FULL_MAX_NODES: 60000, GRAPH_FULL_MAX_BYTES: 67108864,
  GRAPH_HOOD_HOPS: 2, GRAPH_HOOD_MAX_NODES_PER_MEMBER: 2000, CALLERS_PER_END: 3,
});
