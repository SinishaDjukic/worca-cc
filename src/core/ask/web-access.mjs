// src/core/ask/web-access.mjs
// One Ask turn's web access (docs/guardrails.md "Web access"): local askWeb settings merged with the pinned
// project's team policy. Resolved in the PARENT once per turn; the MCP child only sees the result.
import { askWeb } from '../settings.mjs';
import { cachedPolicyForKey } from '../policy/cache.mjs';
import { fieldsForRun, effectiveWebEnabled, capWebDomains } from '../policy/effective.mjs';
import { ANY_HOST } from '../web-allowlist.mjs';

export const WEB_OFF = Object.freeze({ enabled: false, allowedDomains: Object.freeze([]), search: null });

/**
 * `chatHosts`: the hosts the user allowed for THIS chat through a web card ("Allow for this chat").
 * On with an empty list is a real state: every host then goes through an approval card.
 * `teamCap` (the team allowlist, or null) travels along so the parent can refuse a card outside it.
 */
export function askWebAccess({ projectKey = null, chatHosts = [], readLocal = askWeb, policyFor = cachedPolicyForKey } = {}) {
  const local = readLocal(projectKey ? { projectKey } : undefined);
  let team = {};
  if (projectKey) { const p = policyFor(projectKey); if (p) team = fieldsForRun(p.doc) || {}; }
  // A policy only narrows (registry: the web fields): it can switch web off or cap the hosts, never turn it on or add one.
  const enabled = effectiveWebEnabled({ local: { value: local.enabled }, team: team['ask.webEnabled'] || null });
  if (!enabled) return { enabled: false, allowedDomains: [], search: null };
  const teamCap = Array.isArray(team['ask.webAllowedDomains']?.value) ? team['ask.webAllowedDomains'].value : null;
  const mine = local.anyHost ? [ANY_HOST] : [...local.allowedDomains, ...(Array.isArray(chatHosts) ? chatHosts : [])];
  return { enabled: true, allowedDomains: capWebDomains(mine, teamCap), search: local.search || null, teamCap };
}
