// Suggested run title for the attached features. Pure.

/** @param {{title: string}[]} items */
export function suggestTitle(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const [first, ...rest] = items;
  const head = first.title || first.id || `FEAT-${first.seq}`;
  return rest.length === 0 ? head : `${head} + ${rest.length} more`;
}
