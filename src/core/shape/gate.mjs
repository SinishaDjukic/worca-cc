// src/core/shape/gate.mjs — the ONE server gate for Shape it first (spec D12). Every server call site asks
// shapeFirstEnabled()/requireShapeFirst(), never the flag itself. The switch is the beta feature flag in
// src/shared/flags/registry.mjs (docs/feature-flags.md), on by default: turned off in Settings › Labs, or with
// WORCA_FLAGS. Read fresh on every call, so turning it on or off needs no restart.
import { flagEnabled } from '../flags.mjs';

export function shapeFirstEnabled() {
  return flagEnabled('shapeFirst');
}

/** Route guard: `if (!requireShapeFirst(req, res)) return;` — answers 404 while the gate is off. */
export function requireShapeFirst(req, res) {
  if (shapeFirstEnabled()) return true;
  res.status(404).json({ error: 'not found' });
  return false;
}
