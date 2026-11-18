import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewBase, previewCsp, previewHeaders } from '../src/core/design/preview-doc.mjs';

const B = 'http://localhost:4317/design-preview/TOK/';
const TAIL = (b, connect) => `style-src 'unsafe-inline' ${b}; img-src ${b} data: blob:; font-src ${b} data:; media-src ${b} data: blob:; connect-src ${connect}; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
test('build CSP is C-7 exactly', () => {
  assert.equal(previewCsp({ mode: 'build', base: B, nonce: 'N1' }),
    `sandbox allow-scripts; default-src 'none'; script-src 'nonce-N1'; ${TAIL(B, "'none'")}`);
});
test('run CSP is C-7 exactly', () => {
  assert.equal(previewCsp({ mode: 'run', base: B, nonce: 'N1' }),
    `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${B}; ${TAIL(B, B)}`);
});
test('build script-src admits the nonce and nothing else', () => {
  const s = previewCsp({ mode: 'build', base: B, nonce: 'N1' }).split('; ').find((d) => d.startsWith('script-src'));
  assert.equal(s, "script-src 'nonce-N1'");
  assert.ok(!previewCsp({ mode: 'build', base: B, nonce: 'N1' }).includes("'unsafe-eval'"));
  assert.ok(!previewCsp({ mode: 'run', base: B, nonce: 'N1' }).includes("'unsafe-eval'"));
  assert.ok(!previewCsp({ mode: 'run', base: B, nonce: 'N1' }).includes('nonce'), 'a nonce would disable unsafe-inline');
});
test('no {B}: IPv6 form names no source and still blocks everything else', () => {
  assert.equal(previewCsp({ mode: 'build', base: null, nonce: 'N1' }),
    "sandbox allow-scripts; default-src 'none'; script-src 'nonce-N1'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
  assert.equal(previewCsp({ mode: 'run', base: null, nonce: 'N1' }),
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
});
test('previewBase: proto and host forms', () => {
  const t = 'TOK';
  const cases = [
    [{ host: 'localhost:4317', protocol: 'http' }, 'http://localhost:4317/design-preview/TOK/'],
    [{ host: '127.0.0.1:4317', protocol: 'http' }, 'http://127.0.0.1:4317/design-preview/TOK/'],
    [{ host: 'worca-01.example.com', protocol: 'http', forwardedProto: 'https' }, 'https://worca-01.example.com/design-preview/TOK/'],
    [{ host: 'worca.example.com:8443', protocol: 'http', forwardedProto: 'https, http' }, 'https://worca.example.com:8443/design-preview/TOK/'],
    [{ host: 'localhost:4317', protocol: 'http', forwardedProto: 'gopher' }, 'http://localhost:4317/design-preview/TOK/'],
  ];
  for (const [input, base] of cases) assert.deepEqual(previewBase({ ...input, token: t }), { ok: true, base });
  assert.deepEqual(previewBase({ host: '[::1]:4317', protocol: 'http', token: t }), { ok: true, base: null });
  for (const host of ['localhost/;script-src *', 'localhost:4317;x', 'a b', 'localhost:4317,evil', '', undefined])
    assert.deepEqual(previewBase({ host, protocol: 'http', token: t }), { ok: false });
});
test('previewHeaders are exactly C-7', () => {
  assert.deepEqual(previewHeaders({ csp: 'X' }), {
    'Content-Security-Policy': 'X', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  });
});
test('previewBase: the pinned proto rule and the host bounds', () => {
  const t = 'TOK';
  const at = (proto) => ({ ok: true, base: `${proto}://localhost:4317/design-preview/TOK/` });
  const base = (input) => previewBase({ host: 'localhost:4317', token: t, ...input });
  assert.deepEqual(base({ protocol: 'http', forwardedProto: ' HTTPS ,http' }), at('https'), 'first value, trimmed and lowercased');
  assert.deepEqual(base({ protocol: 'https', forwardedProto: 'http' }), at('http'), 'a valid forwarded proto wins');
  assert.deepEqual(base({ protocol: 'https' }), at('https'), 'no forwarded proto: the request protocol');
  for (const protocol of [undefined, 'gopher', 'https:']) assert.deepEqual(base({ protocol }), at('http'), String(protocol));
  for (const host of ['localhost:123456', '[::1]:4317;x', '[::1];script-src *', 'localhost\n'])
    assert.deepEqual(previewBase({ host, protocol: 'http', token: t }), { ok: false }, JSON.stringify(host));
});
