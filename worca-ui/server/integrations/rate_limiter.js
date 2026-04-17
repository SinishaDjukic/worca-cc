const BACKOFF_DELAYS = [1000, 5000, 30000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RingBuffer {
  constructor(size = 100) {
    this._size = size;
    this._buf = new Array(size);
    this._head = 0;
    this._count = 0;
    this.dropped = 0;
  }

  push(item) {
    if (this._count < this._size) {
      this._count++;
    } else {
      this.dropped++;
    }
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._size;
  }

  toArray() {
    if (this._count < this._size) {
      return this._buf.slice(0, this._count);
    }
    const result = [];
    for (let i = 0; i < this._size; i++) {
      result.push(this._buf[(this._head + i) % this._size]);
    }
    return result;
  }
}

export class TokenBucket {
  constructor(ratePerMin, { now = Date.now.bind(Date) } = {}) {
    this._rate = ratePerMin;
    this._tokens = ratePerMin;
    this._lastRefill = now();
    this._now = now;
  }

  tryConsume() {
    const t = this._now();
    const mins = (t - this._lastRefill) / 60000;
    this._tokens = Math.min(this._rate, this._tokens + mins * this._rate);
    this._lastRefill = t;
    if (this._tokens >= 1) {
      this._tokens -= 1;
      return true;
    }
    return false;
  }
}

export function createRateLimiter({
  ratePerMin = 20,
  ringSize = 100,
  _sleep = defaultSleep,
} = {}) {
  const ring = new RingBuffer(ringSize);
  const bucket = new TokenBucket(ratePerMin);
  let droppedMessages = 0;

  async function trySend(msg, sendFn) {
    for (let attempt = 0; attempt <= BACKOFF_DELAYS.length; attempt++) {
      if (attempt > 0) {
        await _sleep(BACKOFF_DELAYS[attempt - 1]);
      }
      try {
        await sendFn(msg);
        return true;
      } catch (err) {
        if (err?.status === 429) {
          if (attempt < BACKOFF_DELAYS.length) continue;
          console.warn(
            '[rate_limiter] 429 exhausted after all retries — dropping message',
          );
          return false;
        }
        throw err;
      }
    }
    return false;
  }

  const pendingQueue = [];
  let workerRunning = false;

  async function runWorker() {
    if (workerRunning) return;
    workerRunning = true;
    while (pendingQueue.length > 0) {
      if (!bucket.tryConsume()) {
        await _sleep(Math.ceil(60000 / ratePerMin));
        continue;
      }
      const { msg, sendFn, resolve, reject } = pendingQueue.shift();
      try {
        const sent = await trySend(msg, sendFn);
        if (sent) {
          const prevDropped = ring.dropped;
          ring.push(msg);
          droppedMessages += ring.dropped - prevDropped;
        } else {
          droppedMessages++;
        }
        resolve(sent);
      } catch (err) {
        reject(err);
      }
    }
    workerRunning = false;
  }

  return {
    send(msg, sendFn) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({ msg, sendFn, resolve, reject });
        runWorker();
      });
    },
    getStats() {
      return { dropped_messages: droppedMessages };
    },
    getRing() {
      return ring.toArray();
    },
  };
}
