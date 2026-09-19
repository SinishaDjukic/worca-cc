// src/core/policy/local.mjs
// The developer's side of the fold (team-policy design §6): a snapshot of the local settings
// a policy can govern, the installed-plugin map the deviations need, and the plugin / marketplace
// requirements the Plugins page and the setup checklist show. Core-only (reads settings.json,
// project_config, plugins.lock.json, marketplaces.json); nothing here touches git.

import { createRequire } from 'node:module';
import {
  readSettings, pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod, askMaxTurns, askMaxBudgetUsd, hideBuiltinModels,
} from '../settings.mjs';
import { readConfigRow, readTeamMetricsPrefs } from '../config.mjs';
import { projectKey } from '../store.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { readMarketplaces, writeMarketplaces, normalizeMarketplaceUrl, marketplaceId, addMarketplace } from '../marketplaces.mjs';
import { fieldsForRun } from './effective.mjs';
import { semverAtLeast } from './registry.mjs';

export const WORCA_VERSION = createRequire(import.meta.url)('../../../package.json').version;

const parseJson = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };

/**
 * { [policyKey]: { value, set } } — `set` is whether the DEVELOPER stored a value (the
 * default-kind rule keys off it), `value` is what Worca applies today (defaults included).
 * @param {string|null} projectDir  project-level keys are null without one
 */
export function localSnapshot(projectDir = null) {
  const raw = readSettings();
  const has = (k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== '';
  const out = {
    'cost.pipelineLimitUsd': { value: pipelineCostLimitUsd(), set: pipelineCostLimitUsd() != null },
    'cost.totalLimitUsd': { value: totalCostLimitUsd(), set: totalCostLimitUsd() != null },
    'cost.resetPeriod': { value: costLimitResetPeriod(), set: has('costLimitResetPeriod') },
    'ask.maxTurns': { value: askMaxTurns(), set: has('askMaxTurns') },
    'ask.maxBudgetUsd': { value: askMaxBudgetUsd(), set: raw.askMaxBudgetUsd !== undefined },   // literal null = "no cap", a choice
    'models.hideBuiltins': { value: hideBuiltinModels(), set: has('hideBuiltinModels') || raw.hideBuiltinModelsChosen === true },
    'plugins.marketplaces': { value: Object.values(readMarketplaces().marketplaces).map((m) => m.url), set: true },
    'plugins.required': { value: Object.entries(readPluginsLock()).map(([name, e]) => ({ name, version: e?.version ?? null, enabled: e?.enabled !== false })), set: true },
  };
  if (projectDir) {
    const key = projectKey(projectDir);
    const row = readConfigRow(key);
    const active = row && typeof row.active_workflow_id === 'string' ? row.active_workflow_id.trim() : '';
    out['workflows.default'] = { value: active || null, set: !!active };
    out['run.humanInLoop'] = { value: !(row && row.human_in_loop === 0), set: !!row && row.human_in_loop === 0 };
    const steps = row ? parseJson(row.steps, {}) : {};
    out['models.steps'] = { value: steps && typeof steps === 'object' ? steps : {}, set: !!steps && Object.keys(steps).length > 0 };
    const tm = readTeamMetricsPrefs(key);
    out['metrics.record'] = { value: tm ? tm.record !== false : null, set: !!tm && tm.record === false };
  }
  return out;
}

/** { name: { version, enabled } } from plugins.lock.json. */
export function installedPluginsMap() {
  const out = {};
  for (const [name, e] of Object.entries(readPluginsLock())) out[name] = { version: e?.version ?? null, enabled: e?.enabled !== false, via: e?.via ?? null };
  return out;
}

/**
 * The union of `plugins.required` across policy homes, each with its installed state
 * (Plugins page strip, setup checklist, `worca policy setup`). Two homes → the higher floor.
 * @param {Array<{slug:string, doc:object}>} homes
 */
export function pluginRequirements(homes) {
  const installed = installedPluginsMap();
  const byName = new Map();
  for (const h of homes || []) {
    const f = fieldsForRun(h.doc);
    for (const p of f['plugins.required']?.value || []) {
      const cur = byName.get(p.name) || { name: p.name, marketplace: p.marketplace ?? null, minVersion: null, config: null, homes: [] };
      if (p.minVersion && (!cur.minVersion || semverAtLeast(p.minVersion, cur.minVersion))) cur.minVersion = p.minVersion;
      if (p.config && !cur.config) cur.config = p.config;
      if (!cur.marketplace && p.marketplace) cur.marketplace = p.marketplace;
      if (!cur.homes.includes(h.slug)) cur.homes.push(h.slug);
      byName.set(p.name, cur);
    }
  }
  const out = [];
  for (const req of byName.values()) {
    const have = installed[req.name] || null;
    let state = 'ok';
    if (!have) state = 'missing';
    else if (have.enabled === false) state = 'disabled';
    else if (req.minVersion && have.version && !semverAtLeast(have.version, req.minVersion)) state = 'outdated';
    out.push({ ...req, installed: have, state });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Blocked plugins that are enabled here, per home. */
export function blockedPluginFindings(homes) {
  const installed = installedPluginsMap();
  const out = [];
  for (const h of homes || []) {
    for (const name of fieldsForRun(h.doc)['plugins.blocked']?.value || []) {
      const have = installed[name];
      if (have && have.enabled !== false) out.push({ name, home: h.slug });
    }
  }
  return out;
}

/**
 * Marketplace URLs a policy asks for that this machine has neither added nor deliberately
 * removed (marketplaces.json `policySeeded` remembers what policy added, design §6).
 */
export function marketplaceSeedCandidates(homes) {
  const state = readMarketplaces();
  const seeded = new Set(Array.isArray(state.policySeeded) ? state.policySeeded : []);
  const present = new Set(Object.values(state.marketplaces).map((m) => m.url));
  const out = new Map();
  for (const h of homes || []) {
    for (const raw of fieldsForRun(h.doc)['plugins.marketplaces']?.value || []) {
      const url = normalizeMarketplaceUrl(raw);
      if (!url || present.has(url) || seeded.has(url)) continue;
      const cur = out.get(url) || { url, homes: [] };
      if (!cur.homes.includes(h.slug)) cur.homes.push(h.slug);
      out.set(url, cur);
    }
  }
  return [...out.values()];
}

/**
 * Add the candidate marketplaces (metadata only: a git archive, no code runs) and remember
 * each in `policySeeded`, added or not, so a later local removal is never undone. Best-effort:
 * one unreachable marketplace never blocks the others. `add` is injectable for tests.
 */
export async function seedPolicyMarketplaces(homes, { add = addMarketplace } = {}) {
  const results = [];
  for (const c of marketplaceSeedCandidates(homes)) {
    let entry = null; let error = null;
    try { entry = await add(c.url); }
    catch (err) { if (err?.code === 'EXISTS') entry = readMarketplaces().marketplaces[marketplaceId(c.url)] || null; else error = String(err?.message || err); }
    const state = readMarketplaces();
    const seeded = new Set(Array.isArray(state.policySeeded) ? state.policySeeded : []);
    seeded.add(c.url);
    writeMarketplaces({ ...state, policySeeded: [...seeded] });
    results.push({ url: c.url, homes: c.homes, added: !!entry && !error, error });
  }
  return results;
}
