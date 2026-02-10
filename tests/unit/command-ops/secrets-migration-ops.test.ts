import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { resetRegistryCache } from '../../../src/lib/registry.js';
import { applyMigration, applyConflictResolutions, replaceEnvKey } from '../../../src/lib/command-ops/secrets-migration-ops.js';
import type { MigrationPlan } from '../../../src/lib/secrets-migration.js';

describe('applyMigration', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-migration-ops-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'myproject');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();
  });

  function makePlan(overrides: Partial<MigrationPlan> = {}): MigrationPlan {
    return {
      keys: [],
      envAppendLines: [],
      rewrittenMcpJson: null,
      policyKeys: [],
      isEmpty: false,
      detectedValues: {},
      ...overrides,
    };
  }

  it('appends new keys to central .env', () => {
    writeFileSync(join(configDir, '.env'), 'EXISTING=value\n');
    const plan = makePlan({ envAppendLines: ['NEW_KEY=new_value', 'OTHER=other_val'] });

    applyMigration('myproject', projectDir, plan);

    const centralEnv = readFileSync(join(configDir, '.env'), 'utf8');
    expect(centralEnv).toContain('EXISTING=value');
    expect(centralEnv).toContain('NEW_KEY=new_value');
    expect(centralEnv).toContain('OTHER=other_val');
  });

  it('creates central .env if it does not exist', () => {
    const plan = makePlan({ envAppendLines: ['KEY=val'] });

    applyMigration('myproject', projectDir, plan);

    expect(existsSync(join(configDir, '.env'))).toBe(true);
    const content = readFileSync(join(configDir, '.env'), 'utf8');
    expect(content).toContain('KEY=val');
  });

  it('backs up project .env and removes it', () => {
    writeFileSync(join(projectDir, '.env'), 'SECRET=value\n');
    const plan = makePlan();

    applyMigration('myproject', projectDir, plan);

    expect(existsSync(join(projectDir, '.env'))).toBe(false);
    expect(existsSync(join(projectDir, '.env.plynx-backup'))).toBe(true);
    expect(readFileSync(join(projectDir, '.env.plynx-backup'), 'utf8')).toBe('SECRET=value\n');
  });

  it('does not fail when project has no .env', () => {
    const plan = makePlan({ envAppendLines: ['KEY=val'] });
    expect(() => applyMigration('myproject', projectDir, plan)).not.toThrow();
  });

  it('rewrites .mcp.json with provided content', () => {
    writeFileSync(join(projectDir, '.mcp.json'), '{"old": true}');
    const rewritten = JSON.stringify({ mcpServers: { s: { env: { K: '${K}' } } } }, null, 2) + '\n';
    const plan = makePlan({ rewrittenMcpJson: rewritten });

    applyMigration('myproject', projectDir, plan);

    const content = readFileSync(join(projectDir, '.mcp.json'), 'utf8');
    expect(content).toBe(rewritten);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.s.env.K).toBe('${K}');
  });

  it('creates secrets-access policy with project allowed list', () => {
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'version: 1\nshared: []\nprojects: {}\n',
    );
    const plan = makePlan({ policyKeys: ['API_KEY', 'DB_URL'] });

    applyMigration('myproject', projectDir, plan);

    const policy = parseYaml(
      readFileSync(join(configDir, 'shared', 'policies', 'secrets-access.yaml'), 'utf8'),
    );
    expect(policy.projects.myproject.allowed).toEqual(['API_KEY', 'DB_URL']);
  });

  it('preserves existing policy entries for other projects', () => {
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'version: 1\nshared:\n  - ANTHROPIC_API_KEY\nprojects:\n  other-proj:\n    allowed:\n      - GH_TOKEN\n',
    );
    const plan = makePlan({ policyKeys: ['NEW_KEY'] });

    applyMigration('myproject', projectDir, plan);

    const policy = parseYaml(
      readFileSync(join(configDir, 'shared', 'policies', 'secrets-access.yaml'), 'utf8'),
    );
    expect(policy.projects['other-proj'].allowed).toEqual(['GH_TOKEN']);
    expect(policy.projects.myproject.allowed).toEqual(['NEW_KEY']);
    expect(policy.shared).toContain('ANTHROPIC_API_KEY');
  });

  it('excludes shared keys from project allowed list', () => {
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'version: 1\nshared:\n  - ANTHROPIC_API_KEY\nprojects: {}\n',
    );
    const plan = makePlan({ policyKeys: ['ANTHROPIC_API_KEY', 'GH_TOKEN'] });

    applyMigration('myproject', projectDir, plan);

    const policy = parseYaml(
      readFileSync(join(configDir, 'shared', 'policies', 'secrets-access.yaml'), 'utf8'),
    );
    // ANTHROPIC_API_KEY is in shared, should not be in project allowed
    expect(policy.projects.myproject.allowed).toEqual(['GH_TOKEN']);
  });

  it('creates policy file if it does not exist', () => {
    const plan = makePlan({ policyKeys: ['KEY'] });

    applyMigration('myproject', projectDir, plan);

    const policyPath = join(configDir, 'shared', 'policies', 'secrets-access.yaml');
    expect(existsSync(policyPath)).toBe(true);
    const policy = parseYaml(readFileSync(policyPath, 'utf8'));
    expect(policy.projects.myproject.allowed).toEqual(['KEY']);
  });

  it('handles all operations together', () => {
    writeFileSync(join(configDir, '.env'), 'EXISTING=val\n');
    writeFileSync(join(projectDir, '.env'), 'NEW_KEY=secret\n');
    writeFileSync(join(projectDir, '.mcp.json'), '{"mcpServers":{}}');
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'version: 1\nshared: []\nprojects: {}\n',
    );

    const rewritten = JSON.stringify({ mcpServers: { s: { env: { K: '${K}' } } } }, null, 2) + '\n';
    const plan = makePlan({
      envAppendLines: ['NEW_KEY=secret'],
      rewrittenMcpJson: rewritten,
      policyKeys: ['NEW_KEY'],
    });

    applyMigration('myproject', projectDir, plan);

    // Central .env updated
    const centralEnv = readFileSync(join(configDir, '.env'), 'utf8');
    expect(centralEnv).toContain('NEW_KEY=secret');

    // Project .env backed up
    expect(existsSync(join(projectDir, '.env'))).toBe(false);
    expect(existsSync(join(projectDir, '.env.plynx-backup'))).toBe(true);

    // .mcp.json rewritten
    const mcpContent = readFileSync(join(projectDir, '.mcp.json'), 'utf8');
    expect(JSON.parse(mcpContent).mcpServers.s.env.K).toBe('${K}');

    // Policy updated
    const policy = parseYaml(
      readFileSync(join(configDir, 'shared', 'policies', 'secrets-access.yaml'), 'utf8'),
    );
    expect(policy.projects.myproject.allowed).toEqual(['NEW_KEY']);
  });

  it('applies overwrite keys before appending new keys', () => {
    writeFileSync(join(configDir, '.env'), 'API_KEY=old_value\nOTHER=keep\n');
    const plan = makePlan({
      envAppendLines: ['NEW_KEY=new_val'],
      policyKeys: ['API_KEY', 'NEW_KEY'],
    });

    applyMigration('myproject', projectDir, plan, { API_KEY: 'new_value' });

    const centralEnv = readFileSync(join(configDir, '.env'), 'utf8');
    expect(centralEnv).toContain('API_KEY=new_value');
    expect(centralEnv).toContain('OTHER=keep');
    expect(centralEnv).toContain('NEW_KEY=new_val');
    // Old value should be replaced
    expect(centralEnv).not.toContain('API_KEY=old_value');
  });
});

describe('applyConflictResolutions', () => {
  function makePlan(overrides: Partial<MigrationPlan> = {}): MigrationPlan {
    return {
      keys: [],
      envAppendLines: [],
      rewrittenMcpJson: null,
      policyKeys: [],
      isEmpty: false,
      detectedValues: {},
      ...overrides,
    };
  }

  it('skip leaves plan unchanged', () => {
    const plan = makePlan({
      keys: [{ key: 'API_KEY', category: 'conflicting', source: '.env' }],
      envAppendLines: ['NEW=val'],
      policyKeys: ['NEW'],
      detectedValues: { API_KEY: 'project_val', NEW: 'val' },
    });

    const { resolvedPlan, overwriteKeys } = applyConflictResolutions(plan, {
      API_KEY: { action: 'skip' },
    });

    expect(resolvedPlan.envAppendLines).toEqual(['NEW=val']);
    expect(resolvedPlan.policyKeys).toEqual(['NEW']);
    expect(overwriteKeys).toEqual({});
  });

  it('rename adds new key to envAppendLines and policyKeys', () => {
    const plan = makePlan({
      keys: [{ key: 'API_KEY', category: 'conflicting', source: '.env' }],
      detectedValues: { API_KEY: 'project_val' },
    });

    const { resolvedPlan, overwriteKeys } = applyConflictResolutions(plan, {
      API_KEY: { action: 'rename', newName: 'MYPROJ_API_KEY' },
    });

    expect(resolvedPlan.envAppendLines).toContain('MYPROJ_API_KEY=project_val');
    expect(resolvedPlan.policyKeys).toContain('MYPROJ_API_KEY');
    expect(overwriteKeys).toEqual({});
  });

  it('rename without newName is a no-op', () => {
    const plan = makePlan({
      keys: [{ key: 'API_KEY', category: 'conflicting', source: '.env' }],
      detectedValues: { API_KEY: 'project_val' },
    });

    const { resolvedPlan } = applyConflictResolutions(plan, {
      API_KEY: { action: 'rename' },
    });

    expect(resolvedPlan.envAppendLines).toEqual([]);
    expect(resolvedPlan.policyKeys).toEqual([]);
  });

  it('overwrite adds key to overwriteKeys and policyKeys', () => {
    const plan = makePlan({
      keys: [{ key: 'API_KEY', category: 'conflicting', source: '.env' }],
      detectedValues: { API_KEY: 'project_val' },
    });

    const { resolvedPlan, overwriteKeys } = applyConflictResolutions(plan, {
      API_KEY: { action: 'overwrite' },
    });

    expect(overwriteKeys).toEqual({ API_KEY: 'project_val' });
    expect(resolvedPlan.policyKeys).toContain('API_KEY');
    // Overwrite does NOT add to envAppendLines — it replaces in place
    expect(resolvedPlan.envAppendLines).toEqual([]);
  });

  it('handles multiple conflicts with mixed actions', () => {
    const plan = makePlan({
      keys: [
        { key: 'KEY_A', category: 'conflicting', source: '.env' },
        { key: 'KEY_B', category: 'conflicting', source: '.env' },
        { key: 'KEY_C', category: 'conflicting', source: '.mcp.json' },
      ],
      envAppendLines: ['NEW=existing'],
      policyKeys: ['NEW'],
      detectedValues: { KEY_A: 'val_a', KEY_B: 'val_b', KEY_C: 'val_c', NEW: 'existing' },
    });

    const { resolvedPlan, overwriteKeys } = applyConflictResolutions(plan, {
      KEY_A: { action: 'skip' },
      KEY_B: { action: 'rename', newName: 'PROJ_KEY_B' },
      KEY_C: { action: 'overwrite' },
    });

    expect(resolvedPlan.envAppendLines).toEqual(['NEW=existing', 'PROJ_KEY_B=val_b']);
    expect(resolvedPlan.policyKeys).toContain('NEW');
    expect(resolvedPlan.policyKeys).toContain('PROJ_KEY_B');
    expect(resolvedPlan.policyKeys).toContain('KEY_C');
    expect(overwriteKeys).toEqual({ KEY_C: 'val_c' });
  });

  it('ignores resolutions for keys not in detectedValues', () => {
    const plan = makePlan({ detectedValues: {} });

    const { resolvedPlan, overwriteKeys } = applyConflictResolutions(plan, {
      GHOST_KEY: { action: 'overwrite' },
    });

    expect(resolvedPlan.envAppendLines).toEqual([]);
    expect(resolvedPlan.policyKeys).toEqual([]);
    expect(overwriteKeys).toEqual({});
  });
});

describe('replaceEnvKey', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-replace-env-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces an existing key value', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, 'API_KEY=old_value\nOTHER=keep\n');

    replaceEnvKey(envPath, 'API_KEY', 'new_value');

    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('API_KEY=new_value');
    expect(content).toContain('OTHER=keep');
    expect(content).not.toContain('old_value');
  });

  it('preserves other lines unchanged', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, '# comment\nA=1\nB=2\nC=3\n');

    replaceEnvKey(envPath, 'B', '99');

    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('# comment');
    expect(content).toContain('A=1');
    expect(content).toContain('B=99');
    expect(content).toContain('C=3');
  });

  it('is a no-op if file does not exist', () => {
    const envPath = join(tmpDir, 'nonexistent.env');
    expect(() => replaceEnvKey(envPath, 'KEY', 'val')).not.toThrow();
  });

  it('is a no-op if key does not exist in file', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, 'OTHER=value\n');

    replaceEnvKey(envPath, 'MISSING', 'val');

    const content = readFileSync(envPath, 'utf8');
    expect(content).toBe('OTHER=value\n');
  });
});
