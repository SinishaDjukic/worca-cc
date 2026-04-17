import { describe, expect, it } from 'vitest';
import { parseCommand } from './parser.js';

describe('parseCommand', () => {
  it('returns null for empty text', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  it('returns null for plain text with no command', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('@bot hello')).toBeNull();
  });

  it('parses /status with no args', () => {
    const result = parseCommand('/status');
    expect(result).toEqual({ command: 'status', args: [] });
  });

  it('parses /status W-042 → ("status", ["W-042"])', () => {
    const result = parseCommand('/status W-042');
    expect(result).toEqual({ command: 'status', args: ['W-042'] });
  });

  it('parses /runs with numeric arg', () => {
    expect(parseCommand('/runs 5')).toEqual({ command: 'runs', args: ['5'] });
  });

  it('parses /use with project name', () => {
    expect(parseCommand('/use my-project')).toEqual({
      command: 'use',
      args: ['my-project'],
    });
  });

  it('strips @bot mention before command: @bot /status → ("status", [])', () => {
    expect(parseCommand('@bot /status')).toEqual({
      command: 'status',
      args: [],
    });
  });

  it('strips @bot mention and preserves args: @bot /status W-042', () => {
    expect(parseCommand('@bot /status W-042')).toEqual({
      command: 'status',
      args: ['W-042'],
    });
  });

  it('strips @BotName mention (case-insensitive handle)', () => {
    expect(parseCommand('@WorcaBot /help')).toEqual({
      command: 'help',
      args: [],
    });
  });

  it('strips mention embedded in middle of text if command present', () => {
    expect(parseCommand('/stop @bot')).toEqual({ command: 'stop', args: [] });
  });

  it('handles command with bot suffix (@botname/command Telegram style)', () => {
    expect(parseCommand('/status@worca_bot W-042')).toEqual({
      command: 'status',
      args: ['W-042'],
    });
  });

  it('handles command with bot suffix, no args', () => {
    expect(parseCommand('/help@worca_bot')).toEqual({
      command: 'help',
      args: [],
    });
  });

  it('handles extra whitespace between tokens', () => {
    expect(parseCommand('  /status   W-042  ')).toEqual({
      command: 'status',
      args: ['W-042'],
    });
  });

  it('handles multiple args', () => {
    expect(parseCommand('/cost week')).toEqual({
      command: 'cost',
      args: ['week'],
    });
    expect(parseCommand('/mute 1h')).toEqual({
      command: 'mute',
      args: ['1h'],
    });
  });

  it('lowercases the command name', () => {
    expect(parseCommand('/STATUS')).toEqual({ command: 'status', args: [] });
    expect(parseCommand('/Help')).toEqual({ command: 'help', args: [] });
  });

  it('returns null when only a mention is present (no command)', () => {
    expect(parseCommand('@bot')).toBeNull();
  });

  it('returns null for non-slash token as first meaningful token', () => {
    expect(parseCommand('status W-042')).toBeNull();
  });
});
