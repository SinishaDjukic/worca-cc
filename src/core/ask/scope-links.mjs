// src/core/ask/scope-links.mjs — a No-project chat's scope from the issue / pull request links in a message: the pure
// rules (the send route in ui/routes/chat/thread-turns.mjs does the I/O). It sits beside scope.mjs because that file
// may import nothing; this one imports only forge.mjs's parsers. docs/chat-home.md "Scope from a pasted link".

import { linkTargetOf, parseRemoteUrl, sameRepo } from '../forge.mjs';

/** At most this many unique links are read per message; the rest are ignored. */
export const SCOPE_LINKS_MAX = 20;
/** A scope card offers at most this many projects (validateScopeSwitch's limit): a longer list is no hint at all. */
const HINT_MAX = 3;
const LINK_RE = /https:\/\/[^\s<>()[\]{}"'`]+/g;
const TRAILING = '.,;:!?';
const isObj = (v) => !!v && typeof v === 'object';
const nonEmpty = (v) => typeof v === 'string' && v !== '';

/** Trailing sentence punctuation is not part of a link. A loop, not a `[…]+$` regex: that one is quadratic. */
function trimLink(url) {
  let end = url.length;
  while (end > 0 && TRAILING.includes(url[end - 1])) end -= 1;
  return url.slice(0, end);
}

/** The supported links of a message, in order of first appearance, each once: [{ url, target }] (linkTargetOf). */
export function messageLinkTargets(text) {
  if (typeof text !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(LINK_RE)) {
    const url = trimLink(m[0]);
    if (seen.has(url)) continue;
    seen.add(url);
    const target = linkTargetOf(url);
    if (target) out.push({ url, target });
    if (seen.size >= SCOPE_LINKS_MAX) break;
  }
  return out;
}

/** Every project worca once switched this chat to on its own (a notice block's `autoScope` marker), each key once. */
export function autoScopeKeys(messages) {
  const keys = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    for (const b of isObj(m) && Array.isArray(m.blocks) ? m.blocks : []) {
      if (!isObj(b) || b.kind !== 'notice' || !isObj(b.autoScope)) continue;
      const k = b.autoScope.projectKey;
      if (nonEmpty(k) && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

const lower = (v) => String(v || '').toLowerCase();

/** The projects one link points at: a repo by sameRepo; an Azure work item only when ONE project is in its org/project. */
function linkMatches(target, remotes) {
  if (target.kind === 'repo') return remotes.filter(([, r]) => sameRepo(r, target)).map(([p]) => p);
  if (target.kind === 'azure-project') {
    const m = remotes.filter(([, r]) => r.host === 'dev.azure.com' && lower(r.org) === lower(target.org)
      && lower(r.project) === lower(target.project)).map(([p]) => p);
    return m.length === 1 ? m : [];
  }
  return [];
}

/**
 * The decision for one message. links = messageLinkTargets(text); projects = [{ key, name, exists, originUrl }];
 * excluded = keys this chat must not be switched to (scope cards, earlier auto-switches).
 * → { action:'none' } | { action:'switch', projectKey, name } | { action:'ask', candidates:[{ projectKey, name }] }
 * Links that match no project are ignored. Two or more matched projects never switch, even when the exclusions leave
 * one: ambiguity is decided before the exclusions. Pure; never throws.
 */
export function matchScopeFromLinks({ links = [], projects = [], excluded = [] } = {}) {
  try {
    const remotes = [];
    for (const p of Array.isArray(projects) ? projects : []) {
      if (!isObj(p) || !nonEmpty(p.key) || p.exists === false) continue;
      const r = parseRemoteUrl(p.originUrl);
      if (r) remotes.push([p, r]);
    }
    const union = [];
    for (const l of Array.isArray(links) ? links : []) {
      if (!isObj(l) || !isObj(l.target)) continue;
      for (const p of linkMatches(l.target, remotes)) if (!union.includes(p)) union.push(p);
    }
    const skip = new Set(Array.isArray(excluded) ? excluded : []);
    if (union.length === 0) return { action: 'none' };
    if (union.length === 1) {
      const [p] = union;
      return skip.has(p.key) ? { action: 'none' } : { action: 'switch', projectKey: p.key, name: p.name || p.key };
    }
    const rest = union.filter((p) => !skip.has(p.key));
    if (rest.length < 1 || rest.length > HINT_MAX) return { action: 'none' };
    return { action: 'ask', candidates: rest.map((p) => ({ projectKey: p.key, name: p.name || p.key })) };
  } catch {
    return { action: 'none' };
  }
}
