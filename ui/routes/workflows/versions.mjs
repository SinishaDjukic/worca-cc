// ui/routes/workflows/versions.mjs — feature "workflows": workflow versions and history (plans/workflow-tests-plan.md
// Part 1; #721 workflow part). Flag workflowTests. The routes live in src/core/workflow-versions-routes.mjs.
import { registerWorkflowVersionRoutes } from '../../../src/core/workflow-versions-routes.mjs';
import { AGENTS_DIR } from '../../server.mjs';

export function register(app) {
  registerWorkflowVersionRoutes(app, { agentsDir: AGENTS_DIR });
}
