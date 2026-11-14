// test/design-tool-input-reader.test.mjs — incremental reader for streamed tool arguments (P2 Task 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createToolInputReader } from '../src/core/design/tool-input.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/design/design-long-write.jsonl', import.meta.url));

const P = '/w/sections/hero/index.html';
const VALUE = '<h1 class="t">é\n\t\\ 😀 \u2028</h1>';
const ascii = (s) => s.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const run = (chunks) => { const calls = []; const r = createToolInputReader({ onField: (c) => calls.push(c) }); for (const c of chunks) r.feed(c); r.end(); return calls; };
const check = (calls) => {
  assert.deepEqual(calls[0], { field: 'file_path', chunk: P, done: true });
  const body = calls.filter((c) => c.field === 'content');
  assert.equal(body.map((c) => c.chunk).join(''), VALUE);
  assert.equal(body.filter((c) => c.done).length, 1);
  assert.equal(body.at(-1).done, true);
};
const forms = [{ file_path: P, content: VALUE }, { content: VALUE, file_path: P }].flatMap((o) => [JSON.stringify(o), ascii(JSON.stringify(o))]);

test('every two-chunk split gives the same fields, path first, in either key order', () => {
  for (const json of forms) for (let i = 0; i <= json.length; i++) check(run([json.slice(0, i), json.slice(i)]));
});
test('one code unit per feed still decodes every escape', () => {
  for (const json of forms) check(run([...Array(json.length).keys()].map((i) => json[i])));
});
test('nested and non-string values are skipped, not mistaken for fields', () => {
  const calls = run(['{"file_path":"/a","replace_all":true,"n":3,"x":{"content":"no"},"y":[1,"no",{"content":"no"}],"content":"yes"}']);
  assert.equal(calls.filter((c) => c.field === 'content').map((c) => c.chunk).join(''), 'yes');
});
test('old_string and new_string are reported; other keys are not', () => {
  const calls = run(['{"file_path":"/a","old_string":"o","new_string":"n","other":"z"}']);
  assert.deepEqual([...new Set(calls.map((c) => c.field))], ['file_path', 'old_string', 'new_string']);
});
test('a feed makes one call, never one per character, and no empty chunks', () => {
  const calls = run(['{"file_path":"/a","content":"abc', 'def"}']);
  assert.deepEqual(calls.filter((c) => c.field === 'content'), [{ field: 'content', chunk: 'abc', done: false }, { field: 'content', chunk: 'def', done: false }, { field: 'content', chunk: '', done: true }]);
});
test('end() closes a truncated value and drops a partial escape or a lone surrogate', () => {
  assert.equal(run(['{"file_path":"/a","content":"ab\\u00']).filter((c) => c.field === 'content').map((c) => c.chunk).join(''), 'ab');
  assert.equal(run(['{"file_path":"/a","content":"ab\\ud83d']).filter((c) => c.field === 'content').map((c) => c.chunk).join(''), 'ab');
});
test('content with no file_path is dropped at end()', () => { assert.deepEqual(run(['{"content":"abc"']), []); });
test('garbage never throws and stops the reader', () => { assert.deepEqual(run(['not json', '{"file_path":"/a"}']), []); });
test('an empty feed is a no-op and end() is idempotent', () => {
  const calls = []; const r = createToolInputReader({ onField: (c) => calls.push(c) });
  r.feed(''); r.end(); r.end();
  assert.deepEqual(calls, []);
});
test('no chunk ends inside a surrogate pair, raw or escaped, and only a close is empty', () => {
  const endsHigh = (s) => { const c = s.charCodeAt(s.length - 1); return c >= 0xd800 && c <= 0xdbff; };
  // A feed whose only decoded text is a held high surrogate makes no call at all, not an empty one.
  const sound = (c) => !endsHigh(c.chunk) && (c.chunk !== '' || c.done);
  for (const json of forms) {
    for (let i = 0; i <= json.length; i++) for (const c of run([json.slice(0, i), json.slice(i)])) assert.ok(sound(c), `split ${i}: ${JSON.stringify(c)}`);
    for (const c of run([...Array(json.length).keys()].map((i) => json[i]))) assert.ok(sound(c), JSON.stringify(c));
  }
});
test('end() reports the close of a cut value; a cut file_path drops everything', () => {
  assert.deepEqual(run(['{"file_path":"/a","content":"ab']).filter((c) => c.field === 'content'), [{ field: 'content', chunk: 'ab', done: false }, { field: 'content', chunk: '', done: true }]);
  assert.deepEqual(run(['{"content":"x","file_path":"/a']), []);
  const calls = []; const r = createToolInputReader({ onField: (c) => calls.push(c) });
  r.feed('{"file_path":"/a","content":"ab'); r.end(); r.feed('cd"}'); r.end();
  assert.deepEqual(calls.map((c) => c.chunk), ['/a', 'ab', ''], 'a feed after end() is a no-op');
  const late = []; const r2 = createToolInputReader({ onField: (c) => late.push(c) });
  r2.feed('{"content":"x"'); r2.end(); r2.feed(',"file_path":"/a"}'); r2.end();
  assert.deepEqual(late, [], 'a path after end() sends nothing');
});
test('brackets and escaped quotes inside a nested string do not end the nested value', () => {
  const calls = run(['{"file_path":"/a","x":{"k":"}\\"]","l":["[{"]},"content":"yes"}']);
  assert.equal(calls.filter((c) => c.field === 'content').map((c) => c.chunk).join(''), 'yes');
});
test('a bad escape, a bad hex digit or a mismatched nested bracket stops the reader too', () => {
  assert.deepEqual(run(['{"x":[1}', ',"file_path":"/a"}']), []);
  assert.deepEqual(run(['{"content":"x" junk,"file_path":"/a"}']), []);
  const content = (chunks) => run(chunks).filter((c) => c.field === 'content').map((c) => c.chunk).join('');
  assert.equal(content(['{"file_path":"/a","content":"a\\qb"}']), 'a');
  assert.equal(content(['{"file_path":"/a","content":"a\\u00zzb"}']), 'a');
  assert.doesNotThrow(() => run([undefined, null, 5, '{"file_path":"/a"}']));
});
test('file_path is reported once; a repeated field is skipped', () => {
  assert.deepEqual(run(['{"file_path":"/a","content":"x","file_path":"/b","content":"y"}']), [
    { field: 'file_path', chunk: '/a', done: true }, { field: 'content', chunk: 'x', done: false }, { field: 'content', chunk: '', done: true }]);
});

/**
 * The main-stream `Write` tool_use blocks of a recorded stream-json capture, each as its raw
 * `input_json_delta` chunks. Read from the raw frames, not through the normalizer: the reader
 * must stand on what the CLI streams. Block indices restart per message, so a block is open
 * from its `content_block_start` to the `content_block_stop` of the same index.
 */
function recordedWrites(lines) {
  const blocks = [];
  let open = null;
  for (const line of lines) {
    const f = JSON.parse(line);
    if (f.type !== 'stream_event' || (f.parent_tool_use_id ?? null) !== null) continue;
    const ev = f.event || {};
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && ev.content_block.name === 'Write') {
      open = { index: ev.index, chunks: [] };
      blocks.push(open);
    } else if (open && ev.index === open.index && ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
      open.chunks.push(typeof ev.delta.partial_json === 'string' ? ev.delta.partial_json : '');
    } else if (open && ev.index === open.index && ev.type === 'content_block_stop') {
      open = null;
    }
  }
  return blocks;
}

test('the recorded long Write joins to the tool input', { skip: !existsSync(FIXTURE) }, () => {
  // Compared with JSON.parse of the joined partial_json, not the assistant frame's `input`: the capture
  // sanitizer rewrites each line on its own (ask-capture-fixtures.mjs:56-64), so a path split across two
  // chunks survives there while the assistant frame's copy of it was rewritten.
  const writes = recordedWrites(readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean));
  assert.ok(writes.length >= 1, 'the fixture holds a main-stream Write');
  for (const { chunks } of writes) {
    const input = JSON.parse(chunks.join(''));
    const calls = run(chunks);
    assert.deepEqual(calls[0], { field: 'file_path', chunk: input.file_path, done: true });
    const body = calls.filter((c) => c.field === 'content');
    assert.equal(body.map((c) => c.chunk).join(''), input.content);
    assert.equal(body.filter((c) => c.done).length, 1);
    assert.equal(body.at(-1).done, true);
    assert.ok(body.every((c) => c.chunk !== '' || c.done), 'no empty chunk before the closing call');
  }
});
