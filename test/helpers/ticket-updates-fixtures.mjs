// test/helpers/ticket-updates-fixtures.mjs — Ticket updates' screen data (plans/ticket-updates-design.md boards 1–5) as the routes
// answer it: the GET answers, board 3's projects, board 4's statuses; for the jsdom section and manage-sheet tests.
import { ok } from './marketplace-sheet-harness.mjs';

export const TU = '/api/plugins/jira-source/ticket-updates';
export const TU_Q = '?sourceId=jira&profile=acme';
export const PROJECTS = [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'], ['SUP', 'Support desk'], ['MKT', 'Marketing site'],
  ['DATA', 'Data platform']].map(([value, name]) => ({ value, label: `${name} (${value})`, name }));
export const CRM_STATUSES = [{ value: '10001', label: 'Done', category: 'done' }, { value: '10002', label: 'Released', category: 'done' },
  { value: '3', label: 'In Progress', category: 'in_progress' }, { value: '10003', label: 'Waiting for customer', category: 'in_progress' },
  { value: '1', label: 'Open', category: 'todo' }, { value: '10004', label: "Won't Fix", category: 'cancelled' }];
export const SHOP_STATUSES = [...CRM_STATUSES.slice(0, 2), { value: '10012', label: 'Resolved', category: 'done' }, ...CRM_STATUSES.slice(2)];
export const RESOLVED = { kind: 'status', value: '10012', label: 'Resolved', category: 'done' };
export const LEGACY = { field: 'transitionOnComplete', label: 'Transition on completion', target: null };
export const ALL_DONE = { project: '', moment: 'finished', target: { kind: 'category', value: 'done' } };
export const SHOP_RULE = { project: 'SHOP', label: 'Shop', moment: 'finished', target: RESOLVED };
export const tuGet = (over = {}) => ({ available: true, connection: 'saved', profile: { id: 'acme', label: 'Acme' }, saved: false, projects: [], rules: [],
  legacy: LEGACY, ...over });
export const SAVED = tuGet({ saved: true, projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }],
  rules: [ALL_DONE, SHOP_RULE, { project: 'CRM', label: 'Customer portal', moment: 'finished', target: { kind: 'none' } }] });
/** The harness routes for one profile (acme): the GET answer, the projects, each project's statuses; `more` overrides. */
export function tuRoutes(get = SAVED, more = {}) {
  const r = { [`GET ${TU}${TU_Q}`]: ok(get), [`GET ${TU}/projects${TU_Q}`]: ok({ projects: PROJECTS }) };
  for (const p of PROJECTS) r[`GET ${TU}/statuses${TU_Q}&project=${p.value}`] = ok({ statuses: p.value === 'SHOP' ? SHOP_STATUSES : CRM_STATUSES });
  return { ...r, ...more };
}
