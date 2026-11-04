// test/credentials-view.test.mjs
// Settings › My credentials (ui/public/credentials-view.mjs): status only,
// a link to the key page, never a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderCredentials } from '../ui/public/credentials-view.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

test('credentials view in multi, single, no-person and broker-error states', async () => {
  await checkRows([
    { name: 'multi mode: one row per slot with its state, and a Manage keys link to the key page', run: () => {
      const el = renderCredentials({
        enabled: true, mode: 'multi', keyPage: 'https://keys.example.com', person: 'ada@acme.dev',
        slots: [
          { id: 'anthropic', label: 'Anthropic API key', state: 'set', suffix: '1a2b' },
          { id: 'openai', label: 'OpenAI API key', state: 'missing' },
          { id: 'local', label: 'Local models', state: 'keyless' },
        ],
      }, doc);
      const rows = [...el.querySelectorAll('.cred-row')].map((r) => r.textContent);
      assert.deepEqual(rows, ['Anthropic API keySet ••••1a2b', 'OpenAI API keyNot set', 'Local modelsNo key needed']);
      const a = el.querySelector('a');
      assert.equal(a.href, 'https://keys.example.com/');
      assert.equal(a.target, '_blank');
      assert.match(a.className, /btn-primary/, 'a missing key makes Manage keys the primary action');
      // The hint is its own line, above the button.
      const acts = el.querySelector('.cred-actions');
      assert.deepEqual([...acts.children].map((c) => c.tagName), ['SMALL', 'A']);
      assert.match(acts.firstElementChild.textContent, /Opens the key page in a new tab/);
      // Without "push as me", no GitHub group and no group titles.
      assert.equal(el.querySelector('.cred-group-title'), null);
    } },
    { name: 'push as me: GitHub in its own group with what connecting does; it never counts as a model key', run: () => {
      const slots = [
        { id: 'anthropic', label: 'Anthropic API key', state: 'set', suffix: '1a2b' },
        { id: 'github', label: 'GitHub (push as me)', protocol: 'github', state: 'missing' },
      ];
      const off = renderCredentials({ enabled: true, mode: 'multi', keyPage: 'https://keys.example.com', person: 'ada@acme.dev', slots, githubAsPerson: null }, doc);
      assert.deepEqual([...off.querySelectorAll('.cred-row')].map((r) => r.textContent), ['Anthropic API keySet ••••1a2b'], 'off: no GitHub row');
      assert.doesNotMatch(off.querySelector('a').className, /btn-primary/);

      const prefer = renderCredentials({ enabled: true, mode: 'multi', keyPage: 'https://keys.example.com', person: 'ada@acme.dev', slots, githubAsPerson: 'prefer' }, doc);
      assert.deepEqual([...prefer.querySelectorAll('.cred-group-title')].map((t) => t.textContent), ['Models', 'GitHub']);
      assert.deepEqual([...prefer.querySelectorAll('.cred-row')].map((r) => r.textContent), ['Anthropic API keySet ••••1a2b', 'Your GitHub accountNot connected']);
      assert.match(prefer.textContent, /clones, pushes and creates PRs as you.*Until you connect it, Worca uses its own GitHub credential/);
      assert.doesNotMatch(prefer.querySelector('a').className, /btn-primary/, 'optional under prefer');

      const required = renderCredentials({ enabled: true, mode: 'multi', keyPage: 'https://keys.example.com', person: 'ada@acme.dev', slots, githubAsPerson: 'required' }, doc);
      assert.match(required.textContent, /your pushes and pull requests fail/);
      assert.match(required.querySelector('a').className, /btn-primary/, 'required: connecting is needed');

      const connected = renderCredentials({ enabled: true, mode: 'multi', keyPage: 'https://keys.example.com', person: 'ada@acme.dev', slots: [slots[0], { ...slots[1], state: 'set', suffix: '9z9z' }], githubAsPerson: 'required' }, doc);
      assert.match(connected.textContent, /Your GitHub accountConnected ••••9z9z/);
      assert.doesNotMatch(connected.querySelector('a').className, /btn-primary/);

      const noSlot = renderCredentials({ enabled: true, mode: 'multi', keyPage: 'https://keys.example.com', person: 'ada@acme.dev', slots: [slots[0]], githubAsPerson: 'prefer' }, doc);
      assert.match(noSlot.textContent, /no GitHub row to connect one/);
    } },
    { name: 'credentials view: single mode, no person and broker error states', run: async () => {
      await checkRows([
        { name: 'single mode says where keys live; no key page link', run: () => {
          const el = renderCredentials({ enabled: true, mode: 'single', keyPage: null, person: null, slots: [{ id: 'anthropic', label: 'Anthropic API key', state: 'set' }] }, doc);
          assert.match(el.textContent, /held by the credential broker/);
          assert.equal(el.querySelector('a'), null);
        } },
        { name: 'no signed-in person, and a broker that did not answer', run: () => {
          assert.match(renderCredentials({ enabled: true, mode: 'multi', person: null, slots: [] }, doc).textContent, /Sign in/);
          assert.match(renderCredentials({ enabled: true, error: 'cannot reach' }, doc).textContent, /didn't answer: cannot reach/);
        } },
      ]);
    } },
  ]);
});
