// test/readiness-styles.test.mjs — the project-list readiness chip (.pl-rd), its flyout and the settings card in
// ui/public/style.css: base chip, count disc, tone variants on the design tokens (no raw hex), popover, settings card.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = bare.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

describe('readiness CSS', () => {
  it('defines the chip and its three tone classes', () => {
    for (const sel of ['.pl-rd', '.rd-ready', '.rd-partial', '.rd-not-ready']) {
      assert.ok(bare.includes(sel), `${sel} missing`);
    }
  });

  it('.pl-rd is an inline-flex pill', () => {
    const body = ruleBody('.pl-rd');
    assert.ok(body, '.pl-rd rule missing');
    assert.match(body, /display:inline-flex/);
    assert.match(body, /align-items:center/);
    assert.match(body, /border-radius:/);
    assert.match(body, /cursor:pointer/);
  });

  it('ready uses green tokens, partial amber, not-ready red, unused grey', () => {
    assert.match(ruleBody('.rd-ready') ?? '', /var\(--green-bg\)/);
    assert.match(ruleBody('.rd-ready') ?? '', /var\(--green-ink\)/);
    assert.match(ruleBody('.rd-partial') ?? '', /var\(--amber-bg\)/);
    assert.match(ruleBody('.rd-partial') ?? '', /var\(--amber-ink-strong\)/);
    assert.match(ruleBody('.rd-not-ready') ?? '', /var\(--red-bg\)/);
    assert.match(ruleBody('.rd-not-ready') ?? '', /var\(--red-ink\)/);
    assert.match(ruleBody('.rd-unused') ?? '', /var\(--field\)/);
  });

  it('labels have no border, ring or dot', () => {
    for (const sel of ['.pl-rd', '.pl-rd:hover', '.rd-lbl']) {
      const body = ruleBody(sel) || '';
      assert.doesNotMatch(body, /box-shadow|border:/, `${sel} has no ring or border`);
    }
    assert.ok(!bare.slice(bare.indexOf('.pl-rd{')).includes('.rd-dot'), 'no dot rule in the readiness block (the run page has its own .rd-dot)');
  });

  it('the count disc is regular weight and uses --panel', () => {
    const body = ruleBody('.pl-rd .rd-n');
    assert.match(body, /font-weight:500/);
    assert.match(body, /color:var\(--panel\)/);
  });

  it('the popover scrolls its body only, between a fixed head and foot', () => {
    assert.match(ruleBody('.readiness-pop') ?? '', /display:flex;flex-direction:column/);
    assert.match(ruleBody('.rp-body') ?? '', /overflow:auto/);
    assert.match(ruleBody('.rp-body') ?? '', /min-height:0/);
    assert.match(ruleBody('.rp-head') ?? '', /flex:none/);
    assert.match(ruleBody('.rp-foot') ?? '', /flex:none/);
  });

  it('styles the settings card', () => {
    assert.ok(ruleBody('.readiness-settings-card'), '.readiness-settings-card rule missing');
  });

  it('the readiness rules use tokens only (no raw colours)', () => {
    const start = bare.indexOf('.pl-rd{');
    assert.ok(start > -1);
    const section = bare.slice(start);
    assert.doesNotMatch(section, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(section, /rgba?\(/);
  });
});
