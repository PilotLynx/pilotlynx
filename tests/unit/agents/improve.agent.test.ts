import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { getImproveAgentConfig } from '../../../src/agents/improve.agent.js';

describe('getImproveAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-improve-agent-'));
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

  it('has read-only tools', () => {
    const config = getImproveAgentConfig({ proj1: 'some logs' });
    expect(config.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('callback denies access to .env files', async () => {
    const envFile = join(configDir, '.env');
    writeFileSync(envFile, 'SECRET=value');
    const config = getImproveAgentConfig({ proj1: 'some logs' });
    const callback = config.canUseTool!;
    const result = await callback('Read', { file_path: envFile });
    expect(result.behavior).toBe('deny');
  });

  it('callback allows reading non-.env files', async () => {
    const config = getImproveAgentConfig({ proj1: 'some logs' });
    const callback = config.canUseTool!;
    const result = await callback('Read', { file_path: join(tmpDir, 'some', 'file.md') });
    expect(result.behavior).toBe('allow');
  });

  it('has JSON schema output format', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    expect(config.outputFormat).toBeDefined();
    expect(config.outputFormat!.type).toBe('json_schema');
  });

  it('sets maxTurns to 10', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    expect(config.maxTurns).toBe(10);
  });
});
