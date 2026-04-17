import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter, RingBuffer, TokenBucket } from './rate_limiter.js';

describe('RingBuffer', () => {
  it('stores items up to capacity without dropping', () => {
    const buf = new RingBuffer(3);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    expect(buf.toArray()).toEqual(['a', 'b', 'c']);
    expect(buf.dropped).toBe(0);
  });

  it('overflow drops oldest and increments dropped counter', () => {
    const buf = new RingBuffer(3);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    buf.push('d');
    expect(buf.toArray()).toEqual(['b', 'c', 'd']);
    expect(buf.dropped).toBe(1);
  });

  it('tracks multiple overflows correctly', () => {
    const buf = new RingBuffer(2);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    buf.push('d');
    expect(buf.toArray()).toEqual(['c', 'd']);
    expect(buf.dropped).toBe(2);
  });

  it('returns empty array when empty', () => {
    const buf = new RingBuffer(5);
    expect(buf.toArray()).toEqual([]);
  });

  it('returns partial array before buffer is full', () => {
    const buf = new RingBuffer(5);
    buf.push('x');
    buf.push('y');
    expect(buf.toArray()).toEqual(['x', 'y']);
  });
});

describe('TokenBucket', () => {
  it('starts full and allows ratePerMin consumes before blocking', () => {
    const bucket = new TokenBucket(3);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('refills tokens over time proportionally', () => {
    let t = 0;
    const bucket = new TokenBucket(60, { now: () => t });
    for (let i = 0; i < 60; i++) bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);
    t += 1000; // 1 second = 1 token at rate 60/min
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('caps refill at ratePerMin capacity', () => {
    let t = 0;
    const bucket = new TokenBucket(3, { now: () => t });
    bucket.tryConsume();
    bucket.tryConsume();
    bucket.tryConsume();
    t += 10 * 60 * 1000; // 10 minutes — would give 30 tokens but cap at 3
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('sends message, resolves true, and records it in ring buffer', async () => {
    const rl = createRateLimiter({ ratePerMin: 60 });
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await rl.send('hello', sendFn);
    expect(result).toBe(true);
    expect(sendFn).toHaveBeenCalledWith('hello');
    expect(rl.getRing()).toEqual(['hello']);
  });

  it('ring buffer overflow increments dropped_messages', async () => {
    const rl = createRateLimiter({ ratePerMin: 1000, ringSize: 2 });
    const sendFn = vi.fn().mockResolvedValue(undefined);
    await rl.send('a', sendFn);
    await rl.send('b', sendFn);
    await rl.send('c', sendFn);
    expect(rl.getStats().dropped_messages).toBe(1);
    expect(rl.getRing()).toEqual(['b', 'c']);
  });

  describe('429 backoff', () => {
    it('retries on 429 with 1s→5s→30s delays then drops', async () => {
      const delays = [];
      const sleep = async (ms) => {
        delays.push(ms);
      };
      const rl = createRateLimiter({ ratePerMin: 60, _sleep: sleep });

      const err429 = Object.assign(new Error('429'), { status: 429 });
      const sendFn = vi.fn().mockRejectedValue(err429);

      const result = await rl.send('msg', sendFn);

      expect(result).toBe(false);
      expect(sendFn).toHaveBeenCalledTimes(4); // initial + 3 retries
      expect(delays).toContain(1000);
      expect(delays).toContain(5000);
      expect(delays).toContain(30000);
    });

    it('succeeds on second attempt if 429 clears', async () => {
      const delays = [];
      const sleep = async (ms) => {
        delays.push(ms);
      };
      const rl = createRateLimiter({ ratePerMin: 60, _sleep: sleep });

      const err429 = Object.assign(new Error('429'), { status: 429 });
      const sendFn = vi
        .fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValue(undefined);

      const result = await rl.send('msg', sendFn);

      expect(result).toBe(true);
      expect(sendFn).toHaveBeenCalledTimes(2);
      expect(delays).toEqual([1000]);
    });

    it('429 drop increments dropped_messages', async () => {
      const sleep = async () => {};
      const rl = createRateLimiter({ ratePerMin: 60, _sleep: sleep });

      const err429 = Object.assign(new Error('429'), { status: 429 });
      const sendFn = vi.fn().mockRejectedValue(err429);

      await rl.send('msg', sendFn);
      expect(rl.getStats().dropped_messages).toBe(1);
    });

    it('propagates non-429 errors without retrying', async () => {
      const rl = createRateLimiter({ ratePerMin: 60 });
      const err = new Error('network error');
      const sendFn = vi.fn().mockRejectedValue(err);

      await expect(rl.send('msg', sendFn)).rejects.toThrow('network error');
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
  });

  it('processes multiple queued messages in FIFO order', async () => {
    const order = [];
    const rl = createRateLimiter({ ratePerMin: 1000 });
    const sendFn = vi.fn().mockImplementation(async (msg) => {
      order.push(msg);
    });

    await Promise.all([
      rl.send('first', sendFn),
      rl.send('second', sendFn),
      rl.send('third', sendFn),
    ]);

    expect(order).toEqual(['first', 'second', 'third']);
  });
});
