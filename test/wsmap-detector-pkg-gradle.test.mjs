import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/pkg-gradle.mjs';

const GROOVY_SETTINGS = `rootProject.name = 'billing'
include ':billing-client', ':billing-server'
include ':shared'
project(':shared').projectDir = file('../shared-lib')
project(':billing-client').projectDir = file('libs/billing-client')
`;
const GROOVY_BUILD = `plugins { id 'java' }
allprojects {
    group = 'com.acme'
}
dependencies {
    implementation 'com.acme:money:1.2.0'
    implementation group: 'com.acme', name: 'ledger', version: '3.0'
    // implementation 'com.acme:commented:1.0'
    api platform('com.acme:acme-bom:2.0')
    testImplementation "org.junit.jupiter:junit-jupiter:5.10.0"
    implementation project(':shared')
    implementation project(':billing-client')
    implementation "\${acmeGroup}:dynamic:1.0"
    implementation(
        'com.acme:multi-line:1.0'
    )
}
`;
const KTS_SETTINGS = `rootProject.name = "web"\r\ninclude("web-ui")\r\ninclude(\r\n    ":web-api",\r\n)\r\n`;
const KTS_BUILD = `plugins { kotlin("jvm") version "2.0.0" }\r\ngroup = "com.acme.web"\r\ndependencies {\r\n    implementation("com.acme:billing-client:1.0")\r\n    implementation(libs.money)\r\n    implementation(libs.bundles.ledger)\r\n    testFixturesImplementation("com.acme:fixtures:1.0")\r\n}\r\n`;
const CATALOG = `[versions]
money = "1.2"

[libraries]
money = { module = "com.acme:money", version.ref = "money" }
"ledger-core" = { group = "com.acme", name = "ledger-core", version = "3" }
guava = "com.google.guava:guava:33.0-jre"

[bundles]
ledger = ["ledger-core"]
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    billing: { 'settings.gradle': GROOVY_SETTINGS, 'build.gradle': GROOVY_BUILD },
    'shared-lib': { 'build.gradle': "group = 'com.acme'\n" },
    web: { 'settings.gradle.kts': KTS_SETTINGS, 'build.gradle.kts': KTS_BUILD, 'gradle/libs.versions.toml': CATALOG },
    app: { 'settings.gradle': "rootProject.name = 'app'\n", 'build.gradle': "dependencies { implementation 'org.slf4j:slf4j-api:2.0' }\n", 'gradle/libs.versions.toml': '[libraries\nbroken = ' },
    shop: {
      'settings.gradle.kts': 'rootProject.name = "shop"\ninclude(":app")\n',
      'build.gradle.kts': 'group = "com.acme"\n',
      'build-logic/settings.gradle.kts': 'rootProject.name = "build-logic"\ninclude(":conventions")\n',
    },
    // A Gradle plugin repo: its TestKit fixture build lives under src/test/resources.
    nested: { 'backend/settings.gradle': "rootProject.name = 'app'\n", 'backend/build.gradle': "group = 'com.acme'\n" },
    varargs: { 'build.gradle': "dependencies {\n    implementation 'com.acme:one:1.0',\n        'com.acme:two:1.0', \"com.acme:three:1.0\"\n    runtimeOnly 'com.acme:four:1', 'com.acme:five:1'\n    implementation 'com.acme:six:1', { transitive = false }\n}\n" },
    // nowinandroid-style: the root build declares no group; the included build-logic/ build does.
    incl: {
      'settings.gradle.kts': 'rootProject.name = "incl-app"\ninclude(":app")\nincludeBuild("build-logic")\n',
      'app/build.gradle.kts': 'plugins { id("acme.convention") }\n',
      'build-logic/settings.gradle.kts': 'rootProject.name = "build-logic"\n',
      'build-logic/convention/build.gradle.kts': 'group = "com.acme.buildlogic"\n',
    },
    testkit: { 'build.gradle': "plugins { id 'java-gradle-plugin' }\ngroup = 'com.acme'\n", 'src/test/resources/fixtures/sample/settings.gradle': "rootProject.name = 'fixture-app'\ninclude ':web'\n", 'src/test/resources/fixtures/sample/build.gradle.kts': 'plugins { kotlin("jvm") version "2.0.0" }\ngroup = "org.fixture"\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('pkg-gradle (Groovy): provides group:rootProject.name and every include; alias = rootProject.name', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['maven:com.acme:billing', 'maven:com.acme:billing-client', 'maven:com.acme:billing-server', 'maven:com.acme:shared']);
  assert.deepEqual(r.aliases.map((a) => a.value), ['billing']);
  assert.deepEqual(r.stack, ['java']);
  assertEvidence(member('billing'), r);
});

test('pkg-gradle (Groovy): consumes string, map and platform coordinates; skips comments', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  const consumes = keysOf(r, 'pkg', 'consumes');
  for (const k of ['maven:com.acme:money', 'maven:com.acme:ledger', 'maven:com.acme:acme-bom', 'maven:org.junit.jupiter:junit-jupiter']) assert.ok(consumes.includes(k), k);
  assert.ok(!consumes.some((k) => k.includes('commented')));
  assert.equal(r.facts.find((f) => f.key === 'maven:com.acme:money').line, 6);
});

test('pkg-gradle: project(":x") remapped into another member consumes it (target = member); intra-build project deps do not', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  const proj = r.facts.filter((f) => f.detail?.startsWith('project dependency'));
  assert.deepEqual(proj.map((f) => [f.key, f.target, f.line]), [['maven:com.acme:shared', 'shared-lib', 11]]);
});

test('pkg-gradle: an interpolated coordinate is unresolved', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason, u.line]), [['${acmeGroup}:dynamic:1.0', 'interpolated gradle coordinate', 13]]);
  assert.equal(r.facts.find((f) => f.key === 'maven:com.acme:multi-line').line, 15, 'a call spanning lines cites its coordinate\'s line');
});

test('pkg-gradle (Kotlin DSL, CRLF): provides, consumes, version catalog, kotlin stack', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['maven:com.acme.web:web', 'maven:com.acme.web:web-api', 'maven:com.acme.web:web-ui'], 'a multi-line include(…) list counts');
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), ['maven:com.acme:billing-client', 'maven:com.acme:fixtures', 'maven:com.acme:ledger-core', 'maven:com.acme:money', 'maven:com.google.guava:guava']);
  assert.deepEqual(r.stack, ['java', 'kotlin']);
  assert.equal(r.facts.find((f) => f.key === 'maven:com.acme:ledger-core').line, 6);
  assert.deepEqual(r.facts.filter((f) => f.detail?.startsWith('version catalog')).map((f) => [f.key, f.confidence]).sort(),
    [['maven:com.acme:ledger-core', 'exact'], ['maven:com.acme:money', 'exact'], ['maven:com.google.guava:guava', 'heuristic']],
    'a library a build references (directly or through a bundle) is exact; one only declared in the catalog is a guess');
  assertEvidence(member('web'), r);
});

test('pkg-gradle: an included build (build-logic/) never names the member; only the root settings\' includes provide', async () => {
  const r = await runDetector(detector, member('shop'), ws.members);
  assert.deepEqual(r.aliases.map((a) => a.value), ['shop']);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['maven:com.acme:app', 'maven:com.acme:shop']);
});

test('pkg-gradle: a TestKit fixture build (test path) never names the member, sets no group or stack', async () => {
  const r = await runDetector(detector, member('testkit'), ws.members);
  assert.deepEqual([r.aliases, keysOf(r, 'pkg', 'provides'), r.stack], [[], [], ['java']], 'only the root build.gradle counts (no fixture name, group or kotlin)');
  const nested = await runDetector(detector, member('nested'), ws.members);
  assert.deepEqual([nested.aliases, keysOf(nested, 'pkg', 'provides')], [[], ['maven:com.acme:app']], 'a nested settings file names the member only with a multi-word name');
});

test('pkg-gradle (Groovy): a call listing several coordinates (varargs, across lines) consumes each at its own line', async () => {
  const r = await runDetector(detector, member('varargs'), ws.members);
  assert.deepEqual(r.facts.map((f) => [f.key, f.line]).sort(), [['maven:com.acme:five', 4], ['maven:com.acme:four', 4], ['maven:com.acme:one', 2], ['maven:com.acme:six', 5], ['maven:com.acme:three', 3], ['maven:com.acme:two', 3]]);
  assertEvidence(member('varargs'), r);
});

test('pkg-gradle: an included build\'s group (build-logic/) never keys the member\'s provides', async () => {
  const r = await runDetector(detector, member('incl'), ws.members);
  assert.deepEqual([r.aliases.map((a) => a.value), keysOf(r, 'pkg', 'provides')], [['incl-app'], []], 'the root build declares no group: nothing is provided');
});

test('pkg-gradle: no group → alias only; malformed catalog → unresolved, other files still read', async () => {
  const r = await runDetector(detector, member('app'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), []);
  assert.deepEqual(r.aliases.map((a) => a.value), ['app']);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), ['maven:org.slf4j:slf4j-api']);
  assert.equal(r.unresolved.length, 1);
  assert.match(r.unresolved[0].reason, /^toml parse error/);
});
