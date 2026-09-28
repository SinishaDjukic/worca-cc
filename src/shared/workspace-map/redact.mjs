// src/shared/workspace-map/redact.mjs
// Secrets never leave the member checkout. Every string the map carries out of a checkout
// (static facts, verified LLM facts, candidate literals, aliases, roles, synthesis text) passes
// through redactSecrets; readers that go line by line use redactLines. It keeps the text
// recognisable — a redacted URL still names its host, a redacted `API_TOKEN=***` still reads as
// config — so evidence stays useful. Pure, idempotent and LINEAR: every run below is bounded
// (unbounded runs made a 1 MiB line of hex or letters take over a minute), so a minified or
// generated file can never stall a scan.

const SECRET_WORDS = 'pass(?:word)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth|account[_-]?key|signature';
const KEY = `[\\w.-]{0,120}(?:${SECRET_WORDS})[\\w.-]{0,120}`;
/** Well-known credential shapes (GitHub, GitLab, Slack, Stripe, Google, OpenAI / Anthropic, npm),
 *  one capture group per prefix (TOKEN_GROUPS of them); every tail is bounded. */
const TOKEN_SHAPES = '(gh[pousr]_)[A-Za-z0-9]{20,255}|(github_pat_)[A-Za-z0-9_]{20,255}|(glpat-)[A-Za-z0-9_-]{20,255}'
  + '|(xox[abposr]-)[A-Za-z0-9-]{10,255}|((?:sk|rk)_(?:live|test)_)[A-Za-z0-9]{10,255}|(AIza)[A-Za-z0-9_-]{35,255}'
  + '|(whsec_)[A-Za-z0-9]{20,255}|(sk-(?:proj-|ant-[a-z0-9]{2,8}-)?)[A-Za-z0-9_-]{32,255}|(npm_)[A-Za-z0-9]{36}';
const TOKEN_GROUPS = 9;
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]{1,64})-----(?:(?!-----BEGIN )[\s\S]){0,65536}?-----END \1-----/g;
const PEM_LINE = /-----(BEGIN|END) [A-Z0-9 ]{0,64}[A-Z0-9]-----/g;
// Userinfo starts at `://` (the scheme in front is untouched text): no scheme-shaped run is scanned at
// every position, and no letter run in front can hide it (`aaaa…postgres://app:s3cr3t@db`).
// The user may hold '@' (Azure `user@server:pass@host`); a password may be a long OAuth token.
const USERINFO = /(:\/\/)[^\s/:'"`]{0,256}:[^\s/'"`]{0,2048}@/g;
/** Connection strings without `://`: Go MySQL DSN `user:pass@tcp(…)`, Oracle `jdbc:oracle:thin:user/pass@…`,
 *  `curl -u user:pass`, Python `auth=('u', 'p')` / `HTTPBasicAuth('u', 'p')`. */
const GO_DSN = /(?<![\w.-])([\w.-]{1,64}:)[^\s@/:'"`]{1,256}(@(?:tcp|unix|udp)\()/g;
const ORACLE = /(\bjdbc:oracle:(?:thin|oci):[\w.$-]{1,64}\/)[^\s@'"`]{1,256}@/gi;
const CLI_USER = /((?:^|\s)(?:-u|--user)(?:\s{1,8}|=)["']?[^\s:'"]{1,128}:)[^\s'"]{1,256}/g;
/** Basic credentials encoded where the request is built (`Buffer.from('svc:pw')`, `btoa("svc:pw")`,
 *  `b64encode(b"svc:pw")`, `encodeToString("svc:pw".getBytes())`, `GetBytes("svc:pw")`, Go `[]byte("svc:pw")`):
 *  the user stays, the password goes (`Authorization: 'Basic ' + Buffer.from('svc:***')`). */
const BASIC_ENCODED = /(\b(?:Buffer\.from|btoa|(?:urlsafe_|standard_)?b64encode|base64_encode|encodebytes|(?:strict_|urlsafe_)?encode64|encodeToString|EncodeToString|GetBytes|toBase64)\s{0,8}\(\s{0,8}(?:\[\]byte\(\s{0,8})?[bBuU]?(["'`])[^"'`\s:\\]{1,128}:)(?!\/\/)(?:\\[\s\S]|(?!\2)[^\\\n]){1,256}\2/g;
const AUTH_TUPLE = /(\b(?:auth\s{0,8}=\s{0,8}\(|\w{0,32}(?:Auth|Credentials?|Authentication)\(|Credentials\.basic\()\s{0,8}(["'])[^"'\n]{0,128}\2\s{0,8},\s{0,8})((["'])(?:\\[\s\S]|(?!\4)[^\\\n]){0,256}\4)(?:(\s{0,8},\s{0,8})((["'])(?:\\[\s\S]|(?!\7)[^\\\n]){0,256}\7))?/g;
// A builder's literal that STARTS as a URL (`configureAuthentication("jwt", "http://auth-svc/jwks")`) is no credential; a third literal
// is (AWS session token, Azure client secret): redacting only the second left it with no secret-named neighbour.
const tupleLit = (lit) => { const v = lit.slice(1, -1); return !v || URL_START.test(v) ? lit : `${lit[0]}***${lit[0]}`; };
/** Credential query parameters whose names carry no secret word: Azure SAS `sig`, Azure Functions `code`, `key`,
 *  a JWT (`jwt`), a session (`session`, `sessionid`, `session_id`, `sid`), a CAS / SSO `ticket`, an Azure API
 *  Management `subscription-key`. */
const QUERY_CRED = /([?&](?:sig|code|key|jwt|session(?:_?id)?|sid|ticket|subscription-key)=)[^\s"'`&#;<>]{1,4096}/gi;
/** A secret-named header / setting passed positionally, and XML forms. */
const HEADER_PAIR = new RegExp(`((["'])(${KEY})\\2\\s{0,8},\\s{0,8})(["'])((?:\\\\[\\s\\S]|(?!\\4)[^\\\\]){1,4096})\\4`, 'gi');
const XML_KV = new RegExp(`(<(${KEY})>)([^<]{1,4096})(<\\/\\2>)`, 'gi');
/** A message topic / routing key (`user.created`, `orders.*`, `chat:room1`): the second argument of a
 *  pair whose first names an exchange or channel (`publish('auth', 'user.created')`) is what the map joins on. */
const TOPIC_VALUE = /^[a-z0-9][a-z0-9_-]{0,63}(?:[.:](?:[a-z0-9][a-z0-9_-]{0,63}|[*#>])){1,15}$/;
/** …never under a name that IS the credential (`put("password", "zq9pass.word")`, `("Authorization", "admin:pw")`,
 *  `("DB_PASSWORD_2", "admin:pw")`): only a channel or an exchange (`auth`, `auth-events`) carries a topic. The test
 *  fails CLOSED: any credential-word segment (`DB_PASSWORD_2`, `db_passwd`, `secretKeyV2`, `password_confirmation`)
 *  names the credential unless a LATER segment names a message container (`auth.token.events`); a plural
 *  (`auth.tokens`, `auth-keys`) or a word prefix (`keycloak`) is no credential word. An event named for the credential
 *  (`password-reset`, `token.revoked`) or the infrastructure holding it (`TOKEN_CACHE`, `secret.manager`) is no
 *  credential either: its routing key / host default is what the map joins on (`refresh` stays out: a refresh token). */
const CRED_SEGMENT = /(?:pass(?:w(?:or)?d|phrase)?|pwd|secret|token|key|signature|authorization)(?:value|base|id|hash|str|string|b64|bytes|pem|data)?$/;
const CONTAINER_SEGMENT = /^(?:events?|exchanges?|topics?|queues?|channels?|streams?|bus|subjects?|reset|rotation|rotated|revoked|revocation|issued|issuer|audience|expired|changed|refreshed|created|updated|deleted|invalidated|invalidation|requested|cache|store|broker|mailer|manager)$/;
const pairNamesCredential = (k) => {
  const segs = k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Za-z])(\d)/g, '$1_$2').toLowerCase().split(/[-_.]+/);
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    if (CRED_SEGMENT.test(segs[i])) return true;
    if (CONTAINER_SEGMENT.test(segs[i])) return false;
  }
  return false;
};
/** A name that ENDS in a credential word (`api_key`, `DB_PASSWORD`, `secret_key_base`): under it LINE_KV's code run
 *  keeps no literal for being dotted or host-shaped (`api_key = Key("abc.def123")`). Narrower than
 *  pairNamesCredential on purpose: `token_client = TokenClient("auth-svc:8080")` keeps its host. */
const CREDENTIAL_NAME = /(?:pass(?:word|phrase)?|pwd|secret|token|key|signature|authorization)(?:[-_.]?(?:value|base|id|hash|str|string|b64|bytes|pem|data))?$/i;
const NAME_VALUE = new RegExp(`(\\b(?:name|key)\\s{0,4}=\\s{0,4}(["'])(${KEY})\\2\\s{1,16}value\\s{0,4}=\\s{0,4})(["'])([^"'\\n]{0,4096})\\4`, 'gi');
/** A whole-line `KEY=value` / `key: value` (.env, properties, YAML): the value runs to whitespace, so a
 *  password holding `&`, `,` or `;` is not cut short. Anchored at the start of the text: one attempt, linear. */
// A value that is a CLOSED backtick / prefixed string (`f"…"`, `b'…'`) is left to BARE_KV's quoted branch; an
// unclosed one stays LINE_KV's (BARE_KV would cut it short and a second pass redact the rest: idempotency).
const LINE_KV = new RegExp(`^(\\s{0,64}(?:export\\s{1,8}|-\\s{1,8})?(${KEY})(?:\\s{0,8}=\\s{0,8}|:\\s{1,8}))((?!["']|[fFrRbBuU]{0,2}(["'\`])(?:\\\\[\\s\\S]|(?!\\4)[^\\\\]){0,4096}\\4)[^\\s]+)`, 'i');
/** A value under a locator-named key (…_HOST, …Address, …_URL, …_TOPIC, …_PORT, …_PATH, …Service,
 *  …_TARGET, …destination, …_NAME) that is shaped like a host[:port], a port or a path is what the map
 *  joins on, never a credential. A path may follow one template placeholder (`${BASE}/x`, `$base/x`,
 *  `{BASE}/x`, `%s/x`); a host may be the default of a placeholder (`${AUTH_HOST:-auth-svc}`). */
const LOCATOR_KEY = /(?:host(?:name)?|addr(?:ess)?|ur[li]|endpoint|port|topic|queue|domain|path|route|prefix|service|svc|server|target|destination|channel|exchange)s?["']?$/i;
const HOST_SHAPE = '[a-z0-9][a-z0-9_-]{0,62}(?:\\.[a-z0-9_-]{1,63}){0,8}(?::\\d{1,5})?';
const HOST_VALUE = new RegExp(`^${HOST_SHAPE}$`, 'i');
const LOCATOR_VALUE = new RegExp(`^(?:${HOST_SHAPE}|\\d{1,5}|\\$\\{[\\w.]{1,64}:-?${HOST_SHAPE}\\})$`, 'i');
const PATH_VALUE = /^(?:\$\{[\w.:-]{1,64}\}|\$[A-Za-z_]\w{0,63}|\{[\w.]{1,64}\}|%s)?\/[\w.{}:$/-]{0,256}$/;
/** A route (`/oauth/token`, `${BASE}/oauth/token`) — never one holding a token-shaped segment (upper,
 *  lower and a digit: `/Zq9sEcr3t`). Kept QUOTED under any key (HEADER_PAIR's rule for every quoted form:
 *  `{ token: '/oauth/token' }`, `TOKEN_PATH = "/oauth/token"`), bare under a locator key. */
const pathLike = (v) => PATH_VALUE.test(v) && !v.split('/').some((s) => /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s));
/** A bare code expression after a spaced `=` / `: ` (`authClient = new …`, `await …`, an opening
 *  `{` / `[` / `(`, a member call `grpc.insecure_channel(`) is not a credential: redacting it hid the
 *  call the agents cite. */
// A plain call (`AuthClient("http://auth-svc:8080")`, `create_engine("postgresql://…")`) is code only when
// a literal, a keyword argument or another call opens its arguments: `Summer(2024)` stays a password, and so
// does a Jasypt `ENC(G6N7…==)` (base64 padding is no keyword argument).
const PLAIN_CALL = /^[A-Za-z_$][\w$]{0,64}\((?=["'`]|[A-Za-z_$][\w$.]{0,64}(?:\s{0,4}=(?![=)])|\())/;
const CODE_VALUE = /^(?:(?:new|await|[{[(])$|[A-Za-z_$][\w$]{0,64}(?:\.[A-Za-z_$][\w$]{0,64}){1,8}\()/;
// BARE_KV's rule for a plain call, applied to LINE_KV's whitespace run: the bare run stops at `"'&,;` and is code only
// when it ends in a paren or a literal / argument separator follows (`password: Q(TO=lU2&mugI` kept by LINE_KV and cut
// by BARE_KV at the `&` left `***&mugI`, which the next pass cut again). Judged on the text as KEPT (keepUrl may turn
// a trailing `?token=x(` into `?token=***`: the next pass judges that).
const plainCallKept = (raw) => { const v = keepUrl(raw); const b = /^[^"'&,;]*/.exec(v)[0]; return /[()]$/.test(b) || /^[,;"'`]/.test(v.slice(b.length)); };
const codeValue = (v) => CODE_VALUE.test(v) || (PLAIN_CALL.test(v) && plainCallKept(v));
/** Inside such a code run every literal that is not join-shaped (a URL, a route, a dotted host or a
 *  host:port, an UPPER_SNAKE env name) may be the secret (`base64.b64encode(b"user:pw")`); an unclosed
 *  one is cut to `"***`. One pass, no literal rescanned (a regex restarted at every escaped quote). */
// A host in code is lower case: a JWT (`eyJ…`), a SendGrid (`SG.…`) or a Discord token is dotted too, and never is.
const CODE_HOST = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9_-]{1,63}){0,8}(?::\d{1,5})?$/;
const WORD_DOTTED = /^[A-Za-z][a-z]{0,31}(?:[A-Z][a-z]{1,31}){0,7}(?:\.[A-Za-z][a-z]{0,31}(?:[A-Z][a-z]{1,31}){0,7}){1,8}$/;
const joinShaped = (s, strict = false) => s.includes('://') || pathLike(s) || (!strict && /[.:]/.test(s) && (CODE_HOST.test(s) || WORD_DOTTED.test(s))) || /^[A-Z][A-Z0-9]{0,63}(?:_[A-Z0-9]{1,64}){1,8}$/.test(s);
/** The keyword naming the literal whose quote is at `v[at]` (`host=`, `queue: `) — read backwards over at
 *  most 80 chars of the INPUT (indexing the output being built flattens it at every literal: quadratic). */
function keywordBefore(v, at) {
  let i = at - 1;
  const stop = Math.max(-1, at - 80);
  while (i > stop && (v[i] === ' ' || v[i] === '\t')) i -= 1;
  if (i <= stop || (v[i] !== '=' && v[i] !== ':')) return '';
  i -= 1;
  while (i > stop && (v[i] === ' ' || v[i] === '\t')) i -= 1;
  const end = i + 1;
  while (i > stop && /[\w$]/.test(v[i])) i -= 1;
  return v.slice(i + 1, end);
}
function codeRun(v, strict = false) {
  let out = '';
  let i = 0;
  while (i < v.length) {
    const q = v[i];
    if (q !== '"' && q !== "'" && q !== '`') { out += q; i += 1; continue; }
    let j = i + 1;
    while (j < v.length && v[j] !== q) j += v[j] === '\\' ? 2 : 1;
    if (j >= v.length) return `${out}${q}***`;
    const s = v.slice(i + 1, j);
    // A host / queue / topic under a locator-named keyword (`redis.Redis(host="auth-cache")`) is what the map joins on.
    const kw = !s || joinShaped(s, strict) ? '' : keywordBefore(v, i);
    out += !s || joinShaped(s, strict) || (kw && LOCATOR_KEY.test(kw) && LOCATOR_VALUE.test(s)) ? v.slice(i, j + 1) : `${q}***${q}`;
    i = j + 1;
  }
  return out;
}
/** LINE_KV keeps a URL only when the value STARTS as one (a `${VAR:-default}` wrapper allowed): a `://`
 *  further along the run (`pw,x&next=http://…`) proves nothing, and keepUrl may remove it (idempotency). */
const URL_START = /^(?:\$\{[\w.]{1,64}:-?)?[a-z][\w+.:-]{0,64}:\/\//i;
/** A user-only userinfo that is a token: a known shape, or any run of ≥ 16 `[A-Za-z0-9_-]` mixing letters and
 *  digits (a classic 40-hex GitHub PAT, an Azure DevOps PAT, a Sentry DSN key). A name stays (`git@`, `deploy@`,
 *  `gitlab-ci-token@`, `oauth2@`); a long one holding digits (`svc-billing-prod-01@`) is masked too. */
const USER_TOKEN = new RegExp(`(:\\/\\/)(?:${TOKEN_SHAPES}|(?=[A-Za-z0-9_-]{0,255}[0-9])(?=[A-Za-z0-9_-]{0,255}[A-Za-z])[A-Za-z0-9_-]{16,255})@`, 'g');
/** NATS token auth puts the token where the user goes (`nats://<token>@host`), however short: a user-only
 *  userinfo of a nats:// URL is always a credential. No `\b` before it: a key id just before (`ASIA…nats://`)
 *  becomes `***` only later in the chain, and one pass must mask both. */
const NATS_USER = /(nats:\/\/)[^\s/:@'"`]{1,256}@/gi;
/** A JWT anywhere (a `?token=` value, a path segment): anchored at a token boundary, every run bounded. */
const JWT = /(?<![\w-])eyJ[\w-]{8,2048}\.eyJ[\w-]{2,2048}\.[\w-]{0,2048}/g;
/** Webhook URLs whose path IS the credential: the host and the fixed prefix stay. */
const WEBHOOKS = [
  /(https?:\/\/hooks\.slack\.com\/services\/)[A-Za-z0-9_/-]{1,256}/gi,
  /(https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/)[A-Za-z0-9_/-]{1,256}/gi,
  /(https?:\/\/[A-Za-z0-9-]{1,63}\.webhook\.office\.com\/)[A-Za-z0-9_@/.-]{1,512}/gi,
  /(https?:\/\/api\.telegram\.org\/bot)[0-9]{1,20}:[A-Za-z0-9_-]{1,128}/gi,
];
/** The same credentials when only the PATH travels (an http fact is keyed by its path). */
const WEBHOOK_PATHS = [
  [/\/services\/T[A-Z0-9]{6,20}\/B[A-Z0-9]{6,20}\/[A-Za-z0-9]{16,64}/g, '/services/***'],
  [/\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,100}/g, '/api/webhooks/***'],
  [/\/bot\d{3,15}:[A-Za-z0-9_-]{20,64}/g, '/bot***'],
  // Office 365 / Teams incoming webhooks: /webhookb2/<guid>@<guid>/IncomingWebhook/<secret>/<guid> (legacy /webhook/…).
  [/(\/webhook(?:b2)?\/)[A-Za-z0-9@._-]{8,160}\/IncomingWebhook\/[A-Za-z0-9._/-]{1,256}/g, '$1***'],
];
// Credential-shaped only (≥ 8 chars with a digit, one of _ ~ + / =, a lower→upper change or a dot
// INSIDE the token as in a JWT), so prose such as 'Basic authentication.', 'Bearer token-based auth'
// or 'Basic CRUD service' keeps its words.
const AUTH_HEADER = /\b(Bearer|Basic|bearer)\s{1,16}(?=[A-Za-z0-9._~+/=-]{8})(?=[A-Za-z0-9._~+/=-]{0,4096}?(?:[0-9_~+/=]|[a-z][A-Z]|\.[A-Za-z0-9]))[A-Za-z0-9._~+/=-]{8,4096}/g;
const AUTH_SCHEME = /(\bAuthorization\s{0,16}[:=]\s{0,16}["']?)([A-Za-z][A-Za-z0-9_-]{0,31})\s{1,16}[A-Za-z0-9._~+/=-]{1,4096}/gi;
const TOKEN = new RegExp(`(?<![A-Za-z0-9])(?:${TOKEN_SHAPES})`, 'g');
const AWS_KEY = /(AKIA|ASIA)[0-9A-Z]{16}/g;
const QUOTED_KV = new RegExp(`(["'])(${KEY})\\1(\\s*:\\s*)(["'])((?:\\\\[\\s\\S]|(?!\\4)[^\\\\]){0,4096})\\4`, 'gi');
// A backtick template and a prefixed string (`f"…"`, `b'…'`) are quoted values too; an unclosed one is
// never eaten as a bare value (LINE_KV would then redact the rest on a second pass).
const BARE_KV = new RegExp(`(^|[^\\w.-])(${KEY})(\\s*=\\s*|:\\s+|:(?=["'\`]))(?:([fFrRbBuU]{0,2})(["'\`])((?:\\\\[\\s\\S]|(?!\\5)[^\\\\]){0,4096})\\5|((?![fFrRbBuU]{1,2}["'\`])[^\\s"'&,;]+))`, 'gi');
/** A line that OPENS a multi-line PEM block: the BEGIN marker alone, or as the value of an assignment
 *  (key: …, KEY="…, const key = `…, KEY = """…, key := `…), or a string piece continued on the next
 *  line ('-----BEGIN X-----\n' +). The first ':' / '=' is the assignment; no two adjacent runs overlap. */
// A string CLOSED on the marker's line opens nothing unless it continues (`\n` inside it, or a `+`):
// `PEM_HEADER = "-----BEGIN PUBLIC KEY-----"` is a whole one-line constant, and blanked the rest of the file.
// The opening quote may follow a `(` / `[` and a string prefix (C# `@"`, Python `r"""` / `b"`, Rust `r#"`).
const PEM_OPEN = /^\s{0,64}(?:[^\s:=][^\n:=]{0,199}[:=]{1,2}\s{0,8})?(?:(?:[([]\s{0,8})?(?:@|[rRbBuU]{1,2}#{0,3})?["'`]{1,3})?-----BEGIN [A-Z0-9 ]{1,64}-----(?:\\n["'`]{0,3}(?:\s{0,8}\+)?|["'`]{1,3}\s{0,8}\+)?\s*$/;
const PEM_CLOSE = /-----END [A-Z0-9 ]{1,64}-----/;

/** Not a secret: an empty value, a URL (its userinfo is already gone; keepUrl still redacts its
 *  secret-named query parameters), or the auth scheme word of an `Authorization: Bearer ***` header
 *  (the credential after it is already gone). */
const keep = (value, key = '', { quoted = false, whole = false } = {}) => !value
  || (whole ? URL_START.test(value) : keepUrl(value).includes('://')) || /^(Bearer|Basic|bearer)$/.test(value)
  || (quoted && pathLike(value)) || (LOCATOR_KEY.test(key) && (LOCATOR_VALUE.test(value) || pathLike(value)));
/** A secret-named query / fragment parameter inside a value that is otherwise kept (a URL under a
 *  secret-named key: `AUTH_URL=https://x/login?api_key=***`). The kept value is never rescanned by
 *  BARE_KV, so without this its `?token=` would survive. */
const QUERY_SECRET = new RegExp(`([?&;#]${KEY}=)[^\\s"'\`&#;]{1,4096}`, 'gi');
const keepUrl = (v) => v.replace(QUERY_SECRET, '$1***');

/** Replaces secrets in any string with '***' while keeping the text recognisable:
 *  URL userinfo `scheme://user:pass@host` → `scheme://***@host` (so `x-access-token:…@` and
 *  `oauth2:…@` too); a user-only userinfo that is a known token shape (below) or any run of ≥ 16
 *  `[A-Za-z0-9_-]` mixing letters and digits (a 40-hex PAT, an Azure DevOps PAT, a Sentry DSN key)
 *  → `***@`, and a nats:// one of any length (`nats://***@nats`); any other user-only `user@` is kept
 *  (`git@github.com`, `deploy@`, `oauth2@`);
 *  key/value secrets where the key matches /pass(word)?|pwd|secret|token|api[_-]?key|access[_-]?key|
 *  private[_-]?key|client[_-]?secret|auth/i in `k=v`, `k: v`, `k:'v'`, `"k": "v"`, `?k=v&` forms →
 *  value '***' (`k: v` needs the space unless the value is quoted, so `auth:8080` stays a host and
 *  port; a URL value is kept — its userinfo is already gone — minus its secret-named query
 *  parameters: `AUTH_URL=https://x/login?api_key=***`; an escaped quote or backslash never ends a
 *  quoted value);
 *  `Bearer x` / `Basic x` → `Bearer ***` when x is credential-shaped (≥ 8 chars with a digit, one
 *  of _ ~ + / =, a lower→upper change or an inner dot; prose keeps its words);
 *  `Authorization: <scheme> <value>` → `<scheme> ***` for any single scheme word; known token
 *  shapes keep their prefix — `ghp_…`, `gho_`/`ghu_`/`ghs_`/`ghr_`, `github_pat_…`, `glpat-…`,
 *  `xoxb-…` (xox[abposr]), `sk_live_…` / `sk_test_…`, `AIza…` → `<prefix>***`; webhook URLs whose
 *  path is the credential keep their host and fixed prefix — `https://hooks.slack.com/services/***`,
 *  `https://discord.com/api/webhooks/***` (discordapp.com too), `https://<tenant>.webhook.office.com/***`,
 *  `https://api.telegram.org/bot***`
 *  — and the same credentials without a host (an http fact keyed by its path):
 *  `/services/T…/B…/<token>` → `/services/***`, `/api/webhooks/<id>/<token>` → `/api/webhooks/***`,
 *  `/bot<id>:<token>` → `/bot***`, `/webhookb2/<guid>@<guid>/IncomingWebhook/<token>/…` → `/webhookb2/***`;
 *  AWS access key ids /(AKIA|ASIA)[0-9A-Z]{16}/ → 'AKIA***' / 'ASIA***'; a JWT anywhere → 'eyJ***';
 *  PEM blocks → '-----BEGIN ***-----';
 *  more token shapes (`rk_live_…`, `whsec_…`, `sk-proj-…` / `sk-ant-…` / `sk-…`, `npm_…`); credential
 *  query parameters with no secret word in their name (`?sig=`, `?code=`, `?key=`, `?jwt=`, `?session=`,
 *  `?sessionid=`, `?session_id=`, `?sid=`, `?ticket=`, `?subscription-key=` → `***`; `signature`
 *  and `account[_-]?key` are secret words: `X-Amz-Signature=***`, Azure `AccountKey=***`); a userinfo
 *  whose user holds '@' (Azure `user@server:pass@host`); Go MySQL DSNs `user:***@tcp(…)`, Oracle
 *  `jdbc:oracle:thin:user/***@…`, `curl -u user:***`, Python `auth=('u', '***')`; a secret-named
 *  header / setting passed as a pair `("X-API-KEY", "***")`, `<password>***</password>`,
 *  `key="…Secret" value="***"`; a whole-line `KEY=value` whose value runs to whitespace (a password
 *  holding `&`, `,` or `;`). A value under a locator-named key (…host, …address, …url, …endpoint,
 *  …port, …topic, …queue, …domain) shaped like a host[:port], a port or a path is kept:
 *  `AUTH_SERVICE_HOST=auth-svc` is what the map joins on.
 *  Idempotent: redactSecrets(redactSecrets(s)) === redactSecrets(s). Linear: every run is bounded.
 *  Non-strings are returned unchanged. */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(PEM_BLOCK, '-----BEGIN ***-----')
    .replace(PEM_LINE, '-----$1 ***-----')
    .replace(USERINFO, '$1***@')
    .replace(USER_TOKEN, '$1***@')
    .replace(NATS_USER, '$1***@')
    .replace(GO_DSN, '$1***$2')
    .replace(ORACLE, '$1***@')
    .replace(CLI_USER, '$1***')
    .replace(WEBHOOKS[0], '$1***')
    .replace(WEBHOOKS[1], '$1***')
    .replace(WEBHOOKS[2], '$1***')
    .replace(WEBHOOKS[3], '$1***')
    .replace(WEBHOOK_PATHS[0][0], WEBHOOK_PATHS[0][1])
    .replace(WEBHOOK_PATHS[1][0], WEBHOOK_PATHS[1][1])
    .replace(WEBHOOK_PATHS[2][0], WEBHOOK_PATHS[2][1])
    .replace(WEBHOOK_PATHS[3][0], WEBHOOK_PATHS[3][1])
    // AWS first: its '***' is a boundary AUTH_HEADER's \b and TOKEN's lookbehind must see in THIS pass (idempotency).
    .replace(AWS_KEY, '$1***')
    .replace(AUTH_HEADER, '$1 ***')
    .replace(AUTH_SCHEME, '$1$2 ***')
    .replace(TOKEN, (all, ...groups) => `${groups.slice(0, TOKEN_GROUPS).find((g) => typeof g === 'string')}***`)
    .replace(JWT, 'eyJ***')
    // After TOKEN: a glued token ahead of the call (`npm_…Buffer.from(`) is a boundary in THIS pass (idempotency).
    .replace(BASIC_ENCODED, '$1***$2')
    .replace(QUERY_CRED, '$1***')
    .replace(AUTH_TUPLE, (all, pre, _q, second, _q2, sep, third) => `${pre}${tupleLit(second)}${third ? `${sep}${tupleLit(third)}` : ''}`)
    .replace(HEADER_PAIR, (all, pre, q, k, q2, v) => (keep(v, k, { quoted: true }) || (TOPIC_VALUE.test(v) && !pairNamesCredential(k)) ? all : `${pre}${q2}***${q2}`))
    .replace(XML_KV, (all, open, k, v, close) => (keep(v, k) ? all : `${open}***${close}`))
    .replace(NAME_VALUE, (all, pre, q, k, q2, v) => (keep(v, k, { quoted: true }) ? all : `${pre}${q2}***${q2}`))
    .replace(LINE_KV, (all, pre, k, v, _q, offset, whole) => {
      if (keep(v, k, { whole: true }) || (/authorization$/i.test(k) && whole.startsWith(' ***', offset + all.length))) return `${pre}${keepUrl(v)}`;
      // `auth_channel = grpc.insecure_channel("auth-svc:50051")` is code, not a config value.
      if (/\s$/.test(pre) && codeValue(v)) {
        // A literal the whitespace cut leaves open (`password="my pass"`) ends no code run: its tail would be re-cut next pass.
        const run = codeRun(keepUrl(v), CREDENTIAL_NAME.test(k) && !CODE_VALUE.test(v));
        if (!/["'`]\*\*\*$/.test(run)) return `${pre}${run}`;
      }
      return `${pre}***`;
    })
    .replace(QUOTED_KV, (all, q, k, sep, q2, v) => (keep(v, k, { quoted: true }) ? `${q}${k}${q}${sep}${q2}${keepUrl(v)}${q2}` : `${q}${k}${q}${sep}${q2}***${q2}`))
    .replace(BARE_KV, (all, pre, k, sep, sp, q, qv, bare, offset, whole) => {
      if (q !== undefined) return keep(qv, k, { quoted: true }) ? `${pre}${k}${sep}${sp}${q}${keepUrl(qv)}${q}` : `${pre}${k}${sep}${sp}${q}***${q}`;
      // `Authorization: token ***`: the scheme word before an already-redacted credential stays.
      // The bare run stops at a quote: a plain call is judged on the text after it (`AuthClient("…")`).
      const at = offset + pre.length + k.length + sep.length;
      if (keep(bare, k) || (/\s$/.test(sep) && (CODE_VALUE.test(bare) || (PLAIN_CALL.test(whole.slice(at, at + 200)) && (/[()]$/.test(keepUrl(bare)) || /^[,;"'`]/.test(whole.slice(at + bare.length, at + bare.length + 1))))))
        || (/authorization$/i.test(k) && whole.startsWith(' ***', offset + all.length))) return `${pre}${k}${sep}${keepUrl(bare)}`;
      return `${pre}${k}${sep}***`;
    });
}

/** redactSecrets for a file's lines, one line at a time — and every line INSIDE a multi-line PEM
 *  block (after a line that opens it — `-----BEGIN X-----` alone, as the value of `key: ` / `KEY="`,
 *  or opening a source string: const key = `…, KEY = """…, key := `…, '-----BEGIN X-----\n' + —
 *  up to the line holding its `-----END X-----`) becomes '***', so a per-line reader (the verifier's
 *  cache, the lexer, extract's check of a static fact's cited line) never sees key material. Same
 *  length: line numbers stay valid. A non-array → []. */
export function redactLines(lines) {
  if (!Array.isArray(lines)) return [];
  let inPem = false;
  return lines.map((raw) => {
    const line = typeof raw === 'string' ? raw : '';
    if (inPem) {
      if (!PEM_CLOSE.test(line)) return '***';
      inPem = false;
      return redactSecrets(line);
    }
    if (PEM_OPEN.test(line)) inPem = true;
    return redactSecrets(line);
  });
}
