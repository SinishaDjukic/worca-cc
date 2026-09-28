// Ask Worca web allowlist patterns: an exact host ("docs.example.com") or "*.example.com"
// (subdomains only — add "example.com" too for the apex). Leaf module: settings, team policy
// and the Ask MCP child all validate with the same rules.
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export const DOMAIN_LIST_MAX = 200;
/** The effective list of the "any public host" switch (settings askWeb.anyHost). Never a typed entry. */
export const ANY_HOST = '*';
/** Env var names a search-key `${VAR}` may never name (worca, Claude and runtime credentials). */
export const RESERVED_KEY_VAR = /^(WORCA_|ORCH_|ANTHROPIC_|CLAUDE_|NODE_|PATH$|HOME$)/i; // case-insensitive: Windows env lookup is
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
// A wildcard over one of these would allow hosts that strangers own — and a stranger's host sees
// every URL Ask requests from it. Not the whole Public Suffix List: the shared-hosting suffixes
// people actually paste, plus the ccTLD second levels (co.uk, com.au, …) matched by shape below.
const SHARED_SUFFIXES = new Set([
  'github.io', 'githubusercontent.com', 'gitlab.io', 'bitbucket.io', 'vercel.app', 'now.sh', 'netlify.app', 'netlify.com',
  'pages.dev', 'workers.dev', 'trycloudflare.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'railway.app', 'up.railway.app',
  'web.app', 'firebaseapp.com', 'appspot.com', 'run.app', 'cloudfunctions.net', 'azurewebsites.net', 'azurestaticapps.net',
  'blob.core.windows.net', 'cloudfront.net', 'amazonaws.com', 's3.amazonaws.com', 'ngrok.io', 'ngrok.app', 'ngrok-free.app',
  'loca.lt', 'glitch.me', 'repl.co', 'replit.app', 'replit.dev', 'surge.sh', 'blogspot.com', 'wordpress.com', 'tumblr.com',
  'deno.dev', 'val.run', 'codesandbox.io', 'csb.app', 'stackblitz.io', 'webcontainer.io', 'pythonanywhere.com', 'neocities.org',
]);
const CC_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'gv', 'mil', 'nic', 'ltd', 'plc', 'sch', 'nom', 'info', 'biz']);
const isSharedSuffix = (s) => {
  if (SHARED_SUFFIXES.has(s)) return true;
  const l = s.split('.');
  return l.length === 2 && l[1].length === 2 && CC_SECOND_LEVEL.has(l[0]);
};

function parsePattern(raw) {
  if (typeof raw !== 'string') return { error: 'bad' };
  let s = raw.trim().toLowerCase().replace(/\.$/, '');
  let wildcard = false;
  if (s.startsWith('*.')) { wildcard = true; s = s.slice(2); }
  if (!s || /[^a-z0-9.\-\u0080-￿]/.test(s)) return { error: 'bad' };
  s = domainToASCII(s);
  if (!s || s.length > 253 || isIP(s)) return { error: 'bad' };
  const labels = s.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { error: 'bad' };
  if (/^\d+$/.test(labels.at(-1))) return { error: 'bad' };
  if (wildcard && isSharedSuffix(s)) return { error: 'shared' };
  return { pattern: wildcard ? `*.${s}` : s };
}

export function normalizeDomainPattern(raw) { return parsePattern(raw).pattern || null; }

/** Why `raw` is not a usable allowlist entry, or null when it is. */
export function domainError(raw) {
  const r = parsePattern(raw);
  if (r.pattern) return null;
  return r.error === 'shared'
    ? `"${raw}" covers a domain where anyone can host a site — list the exact host instead (e.g. name.${String(raw).trim().replace(/^\*\./, '')})`
    : `"${raw}" is not a host name or *.host pattern`;
}

export function normalizeDomainList(list) {
  const domains = []; const invalid = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const d = normalizeDomainPattern(raw);
    if (!d) invalid.push(String(raw));
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}

export function mergeDomainLists(...lists) {
  return normalizeDomainList(lists.flatMap((l) => (Array.isArray(l) ? l : []))).domains;
}

/** The entries of `list` that `cap` fully covers; a null cap leaves the list as is. A wildcard
 *  survives only under an equal-or-broader wildcard — an exact cap entry never covers one. */
export function capDomainList(list, cap) {
  const any = Array.isArray(list) && list.includes(ANY_HOST);
  const mine = any ? [ANY_HOST] : normalizeDomainList(list).domains;
  if (!Array.isArray(cap)) return mine;
  const c = normalizeDomainList(cap).domains;
  if (any) return c;                                // "any host" under a cap = exactly the cap
  return mine.filter((p) => {
    if (!p.startsWith('*.')) return hostAllowed(p, c);
    const base = p.slice(2);
    return c.some((q) => q.startsWith('*.') && (base === q.slice(2) || base.endsWith(`.${q.slice(2)}`)));
  });
}

export function hostAllowed(host, patterns) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  for (const p of patterns || []) {
    if (p === ANY_HOST) return true;
    if (p.startsWith('*.')) { if (h.endsWith(`.${p.slice(2)}`)) return true; }
    else if (h === p) return true;
  }
  return false;
}
