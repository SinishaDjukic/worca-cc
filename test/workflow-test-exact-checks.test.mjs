// test/workflow-test-exact-checks.test.mjs — Part 4 exact checks (plans/workflow-tests-part4-plan.md D93, D94): counted without AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotesIn, quotesCheck, numbersIn, numbersCheck, personalData, personalCheck, linksIn, exactAlternative, ibanValid, luhnValid }
  from '../src/shared/workflow-tests/exact-checks.mjs';
import { normaliseCheck, checkLabel, runCheck, CHECK_KINDS, PART4_KINDS } from '../src/shared/workflow-tests/checks.mjs';
import { exampleSourcesText } from '../src/core/workflow-tests/sources-text.mjs';

const FILES = 'Interview 3: “I export every month and it stops at 200 invoices, which is a pain.” Tickets: 140 a month, up 60 %.';

test('quotes: named (3+ words) or long (8+ words), found across spacing, quote marks, case and an ellipsis', () => {
  assert.deepEqual(quotesIn('She said "yes" and “I export every month and it stops” — Dana.'), ['I export every month and it stops'], 'fix round 5 (I7): a capitalised word after the dash, not any word');
  assert.deepEqual(quotesCheck('Dana said: "i export  every month ... at 200 invoices".', FILES), { met: true, value: 'Met' });
  assert.deepEqual(quotesCheck('Nobody quoted.', FILES), { met: true, value: 'No quotes' });
  assert.deepEqual(quotesCheck('Dana said: “I would pay twice for this tomorrow.” and «exports are slow for all of us, said Dana»', FILES),
    { met: false, value: 'Not in the files: "I would pay twice for this tomorrow." and 1 more' });
});

test('numbers: separators and per cent dropped, list markers and single digits skipped', () => {
  assert.deepEqual(numbersIn('1. Problem\n## 2) Users\nWe have 1,200 users, 3 teams, 60% growth and 3.50 euros.').map((x) => x.n), ['1200', '60', '3.5']);
  assert.deepEqual(numbersCheck('Tickets: 140 a month (60%). Limit: 200.', FILES), { met: true, value: 'Met' });
  assert.deepEqual(numbersCheck('Cut tickets by 75% from 140 to 35, saving 1,000 hours.', FILES), { met: false, value: 'Not in the files: 75%, 35, 1,000' });
  assert.deepEqual(numbersCheck('No figures here, only 3 points.', FILES), { met: true, value: 'No numbers' });
  assert.deepEqual(numbersCheck('Shipped on 2026-11-19 and checked on 19.11.2026.', FILES), { met: true, value: 'No numbers' }, 'M8: dates are not counted');
});

test('personal data: e-mail, phone, IBAN and card numbers; dates and plain numbers are not phones', () => {
  assert.equal(ibanValid('DE89 3704 0044 0532 0130 00'), true);
  assert.equal(ibanValid('DE00 3704 0044 0532 0130 00'), false);
  assert.equal(luhnValid('4111111111111111'), true);
  assert.deepEqual(personalData('Write to ana@example.com or call +49 30 1234 5678. IBAN DE89 3704 0044 0532 0130 00, card 4111 1111 1111 1111.'),
    { emails: 1, phones: 1, ibans: 1, cards: 1 });
  assert.deepEqual(personalData('On 2026-11-19 we had 1,200 users and 140 tickets; ticket 4711-0042.'), { emails: 0, phones: 0, ibans: 0, cards: 0 });
  assert.equal(personalData('Due 01/02/2026 12:30, moved to 05.11.2026 09:15.').phones, 0, 'M7: a day-first date with a time is not a phone number');
  assert.deepEqual(personalCheck('ana@example.com, bo@example.org and 0049 30 1234567'), { met: false, value: 'Found 2 e-mail addresses, 1 phone number' });
});

test('links: markdown and bare, de-duplicated, closing marks dropped', () => {
  assert.deepEqual(linksIn('See [the doc](https://a.example/x) and https://a.example/x, or http://b.example/y.'),
    ['https://a.example/x', 'http://b.example/y']);
});

test('links: a ")" that closes a "(" inside the link stays, an outer one goes', () => {
  const wiki = 'https://en.wikipedia.org/wiki/Mercury_(planet)';
  assert.deepEqual(linksIn(`See ${wiki} for more`), [wiki]);
  assert.deepEqual(linksIn(`See [x](${wiki}) for more`), [wiki]);
  assert.deepEqual(linksIn(`(see ${wiki})`), [wiki]);
  assert.deepEqual(linksIn('(see https://example.com/a)'), ['https://example.com/a']);
  assert.deepEqual(linksIn('A list (https://example.com/a), then (https://example.com/b).'), ['https://example.com/a', 'https://example.com/b']);
  assert.deepEqual(linksIn(`On Mercury (${wiki}).`), [wiki]);
  assert.deepEqual(linksIn(`Two: ${wiki}, and ${wiki}).`), [wiki]);
});

test('fix round 2 (N1): a link ends at the first ")" that closes no "(" inside it, whatever follows', () => {
  const a = 'https://example.com/a';
  const wiki = 'https://en.wikipedia.org/wiki/Mercury_(planet)';
  assert.deepEqual(linksIn(`**[Source](${a})**`), [a], 'bold');
  assert.deepEqual(linksIn(`*[S](${a})*`), [a], 'italic');
  assert.deepEqual(linksIn(`_[S](${a})_`), [a], 'underscore emphasis');
  assert.deepEqual(linksIn('| [a](https://x.com/a)| [b](https://y.com/b) |'), ['https://x.com/a', 'https://y.com/b'], 'table pipe');
  assert.deepEqual(linksIn('[a](https://x.com/a)[b](https://y.com/b)'), ['https://x.com/a', 'https://y.com/b'], 'two adjacent links');
  assert.deepEqual(linksIn('(https://x.com/a)—more'), ['https://x.com/a'], 'a dash after the parenthesis');
  assert.deepEqual(linksIn('[a](https://x.com/a).Next'), ['https://x.com/a']);
  assert.deepEqual(linksIn(`**[Mercury](${wiki})**`), [wiki], 'a Wikipedia link in bold markdown');
  assert.deepEqual(linksIn('See (https://x.com/a_(b)_c(d)).'), ['https://x.com/a_(b)_c(d)'], 'balanced parentheses, then ").');
});

test('exactAlternative: board 2 and board 10 examples', () => {
  assert.deepEqual(exactAlternative('Quotes customers from the interviews, and makes up no quotes'), { kind: 'quotes' });
  assert.deepEqual(exactAlternative("Mentions that today's export stops at 200 invoices"), { kind: 'mentions', text: '200' });
  assert.deepEqual(exactAlternative('Uses only numbers from the files'), { kind: 'numbers' });
  assert.deepEqual(exactAlternative('Contains no personal data'), { kind: 'no-personal' });
  assert.equal(exactAlternative('Names a success metric with a number, and how to measure it'), null);
});

test('the four kinds as checks: normalised, labelled, run; said is kept and only when given', () => {
  for (const k of PART4_KINDS) assert.ok(CHECK_KINDS.includes(k), k);
  const q = normaliseCheck({ kind: 'quotes', said: ' Quotes  customers ' }).check;
  assert.deepEqual(q, { kind: 'quotes', said: 'Quotes customers' });
  assert.deepEqual(normaliseCheck({ kind: 'numbers', file: 'CHANGELOG.md' }).check, { kind: 'numbers', file: 'CHANGELOG.md' });
  assert.deepEqual(normaliseCheck({ kind: 'words', min: 10, max: null }).check, { kind: 'words', min: 10, max: null }, 'no said, no key');
  assert.equal(checkLabel({ kind: 'quotes' }), 'Every quote is in the files');
  assert.equal(checkLabel({ kind: 'numbers', file: 'brief.md' }), 'Numbers come from the files in brief.md');
  assert.equal(checkLabel({ kind: 'no-personal' }), 'Has no personal data');
  assert.equal(checkLabel({ kind: 'links' }), 'Every link works');
  assert.deepEqual(runCheck({ kind: 'quotes' }, { text: 'Dana said: "I would pay twice for this"', sources: FILES }).met, false);
  assert.deepEqual(runCheck({ kind: 'no-personal' }, { text: 'Clean text.' }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck({ kind: 'numbers' }, { text: '', sources: FILES }), { met: false, value: 'No result' });
});

test('exampleSourcesText: the request, the answers and the UTF-8 files; binary files are skipped', () => {
  const ex = { id: 1, request: 'Write the brief.', answers: [{ question: 'Formats?', answer: 'PDF and CSV.' }] };
  const text = exampleSourcesText(ex, { readFiles: () => [{ name: 'a.md', data: Buffer.from('Interview: 200 invoices') },
    { name: 'b.png', data: Buffer.from([0xff, 0xfe, 0x00, 0x81]) }] });
  assert.equal(text, 'Write the brief.\n\nFormats?\nPDF and CSV.\n\nInterview: 200 invoices');
});

test('fix round 1: a quote after a CRLF blank line is still found, and a quote never spans one', () => {
  assert.deepEqual(quotesIn('The 27" monitor.\r\n\r\nShe said: "I export every month and it stops" ok'), ['I export every month and it stops']);
  assert.deepEqual(quotesIn('An open " mark.\r\n\r\nShe said: "I export every month and it stops" ok'), ['I export every month and it stops']);
});

test('fix round 1: bracketed ellipses split a quote like a bare one', () => {
  assert.deepEqual(quotesCheck('Dana said: "I export every month [...] at 200 invoices".', FILES), { met: true, value: 'Met' });
  assert.deepEqual(quotesCheck('Dana said: "I export every month (…) at 200 invoices".', FILES), { met: true, value: 'Met' });
  assert.deepEqual(quotesCheck('Dana said: "I export every month […] at 200 invoices".', FILES), { met: true, value: 'Met' });
  assert.equal(quotesCheck('Dana said: "I would pay twice [...] for this tomorrow".', FILES).met, false);
});

test('fix round 1: heading section numbers and clock times are not numbers', () => {
  assert.deepEqual(numbersIn('## 1.1 Scope\n### 2.3 Risks\nWe have 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('The call is at 14:00 and ends 9:30, for 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersCheck('## 1.1 Scope\nMeeting at 14:00. Tickets: 140 a month.', FILES), { met: true, value: 'Met' });
  assert.deepEqual(numbersIn('Version 1.1 shipped, 2026 was the year.').map((x) => x.n), ['1.1', '2026'], 'prose numbers and years stay');
  assert.deepEqual(numbersIn('## 140 tickets a month\n## 2026 roadmap').map((x) => x.n), ['140', '2026'], 'a whole number opening a heading is a number of the text');
  assert.deepEqual(numbersIn('Logged at 12:30:45 for 140 tickets.').map((x) => x.n), ['140'], 'the seconds of a clock time are not a number');
});

test('fix round 1: a number past 2 MB of sources is found; the result side stays capped', () => {
  const sources = `${'filler words '.repeat(200000)}\nThe total was 4711 invoices.`;
  assert.ok(sources.length > 2 * 1024 * 1024);
  assert.deepEqual(numbersCheck('There were 4711 invoices.', sources), { met: true, value: 'Met' });
  const longResult = `${'x'.repeat(2 * 1024 * 1024 + 10)} 4711`;
  assert.deepEqual(numbersCheck(longResult, sources), { met: true, value: 'No numbers' }, 'the result is scanned only up to the cap');
});

test('fix round 1: two phone numbers separated by a space are both found', () => {
  assert.equal(personalData('Tel 030 1234567 030 7654321').phones, 2);
  assert.equal(personalData('Tel 030 1234567').phones, 1);
  assert.equal(personalData('Call +49 30 1234567 or +49 30 7654321').phones, 2);
});

// Fix round 4 (the paid check on a real product brief): the cases below are excerpts of that result and of its notes.
const BRIEF_FILES = ['Write a one-page product brief for adding a bulk invoice export (CSV) to our billing app.',
  '- In Q3, 38% of all support tickets were requests to export invoices.',
  '- Dana, the finance lead at a customer, said: "I spend two hours every month copying invoices into a spreadsheet."',
  '- Target: 500 customers use the export within 90 days of launch.',
  '- The export must be CSV, following RFC 4180: https://www.rfc-editor.org/rfc/rfc4180',
  '- Invoices must be kept for 10 years under German tax law (GoBD), so customers need a complete, unchanged copy.'].join('\n');

test('fix round 4: a " right after a digit is an inch or second mark, never a quote mark', async () => {
  const brief = ['- **Check**: ',
    '  - Total rendered length ≤ 1 page (8.5" × 11" or A4, 1" margins, 10–12pt font)',
    '',
    '| Test name | Location / type | Red-first expectation | Passes when |',
    '|-----------|-----------------|----------------------|-------------|',
    '| **Page length** | Rendered PDF or print preview | Brief renders to 2+ pages (too long) | Brief fits entirely on 1 page at 10–12pt font, 1" margins |',
    '| **Dana quote present** | Grep/text search | Exact quote not found in brief | Exact string found: "I spend two hours every month copying invoices into a spreadsheet." |'].join('\n');
  assert.deepEqual(quotesIn(brief), ['I spend two hours every month copying invoices into a spreadsheet.']);
  assert.deepEqual(quotesCheck(brief, BRIEF_FILES), { met: true, value: 'Met' });
  assert.deepEqual(quotesIn('A 30" pause, then she said "I spend two hours every month copying invoices" twice.'),
    ['I spend two hours every month copying invoices']);
  assert.deepEqual(quotesIn('A 27″ screen; she said "I spend two hours every month copying invoices" twice.'), ['I spend two hours every month copying invoices']);
});

test('fix round 4: a quote never spans a table row or a cell border', () => {
  const rows = '| Rule | Stated as "<n> years with wrong n |\n| Dana | "I spend two hours every month copying invoices into a spreadsheet." |';
  assert.deepEqual(quotesIn(rows), ['I spend two hours every month copying invoices into a spreadsheet.']);
  assert.deepEqual(quotesIn('| a "first half of a long | quoted cell text here" |'), [], 'a quote mark in one cell never pairs with one in the next');
  assert.deepEqual(quotesIn('| "I spend two hours every month copying invoices" | "the export stops at two hundred invoices every month" |'),
    ['I spend two hours every month copying invoices', 'the export stops at two hundred invoices every month']);
  assert.deepEqual(quotesIn('She said "I spend two hours\nevery month copying invoices" in prose.'), ['I spend two hours\nevery month copying invoices'],
    'a quote in prose still spans a single line break');
});

test('fix round 4: quote marks inside code are not quotes', () => {
  assert.deepEqual(quotesIn('Run `grep -F "the export stops at two hundred invoices" brief.md` first.'), []);
  assert.deepEqual(quotesIn('Before\n\n```js\nconst msg = "the export stops at two hundred invoices";\n```\n\nAfter "I spend two hours every month copying invoices" ok.'),
    ['I spend two hours every month copying invoices']);
  assert.deepEqual(quotesIn('Links:\n  - RFC 4180: `[RFC 4180](https://www.rfc-editor.org/rfc/rfc4180)`\n  - Note: "I spend two hours every month copying invoices" ok'),
    ['I spend two hours every month copying invoices']);
});

test('fix round 4 (quote rule, 2026-11-21): the 5-word rule is replaced; short unnamed quoted text is not checked', async () => {
  const mod = await import('../src/shared/workflow-tests/exact-checks.mjs');
  assert.equal(mod.QUOTE_MIN_WORDS, undefined, 'the 5-word constant is gone');
  assert.deepEqual(quotesIn('The button "Export all invoices now" and the hint "Pick the month you need here".'), []);
  assert.deepEqual(quotesCheck('The empty state reads "Pick a date range".', BRIEF_FILES), { met: true, value: 'No quotes' });
  assert.equal(quotesCheck('Dana said: "I spend three hours every month".', BRIEF_FILES).met, false, 'a made-up named quote is still checked');
});

test('fix round 4: digits inside ids, hashes, paths, links and code are not numbers of the result', () => {
  assert.deepEqual(numbersIn(String.raw`Read C:\Users\me\scratchpad\8b6bd033-5853-4ea5-95cc-0862ea97e4f4\notes.md for 140 tickets.`).map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('Notes in ./work/2026/brief.md, /tmp/run-5853/out and ~/drafts/750.md; 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('Commit 0862ea97, id 4ea5, build v2, run 8b6bd033-5853-4ea5, hash 123456789abc; 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('See https://www.rfc-editor.org/rfc/rfc4180?page=2024 and www.example.com/page/750 for 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('Use `limit = 500` and\n```\nexport 750 rows\n```\nfor 140 tickets.').map((x) => x.n), ['140']);
});

test("fix round 4: the number right after a standard's name is not a number of the result", async () => {
  const { STANDARD_NAMES } = await import('../src/shared/workflow-tests/exact-checks.mjs');
  for (const n of ['ISO', 'RFC', 'IEEE', 'UTF', 'SHA', 'EN', 'DIN']) assert.ok(STANDARD_NAMES.includes(n), n);
  assert.deepEqual(numbersIn('Dates in ISO 8601, CSV per RFC 4180, floats in IEEE 754, text in UTF-8, hashes with SHA-256, e-invoices per EN 16931, letters per DIN 5008.'), []);
  assert.deepEqual(numbersIn('ISO 8601 dates for 140 tickets, 8601 rows.').map((x) => x.n), ['140', '8601'], 'the same number elsewhere is still a number');
});

test('fix round 4: every other number is still checked: example values, percentages, units, made-up counts', () => {
  assert.deepEqual(numbersCheck('Amounts like 1234.56 with 19% VAT; 500 customers in 90 days; 500–750 words at 10pt on 8.5 × 11 paper.', BRIEF_FILES),
    { met: false, value: 'Not in the files: 1234.56, 19%, 750 and 2 more' });
  assert.deepEqual(numbersCheck('In Q3, 38% of tickets; 500 customers within 90 days; kept for 10 years (a 10-year duty).', BRIEF_FILES), { met: true, value: 'Met' });
  assert.deepEqual(numbersCheck('A 10x speed-up and 300ms per file.', BRIEF_FILES), { met: false, value: 'Not in the files: 300' },
    'a number with its unit is a number (10 is in the files)');
  assert.deepEqual(numbersCheck('COVID-19 and 5/day.', BRIEF_FILES).met, false, 'a number in a name or a rate stays checked');
});

// Fix round 5 (review of board 59, I4–I7 and M1). The cases are the review's own (r4rev\q.mjs, q2.mjs) and the paid brief's lines.
const DANA_FILES = 'Dana, the finance lead, said: "I spend two hours every month copying invoices into a spreadsheet." Target: 500 customers within 90 days. Tickets 140.';

test('fix round 5 (I5): a result wrapped in a markdown, md or text fence (or one never closed) is prose; a code fence is not', () => {
  const inner = '# Brief\nDana said: "Exports take forever, honestly."\nWe will reach 9999 customers.';
  for (const info of ['markdown', 'md', 'text', 'txt', 'Markdown']) {
    const s = `\`\`\`${info}\n${inner}\n\`\`\``;
    assert.deepEqual(quotesIn(s), ['Exports take forever, honestly.'], info);
    assert.deepEqual(numbersIn(s).map((x) => x.n), ['9999'], info);
  }
  assert.deepEqual(numbersIn(`\`\`\`\n${inner}`).map((x) => x.n), ['9999'], 'a fence never closed runs to the end as prose');
  assert.deepEqual(quotesIn(`Intro.\n\n\`\`\`\n${inner}`), ['Exports take forever, honestly.']);
  assert.deepEqual(numbersIn('```js\nconst limit = 750;\n```\nfor 140 tickets.').map((x) => x.n), ['140'], 'a closed code fence is still code');
  assert.deepEqual(numbersIn('~~~markdown\nWe will reach 9999 customers in 45 days.\n~~~').map((x) => x.n), ['9999', '45']);
});

test('fix round 5 (I6): prices and rates are numbers of the result, not paths or ids', () => {
  assert.deepEqual(numbersIn('Pricing: $12/user/month for 140 seats.').map((x) => x.n), ['12', '140']);
  assert.deepEqual(numbersIn('A 30/60/90-day plan.').map((x) => x.n), ['30', '60', '90']);
  assert.deepEqual(numbersIn('Budget USD5000 and EUR1200, or €9.99 and £4.50 a month.').map((x) => x.n), ['5000', '1200', '9.99', '4.5']);
  assert.deepEqual(numbersCheck('Pricing: $12/user/month, a 30/60/90-day plan, USD5000.', DANA_FILES), { met: false, value: 'Not in the files: 12, 30, 60 and 1 more' });
  // Paths, ids and dates stay skipped.
  assert.deepEqual(numbersIn('Notes in ./work/2026/brief.md, 2026/11/notes.md, ticket ABC123 and build v2; shipped 01/02/2026; 140 tickets.').map((x) => x.n), ['140']);
});

test('fix round 5 (M1): a quote ending in a digit closes, so it is checked and the next quote is read on its own', () => {
  const files = 'Lee said: "Exports take forever, honestly." Dana said: "We will switch vendors in 2026"';
  assert.deepEqual(quotesIn('Dana said: "We will switch vendors in 2027"'), ['We will switch vendors in 2027']);
  assert.equal(quotesCheck('Dana said: "We will switch vendors in 2027"', files).met, false);
  assert.deepEqual(quotesIn('Dana said: "We will switch vendors in 2026". Lee said: "I would pay double for this."'),
    ['We will switch vendors in 2026', 'I would pay double for this.']);
  assert.deepEqual(quotesIn('Dana said: "Our export stops at 200"'), ['Our export stops at 200']);
  // Inch marks stay inch marks: no quote open, or followed by "×", "x" or a digit.
  assert.deepEqual(quotesIn('She said "it prints on 8.5" × 11 paper, every page of it" and left.'), ['it prints on 8.5" × 11 paper, every page of it']);
  assert.deepEqual(quotesIn('Paper 8.5" × 11", 1" margins; Dana said: "Exports take forever, honestly."'), ['Exports take forever, honestly.']);
});

// Fix round 6 (round 5 review I1, I2, M2, M3, M4). The cases are the review's own (r5rev\q.mjs, q2.mjs).
test('fix round 6 (M2): an inch mark inside a quote does not close it when the real closing mark follows', () => {
  const s = 'Dana said: "We print every invoice on 8.5" paper and file it by hand." Then Lee said: "Exports are slow for us."';
  assert.deepEqual(quotesIn(s), ['We print every invoice on 8.5" paper and file it by hand.', 'Exports are slow for us.']);
  assert.deepEqual(quotesIn('Dana said: "We will switch vendors in 2026". Lee said: "I would pay double for this."'),
    ['We will switch vendors in 2026', 'I would pay double for this.'], 'round 5 M1 holds');
  assert.deepEqual(quotesIn('Dana said: "Our target is 500" and Lee said: "Exports are slow for us."'), ['Our target is 500', 'Exports are slow for us.']);
});

test('fix round 6 (M3): code inside a markdown-wrapped answer stays code; the wrapper still reads as prose', () => {
  const s = '```markdown\n# Brief\nWe reach 9999 customers.\n```js\nconst limit = 750; const retries = 25;\n```\nDana said: "Exports take forever, honestly."\n```';
  assert.deepEqual(numbersIn(s).map((x) => x.n), ['9999']);
  assert.deepEqual(quotesIn(s), ['Exports take forever, honestly.']);
});

test('fix round 6 (M4): a path that starts with a year, and an id that starts with a currency code, are not numbers', () => {
  assert.deepEqual(numbersIn('Notes in 2026/11/drafts for 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('Invoice EUR2024-INV-0042 for 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('Pricing: $12/user/month, a 30/60/90-day plan, USD5000.').map((x) => x.n), ['12', '30', '60', '90', '5000'], 'round 5 I6 holds');
});

// User decision 2026-11-22: a fixed, short, documented quote rule (docs/workflow-tests.md). The cases are round 6's review (r6rev\q.mjs, q2.mjs).
const Q = '"Exports take forever, honestly."';
const said = (s) => quotesIn(s).map((q) => q.replace(/[,.]$/, ''));

test('quote rule 2026-11-22: the constants are one fixed list: three words named, eight long, five verbs, a speaker of 1 to 4 words', async () => {
  const mod = await import('../src/shared/workflow-tests/exact-checks.mjs');
  assert.deepEqual([mod.QUOTE_MIN_NAMED_WORDS, mod.QUOTE_MIN_LONG_WORDS, mod.SPEAKER_MAX_WORDS], [3, 8, 4]);
  assert.deepEqual([...mod.SPEECH_VERBS], ['said', 'says', 'wrote', 'writes', 'told us']);
  assert.deepEqual(Object.keys(mod.QUOTE_FORMS), ['saidBefore', 'saidAfter', 'dashAfter']);
  for (const gone of ['PERSON_NOUNS', 'NOT_SPEAKERS']) assert.equal(mod[gone], undefined, `${gone} is gone`);
});

test('quote rule 2026-11-22, form (a): "<speaker> said:" (said, says, wrote, writes, told us), then the quote, also on the next line', () => {
  for (const s of [`Dana said: ${Q}`, `Dana says: ${Q}`, `Dana wrote: ${Q}`, `Dana writes: ${Q}`, `One customer told us: ${Q}`, `The CFO told us: ${Q}`,
    `Our team says: ${Q}`, `The product team said: ${Q}`, `**Dana** said: ${Q}`, `In March, the finance lead said: ${Q}`, `Dana, the finance lead, said: ${Q}`,
    `- Dana said: ${Q}`, `Dana said:\n${Q}`, `One customer told us:\n> ${Q}`, `Dana said:\n1. ${Q}`, `Intro. Then Dana said: ${Q}`]) {
    assert.deepEqual(said(s), ['Exports take forever, honestly'], s);
    assert.equal(quotesCheck(s, DANA_FILES).met, false, `a made-up named quote is caught: ${s}`);
  }
  assert.deepEqual(quotesCheck('Dana said: "I spend two hours every month copying invoices"', DANA_FILES), { met: true, value: 'Met' });
  assert.deepEqual(quotesIn('Dana said: "Exports slow."'), [], 'two words are never enough');
  assert.deepEqual(quotesIn(`In the long call with the whole finance team Dana said: ${Q}`), [], 'a speaker of more than four words from its clause start');
});

test('quote rule 2026-11-22, form (b): the quote, then ", <speaker> said" (or says, wrote, writes, told us)', () => {
  for (const s of ['"Exports take forever, honestly," Dana said.', '"Exports take forever, honestly", Dana says.', '"Exports take forever, honestly," the finance lead wrote.',
    '"Exports take forever, honestly," one customer told us.', '*"Exports take forever, honestly,"* Dana writes.']) {
    assert.deepEqual(said(s), ['Exports take forever, honestly'], s);
    assert.equal(quotesCheck(s, DANA_FILES).met, false, s);
  }
});

test('quote rule 2026-11-22, form (c): the quote, then an em or en dash and a speaker, with marks or a role; also on the next line', () => {
  for (const s of [`${Q} — Dana`, `${Q} – Dana`, `${Q} — **Dana**`, `${Q} — Dana.`, `${Q} — Product manager at Acme`, `${Q} — Dana, finance lead`,
    `${Q} — Finance lead`, `${Q} — Small business owner`, `${Q} — Operations lead, Acme`, `${Q} — Dana Ortiz, finance lead at Acme`, `${Q} — Finance team`,
    `*${Q}* — Dana`, `${Q}\n— Dana`, `> ${Q}\n> — **Dana**, finance lead`]) {
    assert.deepEqual(said(s), ['Exports take forever, honestly'], s);
    assert.equal(quotesCheck(s, DANA_FILES).met, false, `a made-up testimonial is caught: ${s}`);
  }
  assert.deepEqual(quotesIn('She said "yes" and “I export every month and it stops” — Dana.'), ['I export every month and it stops']);
});

test("quote rule 2026-11-22: the review's false fails are not checked: no modal + verb, no infinitive, no label, no bracket", () => {
  for (const s of ['The button should say: "Export all invoices now"', 'The button must say: "Export all invoices now"', 'It should say: "Export all invoices now"',
    'Screen 2 should say: "Export all invoices now"', 'The confirmation email should state: "Your export is ready to download"',
    'Banner copy to add: "Invoices now export to CSV"', 'Copy to add: "Invoices now export to CSV"', 'Microcopy to add:\n"No invoices for this month yet"',
    'Things to note: "Exports run every night at two"', 'Points to mention: "Exports run every night at two"', 'Copy to share: "Invoices now export to CSV files"',
    'Headline options to share:\n1. "Invoices, done in minutes"', 'We will add: "Export all invoices now"', '"Export all invoices now" is the label we add to the toolbar.',
    'Success states: "Your invoice was sent to the client"', 'Validation states: "Start date must be before end date"', '"Export all invoices now" (Toolbar)',
    '"Export all invoices now" (Optional)', '"No invoices for this month yet" (Desktop, toolbar)', '"Export all invoices now" (Figma, frame 12)',
    'Release notes: "Invoices now export to CSV"', 'Field reports: "Exports fail on Mondays sometimes"', 'Error: "Start date must be before end date"',
    '- "Export all invoices now"\n- Shown in the toolbar', '"Export all invoices now" - Primary CTA on the invoices page']) {
    assert.deepEqual(quotesIn(s), [], s);
    assert.deepEqual(quotesCheck(s, DANA_FILES), { met: true, value: 'No quotes' }, s);
  }
});

test('quote rule 2026-11-22: a screen word as the speaker names nobody (The button says:, — Button label)', async () => {
  const { UI_LABELS } = await import('../src/shared/workflow-tests/exact-checks.mjs');
  for (const w of ['Button', 'Error', 'Email', 'Label', 'Tooltip', 'Page']) assert.ok(UI_LABELS.includes(w), w);
  for (const s of ['The button says: "Export all invoices now"', 'The confirmation email says: "Your export is ready to download"',
    '"Export all invoices now" — Button label', '"Start date must be before end date" — Error shown under the picker', '"Export all invoices now," the button says.',
    '"No invoices for this month yet" — Invoices page, empty']) assert.deepEqual(quotesIn(s), [], s);
});

test('quote rule 2026-11-22: the known gaps (docs/workflow-tests.md): a short quote introduced any other way is not checked', () => {
  for (const s of [`Dana: ${Q}`, `**Dana:** ${Q}`, `A customer: ${Q}`, `${Q} (Dana, finance lead)`, `According to Dana, ${Q}`, `Users say: ${Q}`,
    `Dana noted: ${Q}`, `${Q} said Dana.`, `Dana said ${Q}`, `${Q} - Dana`, `${Q}\n— the finance lead`, `${Q}\n\n— Dana`]) assert.deepEqual(quotesIn(s), [], s);
});

test("quote rule 2026-11-22: a long quote is checked however it is introduced; Worca's planted made-up quote is caught by its length", () => {
  const planted = 'As one customer put it: "I would pay twice as much for this tomorrow."';
  assert.deepEqual(quotesIn(planted), ['I would pay twice as much for this tomorrow.']);
  assert.equal(quotesCheck(planted, DANA_FILES).met, false);
  assert.equal(quotesCheck(planted, BRIEF_FILES).met, false);
  assert.deepEqual(quotesIn('The page shows "one two three four five six seven eight" somewhere.').length, 1);
  assert.deepEqual(quotesIn('The page shows "one two three four five six seven" somewhere.'), []);
  assert.deepEqual(quotesIn('Totals "2026 2027 2028 2029 2030 2031 2032 2033" listed.'), [], 'digits alone do not make a long quote');
  const dana = 'Dana, the finance lead at a customer, said: "I spend two hours every month copying invoices into a spreadsheet."';
  assert.deepEqual(quotesCheck(dana, BRIEF_FILES), { met: true, value: 'Met' });
  assert.equal(quotesCheck(dana.replace('two hours', 'nine hours'), BRIEF_FILES).met, false);
});

test('round 6 review M1: a rate without a currency sign is a number; a range of two coded amounts keeps both', () => {
  assert.deepEqual(numbersIn('Price 12/user/month for 140 tickets.').map((x) => x.n), ['12', '140']);
  assert.equal(numbersCheck('Price 12/user/month for 140 tickets.', DANA_FILES).met, false);
  assert.deepEqual(numbersIn('Budget USD750-EUR800 for 140').map((x) => x.n), ['750', '800', '140']);
  assert.deepEqual(numbersIn('Notes in 2026/11/drafts and Invoice EUR2024-INV-0042 for 140 tickets.').map((x) => x.n), ['140'], 'round 6 M4 holds');
  assert.deepEqual(numbersIn('Pricing: $12/user/month, €19/seat/mo, a 30/60/90-day plan, USD5000.').map((x) => x.n), ['12', '19', '30', '60', '90', '5000']);
});

test('round 7 review M4: a screen word stops a speaker only when the speaker is one; a name or role that holds one is checked', () => {
  for (const s of [`${Q} — Larry Page`, `${Q} — Sally Field`, `${Q} — Field sales lead, Acme`, `${Q} — Field sales lead`, `${Q} — Email marketing lead`,
    `Our field team says: ${Q}`, `It says: ${Q}`, `The tagline says: ${Q}`]) {
    assert.deepEqual(said(s), ['Exports take forever, honestly'], s);
    assert.equal(quotesCheck(s, DANA_FILES).met, false, s);
  }
  for (const s of [`The button says: ${Q}`, `This button says: ${Q}`, `A banner says: ${Q}`, `The Button says: ${Q}`, `${Q} — Button label`,
    `${Q} — Button`, `${Q} — Error`, `${Q}, the button says.`, `The confirmation email says: ${Q}`, `${Q} — Invoices page, empty`]) assert.deepEqual(quotesIn(s), [], s);
});

test('round 7 review M5: in form (b), "which", "as" and "and" are not speakers', () => {
  for (const s of ['The banner reads "Invoices now export to CSV", which says it all.', 'Label the button "Export all invoices", as the brief says.',
    'The button reads "Export all invoices now", and the design says the same.']) assert.deepEqual(quotesIn(s), [], s);
  assert.deepEqual(said('"Exports take forever, honestly," Asa said.'), ['Exports take forever, honestly'], 'a name that starts like one is still a speaker');
});

test('round 7 review M6: a year-first path is not a rate; rates and number lists stay checked', () => {
  assert.deepEqual(numbersIn('Saved to 2026/reports/final for 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('See 2024/invoices/archive and 2025/exports/eu for 140 tickets.').map((x) => x.n), ['140']);
  assert.deepEqual(numbersIn('Pricing: $12/user/month, 12/user/month, €19/seat/mo, a 30/60/90-day plan.').map((x) => x.n), ['12', '12', '19', '30', '60', '90']);
  assert.deepEqual(numbersIn('Notes in 2026/11/drafts for 140 tickets.').map((x) => x.n), ['140']);
});

test('round 7 review M2: a known gap (docs/workflow-tests.md): a speaker with a role in brackets is not checked in forms (a) and (b)', () => {
  for (const s of [`Dana (finance lead) said: ${Q}`, `Dana Ortiz (finance lead) said: ${Q}`, '"Exports take forever, honestly," Dana (finance lead) said.'])
    assert.deepEqual(quotesIn(s), [], s);
  assert.deepEqual(said(`${Q} — Dana (finance lead)`), ['Exports take forever, honestly'], 'form (c) accepts it');
});

test('round 8 review M1: a screen word as an acronym, or in Title Case after an article or a modifier, names nobody; a personal name is checked', () => {
  for (const s of [`The main CTA says: ${Q}`, `${Q} — Primary CTA`, `The Primary Button says: ${Q}`, `${Q} — Primary Button`]) assert.deepEqual(quotesIn(s), [], s);
  assert.deepEqual(said(`${Q} — Larry Page`), ['Exports take forever, honestly']);
});

test('round 8 review M3: in form (b), "as" and "and" before a name are a speaker; before a lower-case word they are not', () => {
  for (const s of ['"Exports take forever, honestly," as Dana said.', '"Exports take forever, honestly," and Dana said.'])
    assert.deepEqual(said(s), ['Exports take forever, honestly'], s);
  assert.deepEqual(quotesIn('Label the button "Export all invoices", as the brief says.'), []);
});

test('round 8 review M5: a sign-less price starting with a year-like amount is a number; a year folder is not', () => {
  assert.deepEqual(numbersIn('Price 2000/user/year for 140 tickets.').map((x) => x.n), ['2000', '140']);
  assert.deepEqual(numbersIn('Saved to 2026/reports/final for 140 tickets.').map((x) => x.n), ['140']);
});
