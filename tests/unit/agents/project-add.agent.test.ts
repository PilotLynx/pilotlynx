import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { registerProject, resetRegistryCache } from '../../../src/lib/registry.js';
import { getProjectAddAgentConfig } from '../../../src/agents/project-add.agent.js';

describe('getProjectAddAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-add-agent-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'existing');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
    mkdirSync(projectDir, { recursive: true });
    registerProject('existing', projectDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();
  });

  it('includes Grep in allowed tools (unlike create)', () => {
    const config = getProjectAddAgentConfig('existing', [], '');
    expect(config.allowedTools).toContain('Grep');
  });

  it('callback denies Write outside project and policies', async () => {
    const config = getProjectAddAgentConfig('existing', [], '');
    const callback = config.canUseTool!;
    const result = await callback('Write', { file_path: '/tmp/evil.txt' });
    expect(result.behavior).toBe('deny');
  });

  it('callback denies Bash escape attempts', async () => {
    const config = getProjectAddAgentConfig('existing', [], '');
    const callback = config.canUseTool!;
    const result = await callback('Bash', { command: 'cat /etc/passwd' });
    expect(result.behavior).toBe('deny');
  });

  it('callback allows safe Bash inside project', async () => {
    const config = getProjectAddAgentConfig('existing', [], '');
    const callback = config.canUseTool!;
    const result = await callback('Bash', { command: 'ls -la' });
    expect(result.behavior).toBe('allow');
  });
});
