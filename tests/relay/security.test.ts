import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { resetRegistryCache } from '../../src/lib/registry.js';
import { buildProjectEnv } from '../../src/lib/secrets.js';
import { containsPotentialSecrets, sanitizeAgentOutput } from '../../src/lib/callbacks.js';

let tmpDir: string;
let configDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-'));
  configDir = join(tmpDir, CONFIG_DIR_NAME);
  process.env.PILOTLYNX_ROOT = configDir;
  resetConfigCache();
  resetPolicyCache();
  resetRegistryCache();
  mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
  mkdirSync(join(configDir, 'shared', 'insights'), { recursive: true });
  writeFileSync(join(configDir, 'projects.yaml'), stringifyYaml({ version: 1, projects: {} }));
});

afterEach(() => {
  delete process.env.PILOTLYNX_ROOT;
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
  resetPolicyCache();
  resetRegistryCache();
});

describe('buildProjectEnv relay credential filtering', () => {
  it('denies SLACK_* keys from project env', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nSLACK_BOT_TOKEN=xoxb-test\nSLACK_APP_TOKEN=xapp-test\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      stringifyYaml({
        version: 1,
        shared: ['ANTHROPIC_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'],
        projects: {},
      }),
    );

    const env = buildProjectEnv('some-project');
    expect(env).toHaveProperty('ANTHROPIC_API_KEY', 'sk-123');
    expect(env).not.toHaveProperty('SLACK_BOT_TOKEN');
    expect(env).not.toHaveProperty('SLACK_APP_TOKEN');
  });

  it('denies TELEGRAM_* keys from project env', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nTELEGRAM_BOT_TOKEN=bot123:abc\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      stringifyYaml({
        version: 1,
        shared: ['ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN'],
        projects: {},
      }),
    );

    const env = buildProjectEnv('some-project');
    expect(env).toHaveProperty('ANTHROPIC_API_KEY', 'sk-123');
    expect(env).not.toHaveProperty('TELEGRAM_BOT_TOKEN');
  });

  it('denies RELAY_* keys from project env', () => {
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nRELAY_SECRET=s3cret\n');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      stringifyYaml({
        version: 1,
        shared: ['ANTHROPIC_API_KEY', 'RELAY_SECRET'],
        projects: {},
      }),
    );

    const env = buildProjectEnv('some-project');
    expect(env).toHaveProperty('ANTHROPIC_API_KEY', 'sk-123');
    expect(env).not.toHaveProperty('RELAY_SECRET');
  });
});

describe('containsPotentialSecrets', () => {
  it('detects JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.signature';
    const result = containsPotentialSecrets(jwt);
    expect(result).not.toBeNull();
    expect(result).toContain('Potential secret');
  });

  it('detects Anthropic API keys', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const result = containsPotentialSecrets(key);
    expect(result).not.toBeNull();
  });

  it('detects connection strings with credentials', () => {
    const connStr = 'postgres://admin:p4ssw0rd@db.example.com:5432/mydb';
    const result = containsPotentialSecrets(connStr);
    expect(result).not.toBeNull();
  });

  it('detects GitHub PATs', () => {
    const pat = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = containsPotentialSecrets(pat);
    expect(result).not.toBeNull();
  });

  it('detects AWS access keys', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const result = containsPotentialSecrets(key);
    expect(result).not.toBeNull();
  });

  it('returns null for safe content', () => {
    const safe = 'This is just a normal paragraph with no secrets.';
    const result = containsPotentialSecrets(safe);
    expect(result).toBeNull();
  });
});

describe('sanitizeAgentOutput (callbacks.ts)', () => {
  it('redacts known secret patterns from output', () => {
    const text = 'Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij found in env';
    const sanitized = sanitizeAgentOutput(text, {});
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toContain('ghp_ABCDEFGHIJ');
  });

  it('replaces literal env values with markers', () => {
    const text = 'Connected to postgres://host:5432/mydb successfully';
    const env = { DATABASE_URL: 'postgres://host:5432/mydb' };
    const sanitized = sanitizeAgentOutput(text, env);
    expect(sanitized).toContain('[ENV:DATABASE_URL]');
    expect(sanitized).not.toContain('postgres://host:5432/mydb');
  });

  it('truncates output exceeding the length cap', () => {
    const text = 'x'.repeat(50_000);
    const sanitized = sanitizeAgentOutput(text, {});
    expect(sanitized.length).toBeLessThanOrEqual(40_100);
    expect(sanitized).toContain('[Output truncated]');
  });

  it('performs multi-stage sanitization: pattern + env + length', () => {
    // Text with a secret pattern AND an env value
    const text = 'key=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij and db=mydbvalue1234';
    const env = { DB_HOST: 'mydbvalue1234' };
    const sanitized = sanitizeAgentOutput(text, env);
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).toContain('[ENV:DB_HOST]');
    expect(sanitized).not.toContain('ghp_ABCDEFGHIJ');
    expect(sanitized).not.toContain('mydbvalue1234');
  });
});
