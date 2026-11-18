// ui/routes/sound/index.mjs — the sound route areas per segment of ui/server.mjs, in the shape
// tools/split-by-feature.mjs v1 (#919) generates. ui/routes/index.mjs registers each list at its segment's barrier.
import * as m_sound_sound from './sound.mjs';
export const SEGMENTS = Object.freeze([
  Object.freeze([]),   // before app.use('/api/automations', requireFlag('gitAutomations'));
  Object.freeze([m_sound_sound]),   // before app.use('/api/mcp', (req, res, next) => {
  Object.freeze([]),   // before app.use((req, res, next) => {
  Object.freeze([]),   // before app.use('/api/skills', (req, res, next) => {
  Object.freeze([]),   // before the SPA fallback
]);
