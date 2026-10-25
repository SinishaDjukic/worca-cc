// src/cli/proxy.mjs — `worca proxy status|login|logout|test` (docs/network-proxy.md). Works with the
// proxy on or off, so a login can be saved before turning it on. The password comes from a hidden
// prompt or stdin, never argv, and is hashed at once (src/core/proxy-credentials.mjs).
import { createInterface } from 'node:readline';
import { readSettings, networkProxyEnabled } from '../core/settings.mjs';
import { checkUpstream, resolveUpstream, fixedPortOf, localProxyUrl, PASSWORD_MODES } from '../core/upstream-proxy.mjs';
import { parseAccount, saveProxyLogin, readProxyLogin, clearProxyLogin, markLoginRejected, proxyState,
  upstreamEnv, ProxyLoginError } from '../core/proxy-credentials.mjs';

export const PROXY_HELP = `Usage: worca proxy <command>

  status [--json]          The corporate proxy, the saved login and its state (exit 3: needs login)
  login [--user DOMAIN\\user]
                           Save the login: domain, user and NT hash, never the password. The
                           password is read from a hidden prompt, or from stdin when it is piped
                           (line 1 DOMAIN\\user unless --user is given, then the password).
  logout                   Delete the saved login
  test [--json]            CONNECT to github.com and api.anthropic.com through the corporate proxy

Turn it on in Settings › Network proxy (or networkProxy.enabled: true in settings.json). See docs/network-proxy.md.
`;
const VERBS = new Set(['status', 'login', 'logout', 'test']);
const MAX_INPUT = 64 * 1024;

/** Read a line with echo off (raw mode). Ctrl-C rejects with code ABORT_ERR. */
export function readHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    output.write(question);
    let buf = '';
    const wasRaw = !!input.isRaw;
    const finish = (err) => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (err) reject(err); else resolve(buf);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') { finish(); return; }
        if (ch === '\u0003') { finish(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' })); return; }
        if (ch === '\u007f' || ch === '\b') { buf = Array.from(buf).slice(0, -1).join(''); continue; }
        buf += ch;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
}

export async function readAllInput(input = process.stdin) {
  let raw = '';
  for await (const chunk of input) { raw += chunk; if (raw.length > MAX_INPUT) throw new ProxyLoginError('password', 'stdin is too long for a login'); }
  return raw;
}

function readLine(question, { input, output }) {
  const rl = createInterface({ input, output });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

/** Prints the shared sentence (stateLine, D12); only the "Corporate proxy:" and "Login:" lines are CLI-only. */
function printStatus(st, out) {
  if (st.state === 'not-configured' || st.state === 'error') out('Corporate proxy: none in use');
  else out(`Corporate proxy: ${st.upstream} (${st.authLabel}, from ${st.source === 'settings' ? 'settings' : 'HTTPS_PROXY'})`);
  out(st.login ? `Login: ${st.login.label}, saved ${st.login.savedAt ? `${st.login.savedAt.slice(0, 16).replace('T', ' ')} UTC` : 'at an unknown time'}`
    : `Login: none saved${st.loginError ? ` (${st.loginError})` : ''}`);
  out(`Local proxy: ${st.localUrl || 'a free port picked when Worca starts (set networkProxy.fixedPort to pin one)'}`);
  out(`State: ${st.line}`);
  for (const w of st.warnings) out(`Warning: ${w}`);
}

export async function cmdProxy(argv, {
  out, c = (_n, s) => s, fail,
  err = (s) => process.stderr.write(`${s}\n`),
  env = process.env, input = process.stdin, prompt = process.stderr,
  settings = readSettings, home, platform = process.platform, exec,
} = {}) {
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') { out(PROXY_HELP.trimEnd()); return 0; }
  if (!VERBS.has(verb)) { fail(`unknown proxy command: ${verb}. See: worca proxy help`); return 2; }
  if (rest.some((a) => /^--pass(word)?(=|$)/.test(a))) {
    fail('worca proxy login never takes a password as an argument: it reads it from a hidden prompt or from stdin');
    return 2;
  }
  const at = { ...(home !== undefined ? { home } : {}), platform, ...(exec ? { exec } : {}) };
  const networkProxy = () => { const s = settings(); return s && typeof s === 'object' ? s.networkProxy : undefined; };
  const json = rest.includes('--json');
  const upEnv = upstreamEnv(env);

  if (verb === 'status') {
    const np = networkProxy();
    // D13: a CLI process cannot see the running server's free port; a fixed port is the only URL it can state.
    const st = proxyState({ env: upEnv, networkProxy: np, login: readProxyLogin(at), enabled: networkProxyEnabled(settings()),
      localUrl: fixedPortOf(np) ? localProxyUrl(fixedPortOf(np)) : null });
    if (json) out(JSON.stringify(st)); else printStatus(st, out);
    return st.state === 'needs-login' ? 3 : (st.state === 'not-configured' || st.state === 'error' || st.state === 'off') ? 1 : 0;
  }

  if (verb === 'logout') {
    out(clearProxyLogin(at) ? 'Deleted the saved login. A running Worca stops sending it within a few seconds.' : 'No login was saved.');
    return 0;
  }

  if (verb === 'login') {
    const { auth } = networkProxy() || {};
    if (PASSWORD_MODES.includes(auth)) {
      err(`worca: networkProxy.auth is ${auth}, and a saved login keeps only the NT hash, which ${auth === 'digest' ? 'Digest' : 'Basic'} cannot use. Set auth to auto, or keep the login in HTTPS_PROXY.`);
      return 1;
    }
    const i = rest.indexOf('--user');
    let account = i >= 0 && rest[i + 1] ? parseAccount(rest[i + 1]) : null;
    let password = '';
    try {
      if (input.isTTY) {
        if (!account) account = parseAccount(await readLine('User (DOMAIN\\user): ', { input, output: prompt }));
        const label = account.domain ? `${account.domain}\\${account.user}` : account.user;
        password = await readHidden(`Password for ${label}: `, { input, output: prompt });
      } else {
        const lines = (await readAllInput(input)).split(/\r?\n/);
        if (!account) account = parseAccount(lines.shift() ?? '');
        password = lines.shift() ?? '';
      }
      const saved = saveProxyLogin({ ...account, password }, { ...at, env });
      out(`Saved the login for ${saved.label} (domain, user and NT hash; the password is not stored). A running Worca uses it within a few seconds. Check it with: worca proxy test`);
      return 0;
    } catch (e) {
      if (e && e.code === 'ABORT_ERR') { err('worca: cancelled; nothing was saved'); return 130; }
      if (e instanceof ProxyLoginError) { err(`worca: ${e.message}`); return 1; }
      err(`worca: the login could not be saved (${e && e.code ? e.code : e && e.message ? e.message : 'error'})`);
      return 1;
    } finally {
      password = '';
    }
  }

  // test
  const login = readProxyLogin(at);
  const up = resolveUpstream({ env: upEnv, settings: networkProxy(), login: login && !login.error ? login : null });
  if (!up) { err('worca: no corporate proxy is set up (Settings › Network proxy, settings.json networkProxy.upstream or HTTPS_PROXY)'); return 1; }
  if (up.error) { err(`worca: ${up.error}`); return 1; }
  const r = await checkUpstream(up, {
    startTripped: !!(up.login && up.login.rejected),
    onTrip: ({ upstream, loginId }) => { if (loginId) markLoginRejected(loginId, { ...at, upstream }); },
  });
  if (json) { out(JSON.stringify(r)); return r.ok ? 0 : 1; }
  const w = Math.max(...r.results.map((x) => x.host.length));
  for (const x of r.results) {
    const mark = x.ok ? c('green', 'OK  ') : c('red', 'FAIL');
    out(`${x.host.padEnd(w)}  ${mark}  ${x.ok ? (x.via === 'direct' ? x.error : `via ${r.upstream.upstream} (${x.ms} ms)`) : x.error}`);
  }
  return r.ok ? 0 : 1;
}
