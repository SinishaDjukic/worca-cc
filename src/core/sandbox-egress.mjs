// src/core/sandbox-egress.mjs
// The E2B sandbox network for a project whose exec-env `egress` is `allow` (core-3). Its own module, importing only the
// list parsers of egress-proxy.mjs: the e2b backend imports it at load, and egress-policy.mjs (the host's proxy) reads
// settings, whose module loads the exec-env registry and so the backend — an import cycle.
import { parseAllow, parseHostList, hostMatches } from './egress-proxy.mjs';

// ── Sandbox egress (plans/core-protection-layer-design.md §4.6, plans/2026-10-22-e2b-kill-egress-checks.md §2-3) ──
// An E2B project whose `egress` is `allow` starts its sandboxes with `network: { allowOut, denyOut }` built from the
// same list as docker/compose.egress.yml: WORCA_EGRESS_ALLOW (empty: DEFAULT_ALLOW), ".x" meaning x and its
// subdomains, minus WORCA_EGRESS_DENY. E2B matches names on TLS SNI / the HTTP Host header, so an allowed name can be
// spoofed to reach any address, and any name rule opens DNS; this stops casual egress, not a determined agent.

/** E2B's ALL_TRAFFIC: host names in allowOut take effect only with it in denyOut. */
const ALL_TRAFFIC = '0.0.0.0/0';
const isAddress = (entry) => /^[0-9.]+(?:\/\d{1,2})?$/.test(entry) || entry.includes(':');

/** worca list → E2B allowOut: ".x" becomes "x" and "*.x" (E2B's "*.x" leaves out the apex); names, IPs and CIDRs
 *  pass through; each entry once, in order. */
export function toE2bAllow(list) {
  const out = [];
  for (const e of list || []) {
    for (const v of e.startsWith('.') ? [e.slice(1), `*${e}`] : [e]) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** E2B's `network` for an allowOut list: deny-all, with allowOut only when the list has entries. */
export function toE2bNetwork(allowOut, extraDeny = []) {
  return { ...(allowOut.length ? { allowOut } : {}), denyOut: [ALL_TRAFFIC, ...extraDeny.filter((d) => d !== ALL_TRAFFIC)] };
}

/**
 * The sandbox `network` for a project's exec-env config (`config.egress`), or null when it is open (the default).
 * E2B's denyOut takes no host names, so a denied name instead leaves allowOut; a denied name that only a wildcard
 * covers cannot be carved out of it and is listed in `unheldDeny` for the run log. IP and CIDR denies go in denyOut.
 * @returns {{allowOut?: string[], denyOut: string[], unheldDeny?: string[]} | null}
 */
export function sandboxEgress(config, env = process.env) {
  if (config?.egress !== 'allow') return null;
  const deny = parseHostList(env.WORCA_EGRESS_DENY).filter((d) => d !== '.invalid');
  const denyNames = deny.filter((d) => !isAddress(d));
  // A deny entry as the platform reads it: "x" that name only, ".x" its subdomains only.
  const denied = (host) => denyNames.some((d) => hostMatches(host, d, { subdomainsOnly: true }));
  const unheld = [];
  const allowOut = toE2bAllow(parseAllow(env.WORCA_EGRESS_ALLOW)).filter((a) => {
    if (!a.startsWith('*.')) return !denied(a) && !deny.includes(a);
    const parent = a.slice(1);                               // "*.x" -> ".x"
    if (denyNames.some((d) => d === parent || (d.startsWith('.') && parent.endsWith(d)))) return false;
    for (const d of denyNames) if (hostMatches(d.replace(/^\./, ''), parent, { subdomainsOnly: true }) && !unheld.includes(d)) unheld.push(d);
    return true;
  });
  return { ...toE2bNetwork(allowOut, deny.filter(isAddress)), ...(unheld.length ? { unheldDeny: unheld } : {}) };
}

/** The run-log help for an `allow` sandbox (also the project setting's help text). */
export const SANDBOX_EGRESS_HELP = 'Stops casual network access from the sandbox, not a determined agent: an allowed host name can be spoofed to reach any address, any host name opens DNS, and ssh git remotes fail (use HTTPS).';
