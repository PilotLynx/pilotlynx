import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { acquireRunLock, isRunLocked } from '../../../src/lib/relay/locks.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../../src/lib/registry.js';

describe('relay locks', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-relay-locks-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    writeFileSync(join(configDir, 'projects.yaml'), stringifyYaml({ version: 1, projects: {} }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    // Create and register a test project
    const projectDir = join(tmpDir, 'test-project');
    mkdirSync(projectDir, { recursive: true });
    registerProject('test-project', projectDir);
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('acquires and releases a lock', async () => {
    const release = await acquireRunLock('test-project');
    expect(release).not.toBeNull();

    const locked = await isRunLocked('test-project');
    expect(locked).toBe(true);

    await release!();

    const lockedAfter = await isRunLocked('test-project');
    expect(lockedAfter).toBe(false);
  });

  it('returns null when lock is already held', async () => {
    const release = await acquireRunLock('test-project');
    expect(release).not.toBeNull();

    const second = await acquireRunLock('test-project');
    expect(second).toBeNull();

    await release!();
  });

  it('isRunLocked returns false when no lock file exists', async () => {
    // Project exists but no lock file created yet
    const locked = await isRunLocked('test-project');
    expect(locked).toBe(false);
  });
});
