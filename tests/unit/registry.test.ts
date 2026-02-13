import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import {
  loadRegistry,
  saveRegistry,
  registerProject,
  unregisterProject,
  resolveProjectPath,
  isRegistered,
  getRegisteredProjects,
  resetRegistryCache,
} from '../../src/lib/registry.js';

describe('registry', () => {
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

  describe('loadRegistry', () => {
    it('returns empty registry when file does not exist', () => {
      const reg = loadRegistry();
      expect(reg).toEqual({ version: 1, projects: {} });
    });

    it('parses existing registry file', () => {
      writeFileSync(
        join(configDir, 'projects.yaml'),
        YAML.stringify({ version: 1, projects: { myapp: { path: 'myapp' } } })
      );
      const reg = loadRegistry();
      expect(reg.projects.myapp).toEqual({ path: 'myapp' });
    });
  });

  describe('saveRegistry', () => {
    it('writes registry to YAML file', () => {
      const reg = { version: 1, projects: { foo: { path: 'foo' } } };
      saveRegistry(reg);
      const raw = YAML.parse(readFileSync(join(configDir, 'projects.yaml'), 'utf8'));
      expect(raw.projects.foo.path).toBe('foo');
    });
  });

  describe('registerProject', () => {
    it('adds entry and persists', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('myapp', projDir);

      resetRegistryCache();
      const reg = loadRegistry();
      expect(reg.projects.myapp).toBeDefined();
      expect(reg.projects.myapp.path).toBe(projDir);
    });

    it('throws on duplicate name', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('myapp', projDir);
      expect(() => registerProject('myapp', projDir)).toThrow('already registered');
    });

    it('throws on reserved pilotlynx name', () => {
      expect(() => registerProject('pilotlynx', '/some/path')).toThrow('reserved');
    });

    it('throws on duplicate path', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('name1', projDir);
      expect(() => registerProject('name2', projDir)).toThrow('already registered as project');
    });

    it('always stores absolute path', () => {
      const projDir = join(tmpDir, 'localproj');
      mkdirSync(projDir, { recursive: true });
      registerProject('localproj', projDir);

      const reg = loadRegistry();
      expect(reg.projects.localproj.path).toBe(projDir);
    });

    it('stores absolute path for external directories', () => {
      const externalDir = mkdtempSync(join(tmpdir(), 'pilotlynx-external-'));
      registerProject('external', externalDir);

      const reg = loadRegistry();
      expect(reg.projects.external.path).toBe(externalDir);

      rmSync(externalDir, { recursive: true, force: true });
    });
  });

  describe('unregisterProject', () => {
    it('removes entry', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('myapp', projDir);
      unregisterProject('myapp');

      resetRegistryCache();
      expect(isRegistered('myapp')).toBe(false);
    });

    it('throws for unknown project', () => {
      expect(() => unregisterProject('nonexistent')).toThrow('not registered');
    });
  });

  describe('resolveProjectPath', () => {
    it('returns absolute path for relative entry', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('myapp', projDir);

      const resolved = resolveProjectPath('myapp');
      expect(resolved).toBe(projDir);
    });

    it('returns absolute path as-is for absolute entry', () => {
      const externalDir = mkdtempSync(join(tmpdir(), 'pilotlynx-ext-'));
      registerProject('ext', externalDir);

      const resolved = resolveProjectPath('ext');
      expect(resolved).toBe(externalDir);

      rmSync(externalDir, { recursive: true, force: true });
    });

    it('throws for unknown project', () => {
      expect(() => resolveProjectPath('nope')).toThrow('not registered');
    });
  });

  describe('isRegistered', () => {
    it('returns false for unregistered project', () => {
      expect(isRegistered('nope')).toBe(false);
    });

    it('returns true for registered project', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('myapp', projDir);
      expect(isRegistered('myapp')).toBe(true);
    });
  });

  describe('getRegisteredProjects', () => {
    it('returns empty for empty registry', () => {
      expect(getRegisteredProjects()).toEqual({});
    });

    it('returns all entries with resolved paths', () => {
      const projDir = join(tmpDir, 'myapp');
      mkdirSync(projDir, { recursive: true });
      registerProject('myapp', projDir);

      const projects = getRegisteredProjects();
      expect(projects.myapp).toBeDefined();
      expect(projects.myapp.path).toBe(projDir);
      expect(projects.myapp.absolutePath).toBe(projDir);
    });
  });
});
