// src/core/trusted-proxies.mjs — the one rule for a trusted identity header (WORCA_IDENTITY_HEADER), shared by
// the UI server and the credential broker's key page. A header proves nothing by itself: anything that reaches
// the port (worca's agents, a compose neighbour, a loop through the published port) can send it. It is believed
// only from the identity proxy's own address, WORCA_IDENTITY_TRUSTED_PROXIES (IPs or CIDRs).
import { BlockList, isIP, isIPv4 } from 'node:net';

/** "10.0.0.5, 172.18.0.0/16" → { list, bad }: IP addresses or CIDRs, split on commas or spaces. */
export function parseAddressList(v) {
  const list = []; const bad = [];
  for (const item of String(v || '').split(/[\s,]+/).filter(Boolean)) {
    const [addr, bits, extra] = item.split('/');
    const family = isIP(addr);
    const max = family === 4 ? 32 : 128;
    const ok = family && extra === undefined && (bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= max));
    (ok ? list : bad).push(item);
  }
  return { list, bad };
}

/** The TCP peer of `req`, a v4-mapped address unmapped; '' when unknown. */
export function peerAddress(req) {
  const peer = String(req?.socket?.remoteAddress || '');
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(peer) ? peer.slice(7) : peer;
}

/** `(req) => boolean`: the request's TCP peer is one of `list` (parseAddressList's). An empty list trusts nobody. */
export function createTrustedPeerCheck(list) {
  const trusted = new BlockList();
  for (const entry of list || []) {
    const [addr, bits] = entry.split('/');
    const type = isIPv4(addr) ? 'ipv4' : 'ipv6';
    if (bits === undefined) trusted.addAddress(addr, type); else trusted.addSubnet(addr, Number(bits), type);
  }
  return (req) => {
    const peer = peerAddress(req);
    return !!peer && trusted.check(peer, isIPv4(peer) ? 'ipv4' : 'ipv6');
  };
}

/** The UI server's identity-header config from `env`: { header (lower case) | null, trusted(req), errors }.
 *  A header with no trusted proxy (or a bad entry) is an error: the server refuses to boot. */
export function identityHeaderTrust(env = process.env) {
  const header = String(env.WORCA_IDENTITY_HEADER || '').trim().toLowerCase();
  if (!header) return { header: null, trusted: () => false, errors: [] };
  const { list, bad } = parseAddressList(env.WORCA_IDENTITY_TRUSTED_PROXIES);
  const errors = [];
  if (bad.length) errors.push(`WORCA_IDENTITY_TRUSTED_PROXIES has entries that are not an IP address or CIDR: ${bad.join(', ')}`);
  else if (!list.length) errors.push('WORCA_IDENTITY_HEADER needs WORCA_IDENTITY_TRUSTED_PROXIES: the address (or CIDR) the identity proxy connects from; the header from any other peer is ignored');
  return { header, trusted: createTrustedPeerCheck(list), errors };
}
