import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChecklist, scanChecklists } from '../src/shared/shape/checklist.mjs';

test('extractChecklist reads ids, perspectives and text; malformed and duplicate ids are reported', () => {
  const md = '## Testing\n### Checklist\n- [ ] R-qa-1 Rejects an unknown metric.\n- [ ] R-qa-1 Again.\n- [ ] R-zz-1 Who.\n- [ ] qa-2 No R.\n## Out of scope\n- [ ] R-qa-9 Not in a checklist.\n';
  assert.deepEqual(extractChecklist(md), [{ id: 'R-qa-1', perspective: 'qa', text: 'Rejects an unknown metric.' }]);
  assert.deepEqual(scanChecklists(md).malformed.map((x) => x.why), ['duplicate id R-qa-1', 'bad id R-zz-1', 'bad id qa-2']);
});
