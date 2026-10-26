// test/ui-chat-style.test.mjs — worca Chat P1 CSS (ui/public/style.css): the floating Ask mode left no rule behind, the
// P1 section sits at the end of the file, the page fills the content column, the conversation column carries the cap
// tokens, composer popovers anchor to the composer, the reduced-motion blanket covers the page, tokens only.
// ruleBody() is the house helper (first rule written exactly as `selector{…}`; no comments inside rule bodies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const P1 = '/* ===== Chat P1: shell ===== */';

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

test('the floating Ask mode left no rule behind: no dock, pill, tooltip, sheet, header or resize grip; no launcher keyframes', () => {
  assert.doesNotMatch(bare, /\.ask-(?:dock|pill|tip|sheet|header|resize)\b/);
  assert.doesNotMatch(bare, /@keyframes (?:ask-pill-pop|ask-ring|ask-dot-in)\b/);
});

test('the Chat P1 section is appended once, after the Workflows view block that ended the file at c45cc012', () => {
  const at = css.indexOf(P1);
  assert.ok(at > 0, 'the banner exists');
  assert.equal(css.indexOf(P1, at + 1), -1, 'once');
  assert.ok(at > css.indexOf('.wfc-uthumb-link:focus-visible{'), 'at the end');
});

test('the page fills the content column: .main gives up its gutter and scroll, the section and the page are bounded', () => {
  assert.equal(ruleBody('body.view-chat .main'), 'display:flex;flex-direction:column;overflow:hidden;padding:0;');
  assert.equal(ruleBody('.view[data-view="chat"]'), 'flex:1 1 auto;min-height:0;position:relative;');
  assert.match(ruleBody('.chat-page'), /^position:absolute;inset:0;display:flex;/);
  assert.match(ruleBody('.chat-page'), /--chat-text-max:760px;--chat-card-max:1040px;/);
});

test('the conversation column carries the cap tokens (a 760px text column) for the transcript, the composer box and the jump pill', () => {
  const body = ruleBody('.chat-convo');
  assert.match(body, /position:relative;/);
  assert.match(body, /--ask-col-max:var\(--chat-text-max\);--ask-col-inset:max\(16px,calc\(50% - var\(--ask-col-max\) \/ 2\)\);--ask-box-top:103px;--chat-dock-fade:32px;/);
});

test('home vs thread: home hides the transcript and the dock (and New chat), a thread hides home', () => {
  assert.equal(ruleBody('.chat-page[data-view="thread"] .chat-home'), 'display:none;');
  assert.match(bare, /\.chat-page\[data-view="home"\] \.ask-transcript,\.chat-page\[data-view="home"\] \.chat-dock\{display:none;\}/);
  assert.equal(ruleBody('.chat-page[data-view="home"] .chat-head [data-ask-new-btn]'), 'visibility:hidden;');
  // #731 halved the old 16vh/160px top gap and the redesign halved it again (4vh/40px); that sat the heading too tight
  // under the top bar, so it is back to 10vh, capped at 96px.
  assert.match(ruleBody('.chat-home'), /;padding:clamp\(32px,10vh,96px\) 16px 32px;$/);
});

test('composer popovers ride the composer: upward in the dock, downward on home, never 70% of the composer\'s height', () => {
  assert.equal(ruleBody('.chat-page .ask-composer'), '--ask-box-top:calc(100% - 10px);');
  assert.equal(ruleBody('.chat-page .ask-composer > .ask-pop'), 'max-height:min(420px,calc(100vh - 240px));');
  // The home popover opens downward: its room is the window minus the .chat-home top padding (10vh) and the chrome above.
  assert.equal(ruleBody('.chat-page[data-view="home"] .ask-composer > .ask-pop'), 'bottom:auto;top:calc(100% + 6px);max-height:min(420px,calc(90vh - 230px));');
  assert.equal(ruleBody('.chat-hero-slot .ask-composer'), 'padding:0;--ask-col-inset:0px;', 'home popovers are flush with the box, like the dock\'s');
});

test('the docked composer keeps its room: the jump pill rides the dock, toasts clear it, the head buttons never shrink, phones keep Send in the box', () => {
  assert.match(css, /\n\.chat-dock\{position:absolute;left:0;right:0;bottom:0;pointer-events:none;\}/, 'the base rule (ruleBody would find the home rule\'s " .chat-dock{" first): it floats over the transcript, no z-index');
  assert.equal(ruleBody('.chat-dock > .ask-jump'), 'bottom:100%;');
  assert.equal(ruleBody('body.view-chat .toasts'), 'bottom:calc(136px + env(safe-area-inset-bottom,0px));');
  assert.equal(ruleBody('.chat-head-btn'), 'flex:none;');
  assert.match(css, /@media \(max-width:480px\)\{\n {2}\.chat-page \.ask-meter-cost,\.chat-page \.ask-voice-caret,\.chat-page \.ask-model-btn-effort\{display:none;\}\n\}/);
  assert.equal(ruleBody('.chat-page .ask-composer-row > .ask-scope-btn'), 'flex:0 1 auto;min-width:0;', 'a pinned scope gives way before Send does');
  assert.equal(ruleBody('.chat-page .ask-model-btn'), 'white-space:nowrap;');
  assert.equal(ruleBody('.chat-page .ask-scope-btn > svg'), 'flex:none;', 'the scope caret never squashes to nothing');
  assert.match(css, /@media \(max-width:360px\)\{\n {2}\.chat-page \.ask-composer-row\{gap:4px;\}\n {2}\.chat-page \.ask-composer-row > \.ask-meter\{display:none;\}\n\}/, '320px: the row fits');
});

test('reduced motion: the Chat page blanket replaced the dock blanket, right before the run-shell one', () => {
  assert.match(css, /\n {2}\.chat-page \*\{animation:none !important;\}\n {2}\.run-shell \*\{animation:none !important;\}/);
});

test('the P1 section uses tokens only: no colour literal, no coloured left-edge accent line', () => {
  const start = css.indexOf(P1);
  const next = css.indexOf('/* ===== Chat P', start + P1.length);   // later plans append their own sections
  const sec = css.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(sec, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  for (const m of sec.matchAll(/border-left:([^;}]*)/g)) assert.equal(m[1], '1px solid var(--line)', `border-left:${m[1]}`);
});

test('the Chat row dot rides the rail corner; the logo links show a focus ring', () => {
  assert.equal(ruleBody('.nav-count.nav-dot'), 'width:8px;height:8px;padding:0;border-radius:50%;background:var(--slate);');
  assert.match(ruleBody('.brand a.logo-mark:focus-visible'), /outline:2px solid var\(--ink\)/);
});

test('the composer buttons keep their size, the run panel slot hides, cards measure the transcript, the empty lead row takes no room, the rail dot', () => {
  assert.equal(ruleBody('.chat-page .ask-composer-row > :is(.btn,.ask-meter,.ask-model-btn,.ask-voice):not(.ask-scope-btn)'), 'flex:none;', 'Send never shrinks out of the box (v2); the scope button is a .btn too and must stay shrinkable');
  assert.equal(ruleBody('.chat-panel[hidden]'), 'display:none;', '.chat-panel{display:flex} would beat [hidden]: an empty bordered slot');
  assert.equal(ruleBody('.chat-convo .ask-transcript'), 'container-type:inline-size;isolation:isolate;scrollbar-gutter:stable both-edges;padding-bottom:calc(var(--chat-dock-h,120px) + var(--chat-dock-fade));', '100cqi = the transcript width; the floating dock\'s height plus its fade band is its bottom clearance');
  assert.equal(ruleBody('.chat-convo .ask-msg > :is(.ask-card,.ask-card-stub)'), null, 'no card width rule (#959)');
  assert.equal(ruleBody('.chat-composer-lead:empty'), 'display:none;');
  assert.equal(ruleBody('.sidebar.collapsed .nav-count.nav-dot'), 'top:6px;right:8px;');
});

test('the mockup look (2026-10-10, corners and shadows per the runs redesign): the composer is frosted glass over the dock\'s panel (#959), the run card a white bordered card with no resting shadow, History toggles like the menu', () => {
  // Review C (decided 2026-10-19): the composer shell is the one 12px (--r-lg) corner; the run card a card (--r-card, 8px).
  assert.equal(ruleBody('.chat-page .ask-composer-box'), 'border-color:var(--glass-line);border-radius:var(--r-lg);background:var(--glass);-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);');
  assert.equal(ruleBody('.chat-hero-slot .ask-composer-box'), 'border-radius:var(--r-lg);');
  assert.equal(ruleBody('.chat-page .ask-composer-box:has(.guide-target)'), '-webkit-backdrop-filter:none;backdrop-filter:none;', 'a Getting started ring escapes the blur\'s stacking context');
  assert.equal(ruleBody('.chat-dock > .ask-composer'), 'pointer-events:none;');
  assert.equal(ruleBody('.chat-dock > .ask-jump,.chat-dock > .ask-composer > *'), 'pointer-events:auto;', 'only the composer\'s own parts take the pointer');
  assert.match(ruleBody('.chat-dock::before'), /^content:"";position:absolute;left:0;right:0;bottom:0;top:calc\(-1 \* var\(--chat-dock-fade\)\);/);
  assert.equal(ruleBody('.chat-convo .ask-msg .ask-card'), 'animation:none;', 'the row rises, never the card in it (#959)');
  assert.equal(ruleBody('.ask-card.chat-rc'), 'gap:0;border-radius:var(--r-card);');
  assert.doesNotMatch(css, /--shadow-card\b/, 'the resting card shadow token is gone');
  assert.doesNotMatch(css, /--shadow-glass\b/, 'and so is the composer\'s');
  assert.equal(ruleBody('.chat-head-btn.chat-history-toggle'), 'width:32px;height:32px;border-radius:var(--r-sm);', 'the menu toggle\'s square (.side-toggle)');
  assert.equal(ruleBody('.chat-history-toggle[aria-pressed="true"]'), 'background:var(--field);color:var(--ink);', 'open: the wash marks the state');
  assert.doesNotMatch(bare, /chat-history-toggle-(line|fill)/, 'the panel glyph\'s open/closed parts are gone');
});

test('History: the Chats column\'s host, a push column that turns into an overlay with a scrim below 1100px; the old rows\' rules are gone', () => {
  assert.match(css, /\n\.chat-history\{flex:0 0 264px;width:264px;/, 'the base rule (ruleBody would find the earlier closed-state rule first)');
  assert.equal(ruleBody('.chat-page[data-history="closed"] .chat-history'), 'display:none;');
  assert.match(css, /@media \(max-width:1099px\)\{\n {2}\.chat-history\{position:absolute;top:0;bottom:0;left:0;z-index:6;width:min\(300px,86vw\);/);
  assert.match(css, /\.chat-scrim:not\(\[hidden\]\)\{display:block;position:absolute;inset:0;z-index:5;background:var\(--scrim-soft\);\}/);
  assert.doesNotMatch(bare, /\.ask-pop-threads\b/);
  // #952: the old History rows, search and labelled New chat went with the chatsColumn flag.
  assert.doesNotMatch(bare, /\.(ask-threads-list|ask-thread-(row|pick|dot|col|title|meter|when|fill|topics|match)|chat-history-(head|title|meter|sbox|search|new|body|group|empty)|chat-new-btn)\b/);
  assert.match(ruleBody('.ask-wt-row .ask-thread-trash'), /^flex:none;$/, 'the worktree rows keep their trash');
});

test('the run proposal card takes the text column like every chat card (no width of its own, #959) and its kicker is not monospace (F-27)', () => {
  assert.match(ruleBody('.chat-page'), /--chat-text-max:760px;/);
  assert.equal(ruleBody('.chat-convo .ask-msg > .ask-card.ask-rp'), null);
  for (const sel of ['.ask-rp-kicker', '.ask-rp-from', '.ask-rp-summary']) assert.doesNotMatch(ruleBody(sel), /var\(--mono\)/, sel);
});

test('command cards take the text column like every chat card (#911, #959)', () => {
  assert.equal(ruleBody('.chat-convo .ask-msg > .ask-card.ask-cmd'), null);
});

test('summary rows: one line, a group is one card under a quiet head, the raw command in mono (#911)', () => {
  assert.match(ruleBody('.ask-cmd-sum'), /white-space:nowrap;/);
  assert.match(ruleBody('.ask-cmd-sum.is-raw'), /font-family:var\(--mono\)/);
  assert.match(ruleBody('.ask-cmd-row:hover'), /background:var\(--hover\)/);
  assert.match(ruleBody('.ask-cmd-ghead'), /color:var\(--ink-2\)/);
  assert.match(ruleBody('.ask-cmd-ghead:hover'), /background:var\(--hover\)/);
  assert.match(ruleBody('.ask-cmd-gfail'), /color:var\(--red-ink\)/);
  assert.match(ruleBody('.ask-cmd-gbody > .ask-card.ask-cmd.is-sum + .ask-card.ask-cmd.is-sum'), /border-top:1px solid var\(--line\)/);
  assert.doesNotMatch(bare, /\.ask-cmd\.in-group/, 'no more stacked cards');
  assert.match(ruleBody('.ask-cmd-outbox .ask-cmd-out'), /max-height:min\(400px,50vh\);/);
  assert.match(ruleBody('.ask-cmd-code'), /font-size:12px;line-height:1\.6;/);
  assert.equal(ruleBody('.chat-convo .ask-msg > .ask-cmd-group'), null, 'a group fills the text column like every card (#959)');
});
