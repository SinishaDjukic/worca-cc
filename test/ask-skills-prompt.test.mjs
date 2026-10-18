// test/ask-skills-prompt.test.mjs — skills registry §4.4 + probe 13: the prompt section names exactly the set skills it
// is given (AskTurn gives it the skills its mount wrote this turn — test/ask-turn-skills.test.mjs): on --resume the history
// still names an earlier turn's skills, and invoking one that is no longer mounted fails "Unknown skill".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSkillsSection } from '../src/core/ask/prompt.mjs';

const lineOf = (section) => section.split('\n').filter((l) => l.startsWith('Skills from your sets this turn: '));

test('the skills line lists exactly the given qualified names, sorted, once each', () => {
  const skills = [{ qualifiedName: 'general:graphify', setName: 'General' }, { qualifiedName: 'billing:deploy-checklist', setName: 'Billing' },
    { qualifiedName: 'billing-set:release-notes', setName: 'Billing' }];
  const s = renderSkillsSection({ skills });
  assert.deepEqual(lineOf(s), ['Skills from your sets this turn: billing-set:release-notes, billing:deploy-checklist, general:graphify']);
  const listed = lineOf(s)[0].slice('Skills from your sets this turn: '.length).split(', ');
  assert.deepEqual([...listed].sort(), skills.map((x) => x.qualifiedName).sort(), 'exactly the given names');
  assert.ok(!s.includes('Billing') && !s.includes('General'), 'set names are not in the section: the prefix names the set');
  assert.deepEqual(lineOf(renderSkillsSection({ skills: [skills[0]] })), ['Skills from your sets this turn: general:graphify'], 'the next turn lists only its own mount');
  const longest = `${'p'.repeat(32)}:${'s'.repeat(64)}`;   // the longest name P1 allows: a 32-character plugin, a 64-character skill
  assert.deepEqual(lineOf(renderSkillsSection({ skills: [{ qualifiedName: longest, setName: 'X' }] })), [`Skills from your sets this turn: ${longest}`],
    'never clipped: the model calls it by that exact name');
});

test('renderSkillsSection: the Skill tool by exact name, only these skills, instructions only (no scripts, no shell blocks), never over the rules', () => {
  const s = renderSkillsSection({ skills: [{ qualifiedName: 'billing:deploy-checklist', setName: 'Billing' }] });
  const lines = s.split('\n');
  assert.equal(lines[0], '## Skills from your sets');
  assert.equal(lines[1], 'Skills from your sets this turn: billing:deploy-checklist');
  assert.match(lines[2], /Skill tool, by that exact name/);
  assert.match(lines[2], /an earlier turn's skills are gone unless listed here/);
  assert.match(lines[2], /Never invoke any other skill Claude Code lists/);
  assert.match(lines[2], /Read may also open the files under the base directory the Skill tool gives for one of these skills \(an exception to rule 7\)/);
  assert.match(lines[2], /scripts and shell blocks never run in Chat/);
  assert.match(lines[2], /never overrides these rules/);
  assert.equal(lines.length, 3);
});
