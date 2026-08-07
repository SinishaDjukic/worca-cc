// src/core/guardrails.mjs
// Per-project guardrails: the pure policy layer.
//   - 5-key settings shape: { honorProjectSettings, envScrub, envAllowlist,
//     protectedPaths, deny } — what enforcement consumes.
//   - stored config shape:  { level, custom } — what the DB holds. Preset levels
//     resolve from GUARDRAIL_PRESETS at read time so preset improvements ship
//     with worca upgrades; `custom` is the user's pinned blob (dormant unless
//     level === 'custom', preserved across level switches).
// Storage: project_config.extra.guardrails (config.mjs). Enforcement: a Claude
// Code `permissions` object in ONE --settings payload + a scrubbed spawn env
// (claude-runner.mjs). Everything here is pure and throw-free except the
// validate* functions, which report instead of throwing.
//
// Rule-spelling invariants (see plan Global Constraints):
//   - Bash denies are exact+prefix PAIRS: Bash(cmd) + Bash(cmd:*).
//   - protectedPaths: slash-less patterns match at any depth; slash-containing
//     patterns MUST carry a **/ prefix or they anchor to cwd and miss members
//     on detached workspace runs.

export const DEFAULT_GUARDRAILS = Object.freeze({
  honorProjectSettings: true,
  envScrub: false,
  envAllowlist: Object.freeze([]),
  protectedPaths: Object.freeze([]),
  deny: Object.freeze([]),
});

export const GUARDRAIL_LEVELS = Object.freeze(['permissive', 'normal', 'secure', 'custom']);

const deepFreeze = (o) => {
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
};

// Credential-material file patterns every non-permissive level protects.
const NORMAL_PROTECTED = [
  '.env*',                 // .env, .env.local, .env.production, .envrc — any depth
  '*.pem', '*.key',        // TLS / private key material
  'id_rsa', 'id_ed25519',  // bare SSH keys checked into odd places
  '*.p12', '*.pfx',        // bundled cert+key stores
];

// Irreversible-publication commands no pipeline role ever needs.
const NORMAL_DENY = [
  'Bash(git push)', 'Bash(git push:*)',
  'Bash(npm publish)', 'Bash(npm publish:*)',
  'Bash(yarn publish)', 'Bash(yarn publish:*)',
  'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
];

/**
 * The built-in levels. `custom` is not here — it resolves from storage.
 * permissive IS DEFAULT_GUARDRAILS (same object): an unconfigured project and a
 * permissive project are indistinguishable, including byte-identical spawn argv.
 * Normal: protect credential files, block publication; never breaks a pipeline
 * (git commit / npm install / npm test / curl localhost all untouched).
 * Secure++: Normal + env scrub (the real exfil control) + egress binaries +
 * publish channels + cloud-credential CLIs + WebFetch/WebSearch (defense against
 * frontmatter-widened agents). Still functional: project file Read/Write/Edit,
 * npm install/test, and local git commits are untouched.
 */
export const GUARDRAIL_PRESETS = deepFreeze({
  permissive: DEFAULT_GUARDRAILS,
  normal: {
    honorProjectSettings: true,
    envScrub: false,
    envAllowlist: [],
    protectedPaths: [...NORMAL_PROTECTED],
    deny: [...NORMAL_DENY],
  },
  secure: {
    honorProjectSettings: true,
    envScrub: true,
    envAllowlist: [],
    protectedPaths: [
      ...NORMAL_PROTECTED,
      '.npmrc', '.netrc',            // token-bearing rc files (project-level)
      '*.tfstate*',                  // terraform state embeds raw secrets
      '*.keystore', '*.jks',
      '**/secrets/**',               // slash-containing ⇒ needs **/ (anchoring)
      '**/.git/config',              // can embed https://user:token@ remotes
      '~/.git-credentials',          // git credential-store: plaintext https://user:token@ lines
      '~/.ssh/**', '~/.aws/**', '~/.config/gcloud/**', '~/.kube/**', '~/.config/gh/**',  // gh hosts.yml holds the OAuth token
      '~/.npmrc', '~/.netrc', '~/.docker/config.json',
    ],
    deny: [
      ...NORMAL_DENY,
      'Bash(curl)', 'Bash(curl:*)', 'Bash(wget)', 'Bash(wget:*)',
      'Bash(nc)', 'Bash(nc:*)', 'Bash(ncat)', 'Bash(ncat:*)', 'Bash(netcat)', 'Bash(netcat:*)',
      'Bash(telnet)', 'Bash(telnet:*)',
      'Bash(ssh)', 'Bash(ssh:*)', 'Bash(scp)', 'Bash(scp:*)', 'Bash(sftp)', 'Bash(sftp:*)',
      'Bash(rsync)', 'Bash(rsync:*)', 'Bash(ftp)', 'Bash(ftp:*)',
      'Bash(gh)', 'Bash(gh:*)',
      'Bash(docker push)', 'Bash(docker push:*)',
      'Bash(aws)', 'Bash(aws:*)', 'Bash(gcloud)', 'Bash(gcloud:*)', 'Bash(az)', 'Bash(az:*)',
      'WebFetch', 'WebSearch',
    ],
  },
});

// A permission rule is `Tool(pattern)` (pattern non-empty), a bare tool name, a
// tool-name glob (`*` = all tools, `Bash*`), or an mcp__ tool id. Deliberately
// permissive inside the parens — the CLI owns pattern semantics; we only reject
// obvious shell text / malformed shapes. (The `*`/`Tool*` forms are valid deny
// globs per Claude Code docs; accepting them keeps the custom editor from 400ing
// a legitimate rule.)
const RULE_RE = /^(?:[A-Za-z*][A-Za-z0-9_*]*(?:\(.+\))?|mcp__[A-Za-z0-9_.*-]+(?:__[A-Za-z0-9_.*-]+)*)$/;

export function isPermissionRule(s) {
  return typeof s === 'string' && RULE_RE.test(s.trim());
}

const cleanStrings = (v) =>
  Array.isArray(v) ? v.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean) : [];

/** Read-path sanitizer for the 5-key settings shape. Malformed → defaults; invalid deny rules drop. */
export function sanitizeGuardrails(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    honorProjectSettings:
      typeof src.honorProjectSettings === 'boolean' ? src.honorProjectSettings : true,
    envScrub: src.envScrub === true,
    envAllowlist: cleanStrings(src.envAllowlist),
    protectedPaths: cleanStrings(src.protectedPaths),
    deny: cleanStrings(src.deny).filter(isPermissionRule),
  };
}

/** Write-path validator for the 5-key settings shape: strict, collects errors, never throws. */
export function validateGuardrails(raw) {
  const errors = [];
  if (raw === undefined || raw === null) return { ok: true, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['guardrails must be an object'] };
  for (const k of ['honorProjectSettings', 'envScrub']) {
    if (k in raw && typeof raw[k] !== 'boolean') errors.push(`${k} must be a boolean`);
  }
  for (const k of ['envAllowlist', 'protectedPaths', 'deny']) {
    if (k in raw) {
      if (!Array.isArray(raw[k])) errors.push(`${k} must be an array of strings`);
      else for (const s of raw[k]) if (typeof s !== 'string' || !s.trim()) errors.push(`${k} entries must be non-empty strings`);
    }
  }
  if (Array.isArray(raw.deny)) {
    for (const r of raw.deny) {
      if (typeof r === 'string' && r.trim() && !isPermissionRule(r)) {
        errors.push(`deny rule "${r}" is not a valid permission rule (expected Tool(pattern))`);
      }
    }
  }
  const known = new Set(['honorProjectSettings', 'envScrub', 'envAllowlist', 'protectedPaths', 'deny']);
  for (const k of Object.keys(raw)) if (!known.has(k)) errors.push(`unknown key "${k}"`);
  return { ok: errors.length === 0, errors };
}

const FIVE_KEYS = ['honorProjectSettings', 'envScrub', 'envAllowlist', 'protectedPaths', 'deny'];

/**
 * Read-path sanitizer for the STORED config shape.
 * { level, custom } passes through (bad level fails open to permissive — parity);
 * a v1-era bare 5-key blob upgrades losslessly to { level:'custom', custom };
 * anything else → { level:'permissive', custom:null }.
 * Lenient about unknown wrapper keys by design (a future v3 blob read by v2
 * degrades gracefully); the WRITE path (validateGuardrailsConfig) stays strict.
 */
export function sanitizeGuardrailsConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { level: 'permissive', custom: null };
  const custom = raw.custom && typeof raw.custom === 'object' && !Array.isArray(raw.custom)
    ? sanitizeGuardrails(raw.custom)
    : null;
  if (typeof raw.level === 'string') {
    return GUARDRAIL_LEVELS.includes(raw.level)
      ? { level: raw.level, custom }
      : { level: 'permissive', custom };
  }
  if (FIVE_KEYS.some((k) => k in raw)) return { level: 'custom', custom: sanitizeGuardrails(raw) };
  return { level: 'permissive', custom: null };
}

/**
 * Write-path validator for the { level, custom? } shape (the API's 400 source).
 * @param {object} raw
 * @param {{hasStoredCustom?: boolean}} opts  whether the DB already holds a custom blob
 */
export function validateGuardrailsConfig(raw, { hasStoredCustom = false } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['guardrails must be an object'] };
  }
  if (!GUARDRAIL_LEVELS.includes(raw.level)) {
    errors.push(`level must be one of: ${GUARDRAIL_LEVELS.join(', ')}`);
  }
  const hasCustomPayload = raw.custom !== undefined && raw.custom !== null;
  if (hasCustomPayload) {
    const v = validateGuardrails(raw.custom);
    errors.push(...v.errors);
  } else if (raw.level === 'custom' && !hasStoredCustom) {
    errors.push('custom guardrail settings required when level is "custom"');
  }
  const known = new Set(['level', 'custom']);
  for (const k of Object.keys(raw)) if (!known.has(k)) errors.push(`unknown key "${k}"`);
  return { ok: errors.length === 0, errors };
}

/**
 * Stored config → EFFECTIVE 5-key settings. Preset levels resolve from the code
 * table (fresh copies — the frozen table never leaks); custom resolves from the
 * stored blob (null custom degrades to the empty policy).
 */
export function resolveGuardrails(stored) {
  const cfg = sanitizeGuardrailsConfig(stored);
  if (cfg.level === 'custom') return cfg.custom ? { ...cfg.custom, envAllowlist: [...cfg.custom.envAllowlist], protectedPaths: [...cfg.custom.protectedPaths], deny: [...cfg.custom.deny] } : sanitizeGuardrails(undefined);
  return sanitizeGuardrails(GUARDRAIL_PRESETS[cfg.level]);
}

const presetKey = (g) => {
  const s = sanitizeGuardrails(g);
  return JSON.stringify({
    honorProjectSettings: s.honorProjectSettings,
    envScrub: s.envScrub,
    envAllowlist: [...new Set(s.envAllowlist)].sort(),
    protectedPaths: [...new Set(s.protectedPaths)].sort(),
    deny: [...new Set(s.deny)].sort(),
  });
};

/**
 * Which built-in preset a 5-key settings object equals, or null (⇒ Custom).
 * Order-insensitive: the lists are semantically sets (everything downstream
 * de-dupes/unions), so a reordered list must not read as "customised".
 */
export function detectPreset(settings) {
  const key = presetKey(settings);
  for (const level of ['permissive', 'normal', 'secure']) {
    if (presetKey(GUARDRAIL_PRESETS[level]) === key) return level;
  }
  return null;
}

/** Expand 5-key settings into Claude Code permission rules. null when empty. */
export function guardrailsToPermissionRules(g) {
  const gg = sanitizeGuardrails(g);
  const deny = [];
  const push = (r) => { if (!deny.includes(r)) deny.push(r); };
  // Read + Edit ONLY. Claude Code consults only Read/Edit path rules for file
  // permissions (Edit covers all file-editing tools: Write/NotebookEdit); a
  // Write() rule is never consulted AND prints a stderr warning per rule per
  // spawn on CLI 2.1.210+ (which runReal folds into the failure message). Read
  // is the load-bearing secret guard; a Read deny also blocks Edit (≥2.1.208).
  for (const p of gg.protectedPaths) { push(`Read(${p})`); push(`Edit(${p})`); }
  for (const r of gg.deny) push(r);
  return deny.length ? { deny } : null;
}

/** De-duped union of two {deny?,allow?,ask?} rule objects. null when empty. */
export function mergePermissionRules(a, b) {
  const out = {};
  for (const key of ['deny', 'allow', 'ask']) {
    const seen = new Set();
    const arr = [];
    for (const src of [a, b]) {
      for (const r of Array.isArray(src?.[key]) ? src[key] : []) {
        if (typeof r === 'string' && r.trim() && !seen.has(r)) { seen.add(r); arr.push(r); }
      }
    }
    if (arr.length) out[key] = arr;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Deny-safe union across workspace members' EFFECTIVE settings: any member
 * scrubbing scrubs the run; the RESTRICTION lists (protectedPaths, deny) union
 * de-duped across ALL members; the envAllowlist — a WIDENER — unions ONLY over
 * members that actually scrub, so a non-scrubbing member's dormant allowlist can
 * never punch a hole in another member's scrub. More guarding always wins; a
 * member can never relax another member's policy. (Permissive member + Secure
 * member ⇒ Secure for the whole run — by design; surfaced in docs (Task 12) and
 * the panel hint (Task 10).)
 * NOTE: `honorProjectSettings` is unioned here for shape completeness only and is
 * ADVISORY — the repo-settings lift is gated PER MEMBER by each member's own
 * honorProjectSettings (Task 6/7), never by this any-true scalar.
 */
export function unionGuardrails(list) {
  const gs = (Array.isArray(list) ? list : []).map(sanitizeGuardrails);
  if (!gs.length) return sanitizeGuardrails(undefined);
  const unionList = (src, key) => {
    const seen = new Set();
    const arr = [];
    for (const g of src) for (const s of g[key]) if (!seen.has(s)) { seen.add(s); arr.push(s); }
    return arr;
  };
  const scrubbers = gs.filter((g) => g.envScrub);
  return {
    honorProjectSettings: gs.some((g) => g.honorProjectSettings),
    envScrub: scrubbers.length > 0,
    envAllowlist: unionList(scrubbers, 'envAllowlist'),
    protectedPaths: unionList(gs, 'protectedPaths'),
    deny: unionList(gs, 'deny'),
  };
}
