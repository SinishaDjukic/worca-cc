// api-asyncapi: AsyncAPI 2.x and 3.x documents (YAML or JSON, any file name).
// Direction is from the DESCRIBED APPLICATION's point of view (AsyncAPI spec text; spec §6.1):
//   2.x  channels.<name>.subscribe = "messages produced by the application"  → provides topic
//        channels.<name>.publish   = "messages consumed by the application"  → consumes topic
//   3.x  operations.<id>.action send → provides, receive → consumes; the topic is the
//        referenced channel's `address` (else the channel key)
import { splitLines, fact, blankComments, onePerKey, cleanUnresolved, clip } from './lib/text.mjs';
import { loadYaml, nodeAt, entries, yamlProblem, fileBudget } from './lib/yaml.mjs';
import { LIMITS } from '../../../shared/workspace-map/limits.mjs';

const GATE_RE = /(?:^|[{,])[ \t]*["']?asyncapi["']?[ \t]*:[ \t]*["']?[23]\./m;
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function detect({ rel, text }, ctx) {
  if (!GATE_RE.test(text)) return undefined;
  const lines = splitLines(text);
  const json = /\.json$/i.test(rel);
  const y = loadYaml(json ? blankComments(text, { slash: true, quotes: '"' }) : text, { json, maxBytes: LIMITS.MAX_FILE_BYTES });
  const facts = [];
  const walk = fileBudget(text); // ONE budget for every walk of this file: `channels` all aliasing one map stay linear
  const unresolved = [];
  const sent = { provides: new Set(), consumes: new Set() }; // AsyncAPI 3 topics already a fact (onePerKey keeps the first)
  for (const { doc, root, js } of y.docs) {
    const version = String(js?.asyncapi ?? '');
    if (!/^[23]\./.test(version)) continue;
    const channels = entries(doc, nodeAt(doc, root, ['channels'], walk), walk);
    if (version.startsWith('2.')) {
      for (const ch of channels) {
        const line = y.lineOf(ch.keyNode);
        for (const op of entries(doc, ch.value, walk)) {
          const dir = op.key === 'subscribe' ? 'provides' : op.key === 'publish' ? 'consumes' : null;
          if (!dir) continue;
          const opId = nodeAt(doc, op.value, ['operationId'], walk)?.value;
          facts.push(fact({ kind: 'topic', dir, key: ch.key, rel, lines, line, needle: ch.key, detail: ['AsyncAPI 2', op.key, opId && clip(opId, LIMITS.DETAIL_MAX)].filter(Boolean).join(' '), confidence: 'exact' }));
        }
      }
      continue;
    }
    const address = new Map();
    const chOfRef = new Map(); // $ref → its channel: a ref aliased by every operation is decoded once, never once per operation
    for (const ch of channels) {
      const a = nodeAt(doc, ch.value, ['address'], walk);
      address.set(ch.key, { name: typeof a?.value === 'string' ? a.value : ch.key, line: y.lineOf(a) || y.lineOf(ch.keyNode) });
    }
    for (const op of entries(doc, nodeAt(doc, root, ['operations'], walk), walk)) {
      const action = nodeAt(doc, op.value, ['action'], walk)?.value;
      const dir = action === 'send' ? 'provides' : action === 'receive' ? 'consumes' : null;
      const ref = nodeAt(doc, op.value, ['channel', '$ref'], walk)?.value;
      if (walk.n < 0) break; // the walk budget ran out: yamlProblem reports the cut once, never one item per operation
      if (typeof ref === 'string' && !chOfRef.has(ref)) {
        const chKey = decode(ref.replace(/^#\/channels\//, '')).replace(/~1/g, '/').replace(/~0/g, '~');
        chOfRef.set(ref, chKey ? address.get(chKey) ?? null : null);
      }
      const ch = typeof ref === 'string' ? chOfRef.get(ref) : null;
      if (!dir || !ch) {
        unresolved.push({ kind: 'topic', raw: `operations.${op.key}`, file: rel, line: y.lineOf(op.keyNode) || 1, reason: dir ? 'unresolved channel $ref' : 'unknown action' });
        continue;
      }
      if (sent[dir].has(ch.name)) continue; // one operation per topic builds its fact: a long address is never re-read per operation
      sent[dir].add(ch.name);
      facts.push(fact({ kind: 'topic', dir, key: ch.name, rel, lines, line: ch.line, needle: ch.name, detail: `AsyncAPI 3 ${action} ${op.key}`, confidence: 'exact' }));
    }
  }
  const problem = yamlProblem(y, walk);
  if (problem) unresolved.unshift({ kind: 'topic', raw: rel, file: rel, line: 1, reason: `parse error: ${problem}` });
  return { facts: onePerKey(facts), unresolved: cleanUnresolved(ctx?.state, rel, unresolved) };
}

export default Object.freeze({
  id: 'api-asyncapi',
  claims: (rel) => /\.(ya?ml|json)$/i.test(rel),
  detect,
});
