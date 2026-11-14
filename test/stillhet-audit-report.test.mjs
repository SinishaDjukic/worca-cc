// test/stillhet-audit-report.test.mjs — the feature 1 fidelity audit (plans/rail/audit-feature-1.md) keeps its shape: 7 areas,
// each with the 3 cells (Expert; dark 1280, light 1280, light 360), a first score and a re-score from 0 to 10 and a re-score
// screenshot that exists; a re-score below 9 names an Open row of plans/rail/findings.md; the Chat section names every
// "Every dev chat card" row of plans/rail/stillhet-wiring.md; the Tasks section names c17, c18 and the group page.
// The scores are a judgement: this pins only their shape and the 9 rule, the evidence is the pairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const doc = read('plans/rail/audit-feature-1.md');
const AREAS = ['Shell bar and top bar', 'Pulse', 'Bell', 'Profile menu', 'Chat', 'Tasks', 'Settings › Labs and opt-out'];
const CELLS = ['dark 1280', 'light 1280', 'light 360'];
/** `## Area: NAME` sections: [name, body]. */
const sections = () => doc.split(/\n(?=## Area: )/).slice(1).map((s) => { const nl = s.indexOf('\n'); return [s.slice('## Area: '.length, nl).trim(), s.slice(nl)]; });
const cellsOf = (body) => body.split('\n').filter((l) => /^\| (dark|light) \d+ \|/.test(l)).map((l) => l.slice(1, l.lastIndexOf('|')).split(' | ').map((c) => c.trim()));
function openFindings() {
  const f = read('plans/rail/findings.md'), at = f.indexOf('\n## Open\n'), next = f.indexOf('\n## ', at + 1);
  return f.slice(at, next).split('\n').filter((l) => /^\|/.test(l)).slice(2).map((l) => l.split(' | ')[2]);
}

test('exactly the 7 areas, in order', () => {
  assert.deepEqual(sections().map(([n]) => n), AREAS);
});

test('each area: the 3 cells, a first score and a re-score from 0 to 10, a re-score screenshot that exists', () => {
  for (const [name, body] of sections()) {
    const cells = cellsOf(body);
    assert.deepEqual(cells.map((c) => c[0]), CELLS, name);
    for (const [cell, first, again, shot] of cells) {
      for (const s of [first, again]) assert.ok(/^(10|\d)$/.test(s), `${name} ${cell}: a score 0–10, not ${s}`);
      const path = /^`(out\/stillhet-audit\/feature-1\/[\w.-]+\.png)`$/.exec(shot)?.[1];
      assert.ok(path, `${name} ${cell}: a screenshot under out/stillhet-audit/feature-1/`);
      assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} exists`);
    }
    assert.match(body, /\nReasons: \S/, `${name}: its reasons`);
  }
});

test('a re-score below 9 names an Open row of the findings ledger', () => {
  const open = openFindings();
  for (const [name, body] of sections()) {
    if (cellsOf(body).every((c) => +c[2] >= 9)) continue;
    const row = /\nOpen row: (.+)/.exec(body)?.[1]?.trim();
    assert.ok(row, `${name}: a re-score below 9 names its Open row`);
    assert.ok(open.some((f) => f.includes(row)), `${name}: "${row}" is an Open row of plans/rail/findings.md`);
  }
});

test('coverage: the Chat section names every dev chat card row; the Tasks section names c17, c18 and the group page', () => {
  const w = read('plans/rail/stillhet-wiring.md'), at = w.indexOf('### Every dev chat card'), end = w.indexOf('\n### ', at + 1);
  const cards = w.slice(at, end).split('\n').filter((l) => /^\| /.test(l)).slice(2).map((l) => l.split(' | ')[0].slice(2).trim());
  assert.ok(cards.length >= 15, 'the inventory is read');
  const chat = sections().find(([n]) => n === 'Chat')[1], tasks = sections().find(([n]) => n === 'Tasks')[1];
  for (const c of cards) assert.ok(chat.includes(`| ${c} |`), `Chat names the "${c}" card`);
  for (const t of ['c17', 'c18', 'group page']) assert.ok(tasks.includes(t), `Tasks names ${t}`);
});
