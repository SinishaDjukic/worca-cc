// The gate of the design system (docs/rail/gate.md), like the feature flag tests: new UI code that writes a component's
// markup by hand, or its own state words and failures, fails `npm test`. Old pages are frozen by a ratchet that can only
// shrink (test/fixtures/rail-gate-baseline.json); a page that moves to the library lowers its count.
//   node tools/rail-gate.mjs            what the scan finds against the baseline
//   node tools/rail-gate.mjs --update   writes the lower counts; it refuses a higher one
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BASELINE = join(ROOT, 'test/fixtures/rail-gate-baseline.json');
const EXT = /\.(mjs|js|html)$/;
// Not UI code a person writes here: the library itself, and what is built or vendored.
const SKIP = [/^ui\/public\/design-system\//, /^ui\/public\/browser-extension\//, /^ui\/public\/assets\//, /^ui\/public\/vendor\//, /\.min\.js$/, /(^|\/)style\.css$/, /^ui\/public\/stillhet\/(components|graph|today)\.js$/];   // Stillhet's generated bundles (tools/stillhet-build.mjs)

// What the library owns. A hit in a page is that thing rebuilt by hand.
const classes = (...names) => new RegExp(`(?:class|className)\\s*[=:]\\s*["'\`][^"'\`\\n]*(?<![\\w-])(?:${names.join('|')})(?![\\w-])|classList\\.add\\(\\s*["'\`](?:${names.join('|')})["'\`]`, 'g');
export const OWNED = [
  ['Button', /<button\b|createElement\(\s*['"`]button['"`]\s*\)/g],
  ['CompactMenu', classes('menu', 'menu-item')],
  ['StatusLine', classes('status-dot')],
  ['ConfirmStrip', classes('rc-confirm')],
  ['Tabs', classes('tabs', 'tab')],
  ['Segmented', classes('seg')],
  ['Figures', classes('rc-figs')],
  ['Toast', classes('rc-toast', 'toasts')],
  ['EmptyState', classes('empty-line')],
  ['Text link', classes('dc-link')],
  ['Row', classes('list-row', 'set-row', 'lr-main', 'rd-route-row', 'pz-row')],
  ['SettingsSection', classes('set-sec')],
  ['SentencePicker', classes('spick')],
  ['Switch', /role="switch"/g],
  ['Checkbox', /type="checkbox"|\.type\s*=\s*['"`]checkbox['"`]/g],
  ['OptionList', classes('sc-ans-opt')],
  ['Chip', classes('kind-chip')],
  ['SuggestionField', classes('pd-adorn')],
  ['Stepper', classes('sc-track', 'sc-stage')],
  ['Dialog', classes('viewer-modal')],
  ['Field', classes('fld')],
  ['Inline icon', /<svg[^>]*viewBox="0 0 24 24"/g],
  // The shared logic: a state's word, or a failure's sentence, written by a page instead of read from the library.
  ['States', /['"`](Needs you|Ready to merge|In review|Ready to ship)['"`]/g],
  ['Step flow', /Nothing changed\./g],
];

/** What a text rebuilds by hand: { name: count }. */
export function scanText(text) {
  const out = {};
  for (const [name, re] of OWNED) { const n = (text.match(re) || []).length; if (n) out[name] = n; }
  return out;
}
const total = (hits) => Object.values(hits).reduce((a, b) => a + b, 0);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Every UI file and its count: { 'ui/public/x.mjs': n } (zero counts left out). */
export function scanTree(root = ROOT) {
  const out = {};
  for (const f of walk(join(root, 'ui/public'))) {
    const rel = relative(root, f).split('\\').join('/');
    if (SKIP.some((re) => re.test(rel))) continue;
    const n = total(scanText(readFileSync(f, 'utf8')));
    if (n) out[rel] = n;
  }
  return out;
}

/** Compares a scan with the baseline: new hand-built UI fails; a page that shrank must lower its count. */
export function compare(scan, baseline) {
  const grew = []; const shrank = [];
  for (const [f, n] of Object.entries(scan)) {
    const was = baseline[f] ?? 0;
    if (n > was) grew.push({ file: f, was, now: n });
  }
  for (const [f, was] of Object.entries(baseline)) {
    const n = scan[f] ?? 0;
    if (n < was) shrank.push({ file: f, was, now: n });
  }
  return { grew, shrank };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scan = scanTree(); const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const { grew, shrank } = compare(scan, base);
  for (const g of grew) console.log(`GREW  ${g.file}: ${g.was} → ${g.now}`);
  for (const s of shrank) console.log(`shrank ${s.file}: ${s.was} → ${s.now}`);
  if (process.argv.includes('--update')) {
    if (grew.length) { console.error('Refused: the ratchet only shrinks. Use the library in the files above.'); process.exit(1); }
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(scan).sort()), null, 2)}\n`);
    console.log('Baseline lowered.');
  } else if (!grew.length && !shrank.length) console.log(`${Object.keys(scan).length} old files frozen; nothing new skips the library`);
  process.exitCode = grew.length ? 1 : 0;
}
