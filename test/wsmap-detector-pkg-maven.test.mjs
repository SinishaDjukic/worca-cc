import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/pkg-maven.mjs';

const BILLING_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
  </parent>
  <groupId>com.acme</groupId>
  <artifactId>billing-api</artifactId>
  <description>Billing service for invoices</description>
  <properties>
    <shared.group>com.acme.shared</shared.group>
  </properties>
  <dependencies>
    <!-- <dependency><groupId>com.acme</groupId><artifactId>commented-out</artifactId></dependency> -->
    <dependency>
      <groupId>\${shared.group}</groupId>
      <artifactId>money</artifactId>
      <version>1.0</version>
    </dependency>
    <dependency>
      <groupId>\${project.groupId}</groupId>
      <artifactId>billing-model</artifactId>
    </dependency>
    <dependency>
      <scope>test</scope>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
    </dependency>
    <dependency>
      <groupId>\${unknown.group}</groupId>
      <artifactId>mystery</artifactId>
    </dependency>
  </dependencies>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.acme</groupId>
        <artifactId>acme-bom</artifactId>
        <version>2.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
      <dependency>
        <groupId>com.google.guava</groupId>
        <artifactId>guava</artifactId>
        <version>33.0</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-jar-plugin</artifactId></plugin></plugins></build>
</project>
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    'billing-api': { 'pom.xml': BILLING_POM, 'src/test/resources/pom.xml': '<project><groupId>t</groupId><artifactId>fixture</artifactId></project>' },
    web: { 'pom.xml': BILLING_POM.replace(/\n/g, '\r\n').replace('<artifactId>billing-api</artifactId>', '<artifactId>web</artifactId>') },
    broken: { 'pom.xml': '<project><groupId>com.acme</groupId><artifactId>half' },
    empty: { 'README.md': '# nothing' },
    fixtureonly: { 'src/test/resources/pom.xml': '<project><groupId>t</groupId><artifactId>fixture-app</artifactId><description>Test fixture</description></project>' },
    multi: {
      'pom.xml': '<project><groupId>com.acme</groupId><artifactId>multi-parent</artifactId></project>',
      'modules/api/pom.xml': '<project><parent><groupId>com.acme</groupId></parent><artifactId>api</artifactId></project>',
      'modules/billing-core/pom.xml': '<project><parent><groupId>com.acme</groupId></parent><artifactId>billing-core</artifactId></project>',
    },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('pkg-maven: provides groupId:artifactId, alias, role, stack java', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['maven:com.acme:billing-api', 'maven:t:fixture']);
  assert.deepEqual(r.aliases.map((a) => a.value).sort(), ['billing-api'], 'a test fixture pom never aliases the member');
  assert.deepEqual(r.stack, ['java']);
  assert.equal(r.role.text, 'Billing service for invoices');
  const p = r.facts.find((f) => f.key === 'maven:com.acme:billing-api');
  assert.equal(p.line, 10);
  assert.equal(p.match, '<artifactId>billing-api</artifactId>');
  assert.equal(p.norm, 'pkg:maven:com.acme:billing-api');
  assertEvidence(member('billing-api'), r);
});

test('pkg-maven: consumes dependencies with property substitution, BOM imports only from dependencyManagement', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), [
    'maven:com.acme.shared:money', 'maven:com.acme:acme-bom', 'maven:com.acme:billing-model', 'maven:org.junit.jupiter:junit-jupiter',
  ]);
  assert.equal(r.facts.find((f) => f.key.endsWith(':junit-jupiter')).detail, 'scope test');
  assert.equal(r.facts.find((f) => f.key.endsWith(':billing-model')).detail, undefined, 'scope before groupId stays with its own <dependency>');
  assert.equal(r.facts.find((f) => f.key.endsWith(':acme-bom')).detail, 'scope import, BOM import');
  assert.ok(!r.facts.some((f) => /commented-out|guava|maven-jar-plugin|spring-boot-starter-parent/.test(f.key)));
});

test('pkg-maven: an unresolvable ${…} coordinate is unresolved, not a fact', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason, u.file]), [['${unknown.group}:mystery', 'unresolved maven property', 'pom.xml']]);
});

test('pkg-maven: test-path poms still emit facts, marked test by extract — but no stack, alias or role', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  const f = r.facts.find((x) => x.key === 'maven:t:fixture');
  assert.equal(f.file, 'src/test/resources/pom.xml');
  assert.equal(f.test, true);
  const only = await runDetector(detector, member('fixtureonly'), ws.members);
  assert.deepEqual([only.stack, only.aliases, only.role, keysOf(only, 'pkg', 'provides')], [[], [], null, ['maven:t:fixture-app']], 'a test fixture pom sets no stack, alias or role');
});

test('pkg-maven: a nested module aliases the member only with a multi-word name', async () => {
  const r = await runDetector(detector, member('multi'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['maven:com.acme:api', 'maven:com.acme:billing-core', 'maven:com.acme:multi-parent']);
  assert.deepEqual(r.aliases.map((a) => a.value).sort(), ['billing-core', 'multi-parent'], '`api` would claim every api.* host');
});

test('pkg-maven: CRLF input keeps line numbers', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.equal(r.facts.find((f) => f.key === 'maven:com.acme:web').line, 10);
  assertEvidence(member('web'), r);
});

test('pkg-maven: truncated XML never throws and yields what it can', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), []);
  assert.deepEqual(r.stack, ['java']);
});

test('pkg-maven: a member without pom.xml yields nothing', async () => {
  const r = await runDetector(detector, member('empty'), ws.members);
  assert.deepEqual(r, { facts: [], aliases: [], unresolved: [], stack: [], role: null });
});
