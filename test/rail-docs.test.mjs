// test/rail-docs.test.mjs — the docs, the catalog, the library and the gallery agree (docs/rail/gate.md): each rule has one
// home and a check that exists; each catalog entry with `code` is a real export; each component the library exports is in
// the catalog, tested and drawn in the gallery; contributors and agents are pointed at the design system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as LIB from '../ui/public/design-system/components/index.mjs';
import { catalogHtml, chapters as pageChapters, tilesHtml } from '../tools/rail-artifact.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const RAIL = 'docs/rail';
const chapters = () => readdirSync(join(ROOT, RAIL)).filter((f) => f.endsWith('.md'));
const catalog = () => JSON.parse(read('docs/design-system-catalog.json'));

function rules() {
  const out = [];
  for (const f of chapters()) for (const m of read(`${RAIL}/${f}`).matchAll(/^\| `([a-z-]+\.[a-z-]+)` \| (.+?) \| (.+?) \| (.+?) \|$/gm)) out.push({ file: f, id: m[1], what: m[2], why: m[3], held: m[4] });
  return out;
}
const checkExists = (c) => c === 'by hand' || [`plans/rail/prototype/gates/${c}.mjs`, `test/${c}.test.mjs`, `tools/${c}.mjs`].some((p) => existsSync(join(ROOT, p)));

test('every rule has one home, an id, a why, and a check that exists', () => {
  const all = rules(); assert.ok(all.length > 40, 'the scan sees the rules');
  const seen = new Map();
  for (const r of all) { assert.ok(!seen.has(r.id), `${r.id} is in ${seen.get(r.id)} and ${r.file}`); seen.set(r.id, r.file); assert.ok(checkExists(r.held), `${r.id}: no check named ${r.held}`); }
});

test('the index lists every chapter, and every chapter it lists exists', () => {
  const idx = read(`${RAIL}/README.md`);
  const listed = [...idx.matchAll(/\]\(([a-z-]+\.md)\)/g)].map((m) => m[1]);
  for (const f of listed) assert.ok(existsSync(join(ROOT, RAIL, f)), `${f} is listed and missing`);
  for (const f of chapters()) if (f !== 'README.md') assert.ok(listed.includes(f), `${f} is not in the index`);
});

test('a catalog entry with code is a real export, and every library component is in the catalog', () => {
  const cat = catalog(); const entries = [...cat.components, ...cat.patterns, ...cat.logic];
  const coded = new Set();
  for (const e of entries) {
    if (!e.code) continue;
    const [file, name] = e.code.split('#');
    assert.ok(existsSync(join(ROOT, file)), `${e.name}: ${file} is missing`);
    assert.match(read(file), new RegExp(`export (async )?(function|const) ${name}\\b`), `${e.name}: ${file} does not export ${name}`);
    coded.add(name);
  }
  // Every function the library exports is a catalog entry's, or a helper its entry's module names.
  const HELPERS = /^(neverOutside|watchStrips|toastText|menuUp|menuShift|scrollEdges|commandHead|commandLine|SOUND_CHOICES|BURST_MS|REAL_CONTROL|listWord|LIST_SHOWN|fitMenu|planBulk|skipText|selectStep|CHAT_KINDS|bulkStateOf|awayShows|AWAY_IDLE_MS|esc|attrs|cls|toElement|ICONS|icon|fill|stateIds|actionHelp|actionLevel|actionFlow|runFlow|makeAction|memberKeeps|sectionOf|isDone|isLiveStep|stageState|subState|stepLook|defaultStage|stageMeta|toMin|fmtMin|STAGE_WORD|workingWord|confirmOf|failureOf|foldMiddle|workParts|workPhrase|MODES|RUN_PAGE_LEVELS|runPartShows|prefs|shows|morph|land|splitButton|statusDot|confirmActions|figure|errorToast|moreMenu|searchResults|fitTags|stepDot|stackRow|suggestionFail|suggestButton|suggestedChip|stopWriting|copied|COPIED_MS|SCROLL_SHOW_MS|thumbBox|tryStep|USAGE_REFRESH_MS|usageWindow|connectedUsage|usageTip|menuItem|statusDotClass|confirmForm|figureBreakdown|toastUndo|documentLink|dialogFrame|failureLink|previewToggle|suggestionPreview|TRACKER_MOVES|navFlyout|themeChoice|cardTitleLink|SHORTCUTS|RESERVED|FIELD|chordId|isMac|keyGlyph|keyHint|keyFacts|listMove|shortcutSections|openShortcutsSheet|PRESS_MS|selectClear|selectStart|selectToggle|selectRange|selectAll|selectPrune|selectCount|selectAllState|selectExtend|selectApply|keepFocus|selectAllBox|bindLongPress)$/;
  for (const name of Object.keys(LIB)) assert.ok(coded.has(name) || HELPERS.test(name), `${name} is exported and not in the catalog`);
});

test('every component in code is tested and drawn in the gallery', () => {
  const tests = read('test/design-system-components.test.mjs'); const gallery = read('plans/rail/prototype/components.html');
  for (const c of catalog().components) {
    if (!c.code) { assert.fail(`${c.name} has no code entry`); }
    const name = c.code.split('#')[1];
    assert.match(tests, new RegExp(`\\b${name}\\b`), `${c.name}: no test mentions ${name}`);
    assert.ok(gallery.includes(`${c.name}: [[`) || gallery.includes(`'${c.name}': [[`), `${c.name}: no gallery example`);
  }
});

test('contributors and agents are pointed at the design system', () => {
  for (const f of ['CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md']) assert.match(read(f), /docs\/rail\/README\.md/, `${f} does not point to the design system`);
  for (const a of readdirSync(join(ROOT, '.claude/agents'))) assert.match(read(`.claude/agents/${a}`), /docs\/rail\/README\.md/, `${a} does not point to the design system`);
});

test('the plans point at what exists, and the one names stay', () => {
  for (const f of readdirSync(join(ROOT, 'plans/rail'))) if (f.endsWith('.md')) assert.doesNotMatch(read(`plans/rail/${f}`), /rail-restart-handoff/, f);
  assert.match(read('plans/rail/wave-1.md'), /Base branch: `docs\/rail-agreed`/);
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'docs/rail/README.md']) assert.match(read(f), /Building Rail now/, f);
  for (const f of [...chapters().map((c) => `${RAIL}/${c}`), 'docs/design-system-catalog.json']) assert.doesNotMatch(read(f), /account menu/i, `${f}: the name is the profile menu`);
});

test('the motion timings are the ones the catalog names', () => {
  const look = read('plans/rail/prototype/design-system/rail-look.css'), t = catalog().motion.timings;
  assert.match(look, /--motion-quick:150ms/); assert.match(t['--motion-quick'], /^150ms/);
  assert.match(look, /--motion-change:200ms/); assert.match(t['--motion-change'], /^200ms/);
  assert.match(look, /--motion-flash:1\.2s/);
});

test('no pointer to the deleted Shaping branch is left in what Agreed decided', () => {
  for (const f of readdirSync(join(ROOT, 'plans/rail/agreed'))) if (f.endsWith('.md')) assert.doesNotMatch(read(`plans/rail/agreed/${f}`), /rail-shaping|plans\/rail\/shaping/, f);
});

test('the generated page holds every chapter, rule and catalog entry, from the sources alone', () => {
  const ch = pageChapters(); const html = ch.map((c) => c.html).join('') + catalogHtml() + tilesHtml();
  for (const f of readdirSync(join(ROOT, RAIL))) { const id = f === 'README.md' ? 'rail' : f.replace('.md', ''); assert.ok(ch.some((c) => c.id === id), `${f} is not on the page`); }
  for (const r of rules()) assert.ok(html.includes(r.id), `${r.id} is not on the page`);
  for (const c of [...catalog().components, ...catalog().patterns, ...catalog().logic]) assert.ok(html.includes(c.name.replace(/&/g, '&amp;')), `${c.name} is not on the page`);
});
