// ui/routes/prompt-check/index.mjs — the prompt-check route areas per segment of ui/server.mjs, in source order.
// ui/routes/index.mjs registers each list at its segment's barrier.
import * as m_prompt_check_grade_route from './grade-route.mjs';
export const SEGMENTS = Object.freeze([
  Object.freeze([m_prompt_check_grade_route]),   // before app.use('/api/automations', requireFlag('gitAutomations'));
  Object.freeze([]),   // before app.use('/api/mcp', (req, res, next) => {
  Object.freeze([]),   // before app.use((req, res, next) => {
  Object.freeze([]),   // before app.use('/api/skills', (req, res, next) => {
  Object.freeze([]),   // before the SPA fallback
]);
