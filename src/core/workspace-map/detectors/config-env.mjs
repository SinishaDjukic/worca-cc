// config-env: .env / .env.* / *.env, Spring application*.{yml,yaml,properties} and
// bootstrap*, .NET appsettings*.json (JSON with comments), config/*.{json,yml,yaml}.
// Every (key, value) is flattened to a dotted key and classified:
//   spring.application.name                          → alias (source 'spring')
//   spring.cloud.stream.bindings.<b>.destination     → topic: <b> ending -out-N / output
//                                                      provides, -in-N / input consumes,
//                                                      else unresolved (THIS detector owns
//                                                      Spring Cloud Stream; P4 messaging
//                                                      does not read config files)
//   spring.kafka.template.default-topic               → provides topic
//   SQS queue URL                                     → consumes topic <queue name>
//   key containing 'topic' / 'queue', simple value    → consumes topic (heuristic) — never a key
//                                                      ending in a secret word (QUEUE_PASSWORD,
//                                                      KAFKA_TOPIC_API_KEY): its value is a credential
//   anything else                                     → lib/urls classifyValue (service /
//                                                      http / db consumes); an http path with no
//                                                      usable host targets the config key (heuristic)
//   a placeholder in a peer-looking key (*_URL, *host) → unresolved
// Kubernetes manifests and compose files are left to deploy-k8s / deploy-compose.
import { posix } from 'node:path';
import { splitLines, fact, blankComments, onePerKey, cleanUnresolved, isSamplePath, memberForImage, hasCode } from './lib/text.mjs';
import { isTestPath } from '../files.mjs';
import { loadYaml, walkScalars, yamlProblem } from './lib/yaml.mjs';
import { classifyValue, isPlaceholder, PEER_KEY_RE, shellTarget, unresolvedValue } from './lib/urls.mjs';
import { COMPOSE_FILE_RE } from './deploy-compose.mjs';

// The value is `[^]*` and trimmed in code: a lone \r (U+2028/2029) ends `.` but not the line, so
// `\s*=\s*(.*)$` retried every split of a whitespace run (quadratic; cubic for PROP_RE) and a file
// with \r\r\n line ends lost every pair.
const ENV_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]{0,200})\s*=([^]*)$/;
const PROP_RE = /^\s*([^#!\s=:][^=:\s]{0,300})\s*[=:\s]([^]*)$/;
const BINDING_RE = /^spring\.cloud\.stream\.bindings\.([^.]+)\.destination$/;
const SQS_RE = /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/\d+\/([A-Za-z0-9_.-]{1,80})$/;
const TOPIC_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/*#>]{0,248}$/;
// The topic rule fails CLOSED on credentials: a value under a key that holds a credential word anywhere
// (`QUEUE_PASSWORD`, `EVENTS_TOPIC_HMAC`, `…_QUEUE_PASSWORD_2`, `orders.queue.apikey.v2`) would become the
// fact's key — which no redaction recognises without the key beside it. Only a key whose last word names
// the topic itself (`PASSWORD_RESET_TOPIC`, `auth.queue.name`), or whose credential word is followed by an
// event word (`topics.password-reset`, `session-expired`), keeps its value; a key whose last word is an
// attribute (`QUEUE_HOST`, `SQS_QUEUE_REGION`, `KAFKA_TOPIC_PARTITIONS`) never names a topic.
const TOPIC_WORDS = new Set(['topic', 'topics', 'queue', 'queues', 'name', 'names', 'destination', 'exchange', 'subject', 'channel', 'stream']);
const ATTRIBUTE_WORDS = new Set(['host', 'hostname', 'port', 'url', 'uri', 'endpoint', 'addr', 'address', 'region', 'timeout', 'type', 'provider',
  'prefix', 'suffix', 'size', 'count', 'enabled', 'partitions', 'replicas', 'retries', 'ttl', 'delay', 'concurrency', 'arn', 'id', 'group',
  'user', 'username', 'mode', 'version', 'format']);
const CREDENTIAL_WORDS = new Set(['pw', 'pwd', 'passphrase', 'passcode', 'auth', 'authorization', 'cred', 'creds', 'hmac', 'sas', 'sig', 'signature',
  'jwt', 'conn', 'connection', 'cert', 'certificate', 'private', 'salt', 'seed', 'psk', 'cipher', 'nonce', 'bearer', 'session', 'cookie', 'otp',
  'keystore', 'truststore']);
// An event about a credential (`password-reset`, `session-expired`, `token-revoked`) is a topic name: a
// credential word followed by one of these does not count.
const EVENT_WORDS = new Set(['reset', 'resets', 'expired', 'expiry', 'revoked', 'revocation', 'created', 'changed', 'change', 'updated', 'deleted',
  'rotated', 'rotation', 'issued', 'refreshed', 'refresh', 'requested', 'request', 'requests', 'event', 'events', 'notification',
  'notifications', 'audit', 'verified', 'verification', 'confirmed', 'failed', 'locked',
  'started', 'start', 'ended', 'stopped', 'completed', 'cancelled', 'canceled', 'closed', 'opened', 'login', 'logins', 'logout',
  'signin', 'signout', 'signup', 'usage', 'status', 'sync', 'decisions', 'messages', 'cleanup', 'emails', 'sms', 'consent',
  'renewal', 'renewed', 'expiring', 'granted', 'denied', 'invalidated', 'generated', 'sent', 'received', 'alerts']);
const CREDENTIAL_WORD_RE = /^(?:pass|secret|token|cred)|(?:pass|password|passwd|secret|secrets|token|tokens|key|keys)$/;
/** Words of a config key: split at separators and camelCase humps, version / counter segments dropped. */
const keyWords = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^v?\d+$/.test(w));
/** `started` / `start`, `emails` / `email`: a word without its plural and -ed / -ing ending. */
const stem = (w) => (w.length <= 3 ? w : w.replace(/s$/, '').replace(/(?:ed|ing)$/, ''));
function topicKey(key, value = '') {
  if (!/topic|queue/i.test(key)) return false;
  const words = keyWords(key);
  const last = words[words.length - 1] ?? '';
  if (TOPIC_WORDS.has(last) || /(?:topic|queue)s?$/.test(last)) return true;
  if (ATTRIBUTE_WORDS.has(last)) return false;
  // a counter glued to a credential word (`API_KEY2`, `hmac1`, `apiKey2`) still names the credential
  const cred = (w) => { const b = w.replace(/(?<=[a-z])\d+$/, ''); return CREDENTIAL_WORDS.has(b) || CREDENTIAL_WORD_RE.test(b); };
  // …and the event only when the value names it too (`auth.password-reset`, `session.started`): an event noun is also
  // a queue's name, so a per-queue credential suffixed by it (`QUEUE_PASSWORD_EMAILS`, `TOPIC_SAS_KEY_AUDIT`) holds a secret.
  const named = keyWords(value).map(stem);
  // A value word names the event through a shared 4–5-letter stem (`change` / `changed`) only when it is a word — letters only, at
  // most 4 letters past the stem —, never a password built from the queue's name (`emails2024`, `Auditsecrets`).
  const names = (x) => { const e = stem(x); return named.some((v) => { if (v === e) return true; const n = Math.min(5, v.length, e.length); return n >= 4 && /^[a-z]+$/.test(v) && v.length <= e.length + 4 && v.slice(0, n) === e.slice(0, n); }); };
  // right to left, one pass (a 450 KB JSON key of credential words took 59 s as a scan of every word's tail)
  let licensed = false;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (!licensed && cred(words[i])) return false;
    if (!licensed && EVENT_WORDS.has(words[i]) && names(words[i])) licensed = true;
  }
  return true;
}
// OpenAPI / AsyncAPI documents are the spec detectors' (a spec under config/ is not configuration: its
// servers and `example` URLs are no calls of this member).
const SPEC_RE = /(?:^|[{,])[ \t]*["']?(?:openapi|swagger|asyncapi)["']?[ \t]*:[ \t]*["']?[23]\./m;
/** The module directory of a Spring config file (the directory holding its `src/main/resources`; '' at the
 *  member root): a nested module's `spring.application.name` aliases the member only with a multi-word
 *  name, like a nested manifest (P3-10). */
const springModule = (rel) => { const i = rel.search(/(?:^|\/)src\/main\/resources\//); return i <= 0 ? '' : rel.slice(0, i); };

function unquote(v) {
  const t = v.trim();
  if (/^"[^]*"$/.test(t) || /^'[^]*'$/.test(t)) return t.slice(1, -1);
  return t.replace(/[ \t]#[^]*$/, '').trimEnd();
}

/** Flattened (key, value, line) pairs of one config file (+ parse errors). Exported for the P4 db
 *  detector, which reads datasource names from the same files. */
export function configPairs(rel, text) {
  const base = posix.basename(rel);
  const out = [];
  if (/\.properties$/i.test(base) || /(^|\.)env$|^\.env(\..*)?$/i.test(base)) {
    const isEnv = !/\.properties$/i.test(base);
    splitLines(text).forEach((line, i) => {
      if (/^\s*[#!]/.test(line) || !line.trim()) return;
      const m = (isEnv ? ENV_RE : PROP_RE).exec(line);
      if (m) out.push({ key: m[1], value: isEnv ? unquote(m[2]) : m[2].trim(), line: i + 1 });
    });
    return { pairs: out, errors: [] };
  }
  const json = /\.json$/i.test(base);
  const src = json ? blankComments(text, { slash: true, quotes: '"' }) : text;
  if (!json && /^apiVersion\s*:/m.test(src) && /^kind\s*:/m.test(src)) return { pairs: [], errors: [] };
  if (SPEC_RE.test(src)) return { pairs: [], errors: [] };
  const y = loadYaml(src, { json });
  const budget = {}; // one walk budget for every document of the file (lib/yaml walkScalars)
  for (const { doc, root } of y.docs) {
    const cut = walkScalars(y, doc, root, ({ path, value, line }) => {
      if (value == null || typeof value === 'object') return;
      out.push({ key: path.join('.'), value: String(value), line });
    }, budget);
    if (cut) { y.errors.push('config too large'); break; }
  }
  const problem = yamlProblem(y);
  return { pairs: out, errors: problem ? [problem] : [] };
}

// A member without code (lib/text hasCode: a deploy repo of compose files, manifests, a `.env` and tooling)
// runs nothing that reads a `.env`: one beside a compose file is that stack's interpolation file, whose values
// configure the containers of the services it deploys (other members), never calls of this member —
// …but a Dockerfile beside the .env means the stack runs this member's own image (an nginx / Envoy gateway, Kafka
// Connect, Keycloak configured through it): its .env configures this member.
const DOCKERFILE_RE = /(?:^|\/)(?:(?:Dockerfile|Containerfile)(?:\.[\w.-]+)?|[\w.-]+\.(?:Dockerfile|Containerfile))$/i;
/** The basenames of the member's files per directory, built once per member (a scan of the listing per claimed
 *  file took 6.5 s for 2 500 claimed dirs in a 50 000-file listing). */
function dirFiles(ctx) {
  const st = ctx.state || {};
  if (!st.dirFiles) {
    st.dirFiles = new Map();
    for (const f of ctx.files) {
      if (typeof f !== 'string') continue;
      const d = posix.dirname(f);
      const list = st.dirFiles.get(d);
      if (list) list.push(posix.basename(f)); else st.dirFiles.set(d, [posix.basename(f)]);
    }
  }
  return st.dirFiles;
}
function stackEnv(rel, ctx) {
  if (!/^\.env(?:\.[\w.-]+)?$|^[\w.-]+\.env$/i.test(posix.basename(rel)) || !Array.isArray(ctx?.files)) return false;
  if (hasCode(ctx)) return false;
  const here = dirFiles(ctx).get(posix.dirname(rel)) ?? [];
  return here.some((b) => COMPOSE_FILE_RE.test(b)) && !here.some((b) => DOCKERFILE_RE.test(b));
}

// A Spring Cloud Config backend (a git config repository, a native server's search location) serves OTHER services'
// configuration: `<service>.yml` / `<service>-<profile>.yml` beside the shared `application.yml`. A directory holding an
// `application*` file and Spring config files named like two or more other members (one of them multi-word: a lone
// `redis.yml` beside Rails' `config/application.yml`, or one peer's manifest at a service's root, is no store) is
// such a store: none of its files is this member's configuration.
const SERVED_EXT_RE = /\.(?:ya?ml|properties|json)$/i;
const SPRING_SHARED_RE = /^application(?:-[\w.-]+)?\.(?:ya?ml|properties)$/i;
const SPRING_FILE_RE = /\.(?:ya?ml|properties)$/i;
const SPEC_REST_RE = /-(?:api|apis|openapi|swagger|asyncapi|specs?|schema|contracts?|clients?|routes?|stubs?|mocks?)(?:-|$)/;
const STORE_CODE_RE = /\.(?:rb|py|php|java|kt|go|cs|exs?)$/i;
function servedConfig(rel, ctx) {
  if (!SERVED_EXT_RE.test(rel) || !Array.isArray(ctx?.files) || !Array.isArray(ctx?.members)) return false;
  const st = ctx.state || {};
  const dir = posix.dirname(rel);
  st.served ??= new Map();
  if (!st.served.has(dir)) {
    const names = [...new Set(ctx.members.filter((m) => m && m.key !== ctx.member?.key).flatMap((m) => [m.key, m.name])
      .filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().toLowerCase()))];
    const all = dirFiles(ctx).get(dir) ?? [];
    const siblings = all.filter((b) => SPRING_FILE_RE.test(b));
    const hits = new Set();
    for (const b of siblings) {
      const s = b.replace(SPRING_FILE_RE, '').toLowerCase();
      for (const n of names) if (s === n || (s.startsWith(`${n}-`) && !SPEC_REST_RE.test(s.slice(n.length)))) hits.add(n);
    }
    // Rails' config/ (application.rb beside config_for(:payments) files) and a Boot module's resources root are the member's own
    st.served.set(dir, !all.some((b) => STORE_CODE_RE.test(b)) && !/(?:^|\/)src\/main\/resources$/.test(dir) && siblings.some((b) => SPRING_SHARED_RE.test(b))
      && (hits.size >= 3 || (hits.size >= 2 && [...hits].some((n) => /[-_.]/.test(n)))));
  }
  return st.served.get(dir);
}

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  if (stackEnv(rel, ctx) || servedConfig(rel, ctx)) return undefined;
  const { pairs, errors } = configPairs(rel, text);
  const facts = [];
  const aliases = [];
  const unresolved = errors.length ? [{ kind: 'service', raw: rel, file: rel, line: 1, reason: `parse error: ${errors[0]}` }] : [];
  const topic = (dir, name, p, confidence) => facts.push(fact({ kind: 'topic', dir, key: name, rel, lines, line: p.line, needle: name, alt: p.key.split('.').pop(), detail: p.key, confidence }));
  for (const p of pairs) {
    const lastKey = p.key.split('.').pop();
    const value = p.value.trim();
    if (!value) continue;
    if (p.key === 'spring.application.name') {
      // never a name of ANOTHER member (a copy of its config): that member's own key would turn ambiguous (V5-01)
      const other = Array.isArray(ctx?.members) ? memberForImage(ctx, value) : null;
      if (!isPlaceholder(value) && !isTestPath(rel) && (!springModule(rel) || /[-_.]/.test(value)) && !(other && other.key !== ctx.member?.key)) aliases.push({ value, source: 'spring' });
      continue;
    }
    const binding = BINDING_RE.exec(p.key);
    if (binding) {
      const b = binding[1];
      const dir = /(-out-\d+|^output)$/i.test(b) ? 'provides' : /(-in-\d+|^input)$/i.test(b) ? 'consumes' : null;
      for (const name of value.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!dir || isPlaceholder(name)) unresolved.push({ kind: 'topic', raw: `${b}=${name}`, file: rel, line: p.line, reason: dir ? 'placeholder' : 'binding direction unknown' });
        else topic(dir, name, p, 'exact');
      }
      continue;
    }
    if (p.key === 'spring.kafka.template.default-topic') {
      if (!isPlaceholder(value)) topic('provides', value, p, 'exact');
      continue;
    }
    const sqs = SQS_RE.exec(value);
    if (sqs) { topic('consumes', sqs[1], p, 'exact'); continue; }
    if (TOPIC_NAME_RE.test(value) && topicKey(p.key, value) && !/^\d+$/.test(value) && !/^(true|false)$/i.test(value)) {
      topic('consumes', value, p, 'heuristic');
      continue;
    }
    const shells = classifyValue(value, p.key); // the whole key: `kafka.bootstrap.servers` ends in `servers` only
    if (!shells.length && isPlaceholder(value) && PEER_KEY_RE.test(lastKey)) {
      unresolved.push({ kind: 'service', raw: `${p.key}=${unresolvedValue(value)}`, file: rel, line: p.line, reason: 'placeholder' });
    }
    for (const s of shells) {
      const { target, confidence } = shellTarget(s, p.key); // localhost / IP: the key names the peer
      facts.push(fact({ kind: s.kind, dir: 'consumes', key: s.key, rel, lines, line: p.line, needle: s.needle, alt: lastKey, detail: p.key, target, confidence }));
    }
  }
  return { facts: onePerKey(facts), aliases, unresolved: cleanUnresolved(ctx?.state, rel, unresolved) };
}

export function claimsConfig(rel) {
  const base = posix.basename(rel);
  // compose files are deploy-compose's; samples (docs/, examples/) are no wiring of this member; Spring loads
  // application*.yml only from src/main/resources/ and its config/ — a config server's served files
  // (src/main/resources/shared/…) are other services' configuration.
  if (COMPOSE_FILE_RE.test(rel) || isSamplePath(rel)) return false;
  // MicroProfile Config (Quarkus, Helidon, Open Liberty) reads META-INF/microprofile-config.properties (`<Client>/mp-rest/url`)
  if (/(?:^|\/)src\/main\/resources\/META-INF\/microprofile-config\.properties$/.test(rel)) return true;
  if (/(?:^|\/)src\/main\/resources\/(?!config\/)[^/]+\//.test(rel)) return false;
  // …and in src/main/resources (its root or config/) only application* / bootstrap*: a native config server serves
  // `classpath:/config/<service>.yml` to OTHER services (Boot itself never loads a file of another name there).
  // (and a classpath .env: dotenv-java falls back to it)
  if (/(?:^|\/)src\/main\/resources\//.test(rel) && !/^(application|bootstrap)([-.][\w.-]+)?\.(ya?ml|properties)$/i.test(base) && !/^\.env$/i.test(base)) return false;
  return /^\.env(\..+)?$/i.test(base) || /^[\w.-]+\.env$/i.test(base)
    || /^(application|bootstrap)([-.][\w.-]+)?\.(ya?ml|properties)$/i.test(base)
    || /^appsettings(\.[\w.-]+)?\.json$/i.test(base)
    || /(^|\/)config\/[^/]+\.(json|ya?ml)$/i.test(rel);
}

export default Object.freeze({ id: 'config-env', claims: claimsConfig, detect });
