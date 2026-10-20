// test/ui-chat-scope-style.test.mjs — Projects, any way P4b: the Chat scope CSS block (tokens only; no amber, no edge
// line, no chip rules: the kind chip is P1b's, SEAMS S11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}
function block() {
  const a = css.indexOf('/* ===== Chat scope (Projects, any way) ===== */');
  const b = css.indexOf('/* ===== Chat P4: run panel ===== */');
  assert.ok(a > css.indexOf('/* ===== Chat P3: run card ===== */') && b > a, 'the block sits between Chat P3 and Chat P4 (outside the extension cut)');
  return css.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the Chat scope block: no amber anywhere, no left edge line, no second kind chip', () => {
  const b = block();
  assert.doesNotMatch(b, /amber/);
  assert.doesNotMatch(b, /border-left/);
  assert.doesNotMatch(b, /(?:^|[},])\s*\.kind-chip\s*[{.,:]|\.kind-(git|folder|none|ws)\s*\{|ink-strong:/, 'the chip CSS is P1b\'s (S11): placing a chip in a row (`… > .kind-chip`) is fine, restyling it is not');
});

test('the scope menu: two-line project rows, the chip on the right, the path in mono at --ink-2', () => {
  assert.equal(ruleBody('.ask-scope-item > svg'), 'flex:none;color:var(--ink-2);');
  assert.equal(ruleBody('.ask-scope-proj'), 'align-items:flex-start;');
  assert.equal(ruleBody('.ask-scope-proj > svg'), 'margin-top:2px;');
  assert.equal(ruleBody('.ask-scope-col'), 'display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0;');
  assert.equal(ruleBody('.ask-scope-line'), 'display:flex;align-items:center;gap:8px;min-width:0;');
  assert.equal(ruleBody('.ask-scope-line > .ask-model-name'), 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
  assert.equal(ruleBody('.ask-scope-line > .kind-chip'), 'margin-left:auto;');
  assert.equal(ruleBody('.ask-scope-sub'), 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:11px;color:var(--ink-2);');
});

test('the divider: a centered label between two hairlines, no accent', () => {
  assert.equal(ruleBody('.ask-divider'), 'display:flex;align-items:center;gap:12px;margin:6px 0;font-size:12px;color:var(--ink-2);');
  assert.equal(ruleBody('.ask-divider::before,.ask-divider::after'), 'content:"";flex:1 1 0;min-width:16px;height:1px;background:var(--line-2);');
  assert.equal(ruleBody('.ask-divider-in'), 'display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:calc(100% - 56px);font-weight:500;');
  assert.equal(ruleBody('.ask-divider-in > svg'), 'flex:none;');
  assert.equal(ruleBody('.ask-divider-t'), 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
});

test('the chat question: run-page grammar, grey lines like the Runs page, the canvas 18px heading, two columns when wide', () => {
  assert.equal(ruleBody('.chat-q'), 'container:chat-q / inline-size;');
  assert.equal(ruleBody('.chat-q .chat-rc-q-head'), 'margin-bottom:14px;font-size:18px;');
  assert.equal(ruleBody('.chat-q.chat-rc-q :is(.qpanel,.qblock),.chat-q.chat-rc-q .qpanel[data-kind="clarify"] .qpanel-foot'), 'border-color:var(--line);');
  assert.equal(ruleBody('.chat-q .qwhy'), 'font-size:13px;font-weight:400;color:var(--ink-2);');
  assert.equal(ruleBody('.chat-q .qopt-txt'), 'display:flex;flex-direction:column;gap:2px;min-width:0;');
  assert.equal(ruleBody('.chat-q-opt-name'), 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;');
  assert.equal(ruleBody('.chat-q-opt-sub'), 'font-family:var(--mono);font-size:12px;font-weight:400;color:var(--ink-2);overflow-wrap:anywhere;');
  assert.equal(ruleBody('.chat-q .qpanel-foot .btn-primary:disabled'), 'opacity:.45;cursor:default;transform:none;');
  assert.equal(ruleBody('.chat-q.is-answered .qopt'), 'cursor:default;', 'an answered card\'s tiles are not buttons to press');
  assert.match(css, /@container chat-q \(min-width:640px\)\{\n {2}\.chat-q \.qblock\{grid-template-columns:minmax\(0,300px\) minmax\(0,1fr\);grid-template-rows:auto 1fr;column-gap:48px;padding:28px 32px;\}\n {2}\.chat-q \.qtext\{grid-row:1 \/ span 2;\}\n {2}\.chat-q\.chat-rc-q \.qopts\{grid-column:2;\}\n\}/);
});

test('the amber scope warning is gone with scopeMismatch (U16)', () => {
  assert.equal(ruleBody('.ask-card-scope-warn'), null);
  assert.equal(ruleBody('.ask-rp .ask-card-scope-warn'), null);
});

test('the Workflows menu keeps the kind chip on the right (B8)', () => {
  assert.equal(ruleBody('.wfv-menu-item > .kind-chip'), 'margin-left:auto;');
});

test('B10: the chip sits between the name and the branch words', () => {
  assert.equal(ruleBody('.ask-rp-sec-sub > .kind-chip'), 'margin:0 6px;');
});
