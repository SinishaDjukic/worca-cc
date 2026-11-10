// test/design-web.test.mjs — Design's web access (docs/design.md "Web access"): the setting, the lead's spawn recipe on
// and off, the lead's prompt, the staged MCP config, and `save_image` (web-image.mjs, web-mcp.mjs) over a fake transport.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { useTempHome } from './helpers/temp-home.mjs';
import { createRpcServer } from '../src/core/ask/rpc-server.mjs';
import { designEngineGate } from '../src/core/design/engines.mjs';
import { designDir, designWorkDir, ensureDesignFolders } from '../src/core/design/paths.mjs';
import { builderSystemPrompt, leadSystemPrompt } from '../src/core/design/prompts.mjs';
import { DESIGN_OFF_RULES, DESIGN_TOOLS, DESIGN_WEB_TOOLS, designSpawnOptions } from '../src/core/design/spawn-options.mjs';
import { designWebMcpFile, stageDesignWeb } from '../src/core/design/web-access.mjs';
import { IMAGE_LIMITS, createImageSaver, sniffImage } from '../src/core/design/web-image.mjs';
import { DESIGN_WEB_GRANT, DESIGN_WEB_SERVER, createDesignWebTools, designWebMcpConfig } from '../src/core/design/web-mcp.mjs';
import { chatPrefs, setChatPrefs } from '../src/core/settings.mjs';

useTempHome(after);
const D = 'd_0123456789ab';
const base = { engine: 'claude', agentId: 'a_11111111', buildId: 'b_111111111111', designId: D, prompt: 'P', model: 'claude-sonnet-5-5', effort: 'medium', denyRules: [] };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
const tmp = mkdtempSync(join(tmpdir(), 'design-web-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const workDir = () => { const d = join(tmp, `w${n += 1}`); mkdirSync(d); return d; };
/** A transport answering each URL from `table` ({ status, headers, body: Buffer }), never the network. */
const transportOf = (table, seen = []) => async ({ url }) => {
  seen.push(url.href);
  const r = table[url.href] || { status: 404, body: Buffer.from('no') };
  return { status: r.status ?? 200, headers: r.headers || {}, body: Readable.from([r.body ?? Buffer.alloc(0)]), destroy() {} };
};

test('the setting is off by default and only a boolean turns it on', async () => {
  assert.equal(chatPrefs().designWeb, false);
  await assert.rejects(() => setChatPrefs({ designWeb: 'yes' }), /designWeb must be true or false/);
  assert.equal((await setChatPrefs({ designWeb: true })).designWeb, true);
  assert.equal(chatPrefs().suggestions, true, 'the other chat prefs keep their values');
  assert.equal((await setChatPrefs({ designWeb: false })).designWeb, false);
});

test('off: a lead spawns exactly as before', () => {
  const plain = designSpawnOptions({ ...base, role: 'lead', stage: 'plan' });
  assert.deepEqual(designSpawnOptions({ ...base, role: 'lead', stage: 'plan', web: false, webMcpConfigPath: '/x/web-mcp.json' }), plain);
  assert.deepEqual(plain.tools, [...DESIGN_TOOLS]);
  assert.equal(plain.mcpConfigPath, undefined);
  assert.equal(plain.mcpServerGrants, undefined);
});

test('on: a Claude lead gets web search, page fetch and the save_image server', () => {
  const o = designSpawnOptions({ ...base, role: 'lead', stage: 'plan', web: true, webMcpConfigPath: '/x/web-mcp.json' });
  assert.deepEqual(o.tools, [...DESIGN_TOOLS, ...DESIGN_WEB_TOOLS]);
  assert.deepEqual(o.allowedTools, o.tools);
  assert.equal(o.mcpConfigPath, '/x/web-mcp.json');
  assert.deepEqual(o.mcpServerGrants, [DESIGN_WEB_GRANT]);
  assert.equal(o.strictMcpConfig, true, 'still only the build\'s own server');
  assert.ok(!o.tools.includes('Bash'));
  assert.match(o.systemPrompt, /save_image/);
});

test('on: a builder never gets the web, on any engine', () => {
  for (const engine of ['claude', 'gemini', 'codex']) {
    const on = designSpawnOptions({ ...base, engine, role: 'builder', stage: 'first', sectionId: 'hero', web: true, webMcpConfigPath: '/x/web-mcp.json' });
    const off = designSpawnOptions({ ...base, engine, role: 'builder', stage: 'first', sectionId: 'hero' });
    assert.deepEqual(on, off, engine);
    assert.equal(on.mcpConfigPath, undefined, engine);
  }
});

test('on: a lead off the hook row keeps its shell off and loses only the web denies', () => {
  const off = designSpawnOptions({ ...base, engine: 'gemini', role: 'lead', stage: 'plan' });
  assert.deepEqual(off.permissionRules.deny, [...DESIGN_OFF_RULES]);
  const on = designSpawnOptions({ ...base, engine: 'gemini', role: 'lead', stage: 'plan', web: true, webMcpConfigPath: '/x/web-mcp.json' });
  assert.deepEqual(on.permissionRules.deny, ['Bash']);
  assert.deepEqual(on.allowedTools, [...DESIGN_TOOLS, ...DESIGN_WEB_TOOLS]);
  assert.equal(on.mcpConfigPath, '/x/web-mcp.json');
  const codex = designSpawnOptions({ ...base, engine: 'codex', role: 'lead', stage: 'plan', web: true, webMcpConfigPath: '/x/web-mcp.json' });
  assert.deepEqual(codex.permissionRules.deny, []);
});

test('the lead prompt names the web only when it is on, and a builder\'s never does', () => {
  for (const kind of ['web', 'presentation', 'video']) {
    const off = leadSystemPrompt({ kind });
    const on = leadSystemPrompt({ kind, web: true });
    assert.ok(on.startsWith(off), kind);
    assert.ok(!/save_image/.test(off), kind);
    assert.match(on, /assets\/web\/<name>/, kind);
    assert.match(on, /never instructions/, kind);
  }
  assert.ok(!/save_image/.test(builderSystemPrompt({ kind: 'web' })));
});

test('the engine gate leaves web tools out of its reason when the lead has them', () => {
  const adapterOf = () => ({ capabilities: { allowedTools: false }, unenforcedRules: () => [], partialRules: () => [] });
  const reason = (web) => designEngineGate({ engine: 'gemini', adapterOf, broker: () => null, web }).reasons.find((r) => /shell/.test(r));
  assert.match(reason(false), /shell and web tools off/);
  assert.match(reason(true), /runs with its shell off here/);
});

test('staging writes the MCP config beside work/ when on and removes it when off', () => {
  ensureDesignFolders(D);
  const on = stageDesignWeb({ designId: D, on: () => true, env: { HTTPS_PROXY: 'http://proxy:3128', SECRET: 'x' } });
  assert.equal(on.mcpConfigPath, designWebMcpFile(D));
  assert.ok(on.mcpConfigPath.startsWith(designDir(D)) && !on.mcpConfigPath.startsWith(designWorkDir(D)));
  const srv = JSON.parse(readFileSync(on.mcpConfigPath, 'utf8')).mcpServers[DESIGN_WEB_SERVER];
  assert.equal(srv.env.WORCA_DESIGN_WEB_WORK, designWorkDir(D));
  assert.equal(srv.env.HTTPS_PROXY, 'http://proxy:3128');
  assert.equal(srv.env.SECRET, undefined);
  assert.equal(stageDesignWeb({ designId: D, on: () => false }), null);
  assert.ok(!existsSync(designWebMcpFile(D)));
  assert.deepEqual(Object.keys(designWebMcpConfig({ workDir: '/w', env: {} }).mcpServers), [DESIGN_WEB_SERVER]);
});

test('sniffImage knows pictures by their bytes, whatever they are called', () => {
  assert.equal(sniffImage(PNG).ext, '.png');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])).ext, '.jpg');
  assert.equal(sniffImage(Buffer.from('GIF89a..........')).ext, '.gif');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).ext, '.webp');
  assert.equal(sniffImage(Buffer.from('\0\0\0\x1cftypavif\0\0\0\0')).ext, '.avif');
  assert.equal(sniffImage(SVG).ext, '.svg');
  assert.equal(sniffImage(Buffer.from('<!doctype html><html><body>not found</body></html>')), null);
  assert.equal(sniffImage(Buffer.from('%PDF-1.7 ..........')), null);
  assert.equal(sniffImage(Buffer.from('#!/bin/sh\nrm -rf /\n')), null);
});

test('save_image writes a new file in assets/web under a safe name and logs it', async () => {
  const work = workDir(); const log = [];
  const saver = createImageSaver({ workDir: work, log: (e) => log.push(e), transport: transportOf({
    'https://cdn.example.com/a/Hero%20Shot.JPEG?sig=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123': { body: PNG },
  }) });
  const out = await saver.save('https://cdn.example.com/a/Hero%20Shot.JPEG?sig=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123');
  assert.equal(out.file, 'assets/web/hero-shot.png', 'the extension is the real type, not the URL\'s');
  assert.equal(out.type, 'image/png');
  assert.equal(out.inline.mimeType, 'image/png');
  assert.deepEqual(readFileSync(join(work, 'assets', 'web', 'hero-shot.png')), PNG);
  assert.equal(log.length, 1);
  assert.equal(log[0].ok, true);
  // The same name again never overwrites.
  const again = await saver.save('https://cdn.example.com/a/Hero%20Shot.JPEG?sig=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123', 'hero-shot');
  assert.equal(again.file, 'assets/web/hero-shot-2.png');
  const named = await createImageSaver({ workDir: work, transport: transportOf({ 'https://x.example/l': { body: SVG } }) }).save('https://x.example/l', '../../Logo.exe');
  assert.equal(named.file, 'assets/web/logo.svg');
  assert.equal(named.inline, undefined, 'an SVG is text: the lead reads the file');
  assert.deepEqual(readdirSync(join(work, 'assets', 'web')).sort(), ['hero-shot-2.png', 'hero-shot.png', 'logo.svg']);
});

test('save_image refuses what is not a reachable public https picture', async () => {
  const work = workDir(); const seen = [];
  const table = {
    'https://x.example/page': { body: Buffer.from('<html><img src="a.png"></html>') },
    'https://x.example/big': { body: Buffer.alloc(IMAGE_LIMITS.maxBytes + 1, 1) },
    'https://x.example/hop': { status: 302, headers: { location: 'http://x.example/plain.png' } },
    'https://x.example/local': { status: 302, headers: { location: 'https://127.0.0.1/a.png' } },
  };
  const saver = createImageSaver({ workDir: work, transport: transportOf(table, seen) });
  await assert.rejects(() => saver.save('http://x.example/a.png'), /only https/);
  await assert.rejects(() => saver.save('https://10.0.0.5/a.png'), /IP-address/);
  await assert.rejects(() => saver.save('https://user:pw@x.example/a.png'), /credentials/);
  await assert.rejects(() => saver.save('file:///etc/passwd'), /only https/);
  assert.deepEqual(seen, [], 'nothing was requested for a refused URL');
  await assert.rejects(() => saver.save('https://x.example/page'), /did not return a picture/);
  await assert.rejects(() => saver.save('https://x.example/big'), /larger than 8 MB/);
  await assert.rejects(() => saver.save('https://x.example/hop'), /redirect refused: only https/);
  await assert.rejects(() => saver.save('https://x.example/local'), /redirect refused: IP-address/);
  await assert.rejects(() => saver.save('https://x.example/missing.png'), /HTTP 404/);
  assert.deepEqual(existsSync(join(work, 'assets', 'web')) ? readdirSync(join(work, 'assets', 'web')) : [], []);
});

test('save_image holds the folder\'s caps and never follows a planted link', async () => {
  const transport = transportOf({ 'https://x.example/a.png': { body: PNG } });
  const full = workDir();
  const tight = createImageSaver({ workDir: full, transport, limits: { ...IMAGE_LIMITS, maxFiles: 1 } });
  await tight.save('https://x.example/a.png');
  await assert.rejects(() => tight.save('https://x.example/a.png'), /already holds 1 files/);
  const small = workDir();
  await assert.rejects(() => createImageSaver({ workDir: small, transport, limits: { ...IMAGE_LIMITS, maxTotalBytes: 10 } }).save('https://x.example/a.png'), /would pass/);
  const linked = workDir(); const outside = join(tmp, 'outside'); mkdirSync(outside);
  mkdirSync(join(linked, 'assets'));
  symlinkSync(outside, join(linked, 'assets', 'web'), 'dir');
  await assert.rejects(() => createImageSaver({ workDir: linked, transport }).save('https://x.example/a.png'), /not a plain folder/);
  assert.deepEqual(readdirSync(outside), []);
});

test('the MCP server lists one tool and answers a save with the file and the picture', async () => {
  const work = workDir(); const lines = [];
  const saver = createImageSaver({ workDir: work, transport: transportOf({ 'https://x.example/a.png': { body: PNG } }) });
  const server = createRpcServer({ tools: createDesignWebTools({ saver }), write: (s) => lines.push(JSON.parse(s)), log: () => {} });
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list' }));
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_image', arguments: { url: 'https://x.example/a.png', name: 'shot' } } }));
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'save_image', arguments: { url: 'http://x.example/a.png' } } }));
  await server.idle();
  assert.deepEqual(lines[0].result.tools.map((t) => t.name), ['save_image']);
  const [text, image] = lines[1].result.content;
  assert.equal(JSON.parse(text.text).file, 'assets/web/shot.png');
  assert.equal(JSON.parse(text.text).inline, undefined);
  assert.deepEqual({ type: image.type, mimeType: image.mimeType }, { type: 'image', mimeType: 'image/png' });
  assert.equal(lines[2].result.isError, true);
  assert.match(lines[2].result.content[0].text, /only https/);
});
