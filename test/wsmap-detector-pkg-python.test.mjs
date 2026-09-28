import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/pkg-python.mjs';

const PEP621 = `[project]
name = "Billing_Client"
description = "Typed client for the billing API"
dependencies = [
  "requests>=2.31",
  "Acme.Money[fast] ~= 1.0 ; python_version >= '3.10'",
  "shared-lib @ file:../shared-lib",
  "sub @ file:./sub",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[dependency-groups]
lint = ["ruff"]

[tool.uv.sources]
ledger = { path = "../ledger", editable = true }
`;
const POETRY = `[tool.poetry]
name = "orders"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110"
billing-client = { path = "../billing-client", develop = true }
internal = { path = "./libs/internal" }

[tool.poetry.group.test.dependencies]
pytest = "^8"
`;
const REQS = `# production deps
Django==5.0  # web
-r base.txt
--index-url https://pypi.example.com/simple
-e ../billing-client
-e git+https://github.com/acme/tools.git#egg=acme_tools
./vendored/shared_lib
celery[redis]>=5 ; sys_platform != "win32"
psycopg @ https://files.example.com/psycopg-3.whl
-e .
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    'billing-client': { 'pyproject.toml': PEP621 },
    orders: { 'pyproject.toml': POETRY, 'requirements/prod.txt': REQS.replace(/\n/g, '\r\n'), 'tests/requirements-test.txt': 'pytest\n' },
    'shared-lib': { 'setup.cfg': '[metadata]\nname = shared-lib\n' },
    broken: { 'pyproject.toml': '[project]\nname = "half-built"\ndependencies = [\n  "requests",\n' },
    odd: { 'pyproject.toml': '[project]\nname = "odd"\ndependencies = "requests"\n' },
    nested: {
      'pyproject.toml': '[project]\nname = "nested-root"\n',
      'services/api/pyproject.toml': '[project]\nname = "api"\n',
      'tests/fixtures/pyproject.toml': '[project]\nname = "fixture-pkg"\ndescription = "A test fixture"\n',
    },
    pyfixture: { 'tests/fixtures/pyproject.toml': '[project]\nname = "fixture-pkg"\n', 'tests/requirements.txt': 'pytest\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('pkg-python (PEP 621): provides the name (PEP 503 via normKey), alias, role, stack', async () => {
  const r = await runDetector(detector, member('billing-client'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['pypi:Billing_Client']);
  assert.equal(r.facts.find((f) => f.dir === 'provides').norm, 'pkg:pypi:billing-client');
  assert.deepEqual(r.aliases.map((a) => a.value), ['Billing_Client']);
  assert.equal(r.role.text, 'Typed client for the billing API');
  assert.deepEqual(r.stack, ['python']);
  assertEvidence(member('billing-client'), r);
});

test('pkg-python (PEP 621): dependencies, extras, dependency-groups, file: and uv path sources', async () => {
  const r = await runDetector(detector, member('billing-client'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), ['pypi:Acme.Money', 'pypi:pytest', 'pypi:requests', 'pypi:ruff', 'pypi:shared-lib']);
  const money = r.facts.find((f) => f.key === 'pypi:Acme.Money');
  assert.equal(money.norm, 'pkg:pypi:acme-money');
  assert.equal(money.line, 6);
  assert.equal(r.facts.find((f) => f.key === 'pypi:shared-lib').target, 'shared-lib');
  assert.equal(r.facts.find((f) => f.key === 'pypi:pytest').detail, 'extra dev');
  assert.ok(!r.facts.some((f) => f.key === 'pypi:sub'), '`sub @ file:./sub` stays inside the member: not a consume');
});

test('pkg-python (poetry): name, deps without python, path dep targets the member, groups', async () => {
  const r = await runDetector(detector, member('orders'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['pypi:orders']);
  const toml = r.facts.filter((f) => f.file === 'pyproject.toml' && f.dir === 'consumes');
  assert.deepEqual(toml.map((f) => f.key).sort(), ['pypi:billing-client', 'pypi:fastapi', 'pypi:pytest']);
  const bc = toml.find((f) => f.key === 'pypi:billing-client');
  assert.deepEqual([bc.target, bc.line, bc.detail], ['billing-client', 8, 'path ../billing-client']);
  assertEvidence(member('orders'), r);
});

test('pkg-python (requirements, CRLF): names, -e ../dir, #egg=, ./path, markers; skips options and -e .', async () => {
  const r = await runDetector(detector, member('orders'), ws.members);
  const req = r.facts.filter((f) => f.file === 'requirements/prod.txt');
  assert.deepEqual(req.map((f) => f.key), ['pypi:Django', 'pypi:billing-client', 'pypi:acme_tools', 'pypi:celery', 'pypi:psycopg'], './vendored/… stays inside the member: not a consume');
  const local = req.find((f) => f.key === 'pypi:billing-client');
  assert.deepEqual([local.target, local.confidence, local.line], ['billing-client', 'heuristic', 5]);
  assert.equal(req.find((f) => f.key === 'pypi:acme_tools').norm, 'pkg:pypi:acme-tools');
});

test('pkg-python: only the root pyproject names the member (a nested one needs a multi-word name); a fixture sets no role', async () => {
  const r = await runDetector(detector, member('nested'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['pypi:api', 'pypi:fixture-pkg', 'pypi:nested-root']);
  assert.deepEqual(r.aliases.map((a) => a.value), ['nested-root']);
  assert.equal(r.role, null, 'a test-path pyproject says nothing about the member\'s role');
  const only = await runDetector(detector, member('pyfixture'), ws.members);
  assert.deepEqual([only.aliases, only.stack], [[], []], 'test-path manifests alone set no stack');
});

test('pkg-python: requirements under a test path are facts marked test', async () => {
  const r = await runDetector(detector, member('orders'), ws.members);
  const t = r.facts.find((f) => f.file === 'tests/requirements-test.txt');
  assert.deepEqual([t.key, t.test], ['pypi:pytest', true]);
});

test('pkg-python: malformed pyproject → heuristic provide + unresolved, never throws', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['pypi:half-built']);
  assert.equal(r.facts[0].confidence, 'heuristic');
  assert.equal(r.unresolved.length, 1);
  assert.match(r.unresolved[0].reason, /^toml parse error/);
  const odd = await runDetector(detector, member('odd'), ws.members);
  assert.deepEqual(keysOf(odd, 'pkg', 'consumes'), [], 'a string where a list belongs is ignored, never split into characters');
});

test('pkg-python: setup.cfg only → nothing claimed; requirement-file name variants are claimed', async () => {
  const r = await runDetector(detector, member('shared-lib'), ws.members);
  assert.deepEqual(r.facts, []);
  for (const rel of ['dev-requirements.txt', 'requirements-dev.txt', 'ci/test_requirements.txt', 'requirements.in', 'requirements/base.in']) assert.equal(detector.claims(rel), true, rel);
  for (const rel of ['myrequirements.txt', 'requirements.txt.bak', 'requirements.md']) assert.equal(detector.claims(rel), false, rel);
});
