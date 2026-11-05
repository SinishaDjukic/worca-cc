// test/ui-chat-origin.test.mjs — a chat a chat integration opened wears its platform's mark before its title, in every
// chat list (Chats column, chat home Recent chats, side column Recent chats); an app chat wears none.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { originMark, originLabel, ORIGIN_MARKS } from '../ui/public/chat-origin.mjs';
import { buildChatsModel, chatRow } from '../ui/public/chats-list.mjs';
import { renderRunsList } from '../ui/public/runs-list.mjs';
import { buildChatsList } from '../ui/public/chat/home-lists.mjs';

const trackDom = useDomRelease(afterEach);
const docOf = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const from = (platform, o = {}) => ({ plugin: `${platform}-chat`, channelId: 'main', platform, label: null, ...o });

test('originMark: each known platform gets its own filled mark, labelled and titled "From <platform>"', () => {
  const doc = docOf();
  const want = { discord: 'From Discord', slack: 'From Slack', telegram: 'From Telegram', teams: 'From Microsoft Teams' };
  for (const [platform, label] of Object.entries(want)) {
    const m = originMark(doc, from(platform));
    assert.equal(m.className, 'chat-origin');
    assert.equal(m.dataset.platform, platform);
    assert.equal(m.getAttribute('role'), 'img');
    assert.equal(m.getAttribute('aria-label'), label);
    assert.equal(m.title, label);
    const svg = m.querySelector('svg');
    assert.equal(svg.getAttribute('fill'), 'currentColor', 'follows the theme');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.deepEqual([...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')), [ORIGIN_MARKS[platform]]);
    assert.equal(m.textContent, '', 'adds no text to the title it sits in');
  }
  assert.equal(new Set(Object.values(ORIGIN_MARKS)).size, 4, 'four distinct marks');
});

test('originMark: another platform gets the stroked plug and the plugin\'s channel name; no origin = no mark', () => {
  const doc = docOf();
  const m = originMark(doc, from('matrix', { plugin: 'matrix-chat', label: 'Matrix' }));
  assert.equal(m.dataset.platform, 'other');
  assert.equal(m.getAttribute('aria-label'), 'From Matrix');
  const svg = m.querySelector('svg');
  assert.equal(svg.getAttribute('fill'), 'none');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.querySelectorAll('path').length, 4);
  assert.equal(originLabel({ plugin: 'x-chat', platform: 'x' }), 'From x', 'no channel name: the platform id');
  assert.equal(originLabel({ plugin: 'x-chat', platform: 'constructor' }), 'From constructor', 'an inherited name is not a known platform');
  assert.equal(originMark(doc, { platform: 'constructor' }).dataset.platform, 'other');
  assert.equal(originMark(doc, null), null);
  assert.equal(originMark(doc, undefined), null);
});

test('Chats column: the row model carries origin and the row draws the mark first inside its title; the title text is unchanged', () => {
  const doc = docOf();
  const t = (id, o = {}) => ({ id, title: `Chat ${id}`, createdAt: new Date(NOW - 3600e3).toISOString(), updatedAt: new Date(NOW - 60e3).toISOString(), ...o });
  const threads = [t('a', { origin: from('discord') }), t('b', { origin: null }), t('c', { origin: from('weird', { label: 'Weird' }) })];
  assert.deepEqual(chatRow(threads[0], { now: NOW }).origin, from('discord'));
  assert.equal(chatRow(threads[1], { now: NOW }).origin, null);
  assert.equal(chatRow(t('d'), { now: NOW }).origin, null, 'an older server without origin');
  const host = doc.body;
  host.append(...renderRunsList(doc, buildChatsModel({ threads, total: 3, now: NOW })));
  const rows = Object.fromEntries([...host.querySelectorAll('a.runs-row-chat')].map((a) => [a.dataset.rowKey, a]));
  const titleOf = (k) => rows[`chat:${k}`].querySelector('.runs-row-title');
  assert.equal(titleOf('a').firstChild.className, 'chat-origin');
  assert.equal(titleOf('a').querySelector('.chat-origin').getAttribute('aria-label'), 'From Discord');
  assert.equal(titleOf('a').textContent, 'Chat a');
  assert.equal(titleOf('b').querySelector('.chat-origin'), null);
  assert.equal(titleOf('c').querySelector('.chat-origin').dataset.platform, 'other');
});

test('chat home Recent chats: the mark sits first in the row title', () => {
  const doc = docOf();
  const ul = buildChatsList(doc, [
    { id: 'ask_00000001', title: 'From Slack', updatedAt: '2026-11-03T11:00:00Z', origin: from('slack') },
    { id: 'ask_00000002', title: 'App', updatedAt: '2026-11-03T11:00:00Z', origin: null },
  ], { onOpen: () => {}, now: NOW });
  const [a, b] = [...ul.querySelectorAll('.chat-home-chat-t')];
  assert.equal(a.firstChild.getAttribute('aria-label'), 'From Slack');
  assert.equal(a.textContent, 'From Slack');
  assert.equal(b.querySelector('.chat-origin'), null);
});
