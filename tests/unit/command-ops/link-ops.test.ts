import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { registerProject, resetRegistryCache } from '../../../src/lib/registry.js';
import { executeLink, executeUnlink } from '../../../src/lib/command-ops/link-ops.js';

describe('link-ops', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-link-ops-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'proj');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
    mkdirSync(projectDir, { recursive: true });
    registerProject('proj', projectDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
    resetRegistryCache();
  });

  describe('executeLink', () => {
    it('returns error for unregistered project', () => {
      const result = executeLink('fake', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not registered');
    });

    it('creates .claude/settings.json with PILOTLYNX_ROOT', () => {
      const result = executeLink('proj', {});
      expect(result.success).toBe(true);
      expect(result.updatedSettings).toBe(true);

      const settings = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.env.PILOTLYNX_ROOT).toBe(configDir);
    });

    it('generates .envrc with --direnv', () => {
      writeFileSync(join(configDir, '.env'), 'KEY=val\n');
      writeFileSync(
        join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
        'version: 1\nshared:\n  - KEY\nprojects: {}\n'
      );

      const result = executeLink('proj', { direnv: true });
      expect(result.success).toBe(true);
      expect(result.generatedEnvrc).toBe(true);
      expect(existsSync(join(projectDir, '.envrc'))).toBe(true);
    });
  });

  describe('executeUnlink', () => {
    it('returns error for unregistered project', () => {
      const result = executeUnlink('fake');
      expect(result.success).toBe(false);
    });

    it('removes PILOTLYNX_ROOT from settings', () => {
      // First link
      executeLink('proj', {});
      // Then unlink
      const result = executeUnlink('proj');
      expect(result.success).toBe(true);
      expect(result.removedSettings).toBe(true);

      const settings = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.env.PILOTLYNX_ROOT).toBeUndefined();
    });
  });
});
