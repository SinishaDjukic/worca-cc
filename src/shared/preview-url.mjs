// src/shared/preview-url.mjs — what a Browser tab's address means (issue 1064): a loopback address previews through
// Worca's proxy, any other http(s) address is another site, the rest is refused. Shared by the tab
// (ui/public/tool-browser.mjs) and the chat's tab tools (src/core/tab-tools.mjs), so the assistant follows the user's
// own address rules.

export function isLoopbackName(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || h === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** The address bar's text as { kind: 'local', port, path, url } (through the proxy), { kind: 'external', url }, or
 *  { error }. A bare `localhost:5173` or `:5173` is http; any other bare name is https. */
export function classifyUrl(text) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'Type an address.' };
  let s = /^:\d{1,5}(?:[/?#]|$)/.test(raw) ? `localhost${raw}` : raw;
  // No scheme: http for a loopback name, else https. `javascript:x`, `data:…` or `mailto:…` then fail to parse or
  // carry a user name, and `file://` fails the protocol check below.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `${isLoopbackName(s.split(/[/?#]/)[0].replace(/:\d+$/, '')) ? 'http' : 'https'}://${s}`;
  let u;
  try { u = new URL(s); } catch { return { error: `"${raw.slice(0, 80)}" is not an address.` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http and https addresses open here.' };
  if (u.username || u.password) return { error: 'An address with a user name or password does not open here.' };
  if (!isLoopbackName(u.hostname)) return { kind: 'external', url: u.href };
  if (u.protocol === 'https:') return { error: 'Worca previews local servers over http: use http://.' };
  const port = Number(u.port || 80);
  const path = `${u.pathname}${u.search}${u.hash}`;
  return { kind: 'local', port, path, url: `http://localhost:${port}${path}` };
}
