// test/requirements-markdown-note.test.mjs — the per-run note in the task a run starts from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { renderSpecMarkdown, renderTaskMarkdown, TASK_PREAMBLE } from '../src/core/requirements/markdown.mjs';

const feature = {
  seq: 7, id: 'FEAT-7', title: 'Cancel an order', description: 'Before it ships', status: 'done',
  spec: { ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' },
    criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }] },
};
const PRECEDENCE = 'Where these instructions conflict with the spec above, follow these instructions for this run.';
const today = () => {
  const lines = renderSpecMarkdown(feature, { targetName: 'shop' }).split('\n');
  lines[0] = '# FEAT-7 v2: Cancel an order';
  return `${TASK_PREAMBLE}\n\n${lines.join('\n')}`;
};
const render = (note) => renderTaskMarkdown(feature, { spec: feature.spec, targetName: 'shop', version: 2, ...(note === undefined ? {} : { note }) });

test('no note, an empty note and a blank note render exactly today\'s task', () => {
  assert.equal(render(), today());
  assert.equal(render(''), today());
  assert.equal(render('   \n '), today());
  assert.equal(render(null), today());
});

test('a note is appended after the spec as the last section, verbatim, then the precedence line', () => {
  const note = 'Use the v2 API.\nKeep the old route.';
  const md = render(note);
  assert.equal(md, `${today()}\n## Extra instructions for this run\n\n${note}\n\n${PRECEDENCE}\n`);
  assert.ok(md.indexOf('## Description, as first given') < md.indexOf('## Extra instructions for this run'));
  assert.ok(md.endsWith(`${PRECEDENCE}\n`));
});
