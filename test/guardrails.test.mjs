// test/guardrails.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GUARDRAILS, GUARDRAIL_LEVELS, GUARDRAIL_PRESETS,
  sanitizeGuardrails, validateGuardrails,
  sanitizeGuardrailsConfig, validateGuardrailsConfig, resolveGuardrails, detectPreset,
  guardrailsToPermissionRules, mergePermissionRules, unionGuardrails, isPermissionRule,
} from '../src/core/guardrails.mjs';

// ── 5-key settings layer (unchanged from v1 semantics) ───────────────────────

test('sanitizeGuardrails: garbage in -> defaults out, never throws', () => {
  for (const raw of [undefined, null, 'x', 42, [], { deny: 'not-an-array' }]) {
    assert.deepEqual(sanitizeGuardrails(raw), { ...DEFAULT_GUARDRAILS });
  }
});

test('sanitizeGuardrails: trims strings, drops empties and non-strings, keeps booleans', () => {
  const g = sanitizeGuardrails({
    honorProjectSettings: false, envScrub: true,
    envAllowlist: [' NPM_TOKEN ', '', 7], protectedPaths: ['.env*', '  '],
    deny: ['Bash(git push:*)', 'not a rule', 3],
  });
  assert.equal(g.honorProjectSettings, false);
  assert.equal(g.envScrub, true);
  assert.deepEqual(g.envAllowlist, ['NPM_TOKEN']);
  assert.deepEqual(g.protectedPaths, ['.env*']);
  assert.deepEqual(g.deny, ['Bash(git push:*)']);   // invalid rule silently dropped on the read path
});

test('validateGuardrails: strict — bad deny rule is an error, not a silent drop', () => {
  const v = validateGuardrails({ deny: ['not a rule'] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('not a rule')));
  assert.equal(validateGuardrails({ deny: ['Bash(curl:*)'] }).ok, true);
  assert.equal(validateGuardrails({ envScrub: 'yes' }).ok, false);
  assert.equal(validateGuardrails({}).ok, true);
});

test('isPermissionRule: Tool(pattern), bare tool, and mcp__ shapes', () => {
  assert.ok(isPermissionRule('Bash(git push:*)'));
  assert.ok(isPermissionRule('Bash(git push)'));
  assert.ok(isPermissionRule('Edit(./secrets/**)'));
  assert.ok(isPermissionRule('WebFetch(domain:github.com)'));
  assert.ok(isPermissionRule('WebFetch'));            // bare tool name is a valid rule
  assert.ok(isPermissionRule('mcp__db__write'));
  assert.ok(isPermissionRule('*'));                   // deny-all-tools glob is a valid rule
  assert.ok(isPermissionRule('mcp__*'));              // deny-all-MCP glob
  assert.ok(!isPermissionRule('rm -rf /'));           // shell text is not a rule
  assert.ok(!isPermissionRule('(oops)'));
});

test('guardrailsToPermissionRules: protectedPaths expand to Read+Edit deny (NO Write), raw deny appended de-duped', () => {
  const rules = guardrailsToPermissionRules({
    protectedPaths: ['.env*'], deny: ['Bash(curl:*)', 'Read(.env*)'],
  });
  assert.deepEqual(rules, {
    deny: ['Read(.env*)', 'Edit(.env*)', 'Bash(curl:*)'],   // no Write leg — the CLI never consults it and warns per rule per spawn
  });
});

test('guardrailsToPermissionRules: empty policy -> null (no --settings emitted downstream)', () => {
  assert.equal(guardrailsToPermissionRules({}), null);
  assert.equal(guardrailsToPermissionRules(DEFAULT_GUARDRAILS), null);
});

test('mergePermissionRules: de-duped union per key, null when both empty', () => {
  assert.deepEqual(
    mergePermissionRules({ deny: ['Bash(curl:*)'] }, { deny: ['Bash(curl:*)', 'Edit(./x)'], allow: ['Bash(npm:*)'] }),
    { deny: ['Bash(curl:*)', 'Edit(./x)'], allow: ['Bash(npm:*)'] },
  );
  assert.equal(mergePermissionRules(null, undefined), null);
  assert.equal(mergePermissionRules({}, { deny: [] }), null);
});

test('unionGuardrails: deny-safe union — scrub if ANY scrubs, restriction lists union, allowlist ONLY from scrubbing members', () => {
  const u = unionGuardrails([
    { ...DEFAULT_GUARDRAILS, envScrub: true, envAllowlist: ['A'], protectedPaths: ['.env*'] },
    // member2 does NOT scrub; its allowlist is dormant config and must NOT widen member1's scrub.
    { ...DEFAULT_GUARDRAILS, envScrub: false, envAllowlist: ['A', 'B'], deny: ['Bash(curl:*)'] },
  ]);
  assert.equal(u.envScrub, true);
  assert.deepEqual(u.envAllowlist, ['A'], 'only the scrubbing member contributes to the allowlist');
  assert.deepEqual(u.protectedPaths, ['.env*']);   // restriction lists still union across ALL members
  assert.deepEqual(u.deny, ['Bash(curl:*)']);
  // when a NON-scrubbing member also scrubs, its allowlist joins:
  const u2 = unionGuardrails([
    { ...DEFAULT_GUARDRAILS, envScrub: true, envAllowlist: ['A'] },
    { ...DEFAULT_GUARDRAILS, envScrub: true, envAllowlist: ['A', 'B'] },
  ]);
  assert.deepEqual(u2.envAllowlist, ['A', 'B']);
  // no members scrub -> empty allowlist regardless of dormant lists
  assert.deepEqual(
    unionGuardrails([{ ...DEFAULT_GUARDRAILS, envAllowlist: ['X'] }]).envAllowlist, [],
  );
  // honorProjectSettings is still unioned (advisory only — per-member honor gates the Task 6 lift; see there)
  assert.equal(unionGuardrails([{ ...DEFAULT_GUARDRAILS, honorProjectSettings: false }, { ...DEFAULT_GUARDRAILS }]).honorProjectSettings, true);
  assert.deepEqual(unionGuardrails([]), { ...DEFAULT_GUARDRAILS });
});

// ── preset levels layer (new in v2) ──────────────────────────────────────────

test('preset table snapshot — changing a preset is a deliberate, release-noted act', () => {
  assert.deepEqual(GUARDRAIL_LEVELS, ['permissive', 'normal', 'secure', 'custom']);
  assert.equal(GUARDRAIL_PRESETS.permissive, DEFAULT_GUARDRAILS, 'permissive IS the default object');
  assert.deepEqual(GUARDRAIL_PRESETS.normal, {
    honorProjectSettings: true,
    envScrub: false,
    envAllowlist: [],
    protectedPaths: ['.env*', '*.pem', '*.key', 'id_rsa', 'id_ed25519', '*.p12', '*.pfx'],
    deny: [
      'Bash(git push)', 'Bash(git push:*)',
      'Bash(npm publish)', 'Bash(npm publish:*)',
      'Bash(yarn publish)', 'Bash(yarn publish:*)',
      'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
    ],
  });
  assert.deepEqual(GUARDRAIL_PRESETS.secure, {
    honorProjectSettings: true,
    envScrub: true,
    envAllowlist: [],
    protectedPaths: [
      '.env*', '*.pem', '*.key', 'id_rsa', 'id_ed25519', '*.p12', '*.pfx',
      '.npmrc', '.netrc', '*.tfstate*', '*.keystore', '*.jks',
      '**/secrets/**', '**/.git/config', '~/.git-credentials',
      '~/.ssh/**', '~/.aws/**', '~/.config/gcloud/**', '~/.kube/**', '~/.config/gh/**',
      '~/.npmrc', '~/.netrc', '~/.docker/config.json',
    ],
    deny: [
      'Bash(git push)', 'Bash(git push:*)',
      'Bash(npm publish)', 'Bash(npm publish:*)',
      'Bash(yarn publish)', 'Bash(yarn publish:*)',
      'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
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
  });
  // Every preset value passes the strict validator (rules well-formed by construction).
  for (const level of ['permissive', 'normal', 'secure']) {
    assert.equal(validateGuardrails(GUARDRAIL_PRESETS[level]).ok, true, `${level} preset is valid`);
  }
  // Presets are deep-frozen — mutation attempts throw or no-op, never corrupt the table.
  assert.throws(() => { GUARDRAIL_PRESETS.normal.deny.push('Bash(x)'); }, TypeError);
});

test('legacy-parity chain: unset and permissive both resolve to the empty policy', () => {
  for (const stored of [undefined, null, {}, { level: 'permissive' }, { level: 'permissive', custom: null }]) {
    const eff = resolveGuardrails(stored);
    assert.deepEqual(eff, { ...DEFAULT_GUARDRAILS });
    assert.equal(guardrailsToPermissionRules(eff), null, 'no --settings for the empty policy');
    assert.equal(eff.envScrub, false, 'no env scrub for the empty policy');
  }
});

test('resolveGuardrails: preset levels resolve from the CODE table; custom resolves from storage', () => {
  assert.deepEqual(resolveGuardrails({ level: 'normal' }), { ...GUARDRAIL_PRESETS.normal });
  assert.deepEqual(resolveGuardrails({ level: 'secure' }), { ...GUARDRAIL_PRESETS.secure });
  const custom = { honorProjectSettings: false, envScrub: true, envAllowlist: ['X'], protectedPaths: ['*.sqlite'], deny: ['Bash(curl:*)'] };
  assert.deepEqual(resolveGuardrails({ level: 'custom', custom }), custom);
  // custom level with nothing stored degrades to the empty policy, never throws
  assert.deepEqual(resolveGuardrails({ level: 'custom' }), { ...DEFAULT_GUARDRAILS });
  // resolved preset objects are fresh copies — mutating them must not corrupt the table
  const r = resolveGuardrails({ level: 'normal' });
  r.deny.push('Bash(x)');
  assert.equal(GUARDRAIL_PRESETS.normal.deny.includes('Bash(x)'), false);
});

test('resolveGuardrails: dormant custom — preset level ignores a stored custom blob', () => {
  const stored = { level: 'normal', custom: { envScrub: true, deny: ['Bash(curl:*)'] } };
  assert.deepEqual(resolveGuardrails(stored), { ...GUARDRAIL_PRESETS.normal });
});

test('sanitizeGuardrailsConfig: v1 bare 5-key blob upgrades losslessly to custom', () => {
  const v1 = { envScrub: true, envAllowlist: ['NPM_TOKEN'], protectedPaths: ['.env*'], deny: ['Bash(curl:*)'] };
  const cfg = sanitizeGuardrailsConfig(v1);
  assert.equal(cfg.level, 'custom');
  assert.deepEqual(cfg.custom, sanitizeGuardrails(v1));
  // garbage / unset -> permissive
  for (const raw of [undefined, null, 'x', 42, [], {}]) {
    assert.deepEqual(sanitizeGuardrailsConfig(raw), { level: 'permissive', custom: null });
  }
  // unknown level string -> permissive (fail-open to parity), custom preserved if valid
  assert.deepEqual(sanitizeGuardrailsConfig({ level: 'paranoid' }), { level: 'permissive', custom: null });
});

test('validateGuardrailsConfig: level enum, custom validation, custom-required rule', () => {
  assert.equal(validateGuardrailsConfig({ level: 'normal' }, { hasStoredCustom: false }).ok, true);
  assert.equal(validateGuardrailsConfig({ level: 'paranoid' }, { hasStoredCustom: false }).ok, false);
  assert.equal(validateGuardrailsConfig({}, { hasStoredCustom: false }).ok, false, 'level required');
  const bad = validateGuardrailsConfig({ level: 'custom', custom: { deny: ['rm -rf /'] } }, { hasStoredCustom: false });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('rm -rf /')));
  // custom level with neither a payload nor a stored blob -> error
  assert.equal(validateGuardrailsConfig({ level: 'custom' }, { hasStoredCustom: false }).ok, false);
  // ...but fine when a dormant custom already exists in the DB
  assert.equal(validateGuardrailsConfig({ level: 'custom' }, { hasStoredCustom: true }).ok, true);
  // unknown wrapper keys rejected
  assert.equal(validateGuardrailsConfig({ level: 'normal', extra: 1 }, { hasStoredCustom: false }).ok, false);
});

test('detectPreset: round-trips every preset, order-insensitive, null on any perturbation', () => {
  assert.equal(detectPreset(GUARDRAIL_PRESETS.permissive), 'permissive');
  assert.equal(detectPreset(GUARDRAIL_PRESETS.normal), 'normal');
  assert.equal(detectPreset(GUARDRAIL_PRESETS.secure), 'secure');
  // reordering a list is NOT a customization (lists are semantically sets)
  const reordered = { ...GUARDRAIL_PRESETS.normal, deny: [...GUARDRAIL_PRESETS.normal.deny].reverse() };
  assert.equal(detectPreset(reordered), 'normal');
  // any real perturbation -> null (Custom)
  assert.equal(detectPreset({ ...GUARDRAIL_PRESETS.normal, envScrub: true }), null);
  assert.equal(detectPreset({ ...GUARDRAIL_PRESETS.normal, deny: [...GUARDRAIL_PRESETS.normal.deny, 'Bash(curl:*)'] }), null);
  assert.equal(detectPreset({ ...GUARDRAIL_PRESETS.normal, protectedPaths: [] }), null);
});
