// ui/routes/images/index.mjs — the images route areas per segment of ui/server.mjs, in the shape
// tools/split-by-feature.mjs v1 (#919) generates. ui/routes/index.mjs registers each list at its segment's barrier.
import * as m_images_images from './images.mjs';
export const SEGMENTS = Object.freeze([
  Object.freeze([]),   // before app.use('/api/automations', requireFlag('gitAutomations'));
  Object.freeze([m_images_images]),   // before app.use('/api/mcp', (req, res, next) => {
  Object.freeze([]),   // before app.use((req, res, next) => {
  Object.freeze([]),   // before app.use('/api/skills', (req, res, next) => {
  Object.freeze([]),   // before the SPA fallback
]);
