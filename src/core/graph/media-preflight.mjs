// src/core/graph/media-preflight.mjs
// The Promo video run preflight (promo-video spec §Preflight): a run whose graph carries a card that
// drives a browser or encodes video checks for Chrome and ffmpeg on THIS host at run start — beside the
// Python preflight (orchestrator.mjs _preflightScriptRuntimes), before the pipeline dir exists and long
// before the first execution — and refuses with one line per missing tool and its install hint.
//
// The lookups live in the shipped kit (assets/promo-kit/tools/find-tools.mjs: WORCA_CHROME / PATH /
// the macOS and Windows install paths; WORCA_FFMPEG / ffmpeg-static / PATH), so the run and the kit's
// own tools always agree on which binary is used. They are loaded lazily: a run without a promo card
// never imports the kit.

/** Which tools each card needs. Capture drives the app in Chrome; render screenshots every frame in
 *  Chrome and encodes them with ffmpeg. */
export const MEDIA_TOOL_NEEDS = Object.freeze({
  promoCapture: Object.freeze(['chrome']),
  promoRender: Object.freeze(['chrome', 'ffmpeg']),
});

const TOOL_LABEL = Object.freeze({ chrome: 'Chrome (or Chromium / Edge)', ffmpeg: 'ffmpeg' });

const FIND_TOOLS_URL = new URL('../../../assets/promo-kit/tools/find-tools.mjs', import.meta.url);

/** The kit's lookups: `{ findChrome, findFfmpeg, toolHints }`. */
export async function loadFindTools() {
  return import(FIND_TOOLS_URL.href);
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * The refusal lines for a resolved graph, `[]` when the run may start.
 * @param {Record<string, object>} nodeCtx  the resolved per-node contexts (orchestrator `resolved.nodeCtx`)
 * @param {{mocked?:boolean, tools?:{findChrome:Function, findFfmpeg:Function, toolHints:Function}|null,
 *          platform?:string}} [o]
 *   mocked: a mock run — an agent spawns the mock engine and a script with a DECLARED mock spawns
 *   nothing, so neither needs a tool (a mock script card WITHOUT a mock block still runs for real).
 *   tools: injected lookups (tests); the kit's otherwise.
 * @returns {Promise<string[]>}
 */
export async function mediaToolProblems(nodeCtx, { mocked = false, tools = null, platform = process.platform } = {}) {
  const needs = new Map();            // tool -> card names, first-seen order
  for (const nc of Object.values(isObject(nodeCtx) ? nodeCtx : {})) {
    if (!isObject(nc) || (nc.kind !== 'agent' && nc.kind !== 'script')) continue;
    const wanted = Object.hasOwn(MEDIA_TOOL_NEEDS, nc.key) ? MEDIA_TOOL_NEEDS[nc.key] : null;
    if (!wanted) continue;
    if (mocked && (nc.kind === 'agent' || isObject(nc.mock))) continue;
    const name = (isObject(nc.meta) && typeof nc.meta.displayName === 'string' && nc.meta.displayName) || nc.key;
    for (const tool of wanted) {
      if (!needs.has(tool)) needs.set(tool, []);
      if (!needs.get(tool).includes(name)) needs.get(tool).push(name);
    }
  }
  if (!needs.size) return [];
  const { findChrome, findFfmpeg, toolHints } = tools || await loadFindTools();
  const found = { chrome: () => findChrome(), ffmpeg: () => findFfmpeg() };
  const hints = toolHints(platform) || {};
  const lines = [];
  for (const tool of ['chrome', 'ffmpeg']) {
    if (!needs.has(tool) || found[tool]()) continue;
    const who = needs.get(tool).map((n) => `"${n}"`).join(', ');
    lines.push(`${who} need${needs.get(tool).length === 1 ? 's' : ''} ${TOOL_LABEL[tool]} — none found on this machine. ${hints[tool] || ''}`.trimEnd());
  }
  return lines;
}
