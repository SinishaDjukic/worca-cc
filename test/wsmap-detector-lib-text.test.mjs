import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { splitLines, clip, clipWhole, lineIndex, locate, evidence, fact, blankComments, samePathOrInside, memberForPath, imageRepo, memberForImage, aliasable, onePerKey, cleanUnresolved, isMinified, isLibraryImage, authorityEnd, isSamplePath, hasCode } from '../src/core/workspace-map/detectors/lib/text.mjs';
import { scanXml } from '../src/core/workspace-map/detectors/lib/xml.mjs';
import { loadToml, splitDotted, tomlSections, keyLine as tomlKeyLine } from '../src/core/workspace-map/detectors/lib/toml.mjs';

test('text: CRLF-safe lines, offsets → lines, locate wraps, evidence falls back to the trimmed line', () => {
  const t = 'a\r\nbb\r\n  ccc  \n';
  assert.deepEqual(splitLines(t), ['a', 'bb', '  ccc  ', '']);
  const at = lineIndex(t);
  assert.deepEqual([at(0), at(3), at(7), at(t.length)], [1, 2, 3, 4]);
  const lines = splitLines(t);
  assert.equal(locate(lines, 'bb', 2), 2, 'wraps to the top once');
  assert.equal(locate(lines, 'zz'), 0);
  assert.deepEqual(evidence(lines, 3, 'ccc'), { line: 3, match: 'ccc' });
  assert.deepEqual(evidence(lines, 3, 'nope'), { line: 3, match: 'ccc' });
  assert.equal(clip('x'.repeat(500)).length, 200);
  const f = fact({ kind: 'pkg', dir: 'consumes', key: 'npm:a', rel: 'p.json', lines, line: 2, needle: 'bb', detail: 'd'.repeat(300), target: 'x', confidence: 'exact' });
  assert.deepEqual({ ...f, detail: f.detail.length }, { kind: 'pkg', dir: 'consumes', key: 'npm:a', file: 'p.json', line: 2, match: 'bb', detail: 200, target: 'x', confidence: 'exact' });
});

test('text: blankComments keeps strings (URLs survive), blanks // /* */ and # comments, keeps offsets', () => {
  const src = 'a = "http://x/y" // tail\n/* multi\nline */ b = \'#not\' # hash\n';
  const out = blankComments(src, { slash: true, hash: true });
  assert.equal(out.length, src.length);
  assert.ok(out.includes('"http://x/y"') && out.includes("'#not'"));
  assert.ok(!out.includes('tail') && !out.includes('multi') && !out.includes('hash'));
  assert.equal(splitLines(out).length, splitLines(src).length);
});

test('text: memberForPath resolves against projectDir + file dir, deepest member wins; memberForImage by repo name', () => {
  const root = join(tmpdir(), 'wsmap-lib');
  const members = [
    { key: 'web', name: 'web', dir: join(root, 'web'), projectDir: join(root, 'web') },
    { key: 'mono', name: 'mono', dir: join(root, 'mono'), projectDir: join(root, 'mono') },
    { key: 'mono-api', name: 'Mono API', dir: join(root, 'x'), projectDir: join(root, 'mono', 'services', 'api') },
  ];
  const ctx = { member: members[0], members };
  assert.equal(memberForPath(ctx, 'deploy/compose.yml', '../../mono/services/api/src')?.key, 'mono-api');
  assert.equal(memberForPath(ctx, 'go.mod', '../mono')?.key, 'mono');
  assert.equal(memberForPath(ctx, 'a/b.csproj', '..\\..\\mono\\x.csproj')?.key, 'mono');
  assert.equal(memberForPath(ctx, 'go.mod', '../elsewhere'), null);
  assert.equal(memberForPath(ctx, 'go.mod', ''), null);
  const odd = { key: 'odd', name: 'odd', dir: join(root, 'José Müller', 'billing api'), projectDir: join(root, 'José Müller', 'billing api') };
  const ctx2 = { member: { ...members[0], projectDir: join(root, 'José Müller', 'web app') }, members: [...members, odd] };
  assert.equal(memberForPath(ctx2, 'docker-compose.yml', '../billing api/src')?.key, 'odd', 'spaces and non-ASCII in member paths');
  assert.equal(samePathOrInside(join(root, 'web'), join(root, 'webapp')), false, 'a sibling with a common prefix is not inside');
  if (process.platform === 'darwin' || process.platform === 'win32') assert.equal(samePathOrInside(join(root, 'Web'), join(root, 'web', 'x')), true);
  assert.equal(imageRepo('registry.acme.io:5000/acme/Billing-API:1.2@sha256:abc'), 'billing-api');
  assert.equal(imageRepo('postgres'), 'postgres');
  assert.equal(memberForImage(ctx, 'ghcr.io/acme/web:1')?.key, 'web');
  assert.equal(memberForImage(ctx, 'redis:7'), null);
});

test('text: evidence on a long line — in-order facts cost one pass, misses are budgeted (never facts × line length)', () => {
  const keys = Array.from({ length: 60000 }, (_, i) => `k${String(i).padStart(6, '0')}`);
  const lines = [`{${keys.map((k) => `"${k}":"v"`).join(',')}}`]; // one 840 KB line (a minified JSON)
  const t0 = performance.now();
  for (const k of keys) assert.equal(evidence(lines, 1, k).match, k);
  assert.equal(evidence(lines, 1, 'k000005').match, 'k000005', 'a step back is still found');
  for (let i = 0; i < 2000; i += 1) evidence(lines, 1, `absent-${i}`);
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms (a whole-line search per fact: ~7 s)`);
  assert.equal(evidence(lines, 1, 'k000007').match, lines[0].slice(0, lines[0].lastIndexOf('"', 200)), 'after 32 misses the long line cites its head, cut before a delimiter');
  const short = ['a b', 'x'.repeat(5000)];
  assert.equal(evidence(short, 1, 'b').match, 'b', 'a short line is searched as before');
});

test('text: a cited cut never ends inside a token — extract redacts the match only after it (P1: keep a match whole)', () => {
  const line = `{"Pad":"${'x'.repeat(165)}","Db":"postgres://app:Zq9d6s3cretXy@db:5432/shop"}`;
  assert.ok(line.indexOf('Zq9') < 200 && line.indexOf('@db') > 200, 'fixture: the password crosses char 200');
  const head = line.slice(0, line.indexOf('"postgres'));
  assert.deepEqual(evidence([line], 1, 'absent-needle'), { line: 1, match: head }, 'a missed needle cites the head, cut before the URL');
  assert.equal(clipWhole(line), head);
  assert.equal(clipWhole('a b'), 'a b');
  assert.equal(clipWhole('y'.repeat(500)), 'y', 'one 500-char token: its first character only');
});

test('text: a cut never splits a value (sub-delims in a password, a DSN, a JSON-escaped URL, long userinfo); a missed value cites its key', () => {
  const pad = 'x'.repeat(150);
  const e = 'e'.repeat(30);
  for (const cred of [`postgres://app:Zq9ab&cd${e}@db:5432/shop`, `postgres://app:Zq9ab=cd${e}@db/shop`, `postgres://app:Zq9ab'cd${e}@db/shop`, `postgres://app:Zq9ab(cd${e}@db/shop`,
    `postgres://app:Zq9a,b;cd${e}@db/shop`, `app:Zq9=cd${e}@tcp(db:3306)/shop`, `jdbc:oracle:thin:app/Zq9=cd${e}@db:1521/x`]) {
    const line = `{"Pad":"${pad}","Db":"${cred}"}`;
    assert.equal(clipWhole(line), line.slice(0, line.lastIndexOf('"', line.indexOf('Zq9'))), `only whitespace, quotes and <> are cut points: ${cred}`);
  }
  const unclosed = `{"Pad":"${pad}","Password":"Zq9a,b;c=d&${e}`;
  assert.equal(clipWhole(unclosed), unclosed.slice(0, unclosed.lastIndexOf('"', unclosed.indexOf('Zq9'))), 'an unclosed quoted secret is dropped whole');
  const escaped = `{"Pad":"${pad}","Db":"postgres:\\/\\/app:Zq9ab&cd${e}@db:5432\\/shop"}`;
  assert.equal(clipWhole(escaped), escaped.slice(0, escaped.indexOf('"postgres')), 'a JSON-escaped URL crossing the cut');
  assert.equal(clipWhole('{"Db":"postgres:\\/\\/app:Zq9@db\\/x"}'), '{"Db":"', 'a JSON-escaped URL is never cited, whole or cut (redaction reads :// only)');
  assert.equal(clipWhole('value: "postgres:\\x2F\\x2Fapp:Zq9@db\\x2Fshop"'), 'value: "', 'a YAML \\x2F escape: the value is dropped whole');
  assert.equal(clipWhole('value: "redis://:Zq9\\x40cache:6379"'), 'value: "', 'an escaped @ hides the userinfo from redaction: dropped whole');
  assert.equal(clipWhole('url: postgres://app:Zq9@db/shop'), 'url: postgres://app:Zq9@db/shop', 'no escape: cited whole');
  const jwt = `https://svc:${'J'.repeat(230)}@billing-api:8080/x`;
  assert.deepEqual(evidence([`URL=${jwt}`], 1, jwt), { line: 1, match: 'billing-api:8080/x' }, 'a needle over 200 chars with userinfo is cited from its host');
  const hook = `https://acme.webhook.office.com/webhookb2/${'a'.repeat(36)}@${'c'.repeat(36)}/IncomingWebhook/${'0'.repeat(32)}/${'e'.repeat(40)}`;
  assert.equal(evidence([hook], 1, hook).match, hook.slice(0, 200), 'an @ in the path is no userinfo: the head, host first, is cited');
  const json = '{"Billing":"http:\\/\\/billing-api:8080","Db":"postgres://app:Zq9d6s@db/shop"}';
  const f = fact({ kind: 'service', dir: 'consumes', key: 'billing-api', rel: 'a.json', lines: [json], line: 1, needle: 'http://billing-api:8080', alt: 'Billing' });
  assert.equal(f.match, 'Billing', 'the value is escaped on its line: the key as written is cited');
  assert.equal(authorityEnd('u:pa/ss@h:1/db'), 11, "an unencoded '/' in a password: the authority runs past the '@'");
  assert.equal(authorityEnd('h:8080/x@y'), 6);
  assert.equal(authorityEnd('acme.webhook.office.com/webhookb2/a@b/x'), 23);
});

test('text: onePerKey, cleanUnresolved, isMinified, isLibraryImage — the output hygiene every P3 detector applies', () => {
  const f = (file, dir, key, line) => ({ file, dir, key, line });
  assert.deepEqual(onePerKey([f('a', 'consumes', 'k', 1), f('a', 'consumes', 'k', 2), f('a', 'provides', 'k', 3), f('b', 'consumes', 'k', 4)]).map((x) => x.line), [1, 3, 4]);
  const g = (target, line) => ({ file: 'a', dir: 'consumes', key: '/api', target, line });
  assert.deepEqual(onePerKey([g('BILLING_API_URL', 1), g('LEDGER_API_URL', 2), g('billing', 3), g('billing:8080', 4), g('Billing:9090', 5), g(undefined, 6)]).map((x) => x.line), [1, 2, 3, 6],
    'two peers behind one path are two facts; one host with or without a port is one');
  const st = {};
  assert.deepEqual(cleanUnresolved(st, 'test/.env.test', [{ raw: 'A=${A}' }]), [], 'never from a test path');
  assert.deepEqual(cleanUnresolved(st, '.env', [{ raw: ' A=${A} ' }, { raw: 'A=${A}' }]).map((u) => u.raw), ['A=${A}'], 'one per trimmed raw text');
  assert.equal(cleanUnresolved(st, 'b.env', Array.from({ length: 60 }, (_, i) => ({ raw: `r${i}` }))).length, 49, 'at most 50 per detector per member (the cap spans files)');
  assert.deepEqual(cleanUnresolved({}, null, [{ raw: 'x', file: 'testdata/a.proto' }, { raw: 'y', file: 'a.proto' }]).map((u) => u.raw), ['y'], 'a finish() list checks each item\'s own file');
  assert.equal(isMinified('dist2/app.js', `${'x'.repeat(1001)}\n`), true);
  assert.equal(isMinified('src/app.ts', 'const a = 1;\n'.repeat(1000)), false);
  assert.equal(isMinified('a.py', 'x'.repeat(5000)), false, 'only the JS family');
  for (const i of ['redis:7', 'postgres', 'postgres@sha256:abc', 'docker.io/library/nginx:1']) assert.equal(isLibraryImage(i), true, i);
  for (const i of ['bitnami/redis', 'ghcr.io/acme/web:1', 'localhost:5000/app', '', null]) assert.equal(isLibraryImage(i), false, String(i));
  for (const i of ['${IMAGE}', 'IMAGE', '{{ .Values.image }}', '$IMAGE_NAME']) assert.equal(isLibraryImage(i), false, `a placeholder is no official image (the workload stays this member's): ${i}`);
});

test('text: aliasable — never from a test path; a nested manifest only for a multi-word name', () => {
  assert.equal(aliasable('pom.xml', 'api'), true, 'the root manifest names the member');
  assert.equal(aliasable('services/api/pom.xml', 'api'), false, 'a nested generic module name would claim every api.* host');
  assert.equal(aliasable('services/api/pom.xml', 'billing-api'), true);
  assert.equal(aliasable('src/test/resources/pom.xml', 'billing-fixture'), false);
  assert.equal(aliasable('pom.xml', ' '), false);
  for (const rel of ['docs/deploy/k8s.yaml', 'examples/compose.yml', 'app/Samples/.env', 'quickstart/compose.yaml', 'guide/tutorials/k8s.yaml']) assert.equal(isSamplePath(rel), true, rel);
  for (const rel of ['deploy/k8s.yaml', 'docsite/a.yml', 'my-examples/x.yml', 'docs.yaml', 'overlays/demo/k8s.yaml']) assert.equal(isSamplePath(rel), false, rel);
});

test('xml: leaves with element paths, parents and lines; comments/CDATA skipped; attribute lines', () => {
  const x = '<project>\n  <!-- <artifactId>no</artifactId> -->\n  <artifactId>a</artifactId>\n  <x><![CDATA[<artifactId>no</artifactId>]]></x>\n  <Ref Version="1"\n       Include="Pkg" />\n</project>';
  const { leaves, elements } = scanXml(x);
  assert.deepEqual(leaves.filter((l) => l.name === 'artifactId').map((l) => [l.path, l.text, l.line]), [['project/artifactId', 'a', 3]]);
  const ref = elements.find((e) => e.name === 'Ref');
  assert.deepEqual([ref.attrs.Include, ref.line, ref.attrLines.Include], ['Pkg', 5, 6]);
  assert.doesNotThrow(() => scanXml('<a><b>unclosed</a></c>'));
});

test('toml: dotted/quoted headers, key lines, parse errors are values', () => {
  assert.deepEqual(splitDotted(`target.'cfg(unix)'.dependencies`), ['target', 'cfg(unix)', 'dependencies']);
  assert.deepEqual(splitDotted('tool . poetry'), ['tool', 'poetry']);
  const text = '[package]\nname = "a"\n\n[dependencies.serde]\nversion = "1"\n\n[dependencies]\n"quoted-dep" = "1"\n';
  const lines = splitLines(text);
  const secs = tomlSections(lines);
  assert.equal(tomlKeyLine(lines, secs, ['package'], 'name'), 2);
  assert.equal(tomlKeyLine(lines, secs, ['dependencies'], 'serde'), 4);
  assert.equal(tomlKeyLine(lines, secs, ['dependencies'], 'quoted-dep'), 8);
  assert.equal(loadToml('[a\n').data, null);
  assert.match(loadToml('[a\n').error, /\S/);
});

test('text: hasCode — tooling, repository config and task-runner files, load and integration tests and the top-level docs / examples trees are no service code; a Java package named example is', () => {
  const has = (f) => hasCode({ files: [f], state: {} });
  for (const f of ['internal/tools/tools.go', 'scripts/seed.py', '.github/scripts/x.js', '.yarn/releases/yarn-4.1.0.cjs', 'test/a.py',
    'commitlint.config.js', 'release.config.cjs', 'sentry/sentry.conf.example.py', '.eslintrc.js', '.pnp.cjs', 'dangerfile.ts', 'Gruntfile.js', 'gulpfile.js',
    'jakefile.js', 'noxfile.py', 'magefile.go', 'fabfile.py', 'renovate.js', 'tasks.py', 'conftest.py', 'setup.py', 'sphinx/conf.py',
    '_integration-test/run.py', 'load-test/run.py', 'perf/bench.go', 'k6/script.js', 'locust/run.py', 'benchmarks/b.go', 'docs/build.py', 'examples/demo.py', 'samples/a.go', 'quickstart/a.js', 'tutorials/a.py']) {
    assert.equal(has(f), false, f);
  }
  for (const f of ['main.go', 'src/app.py', 'src/main/java/com/example/demo/App.java', 'services/docs/app.py', 'app/Main.hs', 'src/config.ts', 'locustfile.py']) assert.equal(has(f), true, f); // a load generator's locustfile is its code
});
