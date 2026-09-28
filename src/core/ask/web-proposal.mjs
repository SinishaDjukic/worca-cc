// src/core/ask/web-proposal.mjs
// The ONE validator behind mcp__worca__propose_web_access, the event/notice text of the web card,
// and the per-chat host list the cards record. The model asks to read a host that is not allowed
// yet; the user answers "for this chat", "always" or declines (docs/guardrails.md "Web access").
// Pure: the allowed list and the team cap are injected, so the MCP child validates for the model's
// self-correction and the parent turn re-validates authoritatively and mints the card — the
// clone-proposal.mjs split. Nothing here allows anything: the card route in ui/server.mjs does,
// behind the user's click.
import { checkWebUrl } from './web-fetch.mjs';
import { ANY_HOST, hostAllowed } from '../web-allowlist.mjs';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);

/**
 * @param {object} r
 * @param {() => string[]} r.allowed          this turn's effective allowlist (a card for an allowed host is pointless)
 * @param {() => string[]|null} [r.teamCap]   the team allowlist cap, or null
 */
export function createWebValidator({ allowed, teamCap = () => null }) {
  /** @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>} */
  return async function validateWebProposal(input) {
    const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    if (!str(inp.url)) return { ok: false, errors: ['url is required'] };
    let url;
    // Every URL rule except the allowlist (https, port, no credentials, no IP, no data in the URL):
    // the card shows the exact URL, and a URL web_fetch would refuse anyway is never proposed.
    try { url = checkWebUrl(str(inp.url), [ANY_HOST]); } catch (err) { return { ok: false, errors: [err.message] }; }
    const host = url.hostname;
    if (hostAllowed(host, allowed())) return { ok: false, errors: [`${host} is already allowed — call web_fetch instead`] };
    const cap = teamCap();
    if (Array.isArray(cap) && !hostAllowed(host, cap)) {
      return { ok: false, errors: [`${host} is outside the team policy's web allowlist for this project — tell the user; a card cannot allow it`] };
    }
    const reason = clip(str(inp.reason), 200);
    return { ok: true, card: {
      type: 'web', kind: 'web', summary: `Read ${host}`, host, url: url.href.slice(0, 500),
      ...(reason ? { reason } : {}),
      change: { host },
    } };
  };
}

/** The hosts this chat's web cards allowed "for this chat" (the cards are the record). */
export function chatWebHosts(messages) {
  const out = [];
  for (const m of messages || []) {
    for (const b of Array.isArray(m?.blocks) ? m.blocks : []) {
      if (b && b.kind === 'card' && b.state === 'applied' && b.card?.type === 'web' && b.card.result?.scope === 'chat'
        && typeof b.card.host === 'string' && !out.includes(b.card.host)) out.push(b.card.host);
    }
  }
  return out;
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user answered a web card. */
export function webEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  const host = eventText(card.host, 253);
  if (state === 'declined') return `[worca event] web card ${cardId} declined: do not fetch ${host} — answer without it; "${summary}"`;
  if (state === 'failed') return `[worca event] web card ${cardId} failed: ${eventText(result?.error || 'unknown error', 300)}; "${summary}"`;
  const scope = result?.scope === 'always' ? 'is on the allowlist from now on' : 'is allowed for this chat';
  return `[worca event] web card ${cardId} applied: ${host} ${scope} — fetch it now; "${summary}"`;
}

/** The user-row notice above the event turn. */
export function webNoticeText({ state, card = {}, result = null }) {
  const host = clip(card.host, 253);
  if (state === 'declined') return `Declined — ${clip(card.summary, 160)}`;
  if (state === 'failed') return `Could not allow ${host}: ${clip(result?.error || 'unknown error', 200)}`;
  return result?.scope === 'always' ? `Always allowing ${host}` : `Allowed ${host} for this chat`;
}
