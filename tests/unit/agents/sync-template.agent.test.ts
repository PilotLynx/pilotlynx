import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME, TEMPLATE_DIR } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { registerProject, resetRegistryCache } from '../../../src/lib/registry.js';
import { getSyncTemplateAgentConfig } from '../../../src/agents/sync-template.agent.js';

describe('getSyncTemplateAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-sync-agent-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'testproject');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    mkdirSync(join(configDir, 'template'), { recursive: true });
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

  it('includes TEMPLATE_DIR in additionalDirectories', () => {
    const config = getSyncTemplateAgentConfig('testproject');
    const templateDir = TEMPLATE_DIR();
    expect(config.additionalDirectories).toContain(templateDir);
  });

  it('has canUseTool callback that allows reads from template directory', async () => {
    const config = getSyncTemplateAgentConfig('testproject');
    const templateDir = TEMPLATE_DIR();
    const callback = config.canUseTool!;
    const result = await callback('Read', { file_path: join(templateDir, 'CLAUDE.md') });
    expect(result.behavior).toBe('allow');
  });

  it('has canUseTool callback that allows writes inside project', async () => {
    const config = getSyncTemplateAgentConfig('testproject');
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: join(projectDir, 'CLAUDE.md') });
    expect(result.behavior).toBe('allow');
  });

  it('has canUseTool callback that denies writes outside project and template', async () => {
    const config = getSyncTemplateAgentConfig('testproject');
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: '/tmp/evil.txt' });
    expect(result.behavior).toBe('deny');
  });

  it('sets acceptEdits permission mode', () => {
    const config = getSyncTemplateAgentConfig('testproject');
    expect(config.permissionMode).toBe('acceptEdits');
  });
});
