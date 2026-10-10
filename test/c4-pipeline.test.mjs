// The Architecture (C4) pipeline's deterministic half: the check rules (c4-check.mjs), the setup
// form data discovery builds (c4-discover.mjs), the render plan and the browser search
// (c4-render.mjs, c4-raster.mjs), where the cards look on a project vs a workspace run
// (c4-paths.mjs), the offline architect (src/core/c4-mock.mjs) and the V55 seed. The viewer's
// parser and layouts are covered by test/c4-view.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { checkC4, isBlocking } from '../scripts/c4-check.mjs';
import runCheck from '../scripts/c4-check.mjs';
import runDiscover, { setupFormData } from '../scripts/c4-discover.mjs';
import { renderPlan, parseFormats } from '../scripts/c4-render.mjs';
import { browserCandidates } from '../scripts/c4-raster.mjs';
import { c4Roots, resolveC4Path, toPosixRel } from '../scripts/c4-paths.mjs';
import { parseBandLines, bandsFor, mockC4Source, writeMockC4 } from '../src/core/c4-mock.mjs';
import { migrate } from '../src/core/db.mjs';
import { assertRunnableWorkflow } from '../src/core/workflows.mjs';
import { GRAPH_ARCHITECTURE_WORKFLOW, ARCHITECTURE_WORKFLOW_ID } from '../src/core/graph/architecture-workflow.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

const tmp = mkdtempSync(join(tmpdir(), 'worca-c4-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const WORCA_MODEL = readFileSync(new URL('../docs/architecture/architecture.c4', import.meta.url), 'utf8');

const SMALL = `specification { element system  deploymentNode zone }
model { a = system 'A'  b = system 'B'  a -> b 'calls' }
deployment { front = zone 'Front' { metadata { criteria 'what people see' }  ta = instanceOf a }
  back = zone 'Back' { tb = instanceOf b } }
views { view index { include * }  deployment view deployment { include front.*, back.* } }`;

test('checkC4: the rules, blocking vs minor', async () => {
  await checkRows([
    { name: "worca's own model is clean", run: () => {
      const r = checkC4(WORCA_MODEL);
      assert.deepEqual(r.findings.filter(isBlocking), []);
      assert.ok(r.views.length >= 14 && r.views.some((v) => v.type === 'deployment'));
    } },
    { name: 'a small two-band file is clean, its bands counted', run: () => {
      const r = checkC4(SMALL);
      assert.deepEqual(r.findings, []);
      assert.deepEqual(r.bands.map((b) => [b.title, b.placed]), [['Front', 1], ['Back', 1]]);
    } },
    { name: 'a file that does not parse is critical', run: () => {
      const r = checkC4('model { a = system \'A\' ');
      assert.equal(r.findings[0].severity, 'critical');
      assert.equal(r.model, null);
    } },
    { name: 'an empty band is major', run: () => {
      const r = checkC4(SMALL.replace("ta = instanceOf a", ''));
      assert.ok(r.findings.some((f) => f.severity === 'major' && /band "Front" is empty/.test(f.title)));
    } },
    { name: 'no views at all is major', run: () => {
      const r = checkC4(SMALL.replace(/views \{[\s\S]*$/, 'views { }'));
      assert.ok(r.findings.some((f) => f.severity === 'major' && f.title === 'no views'));
    } },
    { name: 'a deployment view that drops a band is minor, never blocking', run: () => {
      const r = checkC4(SMALL.replace('include front.*, back.*', 'include front.*'));
      const f = r.findings.find((x) => /leaves out band "Back"/.test(x.title));
      assert.ok(f && !isBlocking(f));
    } },
  ]);
});

/** A card's calling convention, the way script-runner.mjs builds it. */
function cardIo(dir, ports) {
  mkdirSync(dir, { recursive: true });
  return Object.fromEntries(ports.map((p) => [p, { path: join(dir, `${p}.out`) }]));
}

test('c4Check card: the verdict is a review ({ issues }), and both outputs are written either way', async () => {
  const proj = join(tmp, 'check'); mkdirSync(join(proj, 'docs'), { recursive: true });
  const pdir = join(tmp, 'check-run');
  const model = join(pdir, 'c4-model.json');
  mkdirSync(pdir, { recursive: true });
  const run = async (text) => {
    writeFileSync(join(proj, 'docs', 'a.c4'), text);
    writeFileSync(model, JSON.stringify({ path: 'docs/a.c4' }));
    const outputs = cardIo(pdir, ['review', 'checked']);
    const res = await runCheck({ inputs: { model: { path: model } }, outputs, params: {}, ctx: { cwd: proj, pipelineDir: pdir }, log: () => {} });
    return { res, outputs };
  };
  const clean = await run(SMALL);
  assert.deepEqual(clean.res.verdict.issues, [], 'clean: no issues, so the engine routes `checked`');
  assert.ok(existsSync(clean.outputs.review.path) && existsSync(clean.outputs.checked.path));
  const bad = await run(SMALL.replace("ta = instanceOf a", ''));
  assert.ok(bad.res.verdict.issues.some((i) => i.severity === 'major'), 'a major issue blocks and routes `review`');
  assert.ok(existsSync(bad.outputs.checked.path), 'the clean-only output is still written (the script contract)');
});

test('c4Discover: finds .c4 files per root, skips ignored dirs, builds the setup form data', async () => {
  const a = join(tmp, 'ws-a'); const b = join(tmp, 'ws-b');
  mkdirSync(join(a, 'docs'), { recursive: true }); mkdirSync(join(a, 'node_modules', 'x'), { recursive: true }); mkdirSync(b, { recursive: true });
  writeFileSync(join(a, 'docs', 'arch.c4'), SMALL);
  writeFileSync(join(a, 'node_modules', 'x', 'dep.c4'), SMALL);
  const pdir = join(tmp, 'disc-run');
  const outputs = cardIo(pdir, ['found', 'brief']);
  const ctx = { cwd: a, pipelineDir: pdir, workspace: { members: [{ key: 'a-1', name: 'shop-api', dir: a }, { key: 'b-2', name: 'shop-web', dir: b }] } };
  await runDiscover({ outputs, params: { ignore: 'node_modules,.git' }, ctx, log: () => {} });
  const found = JSON.parse(readFileSync(outputs.found.path, 'utf8'));
  assert.equal(found.count, 1, 'node_modules is skipped');
  assert.equal(found.files[0].id, 'a-1/docs/arch.c4', 'a workspace id carries the member key');
  assert.equal(found.files[0].path, 'docs/arch.c4', 'paths are member-relative with /');
  assert.match(found.checkCommand, /c4-check-cli\.mjs" <FILE>$/);
  assert.deepEqual(found.rootDirs.map((r) => r.key), ['a-1', 'b-2']);
  const fd = found.formData;
  assert.equal(fd.defaultTarget, 'Update a found file');
  assert.equal(fd.defaultFile, 'a-1/docs/arch.c4');
  assert.equal(fd.files[0].project, 'shop-api', 'the table shows the member NAME');
  assert.deepEqual(fd.projects, [{ id: 'a-1', name: 'shop-api' }, { id: 'b-2', name: 'shop-web' }]);
  assert.equal(fd.files[0].bands, 'Front · Back');
});

test('setupFormData: nothing found defaults to creating a file in the first project', () => {
  const fd = setupFormData({ count: 0, files: [] }, [{ key: 'demo', name: 'demo', dir: '/x' }]);
  assert.equal(fd.defaultTarget, 'Create a new file');
  assert.equal(fd.defaultFile, '');
  assert.equal(fd.defaultProject, 'demo');
  assert.match(fd.summary, /No C4 file in `demo`/);
});

test('c4Roots / resolveC4Path: project, detached workspace, attached workspace', async () => {
  await checkRows([
    { name: 'single project: one root named after the project folder, not the worktree', run: () => {
      assert.deepEqual(c4Roots({ cwd: '/runs/abc/worktree-x1', projectDir: '/code/acme-todo' }), [{ key: 'acme-todo', name: 'acme-todo', dir: '/runs/abc/worktree-x1' }]);
    } },
    { name: 'detached workspace: ctx.repos, names from the workspace', run: () => {
      const r = c4Roots({ repos: [{ key: 'k1', dir: '/r/1' }], workspace: { members: [{ key: 'k1', name: 'Api', dir: '/r/1' }] } });
      assert.deepEqual(r, [{ key: 'k1', name: 'Api', dir: '/r/1' }]);
    } },
    { name: 'an envelope with a project resolves inside that member', run: () => {
      const ctx = { workspace: { members: [{ key: 'k1', dir: join('/r', '1') }, { key: 'k2', dir: join('/r', '2') }] } };
      assert.equal(resolveC4Path({ path: 'docs/a.c4', project: 'k2' }, ctx), join('/r', '2', 'docs', 'a.c4'));
      assert.equal(resolveC4Path({ path: 'docs/a.c4' }, ctx), join('/r', '1', 'docs', 'a.c4'));
      assert.equal(resolveC4Path({ path: '' }, ctx), null);
    } },
    { name: 'toPosixRel always uses /', run: () => {
      assert.equal(toPosixRel(join('/r', '1'), join('/r', '1', 'docs', 'a.c4')), 'docs/a.c4');
    } },
  ]);
});

test('renderPlan: card params win over the setup answers, which win over the defaults', async () => {
  await checkRows([
    { name: 'defaults', run: () => assert.deepEqual(renderPlan({}, {}), { formats: ['svg', 'jpeg'], views: [], viewKind: 'all', scale: 2, dark: false, commit: true, outDir: '' }) },
    { name: 'setup answers', run: () => {
      const p = renderPlan({}, { exports: ['PNG'], exportViews: 'Deployment sheet only', imagesTo: 'Run artifacts only' });
      assert.deepEqual([p.formats, p.viewKind, p.commit], [['png'], 'deployment', false]);
    } },
    { name: 'params (a wire, or Ask setting them) win', run: () => {
      const p = renderPlan({ formats: 'jpg, svg', views: 'deployment,index', commit: 'true', scale: 9 }, { exports: ['PNG'], imagesTo: 'Run artifacts only' });
      assert.deepEqual([p.formats, p.views, p.viewKind, p.commit, p.scale], [['jpeg', 'svg'], ['deployment', 'index'], 'listed', true, 4]);
    } },
    { name: 'parseFormats drops unknown names and duplicates', run: () => assert.deepEqual(parseFormats('svg,gif,JPEG,jpg'), ['svg', 'jpeg']) },
  ]);
});

test('browserCandidates: an override first, then the OS install paths, then PATH', () => {
  const win = browserCandidates('win32', { WORCA_CHROME: 'C:\\c.exe', PROGRAMFILES: 'C:\\Program Files', PATH: 'C:\\bin' });
  assert.equal(win[0], 'C:\\c.exe');
  assert.ok(win.some((p) => p.includes('Microsoft') && p.endsWith('msedge.exe')));
  assert.ok(win.some((p) => p.endsWith('chrome.exe')));
  const mac = browserCandidates('darwin', { HOME: '/Users/x', PATH: '/usr/bin' });
  assert.ok(mac.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  const linux = browserCandidates('linux', { PATH: '/usr/bin:/snap/bin' });
  assert.ok(linux.includes(join('/usr/bin', 'chromium')) && linux.includes(join('/snap/bin', 'google-chrome')));
});

test('the mock architect honours the setup answers and writes a file the check passes', async () => {
  assert.deepEqual(parseBandLines('Shoppers — people who buy\nBackend — servers\n  Order API — the order service').map((b) => [b.id, b.title, b.criteria, b.frames.map((f) => f.title)]),
    [['shoppers', 'Shoppers', 'people who buy', []], ['backend', 'Backend', 'servers', ['Order API']]]);
  for (const values of [{}, { bandsPreset: 'Deployment: You · Host · Services · Data · Models' }, { bandsPreset: 'No bands (element views only)' },
    { bandsPreset: 'My own (below)', bands: 'A — a\nB — b\n  C — c' }]) {
    const r = checkC4(mockC4Source(bandsFor(values)));
    assert.deepEqual(r.findings.filter(isBlocking), [], JSON.stringify(values));
  }
  // create, then update the file it created
  const proj = join(tmp, 'mock-proj'); const pdir = join(tmp, 'mock-run'); mkdirSync(proj, { recursive: true }); mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, 'c4-setup.json'), JSON.stringify({ values: { target: 'Create a new file', newPath: 'arch/model.c4' } }));
  const created = writeMockC4({ modelPath: join(pdir, 'c4-model.json'), cwd: proj });
  assert.deepEqual([created.path, created.created], ['arch/model.c4', true]);
  writeFileSync(join(pdir, 'c4-found.json'), JSON.stringify({ files: [{ id: 'arch/model.c4', path: 'arch/model.c4' }] }));
  writeFileSync(join(pdir, 'c4-setup.json'), JSON.stringify({ values: { target: 'Update a found file', file: 'arch/model.c4' } }));
  const updated = writeMockC4({ modelPath: join(pdir, 'c4-model.json'), cwd: proj });
  assert.equal(updated.created, false);
  assert.match(readFileSync(join(proj, 'arch', 'model.c4'), 'utf8'), /mock architect pass/);
  // a path that escapes the checkout falls back to the default
  writeFileSync(join(pdir, 'c4-setup.json'), JSON.stringify({ values: { target: 'Create a new file', newPath: '../../etc/x.c4' } }));
  assert.equal(writeMockC4({ modelPath: join(pdir, 'c4-model.json'), cwd: proj }).path, 'docs/architecture/architecture.c4');
});

test('V55 seeds wf_architecture_c4 on a fresh DB, and it validates against the shipped sidecars', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(ARCHITECTURE_WORKFLOW_ID);
  assert.ok(row, 'seeded');
  assert.equal(row.name, 'Architecture (C4)');
  assert.equal(row.domain, 'architecture');
  const graph = JSON.parse(row.graph);
  assert.deepEqual(graph.nodes.map((n) => n.id), GRAPH_ARCHITECTURE_WORKFLOW.nodes.map((n) => n.id));
  assertRunnableWorkflow({ id: row.id, version: 2, nodes: graph.nodes, wires: graph.wires });
  db.close();
});
