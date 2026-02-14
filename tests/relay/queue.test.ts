import { describe, it, expect, afterEach } from 'vitest';
import { AgentPool } from '../../src/lib/relay/queue.js';

let pool: AgentPool;

afterEach(async () => {
  if (pool) {
    await pool.shutdown();
  }
});

describe('enqueue', () => {
  it('returns correct position for first item', async () => {
    pool = new AgentPool(5, 10, 8192);
    const { position } = await pool.enqueue('proj-a', async () => 'done');
    expect(position).toBe(0);
  });

  it('returns incrementing positions for queued items', async () => {
    pool = new AgentPool(1, 10, 8192);
    // First task blocks the queue
    let resolveFirst!: () => void;
    const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

    const { position: pos0 } = await pool.enqueue('proj-a', () => firstPromise);
    // While the first is running, enqueue another
    const { position: pos1 } = await pool.enqueue('proj-a', async () => 'second');

    expect(pos0).toBe(0);
    expect(pos1).toBeGreaterThanOrEqual(1);

    resolveFirst();
  });
});

describe('maxQueueDepth rejection', () => {
  it('throws when queue is full', async () => {
    pool = new AgentPool(1, 2, 8192);
    // Fill up the queue
    let resolve1!: () => void;
    const p1 = new Promise<void>((r) => { resolve1 = r; });
    await pool.enqueue('proj-a', () => p1);
    await pool.enqueue('proj-a', async () => {});

    await expect(
      pool.enqueue('proj-a', async () => {}),
    ).rejects.toThrow(/Queue full/);

    resolve1();
  });
});

describe('per-project serialization', () => {
  it('runs tasks for the same project sequentially', async () => {
    pool = new AgentPool(5, 10, 8192);
    const order: number[] = [];

    const { result: r1 } = await pool.enqueue('proj-a', async () => {
      order.push(1);
      return 1;
    });
    const { result: r2 } = await pool.enqueue('proj-a', async () => {
      order.push(2);
      return 2;
    });

    await r1;
    await r2;

    expect(order).toEqual([1, 2]);
  });
});

describe('global semaphore', () => {
  it('limits total concurrent runs', async () => {
    pool = new AgentPool(2, 10, 8192);
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeTask = () => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
      return maxConcurrent;
    };

    const results = await Promise.all([
      pool.enqueue('proj-a', makeTask()).then((e) => e.result),
      pool.enqueue('proj-b', makeTask()).then((e) => e.result),
      pool.enqueue('proj-c', makeTask()).then((e) => e.result),
      pool.enqueue('proj-d', makeTask()).then((e) => e.result),
    ]);

    await Promise.all(results);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('shutdown', () => {
  it('clears queues and allows shutdown', async () => {
    pool = new AgentPool(5, 10, 8192);
    await pool.enqueue('proj-a', async () => 'done');

    await pool.shutdown();

    expect(pool.getQueueDepth('proj-a')).toBe(0);
    expect(pool.getActiveCount()).toBe(0);
  });
});
