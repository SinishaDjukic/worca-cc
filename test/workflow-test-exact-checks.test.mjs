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
  assert.deepEqual(quotesCheck('Dana said “I would pay twice for this tomorrow.” and «exports are slow for all of us, said Dana»', FILES),
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
  assert.deepEqual(quotesIn('The 27" monitor.\r\n\r\nShe said "I export every month and it stops" ok'), ['I export every month and it stops']);
  assert.deepEqual(quotesIn('An open " mark.\r\n\r\nShe said "I export every month and it stops" ok'), ['I export every month and it stops']);
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
  assert.equal(quotesCheck('Dana said "I spend three hours every month".', BRIEF_FILES).met, false, 'a made-up named quote is still checked');
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

test('quote rule: checked only when a person is named next to it (3+ words) or when it is long (8+ words with a letter)', async () => {
  const { QUOTE_MIN_NAMED_WORDS, QUOTE_MIN_LONG_WORDS, SPEECH_VERBS } = await import('../src/shared/workflow-tests/exact-checks.mjs');
  assert.deepEqual([QUOTE_MIN_NAMED_WORDS, QUOTE_MIN_LONG_WORDS], [3, 8]);
  assert.ok(SPEECH_VERBS.includes('said') && SPEECH_VERBS.includes('put it'));
  // short and nobody named: not checked (real cases from a paid run)
  for (const s of ['"Choose a start and end date."', 'The hint: "Start date must be before end date"', 'It shows "Jan 1 to Jan 31" below.']) {
    assert.deepEqual(quotesIn(s), [], s);
    assert.deepEqual(quotesCheck(s, BRIEF_FILES), { met: true, value: 'No quotes' }, s);
  }
  // digits alone no longer make a long quote
  assert.deepEqual(quotesIn('Totals "2026 2027 2028 2029 2030 2031 2032 2033" listed.'), []);
  // named before the quote
  const dana = 'Dana, the finance lead at a customer, said: "I spend two hours every month copying invoices into a spreadsheet."';
  assert.deepEqual(quotesCheck(dana, BRIEF_FILES), { met: true, value: 'Met' });
  assert.equal(quotesCheck(dana.replace('two hours', 'nine hours'), BRIEF_FILES).met, false);
  assert.deepEqual(quotesIn('Dana (finance lead): "Exports take forever."'), ['Exports take forever.']);
  assert.deepEqual(quotesIn('Customer quote (Dana, finance lead at a customer): "Exports take forever."'), ['Exports take forever.']);
  // Worca's own planted made-up quote must still be caught
  const planted = 'As one customer put it: "I would pay twice as much for this tomorrow."';
  assert.equal(quotesCheck(planted, BRIEF_FILES).met, false);
  assert.equal(quotesCheck(planted, FILES).met, false);
  // short named quote is checked
  assert.deepEqual(quotesIn('Dana said: "Exports take forever."'), ['Exports take forever.']);
  assert.equal(quotesCheck('Dana said: "Exports take forever."', BRIEF_FILES).met, false);
  assert.deepEqual(quotesIn('Dana wrote "Exports take forever" today.'), ['Exports take forever']);
  // named after the quote
  for (const s of ['"Exports take forever," Dana said.', '"Exports take forever" said Dana.', '"Exports take forever" — Dana', '"Exports take forever", says the finance lead.']) {
    assert.deepEqual(quotesIn(s).length, 1, s);
  }
  // two words are never enough, named or not
  assert.deepEqual(quotesIn('Dana said: "Exports slow."'), []);
  // unnamed but long: 8+ words with a letter
  assert.deepEqual(quotesIn('The page shows "one two three four five six seven eight" somewhere.').length, 1);
  assert.deepEqual(quotesIn('The page shows "one two three four five six seven" somewhere.'), []);
  assert.equal(quotesCheck('The page reads "Pick the month you need to export here".', BRIEF_FILES).met, false);
});

// Fix round 5 (review of board 59, I4–I7 and M1). The cases are the review's own (r4rev\q.mjs, q2.mjs) and the paid brief's lines.
const DANA_FILES = 'Dana, the finance lead, said: "I spend two hours every month copying invoices into a spreadsheet." Target: 500 customers within 90 days. Tickets 140.';

test('fix round 5 (I4): a person named in markdown marks, after a short verb phrase, as a lowercase person or on the line next to it', () => {
  for (const s of ['**Dana:** "Exports take forever, honestly."', '**Dana (finance lead):** "Exports take forever, honestly."',
    '"Exports take forever, honestly." — **Dana**', '*"Exports take forever, honestly."* — Dana', '_"Exports take forever, honestly."_ — Dana',
    'One customer told us: "Exports take forever, honestly."', 'A customer: "Exports take forever, honestly."', 'Our users: "Exports take forever, honestly."',
    '> "Exports take forever, honestly."\n> — Dana, finance lead', '"Exports take forever, honestly."\n— the finance lead',
    'Dana said:\n"Exports take forever, honestly."', 'One customer told us:\n> "Exports take forever, honestly."']) {
    assert.deepEqual(quotesIn(s), ['Exports take forever, honestly.'], s);
    assert.equal(quotesCheck(s, DANA_FILES).met, false, `a made-up named quote is caught: ${s}`);
  }
  // The line next to it names nobody: still not checked.
  for (const s of ['Steps:\n"Exports take forever, honestly."', 'Shown first:\n"Exports take forever, honestly."', '"Exports take forever, honestly."\nThen the list.',
    '"Exports take forever, honestly."\n\n— Dana']) assert.deepEqual(quotesIn(s), [], s);
  assert.deepEqual(quotesCheck('**Dana:** "I spend two hours every month copying invoices"', DANA_FILES), { met: true, value: 'Met' });
});

test('fix round 5 (I7): a UI label before a colon, as the subject of a verb, or a lowercase word after a dash is not a person', async () => {
  const { UI_LABELS } = await import('../src/shared/workflow-tests/exact-checks.mjs');
  for (const w of ['Error', 'Hint', 'Title', 'Note', 'Warning', 'Label', 'Button', 'Message', 'Example', 'Tip', 'Status', 'Placeholder', 'Tooltip'])
    assert.ok(UI_LABELS.includes(w), w);
  for (const s of ['Error: "Start date must be before end date"', 'Hint: "Pick the month you need"', 'Tooltip: "Exports all invoices of the month"',
    'Title: "Export your invoices"', '**Error:** "Start date must be before end date"', 'Warning: "This cannot be undone"',
    'The error says "Start date must be before end date"', 'The button says: "Export all invoices now"', 'The tooltip reads "Exports all invoices of the month"',
    '"Choose a start and end date" — shown below the picker', 'Placeholder: "Search invoices by number"', 'Error Message: "Start date must be before end date"']) {
    assert.deepEqual(quotesIn(s), [], s);
    assert.deepEqual(quotesCheck(s, DANA_FILES), { met: true, value: 'No quotes' }, s);
  }
  // Real names keep working.
  for (const s of ['Dana: "Exports take forever, honestly."', 'Noah said: "Exports take forever, honestly."', '"Exports take forever, honestly." — Dana Ortiz',
    'Tim (support): "Exports take forever, honestly."']) assert.deepEqual(quotesIn(s), ['Exports take forever, honestly.'], s);
});

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
test('fix round 6 (I1): a list bullet or a screen label after a dash is not a speaker; a real name after a dash still is', async () => {
  const { UI_LABELS } = await import('../src/shared/workflow-tests/exact-checks.mjs');
  for (const w of ['State', 'Modal', 'Email', 'Subject', 'Subtitle', 'CTA', 'Tab', 'Badge', 'Card', 'Panel', 'Section', 'Notification', 'Header',
    'Footer', 'Column', 'Row', 'Option', 'Input']) assert.ok(UI_LABELS.includes(w), w);
  for (const s of ['- Empty state: "No invoices for this month yet"\n- Error: "Start date must be before end date"',
    '- Button: "Export all invoices"\n- Tooltip: "Exports every invoice of the month"', '- "Export all invoices now"\n- Shown in the toolbar',
    'The empty state says:\n"No invoices for this month yet"', '"Export all invoices now" — Button label', '"Export all invoices now" - Primary CTA on the invoices page',
    '"Start date must be before end date" — Error shown under the picker', 'The empty state says "No invoices for this month yet"',
    'The confirmation email says: "Your export is ready to download"', 'The modal says "Are you sure you want this"', 'The button then says "Export all invoices now"',
    'The CTA reads "Export all invoices now" and the subtitle says "Pick a month first"', 'Subtitle: "Pick a month first please"',
    '"Export all invoices now" — Shown in the toolbar']) {
    assert.deepEqual(quotesIn(s), [], s);
  }
  for (const s of ['"Exports take forever, honestly." — Dana', '"Exports take forever, honestly." — **Dana**', '"Exports take forever, honestly." - Dana',
    '"Exports take forever, honestly." — Dana Ortiz, finance lead', '"Exports take forever, honestly."\n— Dana', '"Exports take forever, honestly."\n-- Dana',
    '> "Exports take forever, honestly."\n> — **Dana**, finance lead']) assert.deepEqual(quotesIn(s), ['Exports take forever, honestly.'], s);
});

test('fix round 6 (I2): "According to Dana,", "Dana notes:", "(Dana, finance lead)" and "Dana noted." name a person', async () => {
  const { SPEECH_VERBS } = await import('../src/shared/workflow-tests/exact-checks.mjs');
  for (const v of ['note', 'notes', 'noted', 'state', 'states', 'stated', 'add', 'adds', 'added', 'explain', 'explains', 'explained', 'mention', 'mentions',
    'mentioned', 'share', 'shares', 'shared', 'report', 'reports', 'reported', 'comment', 'comments', 'commented', 'complain', 'complains', 'complained',
    'recall', 'recalls', 'recalled', 'ask', 'asks', 'asked', 'tell', 'tells', 'told', 'write', 'writes', 'wrote', 'say', 'says', 'said', 'put it']) {
    assert.ok(SPEECH_VERBS.includes(v), v);
  }
  for (const s of ['According to Dana, "Exports take forever, honestly."', "In Dana's words: \"Exports take forever, honestly.\"",
    'Dana notes: "Exports take forever, honestly."', 'Dana stated: "Exports take forever, honestly."', 'Dana adds: "Exports take forever, honestly."',
    'Dana explains: "Exports take forever, honestly."', '"Exports take forever, honestly." (Dana, finance lead)', '"Exports take forever, honestly." (Dana)',
    '"Exports take forever, honestly." (the finance lead)', '"Exports take forever, honestly," Dana noted.', '"Exports take forever, honestly," notes Dana.',
    'Dana said:\n1. "Exports take forever, honestly."', 'According to the finance lead, "Exports take forever, honestly."']) {
    assert.deepEqual(quotesIn(s).map((q) => q.replace(/[,.]$/, '')), ['Exports take forever, honestly'], s);
    assert.equal(quotesCheck(s, DANA_FILES).met, false, `a made-up named quote is caught: ${s}`);
  }
  // Not people: a screen word after "According to" or in brackets, a bracket that is no name, labels that only look like a verb.
  for (const s of ['According to the error message, "Start date must be before end date"', '"Export all invoices now" (Button label)',
    '"Export all invoices now" (Shown in the toolbar)', '"Export all invoices now" (Primary CTA)', 'Release notes: "Exports now run in the background"',
    'Meeting notes: "Exports now run in the background"', 'It states: "Exports now run in the background"']) assert.deepEqual(quotesIn(s), [], s);
});

test('fix round 6 (M2): an inch mark inside a quote does not close it when the real closing mark follows', () => {
  const s = 'Dana said: "We print every invoice on 8.5" paper and file it by hand." Then Lee said: "Exports are slow for us."';
  assert.deepEqual(quotesIn(s), ['We print every invoice on 8.5" paper and file it by hand.', 'Exports are slow for us.']);
  assert.deepEqual(quotesIn('Dana said: "We will switch vendors in 2026". Lee said: "I would pay double for this."'),
    ['We will switch vendors in 2026', 'I would pay double for this.'], 'round 5 M1 holds');
  assert.deepEqual(quotesIn('Dana said: "Our target is 500" and Lee said "Exports are slow for us."'), ['Our target is 500', 'Exports are slow for us.']);
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
