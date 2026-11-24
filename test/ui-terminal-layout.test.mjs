// test/ui-terminal-layout.test.mjs — the pane coexists with the page and the toasts; no colour literals (#573).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const css = readStyleCss();
const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');

test('opening the pane moves the toasts left of it, and the page content with them', () => {
  assert.ok(css.includes('body.term-open .app{margin-right:var(--term-w,460px);}'));
  assert.ok(css.includes('body.term-open .toasts{right:calc(var(--term-w,460px) + 20px);}'));
  assert.match(css, /\.term-pane\{position:fixed;top:0;right:0;bottom:0;width:var\(--term-w,460px\);z-index:39;/);
});

test('the icon strip lives in the run bars; the project title row keeps its terminal opener', () => {
  const html = readIndexHtml();
  assert.equal(html.match(/class="term-opener btn"/g)?.length, 1);
  assert.ok(html.indexOf('class="term-opener', html.indexOf('<h1 class="pd-title"></h1>')) - html.indexOf('<h1 class="pd-title"></h1>') < 400);
  assert.equal(html.match(/<span class="tool-icons" data-tool-icons role="group" aria-label="Tools"><\/span>/g)?.length, 2);
  for (const anchor of ['<span class="rd-btn-label">Stop</span>', '<span class="hd-btn-label">Stop</span>']) {
    const at = html.indexOf(anchor);
    assert.ok(at > 0 && html.indexOf('data-tool-icons', at) - at < 400, anchor);
  }
  assert.doesNotMatch(css + app, /term-handle/);
  assert.doesNotMatch(css, /margin-right:46px/);
  assert.ok(app.includes("if (e.target.closest?.('.term-opener')) toolPanel?.toggleKind('terminal');"));
});

test('narrow screens (below the 880px slide breakpoint): the panel is a full-width sheet and nothing shifts', () => {
  assert.match(css, /@media \(max-width:879px\)\{[^}]*body\.term-open \.app\{margin-right:0;\}/);
  assert.doesNotMatch(css, /@media \(max-width:760px\)\{ body\.term-open/);
});

test('app.js mounts the tool panel and routes term-* frames to the terminal tool', () => {
  assert.ok(app.includes("import { createToolPanel } from './tool-panel.mjs';"));
  assert.ok(app.includes("import { createTerminalTool } from './terminal-pane.mjs';"));
  assert.ok(app.includes("if (typeof msg.type === 'string' && msg.type.startsWith('term-')) {"));
  assert.ok(app.includes('if (toolPanel) toolPanel.onContextChange();'));
  assert.doesNotMatch(app, /terminalPane/);
});

test('Escape typed in the terminal is the shell\'s: the wizard, the three detail screens and the Catalogue\'s side panel ignore it (D16)', () => {
  assert.equal(app.match(/if \(e\.target\?\.closest\?\.\('\.term-pane'\)\) return;/g)?.length, 5);
});

test('the Commands list is gone: no rules for it, or for its toggle, remain', () => {
  assert.doesNotMatch(css, /\.term-(blocks?|cmds?|badge|out)\b/);
  assert.doesNotMatch(app, /[?&]terminal=|ensureBlock/);
});

test('the xterm host has no padding or border: the frame lives on .term-screen, outside what FitAddon measures', () => {
  assert.ok(css.includes('.term-host{flex:1;min-height:0;min-width:0;padding:0;border:0;}'));
  assert.match(css, /\.term-screen\{[^}]*display:flex;flex-direction:column;\}/);
});

test('every one of xterm\'s 16 ANSI colours has a token, and the dark tones of the base eight differ per theme', () => {
  for (const c of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
    assert.match(css, new RegExp(`--term-ansi-${c}:`), c);
    assert.match(css, new RegExp(`--term-ansi-bright-${c}:`), `bright ${c}`);
  }
  assert.ok(css.includes('--term-ansi-red:light-dark(var(--red-ink),var(--red));'));
  assert.doesNotMatch(css.slice(css.indexOf('.term-pane{'), css.indexOf('.term-pane[hidden]')), /#[0-9a-f]{3,8}\b/i, 'tokens only');
});

test('app.js: sendWs reports a dropped socket and the terminal hears about it', () => {
  assert.ok(app.includes('if (!ws || !state.wsReady) return false;'));
  assert.ok(app.includes('if (terminalTool) terminalTool.onConnection(false);'));
});

test('the pane\'s own tab strip is gone; the tool strip hides nothing it needs', () => {
  assert.doesNotMatch(css, /\.term-wt\b/);
  assert.doesNotMatch(css, /\.term-sessions\b/);
  assert.doesNotMatch(css, /\.term-tabs?\b|\.term-tab-|\.term-head\b|\.term-title\b/);
  assert.ok(css.includes('.tool-tabs{'));
});

test('the context is one line that fits a phone: the folder ellipsizes, an empty context takes no room', () => {
  assert.match(css, /\.term-folder\{[^}]*min-width:0;[^}]*text-overflow:ellipsis;white-space:nowrap;\}/);
  assert.ok(css.includes('.term-context:empty{display:none;}'));
  assert.doesNotMatch(css.slice(css.indexOf('.term-pane{'), css.indexOf('@media (max-width:879px){ body.term-open')), /#[0-9a-f]{3,8}\b/i, 'tokens only');
});

test('archiving closes tool tabs: the run archive, the bulk action and the chat panel hand their ids to closeScope', () => {
  assert.ok(app.includes("toolPanel?.closeScope({ type: 'run', id: r.id });"));
  assert.ok(app.includes("for (const id of gone) toolPanel?.closeScope({ type: 'run', id });"));
  assert.ok(app.includes("onChatsClosed: (ids) => { for (const id of ids || [null]) toolPanel?.closeScope({ type: 'chat', id }); },"));
});

test('every .tov class the Overview builds has a rule; the chevron has its reduced-motion block; tokens only', () => {
  const pane = readFileSync(new URL('../ui/public/terminal/terminal-pane.css', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../ui/public/tool-overview.mjs', import.meta.url), 'utf8');
  const classes = new Set(['tov', ...[...src.matchAll(/\btov-[a-z]+(?:-[a-z]+)*/g)].map((m) => m[0])]);
  classes.delete('tov-section');   // the data-tov-section attribute, not a class
  assert.ok(classes.size >= 18, [...classes].join(' '));
  for (const c of classes) assert.match(pane, new RegExp(`\\.${c}(?![a-z-])[^{]*\\{`), `.${c} has a rule`);
  assert.ok(css.includes('.tov{'), 'the part is in the shipped stylesheet');
  assert.match(pane, /@media \(prefers-reduced-motion: reduce\)\{ \.tov-chev\{transition:none\} \}/);
  const rules = [...pane.matchAll(/([^{}]*\.tov[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 20);
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|(?<![\w-])(white|black)(?![\w-])|rgba?\(|hsla?\(/, `${sel.trim()}: tokens only`);
  }
});
