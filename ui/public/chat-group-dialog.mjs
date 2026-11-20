// ui/public/chat-group-dialog.mjs — the Chats column's group dialog: the shared group dialog (group-dialog.mjs) with the
// chat-group api. Kept so its callers stay as they are; folded away by the later cleanup PR.
import { openGroupDialog, GROUP_NAME_MAX } from './group-dialog.mjs';

export { GROUP_NAME_MAX };

/** The chat-group routes as the dialog's adapter. `api(method, path, body?, signal?)` answers parsed JSON or { error }. */
export const chatGroupAdapter = (api, ids) => ({
  suggest: (signal) => api('POST', '/api/ask/groups/suggest-name', { threadIds: ids }, signal),
  create: (body) => api('POST', '/api/ask/groups', { ...body, threadIds: ids }),
  rename: (id, body) => api('PATCH', `/api/ask/groups/${encodeURIComponent(id)}`, body),
});

export function openChatGroupDialog({ chats = [], api, ...rest }) {
  return openGroupDialog({ ...rest, count: chats.length, noun: 'chat', adapter: chatGroupAdapter(api, chats.map((c) => c.id)) });
}
