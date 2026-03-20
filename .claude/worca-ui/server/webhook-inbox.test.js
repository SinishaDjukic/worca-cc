import { describe, it, expect, beforeEach } from 'vitest';
import { createInbox } from './webhook-inbox.js';

describe('webhook-inbox', () => {
  let inbox;

  beforeEach(() => {
    inbox = createInbox(5); // small buffer for testing
  });

  it('stores and returns events with sequential IDs', () => {
    inbox.push({ headers: { 'x-worca-event': 'test' }, envelope: { event_type: 'pipeline.test.ping' } });
    inbox.push({ headers: {}, envelope: { event_type: 'pipeline.run.started' } });

    const events = inbox.list();
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe(1);
    expect(events[1].id).toBe(2);
    expect(events[0].envelope.event_type).toBe('pipeline.test.ping');
    expect(events[0].headers['x-worca-event']).toBe('test');
    expect(events[0].receivedAt).toBeDefined();
  });

  it('evicts oldest events when buffer is full', () => {
    for (let i = 0; i < 7; i++) {
      inbox.push({ headers: {}, envelope: { n: i } });
    }
    const events = inbox.list();
    expect(events).toHaveLength(5);
    expect(events[0].envelope.n).toBe(2); // first two evicted
    expect(events[4].envelope.n).toBe(6);
  });

  it('list with sinceId filters correctly', () => {
    for (let i = 0; i < 5; i++) {
      inbox.push({ headers: {}, envelope: { n: i } });
    }
    const since3 = inbox.list(3);
    expect(since3).toHaveLength(2);
    expect(since3[0].id).toBe(4);
    expect(since3[1].id).toBe(5);
  });

  it('clear removes all events', () => {
    inbox.push({ headers: {}, envelope: {} });
    inbox.push({ headers: {}, envelope: {} });
    expect(inbox.size()).toBe(2);
    inbox.clear();
    expect(inbox.size()).toBe(0);
    expect(inbox.list()).toHaveLength(0);
  });

  it('control action defaults to continue', () => {
    expect(inbox.getControlAction()).toBe('continue');
  });

  it('setControlAction updates and stored event reflects it', () => {
    inbox.setControlAction('pause');
    expect(inbox.getControlAction()).toBe('pause');

    const stored = inbox.push({ headers: {}, envelope: {} });
    expect(stored.controlResponse.action).toBe('pause');
  });

  it('setControlAction rejects invalid values', () => {
    inbox.setControlAction('invalid');
    expect(inbox.getControlAction()).toBe('continue');
  });

  it('setControlAction accepts all valid values', () => {
    for (const action of ['continue', 'pause', 'abort']) {
      inbox.setControlAction(action);
      expect(inbox.getControlAction()).toBe(action);
    }
  });
});
