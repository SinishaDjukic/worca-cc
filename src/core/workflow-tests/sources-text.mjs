// src/core/workflow-tests/sources-text.mjs — D93: what the exact checks and the judge's context read as "the files": the example's
// request, the answers it gives Worca, and its files that are UTF-8 text (a picture or a PDF is skipped).
import { readExampleFiles } from './store.mjs';

const DECODER = new TextDecoder('utf-8', { fatal: true });
export function exampleSourcesText(example, { readFiles = readExampleFiles } = {}) {
  const parts = [example.request || '', ...(example.answers || []).map((a) => `${a.question}\n${a.answer}`)];
  for (const f of readFiles(example.id)) { try { parts.push(DECODER.decode(f.data)); } catch { /* not text */ } }
  return parts.filter((p) => p !== '').join('\n\n');
}
