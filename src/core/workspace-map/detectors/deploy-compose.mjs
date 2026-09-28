// deploy-compose: docker-compose*.yml / compose*.yaml (incl. docker-compose-dev.yml, compose.prod.yaml).
// Each service has a SUBJECT member: the member its build context resolves into
// (context resolved against the compose file's directory under member.projectDir), else
// the member whose name matches the image repository, else none.
//   aliases   service name, container_name, hostname, network aliases → the subject member
//             (aliases[].member is set when the subject is another member)
//   consumes  only for services whose subject is THIS member (a deploy repo's compose file
//             must not attribute web's calls to the deploy repo): depends_on, links →
//             service:<name>; environment values → lib/urls classifyValue (service / http / db;
//             an http path with no usable host targets the variable name, heuristic)
// Placeholders (${VAR}) in a build context or a peer-looking env value → unresolved. A test-path
// compose file (an e2e stack stubbing peers from local dirs) keeps its facts (marked test by
// extract) but never aliases anyone: a stub named `billing` must not claim the real billing's name.
// A service built from a SUB-DIRECTORY of its member (`./docker/db`, `./stubs/billing`) is an
// auxiliary container — a local database image, a stub of a peer —, not the member: like a nested
// manifest (P3-10) it aliases the member only with a multi-word name, since `db` or `billing` would
// otherwise name this member for every peer that calls its own `db` or the real billing. A service
// this member builds PER SERVICE (its context or dockerfile names the service, or the dockerfile is a
// placeholder: a deploy repo building every service from `./`, a stub of a peer) but NAMED like another member
// is that member's — a build of the member root with its own Dockerfile (`web: build: .`) stays this member's
// whatever it is named (v6); no alias ever names a member other than its subject (P1 gives a
// member's own key no priority, so one stray alias would cost it every edge); a test stack named so
// (`compose.e2e.yml`, `docker-compose-it.yml`) aliases nobody and gives no consumes.
import { resolve } from 'node:path';
import { splitLines, fact, memberForPath, memberForImage, samePathOrInside, onePerKey, cleanUnresolved, isSamplePath } from './lib/text.mjs';
import { isTestPath } from '../files.mjs';
import { loadYaml, nodeAt, entries, keyLine, yamlProblem } from './lib/yaml.mjs';
import { classifyValue, isPlaceholder, PEER_KEY_RE, shellTarget, unresolvedValue } from './lib/urls.mjs';
import { isSeq, isScalar } from 'yaml';

export const COMPOSE_FILE_RE = /(^|\/)(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i;
// A test stack by its name (`compose.tests.yaml`, `docker-compose.e2e.yml`, `docker-compose-it.yml`) that P1's
// isTestPath misses: its runners never alias anyone and their depends_on are no calls of this member.
const TEST_STACK_RE = /(?:^|\/)(?:docker-)?compose[.-](?:[\w-]+[.-])?(?:tests?|e2e|it|integration)[.-][^/]*$/i;

/** true when a build context resolves below its member's root, not to the root itself. */
function nestedContext(ctx, rel, context, subject) {
  const dir = resolve(ctx.member.projectDir, ...rel.split('/').slice(0, -1), context.trim().replace(/\\/g, '/'));
  return !samePathOrInside(dir, subject.projectDir);
}
const multiWord = (name) => /[-_.]/.test(name.trim());
// No real build context, dockerfile, image reference or compose name is longer (PATH_MAX; Docker's reference limits):
// one long scalar aliased by every service was re-read by every service (quadratic: 7.5 s of CPU at 250 KiB).
const VALUE_MAX = 4096;
const fits = (v) => typeof v === 'string' && v.length <= VALUE_MAX;
const words = (s) => `_${String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_`;
/** true for a PER-SERVICE build: its context or dockerfile as written names the service (`context: ./` +
 *  `dockerfile: ./src/cart/Dockerfile`, a stub `./stubs/billing-api`, a deploy repo's `./cart`), or its dockerfile
 *  is interpolated (`${CART_DOCKERFILE}`, set in the stack's `.env`). A build of the member's root with its own
 *  Dockerfile (`web: build: .`, `Dockerfile.dev`, `docker/Dockerfile`) is this member's service, whatever its name. */
function perService(build, context, name) {
  const dockerfile = build && typeof build === 'object' && fits(build.dockerfile) ? build.dockerfile : '';
  // an interpolated dockerfile counts when its variable names a word of the service (`${FRAUD_DOCKERFILE}` for
  // `fraud-detection`); a generic switch (`${DOCKERFILE:-Dockerfile}`) is this member's own build.
  const named = isPlaceholder(dockerfile) && words(name).split('_').some((w) => w.length > 1 && words(dockerfile.replace(/:-[^}]*/g, '')).includes(`_${w}_`));
  return named || words(`${context} ${dockerfile}`).includes(words(name));
}

function envPairs(y, doc, envNode) {
  const out = [];
  if (isSeq(envNode)) {
    for (const it of envNode.items) {
      if (!isScalar(it) || typeof it.value !== 'string') continue;
      const eq = it.value.indexOf('=');
      if (eq > 0 && eq <= VALUE_MAX) out.push({ name: it.value.slice(0, eq), value: it.value.slice(eq + 1), line: y.lineOf(it) });
    }
    return out;
  }
  for (const e of entries(doc, envNode)) {
    const v = nodeAt(doc, e.value, []);
    if (isScalar(v) && v.value != null && e.key.length <= VALUE_MAX) out.push({ name: e.key, value: String(v.value), line: y.lineOf(v) || y.lineOf(e.keyNode) });
  }
  return out;
}

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  const nameTest = !isTestPath(rel) && TEST_STACK_RE.test(rel);
  const test = isTestPath(rel) || nameTest;
  const y = loadYaml(text);
  const facts = [];
  const aliases = [];
  const unresolved = [];
  const problem = yamlProblem(y);
  if (problem) unresolved.push({ kind: 'service', raw: rel, file: rel, line: 1, reason: `yaml parse error: ${problem}` });
  const own = ctx.member.key;
  for (const { doc, root, js } of y.docs) {
    const services = js && typeof js === 'object' && js.services && typeof js.services === 'object' ? js.services : null;
    if (!services) continue;
    const svcNodes = new Map(entries(doc, nodeAt(doc, root, ['services'])).map((e) => [e.key, e.value]));
    for (const [name, svc] of Object.entries(services)) {
      if (!svc || typeof svc !== 'object') continue;
      const node = svcNodes.get(name) ?? null;
      const context = typeof svc.build === 'string' ? svc.build : svc.build && typeof svc.build === 'object' ? (svc.build.context ?? '.') : null;
      let subject = null;
      let nested = false;
      if (fits(context)) {
        if (isPlaceholder(context) || context.includes('${')) {
          unresolved.push({ kind: 'service', raw: `build: ${unresolvedValue(context)}`, file: rel, line: keyLine(y, doc, node, ['build']) || 1, reason: 'compose variable in build context' });
        } else {
          subject = memberForPath(ctx, rel, context);
          nested = !!subject && nestedContext(ctx, rel, context, subject);
        }
      }
      const imageMember = fits(svc.image) ? memberForImage(ctx, svc.image) : null;
      subject ??= imageMember;
      // A service built from THIS member but named like ANOTHER member (a deploy repo whose compose builds
      // every service from `./` with a per-service dockerfile, a stub of a peer) is that member — unless its own
      // image names this member: its names never alias this member (P1 would make the other member's own key
      // ambiguous) and its env is not this member's calls.
      const named = subject?.key === own && imageMember?.key !== own && perService(svc.build, context, name) ? memberForImage(ctx, name) : null;
      if (named && named.key !== own) { subject = named; nested = false; }
      if (!subject) continue;
      const aliasNames = [name, svc.container_name, svc.hostname];
      if (svc.networks && typeof svc.networks === 'object' && !Array.isArray(svc.networks)) {
        for (const n of Object.values(svc.networks)) if (n && Array.isArray(n.aliases)) aliasNames.push(...n.aliases);
      }
      // A name of ANOTHER member than the subject (`billing: image: ghcr.io/acme/billing-api` while a `billing`
      // member exists, a container_name) never aliases the subject: the real member's own key would turn ambiguous.
      const other = (x) => { const m = memberForImage(ctx, x); return !!m && m.key !== subject.key; };
      const ok = (x) => fits(x) && x.trim() && !other(x) && (!nested || multiWord(x));
      // M7: a service this member builds from a SUB-directory, or PER SERVICE from its root (`context: .` with a dockerfile
      // naming the service), is an auxiliary container — a stub of a peer, a local db image —, not the member: its names are
      // guesses (`deploy-self`, tier 3), never above another member's package name. A build of the root with its own
      // Dockerfile (`orders-api: build: .`) stays a deploy name.
      const guess = subject.key === own && (nested || (typeof context === 'string' && imageMember?.key !== own && perService(svc.build, context, name)));
      for (const a of test ? [] : new Set(aliasNames.filter(ok))) {
        aliases.push(subject.key === own ? { value: a, source: guess ? 'deploy-self' : 'compose' } : { value: a, source: 'compose', member: subject.key });
      }
      if (subject.key !== own || nameTest) continue;
      // depends_on: [a, b] | { a: { condition } } ; links: ['a', 'a:alias']
      const dep = nodeAt(doc, node, ['depends_on']);
      const depNames = isSeq(dep)
        ? dep.items.map((it) => ({ name: isScalar(it) ? String(it.value) : null, line: y.lineOf(it) }))
        : entries(doc, dep).map((e) => ({ name: e.key, line: y.lineOf(e.keyNode) }));
      for (const d of depNames) {
        if (!d.name || d.name.length > VALUE_MAX) continue;
        facts.push(fact({ kind: 'service', dir: 'consumes', key: d.name, rel, lines, line: d.line, needle: d.name, detail: `compose depends_on (${name})`, target: d.name, confidence: 'exact' }));
      }
      const links = nodeAt(doc, node, ['links']);
      if (isSeq(links)) {
        for (const it of links.items) {
          if (!isScalar(it) || (typeof it.value === 'string' && it.value.length > VALUE_MAX)) continue;
          const target = String(it.value).split(':')[0];
          facts.push(fact({ kind: 'service', dir: 'consumes', key: target, rel, lines, line: y.lineOf(it), needle: target, detail: `compose links (${name})`, target, confidence: 'exact' }));
        }
      }
      for (const env of envPairs(y, doc, nodeAt(doc, node, ['environment']))) {
        const shells = classifyValue(env.value, env.name);
        if (!shells.length && isPlaceholder(env.value) && PEER_KEY_RE.test(env.name)) {
          unresolved.push({ kind: 'service', raw: `${env.name}=${unresolvedValue(env.value)}`, file: rel, line: env.line, reason: 'placeholder' });
        }
        for (const s of shells) {
          const { target, confidence } = shellTarget(s, env.name);
          facts.push(fact({ kind: s.kind, dir: 'consumes', key: s.key, rel, lines, line: env.line, needle: s.needle, alt: env.name, detail: `${env.name} (${name})`, target, confidence }));
        }
      }
    }
  }
  return { facts: onePerKey(facts), aliases, unresolved: cleanUnresolved(ctx.state, rel, unresolved) };
}

export default Object.freeze({
  id: 'deploy-compose',
  claims: (rel) => COMPOSE_FILE_RE.test(rel) && !isSamplePath(rel), // a sample stack (docs/, examples/) is no wiring of this member
  detect,
});
