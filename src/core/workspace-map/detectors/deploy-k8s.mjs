// deploy-k8s: Kubernetes manifests (multi-document YAML, `kind: List`), Helm charts
// (Chart.yaml + values*.yaml; templates/ are Go templates and are skipped) and
// serverless.yml.
// SUBJECT member of a workload: the member whose name matches one of its container images; else the
// member another same-named document's image names (a sidecar patch of that workload, in any order); else
// the member the workload is NAMED like when an image names the workload or this member has no code (lib/text
// hasCode: a deploy repo's `cart` Deployment of an image built elsewhere — never a service repo's own `web`);
// else nobody when every image is an official single-name image (`redis:7`, `postgres`: infrastructure,
// no member's own build); else this member (the manifest lives here). A workload document without any
// container image is a patch (a kustomize overlay, a strategic-merge patch, `$patch: delete`): it takes the
// subject of the same-named workload that has images, else it names nobody — never this member by default.
// A Service's subject is the subject of the workload its selector matches (else this member); a Service
// without a selector (ExternalName, hand-managed endpoints) names no member. An Ingress host's subject is
// its backends' subject — a host routed to backends of two subjects (a gateway) names nobody, and in a member
// without code a backend no document here selects (an ExternalName, a Service defined elsewhere) is nobody. A chart's
// subject is the member named like the chart (else this member); a chart vendored in another chart's
// `charts/` dir (a dependency such as postgresql) names nobody, and an umbrella chart's `values-<member>.yaml`
// in a member without code configures that member, not this one. No alias ever names a member other than its subject (P1 gives a
// member's own key no priority: one stray alias costs it every edge). Nothing read from a test-path file
// aliases anyone, and a nested serverless.yml aliases only a multi-word name (P3-10).
//   aliases   workload / Service names — plus `<name>.<namespace>` when the manifest sets its
//             namespace (P1 resolves a dotted host such as `billing.payments` only through a
//             whole-host alias) — the Ingress host (whole, P1 hostName), Chart.yaml name,
//             serverless `service` → the subject (aliases[].member when it is another member)
//   consumes  only for THIS member's subjects: container env values, data of ConfigMaps
//             those containers reference (envFrom / configMapKeyRef / volumes), and Helm
//             values whose key ends in url / uri / host / hostname / endpoint / addr / address,
//             outside an `ingress` block (the chart's own public host is not a consume)
//             (lib/urls classifyValue; an http path with no usable host targets the key).
// Per-entry lookups are indexed: a container's env list is found once, Services meet workloads
// through a label index, Helm values are grouped per chart once.
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { splitLines, fact, memberForImage, imageRepo, isLibraryImage, onePerKey, cleanUnresolved, isSamplePath, aliasable, hasCode } from './lib/text.mjs';
import { loadYaml, nodeAt, entries, walkScalars, yamlProblem } from './lib/yaml.mjs';
import { classifyValue, isPlaceholder, PEER_KEY_RE, shellTarget, unresolvedValue } from './lib/urls.mjs';
import { hostName } from '../../../shared/workspace-map/keys.mjs';
import { isTestPath } from '../files.mjs';
import { COMPOSE_FILE_RE } from './deploy-compose.mjs';

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod', 'Rollout', 'DeploymentConfig']);
const podSpecPath = (kind, apiVersion) => {
  if (kind === 'Pod') return ['spec'];
  if (kind === 'CronJob') return ['spec', 'jobTemplate', 'spec', 'template', 'spec'];
  if (kind === 'Service' && /^serving\.knative\.dev\//.test(apiVersion || '')) return ['spec', 'template', 'spec'];
  return WORKLOADS.has(kind) ? ['spec', 'template', 'spec'] : null;
};
const get = (o, path) => path.reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);
const dirOf = (rel) => posix.dirname(rel);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const NAMESPACE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// No Kubernetes name (253), image reference or host is longer: one long scalar aliased by every item of a `kind: List`
// was re-read per workload (words, imageRepo, memberForImage: 25 s of CPU at 250 KiB).
const VALUE_MAX = 4096;
const fits = (v) => typeof v === 'string' && v.length <= VALUE_MAX;

/** The member named like `name` (key, name, dir / projectDir basename), for charts. */
const memberNamed = (ctx, name) => memberForImage(ctx, name);
const words = (s) => `_${String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_`;
/** true when one of the workload's images names the workload itself (`billing` running `acme/billing-service:1.2`,
 *  `cart` running `ghcr.io/acme/demo:1.0-cart`): a deploy repo's document of THAT service. A member's own workload
 *  of its own image (`web` running `registry/acme/orders-django:1`) stays this member's whatever it is named. */
const ownNames = (ctx) => [ctx.member.key, ctx.member.name, ctx.member.dir && posix.basename(String(ctx.member.dir).replace(/\\/g, '/')), ctx.member.projectDir && posix.basename(String(ctx.member.projectDir).replace(/\\/g, '/'))].filter((x) => typeof x === 'string' && x.trim()).map(words);
const namesWorkload = (w, c) => typeof c.image === 'string' && words(c.image).includes(words(w.name));
const namesOwn = (c, ctx) => ownNames(ctx).some((n) => words(imageRepo(c.image) ?? '').includes(n));
/** `guard` false: this member's name is a product prefix several services share (`yas-media`, `yas-product` in the `yas` repo). */
const imageNamesWorkload = (w, ctx, guard = true) => w.containers.some((c) => namesWorkload(w, c) && !(guard && namesOwn(c, ctx)));
const fileSet = (ctx) => { ctx.state.fileSet ??= new Set(ctx.files); return ctx.state.fileSet; };

function chartDirOf(ctx, rel) {
  // nearest ancestor directory holding a Chart.yaml
  let d = dirOf(rel);
  for (;;) {
    const c = d === '.' ? 'Chart.yaml' : `${d}/Chart.yaml`;
    if (fileSet(ctx).has(c)) return d;
    if (d === '.' || !d) return null;
    d = dirOf(d);
  }
}

/** A chart directory `<parent>/charts/<dep>` whose parent holds a Chart.yaml: a vendored dependency. */
function isSubchart(ctx, dir) {
  const m = /^(?:(.*)\/)?charts\/[^/]+$/.exec(dir);
  return !!m && fileSet(ctx).has(m[1] ? `${m[1]}/Chart.yaml` : 'Chart.yaml');
}

function manifest(y, doc, root, js, rel, lines, st) {
  const test = isTestPath(rel);
  const docs = js?.kind === 'List' && Array.isArray(js.items) ? js.items.map((it, i) => [it, ['items', i]]) : [[js, []]];
  for (const [obj, prefix] of docs) {
    if (!isObj(obj) || typeof obj.kind !== 'string') continue;
    const name = fits(get(obj, ['metadata', 'name'])) ? obj.metadata.name : null;
    const ns = get(obj, ['metadata', 'namespace']);
    const namespace = typeof ns === 'string' && NAMESPACE_RE.test(ns) ? ns : null;
    const spec = podSpecPath(obj.kind, obj.apiVersion);
    if (spec) {
      const pod = get(obj, spec) || {};
      const containers = [];
      for (const group of ['containers', 'initContainers']) {
        (Array.isArray(pod[group]) ? pod[group] : []).forEach((c, ci) => {
          if (!isObj(c)) return;
          const env = [];
          // The container's env list is found once; each item's `value` is read from it (a walk
          // from the root per entry costs the pod spec's key count every time).
          const envNode = Array.isArray(c.env) && c.env.length ? nodeAt(doc, root, [...prefix, ...spec, group, ci, 'env']) : null;
          (Array.isArray(c.env) ? c.env : []).forEach((e, ei) => {
            if (!isObj(e) || !fits(e.name)) return;
            const cmRef = get(e, ['valueFrom', 'configMapKeyRef', 'name']);
            if (typeof e.value === 'string') env.push({ name: e.name, value: e.value, line: y.lineOf(nodeAt(doc, isSeq(envNode) ? envNode.items[ei] : null, ['value'])) });
            if (typeof cmRef === 'string') env.push({ configMap: cmRef });
          });
          const refs = [...(Array.isArray(c.envFrom) ? c.envFrom : []).map((f) => get(f, ['configMapRef', 'name'])), ...env.map((e) => e.configMap)].filter((x) => typeof x === 'string');
          containers.push({ image: fits(c.image) ? c.image : null, env: env.filter((e) => !e.configMap), refs });
        });
      }
      const volumeRefs = (Array.isArray(pod.volumes) ? pod.volumes : []).map((v) => get(v, ['configMap', 'name'])).filter((x) => typeof x === 'string');
      const labels = { ...(get(obj, ['metadata', 'labels']) || {}), ...(get(obj, [...spec.slice(0, -1), 'metadata', 'labels']) || {}) };
      if (typeof name === 'string') st.workloads.push({ name, namespace, labels, containers, volumeRefs, rel, lines, test });
      continue;
    }
    if (obj.kind === 'Service' && typeof name === 'string') {
      const selector = get(obj, ['spec', 'selector']);
      st.services.push({ name, namespace, selector: isObj(selector) && Object.keys(selector).length ? selector : null, test });
    } else if (obj.kind === 'Ingress') {
      const backendsOf = (http) => (Array.isArray(http?.paths) ? http.paths : []).map((p) => get(p, ['backend', 'service', 'name']) ?? get(p, ['backend', 'serviceName'])).filter((x) => typeof x === 'string');
      const def = get(obj, ['spec', 'defaultBackend', 'service', 'name']) ?? get(obj, ['spec', 'backend', 'serviceName']);
      for (const r of Array.isArray(get(obj, ['spec', 'rules'])) ? obj.spec.rules : []) {
        const backends = backendsOf(r?.http);
        if (!backends.length && typeof def === 'string') backends.push(def);
        if (fits(r?.host) && backends.length) st.ingress.push({ host: r.host, backends, test });
      }
    } else if (obj.kind === 'ConfigMap' && typeof name === 'string' && isObj(obj.data)) {
      const data = [];
      const lineOf = new Map(entries(doc, nodeAt(doc, root, [...prefix, 'data'])).map((e) => [e.key, y.lineOf(nodeAt(doc, e.value, []))]));
      for (const [k, v] of Object.entries(obj.data)) {
        if (typeof v === 'string') data.push({ name: k, value: v, line: lineOf.get(k) || 0 });
      }
      st.configMaps.set(name, { rel, lines, data });
    }
  }
}

function detect({ rel, text }, ctx) {
  const st = ctx.state;
  st.workloads ??= []; st.services ??= []; st.ingress ??= []; st.configMaps ??= new Map(); st.values ??= []; st.charts ??= new Map();
  const base = posix.basename(rel);
  const lines = splitLines(text);
  if (/^serverless\.ya?ml$/i.test(base)) {
    if (isTestPath(rel)) return undefined;
    const y = loadYaml(text);
    const svc = y.docs[0]?.js?.service;
    const name = typeof svc === 'string' ? svc : isObj(svc) && typeof svc.name === 'string' ? svc.name : null;
    return name && !name.includes('${') && aliasable(rel, name) ? { aliases: [{ value: name, source: 'serverless' }] } : undefined;
  }
  if (base === 'Chart.yaml') {
    const y = loadYaml(text);
    const name = y.docs[0]?.js?.name;
    if (typeof name === 'string' && name && !isTestPath(rel) && !isSubchart(ctx, dirOf(rel))) st.charts.set(dirOf(rel), name);
    return undefined;
  }
  const chartDir = chartDirOf(ctx, rel);
  if (chartDir !== null) {
    const inChart = chartDir === '.' ? rel : rel.slice(chartDir.length + 1);
    if (/^templates\//.test(inChart)) return undefined; // Go templates, not YAML
    if (/^values[\w.-]*\.ya?ml$/i.test(inChart)) {
      const y = loadYaml(text);
      const budget = {}; // one walk budget for every document of the file (lib/yaml walkScalars)
      for (const { doc, root } of y.docs) {
        if (walkScalars(y, doc, root, ({ path, value, line }) => {
          const key = String(path[path.length - 1] ?? '');
          if (typeof value !== 'string' || !PEER_KEY_RE.test(key)) return;
          if (path.some((p) => typeof p === 'string' && /^ingress$/i.test(p))) return; // the chart's own host
          st.values.push({ chartDir, key: path.join('.'), shells: classifyValue(value, key), rel, lines, line });
        }, budget)) { y.errors.push('yaml too large'); break; }
      }
      const problem = yamlProblem(y);
      return problem ? { unresolved: cleanUnresolved(st, rel, [{ kind: 'service', raw: rel, file: rel, line: 1, reason: `yaml parse error: ${problem}` }]) } : undefined;
    }
  }
  if (!/^[ \t]*kind[ \t]*:/m.test(text) || !/^[ \t]*apiVersion[ \t]*:/m.test(text)) return undefined;
  const y = loadYaml(text);
  for (const { doc, root, js } of y.docs) manifest(y, doc, root, js, rel, lines, st);
  const problem = yamlProblem(y);
  return problem ? { unresolved: cleanUnresolved(st, rel, [{ kind: 'service', raw: rel, file: rel, line: 1, reason: `yaml parse error: ${problem}` }]) } : undefined;
}

function finish(ctx) {
  const st = ctx.state;
  const own = ctx.member.key;
  const facts = [];
  const aliases = [];
  const unresolved = [];
  const seen = new Set();
  const alias = (value, subject, source, namespace = null) => {
    if (typeof value !== 'string' || !value.trim() || !subject) return;
    // A name that names ANOTHER member (a GitOps repo's `billing` running `billing-service:1.2`, a dev stub of a
    // peer) never aliases a different subject: the real member's own key would turn ambiguous and lose every edge.
    const named = memberNamed(ctx, value);
    if (named && named.key !== subject) return;
    for (const v of namespace ? [value, `${value}.${namespace}`] : [value]) {
      const id = `${v}\u0000${subject}`;
      if (seen.has(id)) continue;
      seen.add(id);
      aliases.push(subject === own ? { value: v, source } : { value: v, source, member: subject });
    }
  };
  const emit = (shells, env, rel, lines, detail, key) => {
    for (const s of shells) {
      const { target, confidence } = shellTarget(s, key);
      facts.push(fact({ kind: s.kind, dir: 'consumes', key: s.key, rel, lines, line: env.line, needle: s.needle, alt: String(key).split('.').pop(), detail, target, confidence }));
    }
  };
  const subjectOfWorkload = new Map(); // name → the subject of its image-bearing documents (a patch never overrides it)
  const guessOfWorkload = new Map(); // name → true when that subject is this member by default only (M7, below)
  const ownImage = new Map(); // image → whether it names this member: one image aliased by every workload is read once (M7's guess)
  const byLabel = new Map(); // `key\0value` → workloads carrying that label
  const workloads = st.workloads || [];
  const imaged = (w) => w.containers.some((c) => typeof c.image === 'string' && c.image.trim());
  const imageMember = new Map(); // name → the member one of its documents' images names (any document order)
  for (const w of workloads) {
    const m = imaged(w) ? w.containers.map((c) => memberForImage(ctx, c.image)).find(Boolean) : null;
    w.imageMember = m ? m.key : null;
    if (m && !imageMember.has(w.name)) imageMember.set(w.name, m.key);
  }
  // A prefix that the images of workloads named like two or more OTHER members share (`yas-media`, `yas-product` in the product
  // repo `yas`) is a product namespace, not this member's own build: only a lone such workload (`orders-web`) stays here.
  const prefixed = new Set();
  for (const w of workloads) {
    const m = imaged(w) && w.containers.some((c) => namesWorkload(w, c) && namesOwn(c, ctx)) ? memberNamed(ctx, w.name) : null;
    if (m && m.key !== own) prefixed.add(m.key);
  }
  const guard = prefixed.size < 2;
  for (const w of workloads) {
    if (!imaged(w)) continue;
    // The member an image names; else the one another same-named document's image names (a sidecar patch —
    // `envoyproxy/envoy` — of that workload, in any document order); else the member the workload is NAMED like (a
    // deploy repo's `cart` Deployment of an image built elsewhere: never this member by default, which would make
    // the other member's key ambiguous); else nobody when every image is an official one (redis:7, postgres:
    // infrastructure — no alias, no consumes); else this member.
    const tied = w.imageMember ?? imageMember.get(w.name) ?? (imageNamesWorkload(w, ctx, guard) || !hasCode(ctx) ? memberNamed(ctx, w.name)?.key : null);
    w.subject = tied ?? (w.containers.every((c) => isLibraryImage(c.image)) ? null : own);
    // M7: nothing ties the workload to a member (no image or name names one): this member by default. That is a guess in a
    // member without code (a deploy repo), and in a member with code when no image names this member either (a local-dev
    // stub or mock of a peer, `billing` running `wiremock/wiremock`): its names are `deploy-self` aliases (tier 3), never
    // above another member's package name.
    w.guess = tied == null && w.subject === own && (!hasCode(ctx) || !w.containers.some((c) => { if (!ownImage.has(c.image)) ownImage.set(c.image, namesOwn(c, ctx)); return ownImage.get(c.image); }));
    if (!subjectOfWorkload.get(w.name)) { subjectOfWorkload.set(w.name, w.subject); guessOfWorkload.set(w.name, w.guess); }
  }
  for (const w of workloads) {
    // A patch document: the subject of the workload it patches, else nobody (never `own` by default).
    if (!imaged(w)) { w.subject = subjectOfWorkload.get(w.name) ?? null; w.guess = guessOfWorkload.get(w.name) === true; }
    const subject = w.subject;
    for (const [k, v] of Object.entries(w.labels)) {
      const key = `${k}\u0000${v}`;
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key).push(w);
    }
    if (!w.test) alias(w.name, subject, w.guess ? 'deploy-self' : 'k8s', w.namespace);
    if (subject !== own) continue;
    for (const c of w.containers) {
      for (const e of c.env) {
        const shells = classifyValue(e.value, e.name);
        if (!shells.length && isPlaceholder(e.value) && PEER_KEY_RE.test(e.name)) unresolved.push({ kind: 'service', raw: `${e.name}=${unresolvedValue(e.value)}`, file: w.rel, line: e.line, reason: 'placeholder' });
        emit(shells, e, w.rel, w.lines, `${e.name} (${w.name})`, e.name);
      }
    }
    const refs = new Set([...w.containers.flatMap((c) => c.refs), ...w.volumeRefs]);
    for (const ref of refs) {
      const cm = st.configMaps?.get(ref);
      if (!cm) continue;
      for (const d of cm.data) emit(classifyValue(d.value, d.name), d, cm.rel, cm.lines, `${d.name} (configmap ${ref})`, d.name);
    }
  }
  const code = hasCode(ctx);
  const subjectOfService = new Map();
  for (const s of st.services || []) {
    if (!s.selector) continue; // no selector: its endpoints are not a workload of this repo
    const pairs = Object.entries(s.selector);
    let pool = null; // the workloads of the selector's rarest label, never every workload
    for (const [k, v] of pairs) { const list = byLabel.get(`${k}\u0000${v}`) || []; if (!pool || list.length < pool.length) pool = list; }
    const w = (pool || []).find((x) => pairs.every(([k, v]) => x.labels[k] === v));
    const subject = w ? w.subject : code ? own : null;
    subjectOfService.set(s.name, subject);
    if (!s.test) alias(s.name, subject, w?.guess ? 'deploy-self' : 'k8s', s.namespace);
  }
  // A host routed to backends of two subjects (a gateway host: /billing → billing, /orders → orders) names nobody. In a
  // member without code (a deploy repo) a selector-less Service (ExternalName) or a backend no document defines is
  // nobody — a GitOps repo's host is never the deploy repo's own —; in a member with code an ExternalName beside its
  // own backend (`/docs` → a docs site) is skipped and an undefined backend (a Helm-templated Service) is its own.
  const selectorless = new Set((st.services || []).filter((s) => !s.selector).map((s) => s.name));
  const hostSubjects = new Map();
  for (const i of st.ingress || []) {
    if (i.test) continue;
    const h = hostName(i.host);
    if (!hostSubjects.has(h)) hostSubjects.set(h, new Set());
    for (const b of i.backends) {
      if (subjectOfService.has(b)) hostSubjects.get(h).add(subjectOfService.get(b));
      else if (subjectOfWorkload.has(b)) hostSubjects.get(h).add(subjectOfWorkload.get(b));
      else if (!code) hostSubjects.get(h).add(null);
      else if (!selectorless.has(b)) { const n = memberNamed(ctx, b); hostSubjects.get(h).add(n && n.key !== own ? null : own); }
    }
  }
  for (const [h, subjects] of hostSubjects) if (subjects.size === 1) alias(h, [...subjects][0], 'k8s-ingress'); // the whole host: a public name resolves only whole
  const valuesByChart = new Map();
  for (const v of st.values || []) {
    if (!valuesByChart.has(v.chartDir)) valuesByChart.set(v.chartDir, []);
    valuesByChart.get(v.chartDir).push(v);
  }
  for (const [dir, name] of st.charts || []) {
    const m = memberNamed(ctx, name);
    const subject = m ? m.key : own;
    // M7: a chart named like no member is a guess in a deploy repo, and in a member with code unless its name holds this
    // member's own name (`orders-chart` in orders; never a peer's stub chart `billing-api`).
    alias(name, subject, !m && (!code || !ownNames(ctx).some((n) => words(name).includes(n))) ? 'deploy-self' : 'helm');
    if (subject !== own) continue;
    // An umbrella chart's (one named like no member) per-service values file (`values-billing.yaml`) configures THAT
    // member, not this one; a member's own chart keeps `values-prod.yaml` even when a member is named `prod` (a
    // top-level `ledger:` block is NOT such a sign: a chart keys its own peer settings by the peer's name).
    // Only in a member without code: a service's own chart (`orders-chart`) keeps `values-web.yaml` for its web tier.
    const otherOf = (x) => { const o = !m && x && !hasCode(ctx) ? memberNamed(ctx, x) : null; return !!o && o.key !== own; };
    for (const v of valuesByChart.get(dir) || []) {
      if (otherOf(/^values-(.+)\.ya?ml$/i.exec(posix.basename(v.rel))?.[1])) continue;
      emit(v.shells, v, v.rel, v.lines, `${v.key} (helm values)`, v.key);
    }
  }
  return { facts: onePerKey(facts), aliases, unresolved: cleanUnresolved(st, null, unresolved) };
}

export default Object.freeze({
  id: 'deploy-k8s',
  claims: (rel) => /\.ya?ml$/i.test(rel) && !COMPOSE_FILE_RE.test(rel) && !isSamplePath(rel), // samples (docs/, examples/) deploy nothing of this member
  detect,
  finish,
});
