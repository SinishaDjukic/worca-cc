// tools/k8s-auth/login.mjs — sign in through oauth2-proxy and Keycloak the way a browser does, for
// `node tools/k8s-smoke.mjs --auth`. Runs INSIDE the cluster (piped to `node` in the controller
// pod, which resolves the Services and trusts the smoke's CA through NODE_EXTRA_CA_CERTS):
//
//   node - <proxy base URL> <username> <password>
//
// Prints one JSON line: { status, cookie, trail }. `status` is the proxy's answer to the
// callback (302 when the person is admitted, 403 when the proxy refuses their groups), `cookie`
// the Cookie header for the proxy afterwards (the session, possibly split in parts).
const [base, username, password] = process.argv.slice(2);
const jar = new Map();   // host -> Map(name -> value)
const trail = [];

function keep(url, res) {
  const host = new URL(url).host;
  const cookies = jar.get(host) || new Map();
  for (const c of res.headers.getSetCookie()) {
    const [pair, ...attrs] = c.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
    if (expired) cookies.delete(name); else cookies.set(name, value);
  }
  jar.set(host, cookies);
}
const cookieFor = (url) => [...(jar.get(new URL(url).host) || new Map())].map(([k, v]) => `${k}=${v}`).join('; ');

async function go(url, init = {}) {
  const res = await fetch(url, { redirect: 'manual', ...init, headers: { accept: 'text/html', cookie: cookieFor(url), ...(init.headers || {}) } });
  keep(url, res);
  trail.push(`${init.method || 'GET'} ${url.replace(/([?&](code|state|session_state)=)[^&]+/g, '$1…')} -> ${res.status}`);
  return res;
}

// Follow redirects until a page answers (or the proxy's callback, whose status is the verdict).
async function follow(res, url) {
  for (let i = 0; i < 12 && res.status >= 300 && res.status < 400; i++) {
    url = new URL(res.headers.get('location'), url).href;
    res = await go(url);
    if (new URL(url).pathname === '/oauth2/callback') return { res, url, callback: res.status };
  }
  return { res, url, callback: null };
}

const out = { status: null, cookie: '', trail };
try {
  let { res, url } = await follow(await go(`${base}/`), `${base}/`);
  const html = await res.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  if (!action) throw new Error(`no Keycloak login form at ${url} (HTTP ${res.status})`);
  const post = await go(new URL(action.replaceAll('&amp;', '&'), url).href, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, credentialId: '' }).toString(),
  });
  const done = await follow(post, url);
  out.status = done.callback ?? done.res.status;
  out.cookie = cookieFor(base);
} catch (err) {
  out.error = err.message;
}
console.log(JSON.stringify(out));
