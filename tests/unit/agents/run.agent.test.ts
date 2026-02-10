import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { registerProject, resetRegistryCache } from '../../../src/lib/registry.js';
import { getRunAgentConfig } from '../../../src/agents/run.agent.js';

describe('getRunAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-run-agent-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'testproject');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'docs'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'insights'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
    mkdirSync(projectDir, { recursive: true });
    registerProject('testproject', projectDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();
  });

  it('sets cwd to project directory', () => {
    const config = getRunAgentConfig('testproject', 'test_workflow', {});
    expect(config.cwd).toBe(projectDir);
  });

  it('sets bypassPermissions mode', () => {
    const config = getRunAgentConfig('testproject', 'test_workflow', {});
    expect(config.permissionMode).toBe('bypassPermissions');
  });

  it('includes shared docs and insights in additionalDirectories', () => {
    const config = getRunAgentConfig('testproject', 'test_workflow', {});
    expect(config.additionalDirectories).toBeDefined();
    expect(config.additionalDirectories!.length).toBe(2);
    expect(config.additionalDirectories!.some(d => d.includes('docs'))).toBe(true);
    expect(config.additionalDirectories!.some(d => d.includes('insights'))).toBe(true);
  });

  it('has canUseTool callback that denies writes outside project', async () => {
    const config = getRunAgentConfig('testproject', 'test_workflow', {});
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: '/etc/passwd' });
    expect(result.behavior).toBe('deny');
  });

  it('has canUseTool callback that allows writes inside project', async () => {
    const config = getRunAgentConfig('testproject', 'test_workflow', {});
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: join(projectDir, 'test.txt') });
    expect(result.behavior).toBe('allow');
  });

  it('sets max turns to 50', () => {
    const config = getRunAgentConfig('testproject', 'test_workflow', {});
    expect(config.maxTurns).toBe(50);
  });
});
