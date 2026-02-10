import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRootEnv } from '../../src/lib/env-loader.js';

describe('loadRootEnv', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty object when file does not exist', () => {
    const result = loadRootEnv(join(tmpDir, '.env'));
    expect(result).toEqual({});
  });

  it('parses valid .env file', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, 'FOO=bar\nBAZ=qux\nANTHROPIC_API_KEY=sk-test-123\n');
    const result = loadRootEnv(envPath);
    expect(result).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
      ANTHROPIC_API_KEY: 'sk-test-123',
    });
  });

  it('handles empty .env file', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, '');
    const result = loadRootEnv(envPath);
    expect(result).toEqual({});
  });

  it('handles comments and empty lines', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, '# comment\n\nKEY=value\n# another comment\n');
    const result = loadRootEnv(envPath);
    expect(result).toEqual({ KEY: 'value' });
  });
});
