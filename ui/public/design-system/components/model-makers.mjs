// Models by who makes them (docs/rail/components.md comp.menu-sub): the model picker lists makers first, each maker's models
// in its sub-menu. A row's maker comes from its own id, label and engine; a row off its maker's own engine names its engine.
// Shared logic: no DOM, no fetch.

/** Who makes models, in the order the picker lists them, each with the engine that is its own. */
export const MAKERS = Object.freeze([
  Object.freeze({ id: 'anthropic', name: 'Anthropic', engine: 'claude' }),
  Object.freeze({ id: 'openai', name: 'OpenAI', engine: 'codex' }),
  Object.freeze({ id: 'google', name: 'Google', engine: 'gemini' }),
  Object.freeze({ id: 'local', name: 'Local', engine: 'qwen' }),
  Object.freeze({ id: 'other', name: 'Other', engine: null }),
]);

/** What each engine reads as; an unknown engine reads as its raw id. */
export const ENGINE_WORDS = Object.freeze({ claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', qwen: 'Qwen Code', copilot: 'Copilot' });

// the first rule that matches the id wins; then the engine; then Other
const BY_ID = [
  ['anthropic', /^(anthropic\/|claude|opus|sonnet|haiku|fable)/],
  ['openai', /^(openai\/|gpt|o[1-9]|codex|chatgpt)/],
  ['google', /^(google\/|gemini|gemma)/],
  ['local', /^(ollama\/|lmstudio\/|local\/|qwen)/],
];
const BY_ENGINE = { qwen: 'local', codex: 'openai', gemini: 'google' };
const engineOf = (row) => row?.engine || 'claude';

/**
 * @param {{ id?: string, label?: string, engine?: string }} row  a /api/ask/models row; no engine means claude
 * @returns {'anthropic'|'openai'|'google'|'local'|'other'}
 */
export function makerOf(row) {
  if (typeof row?.id !== 'string') return 'other';
  const id = row.id.toLowerCase().replace(/^copilot\//, '');
  const hit = BY_ID.find(([, re]) => re.test(id));
  return hit ? hit[0] : BY_ENGINE[engineOf(row)] || 'other';
}

/** The words a row reads as: its label, without `Claude ` under Anthropic, and its engine when that is not its maker's own. */
export function modelText(row) {
  const maker = makerOf(row), engine = engineOf(row);
  const name = String(row?.label || row?.id || '');
  const text = maker === 'anthropic' ? name.replace(/^Claude /, '') : name;
  return engine === MAKERS.find((m) => m.id === maker).engine ? text : `${text} · ${ENGINE_WORDS[engine] || engine}`;
}

/**
 * The catalog grouped by maker: non-empty makers in MAKERS order, each maker's rows in catalog order.
 * @param {object[]} rows
 * @param {{ chosen?: string }} [o]  the chosen row's id
 * @returns {{ id: string, name: string, items: { id: string, text: string, checked: boolean }[] }[]}
 */
export function modelMakers(rows, { chosen = '' } = {}) {
  const by = new Map(MAKERS.map((m) => [m.id, []]));
  for (const row of rows || []) {
    if (typeof row?.id !== 'string') continue;
    by.get(makerOf(row)).push({ id: row.id, text: modelText(row), checked: row.id === chosen });
  }
  return MAKERS.filter((m) => by.get(m.id).length).map((m) => ({ id: m.id, name: m.name, items: by.get(m.id) }));
}

/** What the picker passes to CompactMenu: one maker lists flat under its name; several open as sub-menus. */
export function makerItems(rows, { chosen = '' } = {}) {
  const groups = modelMakers(rows, { chosen });
  if (groups.length === 1) return [{ header: groups[0].name }, ...groups[0].items];
  return groups.map((g) => ({ id: g.id, text: g.name, sub: g.items }));
}
