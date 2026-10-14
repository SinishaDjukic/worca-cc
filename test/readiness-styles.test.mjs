// test/readiness-styles.test.mjs — the project-list readiness chip (.pl-rd), its flyout and the settings card in
// ui/public/style.css: base chip, dot, tone variants on the design tokens (no raw hex), hover, flyout, settings card.
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

  it('.rd-dot is a small circle', () => {
    const body = ruleBody('.pl-rd .rd-dot');
    assert.ok(body, '.pl-rd .rd-dot rule missing');
    assert.match(body, /width:\d+px/);
    assert.match(body, /border-radius:50%/);
  });

  it('ready uses green tokens, partial amber, not-ready red', () => {
    assert.match(ruleBody('.pl-rd.rd-ready') ?? '', /var\(--green-bg\)/);
    assert.match(ruleBody('.pl-rd.rd-ready') ?? '', /var\(--green-ink\)/);
    assert.match(ruleBody('.pl-rd.rd-ready .rd-dot') ?? '', /var\(--green\)/);
    assert.match(ruleBody('.pl-rd.rd-partial') ?? '', /var\(--amber-bg\)/);
    assert.match(ruleBody('.pl-rd.rd-partial') ?? '', /var\(--amber-ink-strong\)/);
    assert.match(ruleBody('.pl-rd.rd-partial .rd-dot') ?? '', /var\(--amber\)/);
    assert.match(ruleBody('.pl-rd.rd-not-ready') ?? '', /var\(--red-bg\)/);
    assert.match(ruleBody('.pl-rd.rd-not-ready') ?? '', /var\(--red-ink\)/);
    assert.match(ruleBody('.pl-rd.rd-not-ready .rd-dot') ?? '', /var\(--red\)/);
  });

  it('has a hover state', () => {
    assert.ok(ruleBody('.pl-rd:hover'), '.pl-rd:hover rule missing');
  });

  it('styles the flyout header, check items and engine rows', () => {
    for (const sel of ['.readiness-header', '.readiness-check-item', '.readiness-check-item code', '.readiness-check-item a', '.readiness-engine-row']) {
      assert.ok(ruleBody(sel), `${sel} rule missing`);
    }
  });

  it('styles the settings card', () => {
    assert.ok(ruleBody('.readiness-settings-card'), '.readiness-settings-card rule missing');
  });

  it('reuses the existing qtune switch pattern', () => {
    assert.ok(bare.includes('.qtune-sw'));
  });

  it('the readiness rules use tokens only (no raw colours)', () => {
    const start = bare.indexOf('.pl-rd{');
    assert.ok(start > -1);
    const section = bare.slice(start);
    assert.doesNotMatch(section, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(section, /rgba?\(/);
  });
});
