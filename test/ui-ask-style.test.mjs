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

const arms = (v) => { const m = /^light-dark\(([\s\S]*)\)$/.exec(v); if (!m) return null; let d = 0; const s = m[1];
  for (let i = 0; i < s.length; i += 1) { if (s[i] === '(') d += 1; else if (s[i] === ')') d -= 1; else if (s[i] === ',' && d === 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; } return null; };
const tokenValue = (name) => {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) return null;
  const a = arms(m[1].trim()); return (a ? a[0] : m[1].trim()).toLowerCase();
};

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
  const count = (css.match(/--hd-syntax-comment:light-dark\(#/g) || []).length;
  assert.equal(count, 1, 'the six syntax pairs still appear exactly once');
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
  assert.match(pop, /left:var\(--ask-col-inset\)/, 'flush with the composer box\'s left edge, wherever the cap centres it');
  assert.doesNotMatch(pop, /top:46px/, 'no longer anchored to the header');
  assert.match(pop, /max-height:min\(420px,70%\)/);
  assert.match(pop, /overflow-y:auto/);
  const chip = ruleBody('.ask-pop-chip') || '';
  assert.match(chip, /width:288px/);
  assert.match(chip, /max-height:min\(420px,70%\)/, 'the whole catalog is 12+ rows and .ask-sheet clips — without a cap the Effort row is unreachable');
  assert.match(chip, /overflow-y:auto/);
  assert.match(chip, /border-radius:14px/);
  assert.ok(css.indexOf('.ask-pop-chip{') > css.indexOf('.ask-pop{'), '.ask-pop-chip and .ask-pop are both (0,1,0) on the same element — source order decides, so the chip rule must come last');
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
  // The sheet clips at its rounded corner (r-card minus the 1px border): a corner
  // grip is exactly one radius square and carries that radius, so its inset line
  // bends along the arc instead of being clipped away; the straight grips start
  // where the arc ends.
  assert.match(base, /--ask-corner:calc\(var\(--r-card\) - 1px\)/, 'the corner size is the sheet\'s inner radius');
  assert.match(ruleBody('.ask-resize-ne'), /width:var\(--ask-corner\);height:var\(--ask-corner\)/);
  assert.match(ruleBody('.ask-resize-ne'), /border-top-right-radius:var\(--ask-corner\)/, 'ne bends along the arc');
  assert.match(ruleBody('.ask-resize-nw'), /border-top-left-radius:var\(--ask-corner\)/, 'nw bends along the arc');
  assert.match(ruleBody('.ask-resize-n'), /left:var\(--ask-corner\);right:var\(--ask-corner\)/, 'top grip spans between the arcs');
  for (const edge of ['e', 'w']) {
    assert.match(ruleBody(`.ask-resize-${edge}`), /top:var\(--ask-corner\)/, `${edge} starts below the top arc`);
    assert.match(ruleBody(`.ask-resize-${edge}`), /bottom:var\(--ask-corner\)/, `${edge} stops above the bottom arc`);
  }
  // The header's icon buttons sit above the ne corner grip, so its hit box never
  // swallows a click (or a double-click) on the last button.
  assert.match(ruleBody('.ask-header .ask-icon-btn') || '', /position:relative;z-index:6/, 'header buttons above the grips');
});

test('ui-ask-style: an assistant answer spans the full transcript width — a table or code block ends at the same edge as the user bubble', () => {
  const answer = ruleBody('.ask-answer');
  assert.ok(answer, '.ask-answer rule exists');
  assert.match(answer, /max-width:100%/, 'no 92% measure: the transcript padding is the only gutter, symmetric on both sides');
});

test('ui-ask-style: the sheet caps itself to the dock so an inline size can never overflow the viewport', () => {
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /max-width:100%/);
  assert.match(sheet, /max-height:calc\(100% - 20px\)/, 'keeps the 20px top gap the default height leaves');
  assert.ok(!/min-width|min-height/.test(sheet), 'the 782×669 floor lives in JS only — a CSS floor would overflow narrow viewports');
  assert.match(sheet, /overflow:hidden/, 'the sheet still clips; .ask-transcript is the scrollport');
  const t = ruleBody('.ask-transcript');
  assert.match(t, /flex:1 1 auto/, 'the transcript absorbs every extra pixel of height');
  assert.match(t, /min-height:0/);
  assert.match(t, /overflow-y:auto/);
});

test('ui-ask-style: a wide sheet caps its content — the transcript column and the composer box share one max width, centred', () => {
  // The cap is one token on the sheet so the column, the box and the popover
  // insets can never drift apart. 880px: invisible at the default 782px sheet,
  // it only bites once the sheet is dragged wider.
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /--ask-col-max:880px/, 'the cap lives on the sheet');
  const col = ruleBody('.ask-transcript-col');
  assert.ok(col, '.ask-transcript-col rule exists');
  assert.match(col, /width:100%/);
  assert.match(col, /max-width:var\(--ask-col-max\)/);
  assert.match(col, /margin-inline:auto/, 'centred inside the scrollport');
  assert.match(col, /display:flex;flex-direction:column;gap:16px/, 'the message stack moved here from .ask-transcript');
  const t = ruleBody('.ask-transcript');
  assert.doesNotMatch(t, /display:flex|gap:/, '.ask-transcript is only the scrollport now');
  assert.match(t, /overscroll-behavior:contain/, 'still the scrollport');
  assert.match(t, /position:relative/);
  // the composer box: rounded, bordered, same cap, centred under the column
  const box = ruleBody('.ask-composer-box');
  assert.ok(box, '.ask-composer-box rule exists');
  assert.match(box, /width:100%/);
  assert.match(box, /max-width:var\(--ask-col-max\)/);
  assert.match(box, /margin-inline:auto/);
  assert.match(box, /border:1px solid var\(--line-2\)/);
  assert.match(box, /border-radius:16px/);
  assert.match(box, /background:var\(--panel\)/, 'panel, not field: the textarea keeps its contrast baseline');
  assert.match(box, /display:flex;flex-direction:column;gap:4px/, 'chips → textarea → msg → row stack inside the box');
  assert.match(ruleBody('.ask-composer-box:focus-within') || '', /border-color:var\(--ink-3\)/, 'typing lifts the border');
  const composer = ruleBody('.ask-composer');
  assert.doesNotMatch(composer, /border-top/, 'the separation moved from the band to the box');
  assert.match(composer, /padding:10px 16px 14px/, 'the band is the padded outer strip');
  assert.match(composer, /position:relative/);
});

test('ui-ask-style: the composer popovers follow the box, not the sheet corners', () => {
  // The popovers stay children of .ask-sheet (its height is what their
  // max-height:70% means), so their horizontal anchor is the box\'s own inset:
  // the band padding until the cap bites, then the centring remainder.
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /--ask-col-inset:max\(16px,calc\(50% - var\(--ask-col-max\) \/ 2\)\)/, 'inset = max(band padding, centring remainder)');
  assert.match(sheet, /--ask-box-top:103px/, 'sheet bottom → box top with an empty one-line composer: 14px band + 1+8+36+4+31+8+1 box');
  assert.match(ruleBody('.ask-pop-scope') || '', /left:var\(--ask-col-inset\);bottom:calc\(var\(--ask-box-top\) \+ 6px\)/, 'scope: box left edge, floats above the box');
  assert.match(ruleBody('.ask-pop-model') || '', /right:var\(--ask-col-inset\);bottom:calc\(var\(--ask-box-top\) \+ 6px\)/, 'model: box right edge');
  assert.match(ruleBody('.ask-pop-runinfo') || '', /right:calc\(var\(--ask-col-inset\) \+ 66px\);bottom:calc\(var\(--ask-box-top\) \+ 6px\)/, 'agents: the same 66px left of the model popover as before');
  assert.match(ruleBody('.ask-pop-worktrees') || '', /right:calc\(var\(--ask-col-inset\) \+ 157px\)/, 'worktrees: the same 157px left of the model popover as before');
  assert.match(ruleBody('.ask-jump') || '', /bottom:calc\(var\(--ask-box-top\) \+ 9px\)/, 'the jump pill floats just above the box');
  // untouched: the threads popover hangs off the header, the chip picker is JS-positioned
  assert.match(ruleBody('.ask-pop-threads') || '', /top:46px;right:76px/);
  assert.doesNotMatch(ruleBody('.ask-pop-chip') || '', /--ask-col-inset|--ask-box-top/);
  assert.doesNotMatch(ruleBody('.ask-pop-at') || '', /--ask-col-inset|--ask-box-top/);
});

test('ui-ask-style: the pill wave is a permanent ::before that .is-live fades in and drifts with transform only', () => {
  // the pill becomes the glow's stacking context and clip, nothing else about it moves
  const pill = ruleBody('.ask-pill');
  assert.match(pill, /position:relative/);
  assert.match(pill, /isolation:isolate/);
  assert.match(pill, /overflow:hidden/);
  assert.match(pill, /border-radius:999px/);
  assert.match(pill, /pointer-events:auto/);
  assert.match(pill, /transition:border-color \.15s/, 'the hover transition survives');
  assert.match(ruleBody('.ask-pill[hidden]'), /display:none/, 'hidden twin untouched');
  assert.match(ruleBody('.ask-pill:focus-visible'), /outline:2px solid var\(--ink\)/, 'focus ring untouched');
  // the layer is always in the tree and transparent at rest; the drift is declared
  // here but PAUSED, so dropping .is-live freezes it where it is and only the
  // opacity fades — removing an animation instead would snap it back at opacity 1
  const glow = ruleBody('.ask-pill::before');
  assert.ok(glow, '.ask-pill::before rule exists');
  assert.match(glow, /content:''/);
  assert.match(glow, /position:absolute/);
  assert.match(glow, /z-index:-1/);
  assert.match(glow, /pointer-events:none/);
  assert.match(glow, /opacity:0;/);
  assert.match(glow, /transition:opacity \.45s/);
  assert.match(glow, /transform-origin:50% 100%/, 'breathes upward from the bottom edge');
  assert.match(glow, /animation:ask-pill-wave/, 'the drift is declared on the rest rule…');
  assert.match(glow, /animation-play-state:paused/, '…and held at rest, so nothing moves until .is-live');
  for (const t of ['pink', 'violet', 'lilac']) {
    assert.match(glow, new RegExp(`var\\(--ask-wave-${t}\\)`), `the glow spends --ask-wave-${t}`);
    assert.match(tokenValue(`ask-wave-${t}`) || '', /^#[0-9a-f]{6}$/, `--ask-wave-${t} is a :root hex token`);
  }
  // live: opacity 1 + the drift released
  const live = ruleBody('.ask-pill.is-live::before');
  assert.ok(live, '.ask-pill.is-live::before rule exists');
  assert.match(live, /opacity:1/);
  assert.match(live, /animation-play-state:running/, 'the live class only releases the paused drift');
  // the keyframes move the layer with transform ONLY (compositor-cached texture)
  assert.equal((css.match(/@keyframes\s+ask-pill-wave\b/g) || []).length, 1, 'declared exactly once');
  const kfAt = css.indexOf('@keyframes ask-pill-wave');
  const kf = css.slice(kfAt, css.indexOf('}}', kfAt) + 2);
  assert.match(kf, /transform:/);
  assert.doesNotMatch(kf, /(?:^|[{;\s])(left|top|right|bottom|width|height|background|opacity|filter|margin|padding):/, 'transform only');
  // reduced motion: pseudo-elements escape the `.ask-dock *` blanket, so the
  // FINAL block names the drift; the opacity fade is deliberately kept (D6).
  // It pauses rather than removes: `animation:none` would re-create the paused
  // animation at its 0% frame when .is-live comes off, i.e. a jump at opacity 1.
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(css.slice(guard).includes('.ask-pill.is-live::before{animation-play-state:paused;}'), 'the final block stops the drift by name');
  assert.ok(css.lastIndexOf('animation:ask-pill-wave') < guard, 'the animation use precedes the guard');
  assert.ok(!css.slice(guard).includes('.ask-pill::before{'), 'no unconditional ::before rule in the guard — an idle pill must stay dark');
});

test('ui-ask-style: run card v2 — violet wash token exists once, the block is tokened and inside the ask section', () => {
  assert.equal((css.match(/--violet-wash:light-dark\(#/g) || []).length, 1, 'one definition in :root');
  assert.match(ruleBody('.ask-rp-head') || '', /var\(--violet-wash\)/);
  assert.match(ruleBody('.ask-card.ask-rp') || '', /animation:wr-rise/);
  assert.match(ruleBody('.ask-rp-tile.mod') || '', /var\(--amber-wash\)/);
  // (0,3,1): the textarea carries BOTH classes (`ask-card-brief ask-rp-brief`, collectCardBody reads the first),
  // so the v1 rule `.ask-card textarea.ask-card-brief{max-height:160px;resize:none}` (0,2,1) applies to it too and must lose
  const brief = ruleBody('.ask-card.ask-rp textarea.ask-rp-brief') || '';
  assert.match(brief, /min-height:150px/);
  assert.match(brief, /max-height:420px/);
  assert.match(brief, /resize:vertical/);
  assert.match(ruleBody('.ask-rp-tile-l2') || '', /flex-wrap:wrap/);
  const start = css.indexOf('/* ---------- Ask Worca');
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  const at = css.indexOf('.ask-card.ask-rp{');
  assert.ok(at > start && at < guard, '.ask-rp lives in the ask section, before the final reduced-motion guard');
  assert.ok(at < css.indexOf('/* ---------- workflow card chrome'), 'right after the v1 card rules, before the workflow card');
});

test('ui-ask-style: run card v2 — the v1 card rules it replaced are deleted, the still-emitted spacer stays', () => {
  // buildCardForm emits .ask-rp-* for all four; nothing in ui/ or test/ names them any more.
  assert.equal(ruleBody('.ask-card-title'), null, 'v1 title rule is dead CSS');
  assert.equal(ruleBody('.ask-card-field'), null, 'v1 field rule is dead CSS');
  assert.equal(ruleBody('.ask-card-label'), null, 'v1 label rule is dead CSS');
  assert.equal(/\.ask-card-actions\s*\{/.test(css), false, 'v1 actions container rule is dead CSS');
  assert.ok(css.includes('.ask-card-actions-spacer'), 'the spacer buildWorkflowCard still emits keeps its rule');
});
