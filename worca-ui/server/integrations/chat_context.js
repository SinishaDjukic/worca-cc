import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;

const DEFAULT_CHAT_STATE = {
  active_project: null,
  mute_until: null,
  muted_messages: 0,
};

/**
 * @param {string} filePath  absolute path to chat_context.json
 * @returns {{ get, set, isMuted, incrementMuted }}
 */
export function createChatContext(filePath) {
  const data = _load(filePath);

  function get(chatKey) {
    return { ...DEFAULT_CHAT_STATE, ...data.chats[chatKey] };
  }

  function set(chatKey, patch) {
    data.chats[chatKey] = {
      ...DEFAULT_CHAT_STATE,
      ...data.chats[chatKey],
      ...patch,
    };
    _save(filePath, data);
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

function _load(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (
      raw &&
      typeof raw === 'object' &&
      raw.chats &&
      typeof raw.chats === 'object'
    ) {
      return raw;
    }
  } catch {
    // file missing or invalid — start fresh
  }
  return { schema_version: SCHEMA_VERSION, chats: {} };
}

function _save(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, filePath);
}
