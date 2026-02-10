import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { registerProject, resetRegistryCache } from '../../../src/lib/registry.js';
import { executeVerify } from '../../../src/lib/command-ops/verify-ops.js';

describe('executeVerify', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-verify-ops-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('returns error for non-existent project', () => {
    const result = executeVerify('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('returns verification result for valid project', () => {
    const projectDir = join(tmpDir, 'testproj');
    mkdirSync(projectDir, { recursive: true });
    registerProject('testproj', projectDir);

    // Create required files
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Test');
    writeFileSync(join(projectDir, 'PROJECT_BRIEF.md'), '# Brief');
    writeFileSync(join(projectDir, 'RUNBOOK.md'), '# Runbook');
    mkdirSync(join(projectDir, 'workflows'), { recursive: true });
    mkdirSync(join(projectDir, 'memory'), { recursive: true });

    const result = executeVerify('testproj');
    expect(result.success).toBe(true);
    expect(result.verification).toBeDefined();
    expect(result.verification!.valid).toBe(true);
  });

  it('returns errors for missing required files', () => {
    const projectDir = join(tmpDir, 'incomplete');
    mkdirSync(projectDir, { recursive: true });
    registerProject('incomplete', projectDir);

    const result = executeVerify('incomplete');
    expect(result.success).toBe(false);
    expect(result.verification).toBeDefined();
    expect(result.verification!.errors.length).toBeGreaterThan(0);
  });
});
