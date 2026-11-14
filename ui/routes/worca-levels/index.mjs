// ui/routes/worca-levels/index.mjs — the worca-levels route areas per segment of ui/server.mjs, in source order.
// ui/routes/index.mjs registers each list at its segment's barrier.
import * as m_worca_levels_worca_level from './worca-level.mjs';
export const SEGMENTS = Object.freeze([
  Object.freeze([m_worca_levels_worca_level]),   // before app.use('/api/automations', requireFlag('gitAutomations'));
  Object.freeze([]),   // before app.use('/api/mcp', (req, res, next) => {
  Object.freeze([]),   // before app.use((req, res, next) => {
  Object.freeze([]),   // before app.use('/api/skills', (req, res, next) => {
  Object.freeze([]),   // before the SPA fallback
]);
