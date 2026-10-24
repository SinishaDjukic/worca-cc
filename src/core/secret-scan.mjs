// src/core/secret-scan.mjs
// ONE detector for text about to leave this machine (the team-memory gate, memory-team.mjs). It REPORTS — rule, kind,
// label, line — and never redacts; a finding never carries the matched text. Credential shapes are the redactors' own
// (workspace-map, Ask, chat, broker), imported rather than copied, so a shape added there guards the gate too. On top
// come what a teammate must not receive either: email addresses, private network addresses, internal host names and
// absolute home-directory paths, plus a credential-named key given a literal — the UPPER_SNAKE .env form
// (`DB_PASSWORD=…`), the config-file forms (`aws_secret_access_key = …`, `password: …`, `"client_secret": "…"`,
// `AccountKey=…`), the CLI-flag forms (`--password=…`, `-Dflyway.password=…`) and markdown's backticked value
// (`password: \`…\``) that a verification recipe copies, and the prose and table labels agent memory is written in
// (`API key: …`, `the admin password is …`, `| DB_PASSWORD | … |`), .netrc, `mysql -p…`, a bare AWS secret key and a
// labelled 64-hex key. The redactors' own key=value heuristics are not reused as
// such: they flag prose ("design tokens: `--space-*`") and this gate has no override, so a lower-case key/value finding
// also needs a value that looks like a secret, and a documentation placeholder (`YOUR_TOKEN`, `your-api-key-here`,
// `sk-xxxx`, `<token>`) is never one. Pattern matching, not a guarantee — like ask/redact.mjs, never claim more.
// Linear: input is capped and every pattern is bounded or a simple run.
import { CREDENTIAL_SHAPES } from '../shared/workspace-map/redact.mjs';
import { ASK_EXTRA_PATTERNS } from './ask/redact.mjs';
import { CHAT_TOKEN_SHAPES } from './chat/redact.mjs';
import { BROKER_TOKEN_RE } from './redact.mjs';

export const SECRET_SCAN_MAX_CHARS = 1024 * 1024;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const ANY_INTERNAL = '(?:internal|intranet|intra|corp|lan|local|localdomain|home\\.arpa)';
const STRONG_INTERNAL = '(?:internal|intranet|intra|corp|localdomain|home\\.arpa)';   // never an English word or a JS property
const NAME_END = '(?![\\w-]|\\.[A-Za-z0-9])';   // the host name ends here: `request.internal.auto` is a property chain

/** A documentation placeholder is never a credential: an UPPER_SNAKE word (`YOUR_TOKEN`, `PASSWORD`), a snake_case
 *  identifier (`access_token`), `your-…` / `my-…` / `example-…` / `dummy-…` / `changeme` words — whole words followed by
 *  words only, so a real password that merely starts with one (`Changeme2024`, `my_Xk9pLmQ2`) is still judged —, a run of x (`xxxxxxxx`,
 *  `sk-xxxx`), a bare secret word, a letters-only test value (`test-secret`, `dev-key`), a marker (`undefined`,
 *  `invalid`, `expired`), or a template (`<token>`, `${X}`, `$X`, `***`, `...`). */
const UPPER_WORDS = /^[A-Z]+(?:_[A-Z0-9]+)*$/;
const SNAKE_WORDS = /^[a-z]+(?:_[a-z]+)+$/;
const PLACEHOLDER_WORDS = /^(?:(?:your|my|example|sample|dummy|fake|replace(?:[-_]?me)?|change[-_]?me)[A-Za-z]*(?:[-_.][A-Za-z]+)*|(?:[A-Za-z0-9]{1,8}[-_])?x{3,}|pass(?:word|wd)?|secret|token|api[-_]?key|redacted|(?:test(?:ing)?|dev|local|demo)[a-z]*(?:[-_.][a-z]+)*|undefined|null|none|nil|invalid|expired|revoked|missing|unset|empty|bogus|wrong|garbage)$/i;
const TEMPLATE = /^(?:<[^>]*>|\$\{?[\w.]+\}?|\*+|\.{3}|…)$/;
/** An elided or already-redacted value (`ghp_...`, `sk-ant-…`, `[REDACTED]`, `***redacted***`) is documentation —
 *  a prefix of at most 16 characters before a closing ellipsis (a long real prefix cut short still counts). */
const ELIDED = /^[^\s.…]{0,16}(?:\.{3}|…)$|^\W*redacted\W*$/i;
const placeholderValue = (v) => UPPER_WORDS.test(v) || SNAKE_WORDS.test(v) || PLACEHOLDER_WORDS.test(v) || TEMPLATE.test(v) || ELIDED.test(v);
/** A reference to the environment is no credential (`$(…)` and `${…}` never start a value). */
const ENV_REF = /^(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|env)\b/i;
/** Code, not a literal: a call or a subscript (`getToken()`, `os.environ["X"]`, `config('X')`, `z.string().min(1)`) —
 *  a password with brackets in it (`yourStrong(!)Password`) is no call. */
const CODE_VALUE = /^[A-Za-z_][\w.]*(?:::[A-Za-z_][\w.]*)*(?:<[\w:, ]{1,64}>)?(?:\((?:["'`\w)$]|$)|\[)/;
/** A filler, a number, code, a reference or a placeholder is no credential. */
const notACredential = (v) => /^(.)\1*$/.test(v) || /^\d+$/.test(v) || CODE_VALUE.test(v) || ENV_REF.test(v) || placeholderValue(v);
/** Looks like a secret: letters AND digits (≥ 8 characters), or ≥ 20 characters of mixed case. */
const looksLikeSecret = (v) => (v.length >= 8 && /\d/.test(v) && /[A-Za-z]/.test(v)) || (v.length >= 20 && /[a-z]/.test(v) && /[A-Z]/.test(v));
/** A key named exactly `password` / `passwd` / `pwd` holds a password whatever it looks like: any literal of 6 or more
 *  characters counts (`password=hunter2`). A type or a setting word is none (`password: string`, `password: Required`,
 *  `password: Option<String>`); a letters-only word counts from 16 characters (`correcthorsebatterystaple`). */
const PASSWORD_NAME = /^(?:pass(?:word|wd)|pwd)$/i;
const passwordLiteral = (raw) => {
  const v = raw.replace(/[;,.]+$/, '');
  return v.length >= 6 && !notACredential(v) && !/^[A-Za-z_][\w.]*<[\w:, <>[\]]{1,64}>\??$/.test(v) && !(/^[A-Za-z][a-z]*$/.test(v) && v.length < 16);
};
/** The password of a `user:password` credential; a reference (`$GH_TOKEN`) or a placeholder is none. */
const passwordAllowed = (pw) => !pw || /^\$/.test(pw) || placeholderValue(pw);
const queryValue = (m) => m[0].slice(m[0].indexOf('=') + 1).split(/[&#,;]/)[0].replace(/[`'"]+$/, '');

/** Per-rule exceptions, keyed by rule id (the reused shapes are matched as the redactors wrote them). */
const ALLOW = {
  // `<user>:<password>@host`, `user:${PASS}@`, `postgres://user:password@localhost` are documentation — only the
  // password is judged, so `$` or `*` inside a real one (`app:Xy$9kLm@db`) no longer clears the URL.
  'url-credentials': (m) => { const u = m[0].slice(m[1].length, -1); return passwordAllowed(u.slice(u.indexOf(':') + 1)); },
  // `nats://<token>@host`, `nats://$NATS_TOKEN@host` are documentation and references, like a URL's password.
  'url-token': (m) => passwordAllowed(m[0].slice(m[1].length, -1)),
  'dsn-credentials': (m) => passwordAllowed(m[0].slice(m[1].length, m[2] ? m[0].length - m[2].length : -1)),
  // `?code=1`, "the `token=` flag", `token=getToken()`, `?key=${KEY}`, `?token=abc&page=2` are prose and code.
  // A parameter whose name holds no secret word (`?code=`, `?key=` — group 2 unset) needs 16 characters and no path:
  // `?code=WELCOME10` is a coupon, `?key=avatars/u1.png` an object key.
  'query-credential': (m) => { const v = queryValue(m); const named = m[2] !== undefined; return v.length < (named ? 8 : 16) || (!named && /^[\w.-]+(?:\/[\w.-]+)+$/.test(v)) || /^[$<{*]/.test(v) || v.includes('...') || /[()[\]]/.test(v) || ENV_REF.test(v) || placeholderValue(v); },
  // chat/redact.mjs's xapp- shape takes any length; a real app-level token is long ("xapp-level" is prose).
  'slack-app-token': (m) => m[0].length < 20,
  // `docker run -u 1000:1000` is a uid:gid, `-u "$USER:$TOKEN"` a reference, `-u USERNAME:PASSWORD` a placeholder.
  'cli-credentials': (m) => { const pw = m[0].slice(m[1].length); return /^\d+$/.test(pw) || passwordAllowed(pw); },
  // `Bearer YOUR_TOKEN` is documentation.
  'auth-header': (m) => { const v = m[0].slice(m[1].length).trim(); return placeholderValue(v) || /^[a-z]+(?:\/[A-Za-z]+\d?)+[.,;:]?$/.test(v); },   // "Basic auth/OAuth2" is prose
  'basic-credentials': (m) => passwordAllowed(m[0].slice(m[1].length, -1)),
  // Any other scheme (`Authorization: Token <hex>`, `SSWS …`): only a value that looks like a secret ("the
  // Authorization: Token header" is prose).
  'auth-scheme': (m) => { const v = m[0].slice(m[1].length + m[2].length).trim(); return notACredential(v) || !looksLikeSecret(v); },
};

const QUOTE = '["\'`]?';
/** A value never STARTS with `$`, `<` or `{` (`${X}`, `$(cmd)`, `<password>`, `{{ x }}` are references and
 *  templates), but may hold them (`Xy$9kLmN2pQr`); a quote or a backtick ends it. */
const value = (min) => `((?![$<{])[^\\s"'\`]{${min},256})`;
/** A name never starts inside an identifier or a dotted chain; a CLI flag's dashes (`--password=`, `-Dflyway.password=`,
 *  `-PossrhPassword=`) may come first. */
const FLAG = '(?<![\\w.-])(?:--?|-[DP])?';
const ENV_TAIL = '(?:_(?:PROD|PRODUCTION|STAGING|STAGE|DEV|TEST|QA|UAT|LIVE|LOCAL|CI|V?\\d{1,3}))?';
const ENV_NAME = `${FLAG}((?:[A-Z][A-Z0-9_]{0,127})?(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH_?KEY|MASTER_?KEY|ENCRYPTION_?KEY|SIGNING_?KEY|(?<![A-Z0-9])(?:PASS|AUTH))(?:_(?:KEY(?:_BASE)?|VALUE|B64|BASE64|STR))?${ENV_TAIL})`;
/** A loose name — PASS or AUTH alone, or a name with an environment suffix — counts only with a value that looks like
 *  a secret (`FIRST_PASS=complete`, `PASSWORD_TEST=enabled` stay clean). */
const LOOSE_NAME = /(?:^|_)PASS(?:_|$)|_(?:PROD|PRODUCTION|STAGING|STAGE|DEV|TEST|QA|UAT|LIVE|LOCAL|CI|V?\d{1,3})$/;
/** An `auth` name holds base64 (docker's `"auth": "<base64>"`, `.npmrc`'s `_auth=…`), a `user:password` pair
 *  (`BASIC_AUTH=…`) or a long secret (`?auth=…`); anything else under it is a setting (`enable_auth=gate-53915106`). */
const AUTH_NAME = /(?<![a-z0-9])auth(?:[_-]?(?:prod|production|staging|stage|dev|test|qa|uat|live|local|ci|v?\d{1,3}))?$/i;
const authValue = (v) => /^[A-Za-z0-9+/]{16,}={0,2}$/.test(v) || /^[^:\s]{1,64}:\S{6,}$/.test(v);
/** UPPER_SNAKE: any literal after `=`; after `:` (YAML, prose), or under a loose name, only one that looks like a
 *  secret (`GITHUB_TOKEN: required` stays clean). */
const envAllowed = ([, name, sep, v]) => (name === 'PASS' && sep === ':') || notACredential(v)   // `--- PASS: TestV2` is a test verdict
  || (AUTH_NAME.test(name) ? !authValue(v) : (sep === ':' || LOOSE_NAME.test(name)) && !looksLikeSecret(v));
/** Lower-case, camelCase and quoted keys — the config-file forms (`aws_secret_access_key = …`, `password: …`,
 *  `"client_secret": "…"`, `apiKey: '…'`, `AccountKey=…`, `_authToken=…`, docker's `"auth": "…"`, `db_pass=…`) the
 *  redactors' key=value heuristics catch. */
const KV_NAME = `${FLAG}${QUOTE}((?:[A-Za-z_][\\w.-]{0,127}?)?(?:pass(?:word|wd|phrase)|(?<![a-z0-9])pass|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|account[_-]?key|master[_-]?key|encryption[_-]?key|signing[_-]?key|signature|(?<![a-z0-9])auth)(?:[_-]?(?:key(?:[_-]?base)?|value|b64|base64|str))?(?:[_-]?(?:prod|production|staging|stage|dev|test|qa|uat|live|local|ci|v?\\d{1,3}))?)${QUOTE}`;
/** `:=` / `?=` (Go, Make) assign like `=`; markdown bold may wrap the separator (`**Password:** …`); column-aligned
 *  config pads it with a run of spaces or tabs (`DB_PASSWORD     = …`, `password:      …`). */
const SEP = '(?:\\*{1,2})?\\s{0,32}(:=|\\?=|[=:])(?:\\*{1,2})?\\s{0,32}';
/** Only a value that looks like a secret counts. A reference, a filler, a placeholder, a path, a URL or a dotted code
 *  chain is none (`= session.accessToken`, `secret_key: "sk_test_dummy"`). A value ends where the next `name=` starts
 *  (`token=abc,page=2`), and in a URL query at the next parameter (`?token=abc&page=2`). */
const kvAllowed = (m) => {
  const [, name, sep, raw] = m;   // groups: name, separator, value
  const inQuery = /[?&]/.test(m.input[m.index - 1] || '');
  const v = inQuery ? raw.split(/[&#,;]/)[0] : raw.split(/[&,;](?=[\w.-]{1,64}=)/)[0];
  // An allowed value may hold a second pair: scanning resumes after its first `&`, `,` or `;` (`#` too in a URL query)
  // — `?token=abc&secret=…`, `--set a.token=x,a.password=…`, `password: see_vault,token: …`.
  const cut = raw.search(inQuery ? /[&#,;]/ : /[&,;]/);
  if (cut >= 0) m.resume = m.index + m[0].length - raw.length + cut + 1;
  return (name === 'PASS' && sep === ':') || (/signature/i.test(name) && !inQuery)   // a signature is a credential only in a signed URL
    || /:secretsmanager:[\w-]*:\d{12}:$/.test(m.input.slice(Math.max(0, m.index - 80), m.index))   // an ARN's `:secret:<name>`
    || notACredential(v) || /^--[a-z]/.test(v)   // `--space-4x8` is a CSS variable
    || /^(?:\/|\.\/|~\/)/.test(v) || /^[a-z0-9_.-]+(?:\/[a-z0-9_.*-]+)+$/.test(v) || v.includes('://') || /^[A-Za-z_$]+(?:\.[A-Za-z_$]+)+$/.test(v)
    || (PASSWORD_NAME.test(name) ? !passwordLiteral(v) : AUTH_NAME.test(name) ? !authValue(v) : !looksLikeSecret(v));
};
/** Prose and table labels (M2): agent memory is prose, so a secret word may carry up to two words (`API key: …`,
 *  `Secret Key: …`, `password for prod: …`) and be followed by `is`, `->`, `—` or a table pipe (`| DB_PASSWORD | … |`)
 *  as well as `:` / `=`. The key/value verdict applies (kvAllowed); after a prose separator only a value that looks
 *  strongly like a secret counts — a password name judges any literal — so "the token is valid" stays prose. */
const PROSE_WORD = '(?<![A-Za-z0-9])(pass(?:word|wd|phrase)|pwd|secret|token|(?:api|access|private|signing|encryption|master|hmac)[ _-]?key)(?:[ _-]?(?:access[ _-]?)?key)?(?![A-Za-z0-9])';
const PROSE_SEP = '(?:\\s{0,4}(?:\\*{1,2})?\\s{0,4}(:|=|->|=>|→|—|–|\\|)(?:\\*{1,2})?\\s{0,32}|\\s{1,4}(is|was|equals)\\s{1,32})';
const PROSE_VALUE = '((?![$<{])[^\\s"\'`|]{6,256})';
/** Letters AND digits over 10+ characters with mixed case or 16+ characters, or 20+ characters of mixed case. */
const strongSecret = (v) => (v.length >= 10 && /\d/.test(v) && /[A-Za-z]/.test(v) && ((/[a-z]/.test(v) && /[A-Z]/.test(v)) || v.length >= 16))
  || (v.length >= 20 && /[a-z]/.test(v) && /[A-Z]/.test(v));
const proseAllowed = (m, name, sep, raw) => {
  const k = Object.assign([m[0], name, sep === ':' || sep === '=' ? sep : '=', raw], { index: m.index, input: m.input });
  const allowed = kvAllowed(k);
  if (k.resume) m.resume = k.resume;
  const v = raw.replace(/[;,.]+$/, '');
  return allowed || (sep !== ':' && sep !== '=' && !PASSWORD_NAME.test(name.replace(/[ _-]?(?:access[ _-]?)?key$/i, '')) && !strongSecret(v));
};
/** A window of the line around a match: a per-match check never reads the whole (≤ 1 MiB) line. */
const around = (m, n) => m.input.slice(Math.max(0, m.index - n), m.index + m[0].length + n);
// Kotlin's `this@MainActivity.x` is a label; a service account (`…@…gserviceaccount.com`) is no person.
const EMAIL_OK = /^(?:noreply|no-reply|git|this|super)@|@(?:(?:[\w-]+\.)*example\.(?:com|org|net)|users\.noreply\.github\.com|(?:[\w-]+\.)*gserviceaccount\.com|(?:[\w-]+\.)*(?:test|example|invalid|localhost))$/i;
/** A login, not an address: a URL's user-only userinfo (`https://contoso@dev.azure.com/…`) or the target of an ssh /
 *  scp / rsync command whose other arguments are flags, paths or numbers ("ssh keys belong to bob@…" is prose). */
const LOGIN_BEFORE = /(?::\/\/|(?:^|[\s`(])(?:ssh|scp|sftp|rsync|mosh)\s+(?:(?:-\S*|\S*[./]\S*|\d+)\s+){0,6})$/;
const HOME_OK = /^(?:Shared|Public|Default|user|username|you|your[\w-]*|me|runner|runneradmin|RUNNER|name|example|someone|USER|USERNAME|node|ubuntu|ec2-user|vscode|codespace|app|circleci|linuxbrew|pi|azureuser|vsts|VssAdministrator|jenkins|gitlab-runner|gitpod|coder|pwuser|ContainerAdministrator|ContainerUser)$/;
/** Names and addresses every machine shares (Docker Desktop, the cloud metadata services, Docker's default bridge, the
 *  Android emulator's host) name no infrastructure of this team; nor does a code chain (`this.props.internal`). */
const GENERIC_HOST = /^(?:(?:host|gateway|kubernetes)\.docker\.internal|metadata\.google\.internal|(?:host|gateway)\.(?:containers|minikube|lima|testcontainers|k3d)\.internal)$/i;
const CODE_ROOT = /^(?:this|self|module|exports|window|document|globalThis|global|process|props|state|ctx|req|res)\./;
/** A package or namespace declaration opening a line (`package com.acme.shop.internal;`, `namespace Acme.Shop.Internal;`,
 *  `from shop.payments.internal import x`) — "pull logs from logs.prod.internal" is prose. */
const CODE_DECL = /^\s*(?:[-*]\s+)?`?(?:package|import|namespace|using|module)\s+$/;
const codeDecl = (m) => CODE_DECL.test(m.input.slice(0, m.index))
  || (/^\s*(?:[-*]\s+)?`?from\s+$/.test(m.input.slice(0, m.index)) && /^\s+import\b/.test(m.input.slice(m.index + m[0].length)));
const GENERIC_IP = new Set(['169.254.169.254', '169.254.170.2', '172.17.0.1', '10.0.2.2', '10.0.2.3', '10.0.2.15', '10.96.0.1', '10.96.0.10', '192.168.49.2', '100.100.100.100']);
/** A wide range (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) is documentation, not a host; a /24 subnet still counts. */
const wideRange = (m) => { const t = /^\/(\d{1,2})(?!\d)/.exec(m.input.slice(m.index + m[0].length)); return !!t && Number(t[1]) <= 16; };

const RULES = [
  ...CREDENTIAL_SHAPES.map(([rule, label, re]) => ({ rule, kind: 'secret', label, re, allow: ALLOW[rule] || null })),
  // ask/redact.mjs's PEM block pattern is quadratic on an unterminated BEGIN; the line-local marker below replaces it.
  ...ASK_EXTRA_PATTERNS.filter(([re]) => !re.source.includes('PRIVATE KEY')).map(([re]) => ({ rule: 'api-token', kind: 'secret', label: 'an API token', re })),
  ...CHAT_TOKEN_SHAPES.map(([rule, label, re]) => ({ rule, kind: 'secret', label, re, allow: ALLOW[rule] || null })),
  // chat/redact.mjs also removes a bot token glued to `bot` (a Bot API path without its slash), with a pattern too broad
  // for a gate that has no override (`bot\d+:…`): here the id and the token are as long as its TELEGRAM_TOKEN_RE wants.
  { rule: 'telegram-bot-token', kind: 'secret', label: 'a Telegram bot token', re: /bot\d{6,}:[A-Za-z0-9_-]{30,}/ },
  { rule: 'broker-token', kind: 'secret', label: 'a worca broker token', re: BROKER_TOKEN_RE },
  { rule: 'env-credential', kind: 'secret', label: 'a credential assigned to a variable', allow: envAllowed,
    re: new RegExp(`${ENV_NAME}${SEP}${QUOTE}${value(6)}`) },
  { rule: 'kv-credential', kind: 'secret', label: 'a credential in a key/value pair', allow: kvAllowed,
    re: new RegExp(`${KV_NAME}${SEP}${QUOTE}${value(6)}`, 'i') },
  // Prose and table labels: `API key: …`, `the admin password is …`, `password -> …`, `| DB_PASSWORD | … |` …
  { rule: 'prose-credential', kind: 'secret', label: 'a credential named in prose', allow: (m) => proseAllowed(m, m[1], m[2] ?? m[3], m[4]),
    re: new RegExp(`${PROSE_WORD}(?:\\s{1,4}[A-Za-z][\\w-]{0,19}){0,2}${PROSE_SEP}${QUOTE}${PROSE_VALUE}`, 'i') },
  // … and the value first: "use `…` as the admin password".
  { rule: 'prose-credential', kind: 'secret', label: 'a credential named in prose',
    allow: (m) => { const v = m[2]; return notACredential(v) || (PASSWORD_NAME.test(m[3]) ? !passwordLiteral(v) : !strongSecret(v)); },
    re: new RegExp(`([\`'"])((?![$<{])[^\\s"'\`]{6,256})\\1\\s{1,4}as\\s{1,4}(?:(?:the|a|an|our|my|your)\\s{1,4})?(?:[A-Za-z][\\w-]{0,19}\\s{1,4}){0,2}${PROSE_WORD}`, 'i') },
  // .netrc: `machine h login bob password …`, or `password …` on its own line.
  { rule: 'netrc-credential', kind: 'secret', label: 'a password in a .netrc entry', allow: (m) => !passwordLiteral(m[1]),
    re: new RegExp(`(?:(?<![\\w-])machine\\s{1,32}\\S{1,253}\\s{1,32}|(?<![\\w-])login\\s{1,32}\\S{1,256}\\s{1,32}|^\\s{0,32})password\\s{1,32}${value(6)}`) },
  // A password glued to `-p` (`mysql -uroot -p…`, `sshpass -p…`): only on a mysql / mariadb / sshpass line or next to a
  // `-u` user (`mkdir -p`, `-pthread`, `ssh -p2222` are flags).
  { rule: 'cli-password', kind: 'secret', label: 'a password given on the command line',
    allow: (m) => notACredential(m[1]) || !looksLikeSecret(m[1]) || !/mysql|mariadb|sshpass|(?<![\w-])-u\s?\S/i.test(around(m, 200)),
    re: new RegExp(`(?<![\\w-])-p${QUOTE}${value(6)}`) },
  // A bare AWS secret access key (40 characters of base64, mixed case) on a line that says aws or secret; a git SHA
  // (lower-case hex) is none.
  { rule: 'aws-secret-key', kind: 'secret', label: 'an AWS secret access key',
    allow: (m) => !(/[a-z]/.test(m[0]) && /[A-Z]/.test(m[0]) && /[\d/+]/.test(m[0])) || !/aws|secret/i.test(around(m, 120)),
    re: /(?<![\w/+=.:-])[A-Za-z0-9/+]{40}(?![\w/+=.-])/ },
  // A 64-hex signing key labelled as a key or a secret; a SHA-256 digest (a hash, a checksum, an integrity line) is none.
  { rule: 'hex-key', kind: 'secret', label: 'a hex signing key',
    allow: (m) => !/(?<![a-z])(?:key|secret)s?(?![a-z])/i.test(m.input.slice(Math.max(0, m.index - 80), m.index)) || /\bsha(?:-?\d{1,3})?\b|hash|digest|checksum|integrity|fingerprint|commit/i.test(around(m, 80)),
    re: /(?<![A-Za-z0-9])(?:[0-9a-f]{64}|[0-9A-F]{64})(?![A-Za-z0-9])/ },
  // Provider prefixes no redactor knows yet: DigitalOcean (`dop_v1_`, `doo_v1_`, `dor_v1_`) and Twilio API keys (`SK`).
  { rule: 'api-token', kind: 'secret', label: 'an API token', re: /(?<![A-Za-z0-9])do[opr]_v1_[a-f0-9]{64}(?![A-Za-z0-9])|(?<![A-Za-z0-9])SK[0-9a-f]{32}(?![A-Za-z0-9])/ },
  // A certificate is public; a PGP armor says `PRIVATE KEY BLOCK`. Base64 of the armor (kubeconfig `client-key-data:`,
  // a Secret's `tls.key:`) starts `LS0tLS1CRUdJTi` and spells PRIVATE KEY in one of three alignments.
  { rule: 'private-key', kind: 'secret', label: 'a private key block', re: /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY(?: BLOCK)?-----|LS0tLS1CRUdJTi[A-Za-z0-9+/]{0,40}?(?:UFJJVkFURSBLRV|QUklWQVRFIEtFW|BSSVZBVEUgS0VZ)/ },
  // `$CI_JOB_TOKEN@gitlab.com` is a reference and `https://user:pw@host`'s `pw@host` a URL's password (url-credentials
  // judges it), not an address.
  { rule: 'email', kind: 'personal', label: 'an email address',
    allow: (m) => { if (EMAIL_OK.test(m[0]) || m.input[m.index - 1] === '$') return true; const before = m.input.slice(Math.max(0, m.index - 300), m.index); return /:\/\/[^\s/@]*:$/.test(before) || LOGIN_BEFORE.test(before); },
    re: /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,8}[A-Za-z]{2,24}(?![\w-]|\.[A-Za-z0-9])/ },
  { rule: 'private-ip', kind: 'internal', label: 'a private network address', allow: (m) => GENERIC_IP.has(m[0]) || /^172\.17\.0\.\d$/.test(m[0]) || wideRange(m),   // RFC 1918, link-local, CGNAT; loopback is not private here
    re: new RegExp(`(?<![\\d.])(?:10\\.${OCTET}|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168|169\\.254|100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7]))\\.${OCTET}\\.${OCTET}(?!\\d|\\.\\d)`) },
  // IPv6 unique-local (fc00::/7) — a team's own network, like RFC 1918; `fd00::/8` as a range is documentation.
  { rule: 'private-ip', kind: 'internal', label: 'a private network address', allow: wideRange,
    re: /(?<![\w:.])f[cd][0-9a-f]{2}:(?:[0-9a-f]{0,4}:){1,6}[0-9a-f]{0,4}(?![\w:])/i },
  { rule: 'internal-host', kind: 'internal', label: 'an internal host name',   // in a URL / after @ / before :port — or a bare name of 3+ labels
    allow: (m) => { const h = m[0].replace(/^(?:\/\/|@)/, '').replace(/:\d+$/, ''); return GENERIC_HOST.test(h) || CODE_ROOT.test(h) || /(?:^|\.)example\.(?:com|org|net)$/i.test(h)
      || (!/^(?:\/\/|@)|:\d+$/.test(m[0]) && codeDecl(m)); },
    // …and, in a URL, an internal label under a public suffix (`https://grafana.internal.acme.io`, `//jenkins.corp.acme.com`)
    re: new RegExp(`(?:\\/\\/|@)(?:${LABEL}\\.){1,8}${ANY_INTERNAL}${NAME_END}|\\/\\/(?:${LABEL}\\.){1,6}${STRONG_INTERNAL}\\.(?:${LABEL}\\.){0,4}[a-z]{2,24}${NAME_END}|(?<![\\w.-])(?:${LABEL}\\.){1,8}${ANY_INTERNAL}:\\d{1,5}(?!\\d)|(?<![\\w.-])(?:${LABEL}\\.){2,8}${STRONG_INTERNAL}${NAME_END}`, 'i') },
  // An absolute path only: `lib/features/home/x.dart`, `com/acme/home/MainActivity.kt`, `https://shop.test/home/x` and
  // `Views/Users/Index.cshtml` name a folder, not a person; `/mnt/c/Users/…`, `/c/Users/…`, `/host_mnt/Users/…` still count.
  { rule: 'home-path', kind: 'machine', label: 'a home-directory path', allow: (m) => HOME_OK.test(m[1].replace(/\.+$/, '')),   // a sentence's full stop is no part of the name
    re: /(?:(?<![\w.~)\]}-])(?:\/(?:mnt\/)?[a-z]|\/host_mnt)?\/Users\/|(?<![\w.~)\]}-])\/home\/|\b[A-Za-z]:\\{1,2}[Uu]sers\\{1,2})([A-Za-z0-9][A-Za-z0-9._-]{0,63})/ },
].map((r) => ({ ...r, re: new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : `${r.re.flags}g`) }));   // own /g copies: exec with lastIndex, never shared

/**
 * @param {string} text
 * @returns {Array<{rule:string, kind:'secret'|'personal'|'internal'|'machine', label:string, line:number}>} in line order,
 *   at most one `secret` finding and one of each other rule per line, ≤ 50 in all. Over SECRET_SCAN_MAX_CHARS the text
 *   is refused whole (`too-large`, line 0).
 */
export function scanSecrets(text) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (s.length > SECRET_SCAN_MAX_CHARS) return [{ rule: 'too-large', kind: 'secret', label: `text over ${SECRET_SCAN_MAX_CHARS} characters (too large to check)`, line: 0 }];
  const out = [];
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < 50; i++) {
    const line = lines[i];
    if (!line.trim()) continue;   // nothing to find; ~40 patterns per blank line add up on a long note
    const seen = new Set();
    for (const r of RULES) {
      const slot = r.kind === 'secret' ? 'secret' : r.rule;
      if (seen.has(slot)) continue;
      // exec with lastIndex, not matchAll: matchAll clones the RegExp on every call (one per rule per line).
      r.re.lastIndex = 0;
      for (let m = r.re.exec(line); m; m = r.re.exec(line)) {
        if (!m[0]) { r.re.lastIndex++; continue; }   // never loop on an empty match
        if (r.allow && r.allow(m)) { if (m.resume) r.re.lastIndex = m.resume; continue; }
        out.push({ rule: r.rule, kind: r.kind, label: r.label, line: i + 1 });
        seen.add(slot);
        break;
      }
    }
  }
  return out;
}

/** One line for a blocked-note record: "line 4: an email address; the description: a JWT; +2 more". */
export function describeFindings(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const where = (f) => (f.field && f.field !== 'body' ? `the ${f.field}` : f.line ? `line ${f.line}` : 'the note');
  const parts = list.slice(0, 3).map((f) => `${where(f)}: ${f.label}`);
  return parts.length ? `${parts.join('; ')}${list.length > 3 ? `; +${list.length - 3} more` : ''}` : '';
}
