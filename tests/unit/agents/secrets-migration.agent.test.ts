import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { getSecretsMigrationAgentConfig } from '../../../src/agents/secrets-migration.agent.js';
import type { MigrationPlan } from '../../../src/lib/secrets-migration.js';

describe('getSecretsMigrationAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-secrets-migration-agent-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
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

  it('has AskUserQuestion as the only allowed tool', () => {
    const config = getSecretsMigrationAgentConfig({
      projectName: 'myproject',
      plan: makePlan(),
    });
    expect(config.allowedTools).toEqual(['AskUserQuestion']);
  });

  it('has JSON schema output format', () => {
    const config = getSecretsMigrationAgentConfig({
      projectName: 'myproject',
      plan: makePlan(),
    });
    expect(config.outputFormat).toBeDefined();
    expect(config.outputFormat!.type).toBe('json_schema');
    expect(config.outputFormat!.schema.required).toContain('approved');
    expect(config.outputFormat!.schema.required).toContain('conflictResolutions');
  });

  it('sets maxTurns to 8', () => {
    const config = getSecretsMigrationAgentConfig({
      projectName: 'myproject',
      plan: makePlan(),
    });
    expect(config.maxTurns).toBe(8);
  });

  it('includes key counts in prompt', () => {
    const plan = makePlan({
      keys: [
        { key: 'NEW_KEY', category: 'new', source: '.env' },
        { key: 'SAME_KEY', category: 'deduplicated', source: '.env' },
        { key: 'CONFLICT_KEY', category: 'conflicting', source: '.mcp.json' },
      ],
    });
    const config = getSecretsMigrationAgentConfig({
      projectName: 'testproj',
      plan,
    });
    expect(config.prompt).toContain('3 secret key(s)');
    expect(config.prompt).toContain('New Keys (1)');
    expect(config.prompt).toContain('Already Deduplicated (1)');
    expect(config.prompt).toContain('Conflicts (1)');
  });

  it('includes key names in prompt', () => {
    const plan = makePlan({
      keys: [
        { key: 'API_KEY', category: 'new', source: '.env' },
        { key: 'GH_TOKEN', category: 'conflicting', source: '.mcp.json' },
      ],
    });
    const config = getSecretsMigrationAgentConfig({
      projectName: 'myproject',
      plan,
    });
    expect(config.prompt).toContain('API_KEY');
    expect(config.prompt).toContain('GH_TOKEN');
  });

  it('includes project name in prompt', () => {
    const config = getSecretsMigrationAgentConfig({
      projectName: 'cool-project',
      plan: makePlan(),
    });
    expect(config.prompt).toContain('cool-project');
  });

  it('includes mcp note when rewrittenMcpJson is present', () => {
    const plan = makePlan({
      rewrittenMcpJson: '{"mcpServers":{}}',
      keys: [{ key: 'K', category: 'new', source: '.mcp.json' }],
    });
    const config = getSecretsMigrationAgentConfig({
      projectName: 'myproject',
      plan,
    });
    expect(config.prompt).toContain('${VAR} references');
  });
});
