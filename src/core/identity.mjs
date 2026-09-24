// Who started this: attribution, not authorisation (everyone signed in keeps the
// same rights). The first source that applies wins, and nothing is ever guessed:
//
//   1. the identity the server VERIFIED for this request (a Cloudflare Access
//      token, remote-access.mjs -> req.worcaUser)
//   2. WORCA_IDENTITY_HEADER: a header an identity proxy in front sets (oauth2-proxy,
//      Tailscale, an IAP). Read only when named: a header means nothing unless the
//      proxy verifies it and strips any incoming copy, so unset = ignored even if sent
//   3. WORCA_IDENTITY_NAME: a name the operator declares (a self-hoster with no proxy)
//   4. 'local': the CLI, in-container callers, a local install
//
// Pure: reads only the request and `env`.

const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
// A display name or email: printable, one line, bounded. It lands in PR bodies and the UI.
const VALUE_RE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029<>]{1,200}$/;

const clean = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return VALUE_RE.test(s) ? s : null;
};

/** { name, source: 'access'|'header'|'operator'|'local' } for this request. */
export function resolveIdentity(req, env = process.env) {
  const verified = clean(req?.worcaUser?.email);
  if (verified) return { name: verified, source: 'access' };
  const header = String(env.WORCA_IDENTITY_HEADER || '').trim();
  if (HEADER_NAME_RE.test(header)) {
    const v = req?.headers?.[header.toLowerCase()];
    const name = clean(Array.isArray(v) ? v[0] : v);
    if (name) return { name, source: 'header' };
  }
  const operator = clean(env.WORCA_IDENTITY_NAME);
  if (operator) return { name: operator, source: 'operator' };
  return { name: 'local', source: 'local' };
}

/** The startedBy a run records: the resolved name ('local' when nothing else applies). */
export function startedByOf(req, env = process.env) {
  return resolveIdentity(req, env).name;
}

/** The PR body footer naming who started the run, or '' when nobody in particular did. */
export function prAttributionFooter(startedBy) {
  const who = clean(startedBy);
  return who && who !== 'local' ? `\n\n---\nStarted by ${who} via worca` : '';
}

/** Who did this: the actor string an action records ('local' when nothing applies). */
export function actorOf(req, env = process.env) {
  return resolveIdentity(req, env).name;
}

/** True for a real per-person sign-in (a verified token or a named trusted header): the
 *  deployments where "who" can have more than one answer, so ownership and per-person
 *  state apply. 'operator' and 'local' are one person by definition. */
export function isSharedIdentity(source) {
  return source === 'access' || source === 'header';
}

const PLATFORM_NAMES = { slack: 'Slack', telegram: 'Telegram', discord: 'Discord', teams: 'Teams', msteams: 'Teams' };

/** The actor for a chat command: "ada via Slack" (sanitised like every other value), or
 *  "someone via Slack" when the platform gave no usable name. */
export function chatActor({ platform, userName, userId } = {}) {
  const p = String(platform || '').trim().toLowerCase();
  const via = PLATFORM_NAMES[p] || clean(platform) || 'chat';
  const who = clean(userName) || clean(userId != null ? String(userId) : '') || 'someone';
  return clean(`${who} via ${via}`) || `someone via ${via}`;
}
