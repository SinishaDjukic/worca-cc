// test/secret-scan.test.mjs — the ONE pre-push detector (src/core/secret-scan.mjs): the redactors' credential shapes
// (reused, not copied), plus emails / private addresses / internal hosts / home paths; rule + line, never the value;
// prose stays clean; linear on hostile input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets, describeFindings, SECRET_SCAN_MAX_CHARS } from '../src/core/secret-scan.mjs';
import { redactSecrets as redactWorkspace } from '../src/shared/workspace-map/redact.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { redactSecrets as redactBroker } from '../src/core/redact.mjs';
import { loadBudget } from './helpers/load-budget.mjs';

// Built at run time: no token-shaped literal sits in the repo (push protection scans sources).
const T = (prefix, n, ch = 'a1') => prefix + ch.repeat(Math.ceil(n / ch.length)).slice(0, n);

test('every credential shape is flagged once per line — and each sample is one a redactor already removes (reuse)', () => {
  const samples = [
    [T('ghp_', 36), 'api-token'], [T('github_pat_', 40), 'api-token'], [T('glpat-', 20), 'api-token'],
    [T('xoxb-', 24), 'api-token'], [T('sk_live_', 24), 'api-token'], [T('AIza', 35), 'api-token'],
    [T('sk-ant-api03-', 40), 'api-token'], ['AKIAABCDEFGHIJKLMNOP', 'aws-key'],
    [`eyJ${T('', 12)}.eyJ${T('', 12)}.${T('', 12)}`, 'jwt'], ['postgres://app:s3cr3tPass@db/x', 'url-credentials'],
    [['https://hooks.slack.com/services', 'T0123ABCD', 'B0123ABCD', 'abcdefghijklmnopqrstuvwx'].join('/'), 'webhook-url'],
    ['Authorization: Bearer abcDEF1234567890xyz', 'auth-header'], [T('wbt_', 43), 'broker-token'],
    [`123456789:${T('', 35, 'AbC')}`, 'telegram-bot-token'], [`bot7012345678:${T('AAH', 35, 'xY1')}`, 'telegram-bot-token'],
    [T('xapp-1-', 30), 'slack-app-token'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----', 'private-key'], ['-----BEGIN PGP PRIVATE KEY BLOCK-----', 'private-key'],
  ];
  for (const [s, rule] of samples) {
    const f = scanSecrets(`see ${s} there`);
    assert.deepEqual(f.map((x) => x.rule), [rule], `${rule}: ${JSON.stringify(f)}`);
    assert.equal(f[0].kind, 'secret');
    assert.ok(redactWorkspace(s) !== s || redactAskText(s) !== s || redactBroker(s) !== s, `${rule}: a redactor knows this shape`);
  }
});

test('credential assignments, query credentials and connection strings are flagged; references, limits and prose are not', () => {
  for (const [s, rule] of [
    ['DB_PASSWORD=Sup3rS3cret', 'env-credential'], ['export API_KEY="abcdef123456"', 'env-credential'],
    ['PGPASSWORD=postgres psql -h db', 'env-credential'], ['AWS_SECRET_ACCESS_KEY: wJalrXUtnFEMI2K7MDENG', 'env-credential'],
    ['https://x.test/cb?access_token=abcdef123456', 'query-credential'], ['GET /blob?sig=abcdEFGH12345678', 'query-credential'],
    ['client_secret=SuperSecret123&grant_type=client_credentials', 'query-credential'],
    ['app:pw123456@tcp(db:3306)/shop', 'dsn-credentials'], ['jdbc:oracle:thin:scott/tiger99@db:1521/x', 'dsn-credentials'],
    // the config-file forms: lower-case, camelCase and quoted keys, an Azure connection string, an .npmrc auth token
    ['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'kv-credential'], ['password: S3cretPass99', 'kv-credential'],
    ['"client_secret": "S3cretValue123456"', 'kv-credential'], ["apiKey: 'abcd1234efgh5678ijkl'", 'kv-credential'],
    ['db_password=S3cretPass99', 'kv-credential'], [`//registry.npmjs.org/:_authToken=${['12345678', 'abcd', '1234', 'abcd', '1234567890ab'].join('-')}`, 'kv-credential'],
    ['DefaultEndpointsProtocol=https;AccountName=shop;AccountKey=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA==;EndpointSuffix=core.windows.net', 'kv-credential'],
    ['curl -u admin:S3cretPass99 https://api.shop.test/x', 'cli-credentials'],
    // a secret KEY (Django / Flask SECRET_KEY, Rails SECRET_KEY_BASE) and dotted provider tokens (Google OAuth, SendGrid)
    ['SECRET_KEY=django-insecure-7x9kq2m4p8w3z5', 'env-credential'], ["SECRET_KEY = 'django-insecure-7x9kq2m4p8w3z5'", 'env-credential'],
    ['SECRET_KEY_BASE=8f1d2c3b4a5e6f7a8b9c0d1e2f3a4b5c', 'env-credential'], ['JWT_SECRET_KEY=Zk3pQ9rT2vX8wY4m', 'env-credential'],
    ['secret_key: S3cretValue99', 'kv-credential'], ['secretKey: "S3cretValue99"', 'kv-credential'],
    ['"access_token": "ya29.a0AfH6SMBxyzQqRrSsTtUu1234"', 'kv-credential'],
    [`sendgrid_api_key: ${T('SG.', 22, 'aBc')}${T('.', 43, 'xYz9')}`, 'api-token'],
    // markdown's backticked value; CLI flags (GNU, Go, Java -D, Gradle -P); `$` or `*` inside a password (refine cycle 4)
    ['The test DB password: `S3cretPass99`', 'kv-credential'], ['- API_KEY: `ab12cd34ef56ab12`', 'env-credential'],
    ['mysql --password=S3cretPass99 -h db', 'kv-credential'], ['deploy --api-key=abcd1234efgh5678ijkl', 'kv-credential'],
    ['go run . -password=S3cretPass99', 'kv-credential'], ['mvn flyway:migrate -Dflyway.password=S3cretPass99', 'kv-credential'],
    ['./gradlew publish -PossrhPassword=S3cretPass99', 'kv-credential'], ['DB_PASSWORD=Xy$9kLmN2pQr', 'env-credential'],
    ['postgres://app:Xy$9kLmN2pQr@db:5432/shop', 'url-credentials'], ['app:pa$$w0rd99@tcp(db:3306)/shop', 'dsn-credentials'],
    ['curl -u admin:Pa$$w0rd99 https://api.shop.test/x', 'cli-credentials'],
    // PASS names and environment suffixes; any Authorization scheme; auth keys (docker config.json, .npmrc, BASIC_AUTH)
    ['DB_PASS=S3cretPass99', 'env-credential'], ['db_pass=S3cretPass99', 'kv-credential'], ['DB_PASSWORD_PROD=S3cretPass99', 'env-credential'],
    ['Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b', 'auth-scheme'],
    ['"auth": "YWxpY2U6Z2hwX2FiY2RlZjEyMzQ1Ng=="', 'kv-credential'], ['_auth=dXNlcjpTM2NyZXRQYXNzOTk=', 'kv-credential'],
    ['BASIC_AUTH=admin:S3cretPass99', 'env-credential'],
    // column-aligned config (.env, properties, YAML, JSON): a run of spaces or tabs on either side of the separator
    [`password:${' '.repeat(5)}S3cretPass99`, 'kv-credential'], [`password:${'\t'.repeat(5)}S3cretPass99`, 'kv-credential'],
    [`db.password${' '.repeat(10)}= S3cretPass99`, 'kv-credential'], [`"password":${' '.repeat(5)}"S3cretPass99"`, 'kv-credential'],
    [`api_key${' '.repeat(8)}= abcd1234efgh5678ijkl`, 'kv-credential'], [`api_key =${' '.repeat(30)}abcd1234efgh5678ijkl`, 'kv-credential'],
    [`DB_PASSWORD${' '.repeat(5)}= S3cretPass99`, 'env-credential'], [`POSTGRES_PASSWORD:${' '.repeat(6)}Xk29fjQm88a`, 'env-credential'],
    [`DB_PASSWORD${'\t'.repeat(3)}=${' '.repeat(30)}S3cretPass99`, 'env-credential'],
    // a long name (the redactor allows 120 characters before the secret word)
    [`${'A'.repeat(100)}_PASSWORD=S3cretPass99`, 'env-credential'], [`${'a'.repeat(100)}_password: S3cretPass99`, 'kv-credential'],
  ]) {
    assert.deepEqual(scanSecrets(`see ${s} there`).map((f) => f.rule), [rule], s);
    assert.ok(redactWorkspace(s) !== s || redactAskText(s) !== s, `${rule}: a redactor knows this shape`);
  }
  for (const s of [
    'TOKEN_LIMIT=200000 and MAX_TOKENS=4096', 'GITHUB_TOKEN: required by the release job', 'export GITHUB_TOKEN=$(gh auth token)',
    'DB_PASSWORD=<local password>', 'API_KEY=${API_KEY}', 'WORCA_ADO_TOKEN=xxxxxxxx', 'const API_KEY = process.env.API_KEY',
    'token=getToken() in the helper', 'the callback gets ?code=1', 'pass the `token=` flag', 'docker run -u 1000:1000 img',
    'PASSWORD_RESET_URL=https://shop.test/reset', 'postgres://***@db/x is the redacted form',
    // lower-case / camelCase keys: code, references, fillers, placeholders and limits are no credential
    'accessToken = session.accessToken', 'refreshToken = response.data.refreshToken', 'secret_key:"sk_test_dummy"',
    '"tokens": 4096', 'max_tokens: 4096', 'password: see the vault', 'the token: rotate monthly', 'passwordless login uses magic links',
    'secret: ${{ secrets.NPM_TOKEN }}', 'apiKey: process.env.API_KEY', "api_key: 'your-api-key-here'", 'password: ********',
    'cache_key: user123abc', 'api_key_id: 12345678', 'secretName: tls-cert-2024', 'if (token === expected) return',
    'apiKey: z.string().min(1)', 'secret = os.environ["APP_SECRET"]', 'curl -u "$GH_USER:$GH_TOKEN" https://api.github.com',
    // secret-key names given code, a reference, a path or a placeholder; a token= reference
    'SECRET_KEY: required in production', 'SECRET_KEY = os.environ["SECRET_KEY"]', 'SECRET_KEY = env("DJANGO_SECRET_KEY")',
    "SECRET_KEY = config('SECRET_KEY')", 'secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>', 'encryptionKey = config.encryptionKey',
    'secret_key: Rails.application.credentials.secret_key', 'signing_key: ~/.ssh/id_ed25519', 'token=process.env.GITHUB_TOKEN',
    // placeholders; a query's or a list's next parameter; flags that name a secret but carry none; loose names given a
    // setting (refine cycle 4)
    'Authorization: Bearer YOUR_TOKEN', 'curl -u USERNAME:PASSWORD https://x.test', 'DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB',
    'postgresql://user:password@localhost:5432/mydb', 'API_KEY=your-api-key-here', 'API_KEY=YOUR_API_KEY', 'OPENAI_API_KEY=sk-xxxx',
    'https://oauth2:$CI_JOB_TOKEN@gitlab.com/x', 'GET /api/items?token=abc&page=2', 'token=abc,page=2', '--password-file=/run/secrets/db',
    '--max-tokens=4096 --token-limit=200000', 'docker login --password-stdin', '--password=$DB_PASSWORD', '--api-key=${API_KEY}',
    '--password=<your password>', 'FIRST_PASS=complete', 'enable_auth=gate-53915106', 'auth: required', 'bypass: Abc12345678',
    'the Authorization: Token header',
    // column-aligned settings that hold no secret
    `max_tokens:${' '.repeat(10)}4096`, `GITHUB_TOKEN:${' '.repeat(6)}required by the release job`, `api_key${' '.repeat(8)}= \${API_KEY}`,
  ]) assert.deepEqual(scanSecrets(s), [], s);
  // secret-named keys no redactor knows yet: a master, encryption or signing key is flagged all the same
  for (const s of ['RAILS_MASTER_KEY=8f1d2c3b4a5e6f7a8b9c0d1e2f3a4b5c', 'ENCRYPTION_KEY=8f1d2c3b4a5e6f7a8b9c0d1e2f3a4b5c', 'signingKey: "Zk3pQ9rT2vX8wY4m"']) {
    assert.equal(scanSecrets(s).length, 1, s);
  }
});

test('emails, private addresses, internal hosts and home paths are flagged by line; a finding never carries the value', () => {
  const text = ['# On-call', 'Page bob.smith@acme.io first.', 'Cache at 10.0.3.17:6379 (or 192.168.1.20).',
    'Grafana: https://grafana.ops.internal/d/x', 'Logs under /Users/alice/dev/shop/logs.', 'Windows: C:\\Users\\bob\\shop'].join('\n');
  const f = scanSecrets(text);
  assert.deepEqual(f.map((x) => [x.rule, x.line]), [['email', 2], ['private-ip', 3], ['internal-host', 4], ['home-path', 5], ['home-path', 6]]);
  assert.deepEqual(Object.keys(f[0]).sort(), ['kind', 'label', 'line', 'rule']);
  assert.doesNotMatch(JSON.stringify(f), /bob|alice|10\.0\.3|grafana/);
  assert.equal(describeFindings(f), 'line 2: an email address; line 3: a private network address; line 4: an internal host name; +2 more');
  assert.equal(describeFindings([{ rule: 'email', kind: 'personal', label: 'an email address', field: 'description', line: null }]), 'the description: an email address');
});

test('prose and code stay clean (the shapes that tripped a naive gate on the notes worca keeps today)', () => {
  for (const s of [
    'See `request.internal` and `request.internal.auto` on the ticket.',
    'The UI listens on http://127.0.0.1:4317 and localhost:4317.',
    'Bearer tokens are validated by the gateway.',
    'style.css has NO generic design-system tokens: `--space-*`, `--border`.',
    'Settings live in ~/.worca-cc/settings.json; runs in ~/.worca-cc/runs/<id>/repos/<key>.',
    'Use /Users/<name>/dev or /home/runner/work in examples.',
    'Push with git@github.com:acme/shop.git; Co-Authored-By: Claude <noreply@anthropic.com>.',
    '-----BEGIN CERTIFICATE----- is public.',
    'Bump to version 10.0.3 (not 1.2.3.4 of the old scheme).',
    'state.layers.local and file.local.md are code.',
    'A xapp-level token is a Slack concept.',
    'Mail user@example.com for the demo.',
    'The image runs as /home/node/app; on EC2 it is /home/ubuntu/shop.',
    // names and addresses every machine shares, wide ranges, reserved test domains, CI homes, a code chain (refine cycle 4)
    'From a container the UI is http://host.docker.internal:4317 (gateway.docker.internal on Linux).',
    'IMDSv2: curl http://169.254.169.254/latest/api/token; GCP: http://metadata.google.internal/computeMetadata/v1/.',
    'Docker\'s default bridge gateway is 172.17.0.1; the Android emulator reaches the host at 10.0.2.2.',
    'The SSRF guard blocks 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 and 169.254.0.0/16.',
    'git -c user.email=smoke@example.invalid commit; CI mails ci@shop.test.',
    'CircleCI checks out to /home/circleci/project; Homebrew lives in /home/linuxbrew.',
    'Set `this.props.internal` before mount.',
  ]) assert.deepEqual(scanSecrets(s), [], s);
  // …but a team host or a team subnet beside a generic one is still flagged
  assert.deepEqual(scanSecrets('host.docker.internal, then grafana.ops.internal:3000 and 10.0.3.17').map((f) => f.rule), ['private-ip', 'internal-host']);
  assert.deepEqual(scanSecrets('the ops VPC is 10.20.30.0/24').map((f) => f.rule), ['private-ip']);
});

test('linear on long single-line input (ReDoS guard); an over-size text is refused whole', () => {
  // The 3 s ceiling only absorbs a loaded machine (timing tests go red under CPU load — rerun alone before judging).
  for (const s of ['a'.repeat(1 << 18), '0123456789abcdef'.repeat(1 << 14), 'a.'.repeat(1 << 17), '1.'.repeat(1 << 17),
    'x@'.repeat(1 << 17), '/Users/'.repeat(37449), '-----BEGIN A-----'.repeat(15000), 'eyJ'.repeat(1 << 16), '//a.'.repeat(1 << 16),
    'A'.repeat(1 << 18), 'A_'.repeat(1 << 17), 'TOKEN='.repeat(43690), 'X_TOKEN: a1'.repeat(23831), '?sig='.repeat(52428), 'x:'.repeat(1 << 17),
    'password='.repeat(26214), '"password": "'.repeat(18724), '_'.repeat(1 << 18), 'x_secret=a1'.repeat(23831), ' -u a:'.repeat(43690), 'apikey'.repeat(43690),
    'SECRET_KEY_'.repeat(23831), 'secret_key_'.repeat(23831), 'a.b'.repeat(87381), 'secretKey: a.b'.repeat(18724),
    '--password='.repeat(23831), ' -token=a1'.repeat(26214), '-'.repeat(1 << 18), 'password: `'.repeat(23831), 'x_auth: a:'.repeat(26214),
    'Authorization: Token '.repeat(12483), 'a:b@c.de '.repeat(29127), '?token=a&'.repeat(29127), 'yourx'.repeat(52428),
    // column-aligned keys whose separator or value never comes: every start backtracks over the whole whitespace run
    `password${' '.repeat(32)}`.repeat(6553), `DB_PASSWORD${'\t'.repeat(32)}`.repeat(6017), `password:${' '.repeat(32)}`.repeat(6393),
    // long names with no secret word; an allowed value cut at every comma; `bot` and its digits
    `${'A'.repeat(127)} `.repeat(2048), `${'a_'.repeat(63)}a `.repeat(2048), 'password: x,'.repeat(21845), 'bot1234567'.repeat(26214),
    // the prose, .netrc, -p, AWS and hex rules (M2): labels, separators and values that never complete
    'password is '.repeat(87381), 'admin password for prod -> '.repeat(38836), '| DB_PASSWORD | '.repeat(65536), '`Xk9pLmQ2` as the '.repeat(58254),
    'machine a login b '.repeat(58254), 'login '.repeat(174762), ' -p'.repeat(349525), `mysql ${'-pXk9pLmQ2 '.repeat(95325)}`,
    `aws ${'Ab1/'.repeat(1 << 18)}`, `secret ${'aB1'.repeat(13)} `.repeat(23831), `key ${'0'.repeat(64)} `.repeat(15420), 'key '.repeat(1 << 18),
    `secret key: ${'0a'.repeat(32)}x`.repeat(13107), `${' '.repeat((1 << 20) - 8)}password`,
    // many short lines: every line costs ~40 patterns, so blank lines are skipped and a pattern is never cloned per line
    '\n'.repeat((1 << 20) - 1), 'x\n'.repeat((1 << 19) - 1)]) {
    const t0 = performance.now();
    scanSecrets(s);
    const ms = performance.now() - t0;
    assert.ok(ms < loadBudget(3000), `${JSON.stringify(s.slice(0, 16))}… (${s.length} chars) took ${Math.round(ms)} ms`);
  }
  assert.deepEqual(scanSecrets('a'.repeat(SECRET_SCAN_MAX_CHARS + 1)).map((f) => f.rule), ['too-large']);
});

test('everyday note text stays clean (relative paths through a home folder, elided and test values, logins, code); provider tokens, second pairs and encoded keys are flagged', () => {
  for (const s of [
    'Edit app/src/main/java/com/havngroup/home/MainActivity.kt and lib/features/home/home_page.dart.',
    'GET https://shop.test/home/banners; ASP.NET Views/Users/Index.cshtml', 'Next: app/[locale]/home/page.tsx',
    '#GH_TOKEN=github_pat_...', '#ANTHROPIC_API_KEY=sk-ant-...     # Console key', 'SLACK_BOT_TOKEN=xoxb-...', 'API_KEY=[REDACTED]',
    'Authorization: Bearer eyJhbGciOi...', 'Tests need it: JWT_SECRET=test-secret npm test', 'Repro: GITHUB_TOKEN=invalid gh api /user',
    'git remote add origin https://contoso@dev.azure.com/contoso/Shop/_git/shop', 'ssh -i key.pem ec2-user@ec2-3-120-1-2.eu-central-1.compute.amazonaws.com',
    'Grant roles/run.invoker to jibrix@appspot.gserviceaccount.com.', 'call this@MainActivity.lifecycleScope.launch { }',
    '$token = Str::random(60);', 'let token = Uuid::new_v4();', 'package com.acme.shop.internal;', 'from shop.payments.internal import ledger',
    'Podman: host.containers.internal; Testcontainers: host.testcontainers.internal', 'kube-dns 10.96.0.10; container 172.17.0.2',
    'Supports Basic auth/OAuth2.', 'Apply the coupon with /api/cart/apply?code=WELCOME10', 'go test prints --- PASS: TestRedactV2 (0.00s)',
    'arn:aws:secretsmanager:eu-west-1:123456789012:secret:shop/prod/db-x7Yk2P', 'the DB secret: shop/prod/db-creds-v2',
    'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp; /home/vsts/work/1/s', 'X-Hub-Signature-256: sha256=8f1d2c3b4a5e6f7a8b9c0d1e',
    'nats://<token>@nats.shop.test:4222', 'nats://$NATS_TOKEN@nats.shop.test:4222',
  ]) assert.deepEqual(scanSecrets(s), [], s);
  for (const [s, rule] of [
    ["Authorization: 'Basic ' + btoa('svc-ci:Zx81kqPq2wLm')", 'basic-credentials'], ['https://x.cloudfront.net/v.mp4?Expires=1798761600&Signature=nitfHRCrtziwO2HwPfWw~yYDh', 'kv-credential'],
    [`uv publish --token pypi-AgEIcHlwaS5vcmc${T('', 60)}`, 'api-token'], [T('gitlab-runner register --token glrt-', 20), 'api-token'],
    [T('shpat_', 32, 'a1'), 'api-token'], [T('dapi', 32, 'a1'), 'api-token'], [T('NRAK-', 27, 'A1'), 'api-token'], [T('lin_api_', 40), 'api-token'],
    [T('xoxe-1-', 30), 'api-token'],
    ['?token=abc&secret=S3cretPass99xyz', 'kv-credential'], ['helm upgrade x --set auth.token=abc,auth.password=S3cretPass99', 'kv-credential'],
    ['password: see_vault,token: S3cretPass99xyz', 'kv-credential'], [`nats://${T('', 24, 'nT9')}@nats.shop.test:4222`, 'url-token'],
    [`    client-key-data: ${Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMIIE').toString('base64')}`, 'private-key'], ['**Password:** S3cretPass99', 'kv-credential'],
    ['password := "S3cretPass99"', 'kv-credential'], ['DB_PASSWORD ?= S3cretPass99', 'env-credential'], ['API_KEY=8f1d2c3b4a5e6f7a8b9c0d1e2f3a...', 'env-credential'],
    ['Ops DB at fd12:3456:789a:1::17', 'private-ip'], ['Grafana: https://grafana.internal.acme.io/d/abc', 'internal-host'],
    ['launch.json: "cwd": "C:\\\\Users\\\\alice\\\\dev"', 'home-path'], ['ssh keys belong to alice@acme.io', 'email'],
    ['Pull logs from logs.prod.internal hourly', 'internal-host'],
  ]) assert.deepEqual(scanSecrets(`see ${s} there`).map((f) => f.rule), [rule], s);
});

// Built at run time like T: the inputs the M2 / m16 review found clean (each was pushed to the team branch).
const PW = 'Xk9pLmQ2wErT77';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY';
const HEX64 = T('', 64, '8f1d2c3b4a5e6f7a');

test('prose and table labels, .netrc, -p, bare AWS secret keys, labelled hex keys and more provider prefixes are flagged (M2); password names judge any literal (m16)', () => {
  for (const [s, rule] of [
    ['API key: 3f9a1c7e5b2d8046a1c3e5f7b9d2046a', 'prose-credential'], [`Secret Key: ${AWS_SECRET}`, 'prose-credential'],
    [`The staging admin password is ${PW}`, 'prose-credential'], [`The staging admin password -> ${PW}`, 'prose-credential'],
    [`The staging admin password — ${PW}`, 'prose-credential'], [`use \`${PW}\` as the admin password`, 'prose-credential'],
    [`| DB_PASSWORD | ${PW} |`, 'prose-credential'], [`| password | ${PW} |`, 'prose-credential'],
    [`The secret for prod is ${AWS_SECRET}`, 'prose-credential'], [`the signing key is ${HEX64}`, 'prose-credential'],
    [`Auth token for staging: ${PW}`, 'prose-credential'], [`the password was ${PW}.`, 'prose-credential'],
    [`machine api.acme.io login bob password ${PW}`, 'netrc-credential'],
    [`mysql -uroot -p${PW}`, 'cli-password'], [`sshpass -p'${PW}' ssh deploy@db`, 'cli-password'],
    [`aws prod ${AWS_SECRET.replace('z', '')}`, 'aws-secret-key'], [`the webhook signing key ${HEX64}`, 'hex-key'],
    [`Secret: ${HEX64.toUpperCase()}`, 'kv-credential'],
    [T('dop_v1_', 64, '0a1b'), 'api-token'], [T('doo_v1_', 64, '0a1b'), 'api-token'], [T('SK', 32, '0a1b'), 'api-token'],
    // m16: a key named exactly password / passwd / pwd judges any literal of 6+; a placeholder prefix is a whole word
    ['password=hunter2', 'kv-credential'], ['password: Changeme2024', 'kv-credential'], ['pwd: hunter2', 'kv-credential'],
    ['passwd = correcthorsebatterystaple', 'kv-credential'], [`DB_PASSWORD: my_${PW}`, 'env-credential'],
  ]) {
    const f = scanSecrets(`see ${s} there`);
    assert.deepEqual(f.map((x) => x.rule), [rule], s);
    assert.equal(f[0].kind, 'secret');
    assert.doesNotMatch(JSON.stringify(f), new RegExp(`${PW}|hunter2|Changeme|EXAMPLEKEY|${HEX64.slice(0, 16)}`, 'i'), 'a finding never carries the value (D14)');
  }
  // .netrc's multi-line form: `password …` on its own line
  assert.deepEqual(scanSecrets(`machine api.acme.io\n  login bob\n  password ${PW}\n`).map((f) => [f.rule, f.line]), [['netrc-credential', 3]]);
  for (const s of [
    // prose that names a secret but gives none; a password name given a type, a setting word or a placeholder
    'the token is valid for 5 minutes', 'The API key is stored in the vault.', 'the password is required', 'the password was changeme',
    'Secret Key: YOUR_SECRET_KEY', 'api key: <your key>', 'the token -> process.env.TOKEN', 'API key — see 1Password.',
    '| token | description |', '| password | `${DB_PASSWORD}` |', 'use `YOUR_TOKEN` as the token', 'use `sk-xxxx` as the API key',
    'password: string;', 'password: String,', 'password: Required', 'password: Option<String>', 'password: hunter', 'password: ********',
    "password: 'your-password'", 'password: changeme', 'password: yourpassword', 'design token: `--space-4x8`', 'secret: ${{ secrets.DEPLOY_KEY }}',
    // flags, git SHAs, digests and placeholders the new rules must leave alone
    'mkdir -p build2024x && gcc -pthread', 'ssh -p2222 deploy@shop.test', 'machine api.acme.io login bob password $NETRC_PASSWORD',
    'commit 3f9a1c7e5b2d8046a1c3e5f7b9d2046a3f9a1c7e is the secret fix', `sha256 of the release key: ${HEX64}`,
    `the key's integrity: ${HEX64}`, `${HEX64} is the image digest`, `secret ${'a1b2c3d4e5'.repeat(4)} (lower-case hex, a SHA)`,
  ]) assert.deepEqual(scanSecrets(s), [], s);
});
