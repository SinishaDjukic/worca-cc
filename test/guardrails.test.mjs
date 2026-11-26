// test/guardrails.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GUARDRAILS, GUARDRAIL_LEVELS, GUARDRAIL_PRESETS,
  sanitizeGuardrails, validateGuardrails,
  sanitizeGuardrailsConfig, validateGuardrailsConfig, resolveGuardrails, detectPreset,
  guardrailsToPermissionRules, mergePermissionRules, unionGuardrails, isPermissionRule, gateRules,
} from '../src/core/guardrails.mjs';
import { askPathDenied } from '../src/core/ask/deny-rules.mjs';

// The floor every policy with rules carries: Worca's secret files (Read+Edit) and the keychain/export command denies.
const LAUNCHERS = ['worca', 'worca-cc', 'npx worca', 'npx worca-cc', 'npx @worca/app', 'npm exec worca', 'npm exec @worca/app'];
const KEYCHAIN = ['security find-generic-password', 'security find-internet-password', 'security find-key', 'security dump-keychain',
  'security export', 'secret-tool lookup', 'secret-tool search',
  ...['export', 'reset', 'ack', 'status --check'].flatMap((verb) => LAUNCHERS.map((l) => `${l} secrets ${verb}`)),
  'env -u WORCA_HOST_PID', 'env --unset=WORCA_HOST_PID', 'unset WORCA_HOST_PID', 'env -i', 'env --ignore-environment'].flatMap((c) => [`Bash(${c})`, `Bash(${c}:*)`]);

// Whether a Bash command matches a deny rule, as Claude Code's prefix rules do: `Bash(p)` exact, `Bash(p:*)` p or p + space.
const bashDenied = (cmd, rules) => rules.some((r) => {
  const m = /^Bash\((.*)\)$/.exec(r);
  if (!m) return false;
  const p = m[1];
  if (p.endsWith(':*')) { const q = p.slice(0, -2); return cmd === q || cmd.startsWith(q + ' '); }
  return cmd === p;
});
const FLOOR = [
  'Read(//**/proxy-login.json*)', 'Edit(//**/proxy-login.json*)', 'Read(//**/worca-vault*)', 'Edit(//**/worca-vault*)',
  ...KEYCHAIN,
];

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
    // no Write leg — the CLI never consults it and warns per rule per spawn; the secret-file floor follows
    deny: ['Read(.env*)', 'Edit(.env*)', 'Bash(curl:*)', ...FLOOR],
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
    protectedPaths: [
      '.env*', '*.pem', '*.key', '.npmrc', '.netrc', 'id_*', '*.p12', '*.pfx', '//run/secrets/**',
      '//**/worca-cc.db*', '//**/worca.db*', '//**/.worca-cc/plugins/*/data/secrets.json',
      '//**/.worca-cc/settings.json', '//**/.worca-cc/mcp/**',
      '//**/proxy-login.json*', '//**/worca-vault*',
    ],
    deny: [
      'Bash(git push)', 'Bash(git push:*)',
      'Bash(npm publish)', 'Bash(npm publish:*)',
      'Bash(yarn publish)', 'Bash(yarn publish:*)',
      'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
      ...KEYCHAIN,
      'Edit(//**/.worca-cc/plugins/**)', 'Edit(//**/.worca-cc/scripts/**)',
      'Edit(//**/.worca-cc/agents/**)', 'Edit(//**/.worca-cc/workflows/**)',
      'Edit(//**/.worca-cc/policy/**)',
    ],
  });
  assert.deepEqual(GUARDRAIL_PRESETS.secure, {
    honorProjectSettings: true,
    envScrub: true,
    envAllowlist: [],
    protectedPaths: [
      '.env*', '*.pem', '*.key', '.npmrc', '.netrc', 'id_*', '*.p12', '*.pfx', '//run/secrets/**',
      '//**/worca-cc.db*', '//**/worca.db*', '//**/.worca-cc/plugins/*/data/secrets.json',
      '//**/.worca-cc/settings.json', '//**/.worca-cc/mcp/**',
      '//**/proxy-login.json*', '//**/worca-vault*',
      '*.tfstate*', '*.keystore', '*.jks',
      '**/secrets/**', '**/.git/config', '~/.git-credentials',
      '~/.ssh/**', '~/.aws/**', '~/.config/gcloud/**', '~/.kube/**', '~/.config/gh/**',
      '~/.npmrc', '~/.netrc', '~/.docker/config.json',
      '~/.claude/.credentials.json', '~/.gnupg/**',
    ],
    deny: [
      'Bash(git push)', 'Bash(git push:*)',
      'Bash(npm publish)', 'Bash(npm publish:*)',
      'Bash(yarn publish)', 'Bash(yarn publish:*)',
      'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
      ...KEYCHAIN,
      'Edit(//**/.worca-cc/plugins/**)', 'Edit(//**/.worca-cc/scripts/**)',
      'Edit(//**/.worca-cc/agents/**)', 'Edit(//**/.worca-cc/workflows/**)',
      'Edit(//**/.worca-cc/policy/**)',
      'Bash(curl)', 'Bash(curl:*)', 'Bash(wget)', 'Bash(wget:*)',
      'Bash(nc)', 'Bash(nc:*)', 'Bash(ncat)', 'Bash(ncat:*)', 'Bash(netcat)', 'Bash(netcat:*)',
      'Bash(telnet)', 'Bash(telnet:*)',
      'Bash(ssh)', 'Bash(ssh:*)', 'Bash(scp)', 'Bash(scp:*)', 'Bash(sftp)', 'Bash(sftp:*)',
      'Bash(rsync)', 'Bash(rsync:*)', 'Bash(ftp)', 'Bash(ftp:*)',
      'Bash(gh)', 'Bash(gh:*)',
      'Bash(docker push)', 'Bash(docker push:*)',
      'Bash(aws)', 'Bash(aws:*)', 'Bash(gcloud)', 'Bash(gcloud:*)', 'Bash(az)', 'Bash(az:*)',
      'Bash(git clone)', 'Bash(git clone:*)', 'Bash(git fetch)', 'Bash(git fetch:*)',
      'Bash(git pull)', 'Bash(git pull:*)', 'Bash(git ls-remote)', 'Bash(git ls-remote:*)',
      'Bash(git remote add)', 'Bash(git remote add:*)', 'Bash(git remote set-url)', 'Bash(git remote set-url:*)',
      'Bash(dig)', 'Bash(dig:*)', 'Bash(nslookup)', 'Bash(nslookup:*)',
      'Bash(socat)', 'Bash(socat:*)',
      'Bash(openssl s_client)', 'Bash(openssl s_client:*)',
      'Bash(aria2c)', 'Bash(aria2c:*)', 'Bash(lynx)', 'Bash(lynx:*)', 'Bash(w3m)', 'Bash(w3m:*)',
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

test('Strict denies the extra egress commands (exact+prefix); Normal denies none', () => {
  const cmds = [
    'git clone', 'git fetch', 'git pull', 'git ls-remote', 'git remote add', 'git remote set-url',
    'dig', 'nslookup', 'socat', 'openssl s_client', 'aria2c', 'lynx', 'w3m',
  ];
  for (const c of cmds) {
    assert.ok(GUARDRAIL_PRESETS.secure.deny.includes(`Bash(${c})`), `secure denies Bash(${c})`);
    assert.ok(GUARDRAIL_PRESETS.secure.deny.includes(`Bash(${c}:*)`), `secure denies Bash(${c}:*)`);
    assert.ok(!GUARDRAIL_PRESETS.normal.deny.includes(`Bash(${c})`), `normal must not deny Bash(${c})`);
    assert.ok(!GUARDRAIL_PRESETS.normal.deny.includes(`Bash(${c}:*)`), `normal must not deny Bash(${c}:*)`);
  }
});

test('Strict leaves local git, interpreters and installs usable', () => {
  for (const r of ['Bash(git)', 'Bash(git:*)', 'Bash(node:*)', 'Bash(python:*)', 'Bash(npm install:*)']) {
    assert.ok(!GUARDRAIL_PRESETS.secure.deny.includes(r), `secure must not deny ${r}`);
  }
});

test('worca state: DB/secrets/MCP are Read+Edit denied; plugins etc. are Edit-only', () => {
  const rules = guardrailsToPermissionRules(GUARDRAIL_PRESETS.normal).deny;
  for (const r of ['Read(//**/worca-cc.db*)', 'Edit(//**/.worca-cc/mcp/**)', 'Edit(//**/.worca-cc/plugins/**)']) {
    assert.ok(rules.includes(r), `${r} present`);
  }
  const pluginReads = rules.filter((r) => r.startsWith('Read(') && r.includes('.worca-cc/plugins'));
  assert.deepEqual(pluginReads, ['Read(//**/.worca-cc/plugins/*/data/secrets.json)'], 'plugins stay readable except their secrets');
});

test('worca state: runs/store/memory and ~/.claude/** are deliberately not denied', () => {
  for (const level of ['normal', 'secure']) {
    const rules = guardrailsToPermissionRules(GUARDRAIL_PRESETS[level]).deny;
    for (const r of rules) {
      assert.ok(!/\.worca-cc\/(runs|store|memory)/.test(r), `${level}: ${r}`);
      assert.notEqual(r, '~/.claude/**');
      assert.notEqual(r, 'Read(~/.claude/**)');
    }
  }
});

test('worca state: plugin secrets are protected by exact path, not a blanket secrets.json match', () => {
  // run worktrees live under <home>/runs/<id>/, so a `.worca-cc/**/secrets.json`
  // glob would also deny a project's own secrets.json file.
  for (const level of ['normal', 'secure']) {
    const paths = GUARDRAIL_PRESETS[level].protectedPaths;
    assert.ok(paths.includes('//**/.worca-cc/plugins/*/data/secrets.json'), `${level}: plugin secrets path`);
    assert.ok(!paths.includes('//**/.worca-cc/**/secrets.json'), `${level}: no blanket secrets.json glob`);
  }
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

// ── the memory floor (agent-memory-design.md §13) ────────────────────────────

test('no preset protects a memory mount path: a defragment run is never blocked by a protected-path rule', () => {
  // The documented protectedPaths semantics (guardrails.mjs, "Rule-spelling invariants"): a
  // slash-less pattern is a BASENAME glob matched at any depth; a slash-containing pattern is a
  // path glob anchored at the run cwd unless it opens with `**/`.
  const esc = (p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const globRe = (p) => new RegExp(`^${p.split('**/').map((part) => esc(part).replace(/\*/g, '[^/]*')).join('(?:.*/)?')}$`);
  const protects = (pat, rel) => (pat.includes('/') ? globRe(pat).test(rel) : globRe(pat).test(rel.split('/').pop()));
  assert.equal(protects('.env*', 'a/b/.env.local'), true, 'the matcher itself is not vacuous');
  assert.equal(protects('**/secrets/**', 'deep/secrets/token.txt'), true);
  const MOUNTED = ['.claude/rules/worca/global/testing.md', '.claude/rules/worca/project/conventions.md', '.claude/rules/worca/projects/demo-00000001/conventions.md',
    '.claude/rules/worca/team/deploy.md', '.claude/rules/worca/team/demo-00000001/deploy.md'];
  for (const [level, preset] of Object.entries(GUARDRAIL_PRESETS)) {
    for (const pat of preset.protectedPaths) {
      for (const rel of MOUNTED) {
        assert.equal(protects(pat, rel), false, `${level}: "${pat}" would protect the memory file ${rel}`);
      }
    }
  }
});

// ── Worca's secret files and keychain reads (secrets in the OS store, slice 1) ─────────────────

const SECRET_HOME_FILES = ['/srv/worca/worca-vault.enc', '/srv/worca/worca-vault.enc.unreadable-20261121T101500Z',
  '/srv/worca/worca-vault.key', '/srv/worca/proxy-login.json'];

test('secret files: the normal and secure presets protect both root-anchored forms and deny keychain reads', () => {
  for (const level of ['normal', 'secure']) {
    const p = GUARDRAIL_PRESETS[level];
    for (const r of ['//**/proxy-login.json*', '//**/worca-vault*']) assert.ok(p.protectedPaths.includes(r), `${level}: ${r}`);
    for (const r of ['Bash(security find-generic-password:*)', 'Bash(worca secrets export:*)', 'Bash(worca secrets reset:*)', 'Bash(npx @worca/app secrets reset)']) assert.ok(p.deny.includes(r), `${level}: ${r}`);
    for (const r of ['Bash(worca-cc secrets export:*)', 'Bash(npx worca-cc secrets export:*)', 'Bash(npm exec worca secrets export:*)',
      'Bash(npm exec @worca/app secrets export:*)', 'Bash(npm exec worca secrets reset:*)', 'Bash(worca secrets ack)', 'Bash(npx @worca/app secrets ack:*)',
      'Bash(npm exec @worca/app secrets ack:*)', 'Bash(worca secrets status --check)', 'Bash(worca secrets status --check:*)',
      'Bash(npx @worca/app secrets status --check:*)', 'Bash(env -u WORCA_HOST_PID:*)', 'Bash(unset WORCA_HOST_PID:*)', 'Bash(env -i:*)', 'Bash(env --ignore-environment:*)']) assert.ok(p.deny.includes(r), `${level}: ${r}`);
  }
});

test('secret floor: every env -i and env --ignore-environment command is refused, the working PATH= export form included', () => {
  const deny = guardrailsToPermissionRules(GUARDRAIL_PRESETS.normal).deny;
  for (const cmd of ['env -i PATH=$PATH worca secrets export --yes', 'env -i worca secrets export', 'env -i A=1 worca secrets export',
    'env --ignore-environment npx @worca/app secrets reset', 'env -i security find-generic-password -s x',
    // A harmless env -i use is refused too: the accepted cost of the broad rule.
    'env -i PATH=/usr/bin make test', 'env -i', 'env --ignore-environment ls']) assert.ok(bashDenied(cmd, deny), cmd);
});

test('secret floor: 80 keychain Bash rules plus 4 file rules, every one a Bash(c)/Bash(c:*) pair', () => {
  const floor = guardrailsToPermissionRules({ ...DEFAULT_GUARDRAILS, deny: ['Bash(rm:*)'] }).deny.filter((r) => r !== 'Bash(rm:*)');
  assert.equal(floor.length, 84);
  const bash = floor.filter((r) => r.startsWith('Bash('));
  assert.equal(bash.length, 80);
  for (let i = 0; i < bash.length; i += 2) assert.equal(bash[i + 1], bash[i].slice(0, -1) + ':*)', bash[i]);
  assert.deepEqual(floor.filter((r) => !r.startsWith('Bash(')).length, 4);
});

test('secret files: the generated rules deny the files under a custom home, outside the agent cwd', () => {
  const sets = { normal: GUARDRAIL_PRESETS.normal, secure: GUARDRAIL_PRESETS.secure, custom: { ...DEFAULT_GUARDRAILS, deny: ['Bash(rm:*)'] } };
  for (const [name, g] of Object.entries(sets)) {
    const rules = guardrailsToPermissionRules(g).deny;
    for (const f of SECRET_HOME_FILES) assert.ok(askPathDenied(f, { rules, home: '/home/u' }), `${name}: ${f}`);
    for (const r of FLOOR) assert.ok(rules.includes(r), `${name}: ${r}`);
  }
});

test('secret files: a set that yields no rules still yields null (permissive spawn argv unchanged)', () => {
  assert.equal(guardrailsToPermissionRules(DEFAULT_GUARDRAILS), null);
  assert.equal(guardrailsToPermissionRules({ ...DEFAULT_GUARDRAILS, envScrub: true }), null);
});

test('gateRules: removes the floor, so the gates weigh exactly the rules a set had before', () => {
  const withoutFloor = (g) => {
    const gg = sanitizeGuardrails(g);
    const deny = [];
    for (const p of gg.protectedPaths) for (const r of [`Read(${p})`, `Edit(${p})`]) if (!FLOOR.includes(r) && !deny.includes(r)) deny.push(r);
    for (const r of gg.deny) if (!FLOOR.includes(r) && !deny.includes(r)) deny.push(r);
    return deny.length ? { deny } : null;
  };
  for (const g of [GUARDRAIL_PRESETS.normal, GUARDRAIL_PRESETS.secure, { ...DEFAULT_GUARDRAILS, deny: ['Bash', 'WebSearch'] }, { ...DEFAULT_GUARDRAILS, deny: ['WebFetch'] }]) {
    assert.deepEqual(gateRules(guardrailsToPermissionRules(g)), withoutFloor(g));
  }
  assert.deepEqual(gateRules(guardrailsToPermissionRules({ ...DEFAULT_GUARDRAILS, deny: ['Bash', 'WebSearch'] })), { deny: ['Bash', 'WebSearch'] });
  assert.equal(gateRules(null), null);
  assert.equal(gateRules({ deny: [...FLOOR] }), null);
  assert.deepEqual(gateRules({ deny: [...FLOOR], allow: ['Bash(npm:*)'] }), { allow: ['Bash(npm:*)'] });
});
