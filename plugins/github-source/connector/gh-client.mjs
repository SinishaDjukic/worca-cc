// plugins/github-source/connector/gh-client.mjs
// The one place both task sources build their GitHub client: lazy, memoized
// token (explicit config token wins, else `gh auth token`) + cached login.
import { ghFetch } from './github-api.mjs';
import { ghAuthToken } from './gh-cli.mjs';

/** configSchema `select` fields deliver strings; coerce yes/true -> boolean. */
export function toBool(v) {
  return v === true || v === 'yes' || v === 'true';
}

/**
 * @param {object} ctx plugin ctx ({config, state, log})
 * @param {{fetch?: Function, ghAuthToken?: () => string}} [deps] test seams (the shim child passes none)
 * @returns {{ gh: {fetch: Function, token: string}, login: () => Promise<string>, validateConfig: () => Promise<object> }}
 */
export function createGhClient(ctx, deps = {}) {
  const resolveToken = deps.ghAuthToken || ghAuthToken;
  // An explicit config token wins. With none, fall back to the gh CLI's
  // logged-in account — the same identity worca uses for `gh pr create`.
  // Lazy AND memoized: building the source must not spawn anything, and one op
  // must not spawn gh once per request.
  let token = String(ctx.config?.token || '') || null;
  const gh = {
    fetch: deps.fetch || globalThis.fetch,
    get token() { return token ?? (token = resolveToken()); },
  };

  /** @me resolution: login cached in state by validateConfig; lazily fetched otherwise. */
  async function login() {
    const cached = await ctx.state.get('login');
    if (cached) return cached;
    const { json } = await ghFetch(gh, '/user');
    await ctx.state.set('login', json.login);
    return json.login;
  }

  async function validateConfig() {
    try {
      const { json } = await ghFetch(gh, '/user');
      await ctx.state.set('login', json.login);
      return { ok: true, identity: json.login };
    } catch (e) {
      if (e.kind === 'auth') return { ok: false, errors: [{ field: 'token', message: e.message }] };
      throw e; // network / rate-limit stay op errors -> protocol frame kinds
    }
  }

  return { gh, login, validateConfig };
}
