// src/core/ask/away-deps.mjs — the ONE module that touches Away mode (src/core/night/*, settings) on the
// Ask tools' behalf. tools.mjs may not import (it is import-free): the MCP child spreads defaultAwayDeps()
// into createAskTools (mcp-stdio.mjs); the parent (turn.mjs, ui/server.mjs) imports the switch and the
// card's validator/apply from here. All the plain-English text comes from src/shared/away-mode/describe.mjs.
import { effectiveNightConfig, nightLayers } from '../night/effective.mjs';
import { resolveNightConfig, NIGHT_TOGGLES } from '../night/config.mjs';
import { nightModeSettings, nightModeToggle, nightModeHereSince, setNightModeToggle, setNightMode, assertNightModeToggleInput } from '../settings.mjs';
import { writeNightModePrefs } from '../config.mjs';
import { listProjects } from '../projects.mjs';
import { projectKey as storeKey } from '../store.mjs';          // the key PATCH /api/config, effective.mjs and pipeline rows use
import { describeAwayMode, describeRun } from '../../shared/away-mode/describe.mjs';
import { pillText } from '../../shared/away-mode/labels.mjs';
import { createAwayChangeValidator } from './away-proposal.mjs';

const TERMINAL = new Set(['done', 'stopped', 'error']);
const safe = (fn, dflt) => () => { try { return fn() ?? dflt; } catch { return dflt; } };

const HELD = new Set(['paused', 'interrupted']);   // pipelines statuses where nothing is answered

function runLine({ config, toggle, hereSince, now, row, live }) {
  // Status first: liveRunEntry also returns PAUSED runs, and describeRun has no paused case,
  // so a paused marked run would otherwise read "answers after 30 min" by day.
  const status = String((live && live.status) || (row && row.status) || '');
  if (TERMINAL.has(status)) return { state: 'never', pill: pillText('never'), reason: 'The run is over.' };
  if (HELD.has(status)) return { state: 'wait', pill: pillText('wait'), reason: 'The run is paused; nothing is answered until it is resumed.' };
  if (live && live.night) {
    const r = describeRun({ config, toggle, hereSince, now, run: { ...live.night, waiting: live.waiting === true, done: false } });
    return { state: r.state, pill: r.pill, reason: r.reason, ...(r.minutes != null ? { answersAfterMin: r.minutes } : {}) };
  }
  return { state: 'unknown', pill: '', reason: 'worca cannot see this run from here; its run page shows whether worca answers its waiting question.' };
}

/** get_away_mode's core, readers injected (tests pass fakes). `keyOf(path)` = the store key of a project path:
 *  a row's `project_key` and the relay's `projectKey(dir)` are store keys, and a registry key can differ from
 *  them when a project's git root moved since it was registered. */
export function createAwayReader({ userLayer, toggle, hereSince = () => null, effective, projects, now = Date.now, keyOf = null }) {
  const findProject = (list, key) => list.find((p) => p.key === key)
    || (keyOf ? list.find((p) => { try { return keyOf(p.path) === key; } catch { return false; } }) : null) || null;
  return async function readAwayMode({ projectKey = null, row = null, live = null } = {}) {
    const rowKey = row && typeof row.project_key === 'string' && !row.project_key.startsWith('workspaces/') ? row.project_key : null;
    const key = (live && live.projectKey) || rowKey || projectKey || null;
    const project = key ? findProject(await projects(), key) : null;
    if (key && !project && !row && !live) throw new Error(`unknown project "${key}"`);
    const dir = (live && live.projectDir) || (project && project.path) || null;
    const { config, sources } = dir ? effective(dir) : resolveNightConfig({ user: userLayer() });
    const t = toggle(); const at = now(); const hs = hereSince();
    const projectFields = dir ? Object.keys(sources).filter((f) => sources[f] === 'project') : null;   // same "(this project)" marks as the project card
    const d = describeAwayMode({ config, toggle: t, hereSince: hs, now: at, projectName: project ? project.name : null, projectFields, surface: 'chat' });
    const out = { summary: d.lines, status: d.status, config, sources };
    if (row || live) out.run = runLine({ config, toggle: t, hereSince: hs, now: at, row, live });
    return out;
  };
}

/** A registry key, or the store key a row / get_away_mode reports (they differ after a git-root move). */
async function findProjectByKey(key) {
  const list = await listProjects();
  return list.find((p) => p.key === key)
    || list.find((p) => { try { return storeKey(p.path) === key; } catch { return false; } }) || null;
}
/** propose_away_mode_change's validator over the real readers (the child and the parent's re-check). */
export const validateAwayChange = createAwayChangeValidator({
  layers: nightLayers,
  projectOf: findProjectByKey,
  toggle: safe(nightModeToggle, 'auto'), now: () => Date.now(),
});

/** Behind the card's Apply (ui/server.mjs cards route): re-validate against the CURRENT layers, then write
 *  with the same writers and key as POST /api/settings / PATCH /api/config. */
export async function applyAwayChange(card) {
  const r = await validateAwayChange({ level: card.level, projectKey: card.projectKey, set: card.set, unset: card.unset });
  if (!r.ok) throw Object.assign(new Error(r.errors.join('; ')), { code: 'INVALID' });
  const patch = { ...r.card.set, __unset: r.card.unset };
  let dir = null;
  if (r.card.level === 'user') await setNightMode(patch);
  else {
    dir = ((await findProjectByKey(r.card.projectKey)) || {}).path || null;
    if (!dir) throw Object.assign(new Error(`unknown project "${r.card.projectKey}"`), { code: 'INVALID' });
    writeNightModePrefs(storeKey(dir), patch);
  }
  const { config } = dir ? effectiveNightConfig(dir) : resolveNightConfig({ user: nightModeSettings() });
  return { ok: true, detail: describeAwayMode({ config, toggle: nightModeToggle(), hereSince: nightModeHereSince(), now: Date.now(), projectName: r.card.projectName, surface: 'chat' }).lines[0] };
}

export function defaultAwayDeps() {
  return { away: {
    read: createAwayReader({ userLayer: safe(nightModeSettings, {}), toggle: safe(nightModeToggle, 'auto'), hereSince: safe(nightModeHereSince, null), effective: effectiveNightConfig, projects: listProjects, keyOf: storeKey }),
    validateChange: validateAwayChange,
  } };
}

/** The parent's half of set_away_now / set_run_away_mode. The re-checks are deliberate: the child's output is model-steered input. */
export function createAwaySwitch({ liveRun, runs, emitChanged, now = Date.now,
  setToggle = setNightModeToggle, readToggle = nightModeToggle, readHereSince = nightModeHereSince, userLayer = nightModeSettings, effective = effectiveNightConfig }) {
  return async function applyAwaySwitch(req, { actor = 'local' } = {}) {
    if (req && req.kind === 'global') {
      try { assertNightModeToggleInput(req.toggle); } catch { return { ok: false, error: `unknown status "${req.toggle}"` }; }   // auto | on | off | here
      await setToggle(req.toggle, { now: now() });
      emitChanged('settings-changed');
      for (const e of runs.values()) { try { e.orch?.nightConfigChanged?.(); } catch { /* one run must not stop the rest */ } }
      const { config } = resolveNightConfig({ user: userLayer() });
      return { ok: true, line: describeAwayMode({ config, toggle: readToggle(), hereSince: readHereSince(), now: now(), surface: 'chat' }).lines[0] };
    }
    if (req && req.kind === 'run') {
      if (!NIGHT_TOGGLES.includes(req.mode)) return { ok: false, error: `unknown mode "${req.mode}"` };
      const entry = liveRun(String(req.runId || ''));
      if (!entry || !entry.orch || typeof entry.orch.setNightOverride !== 'function') return { ok: false, error: TERMINAL.has(String(req.status)) ? `the run is ${req.status}` : 'the run is not running on this machine' };
      try { entry.orch.setNightOverride(req.mode, actor); }
      catch (err) { return { ok: false, error: err?.code === 'NIGHT_NOT_LIVE' ? `the run is ${entry.orch.state?.status}` : (err?.message || String(err)) }; }
      const { config } = effective(entry.projectDir);
      const d = describeRun({ config, toggle: readToggle(), hereSince: readHereSince(), now: now(), run: entry.orch.state?.night || {} });
      return { ok: true, line: `on run ${entry.title || entry.id}: ${d.state === 'now' ? 'answering now' : d.pill || 'you answer'}` };
    }
    return { ok: false, error: 'unknown request' };
  };
}
