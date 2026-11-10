// src/core/executor/backends/k8s-pod-spec.mjs
// The worker pod manifest: a pure overlay on the operator's template. The template (a JSON Pod
// with a container named `worker`) owns everything about WHERE and HOW the pod runs — node
// selectors, tolerations, volumes, envFrom, security contexts, service account, image pull
// secrets — and this module only fills in what identifies one worker: the name, the labels and
// scope annotation, the image, the worker's environment, resources when the controller carries
// any, and the active deadline. A few fields are enforced because a worker is a one-shot job
// that talks to the controller and nothing else: restartPolicy Never, no service-account token,
// no service links, a termination grace of at least 30 s.
//
// Naming limits: a pod name is DNS-1123 (≤ 63 chars, lowercase, `-`), a label value is ≤ 63 of
// [A-Za-z0-9._-] starting and ending alphanumeric; a scope id (a chat thread id can be hundreds
// of characters) is therefore shortened for both, and the full scope lives in the
// `worca.dev/scope` annotation.
import { createHash } from 'node:crypto';

export const WORKER_CONTAINER = 'worker';
export const DEFAULT_IMAGE_PATTERN = 'ghcr.io/sinishadjukic/worca-worker:{version}-{engine}{variant}';
export const LABEL_NAME = 'app.kubernetes.io/name';
export const LABEL_COMPONENT = 'app.kubernetes.io/component';
export const LABEL_MANAGED_BY = 'app.kubernetes.io/managed-by';
export const LABEL_INSTANCE = 'app.kubernetes.io/instance';
/** Worca's own instance label: what the backend lists and reaps by. The standard `app.kubernetes.io/*` name and
 *  instance labels belong to whoever wrote the template (a Helm chart selects on them in its NetworkPolicies). */
export const LABEL_WORCA_INSTANCE = 'worca.dev/instance';
export const LABEL_SCOPE = 'worca.dev/scope';
export const LABEL_ENGINE = 'worca.dev/engine';
export const LABEL_BOOT = 'worca.dev/boot';
export const ANNOTATION_SCOPE = 'worca.dev/scope';
export const MIN_TERMINATION_GRACE_S = 30;

const FORBIDDEN_ENV_NAMES = new Set(['GH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
const FORBIDDEN_ENV_PREFIXES = ['WORCA_GH_', 'WORCA_BROKER_SECRET'];

/** Credentials that must never reach a worker through its pod spec (the broker hands them out per exec). */
export function isForbiddenEnvName(name) {
  const n = String(name || '');
  return FORBIDDEN_ENV_NAMES.has(n) || FORBIDDEN_ENV_PREFIXES.some((p) => n.startsWith(p));
}

/** Throws naming the first forbidden variable in `env` (an object or a `[{ name }]` list). */
export function assertAllowedEnv(env) {
  const names = Array.isArray(env) ? env.map((e) => e?.name) : Object.keys(env || {});
  const bad = names.filter(isForbiddenEnvName);
  if (bad.length) throw new Error(`refusing to pass ${bad.join(', ')} to a worker pod: credentials never travel in the pod spec`);
}

const short = (s, n) => createHash('sha1').update(String(s)).digest('hex').slice(0, n);
const trimDashes = (s) => s.replace(/^[-._]+|[-._]+$/g, '');

/** A DNS-1123 fragment of `id`: lowercase alphanumerics and `-`, at most `max` chars, never empty. */
function dnsFragment(id, max) {
  const clean = trimDashes(String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-'));
  const cut = trimDashes(clean.slice(0, max));
  return cut || 'x';
}

/** `worca-w-<kind>-<id ≤ 20>-<base36 time>`, a valid pod name of at most 63 characters. */
export function podName(scope, now = Date.now()) {
  const kind = dnsFragment(scope?.kind || 'run', 8);
  const id = dnsFragment(scope?.id || '', 20);
  const stamp = Math.max(0, Math.floor(Number(now) || 0)).toString(36);
  const name = `worca-w-${kind}-${id}-${stamp}`;
  return name.length <= 63 ? name : trimDashes(name.slice(0, 63));
}

/** The scope as a label value: `run_<id>` / `chat_<id>` within the label charset and 63 chars (long ids are hashed). */
export function scopeLabel(scopeKey) {
  const raw = String(scopeKey || '').replace(/[^A-Za-z0-9._-]+/g, '_');
  const fits = (s) => s.length <= 63 && /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(s);
  if (fits(raw)) return raw;
  const trimmed = trimDashes(raw.slice(0, 63 - 9)) || 'scope';
  const v = `${trimmed}-${short(scopeKey, 8)}`;
  return fits(v) ? v : `s-${short(scopeKey, 16)}`;
}

/** `'' | '-full'` from the operator's spelling (slim/full, with or without the dash). */
export function normalizeVariant(variant) {
  const v = String(variant || '').trim().toLowerCase().replace(/^-/, '');
  if (!v || v === 'slim') return '';
  if (v === 'full') return '-full';
  throw new Error(`unknown worker image variant "${variant}" (slim or full)`);
}

/** The worker image for an engine: an explicit override, else the pattern with its placeholders filled. */
export function resolveImage({ pattern = DEFAULT_IMAGE_PATTERN, engine, variant = '', version, overrides = null } = {}) {
  const e = String(engine || '').trim();
  if (!e) throw new Error('resolveImage: an engine is required');
  const override = overrides && typeof overrides === 'object' ? overrides[e] : null;
  if (typeof override === 'string' && override.trim()) return override.trim();
  const v = normalizeVariant(variant);
  const image = String(pattern || DEFAULT_IMAGE_PATTERN)
    .replaceAll('{version}', String(version ?? '').trim() || 'latest')
    .replaceAll('{engine}', e)
    .replaceAll('{variant}', v);
  if (!image.trim()) throw new Error('resolveImage: the image pattern is empty');
  return image;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasAny = (o) => isObj(o) && Object.values(o).some((v) => isObj(v) ? Object.keys(v).length > 0 : v != null);

/** The `worker` container of a manifest (throws when the template has none). */
export function workerContainer(manifest) {
  const list = manifest?.spec?.containers;
  const c = Array.isArray(list) ? list.find((x) => x?.name === WORKER_CONTAINER) : null;
  if (!c) throw new Error(`the worker pod template has no container named "${WORKER_CONTAINER}"`);
  return c;
}

/**
 * The pod to create for one worker. Returns a new manifest; `template` is not modified. `env` is
 * an object of the worker's variables (forbidden credential names are refused); `resources`, when
 * it carries any requests or limits, replaces the template container's; `activeDeadlineSeconds`
 * is set when given; `name` overrides the generated one (a 409 retry).
 */
export function renderPodSpec({
  template, instanceId = 'worca', scope, scopeKey, engine, variant = '', resources = null, env = {},
  image, now = Date.now(), activeDeadlineSeconds = null, bootId = null, name = null,
} = {}) {
  if (!isObj(template)) throw new Error('the worker pod template must be a JSON object (a Pod manifest)');
  if (!scope?.kind || !scope?.id) throw new Error('renderPodSpec: a scope { kind, id } is required');
  if (!image) throw new Error('renderPodSpec: an image is required');
  assertAllowedEnv(env);
  const manifest = structuredClone(template);
  manifest.apiVersion ||= 'v1';
  manifest.kind ||= 'Pod';
  manifest.spec = isObj(manifest.spec) ? manifest.spec : {};
  const container = workerContainer(manifest);
  const key = scopeKey || `${scope.kind}:${scope.id}`;

  manifest.metadata = isObj(manifest.metadata) ? manifest.metadata : {};
  manifest.metadata.name = name || podName(scope, now);
  delete manifest.metadata.generateName;
  const own = isObj(manifest.metadata.labels) ? manifest.metadata.labels : {};
  manifest.metadata.labels = {
    [LABEL_NAME]: 'worca',                                  // defaults for a bare template; the template's own win
    [LABEL_INSTANCE]: scopeLabel(instanceId || 'worca'),
    ...own,
    [LABEL_COMPONENT]: 'worker',
    [LABEL_MANAGED_BY]: 'worca',
    [LABEL_WORCA_INSTANCE]: scopeLabel(instanceId || 'worca'),
    [LABEL_SCOPE]: scopeLabel(key),
    [LABEL_ENGINE]: scopeLabel(engine || 'unknown'),
    ...(bootId ? { [LABEL_BOOT]: scopeLabel(bootId) } : {}),
  };
  manifest.metadata.annotations = { ...(isObj(manifest.metadata.annotations) ? manifest.metadata.annotations : {}), [ANNOTATION_SCOPE]: key };

  container.image = image;
  const ours = Object.entries(env).filter(([, v]) => v !== undefined && v !== null).map(([n, v]) => ({ name: n, value: String(v) }));
  const ourNames = new Set(ours.map((e) => e.name));
  container.env = [...(Array.isArray(container.env) ? container.env : []).filter((e) => !ourNames.has(e?.name)), ...ours];
  if (hasAny(resources)) container.resources = structuredClone(resources);
  if (Number.isFinite(Number(activeDeadlineSeconds)) && Number(activeDeadlineSeconds) > 0) manifest.spec.activeDeadlineSeconds = Math.floor(Number(activeDeadlineSeconds));

  manifest.spec.restartPolicy = 'Never';
  manifest.spec.automountServiceAccountToken = false;
  manifest.spec.enableServiceLinks = false;
  const grace = Number(manifest.spec.terminationGracePeriodSeconds);
  manifest.spec.terminationGracePeriodSeconds = Number.isFinite(grace) ? Math.max(MIN_TERMINATION_GRACE_S, Math.floor(grace)) : MIN_TERMINATION_GRACE_S;
  return manifest;
}

/** The label selector that finds this controller instance's worker pods. */
export function workerSelector(instanceId = 'worca') {
  return `${LABEL_MANAGED_BY}=worca,${LABEL_COMPONENT}=worker,${LABEL_WORCA_INSTANCE}=${scopeLabel(instanceId || 'worca')}`;
}
