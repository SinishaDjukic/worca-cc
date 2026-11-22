// src/shared/frame-refusers.mjs — sites known to refuse being shown inside another page (X-Frame-Options or CSP
// frame-ancestors), so a chat link to them opens in a browser tab of its own at once, inside the click (issue 1064 §3).
// Any other site opens in the panel and the server checks it once per origin (src/core/frame-check.mjs). Pure.

export const FRAME_REFUSERS = Object.freeze([
  'github.com', 'gitlab.com', 'bitbucket.org', 'google.com', 'youtube.com', 'gmail.com', 'facebook.com', 'instagram.com',
  'x.com', 'twitter.com', 'linkedin.com', 'microsoftonline.com', 'live.com', 'outlook.com', 'office.com',
  'microsoft365.com', 'sharepoint.com', 'dev.azure.com', 'visualstudio.com', 'atlassian.net', 'atlassian.com',
  'slack.com', 'discord.com', 'notion.so', 'figma.com', 'stackoverflow.com', 'stackexchange.com', 'reddit.com',
  'amazon.com', 'npmjs.com', 'apple.com', 'icloud.com', 'paypal.com', 'stripe.com', 'openai.com', 'chatgpt.com',
  'claude.ai', 'anthropic.com', 'okta.com', 'auth0.com',
]);
/** Sign-in hosts refuse frames almost everywhere (accounts.google.com, login.microsoftonline.com, sso.<company>). */
const AUTH_LABEL_RE = /^(?:accounts|login|signin|sign-in|auth|sso|oauth|identity)\./;

export function isKnownFrameRefuser(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (AUTH_LABEL_RE.test(h)) return true;
  return FRAME_REFUSERS.some((d) => h === d || h.endsWith(`.${d}`));
}
