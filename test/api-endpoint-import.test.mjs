// test/api-endpoint-import.test.mjs
// Importing what a server you run serves (model-bridge-design.md §8.4): the two routes over a
// stubbed endpoint, the entries they write (free, keyless, the served window pinned), a second
// import that refreshes instead of duplicating, the rows that are refused, the CLI's own listing
// and import, and the import sheet's markup. Sandboxes HOME (settings.json) + WORCA_HOME (DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { _resetForTests } from '../src/core/db.mjs';
import { cmdModels } from '../src/cli/models.mjs';
import { renderEndpointSheet, collectImportSheet, applyImportSelectAll } from '../ui/public/bridge-view.mjs';

let srv, base, endpoint, endpointUrl, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
const realFetch = globalThis.fetch;
const jfetch = async (path, opts) => { const r = await realFetch(`${base}${path}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (path, body) => jfetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// A stand-in Ollama: /api/tags with one chat model, one that cannot call tools and one embedding.
let tagsBody;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-epimp-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-epimp-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  tagsBody = { models: [
    { name: 'qwen3-coder:30b', size: 18556700761, capabilities: ['completion', 'tools'], details: { parameter_size: '30.5B', quantization_level: 'Q4_K_M', context_length: 262144 } },
    { name: 'nomic-embed-text:latest', size: 274302450, capabilities: ['embedding'], details: { context_length: 2048 } },
  ] };
  endpoint = http.createServer((req, res) => {
    const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/tags') return send(tagsBody);
    if (req.url === '/api/ps') return send({ models: [{ name: 'qwen3-coder:30b', context_length: 65536 }] });
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => endpoint.listen(0, '127.0.0.1', r));
  endpointUrl = `http://127.0.0.1:${endpoint.address().port}/v1`;
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (endpoint) await new Promise((r) => endpoint.close(r));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  _resetForTests();
  await rm(homeDir, { recursive: true, force: true });
  await rm(worcaHomeDir, { recursive: true, force: true });
});

test('GET /api/providers/openai/models asks the endpoint and marks what may be imported', async () => {
  const { status, body } = await jfetch(`/api/providers/openai/models?baseUrl=${encodeURIComponent(endpointUrl)}`);
  assert.equal(status, 200);
  assert.equal(body.server, 'ollama');
  assert.equal(body.serverLabel, 'Ollama');
  const by = Object.fromEntries(body.models.map((m) => [m.id, m]));
  assert.equal(by['qwen3-coder:30b'].catalogId, 'ollama-qwen3-coder-30b');
  assert.equal(by['qwen3-coder:30b'].inCatalog, false);
  assert.equal(by['qwen3-coder:30b'].importable, true);
  assert.equal(by['qwen3-coder:30b'].servedContext, 65536);
  assert.equal(by['nomic-embed-text:latest'].importable, false);
  assert.match(by['nomic-embed-text:latest'].blocked, /embedding model/);
  assert.ok(body.warnings.length);
  // An unreachable endpoint is a 400 that says what was tried, not a 500.
  const dead = await jfetch('/api/providers/openai/models?baseUrl=http://127.0.0.1:9/v1');
  assert.equal(dead.status, 400);
  assert.match(dead.body.error, /no OpenAI-compatible model list/);
  const bad = await jfetch('/api/providers/openai/models?baseUrl=not-a-url');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /http\(s\) URL/);
});

test('POST import: the entry is free, keyless, ready, and carries the served window; a re-import refreshes it', async () => {
  const first = await post('/api/providers/openai/import-models', { ids: ['qwen3-coder:30b', 'nomic-embed-text:latest', 'ghost'], baseUrl: endpointUrl });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.created, ['ollama-qwen3-coder-30b']);
  assert.deepEqual(first.body.updated, []);
  assert.deepEqual(first.body.skipped.map((s) => s.id).sort(), ['ghost', 'nomic-embed-text:latest']);
  assert.match(first.body.skipped.find((s) => s.id === 'ghost').why, /does not serve it/);
  const entry = first.body.models.find((m) => m.id === 'ollama-qwen3-coder-30b');
  assert.deepEqual(entry.cost, { free: true });
  assert.equal(entry.upstream.baseUrl, endpointUrl);
  assert.equal(entry.upstream.apiKey, undefined, 'a local endpoint needs no key');
  assert.deepEqual(entry.upstream.capabilities, { toolCalls: true, maxPromptTokens: 65536 });
  assert.equal(entry.bridged, 'openai');
  assert.equal(entry.needsSignIn, false, 'ready without a key: the base URL is local');
  assert.deepEqual(entry.efforts, ['medium']);

  // The user renames it and prices it; a second import refreshes the upstream only.
  const patched = await jfetch('/api/models/ollama-qwen3-coder-30b', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'My coder' }) });
  assert.equal(patched.status, 200);
  tagsBody.models[0].details.context_length = 300000;   // the endpoint changed under us
  const second = await post('/api/providers/openai/import-models', { ids: ['qwen3-coder:30b'], baseUrl: endpointUrl });
  assert.deepEqual(second.body.created, []);
  assert.deepEqual(second.body.updated, ['ollama-qwen3-coder-30b']);
  const again = second.body.models.find((m) => m.id === 'ollama-qwen3-coder-30b');
  assert.equal(again.label, 'My coder', 'a label the user edited is never overwritten');
  assert.equal(again.upstream.capabilities.maxPromptTokens, 65536);
  assert.equal((await post('/api/providers/openai/import-models', { ids: [], baseUrl: endpointUrl })).status, 400);
});

test('worca models import openai lists the endpoint, then imports a pick', async () => {
  const out = [];
  const c = (_, s) => s;
  const code = await cmdModels(['import', 'openai', '--base-url', endpointUrl], { out: (l) => out.push(l), c, fail: (m) => { throw new Error(m); } });
  assert.equal(code, 0);
  const text = out.join('\n');
  assert.match(text, /^Ollama at http:\/\/127\.0\.0\.1:\d+\/v1 \(pass --all/m);
  assert.match(text, /qwen3-coder:30b\s+66k\s+tools/);
  assert.match(text, /nomic-embed-text:latest.*\(an embedding model — not a chat model\)/);
  assert.match(text, /! Ollama serves a 4096-token window by default/);
  assert.match(text, /\(in catalog\)/, 'the entry imported above is marked');

  const out2 = [];
  const code2 = await cmdModels(['import', 'openai', '--base-url', endpointUrl, '--pick', 'nomic-embed-text:latest', '--yes'], { out: (l) => out2.push(l), c, fail: (m) => { throw new Error(m); } });
  assert.equal(code2, 0);
  assert.match(out2.join('\n'), /- nomic-embed-text:latest \(skipped: an embedding model/);
  await assert.rejects(() => cmdModels(['import', 'openai', '--base-url', 'http://127.0.0.1:9/v1', '--all', '--yes'], { out: () => {}, c, fail: (m) => { throw new Error(m); } }), /no OpenAI-compatible model list/);
});

test('the import sheet: a blocked row cannot be ticked, an unknown window says what the model supports', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const sheet = renderEndpointSheet({
    server: 'ollama', serverLabel: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1',
    warnings: ['Ollama serves a 4096-token window by default'],
    models: [
      { id: 'qwen3-coder:30b', name: 'qwen3-coder:30b', catalogId: 'ollama-qwen3-coder-30b', servedContext: 65536, trainedContext: 262144, toolCalls: true, vision: false, loaded: true, importable: true, detail: '30.5B · Q4_K_M', inCatalog: false },
      { id: 'glm-4.7-flash:latest', name: 'glm-4.7-flash:latest', catalogId: 'ollama-glm-4-7-flash-latest', servedContext: null, trainedContext: 202752, toolCalls: true, vision: false, loaded: false, importable: true, detail: null, inCatalog: true },
      { id: 'nomic-embed-text:latest', name: 'nomic-embed-text:latest', catalogId: 'ollama-nomic-embed-text-latest', servedContext: null, trainedContext: 2048, toolCalls: false, vision: false, loaded: false, importable: false, blocked: 'an embedding model — not a chat model', detail: null, inCatalog: false },
    ],
  }, { doc });
  doc.body.appendChild(sheet);
  assert.equal(sheet.dataset.source, 'endpoint');
  assert.equal(sheet.dataset.baseurl, 'http://127.0.0.1:11434/v1');
  assert.equal(sheet.querySelector('.mv-editor-title').textContent, 'Import from Ollama');
  assert.match(sheet.querySelector('.mvi-warn').textContent, /4096-token window by default/);
  const rows = [...sheet.querySelectorAll('tbody tr')];
  assert.deepEqual(rows.map((r) => r.dataset.id), ['qwen3-coder:30b', 'glm-4.7-flash:latest', 'nomic-embed-text:latest']);
  assert.equal(rows[0].querySelector('td.num').textContent, '66k');
  assert.equal(rows[1].querySelector('.mvi-ctx-unknown').textContent, '? · supports 203k');
  assert.equal(rows[1].querySelector('.mvi-status').textContent, 'in catalog ✓ · not loaded');
  assert.ok(rows[2].classList.contains('mvi-disabled'));
  assert.equal(rows[2].querySelector('.mvi-cb').disabled, true);
  assert.match(rows[2].querySelector('.mvi-status').textContent, /an embedding model/);
  applyImportSelectAll(sheet, true);
  assert.deepEqual(collectImportSheet(sheet), ['qwen3-coder:30b', 'glm-4.7-flash:latest'], 'select-all skips what cannot be imported');
  // Nothing importable: the button is dead rather than posting an empty pick.
  const empty = renderEndpointSheet({ serverLabel: 'Ollama', baseUrl: 'http://x/v1', models: [{ id: 'e', importable: false }] }, { doc });
  assert.equal(empty.querySelector('.mvi-go').disabled, true);
});
