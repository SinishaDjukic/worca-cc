// test/chat-link-route.test.mjs — every rule of a chat link click (issue 1064 §3), and the known refusers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkDecision, linkHint, sameAddress } from '../ui/public/chat-link-route.mjs';
import { isKnownFrameRefuser } from '../src/shared/frame-refusers.mjs';

const base = { button: 0, meta: false, ctrl: false, shift: false, alt: false, origin: 'http://localhost:4317', enabled: true, refused: () => false };
const go = (href, extra = {}) => linkDecision({ ...base, href, ...extra });

test('schemes: mailto and tel native, javascript/data/file inert, # native', () => {
  assert.deepEqual(go('mailto:a@b.c'), { action: 'native' });
  assert.deepEqual(go('tel:+123'), { action: 'native' });
  for (const h of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:http://x/1']) assert.deepEqual(go(h), { action: 'inert' }, h);
  assert.deepEqual(go('#history/p/abcd1234'), { action: 'native' });
  assert.deepEqual(go('javascript:alert(1)', { enabled: false }), { action: 'inert' });
});

test('modifiers and other buttons keep the browser convention', () => {
  for (const m of [{ meta: true }, { ctrl: true }, { shift: true }, { alt: true }, { button: 1 }]) {
    assert.deepEqual(go('https://example.org/', m), { action: 'native' }, JSON.stringify(m));
    assert.deepEqual(go('http://localhost:5173/', m), { action: 'native' }, JSON.stringify(m));
  }
});

test('worca\'s own page routes in place (also 127.0.0.1 on its port), never framed; its other paths open as today', () => {
  assert.deepEqual(go('http://localhost:4317/#runs'), { action: 'inapp', hash: '#runs' });
  assert.deepEqual(go('http://127.0.0.1:4317/'), { action: 'inapp', hash: '#' });
  assert.deepEqual(go('http://localhost:4317'), { action: 'inapp', hash: '#' });
  assert.deepEqual(go('http://localhost:4317/api/runs/x/file.pdf'), { action: 'native' });
  assert.deepEqual(go('http://127.0.0.1:4317/preview/5173/tok/'), { action: 'native' });
  // default ports follow the scheme: an https page on 443 owns https://localhost/, not http://localhost/ (port 80)
  assert.deepEqual(go('https://localhost/#runs', { origin: 'https://localhost' }), { action: 'inapp', hash: '#runs' });
  assert.equal(go('https://127.0.0.1/', { origin: 'https://localhost' }).action, 'inapp');
  assert.notEqual(go('http://localhost/', { origin: 'https://localhost' }).action, 'inapp');
  assert.notEqual(go('https://127.0.0.1:80/', { origin: 'https://localhost' }).action, 'inapp');   // 80 is not https' 443
});

test('loopback goes to the panel through the preview; a login in it never does; a refused port opens outside with a notice', () => {
  assert.deepEqual(go('http://localhost:5173/a?b#c'), { action: 'panel', url: 'http://localhost:5173/a?b#c' });
  assert.deepEqual(go('http://[::1]:8080/'), { action: 'panel', url: 'http://localhost:8080/' });
  assert.deepEqual(go('http://u:p@localhost:5173/'), { action: 'native' });
  const range = (p) => p >= 3000 && p <= 3010;
  assert.deepEqual(go('http://localhost:5173/', { portAllowed: range }), { action: 'native', notice: 'port', port: 5173 });
  assert.deepEqual(go('http://localhost:3005/', { portAllowed: range }), { action: 'panel', url: 'http://localhost:3005/' });
});

test('linkHint: what a plain click does, for the accessible name', () => {
  const hint = (href, extra = {}) => linkHint({ ...base, href, ...extra });
  assert.equal(hint('https://docs.example.org/x'), 'panel');
  assert.equal(hint('http://localhost:5173/'), 'panel');
  assert.equal(hint('https://github.com/a/b'), 'tab');
  assert.equal(hint('https://docs.example.org/x', { refused: () => true }), 'tab');
  assert.equal(hint('http://localhost:5173/', { portAllowed: () => false }), 'tab');
  assert.equal(hint('http://localhost:4317/api/x'), 'tab');
  assert.equal(hint('http://localhost:4317/#runs'), null);
  assert.equal(hint('mailto:a@b.c'), null);
  assert.equal(hint('#history/p/abcd1234'), null);
  assert.equal(hint('https://docs.example.org/x', { enabled: false }), null);
  assert.equal(hint('https://docs.example.org/x', { meta: true }), 'panel');   // modifiers never change the name
});

test('refusing hosts and refused origins open externally; others go to the panel; off = native', () => {
  assert.deepEqual(go('https://github.com/a/b'), { action: 'native' });
  assert.deepEqual(go('https://accounts.example.com/x'), { action: 'native' });
  assert.deepEqual(go('https://docs.example.org/x', { refused: (o) => o === 'https://docs.example.org' }), { action: 'native' });
  assert.deepEqual(go('https://docs.example.org/x'), { action: 'panel', url: 'https://docs.example.org/x' });
  assert.deepEqual(go('https://docs.example.org/x', { enabled: false }), { action: 'native' });
  assert.deepEqual(go('http://localhost:5173/', { enabled: false }), { action: 'native' });
});

test('isKnownFrameRefuser: suffixes, sign-in labels, not look-alikes', () => {
  for (const h of ['github.com', 'gist.github.com', 'login.microsoftonline.com', 'accounts.google.com', 'sso.acme.io', 'GITHUB.COM.']) assert.equal(isKnownFrameRefuser(h), true, h);
  for (const h of ['notgithub.com', 'github.com.evil.example', 'example.org', '']) assert.equal(isKnownFrameRefuser(h), false, h);
});

test('sameAddress normalizes', () => {
  assert.equal(sameAddress('https://EXAMPLE.org', 'https://example.org/'), true);
  assert.equal(sameAddress('https://example.org/a', 'https://example.org/b'), false);
  assert.equal(sameAddress('nope', 'nope'), false);
});
