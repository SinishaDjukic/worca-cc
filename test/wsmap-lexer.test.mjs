// test/wsmap-lexer.test.mjs — the one generic literal lexer (wsmap P1, spec D13).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractLiterals } from '../src/core/workspace-map/lexer.mjs';

const values = (text) => extractLiterals(text).map((l) => [l.value, l.line, l.via]);

test('quoted, single-quoted and template literals, with ${…} → {} in value but not in raw', () => {
  const text = [
    'const a = "https://billing:8080/invoices";',
    "fetch('/api/users/' + id)",
    'get(`${base}/orders/${order.id}/items`)',
    'say("it\\"s")',
  ].join('\n');
  assert.deepEqual(values(text), [
    ['https://billing:8080/invoices', 1, 'quoted'],
    ['/api/users/', 2, 'quoted'],
    ['{}/orders/{}/items', 3, 'template'],
    ['it\\"s', 4, 'quoted'],
  ]);
  const t = extractLiterals(text)[2];
  assert.equal(t.raw, '${base}/orders/${order.id}/items', 'raw is a literal substring of the line');
});

test('config lines: KEY=value, key: value, YAML list items; CRLF tolerated', () => {
  const text = 'BILLING_URL=http://billing:8080 # comment\r\nspring:\r\n  kafka.topic: orders.created\r\n  - billing:9090\r\nname: "quoted"\r\n';
  assert.deepEqual(values(text), [
    ['http://billing:8080', 1, 'kv'],
    ['orders.created', 3, 'kv'],
    ['billing:9090', 4, 'kv'],
    ['quoted', 5, 'quoted'],
  ]);
});

test('obvious comment lines are skipped; unterminated quotes, huge literals and PEM bodies ignored', () => {
  const text = ['// fetch("/commented")', '# url: "/also-commented"', ' * "@see /x"', "it's not a literal", `x = "${'y'.repeat(600)}"`,
    '-----BEGIN PRIVATE KEY-----', 'b64=QUJDREVG', '-----END PRIVATE KEY-----', '"ok"'].join('\n');
  assert.deepEqual(values(text).map((v) => v[0]), ['ok']);
});

test('empty and non-string input → []', () => {
  assert.deepEqual(extractLiterals(''), []);
  assert.deepEqual(extractLiterals(null), []);
});

test('extractLiterals stays linear on long pathological lines (ReDoS guard)', () => {
  // The first five are the shapes v1 was quadratic on (each took well over 10 s); linear, every
  // input takes milliseconds — the 3 s ceiling only absorbs a loaded machine.
  const inputs = ['\\"'.repeat(1 << 17), '`${'.repeat(87381), 'a: x' + ' '.repeat(1 << 18) + 'y', '- x' + ' '.repeat(1 << 18) + 'y',
    'a= b' + ' '.repeat(1 << 18) + 'c', '"' + 'a'.repeat(1 << 20), '0123456789abcdef'.repeat(1 << 16),
    // a lone CR / U+2028 (classic-Mac or \r\r\n line ends) that `.` cannot cross but `\s` can: v2's `\s*(.*)$` took 79 s on the first
    'a:' + ' '.repeat(1 << 18) + 'x'.repeat(1 << 18) + '\r', '- ' + ' '.repeat(1 << 18) + 'x'.repeat(1 << 18) + String.fromCharCode(0x2028)];
  for (const s of inputs) {
    const t0 = performance.now();
    extractLiterals(s);
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `${JSON.stringify(s.slice(0, 8))}… (${s.length} chars) took ${Math.round(ms)} ms`);
  }
});
