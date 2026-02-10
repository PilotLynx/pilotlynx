import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { registerProject, resetRegistryCache } from '../../../src/lib/registry.js';
import { getProjectCreateAgentConfig } from '../../../src/agents/project-create.agent.js';

describe('getProjectCreateAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-create-agent-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'newproject');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
    mkdirSync(projectDir, { recursive: true });
    registerProject('newproject', projectDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();
  });

  it('includes correct tools', () => {
    const config = getProjectCreateAgentConfig('newproject');
    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Write');
    expect(config.allowedTools).toContain('Bash');
    expect(config.allowedTools).toContain('AskUserQuestion');
  });

  it('callback denies Write outside project and policies', async () => {
    const config = getProjectCreateAgentConfig('newproject');
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: '/tmp/evil.txt' });
    expect(result.behavior).toBe('deny');
  });

  it('callback allows Write inside project directory', async () => {
    const config = getProjectCreateAgentConfig('newproject');
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: join(projectDir, 'README.md') });
    expect(result.behavior).toBe('allow');
  });

  it('callback denies Bash escape attempts', async () => {
    const config = getProjectCreateAgentConfig('newproject');
    const callback = config.canUseTool!;
    const result = await callback('Bash', { command: 'cat /etc/passwd' });
    expect(result.behavior).toBe('deny');
  });

  it('callback allows safe Bash commands', async () => {
    const config = getProjectCreateAgentConfig('newproject');
    const callback = config.canUseTool!;
    const result = await callback('Bash', { command: 'npm test' });
    expect(result.behavior).toBe('allow');
  });

  it('sets acceptEdits permission mode', () => {
    const config = getProjectCreateAgentConfig('newproject');
    expect(config.permissionMode).toBe('acceptEdits');
  });
});
