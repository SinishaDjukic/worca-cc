// src/core/setup/slot-checks.mjs — the catalog checks setup apply runs on an asserted modelRoles / askModels patch.
import { listModels, assertSlotModels } from '../config.mjs';

/** Rewrite each pair's model to the catalog's canonical id (A8), so every consumer matches the same spelling; a
 *  pending id keeps the spelling its import will write. Mutates the pairs. */
export async function canonicaliseModelIds(pairs, pending = []) {
  const list = pairs.filter((v) => v && v.model);
  if (!list.length) return;
  const models = await listModels('');
  for (const value of list) {
    const lc = value.model.toLowerCase();
    const hit = models.find((m) => m?.id?.toLowerCase() === lc) || pending.find((p) => p.id.toLowerCase() === lc);
    if (hit) value.model = hit.id;
  }
}

/** Setup apply's catalog check on an asserted askModels patch: POST /api/settings' check (model, harness and the
 *  catalog row's efforts), plus the pending ids of this apply's imports; ids are canonicalised like the roles'. */
export async function checkAskModelsPatch(patch, { pending = [] } = {}) {
  const items = Object.entries(patch).filter(([, value]) => value).map(([engine, value]) => ({ id: `askModels.${engine}`, engine, value }));
  await assertSlotModels(items, { pending });
  await canonicaliseModelIds(items.map((i) => i.value), pending);
  return patch;
}
