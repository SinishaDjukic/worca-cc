// test/ui-ask-style.test.mjs — raw style.css assertions for the Ask Worca
// section (spec §10.3). Same technique as test/ui-diff-style.test.mjs /
// ui-running-routing's ruleBody: anchored selector match, body capture stops at
// the first closing brace — hence the "no comments in rule bodies" house rule.
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

test('ui-ask-style: the dock is a fixed, click-through layer at z-40 with the rail arms', () => {
  const dock = ruleBody('.ask-dock');
  assert.ok(dock, '.ask-dock rule exists');
  assert.match(dock, /position:fixed/);
  assert.match(dock, /z-index:40/);
  assert.match(dock, /pointer-events:none/);
  assert.match(dock, /left:298px/);
  const collapsed = ruleBody('body.rail-collapsed .ask-dock');
  assert.ok(collapsed, 'collapsed-rail arm exists');
  assert.match(collapsed, /left:76px/);
  // the children restore pointer events
  assert.match(ruleBody('.ask-sheet') || '', /pointer-events:auto/);
  assert.match(ruleBody('.ask-pill') || '', /pointer-events:auto/);
});

test('ui-ask-style: below 1080px the dock spans the viewport EVEN with a collapsed rail', () => {
  // the media rule must carry the higher-specificity selector too, or
  // body.rail-collapsed .ask-dock{left:76px} wins below the breakpoint
  const media = css.slice(css.indexOf('@media (max-width:1080px)', css.indexOf('.ask-dock')));
  const block = media.slice(0, media.indexOf('}', media.indexOf('{', media.indexOf('{') + 1)) + 1);
  assert.match(block, /body\.rail-collapsed \.ask-dock/, 'media rule restates the rail-collapsed selector');
  assert.match(block, /left:0/);
});

test('ui-ask-style: the sheet uses wr-rise and the card radius token', () => {
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /animation:wr-rise/);
  assert.match(sheet, /var\(--r-card\)/);
  assert.match(sheet, /width:min\(782px/);
  assert.match(sheet, /height:min\(669px/);
});

test('ui-ask-style: hidden twins exist for the hideable ask elements', () => {
  for (const sel of ['.ask-sheet[hidden]', '.ask-pill[hidden]', '.ask-jump[hidden]', '.ask-composer-msg[hidden]', '.ask-chips[hidden]',
    '.ask-wt-btn[hidden]']) {   // shares display:flex from .ask-agents-btn, so without the twin it never hides (jsdom cannot catch it)
    const body = ruleBody(sel);
    assert.ok(body, `${sel} twin exists`);
    assert.match(body, /display:none/);
  }
});

test('ui-ask-style: the ask section spends tokens, not hex', () => {
  const start = css.indexOf('/* ---------- Ask Worca');
  assert.ok(start !== -1, 'the ask section comment exists');
  const end = css.indexOf('/* ---------- reduced motion for the Running redesign');
  assert.ok(end > start, 'the ask section sits before the final reduced-motion block');
  const section = css.slice(start, end);
  assert.equal((section.match(/#[0-9a-fA-F]{6}\b/g) || []).length, 0, 'no 6-digit hex literals in the ask section');
  assert.ok(!/#[0-9a-fA-F]{3}\b/.test(section.replace(/#fff\b/g, '')), 'no non-#fff 3-digit hex either');
});

test('ui-ask-style: the FINAL reduced-motion block neutralises the dock', () => {
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(css.slice(guard).includes('.ask-dock *{animation:none !important;}'), 'the last block carries the ask arm');
  // every ask animation reference precedes the guard
  const lastAskAnim = css.lastIndexOf('animation:wr-rise');
  assert.ok(lastAskAnim < guard, 'wr-rise uses sit before the final reduced-motion block');
});

test('ui-ask-style: the hljs variable block now feeds .ask-md too', () => {
  assert.match(css, /\.hd-diff-pane,\.ask-md\{\s*--hd-syntax-comment/, 'selector widened without restating hexes');
  const count = (css.match(/--hd-syntax-comment:#/g) || []).length;
  assert.equal(count, 1, 'the six syntax hexes still appear exactly once');
});

test('ui-ask-style: dots reuse wr-pulse; the pill and popovers are tokened', () => {
  assert.match(ruleBody('.ask-dot-run') || '', /animation:wr-pulse/);
  assert.match(ruleBody('.ask-dot-run') || '', /var\(--violet\)/);
  assert.match(ruleBody('.ask-dot-done') || '', /var\(--green\)/);
  assert.match(ruleBody('.ask-pill') || '', /border-radius:999px/);
  assert.match(ruleBody('.ask-pop') || '', /position:absolute/);
  assert.match(ruleBody('.ask-error-line') || '', /var\(--red-ink\)/);
});

test('ui-ask-style: the threads list scrolls under a capped height, caption pinned', () => {
  const list = ruleBody('.ask-threads-list');
  assert.ok(list, '.ask-threads-list rule exists');
  assert.match(list, /overflow-y:auto/, 'the rows scroll instead of overflowing the sheet');
  assert.match(list, /max-height:min\(/, 'a fixed px cap AND a viewport-relative one, whichever is smaller');
  assert.match(list, /100vh/, 'short viewports shrink the cap');
  assert.match(list, /overscroll-behavior:contain/, 'same containment as .ask-transcript');
  assert.match(list, /border-radius:/, 'rows are clipped, not bled over the panel radius');
});

test('ui-ask-style: the threads popover is the widened one and its titles clamp to 2 lines', () => {
  const pop = ruleBody('.ask-pop-threads');
  assert.ok(pop, '.ask-pop-threads rule exists');
  assert.match(pop, /width:326px/, 'the recent-chats panel is ~15% wider than the old 284px');
  assert.match(pop, /right:76px/, 'still right-anchored, so it grows leftward');
  const title = ruleBody('.ask-thread-title');
  assert.ok(title, '.ask-thread-title rule exists');
  assert.match(title, /-webkit-line-clamp:2/, 'long chat names wrap onto a second line');
  assert.match(title, /line-clamp:2/, 'the unprefixed property ships alongside the -webkit- one');
  assert.match(title, /-webkit-box-orient:vertical/);
  assert.match(title, /display:-webkit-box/);
  assert.match(title, /overflow:hidden/, 'the third line is still cut off');
  assert.ok(!/white-space:nowrap/.test(title), 'nowrap is gone or the title can never wrap');
  assert.match(title, /font-size:12\.5px/, 'the existing font styling is kept');
});

test('ui-ask-style: the thread date leads the meter in bold; an idle dot collapses its slot', () => {
  const when = ruleBody('.ask-thread-when');
  assert.ok(when, '.ask-thread-when rule exists');
  assert.match(when, /font-weight:700/, 'the date reads bold');
  assert.match(when, /color:var\(--ink\)/, 'the primary ink token, so it darkens against the grey figures');
  assert.ok(!/color:var\(--ink-3\)/.test(when), 'only the date leaves the meter grey');
  assert.match(when, /white-space:nowrap/, 'the date never breaks across the meter line');
  assert.ok(!/flex:/.test(when), 'an inline span inside the meter, no longer a flex child of the row');
  assert.ok(!/font-size|font-family/.test(when), 'size and mono are inherited from .ask-thread-meter');
  const meter = ruleBody('.ask-thread-meter');
  assert.ok(meter, '.ask-thread-meter rule exists');
  assert.match(meter, /font-family:var\(--mono\)/, 'digits line up down the column');
  assert.match(meter, /font-size:10px/, 'still secondary to the 12.5px title');
  assert.match(meter, /color:var\(--ink-3\)/, 'everything but the date stays on the secondary colour');
  const dot = ruleBody('.ask-thread-dot');
  assert.ok(dot, '.ask-thread-dot rule exists');
  assert.match(dot, /display:none/, 'an idle chat shows no dot and gives up its slot');
  assert.ok(!/visibility:hidden/.test(dot), 'collapsed, not merely invisible — no empty gutter on idle rows');
  const live = ruleBody('.ask-thread-dot.ask-dot-live');
  assert.ok(live, 'the live arm exists');
  assert.match(live, /display:block/, 'an in-flight chat gets its green dot back');
  assert.match(ruleBody('.ask-dot') || '', /var\(--seq\)/, 'the shared dot rule is untouched');
  assert.ok(!/display:none/.test(ruleBody('.ask-dot') || ''), 'hiding is scoped to the threads rows');
});

test('ui-ask-style: a model row survives an arbitrarily long plugin name', () => {
  // .ask-pop-model is a fixed 292px panel and plugin names are arbitrary, so the
  // origin is not in the row at all and the name is the only thing left that can
  // give. A rigid badge wins every negotiation — with flex:0 0 auto + nowrap the
  // name renders at 0px and the row (check mark included) overflows the panel,
  // which sets no overflow of its own.
  const tag = ruleBody('.ask-model-tag');
  assert.ok(tag, '.ask-model-tag rule exists');
  assert.match(tag, /flex:0 1 auto/, 'the base badge may shrink');
  assert.match(tag, /min-width:0/, '…below its content width, all the way to a nub');
  assert.match(tag, /overflow:hidden/);
  assert.match(tag, /text-overflow:ellipsis/, 'a truncated badge still reads as a badge');
  assert.match(tag, /max-width:/, 'and it never claims the whole row');

  // The status badges are the warning itself — three fixed short strings. Letting the
  // shrink rule reach them turns "⚠cost" into a bare "…", which is the wrong trade,
  // so they opt back out. The plugin badge alone absorbs the deficit.
  for (const variant of ['.ask-model-tag.is-warn', '.ask-model-tag.is-err']) {
    const body = ruleBody(variant);
    assert.ok(body, `${variant} rule exists`);
    assert.match(body, /flex:0 0 auto/, `${variant} keeps its full width`);
    assert.match(body, /max-width:none/, `${variant} opts out of the share cap`);
  }

  const name = ruleBody('.ask-model-item .ask-model-name');
  assert.ok(name, 'the model-row name is scoped away from the effort pane');
  assert.match(name, /flex:0 1 auto/, 'shrink but never grow — badges keep hugging the name');
  assert.match(name, /min-width:(?!0[;\s}])/, 'and it keeps a legible floor rather than collapsing to 0');
  assert.match(name, /text-overflow:ellipsis/);
});

test('ui-ask-style: only the threads popover was widened', () => {
  assert.match(ruleBody('.ask-pop-model') || '', /width:292px/);
  assert.match(ruleBody('.ask-pop-runinfo') || '', /width:326px/);
  assert.match(ruleBody('.ask-pop-worktrees') || '', /min-width:340px/);
});

test('ui-ask-style: composer textarea overrides the global textarea rules', () => {
  const input = ruleBody('.ask-composer textarea.ask-input');
  assert.ok(input, 'the higher-specificity selector exists (spec §10.3)');
  assert.match(input, /min-height:0/);
  assert.match(input, /max-height:120px/);
  assert.match(input, /resize:none/);
});

test('ui-ask-style: the composer-row scope pill never shrinks and its popover opens upward; the title keeps its ellipsis', () => {
  assert.match(ruleBody('.ask-scope-btn') || '', /flex:none/, 'in the composer row next to "+" — the pill keeps its width, the spacer absorbs the slack');
  const pop = ruleBody('.ask-pop-scope') || '';
  assert.match(pop, /bottom:/, 'the scope popover is anchored to the bottom, above its composer-row trigger');
  assert.match(pop, /left:16px/);
  assert.doesNotMatch(pop, /top:46px/, 'no longer anchored to the header');
  assert.match(pop, /max-height:min\(420px,70%\)/);
  assert.match(pop, /overflow-y:auto/);
  const title = ruleBody('.ask-title') || '';
  assert.match(title, /min-width:0/);
  assert.match(title, /overflow:hidden/);
  assert.match(title, /text-overflow:ellipsis/);
  assert.match(title, /white-space:nowrap/);
});

test('ui-ask-style: resize grips are invisible edge zones that only set the cursor, with a tokened inset highlight', () => {
  const base = ruleBody('.ask-resize');
  assert.ok(base, '.ask-resize rule exists');
  assert.match(base, /position:absolute/);
  assert.match(base, /background:transparent/, 'invisible until hovered');
  assert.match(base, /touch-action:none/, 'a touch drag resizes instead of scrolling the page');
  assert.match(base, /--ask-grip:transparent/, 'idle: no highlight');
  assert.match(base, /z-index:5/, 'above the popovers (3/4) so an edge stays grabbable');
  assert.match(ruleBody('.ask-resize:hover') || '', /--ask-grip:var\(--ink-3\)/, 'hover: the section\'s hairline token');
  assert.match(ruleBody('.ask-resize.is-active') || '', /--ask-grip:var\(--ink\)/, 'dragging: the section\'s hover-border token');
  const cursors = { n: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', nw: 'nwse-resize' };
  for (const [edge, cursor] of Object.entries(cursors)) {
    const body = ruleBody(`.ask-resize-${edge}`);
    assert.ok(body, `.ask-resize-${edge} rule exists`);
    assert.match(body, new RegExp(`cursor:${cursor}`), `${edge} cursor`);
    assert.match(body, /box-shadow:inset [^;]*var\(--ask-grip\)/, `${edge} highlight is a thin inset line, not a fill`);
  }
  assert.ok(!ruleBody('.ask-resize-s'), 'no bottom grip — the sheet is bottom-anchored');
  assert.match(ruleBody('.ask-sheet.is-resizing') || '', /user-select:none/);
});

test('ui-ask-style: the sheet caps itself to the dock so an inline size can never overflow the viewport', () => {
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /max-width:100%/);
  assert.match(sheet, /max-height:calc\(100% - 20px\)/, 'keeps the 20px top gap the default height leaves');
  assert.ok(!/min-width|min-height/.test(sheet), 'the 540×360 floor lives in JS only — a CSS floor would overflow narrow viewports');
  assert.match(sheet, /overflow:hidden/, 'the sheet still clips; .ask-transcript is the scrollport');
  const t = ruleBody('.ask-transcript');
  assert.match(t, /flex:1 1 auto/, 'the transcript absorbs every extra pixel of height');
  assert.match(t, /min-height:0/);
  assert.match(t, /overflow-y:auto/);
});
