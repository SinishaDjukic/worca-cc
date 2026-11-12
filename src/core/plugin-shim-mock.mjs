// src/core/plugin-shim-mock.mjs
// WORCA_MOCK=1's canned task-source answers (plugin-shim.mjs loads this module only in mock mode, so a real call never does):
// listTasks and getTask for the offline smoke, A6's export ops (plans/requirements-a6-design.md §4, D19), A6.1's import ops
// (plans/requirements-a61-design.md §4, D18) and Ticket updates' ops (plans/ticket-updates-design.md D17), so the Requirements
// and Marketplace browser proofs run offline. Every name is made up.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

/** A token-shaped value for the redaction the import does (D15): built here so no source line looks like a real secret, and
 *  obviously fake ("ghp_FAKEFAKE…"). The redactor still hides it, as it would a real one. */
const FAKE_TOKEN = ['ghp', 'FAKE'.repeat(9)].join('_');

const MOCK_TASKS = [
  { id: 'MOCK-1', title: 'Fix the login redirect', url: 'https://mock.test/MOCK-1', state: 'open', labels: ['bug'], updatedAt: '2026-07-12T00:00:00.000Z' },
  { id: 'MOCK-2', title: 'Add CSV export to reports', url: 'https://mock.test/MOCK-2', state: 'open', labels: ['feature'], updatedAt: '2026-07-12T00:00:00.000Z' },
];
// A6 (plans/requirements-a6-design.md §4, D19): the export ops' canned answers, so the Requirements browser proof runs
// offline. Tickets are numbered <project>-123, -124, … in one sequence; the fingerprint is the description's sha256 and
// ticketState returns the last one written.
let mockTicketNo = 123;
const mockFingerprints = new Map();
export function resetMockTickets() { mockTicketNo = 123; mockFingerprints.clear(); }
const mockFingerprint = (text) => createHash('sha256').update(String(text ?? '')).digest('hex');
const mockUrl = (key) => `https://mock.test/browse/${key}`;
// Ticket updates (plans/ticket-updates-design.md D17): board 3's projects, board 4's CRM workflow (SHOP adds Resolved), and a
// reportResult that answers by its move, so the Marketplace section and its browser proof run offline.
const MOCK_PROJECTS = [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'], ['SUP', 'Support desk'],
  ['MKT', 'Marketing site'], ['DATA', 'Data platform']].map(([value, name]) => ({ value, label: `${name} (${value})`, name }));
function mockStatuses(project) {
  const done = [{ value: '10001', label: 'Done', category: 'done' }, { value: '10002', label: 'Released', category: 'done' },
    ...(project === 'SHOP' ? [{ value: '10012', label: 'Resolved', category: 'done' }] : [])];
  return [...done, { value: '3', label: 'In Progress', category: 'in_progress' },
    { value: '10003', label: 'Waiting for customer', category: 'in_progress' }, { value: '1', label: 'Open', category: 'todo' },
    { value: '10004', label: "Won't Fix", category: 'cancelled' }];
}
function mockReport(move) {
  if (move && move.category === 'done') return { moved: { from: 'In Progress', to: 'Done' }, note: 'Moved to Done.' };
  if (move && typeof move.status === 'string' && move.status) {
    const to = move.name || move.status;
    return { moved: { from: 'In Progress', to }, note: `Moved to ${to}.` };
  }
  return { moved: null, note: '' };
}
// A6.1 (plans/requirements-a61-design.md §4, D18): the import ops' canned answers, so the Requirements browser proof runs offline.
// People are made-up names. A download writes a tiny valid body to `dest`.
const MOCK_SEARCH = Object.freeze([
  { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', type: 'Story', status: 'In progress', updatedAt: '2026-10-25T12:00:00.000Z' },
  { key: 'SHOP-123', title: 'Cancel an order before it ships', type: 'Story', status: 'To do', updatedAt: '2026-10-26T12:00:00.000Z' },
  { key: 'SHOP-131', title: 'Cancel button hidden on the mobile order page', type: 'Bug', status: 'To do', updatedAt: '2026-10-24T12:00:00.000Z' },
  { key: 'SHOP-98', title: 'Refund to store credit after a cancel', type: 'Story', status: 'Done', updatedAt: '2026-10-12T12:00:00.000Z' },
]);
const MOCK_TICKET_DESCRIPTION = [
  'When an order has several items and some have already shipped, customers cannot cancel the rest. Support does it by hand today, about 40 tickets a month.',
  '', 'Customers should be able to cancel the items that have not been picked up yet, from their order history.', '', '(image: packing-slip.png)', '',
  '## Acceptance criteria', '',
  '- A customer can cancel the items of an order that have not been picked up.',
  '- Shipped items stay on the order and cannot be cancelled.',
  '- The refund covers only the cancelled items, including their share of the shipping cost.',
].join('\n');
const MOCK_COMMENTS = Object.freeze([
  ['10231', 'Ann Example', 'person', '2026-10-21T09:30:00.000Z', 'Warehouse confirms items are picked per parcel, not per item. A parcel with two items is picked up as one.'],
  ['10232', 'Bo Example', 'person', '2026-10-22T10:05:00.000Z', 'The payment provider supports partial refunds on cards and PayPal; invoiced orders need a credit note.'],
  ['10233', 'Ann Example', 'person', '2026-10-23T08:40:00.000Z', 'Finance wants the shipping share pro rata by item price.'],
  ['10234', 'Jira Automation', 'app', '2026-10-23T09:00:00.000Z', 'Status changed to In progress.'],
  ['10235', 'Cy Example', 'person', '2026-10-24T14:20:00.000Z', "Support's reply macro for partial cancels is attached (support-macro.txt). Customers ask most about when the refund arrives."],
  ['10236', 'Bo Example', 'person', '2026-10-25T11:10:00.000Z', `Sandbox for the refund API is ready; token ${FAKE_TOKEN}`],
].map(([id, author, authorKind, created, body]) => Object.freeze({ id, author, authorKind, created, body })));
const MOCK_ATTACHMENTS = Object.freeze([
  ['10041', 'packing-slip.png', 'image/png', 860160], ['10042', 'partial-cancel-flow.pdf', 'application/pdf', 1258291],
  ['10043', 'support-macro.txt', 'text/plain', 4096],
  ['10044', 'refund-matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 98304],
  ['10045', 'pick-route-scan.pdf', 'application/pdf', 32505856],
].map(([id, name, mime, bytes]) => Object.freeze({ id, name, mime, bytes, created: '2026-10-21T09:00:00.000Z' })));
const MOCK_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const mockBody = (name) => (/\.png$/i.test(name) ? MOCK_PNG : /\.pdf$/i.test(name) ? Buffer.from('%PDF-1.7\n% Worca mock\n') : Buffer.from(`Mock text of ${name}.\n`));
const mockPasted = (s) => {
  const t = String(s || '').trim();
  if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(t)) return t.toUpperCase();
  const m = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(t);
  return m ? m[1].toUpperCase() : null;
};
export const MOCK_DEFAULTS = {
  listTasks: () => ({ tasks: MOCK_TASKS.map((t) => ({ ...t })) }),
  getTask: (args) => ({
    ...MOCK_TASKS[0],
    id: args?.id || MOCK_TASKS[0].id,
    body: 'Mock task body.\n\n1. reproduce\n2. fix\n3. verify',
    meta: { mock: true },
  }),
  reportResult: (args = {}) => mockReport(args.move),
  validateConfig: () => ({ ok: true }),
  // Write-back stays on (what a missing capabilities op defaulted to before A6), the mock source can export and import, and it
  // answers Ticket updates' ops (D17).
  capabilities: () => ({ writeBack: true, export: true, import: true, ticketUpdates: true }),
  listProjects: () => MOCK_PROJECTS.map((p) => ({ ...p })),
  listStatuses: (args = {}) => mockStatuses(args.project),
  legacyMove: () => ({ field: 'transitionOnComplete', target: null }),
  exportOptions: (args = {}) => ({
    projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }],
    ...(args.project ? { issueTypes: [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }] } : {}),
    ...(args.project && args.issueType ? {
      priorities: [{ value: '1', label: 'Highest' }, { value: '2', label: 'High' }, { value: '3', label: 'Medium' }, { value: '4', label: 'Low' }],
      criteriaFields: [{ value: 'customfield_10070', label: 'Acceptance Criteria' }, { value: 'customfield_10071', label: 'Definition of Done' }],
    } : {}),
    doneStatus: 'Done',
  }),
  createTicket: (args = {}) => {
    const t = args.ticket || {};
    const key = `${t.project || 'MOCK'}-${mockTicketNo++}`;
    mockFingerprints.set(key, mockFingerprint(t.description));
    return { key, url: mockUrl(key), fingerprint: mockFingerprints.get(key) };
  },
  updateTicket: (args = {}) => {
    mockFingerprints.set(args.key, mockFingerprint(args.ticket && args.ticket.description));
    return { key: args.key, url: mockUrl(args.key), fingerprint: mockFingerprints.get(args.key) };
  },
  commentTicket: () => ({ ok: true }),
  ticketState: (args = {}) => ({ exists: true, url: mockUrl(args.key), fingerprint: mockFingerprints.get(args.key) ?? null }),
  findTicket: () => null,
  importOptions: () => ({ projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] }),
  searchTickets: (args = {}) => {
    const pasted = mockPasted(args.search);
    const words = pasted ? [] : String(args.search || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = MOCK_SEARCH.filter((t) => (pasted ? t.key === pasted
      : (!args.project || t.key.startsWith(`${args.project}-`)) && words.every((w) => t.title.toLowerCase().includes(w))))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { tickets: hits.map((t) => ({ ...t, url: mockUrl(t.key) })) };
  },
  importTicket: (args = {}) => {
    const key = String(args.key || '').toUpperCase();
    if (key === 'SHOP-999') return { gone: true };
    const known = MOCK_SEARCH.find((t) => t.key === key);
    const fp = mockFingerprint(MOCK_TICKET_DESCRIPTION);
    if (!mockFingerprints.has(key)) mockFingerprints.set(key, fp);   // A6's edited check compares with the import's fingerprint
    return {
      key, url: mockUrl(key), title: known ? known.title : MOCK_SEARCH[0].title, description: MOCK_TICKET_DESCRIPTION, criteria: null,
      comments: MOCK_COMMENTS.map((c) => ({ ...c })), commentsTotal: 7, restrictedComments: 1, attachments: MOCK_ATTACHMENTS.map((a) => ({ ...a })),
      meta: { project: key.split('-')[0], projectName: 'Shop web', type: known && known.type === 'Bug' ? { id: '10003', name: 'Bug' } : { id: '10001', name: 'Story' },
        status: known ? known.status : 'In progress', priority: { id: '3', name: 'Medium' } },
      fingerprint: fp,
    };
  },
  downloadAttachment: async (args = {}) => {
    const a = MOCK_ATTACHMENTS.find((x) => x.id === String(args.id));
    if (!a) return { gone: true };
    if (a.bytes > Number(args.maxBytes || Infinity)) return { tooLarge: true, bytes: a.bytes };
    const ms = Number(process.env.WORCA_MOCK_DOWNLOAD_MS) || 0;   // the browser proof sees Downloading… (A6.1 D18)
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const body = mockBody(a.name);
    writeFileSync(args.dest, body, { flag: 'wx', mode: 0o600 });
    return { name: a.name, mime: a.mime, bytes: body.length };
  },
};
