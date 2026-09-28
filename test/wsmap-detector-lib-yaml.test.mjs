import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadToml } from '../src/core/workspace-map/detectors/lib/toml.mjs';
import { loadYaml, nodeAt, keyLine, walkScalars } from '../src/core/workspace-map/detectors/lib/yaml.mjs';
import { classifyValue, isPlaceholder, splitAuthority, shellTarget, unresolvedValue } from '../src/core/workspace-map/detectors/lib/urls.mjs';

test('yaml: multi-doc, merge keys, key/value lines, JSON with trailing commas, errors never throw', () => {
  const y = loadYaml('base: &b\n  A: 1\nsvc:\n  <<: *b\n  B: 2\n---\nk: v\n');
  assert.equal(y.docs.length, 2);
  assert.deepEqual(y.docs[0].js.svc, { A: 1, B: 2 });
  const { doc, root } = y.docs[0];
  assert.equal(keyLine(y, doc, root, ['svc', 'B']), 5);
  assert.equal(y.lineOf(nodeAt(doc, root, ['svc', 'A'])), 2, 'a merged value keeps its anchor line');
  const seen = [];
  walkScalars(y, doc, root, ({ path, line }) => seen.push(`${path.join('.')}@${line}`));
  assert.deepEqual(seen, ['base.A@2', 'svc.A@2', 'svc.B@5']);
  assert.deepEqual(loadYaml('{"a": [1, 2,],}\n').docs[0].js, { a: [1, 2] });
  const bad = loadYaml('a: [1\nb: : :\n');
  assert.ok(bad.errors.length > 0);
  assert.deepEqual(loadYaml('').docs, []);
});

test('yaml: an alias bomb is bounded', () => {
  let s = 'a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n';
  for (let i = 1; i < 9; i += 1) s += `a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(', ')}]\n`;
  const t0 = Date.now();
  const y = loadYaml(s);
  let n = 0;
  walkScalars(y, y.docs[0].doc, y.docs[0].root, () => { n += 1; });
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.ok(n <= 200000);
});

test('yaml: alias resolution is indexed — linear, not a whole-document walk per alias', () => {
  const text = '- &a x\n- *a\n'.repeat(20000); // 240 KB, 20 000 aliases (Alias.resolve: ~30 s)
  const t0 = performance.now();
  const y = loadYaml(text);
  const ms = performance.now() - t0;
  assert.equal(y.docs[0].js.length, 40000);
  assert.ok(y.docs[0].js.every((v) => v === 'x'));
  assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms (a whole-document walk per alias: ~30 s)`);
  const redefined = loadYaml('a: &x 1\nb: *x\nc: &x 2\nd: *x\n').docs[0].js;
  assert.deepEqual(redefined, { a: 1, b: 1, c: 2, d: 2 }, 'an alias takes the closest preceding anchor');
});

test('yaml: plain YAML over 256 KiB is refused; JSON is pre-validated with JSON.parse', () => {
  assert.deepEqual(loadYaml(`a: ${'x'.repeat(262200)}`).errors, ['yaml too large']);
  assert.deepEqual(loadYaml('{"a": [1, 2,],}', { json: true }).docs[0].js, { a: [1, 2] });
  assert.deepEqual(loadYaml('[{[{', { json: true }).errors, ['invalid JSON']);
  assert.deepEqual(loadYaml(`${'['.repeat(100)}${']'.repeat(100)}`, { json: true }).errors, ['JSON too deep']);
  assert.deepEqual(loadYaml('\uFEFF{"a": 1}', { json: true }).docs[0].js, { a: 1 }, 'a UTF-8 BOM (Windows editors) is not an error');
  assert.deepEqual(loadYaml('\uFEFFa: 1\n').docs[0].js, { a: 1 });
  assert.equal(loadToml('\uFEFF[package]\nname = "x"\n').data.package.name, 'x');
});

test('urls: classifyValue table', () => {
  const k = (v, key = 'X') => classifyValue(v, key).map((s) => `${s.kind}|${s.key}|${s.target ?? ''}|${s.confidence}`);
  assert.deepEqual(k('http://billing:8080/api/v1?x=1'), ['service|billing|billing:8080|exact', 'http|/api/v1|billing:8080|exact']);
  assert.deepEqual(k('https://billing.acme.internal'), ['service|billing.acme.internal|billing.acme.internal|exact']);
  assert.deepEqual(k('http://localhost:3000/graphql'), ['http|/graphql||exact'], 'no service for localhost; the path still counts');
  assert.deepEqual(k('jdbc:postgresql://db:5432/billing?ssl=true'), ['db|db:billing|db:5432|exact']);
  assert.deepEqual(k('jdbc:sqlserver://sql:1433;databaseName=Orders;encrypt=true'), ['db|db:Orders|sql:1433|exact']);
  assert.deepEqual(k('mongodb+srv://u:p@cluster0.mongo.net/catalog?retryWrites=true'), ['db|db:catalog|cluster0.mongo.net|exact']);
  assert.deepEqual(k('redis://cache:6379/0'), ['service|cache|cache:6379|exact']);
  assert.deepEqual(k('Host=pg;Port=5432;Database=billing;Username=app'), ['db|db:billing|pg|exact']);
  assert.deepEqual(k('${BILLING_URL:http://billing:8080}'), ['service|billing|billing:8080|exact']);
  assert.deepEqual(k('postgres', 'DB_HOST'), ['service|postgres|postgres|heuristic']);
  assert.deepEqual(k('postgres', 'DB_NAME'), [], 'the bare-host rule needs a host-like key');
  assert.deepEqual(k('10.0.0.4', 'DB_HOST'), []);
  assert.deepEqual(k('${DB_URL}'), []);
  const withCreds = classifyValue('postgres://app:secret@db:5432/shop')[0];
  assert.deepEqual([withCreds.key, withCreds.target, withCreds.needle], ['db:shop', 'db:5432', 'postgres://app:secret@db:5432/shop'],
    'keys and targets never carry credentials; the needle is raw (P1 extract redacts centrally)');
  assert.ok(isPlaceholder('${X}') && isPlaceholder('{{ .Values.x }}') && !isPlaceholder('http://x'));
  assert.deepEqual(splitAuthority('u:p@h1:1,h2:2/db?q'), { host: 'h1:1', path: '/db' });
  assert.deepEqual(splitAuthority('u:pa/ss@h1:1/db?x'), { host: 'h1:1', path: '/db' });
  assert.deepEqual(splitAuthority('billing-api:${PORT}/v1/invoices?notify=ops@acme.com'), { host: 'billing-api:${PORT}', path: '/v1/invoices' }, 'a templated port and an @ in the query are no userinfo');
  assert.deepEqual(splitAuthority('billing-api:{port}/users/@me'), { host: 'billing-api:{port}', path: '/users/@me' }, 'a templated port is no password');
  assert.deepEqual(splitAuthority('billing-api:%PORT%/invoices?cc=a@b.io'), { host: 'billing-api:%PORT%', path: '/invoices' }, 'an @ after a ? is no userinfo end');
  assert.deepEqual(k('http://billing-api:8080/webhooks/stripe'), ['service|billing-api|billing-api:8080|exact', 'http|/webhooks/stripe|billing-api:8080|exact'], "an internal service's own webhook route stays joinable");
  assert.deepEqual(k('http://localhost:8080/hooks/x', 'X_URL'), ['http|/hooks/x||exact'], 'local dev: kept');
  assert.deepEqual(k('postgresql://app:Zq9sl/ash@db:5432/orders'), ['db|db:orders|db:5432|exact'], "an unencoded '/' in a password never reaches a key or target");
  assert.deepEqual(k('https://u:Zq9s1/Yx8s1@orders/api'), ['service|orders|orders|exact', 'http|/api|orders|exact']);
  assert.deepEqual(k('lb://customers-service'), ['service|customers-service|customers-service|exact'], 'Spring Cloud LoadBalancer');
  for (const [v, key] of [['true', 'prefer-ip-address'], ['8080', 'SERVER'], ['none', 'endpoint'], ['always', 'health.endpoint']]) assert.deepEqual(k(v, key), [], `a flag is no host: ${key}=${v}`);
  assert.deepEqual(shellTarget(classifyValue('http://localhost:7000/x')[0], 'LEDGER_URL'), { target: 'LEDGER_URL', confidence: 'heuristic' }, 'no usable host: the key names the peer');
  assert.deepEqual(shellTarget(classifyValue('http://billing:8080/x')[1], 'ledger.base-url'), { target: 'billing:8080', confidence: 'exact' });
  assert.deepEqual(shellTarget(classifyValue('http://localhost:7000/x')[0], 'TIMEOUT'), { target: undefined, confidence: 'exact' }, 'only a peer-looking key names a peer');
  assert.deepEqual(shellTarget(classifyValue('http://localhost:7000/x')[0], 'BILLING_SERVER'), { target: undefined, confidence: 'exact' }, 'a key P1\'s envStems cannot read is no target');
  for (const hook of ['https://hooks.slack.com/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx', 'https://acme.webhook.office.com/webhookb2/a@b/IncomingWebhook/c0ffee/d',
    'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWx', 'https://api.telegram.org/bot123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage',
    'https://hooks.zapier.com/hooks/catch/123456/Zq9zap1er/', 'https://maker.ifttt.com/trigger/door/with/key/Zq9ifttt', 'https://chat.acme.io/hooks/Zq9mattermost',
    'https://open.feishu.cn/open-apis/bot/v2/hook/Zq9feishu', 'https://hook.eu1.make.com/Zq9make']) {
    const shells = classifyValue(hook, 'HOOK_URL');
    assert.deepEqual(shells.map((x) => x.kind), ['service'], `no http shell keyed by a webhook's secret path: ${hook}`);
    assert.equal(shells[0].needle, hook.slice(0, hook.indexOf('/', 8)), `the service fact cites the URL up to its path: ${hook}`);
  }
  // A password holding '/' and a char URL_RE stops at (, ; ' ) |) is cut before its '@': no host, and its tail is never a key.
  for (const v of ['postgres://app:ab/Zq9c1,x@db/shop', 'http://svc:ab/Zq9c2;x@billing-api:8080/v1/items', "postgres://app:ab/Zq9c3'x@db/shop", 'https://svc:ab/Zq9c4|x@billing-api/v1/items']) {
    assert.deepEqual(classifyValue(v, 'BILLING_URL'), [], `a userinfo cut before its '@' gives no shell: ${v}`);
  }
  assert.deepEqual(k('http://${BILLING_HOST:-billing}:8080/v1/x', 'X_URL'), ['http|/v1/x||exact'], 'a templated host is no userinfo');
  assert.deepEqual(k('postgres://app:${DB_PASS:-pa/Zq9d1}@db/shop'), ['db|db:shop|db|exact'], "a template default holding '/' is a password, not a port");
  assert.deepEqual(k('http://[::1]:8080/users/@me', 'X_URL'), ['http|/users/@me||exact'], 'an IPv6 literal holds no userinfo');
  assert.deepEqual(splitAuthority('billing-api:/v1/items/@x'), { host: 'billing-api:', path: '/v1/items/@x' }, 'an empty port is a port');
  assert.deepEqual(splitAuthority('billing:%PORT%/v1/items/@me'), { host: 'billing:%PORT%', path: '/v1/items/@me' }, 'a %PORT% template is a port');
  assert.deepEqual(splitAuthority('svc:api/x@y'), { host: 'y', path: '' }, "a word after ':' reads as a password (SQLAlchemy's unencoded '/')");
  assert.equal(classifyValue('postgresql://app:Zq9sl/ash@db:5432/orders')[0].needle, 'db:5432/orders', "a userinfo holding '/' (P1 redaction stops at '/') is cited from its host on");
  assert.equal(classifyValue('postgresql://app:Zq9s3cret@db:5432/orders')[0].needle, 'postgresql://app:Zq9s3cret@db:5432/orders', 'a plain userinfo stays cited whole (P1 redacts it)');
  for (const hook of ['https://http-intake.logs.datadoghq.com/v1/input/0123456789abcdef0123456789abcdef', 'https://events.pagerduty.com/integration/0123456789abcdef0123456789abcdef/enqueue',
    'https://api.netlify.com/build_hooks/5f0a1b2c3d4e5f6071829304', 'https://hc-ping.com/0b1c2d3e-1111-2222-3333-444455556666']) {
    const shells = classifyValue(hook, 'HOOK_URL');
    assert.deepEqual(shells.map((x) => x.kind), ['service'], `a key-shaped path segment on a public host is a credential: ${hook}`);
    assert.equal(shells[0].needle, hook.slice(0, hook.indexOf('/', 8)), hook);
  }
  assert.deepEqual(k('https://api.github.com/repos/acme/billing-api-service-v2/pulls').map((x) => x.split('|')[0]), ['service', 'http'], 'a word segment is no key');
  assert.deepEqual(k('http://billing-api:8080/v1/reset/0123456789abcdef0123456789abcdef').map((x) => x.split('|')[0]), ['service', 'http'], 'an internal host keeps its route');
  assert.deepEqual(k('ad:${AD_PORT}', 'AD_ADDR'), ['service|ad|ad|heuristic'], 'a templated port leaves a literal host (key and target without it)');
  assert.deepEqual(k('http://email:${EMAIL_PORT}/send', 'EMAIL_URL').map((x) => x.split('|').slice(0, 2).join('|')), ['service|email', 'http|/send'], 'no template in a service key');
  assert.deepEqual(k('kafka-1:9092, kafka-2:9092', 'spring.kafka.bootstrap-servers'), ['service|kafka-1|kafka-1:9092|heuristic', 'service|kafka-2|kafka-2:9092|heuristic'], 'a Kafka bootstrap list names every broker');
  assert.deepEqual(k('kafka:9092', 'KAFKA_BROKERS'), ['service|kafka|kafka:9092|heuristic']);
  for (const [v, key] of [['web,api', 'ALLOWED_HOSTS'], ['3', 'KAFKA_NUM_BROKERS'], ['nyse,lse', 'STOCK_BROKERS']]) assert.deepEqual(k(v, key), [], `not a broker list: ${key}`);
});

test('urls: a password whose head reads like a port, a cut after it, an unresolved value, a Kubernetes $(VAR), a templated port and a short key on a public host', () => {
  const k = (v, key = 'X') => classifyValue(v, key).map((s) => `${s.kind}|${s.key}|${s.target ?? ''}`);
  // A password `8080/…` or `/…` (base64 passwords hold '/'; SQLAlchemy accepts it unencoded) never becomes a key.
  assert.deepEqual(k('postgres://app:8080/Zq9f1a@db:5432/shop'), [], 'no database path holds an @');
  assert.deepEqual(k('postgres://app:/Zq9f1b@db:5432/shop'), ['db|db:shop|db:5432'], "an empty port is a password's leading '/'");
  assert.deepEqual(k('http://svc:/Zq9f1c@billing:8080/v1/items'), ['service|billing|billing:8080', 'http|/v1/items|billing:8080']);
  assert.deepEqual(k('http://svc:/Zq9f1d/@billing:8080/v1/items'), [], 'a host with an empty port is never read');
  assert.deepEqual(splitAuthority('billing-api:/v1/items/@x'), { host: 'billing-api:', path: '/v1/items/@x' }, 'an @ opening a segment is no userinfo end');
  assert.deepEqual(k('http://billing:8080/v1/users/bob@acme.com'), ['service|billing|billing:8080', 'http|/v1/users/bob@acme.com|billing:8080'], 'a digit port keeps its path');
  // Cut at `, ; ' ) |` inside such a password: the text runs on to an '@' — no shell.
  for (const v of ['postgres://app:8080/Zq9f2a,x@db/shop', 'http://svc:8080/Zq9f2b;x@billing:8080/v1/items', "http://svc:8080/Zq9f2c'x@billing/v1", 'http://svc:1/Zq9f2d)x@billing/v1']) {
    assert.deepEqual(k(v), [], `a userinfo cut after a port-shaped head gives no shell: ${v}`);
  }
  assert.deepEqual(k('amqp://guest:guest@rabbit:5672/,amqp://guest:guest@rabbit2:5672/').map((x) => x.split('|')[1]), ['rabbit', 'rabbit2'], 'a list of URLs is no cut userinfo');
  // An unresolved item quotes a URL from its last '@' on (P1's redaction misses a userinfo holding '/').
  assert.equal(unresolvedValue('mongodb://app:${DB_PASS:-pa/Zq9f3a}@m1:27017,m2:27017/shop'), 'mongodb://m1:27017,m2:27017/shop');
  assert.equal(unresolvedValue('postgres://app:pa/Zq9f3b@${DB_HOST}:5432/${DB_NAME}'), 'postgres://${DB_HOST}:5432/${DB_NAME}');
  assert.equal(unresolvedValue('${BILLING_URL}'), '${BILLING_URL}');
  // Kubernetes `$(VAR)` and every templated port leave a literal host (key and target).
  assert.deepEqual(k('http://billing:$(BILLING_PORT)/api'), ['service|billing|billing', 'http|/api|billing']);
  assert.deepEqual(k('postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:5432/app'), ['db|db:app|postgres:5432']);
  assert.deepEqual(k('redis://:$(REDIS_PASSWORD)@redis:6379/0'), ['service|redis|redis:6379']);
  assert.deepEqual(k('postgres://app:pw@db:5432/$(DB_NAME)'), [], 'a $(VAR) database is a placeholder');
  assert.ok(isPlaceholder('$(BILLING_URL)'));
  for (const v of ['http://billing:$PORT/x', 'http://billing:%PORT%/x', 'http://billing:{{.Values.port}}/x', 'http://billing:{port}/x']) {
    assert.deepEqual(k(v), ['service|billing|billing', 'http|/x|billing'], `a templated port: ${v}`);
  }
  assert.deepEqual(k('http://billing-api:$PORT/webhooks/stripe').map((x) => x.split('|')[0]), ['service', 'http'], 'an internal host with a templated port keeps its webhook route');
  // A key of 16+ chars with any digit on a public host (a 22-char base64url push key has < 4 digits half the time); a slug is none.
  for (const hook of ['https://api.acme-alerts.io/v1/push/Zq9abcdefghijklmnopq1R', 'https://api.acme-alerts.io/v1/push/aB3dE5gH7jK9mN1pQ']) {
    assert.deepEqual(classifyValue(hook, 'HOOK_URL').map((s) => s.kind), ['service'], hook);
  }
  for (const u of ['https://storage.googleapis.com/acme-backups-20240101/x', 'https://api.acme.io/v2/projects/my-project-123456/topics/orders']) {
    assert.deepEqual(classifyValue(u, 'X_URL').map((s) => s.kind), ['service', 'http'], `a slug is no key: ${u}`);
  }
});

test('urls: an unresolved value never quotes a userinfo (a backtick, a quote or a space in it); a cut at " < > or a backtick; a path holding @ in a non-web scheme; a JDBC credential property is no cut', () => {
  const k = (v, key = 'X_URL') => classifyValue(v, key).map((s) => `${s.kind}|${s.key}|${s.target ?? ''}`);
  for (const v of ['postgres://$(DB_USER):pa`Zq9k1@db:5432/shop', 'postgres://app:pa"Zq9k1@${DB_HOST}/shop', 'postgres://app:pa Zq9k1@${DB_HOST}/shop', 'http://svc:pa`Zq9k1@billing:$(PORT)/v1']) {
    assert.ok(!unresolvedValue(v).includes('Zq9k1'), v);
  }
  assert.equal(unresolvedValue('amqp://u:p@a/,amqp://u:p@b/'), 'amqp://a/,amqp://b/');
  for (const v of ['postgres://app:8080/Zq9k2"x@db/shop', 'http://svc:8080/Zq9k2<x@billing/v1/items', 'postgres://app:8080/Zq9k2`x@db/shop']) assert.deepEqual(k(v), [], v);
  assert.deepEqual(k('http://alerts:9093/api,"ops@acme.com"'), ['service|alerts|alerts:9093', 'http|/api|alerts:9093'], 'the cut scan still stops at a quote');
  assert.deepEqual(k('amqp://admin:0/Zq9k3@rabbit:5672/vhost'), [], 'a vhost holds no @: the password read as host:port + path');
  assert.deepEqual(k('redis://default:1/Zq9k3@cache:6379/0'), []);
  assert.deepEqual(k('wss://stream.binance.com:9443/ws/btcusdt@trade').map((x) => x.split('|')[0]), ['service'], 'ws paths keep their @');
  assert.deepEqual(k('jdbc:mysql://db:3306/shop?user=app&password=a,b@c'), ['db|db:shop|db:3306']);
  assert.deepEqual(k('jdbc:sqlserver://db:1433;databaseName=shop;user=sa;password=P@ssw0rd'), ['db|db:shop|db:1433']);
  assert.deepEqual(k('postgres://app:8080/Zq9k4?a=b,x@db/shop'), [], 'a non-credential parameter still counts as a cut');
  assert.deepEqual(k('sqlserver://app:8080/Zq9k4;x@db/shop'), [], 'go-mssqldb URLs carry a userinfo');
});

test('yaml: walkScalars skips a flattened key over 512 chars with its subtree, and one budget stops at 4 MiB of keys and values (aliases re-visit a scalar)', () => {
  const long = loadYaml(JSON.stringify({ ['k'.repeat(65536)]: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`q${i}`, 'v'])), ledger: { url: 'u' } }), { json: true });
  const keys = [];
  assert.equal(walkScalars(long, long.docs[0].doc, long.docs[0].root, ({ path }) => keys.push(path.join('.'))), false);
  assert.deepEqual(keys, ['ledger.url'], 'a 64 KB key over 2 000 leaves would hand out 128 MB of flattened keys');
  const seq = loadYaml(JSON.stringify({ ['k'.repeat(510)]: ['a'], ['j'.repeat(511)]: ['b'] }), { json: true });
  const lengths = [];
  walkScalars(seq, seq.docs[0].doc, seq.docs[0].root, ({ path }) => lengths.push(path.join('.').length));
  assert.deepEqual(lengths, [512], 'a list index counts toward the 512 chars');
  const refs = (x, k) => `[${Array.from({ length: k }, () => x).join(', ')}]`;
  const aliased = loadYaml(`a: &v "${'x'.repeat(10240)}"\nb: &l ${refs('*v', 1000)}\nc: ${refs('*l', 150)}\n`);
  let n = 0;
  let bytes = 0;
  const t0 = performance.now();
  const cut = walkScalars(aliased, aliased.docs[0].doc, aliased.docs[0].root, ({ path, value }) => { n += 1; bytes += path.join('.').length + value.length; });
  assert.ok(performance.now() - t0 < 2000, `took ${(performance.now() - t0).toFixed(0)} ms`);
  assert.equal(cut, true, '150 000 visits of one 10 KB scalar through aliases');
  assert.ok(bytes <= 4 * 1024 * 1024 && n > 300, `${n} leaves, ${bytes} bytes`);
  const multi = loadYaml(`a: &v "${'x'.repeat(10240)}"\nb: ${refs('*v', 300)}\n---\na: &v "${'x'.repeat(10240)}"\nb: ${refs('*v', 300)}\n`);
  const budget = {};
  assert.deepEqual(multi.docs.map(({ doc, root }) => walkScalars(multi, doc, root, () => {}, budget)), [false, true], 'one budget spans the documents of a file');
});

test('urls: Prisma\'s sqlserver://host;database=…;password=P@ss is a property list (no cut); a non-web authority ended by ? or # with an @ after it is a password; an unresolved value finds the @ of a token password over 1 KiB', () => {
  const k = (v, key = 'X_URL') => classifyValue(v, key).map((s) => `${s.kind}|${s.key}|${s.target ?? ''}`);
  assert.deepEqual(k('sqlserver://db:1433;database=shop;user=sa;password=r@ndomP@$$w0rd;trustServerCertificate=true'), ['db|db:shop|db:1433'], 'Prisma docs form');
  assert.deepEqual(k('sqlserver://sa:P@ss@db:1433/shop'), ['db|db:shop|db:1433'], 'go-mssqldb keeps its userinfo');
  assert.deepEqual(k('sqlserver://app:8080/Zq9k5;x=y@db/shop'), [], 'a go-mssqldb password holding ;x= is still a cut');
  for (const v of ['amqp://admin:0?Zq9k6/x@rabbit:5672/vhost', 'redis://default:1#Zq9k6/y@cache:6379/0', 'redis://:Pa@Zq9k6word#1@cache:6379/0']) assert.deepEqual(k(v), [], v);
  assert.deepEqual(k('redis://redis:6379/0?client_name=web@host'), ['service|redis|redis:6379'], 'an @ after a path is still a query value');
  const tok = `eyJ${'Zq9k7'.repeat(250)}`;
  assert.ok(!unresolvedValue(`amqp://app:${tok}@\${RABBIT_HOST}:5672/vhost`).includes('Zq9k7'), 'a 1.2 KiB token password is never quoted');
  assert.equal(unresolvedValue(`\${X:-${'a'.repeat(3000)}}`).length, 1024);
});

test('urls: an unresolved value never quotes the tail of a query or property password holding @ (the cut at its @ took the password= key P1 needs)', () => {
  assert.equal(unresolvedValue('jdbc:postgresql://${DB_HOST}:5432/${DB_NAME}?user=app&password=Str0ng@Zq9u1&ssl=true'), 'jdbc:postgresql://${DB_HOST}:5432/${DB_NAME}?user=app&password=***&ssl=true');
  assert.equal(unresolvedValue('jdbc:sqlserver://${DB_HOST}:1433;databaseName=${DB_NAME};user=sa;password=YourStrong@Zq9u2;encrypt=true'), 'jdbc:sqlserver://${DB_HOST}:1433;databaseName=${DB_NAME};user=sa;password=***;encrypt=true');
  assert.equal(unresolvedValue('sqlserver://${H};database=${D};password={P;ss@Zq9u3};encrypt=true'), 'sqlserver://${H};database=${D};password=***;encrypt=true');
  assert.ok(!unresolvedValue('postgresql://$(DB_HOST)/$(DB_NAME)?user=app&password=P@Zq9u4').includes('Zq9u4'));
  assert.equal(unresolvedValue('postgres://app:pa/Zq9u5@${DB_HOST}/shop?sslmode=require'), 'postgres://${DB_HOST}/shop?sslmode=require', 'a userinfo is still cut at its @');
});
