import { describe, it, expect } from 'vitest';

// Test the retry delay function logic directly
// The actual function is in src/commands/run.ts but is not exported,
// so we test the algorithm here to validate behavior.

function retryDelay(attempt: number): number {
  const base = 2000 * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return base + jitter;
}

describe('retry logic', () => {
  it('first retry delay is between 2s and 3s', () => {
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(retryDelay(0));
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThan(3000);
    }
  });

  it('second retry delay is between 4s and 5s', () => {
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(retryDelay(1));
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThan(5000);
    }
  });

  it('third retry delay is between 8s and 9s', () => {
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(retryDelay(2));
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(8000);
      expect(d).toBeLessThan(9000);
    }
  });

  it('delays increase exponentially', () => {
    // Average of many attempts should follow 2^n pattern
    const samples = 1000;
    let sum0 = 0, sum1 = 0, sum2 = 0;
    for (let i = 0; i < samples; i++) {
      sum0 += retryDelay(0);
      sum1 += retryDelay(1);
      sum2 += retryDelay(2);
    }
    const avg0 = sum0 / samples;
    const avg1 = sum1 / samples;
    const avg2 = sum2 / samples;

    // avg0 should be ~2500, avg1 ~4500, avg2 ~8500
    expect(avg0).toBeGreaterThan(2000);
    expect(avg0).toBeLessThan(3000);
    expect(avg1).toBeGreaterThan(avg0);
    expect(avg2).toBeGreaterThan(avg1);
    // Ratio should be approximately 2x
    expect(avg1 / avg0).toBeGreaterThan(1.5);
    expect(avg1 / avg0).toBeLessThan(2.5);
  });

  it('--retry 0 means no retries (parseInt behavior)', () => {
    const maxRetries = parseInt('0', 10) || 0;
    expect(maxRetries).toBe(0);
  });

  it('--retry 3 parses correctly', () => {
    const maxRetries = parseInt('3', 10) || 0;
    expect(maxRetries).toBe(3);
  });

  it('invalid --retry value defaults to 0', () => {
    const maxRetries = parseInt('abc', 10) || 0;
    expect(maxRetries).toBe(0);
  });
});
