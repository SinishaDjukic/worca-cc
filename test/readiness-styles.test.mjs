// test/readiness-styles.test.mjs — the project-list readiness chip (.pl-rd), its flyout and the settings card in
// ui/public/style.css: base chip, count disc, tone variants on the design tokens (no raw hex), popover, settings card.
// The readiness rules live in the projects stylesheets; their blocks are read from those part files themselves.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const css = readStyleCss();
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const bare = strip(css);
const part = (path) => strip(readFileSync(new URL(`../ui/public/${path}`, import.meta.url), 'utf8'));
const listPart = part('projects/readiness.css');
const settingsPart = part('projects/project-settings.css');
// The readiness block of each part: from its first rule to the end of the file (both blocks close their part).
const readinessBlocks = [listPart.slice(listPart.indexOf('.pl-rd{')), settingsPart.slice(settingsPart.indexOf('.rs-head{'))];

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = bare.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

describe('readiness CSS', () => {
  it('the chips are the shared chip: no size, shape or font of their own', () => {
    const body = ruleBody('.pl-rd');
    assert.ok(body, '.pl-rd rule missing');
    assert.doesNotMatch(body, /height:|border-radius:|font:|padding:/, 'design-system.css\'s one chip rule sets these');
    assert.equal(ruleBody('.rd-lbl'), null, 'the level label has no rule of its own');
    assert.doesNotMatch(listPart, /\.rd-(ready|partial|not-ready|unused)\b/, 'the tones are .badge green / amber / red / grey');
    assert.doesNotMatch(body, /cursor:pointer/, 'the row chip is status only');
    assert.match(ruleBody('.pd-rd-slot .pl-rd') ?? '', /cursor:pointer/, 'the header chip opens the report');
  });

  it('the title line keeps the chip beside the name and wraps it under a long name', () => {
    const body = ruleBody('#projects-list .pl-title') ?? '';
    assert.match(body, /display:flex/);
    assert.match(body, /flex-wrap:wrap/);
    assert.match(body, /align-items:center/);
    assert.match(css, /:is\(\.badge,[^)]*\)\{[^}]*height:18px/, 'the shared 18px chip: smaller than the name line, so it does not grow the row');
  });

  it('going to the Settings card lands its head below the pinned project tabs (74px)', () => {
    const m = /scroll-margin-top:(\d+)px/.exec(ruleBody('.readiness-settings-card') ?? '');
    assert.ok(m && Number(m[1]) >= 84, 'scroll-margin-top clears the sticky .pd-tabs');
  });

  it('amber and red chips take the AA -ink-strong text shade; the count disc matches', () => {
    assert.match(ruleBody('.rd-lbl.amber') ?? '', /color:var\(--amber-ink-strong\)/);
    assert.match(ruleBody('.rd-lbl.red') ?? '', /color:var\(--red-ink-strong\)/, 'the AA red text shade on --red-bg');
    assert.match(listPart, /\.pl-rd\.amber,\.rd-lbl\.amber\{/, 'the row chip and the label share the rule');
    assert.match(listPart, /\.pl-rd\.red,\.rd-lbl\.red\{/);
    assert.match(ruleBody('.pl-rd.amber .rd-n') ?? '', /var\(--amber-ink-strong\)/);
    assert.match(ruleBody('.pl-rd.red .rd-n') ?? '', /var\(--red-ink-strong\)/);
  });

  it('a failing check\'s .issue-sev chip takes the AA text shade of its tone', () => {
    assert.match(ruleBody('.rp-chk.sev-critical .issue-sev') ?? '', /color:var\(--red-ink-strong\)/);
    assert.match(ruleBody('.rp-chk.sev-minor .issue-sev') ?? '', /color:var\(--amber-ink-strong\)/);
    assert.match(ruleBody('.rp-chk.sev-suggestion .issue-sev') ?? '', /color:var\(--blue-ink-strong\)/);
  });

  it('the boxes use the shared .disclosure: no hand-drawn chevron, tick or dot', () => {
    assert.doesNotMatch(listPart, /\.rp-(chev|tick|gdot|sevdot)\b/);
    assert.doesNotMatch(listPart, /-webkit-details-marker|list-style:none;[^}]*cursor:pointer/, '.disclosure hides the marker');
  });

  it('labels have no border, ring or dot', () => {
    for (const sel of ['.pl-rd', '.pl-rd:hover']) {
      const body = ruleBody(sel) || '';
      assert.doesNotMatch(body, /box-shadow|border:/, `${sel} has no ring or border`);
    }
    assert.ok(readinessBlocks.every((b) => !b.includes('.rd-dot')), 'no dot rule in the readiness block (the run page has its own .rd-dot)');
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

  it('the skip switches in the settings card stack one per line', () => {
    assert.match(ruleBody('.readiness-settings-card .qtune-sw') ?? '', /display:flex/);
  });

  it('the settings card head keeps its buttons together on the right', () => {
    assert.match(ruleBody('.rs-acts') ?? '', /display:flex/);
    assert.match(ruleBody('.rs-acts') ?? '', /margin-left:auto/);
  });

  it('styles the settings card', () => {
    assert.ok(ruleBody('.readiness-settings-card'), '.readiness-settings-card rule missing');
  });

  it('the readiness rules use tokens only (no raw colours)', () => {
    for (const section of readinessBlocks) {
      assert.ok(section.length > 0);
      assert.doesNotMatch(section, /#[0-9a-fA-F]{3,8}\b/);
      assert.doesNotMatch(section, /rgba?\(/);
    }
  });

  it('the readiness rules live in the projects stylesheets', () => {
    const chatHome = part('chat/chat-home.css');
    assert.doesNotMatch(chatHome, /\.pl-rd|\.rp-|\.rs-|\.readiness-/);
    assert.ok(listPart.includes('.pl-rd{') && listPart.includes('.readiness-pop{'));
    assert.ok(settingsPart.includes('.readiness-settings-card{'));
  });

  it('no --ink-3 on readiness text: only the marks use it', () => {
    for (const block of readinessBlocks) {
      for (const [, sel, body] of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!body.includes('--ink-3')) continue;
        assert.ok(['.rp-lead.is-none'].includes(sel.trim()), `${sel.trim()} uses --ink-3`);
      }
    }
  });

  it('no raw font sizes: the type tokens only', () => {
    for (const block of readinessBlocks) {
      assert.doesNotMatch(block, /font-size:\s*\d+px/);
      assert.doesNotMatch(block, /font:[^;}]*\b\d+px/);
    }
  });

  it('focus ring is the system\'s: --ink, never --blue', () => {
    assert.match(ruleBody('.pl-rd:focus-visible') ?? '', /outline:2px solid var\(--ink\)/);
    for (const block of readinessBlocks) assert.doesNotMatch(block, /:focus-visible\{[^}]*--blue/);
  });

  it('a disabled tool choice is dimmed like every disabled .seg button, with no colour of its own', () => {
    const body = ruleBody('.rs-row .seg button:disabled') ?? '';
    assert.match(body, /opacity:\.45/);
    assert.doesNotMatch(body, /color:/);
  });
});
