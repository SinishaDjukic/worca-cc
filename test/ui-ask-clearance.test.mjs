// test/ui-ask-clearance.test.mjs — bottom clearance for the fixed Ask Worca dock: a shared
// --ask-dock-clearance token plus one late grouped override lifts the bottom padding of every
// scroll gutter (.main, the running/history list screens, and the running/history detail
// bodies) so the last element on a fully-scrolled page sits clear of the pill (~73px strip:
// 26px dock padding-bottom + ~47px pill, style.css .ask-dock/.ask-pill). CSS string
// assertions only — jsdom computes no layout. ruleBody() copied from
// test/ui-ask-style.test.mjs:12-16, tokenValue() from test/ui-theme.test.mjs:8 (house
// convention: helpers duplicated per suite, no shared harness).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}
const tokenValue = (name) => {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim().toLowerCase() : null;
};

// The exact override rule the implementation must ship — asserted verbatim so the five
// gutters can never silently drift apart onto different clearance values.
const OVERRIDE =
  '.main,.run-screen-list,.hist-screen-list,.rd-body,.hd-body{padding-bottom:var(--ask-dock-clearance);}';

test('ask-clearance: --ask-dock-clearance token exists and clears the ~73px dock strip', () => {
  const v = tokenValue('ask-dock-clearance');
  assert.ok(v, 'missing --ask-dock-clearance in :root');
  assert.match(v, /^\d+px$/, `token must be a px length, got "${v}"`);
  const px = Number.parseInt(v, 10);
  assert.ok(px >= 88, `need >=88px (26px dock pad + ~47px pill + breathing room), got ${v}`);
});

test('ask-clearance: one shared override pads every scroll gutter via the token', () => {
  assert.ok(
    css.includes(OVERRIDE),
    'grouped padding-bottom override missing or reformatted (must list .main, .run-screen-list, .hist-screen-list, .rd-body, .hd-body and spend var(--ask-dock-clearance))',
  );
});

test('ask-clearance: override wins by source order and precedes the file-final reduced-motion block', () => {
  const at = css.indexOf(OVERRIDE);
  assert.ok(at !== -1, 'override rule missing');
  for (const base of [
    '.main{flex:1',
    '.hist-screen{position:absolute',
    '.hd-body{padding:0 32px 40px',
    '.run-screen{position:absolute',
    '.rd-body{padding:0 32px 40px',
  ]) {
    const b = css.indexOf(base);
    assert.ok(b !== -1, `base rule "${base}" not found — selector landscape changed, revisit the override`);
    assert.ok(b < at, `override must come after base rule "${base}" or its padding-bottom loses the cascade`);
  }
  const reduced = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduced !== -1 && at < reduced, 'override must stay before the file-final reduced-motion block');
});

test('ask-clearance: track containers and detail scrollports keep padding:0 (clearance lands on bodies, not the track)', () => {
  for (const sel of ['body.view-history .main', 'body.view-running .main', '.hist-screen-detail', '.run-screen-detail']) {
    const body = ruleBody(sel);
    assert.ok(body, `missing rule for ${sel}`);
    assert.match(body, /(?:^|;| )padding:0;/, `${sel} must keep padding:0 — the fixed track must not absorb the clearance`);
  }
  assert.equal(ruleBody('.hd-body'), 'padding:0 32px 40px;', '.hd-body base rule must stay untouched (override-only design)');
  assert.equal(ruleBody('.rd-body'), 'padding:0 32px 40px;', '.rd-body base rule must stay untouched (override-only design)');
});
