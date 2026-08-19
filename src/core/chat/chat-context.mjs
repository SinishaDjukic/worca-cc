// src/core/chat/chat-context.mjs
// Per-chat persisted state, ported from pre-1.0 integrations/chat_context.js.
// Keys are "platform:chatId"; state is {active_project, mute_until,
// muted_messages}. Atomic tmp+rename writes. Default storage lives at
// worcaHome()/chat-context.json (callers may inject a path for tests).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { worcaHome } from '../projects.mjs';

const SCHEMA_VERSION = 1;

const DEFAULT_CHAT_STATE = {
  active_project: null,
  mute_until: null,
  muted_messages: 0,
};

export function chatContextFile() {
  return join(worcaHome(), 'chat-context.json');
}

/**
 * @param {string} [filePath] absolute path (defaults to worcaHome()/chat-context.json)
 * @returns {{ get, set, isMuted, incrementMuted }}
 */
export function createChatContext(filePath = chatContextFile()) {
  const data = load(filePath);

  function get(chatKey) {
    return { ...DEFAULT_CHAT_STATE, ...data.chats[chatKey] };
  }

  function set(chatKey, patch) {
    data.chats[chatKey] = { ...DEFAULT_CHAT_STATE, ...data.chats[chatKey], ...patch };
    save(filePath, data);
  }

  function isMuted(chatKey) {
    const { mute_until } = get(chatKey);
    if (!mute_until) return false;
    return new Date(mute_until) > new Date();
  }

  function incrementMuted(chatKey) {
    const current = get(chatKey);
    set(chatKey, { muted_messages: current.muted_messages + 1 });
  }

  return { get, set, isMuted, incrementMuted };
}

function load(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (raw && typeof raw === 'object' && raw.chats && typeof raw.chats === 'object') return raw;
  } catch { /* missing or invalid — start fresh */ }
  return { schema_version: SCHEMA_VERSION, chats: {} };
}

function save(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, filePath);
}
