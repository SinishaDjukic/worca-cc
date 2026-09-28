// test/wsmap-spec-long-scalar.test.mjs
// A node budget bounds how many nodes a spec detector visits, not the bytes it re-reads: one long scalar that every
// operation reads again — a server object aliased by every `servers` entry, a `$ref` aliased by every AsyncAPI 3
// operation, one long AsyncAPI 3 address every operation sends to — cost its length per reference (quadratic CPU), and
// a long server path or operationId joined into every fact's `detail` kept the whole joined string alive behind the
// clipped detail (a 1 MiB spec ran extract out of memory). Each long scalar is now read once per file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { detectorById } from '../src/core/workspace-map/detectors/index.mjs';

const KB = 1024;
const MB = 1024 * KB;
const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
/** head, then line(i) until the file is `size` long */
const grow = (head, line, size) => { let s = head; for (let i = 0; s.length < size - 16; i += 1) s += line(i.toString(36)); return s; };
const detect = (id, rel, text) => detectorById(id).detect({ rel, text }, { member, members: [member], files: [rel], state: {} });

// The retained-heap test runs first: once the detectors are warm, V8 may not keep the joined string (a fresh process does).
test('api-openapi / api-asyncapi: a long server path or operationId is never kept once per fact (retained heap)', () => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc');
  for (const [label, id, rel, text] of [
    ['asyncapi 2: one long operationId aliased by every channel', 'api-asyncapi', 'api/asyncapi.yaml',
      grow(`asyncapi: 2.6.0\nx-c: &c {subscribe: {operationId: ${'a'.repeat(64 * KB)}}}\nchannels:\n`, (k) => `  c${k}: *c\n`, 128 * KB)],
    ['openapi: one long server path, many operations', 'api-openapi', 'api/openapi.yaml',
      grow(`openapi: 3.0.0\nservers: [{url: "http://h/${'a'.repeat(64 * KB)}"}]\npaths:\n`, (k) => `  /${k}: {get: {}}\n`, 128 * KB)],
    ['openapi: one long operationId aliased by every path', 'api-openapi', 'api/openapi.yaml',
      grow(`openapi: 3.0.0\nx-p: &p {get: {operationId: ${'a'.repeat(64 * KB)}}}\npaths:\n`, (k) => `  /${k}: *p\n`, 128 * KB)],
  ]) {
    gc();
    const h0 = process.memoryUsage().heapUsed;
    const r = detect(id, rel, text);
    gc();
    const kept = process.memoryUsage().heapUsed - h0;
    assert.ok(r.facts.length > 3000 && r.facts.every((f) => f.detail.length <= 200), `${label}: ${r.facts.length} facts`);
    assert.ok(kept < 64 * MB, `${label}: ${(kept / MB).toFixed(0)} MiB kept by ${r.facts.length} facts, bound 64 MiB`);
  }
});

test('api-openapi / api-asyncapi: a long scalar every operation reads is read once per file (CPU time)', () => {
  for (const [label, id, rel, text, bound] of [
    ['openapi: one long server object aliased by every servers entry', 'api-openapi', 'api/openapi.yaml',
      `openapi: 3.0.0\nx-s: &s {url: "http://${'a'.repeat(96 * KB)}"}\nservers: [${'*s, '.repeat(24 * KB)}*s]\npaths: {/a: {get: {}}}\n`, 1500],
    ['asyncapi 3: one long $ref aliased by every operation', 'api-asyncapi', 'api/asyncapi.yaml',
      grow(`asyncapi: 3.0.0\nchannels:\n  c0: {address: x}\nx-r: &r {$ref: '#/channels/${'a'.repeat(256 * KB)}'}\nx-o: &o {action: send, channel: *r}\noperations:\n`, (k) => `  o${k}: *o\n`, 512 * KB), 2000],
    ['asyncapi 3: one long address every operation sends to', 'api-asyncapi', 'api/asyncapi.yaml',
      grow(`asyncapi: 3.0.0\nchannels:\n  c0: {address: ${'a'.repeat(512 * KB)}}\nx-o: &o {action: send, channel: {$ref: '#/channels/c0'}}\noperations:\n`, (k) => `  o${k}: *o\n`, MB), 3000],
  ]) {
    const c0 = process.cpuUsage();
    detect(id, rel, text);
    const c = process.cpuUsage(c0);
    const ms = (c.user + c.system) / 1000;
    assert.ok(ms < bound, `${label} (${(text.length / KB).toFixed(0)} KiB): ${ms.toFixed(0)} ms CPU, bound ${bound} ms`);
  }
});
