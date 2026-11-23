import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const css = readStyleCss();
const part = readFileSync('ui/public/chat/composer-bar.css', 'utf8');
const BAR = '.ask-composer-row[data-bar="compact"]';

test('the part is listed after design.css; card-nesting.css stays last; its banner maps to the chat feature', () => {
  const list = JSON.parse(readFileSync('ui/public/parts.json', 'utf8')).css;
  assert.equal(list.indexOf('chat/composer-bar.css'), list.indexOf('design/design.css') + 1);
  assert.equal(list.at(-1), 'chat/card-nesting.css');
  assert.ok(css.includes('/* ===== Chat: composer bar, compact ===== */'));
});

test('every rule is keyed on the row mark or is one of the three named class rules; tokens only; no left edge', () => {
  const body = part.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of body.split('}').map((r) => r.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'))) {
    assert.ok(sel.includes(BAR) || /^\.ask-(bar-n|scope-dot)(\[hidden\])?$/.test(sel), sel);
  }
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|!important/i);
  assert.doesNotMatch(body, /border-left/);
});

test('the tooltip: no box at rest (R10); drawn from data-tip above the button on hover and keyboard focus after .3s; never while a menu of the row is open', () => {
  assert.ok(part.includes(`${BAR} [data-tip]{position:relative;}`), 'every tip and the dot are placed from their button');
  assert.ok(part.includes(`${BAR} [data-tip]::after{content:attr(data-tip);display:none;position:absolute;`));
  // A long tip (a 42-character project) never widens a narrow page: the Chat home scrolls on x too.
  assert.match(part, new RegExp(`${BAR.replace(/[.[\]"]/g, '\\$&')} \\[data-tip\\]::after\\{[^}]*max-width:min\\(320px, calc\\(100vw - 32px\\)\\);overflow:hidden;text-overflow:ellipsis;`));
  assert.ok(part.includes(`${BAR} [data-tip]:is(:hover,:focus-visible)::after{display:block;animation:ask-bar-tip .12s .3s both;}`));
  assert.ok(part.includes('@keyframes ask-bar-tip{from{opacity:0;}}'));
  assert.doesNotMatch(part.replace(/\/\*[\s\S]*?\*\//g, ''), /\[data-tip\][^{]*::after\{[^}]*opacity/, 'a resting tip is display:none, never a laid-out box at opacity 0');
  assert.ok(part.includes(`${BAR}:has([aria-expanded="true"]) [data-tip]::after{display:none;}`));
  assert.ok(part.includes(`.ask-composer:has(> .ask-pop) ${BAR} [data-tip]::after{display:none;}`));
});

test('left group: btn-sm height (28px, R1), icon squares; hidden buttons stay hidden; the dot shows only on a picked project without its name', () => {
  assert.ok(part.includes(`${BAR} > :is(.ask-scope-btn,.ask-pull-btn){min-width:28px;padding:0 8px;gap:6px;}`));
  assert.ok(part.includes(`${BAR} > :is(.ask-scope-btn,.ask-pull-btn).is-bare{width:28px;padding:0;}`));
  assert.ok(part.includes(`${BAR} > [data-ask-scope-btn].is-compact{width:28px;padding:0;}`));
  assert.ok(part.includes(`${BAR} > [data-ask-scope-btn].is-bare > .ask-scope-label{display:none;}`), 'no project: the dashed folder alone');
  // Sets keeps .ask-scope-btn, which chat-shell.css makes shrinkable; squeezed, its count would vanish before any fit
  // tier is raised (the row only overflows once every shrinkable item is at its minimum).
  assert.ok(part.includes(`${BAR} > .ask-sets-btn{flex:none;}`), 'the Sets count never shrinks away');
  assert.ok(part.includes('.ask-scope-dot{display:none;position:absolute;'), 'the dot is hidden at rest');
  assert.ok(part.includes(`.chat-page[data-host="dock"] ${BAR} > [data-ask-scope-btn]{width:28px;padding:0;}`), 'L9: the side chat shows the project as its icon');
  assert.ok(part.includes(`.chat-page[data-host="dock"] ${BAR} > [data-ask-scope-btn] > .ask-scope-label{display:none;}`));
  assert.ok(part.includes(`${BAR} > .ask-scope-btn.is-pinned.is-compact > .ask-scope-dot{display:block;}`));
  assert.ok(part.includes(`.chat-page[data-host="dock"] ${BAR} > [data-ask-scope-btn].is-pinned > .ask-scope-dot{display:block;}`));
  for (const m of part.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (/\.ask-(pull|sets|mcp)-btn/.test(m[1])) assert.doesNotMatch(m[2], /display:|height:/, m[1]);
  }
});

test('the cost never shows in the compact row; the ring shows in the side chat only; the mark is the shared .sm mark at 16px, no tile (R2)', () => {
  assert.ok(part.includes(`${BAR} .ask-meter-cost{display:none;}`));
  assert.ok(part.includes(`.chat-page[data-host="page"] ${BAR} > .ask-meter{display:none;}`));
  assert.ok(part.includes(`.chat-page[data-host="dock"] ${BAR} > .ask-meter{display:flex;}`));
  assert.ok(part.includes(`${BAR} > .ask-model-btn > .mdl-mark.sm{width:16px;height:16px;}`));
  assert.doesNotMatch(part, /mdl-mark[^{]*\{[^}]*(background|border)/, 'no tile: the model menu\'s .sm marks have none either');
});

test('voice: the mic and its arrow are one joined control (no border-left text, R4)', () => {
  assert.ok(part.includes(`${BAR} > .ask-voice{gap:0;margin-left:6px;}`));
  assert.ok(part.includes(`${BAR} > .ask-voice > .ask-voice-mic{border-radius:var(--r-sm) 0 0 var(--r-sm);}`));
  assert.ok(part.includes(`${BAR} > .ask-voice > .ask-voice-caret{width:20px;border-color:var(--line-2);border-width:1px 1px 1px 0;border-radius:0 var(--r-sm) var(--r-sm) 0;background:var(--panel);color:var(--ink-2);}`));
  assert.ok(part.includes(`${BAR} > .ask-voice > .ask-voice-mic.is-on + .ask-voice-caret{border-color:var(--ink);}`));
  assert.ok(part.includes(`${BAR} > .ask-voice > .ask-voice-caret:hover:not(:disabled){background-color:var(--btn-hover);color:var(--ink);}`));
});

test('fit tiers: today\'s width-only hiding is undone for the compact row\'s own controls, never for a hidden one; the gear popup is out of reach', () => {
  const P = `.chat-page ${BAR}`;
  assert.ok(part.includes(`${P} > .ask-voice > .ask-voice-caret:not([hidden]){display:inline-flex;}`));
  assert.ok(part.includes(`${P} > .ask-model-btn > .ask-model-btn-effort:not([hidden]){display:inline;}`));
  assert.ok(part.includes(`${P} > .ask-model-btn > .ask-model-btn-engine:not([hidden]){display:inline;}`));
  assert.ok(part.includes(`${P}[data-fit] > .ask-voice > .ask-voice-caret{display:none;}`));
  assert.ok(part.includes(`${P}[data-fit] > .ask-voice > .ask-voice-mic{border-radius:var(--r-sm);}`), 'tier 1: the mic alone is a whole button');
  assert.ok(part.includes(`${P}[data-fit] > :is(.ask-voice,.ask-send,.ask-stop){margin-left:2px;}`));
  assert.ok(part.includes(`${P}:is([data-fit="4"],[data-fit="5"],[data-fit="6"]) > .ask-model-btn > :is(.mdl-mark,.ask-model-btn-engine){display:none;}`));
  assert.ok(part.includes(`${P}:is([data-fit="5"],[data-fit="6"]) > .ask-model-btn{flex:0 1 auto;min-width:0;}`));
  assert.ok(part.includes(`${P}:is([data-fit="2"],[data-fit="3"],[data-fit="4"],[data-fit="5"],[data-fit="6"]) > .ask-model-btn > .ask-model-btn-effort{display:none;}`));
  assert.ok(part.includes(`${P}:is([data-fit="3"],[data-fit="4"],[data-fit="5"],[data-fit="6"]) > .ask-meter{display:none;}`));
  assert.ok(part.includes(`${P}:is([data-fit="5"],[data-fit="6"]) > .ask-model-btn > .ask-model-btn-label{min-width:0;overflow:hidden;text-overflow:ellipsis;}`));
  // Tier 6, the last rule: Sets (flex:none above) may shrink only once the model name has given all it can, so the
  // row's floor is no wider than before the count was kept whole (impl review 2, M1).
  const sets = `${P}[data-fit="6"] > .ask-sets-btn{flex:0 1 auto;}`;
  assert.ok(part.trimEnd().endsWith(sets), 'the Sets count is the last part to go');
  assert.equal(part.match(/\[data-fit="6"\]\) > |\[data-fit="6"\] > /g).length, 6, 'tier 6 keeps every tier-2..5 rule and adds only Sets');
  assert.ok(part.includes(`${BAR}[data-measure] [data-tip]::after{display:none;}`));
  assert.doesNotMatch(part.replace(/\/\*[\s\S]*?\*\//g, ''), /[^>+]\s(?::is\()?\.ask-(model-btn|voice)-[a-z]+/, 'R5: model and voice parts only through >');
  assert.ok(part.lastIndexOf('[data-fit') > part.lastIndexOf('[data-host="dock"]'), 'the tier block is last: it must win over the side chat\'s ring rule');
});

test('the lent gear\'s Lead and Builders pickers keep their words and efforts in a narrow conversation (R5, Task 7 browser proof)', () => {
  // chat-run-panel.css's @container chat-convo (max-width:520px) and chat-shell.css's phone rules hide every
  // .chat-page .ask-model-btn-engine/-effort, which reaches the gear's popup (composer-settings.mjs) inside the row.
  const rule = `${BAR} .dz-set-pop .dz-model-btn > :is(.ask-model-btn-engine,.ask-model-btn-effort):not([hidden]){display:inline;}`;
  assert.ok(part.includes(rule));
  assert.ok(part.indexOf(rule) < part.indexOf('/* Fit (ask-panel.mjs fitBar)'), 'not a fit-tier rule: it sits above the Fit block');
});
