// test/agent-store-ask-forms.test.mjs
// A USER agent's ask forms (spec §11): the sidecar round-trips them, a complete
// v2 PUT can REMOVE them, and gate 1 runs on every write with every failed rule
// named. Nothing is written when the gate fails.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAgent, readAgent, updateAgent, userAgentsDir } from '../src/core/agent-store.mjs';

useTempHome(after);

const FORM = {
  version: 1, title: 'Pick one',
  data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } } },
  answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] } } },
  layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }],
  example: { summary: 'Something happened.' },
};
const META = (over = {}) => ({
  metaVersion: 2, displayName: 'Asker', description: 'asks', runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
  ...over,
});

test('an ask block survives create -> disk -> read', async () => {
  const { meta } = await createAgent({
    meta: META({ key: 'askRoundtrip', ask: { forms: { 'pick-one': FORM } } }),
    markdown: '# asker\n',
  });
  assert.deepEqual(Object.keys(meta.ask.forms), ['pick-one']);
  const onDisk = JSON.parse(await readFile(join(userAgentsDir(), 'askRoundtrip.meta.json'), 'utf8'));
  assert.equal(onDisk.ask.forms['pick-one'].title, 'Pick one', 'the sidecar carries the block verbatim');
  const back = await readAgent('askRoundtrip');
  assert.equal(back.meta.ask.forms['pick-one'].version, 1);
});

test('a complete v2 PUT that omits ask REMOVES every form', async () => {
  await createAgent({ meta: META({ key: 'askClearable', ask: { forms: { 'pick-one': FORM } } }), markdown: '# a\n' });
  const { meta } = await updateAgent('askClearable', { meta: META({ key: 'askClearable' }) });
  assert.equal(meta.ask, undefined, 'without this the last form could never be deleted from the editor');
  const onDisk = JSON.parse(await readFile(join(userAgentsDir(), 'askClearable.meta.json'), 'utf8'));
  assert.equal(onDisk.ask, undefined);
});

test('gate 1 refuses a bad form with code ASK_FORM, every failed rule named, nothing written', async () => {
  const bad = { ...FORM, layout: [{ widget: 'grid', bind: 'data.summary' }, { widget: 'select', field: 'nosuch', label: 'X' }] };
  await assert.rejects(
    async () => createAgent({ meta: META({ key: 'askBad', ask: { forms: { 'pick-one': bad } } }), markdown: '# a\n' }),
    (e) => {
      assert.equal(e.code, 'ASK_FORM');
      assert.ok(Array.isArray(e.errors) && e.errors.length >= 2, JSON.stringify(e.errors));
      assert.ok(e.errors.every((x) => x.path.startsWith('ask.forms."pick-one"')), JSON.stringify(e.errors));
      assert.ok(e.errors.some((x) => x.path === 'ask.forms."pick-one" layout#1' && x.code === 'unknown-widget'),
        JSON.stringify(e.errors));
      assert.match(e.message, /grid/);
      return true;
    },
  );
  assert.equal(await readAgent('askBad'), null, 'a refused create writes nothing');
});

test('a bad form id is an ASK_FORM error carrying P1\u2019s own sentence', async () => {
  await assert.rejects(
    async () => createAgent({ meta: META({ key: 'askBadId', ask: { forms: { 'Not An Id': FORM } } }), markdown: '# a\n' }),
    (e) => {
      assert.equal(e.code, 'ASK_FORM');
      assert.deepEqual(e.errors, [{
        path: 'ask.forms."Not An Id"', code: 'bad-id',
        message: 'form id "Not An Id" must match /^[a-z][a-z0-9-]{0,47}$/',
      }]);
      return true;
    },
  );
});

test('a whole-block refusal is ONE issue against `ask`, with no per-form noise', async () => {
  await assert.rejects(
    async () => createAgent({ meta: META({ key: 'askBadBlock', ask: 'yes please' }), markdown: '# a\n' }),
    (e) => {
      assert.equal(e.code, 'ASK_FORM');
      assert.deepEqual(e.errors, [{ path: 'ask', code: 'dialect', message: '"ask" is { forms: { <id>: <form> } }' }]);
      return true;
    },
  );
});

test('an update that breaks a form leaves the stored sidecar untouched', async () => {
  await createAgent({ meta: META({ key: 'askKeep', ask: { forms: { 'pick-one': FORM } } }), markdown: '# a\n' });
  const bad = { ...FORM, example: { summary: 42 } };   // example must validate against `data`
  await assert.rejects(
    async () => updateAgent('askKeep', { meta: META({ key: 'askKeep', ask: { forms: { 'pick-one': bad } } }) }),
    (e) => e.code === 'ASK_FORM',
  );
  const back = await readAgent('askKeep');
  assert.equal(back.meta.ask.forms['pick-one'].example.summary, 'Something happened.');
});

test('an agent with no ask block is completely unaffected', async () => {
  const { meta } = await createAgent({ meta: META({ key: 'askNone' }), markdown: '# a\n' });
  assert.equal(meta.ask, undefined);
  const onDisk = JSON.parse(await readFile(join(userAgentsDir(), 'askNone.meta.json'), 'utf8'));
  assert.equal('ask' in onDisk, false);
});
