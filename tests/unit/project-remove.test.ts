import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import {
  resetRegistryCache,
  registerProject,
  unregisterProject,
  isRegistered,
} from '../../src/lib/registry.js';

describe('project remove', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PILOTLYNX_ROOT = origEnv;
    } else {
      delete process.env.PILOTLYNX_ROOT;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('removes project from registry', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(projDir, { recursive: true });
    registerProject('myapp', projDir);
    expect(isRegistered('myapp')).toBe(true);

    unregisterProject('myapp');
    resetRegistryCache();
    expect(isRegistered('myapp')).toBe(false);
  });

  it('throws when removing non-existent project', () => {
    expect(() => unregisterProject('nonexistent')).toThrow('not registered');
  });

  it('directory remains intact after unregister', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'CLAUDE.md'), '# test');
    registerProject('myapp', projDir);

    unregisterProject('myapp');

    // Directory should still exist
    expect(existsSync(projDir)).toBe(true);
    expect(existsSync(join(projDir, 'CLAUDE.md'))).toBe(true);
  });

  it('directory can be deleted after unregister', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'CLAUDE.md'), '# test');
    registerProject('myapp', projDir);

    unregisterProject('myapp');
    rmSync(projDir, { recursive: true, force: true });

    expect(existsSync(projDir)).toBe(false);
    resetRegistryCache();
    expect(isRegistered('myapp')).toBe(false);
  });

  it('can re-register after removal', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(projDir, { recursive: true });
    registerProject('myapp', projDir);
    unregisterProject('myapp');

    resetRegistryCache();
    registerProject('myapp', projDir);
    expect(isRegistered('myapp')).toBe(true);
  });

  it('removing one project does not affect others', () => {
    const dir1 = join(tmpDir, 'proj1');
    const dir2 = join(tmpDir, 'proj2');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    registerProject('proj1', dir1);
    registerProject('proj2', dir2);

    unregisterProject('proj1');
    resetRegistryCache();

    expect(isRegistered('proj1')).toBe(false);
    expect(isRegistered('proj2')).toBe(true);
  });
});
