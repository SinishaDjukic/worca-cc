// Classify one config / env value into consume "shells": service (host), http (path),
// db (database name). Shared by config-env, deploy-compose, deploy-k8s (P3) and the
// P4 db detector. Pure; never throws. A shell is
//   { kind, key, target?, needle, confidence }
// where `needle` is literal text inside the value that the caller cites as `match`.
// Secrets are NOT redacted here: P1's extract redacts every static fact centrally (index
// redact.mjs). Keys never carry credentials: db keys are 'db:<name>', service keys the
// host without port or userinfo.
import { envStems, hostAlias, hostName } from '../../../../shared/workspace-map/keys.mjs';
import { authorityEnd, notPort } from './text.mjs';

/** The first DNS label of a host (P1 `hostAlias`; null for localhost, IPs and non-hosts). P1's
 *  hostAlias bounds its own input, so a 1 MiB token costs one linear pass. */
export const aliasOf = (host) => hostAlias(host);

/** P1's host rule (C17), restated because P1 keeps it private: a host names a member through its
 *  first DNS label only when it is internal-shaped — one label, or a name under .internal, .local,
 *  .localhost, .lan, .svc, .cluster.local, .consul, .docker or .home.arpa. `host` = a P1 hostName. */
const INTERNAL_SUFFIXES = Object.freeze(['.internal', '.local', '.localhost', '.lan', '.svc', '.cluster.local', '.consul', '.docker', '.home.arpa']);
export const internalHost = (host) => typeof host === 'string' && !!host && (!host.includes('.') || INTERNAL_SUFFIXES.some((s) => host.endsWith(s)));

const DB_SCHEMES = /^(postgres|postgresql|mysql|mariadb|mongodb|mongodb\+srv|mssql|sqlserver|cockroachdb|clickhouse)$/i;
const SERVICE_SCHEMES = /^(amqp|amqps|nats|kafka|redis|rediss|tcp|ws|wss|grpc|grpcs|lb)$/i; // lb: Spring Cloud LoadBalancer (`lb://customers-service`)
// scheme://rest — rest stops at whitespace, quotes, and list separators, and at 2048 chars; a Kubernetes `$(VAR)`
// (`http://billing:$(BILLING_PORT)/api`, `postgres://$(USER):$(PASS)@db/app`) is read whole, its `)` included.
// Bounded classes only (no nested quantifiers), so a 1 MB value is one linear pass.
const URL_RE = /\b((?:jdbc:)?[a-z][a-z0-9+.-]{1,20}):\/\/((?:\$\(\w{1,100}\)|[^\s"'<>`,;|)]){1,2048})/gi;
// The text after a URL_RE match that stopped at `, ; ' ) |`: when it runs on to an '@' before whitespace or the next
// `scheme://`, the match was cut inside a userinfo (`app:8080/Zq9,x@db`) — what it read as host and path is the password.
const CUT_IN_USERINFO_RE = /[,;')|"<>`](?:[^\s"<>`@:]|:(?!\/\/)){0,2048}@/y;
/** true when a URL match stopped inside a credential query parameter's value (`?user=app&password=a`). */
const CRED_PARAM_RE = /^[\w.-]{0,40}(?:pass(?:word)?|passwd|pwd|secret|token)[\w.-]{0,40}=/i;
const SQLSERVER_PROP_RE = /^;\s{0,8}[A-Za-z][\w ]{0,40}=/; // `;database=…` after the host: a property list, no userinfo
const inCredParam = (rest) => { const q = rest.indexOf('?'); const i = Math.max(q, rest.lastIndexOf('&')); return q !== -1 && CRED_PARAM_RE.test(rest.slice(i + 1, i + 90)); };
const HOST_ONLY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}(?:\.[A-Za-z0-9-]{1,63}){0,8}(?::\d{1,5})?$/;
const ADO_DB_RE = /(?:^|;)\s*(?:Database|Initial Catalog)\s*=\s*([^;]+)/i;
const ADO_HOST_RE = /(?:^|;)\s*(?:Server|Host|Data Source|Address|Addr)\s*=\s*([^;]+)/i;
const SQLSERVER_DB_ALL_RE = /;\s*database(?:Name)?\s*=\s*([^;]+)/gi;
const PLACEHOLDER_RE = /\$\{|\$\(\w|\{\{|%\(|^\$[A-Za-z_]/;
const HOST_KEY_RE = /(host|hostname|addr|address|endpoint|server)$/i;
// A templated port (`email:${EMAIL_PORT}`, `ad:{port}`, `%PORT%`, `$PORT`, `$(PORT)`): the host is literal, the port is not.
const PORT_TEMPLATE_RE = /:(?:\d*|\$\{[^{}]{0,200}\}|\$\(\w{1,100}\)|\{\{?[\w.-]{0,100}\}?\}|%\w{1,100}%|\$\w{1,100})$/;
// A Kafka client bootstrap list (`spring.kafka.bootstrap-servers`, `kafka.bootstrap.servers`, `KAFKA_BROKERS`,
// `spring.cloud.stream.kafka.binder.brokers`, a YAML list item `bootstrap-servers.0`): comma-separated bare host[:port]s.
const BROKER_KEY_RE = /(?:^|[-_.])(?:bootstrap[-_.]?servers|brokers|broker[-_.]list)(?:\.\d+)?$/i;
const brokerKey = (k) => BROKER_KEY_RE.test(k) && /kafka|bootstrap|binder|broker[-_.]list|msk|redpanda/i.test(k);
// A value under a host-like key that is no host: a flag or a keyword (`prefer-ip-address: true`,
// `endpoint: none`). A bare number never passes (the bare-host rule needs a letter).
const NOT_HOST_RE = /^(?:true|false|yes|no|on|off|none|null|nil|default|always|never|enabled?|disabled?|auto|any|all)$/i;
// Incoming-webhook URLs of public services, whose path segments carry the credential (Zapier / Mattermost /
// Rocket.Chat `/hooks/<id>/<token>`, Feishu `/bot/v2/hook/<token>`, IFTTT `/with/key/<key>`, Make
// `hook.<region>.make.com/<token>`): no http shell is keyed by such a path on a host that is not
// internal-shaped (an internal service's own `/webhooks/stripe` route stays a joinable http fact).
const SECRET_PATH_RE = /\/(?:hooks?|webhooks?|webhookb2)\/[^/?#]|\/with\/key\//i;
/** A path segment shaped like a key — at least 16 chars of [A-Za-z0-9_=+-] holding a digit and a letter that is no slug
 *  (lower-case words, a capitalised word, `v2` or a number, each word with at most 4 trailing digits, joined by '-' / '_'):
 *  a hex or base64 key, a UUID — Datadog `/v1/input/<key>`, PagerDuty `/integration/<key>/enqueue`, Netlify
 *  `/build_hooks/<id>`, Sumo Logic `/receiver/v1/http/<token>`, healthchecks.io `/<uuid>`, a 22-char base64url push key. */
const SLUG_PIECE_RE = /^(?:[a-z]{2,}\d{0,4}|[A-Z][a-z]+\d{0,4}|\d{1,8}|v\d+)$/;
const tokenSegment = (path) => path.split('/').some((s) => s.length >= 16 && /^[\w=+-]+$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s)
  && !s.split(/[-_]/).every((p) => SLUG_PIECE_RE.test(p)));
const HOOK_HOST_RE = /^hooks?\./i;
/** Webhook hosts whose URL PATH is the credential (Slack, Discord, Office 365 / Teams, Telegram):
 *  no http shell is keyed by that path — a service shell for the host is all such a value gives. */
export const SECRET_PATH_HOST_RE = /^(?:hooks\.slack\.com|(?:ptb\.|canary\.)?discord(?:app)?\.com|[a-z0-9-]{1,63}\.webhook\.office\.com|api\.telegram\.org)$/i;

/** 'u:p@db-1:5432,db-2/shop?x' → { host: 'db-1:5432', path: '/shop' } */
export function splitAuthority(rest) {
  const s = String(rest ?? '');
  // `user:pa/ss@host/db`: the authority runs past the '@' (lib/text authorityEnd), so no part of an
  // unencoded password is ever read as the host or the path.
  const end = authorityEnd(s);
  const auth = end === -1 ? s : s.slice(0, end);
  const tail = end === -1 ? '' : s.slice(end);
  const host = auth.slice(auth.lastIndexOf('@') + 1).split(',')[0];
  return { host, path: /^[^?#]*/.exec(tail)[0] };
}

/** Drop trailing '}' that close an enclosing ${VAR:default} rather than a path segment. */
function trimUnbalanced(s) {
  let open = 0;
  let close = 0;
  for (let i = 0; i < s.length; i += 1) { if (s[i] === '{') open += 1; else if (s[i] === '}') close += 1; }
  let end = s.length;
  while (end > 0 && s[end - 1] === '}' && close > open) { end -= 1; close -= 1; }
  return s.slice(0, end);
}

/** Consume shells for one value. keyName (config key / env name) enables the bare-host
 *  rule for keys ending in host / hostname / addr / address / endpoint / server. */
export function classifyValue(value, keyName = '') {
  const out = [];
  if (typeof value !== 'string' || !value.trim()) return out;
  const v = value.trim();
  if (v.includes(';') && ADO_DB_RE.test(v) && ADO_HOST_RE.test(v) && !v.includes('://')) {
    const dbm = ADO_DB_RE.exec(v);
    const db = dbm[1].trim();
    const host = ADO_HOST_RE.exec(v)[1].trim().replace(/^tcp:/i, '').split(/[,\\]/)[0];
    if (db && !PLACEHOLDER_RE.test(db)) {
      out.push({ kind: 'db', key: `db:${db}`, target: aliasOf(host) ? host : undefined, needle: dbm[0].replace(/^;/, '').trim(), confidence: 'exact' });
    }
    return out;
  }
  let ssAll = null; // every `;databaseName=` of the value, found once (not re-scanned per URL)
  let ssI = 0;
  for (const m of v.matchAll(URL_RE)) {
    const scheme = m[1].toLowerCase();
    const rest = trimUnbalanced(m[2]);
    const { host, path } = splitAuthority(rest);
    // `user:pa` cut before its '@' (URL_RE stops at a `,` `;` `'` `)` `|` in the password): no host at all, and
    // its "path" would be the password's tail — also when the password's head reads like a port (`app:8080/Zq9,x@db`).
    const end = authorityEnd(rest);
    const auth = end === -1 ? rest : rest.slice(0, end);
    const at = auth.lastIndexOf('@');
    // An empty port (`app:/Zq9/@db`, `app:#Zq9@db`) is a password cut too: no URL is written with one.
    CUT_IN_USERINFO_RE.lastIndex = m.index + m[0].length;
    const bare = scheme.replace(/^jdbc:/, '');
    // SQL Server's JDBC URL has no userinfo: `;user=sa;password=P@ss` are properties, never a cut password — nor has Prisma's
    // `sqlserver://db:1433;database=shop;user=sa;password=P@ss` (go-mssqldb's `sqlserver://sa:pw@db?database=x` keeps the scan).
    const props = scheme === 'jdbc:sqlserver' || (bare === 'sqlserver' && !/[/@?#]/.test(rest) && SQLSERVER_PROP_RE.test(v.slice(m.index + m[0].length, m.index + m[0].length + 64)));
    // Nor is a cut inside a credential query parameter (`?user=app&password=a,b@c`): the URL's authority ended before it.
    if (notPort(host) || host.endsWith(':') || (!props && !inCredParam(rest) && CUT_IN_USERINFO_RE.test(v))) continue;
    // A userinfo holding '/' (`app:pa/ss@db`) is one redaction cannot see: the value is cited from its host on.
    const from = at !== -1 && auth.slice(0, at).includes('/') ? at + 1 : -1;
    const needle = from === -1 ? `${m[1]}://${rest}` : rest.slice(from);
    const hostOnly = host.replace(PORT_TEMPLATE_RE, '');
    // A templated port leaves a literal host: the target is the host without it (P1's hostAlias strips `${…}` only).
    const target = aliasOf(hostOnly) ? (hostOnly === host || /:\d+$/.test(host) ? host : hostOnly) : undefined;
    // No database path, vhost or db number holds an '@': a password (`app:8080/Zq9/x@db`, `guest:0/Zq9@rabbit`) read as one.
    // …nor does a query or fragment right after the host (`admin:0?pw/x@rabbit`, `:pa@ss#1@cache`: the password's `?` / `#`).
    if (scheme !== 'http' && scheme !== 'https' && !/^wss?$/.test(scheme) && (path.includes('@') || (end !== -1 && rest[end] !== '/' && rest.includes('@', end)))) continue;
    if (scheme.startsWith('jdbc:') || DB_SCHEMES.test(bare)) {
      let db = path.replace(/^\//, '').split(/[/;?]/)[0];
      if (!db) {
        ssAll ??= [...v.matchAll(SQLSERVER_DB_ALL_RE)];
        while (ssI < ssAll.length && ssAll[ssI].index < m.index) ssI += 1; // the first one after this URL
        if (ssI < ssAll.length) db = ssAll[ssI][1].trim();
      }
      if (db && !/^\d+$/.test(db) && !PLACEHOLDER_RE.test(db) && !db.includes('{')) {
        out.push({ kind: 'db', key: `db:${db}`, target, needle, confidence: 'exact' });
      }
      continue;
    }
    if (scheme === 'http' || scheme === 'https') {
      // A credential in the path (a webhook): no http fact is keyed by it, and the service fact cites
      // the URL up to its path only (redaction knows the path shapes of four hosts, not every webhook).
      const secretPath = SECRET_PATH_HOST_RE.test(hostOnly)
        || ((SECRET_PATH_RE.test(path) || HOOK_HOST_RE.test(hostOnly) || tokenSegment(path)) && !!target && !internalHost(hostName(hostOnly))); // localhost / an IP: local dev, kept
      const upToPath = from === -1 ? `${m[1]}://${auth}` : auth.slice(from);
      if (target) out.push({ kind: 'service', key: hostOnly, target, needle: secretPath && end !== -1 ? upToPath : needle, confidence: 'exact' });
      if (path && path !== '/' && !secretPath) out.push({ kind: 'http', key: path, target, needle, confidence: 'exact' });
      continue;
    }
    if (SERVICE_SCHEMES.test(scheme) && target) out.push({ kind: 'service', key: hostOnly, target, needle, confidence: 'exact' });
  }
  const broker = !out.length && brokerKey(keyName);
  if (!out.length && (broker || HOST_KEY_RE.test(keyName))) {
    for (const h of broker ? v.split(',').map((x) => x.trim()) : [v]) {
      const bare = h.replace(PORT_TEMPLATE_RE, ''); // `ad:${AD_PORT}`: the host is still `ad` (the template leaves the target)
      if (HOST_ONLY_RE.test(bare) && /[a-z]/i.test(bare) && !NOT_HOST_RE.test(bare) && aliasOf(bare)) out.push({ kind: 'service', key: bare, target: bare === h || /:\d*$/.test(h) ? h : bare, needle: h, confidence: 'heuristic' });
    }
  }
  return out;
}

/** A credential parameter of a query or a property list (`?password=`, `&access_token=`, `;pwd=`, `;password={P;ss}`): its value — a query
 *  value to the next `&`, a property to the next `;` (or its `{…}`) — is never quoted, and an '@' inside it is no userinfo end. */
const CRED_NAME = '(?:code|[\\w.-]{0,40}(?:pass|pwd|secret|token|key|auth|sig|credential)[\\w.-]{0,40})=';
const CRED_VALUE_RE = new RegExp(`(;${CRED_NAME})(?:\\{[^}]{0,512}\\}|[^;]{0,2048})|([?&]${CRED_NAME})[^&]{0,2048}`, 'gi');
/** A value as an unresolved item quotes it (its first 1 KiB): every URL in it from its last '@' on — P1's redaction misses
 *  a userinfo holding '/', '?' or '#' (`mongodb://app:${PASS:-pa/Zq9}@${HOST}/db`); a display, so it fails closed. */
export function unresolvedValue(value) {
  const v = String(value ?? '').replace(CRED_VALUE_RE, (all, prop, param) => `${prop ?? param}***`);
  let out = '';
  let from = 0;
  for (let s = v.indexOf('://'); s !== -1; s = v.indexOf('://', from)) {
    const next = v.indexOf('://', s + 3);
    const at = v.slice(s + 3, next === -1 ? v.length : next).lastIndexOf('@'); // a password may hold ' , ; ) | ` " < > and spaces
    out += v.slice(from, s + 3);
    from = at === -1 ? s + 3 : s + 4 + at;
  }
  return (out + v.slice(from)).slice(0, 1024);
}

/** true for a value the detector cannot key: `${BILLING_URL}`, `{{ .Values.x }}`, `$BILLING`, `$(BILLING_URL)`. */
export const isPlaceholder = (value) => typeof value === 'string' && PLACEHOLDER_RE.test(value.trim());

/** Config keys whose value is expected to name a peer: the URL-ish tails P1's `envStems` reads
 *  (url / uri / host / hostname / endpoint / addr / address — `*_URL`, `baseUrl`, `*.uri`, `*host`). */
export const PEER_KEY_RE = /(url|uri|host|hostname|endpoint|addr|address)$/i;

/** { target, confidence } of one shell from a config value: the URL's host when it names one;
 *  else — an http path whose URL has no usable host (localhost, an IP) under a key that names a
 *  peer — the config key itself (`BILLING_API_URL`, `ledger.base-url`, `Services:BillingUrl`),
 *  emitted only when P1's `envStems` reads a service name out of it (so the catalog can resolve
 *  it). A key-named target is only `heuristic`. */
export function shellTarget(shell, key) {
  const k = typeof key === 'string' ? key : '';
  if (shell.target || shell.kind !== 'http' || !envStems(k).length) return { target: shell.target, confidence: shell.confidence };
  return { target: k, confidence: 'heuristic' };
}
