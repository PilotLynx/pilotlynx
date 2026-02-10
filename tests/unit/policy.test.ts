import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { loadPolicy, resetPolicyCache } from '../../src/lib/policy.js';

describe('loadPolicy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
    resetPolicyCache();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resetPolicyCache();
  });

  const testSchema = z.object({
    version: z.number(),
    name: z.string(),
    items: z.array(z.string()),
  });

  it('loads and validates a valid YAML file', () => {
    const filePath = join(tmpDir, 'test.yaml');
    writeFileSync(filePath, 'version: 1\nname: test\nitems:\n  - a\n  - b\n');
    const result = loadPolicy(filePath, testSchema);
    expect(result).toEqual({ version: 1, name: 'test', items: ['a', 'b'] });
  });

  it('throws on malformed YAML', () => {
    const filePath = join(tmpDir, 'bad.yaml');
    writeFileSync(filePath, '{{invalid yaml');
    expect(() => loadPolicy(filePath, testSchema)).toThrow();
  });

  it('throws ZodError on schema mismatch', () => {
    const filePath = join(tmpDir, 'mismatch.yaml');
    writeFileSync(filePath, 'version: "not a number"\nname: 123\n');
    expect(() => loadPolicy(filePath, testSchema)).toThrow();
  });

  it('caches loaded policies', () => {
    const filePath = join(tmpDir, 'cached.yaml');
    writeFileSync(filePath, 'version: 1\nname: cached\nitems: []\n');
    const first = loadPolicy(filePath, testSchema);
    // Overwrite file — should still return cached version
    writeFileSync(filePath, 'version: 2\nname: changed\nitems: []\n');
    const second = loadPolicy(filePath, testSchema);
    expect(second).toBe(first);
  });

  it('resetPolicyCache clears the cache', () => {
    const filePath = join(tmpDir, 'reset.yaml');
    writeFileSync(filePath, 'version: 1\nname: first\nitems: []\n');
    loadPolicy(filePath, testSchema);
    resetPolicyCache();
    writeFileSync(filePath, 'version: 2\nname: second\nitems: []\n');
    const result = loadPolicy(filePath, testSchema);
    expect(result.version).toBe(2);
    expect(result.name).toBe('second');
  });
});
