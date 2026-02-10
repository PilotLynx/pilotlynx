import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { buildProjectEnv } from '../../src/lib/secrets.js';

describe('buildProjectEnv', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();

    // Config dir with policies, .env lives inside config dir
    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PILOTLYNX_ROOT = origEnv;
    } else {
      delete process.env.PILOTLYNX_ROOT;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
  });

  it('returns only shared keys when project has no policy entry', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nSECRET_X=hidden\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'version: 1\nshared:\n  - ANTHROPIC_API_KEY\nprojects: {}\n'
    );

    const result = buildProjectEnv('myproject');
    expect(result).toEqual({ ANTHROPIC_API_KEY: 'sk-123' });
    expect(result).not.toHaveProperty('SECRET_X');
  });

  it('includes project-specific allowed keys', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nGITHUB_TOKEN=gh-abc\nOTHER=no\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      `version: 1
shared:
  - ANTHROPIC_API_KEY
projects:
  myproject:
    allowed:
      - GITHUB_TOKEN
`
    );

    const result = buildProjectEnv('myproject');
    expect(result).toEqual({
      ANTHROPIC_API_KEY: 'sk-123',
      GITHUB_TOKEN: 'gh-abc',
    });
    expect(result).not.toHaveProperty('OTHER');
  });

  it('applies mappings', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nMY_SPECIAL_KEY=special\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      `version: 1
shared:
  - ANTHROPIC_API_KEY
projects:
  myproject:
    mappings:
      RENAMED_KEY: MY_SPECIAL_KEY
`
    );

    const result = buildProjectEnv('myproject');
    expect(result.ANTHROPIC_API_KEY).toBe('sk-123');
    expect(result.RENAMED_KEY).toBe('special');
  });

  it('returns empty when no .env file exists', () => {
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'version: 1\nshared:\n  - ANTHROPIC_API_KEY\nprojects: {}\n'
    );

    const result = buildProjectEnv('myproject');
    expect(result).toEqual({});
  });

  it('returns empty when no policy file exists', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\n');
    // No secrets-access.yaml written
    const result = buildProjectEnv('myproject');
    expect(result).toEqual({});
  });

  it('throws on malformed policy YAML', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      '!!!not valid yaml structure\nversion: nope\n'
    );
    resetPolicyCache();

    expect(() => buildProjectEnv('myproject')).toThrow();
  });

  it('silently skips mapping to non-existent .env key', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      `version: 1
shared:
  - ANTHROPIC_API_KEY
projects:
  myproject:
    mappings:
      ALIAS_KEY: NONEXISTENT_KEY
`
    );

    const result = buildProjectEnv('myproject');
    expect(result).toEqual({ ANTHROPIC_API_KEY: 'sk-123' });
    expect(result).not.toHaveProperty('ALIAS_KEY');
  });

  it('returns only shared keys when project has empty allowed list', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nEXTRA=val\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      `version: 1
shared:
  - ANTHROPIC_API_KEY
projects:
  myproject:
    allowed: []
`
    );

    const result = buildProjectEnv('myproject');
    expect(result).toEqual({ ANTHROPIC_API_KEY: 'sk-123' });
    expect(result).not.toHaveProperty('EXTRA');
  });
});
