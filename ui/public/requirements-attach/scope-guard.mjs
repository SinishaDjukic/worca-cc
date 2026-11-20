// Guards a person-initiated scope change so attached features are never
// removed before the person has answered. Pure: the modal is injected as `ask`.

/**
 * @param {object} deps
 * @param {{get: () => {items: unknown[]}, clear: () => void}} deps.store
 * @param {() => void} deps.apply   performs the scope change
 * @param {() => void} deps.revert  restores the previous scope selection
 * @param {() => Promise<'remove'|'cancel'>} deps.ask  resolves the person's answer
 * @param {() => boolean} [deps.skip]  true when the change cannot move the features out of their scope: apply without asking
 * @returns {Promise<'applied'|'cancelled'>}
 */
export async function guardScopeChange({ store, apply, revert, ask, skip = () => false }) {
  if (store.get().items.length === 0 || skip()) {
    apply();
    return 'applied';
  }
  const answer = await ask();
  if (answer === 'remove') {
    store.clear();
    apply();
    return 'applied';
  }
  revert();
  return 'cancelled';
}
