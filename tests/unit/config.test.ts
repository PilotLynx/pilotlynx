import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import {
  resetConfigCache,
  getPackageRoot,
  getWorkspaceRoot,
  getConfigRoot,
  getVersion,
  TEMPLATE_DIR,
  CONFIG_DIR_NAME,
} from '../../src/lib/config.js';
import { saveGlobalConfig, resetGlobalConfigCache, removeGlobalConfig } from '../../src/lib/global-config.js';

describe('config', () => {
  const origRoot = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    delete process.env.PILOTLYNX_ROOT;
    resetConfigCache();
    resetGlobalConfigCache();
  });

  afterEach(() => {
    if (origRoot !== undefined) process.env.PILOTLYNX_ROOT = origRoot;
    else delete process.env.PILOTLYNX_ROOT;
    resetConfigCache();
    resetGlobalConfigCache();
  });

  describe('getPackageRoot', () => {
    it('returns a directory containing package.json', () => {
      const root = getPackageRoot();
      expect(existsSync(join(root, 'package.json'))).toBe(true);
    });

    it('returns the same value on repeated calls (caching)', () => {
      const a = getPackageRoot();
      const b = getPackageRoot();
      expect(a).toBe(b);
    });
  });

  describe('getVersion', () => {
    it('returns a semver-like string from package root', () => {
      const v = getVersion();
      expect(v).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('getConfigRoot', () => {
    it('resolves via PILOTLYNX_ROOT env var', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plynx-cfgroot-'));
      const configDir = join(dir, CONFIG_DIR_NAME);
      mkdirSync(configDir, { recursive: true });
      process.env.PILOTLYNX_ROOT = configDir;
      resetConfigCache();

      expect(getConfigRoot()).toBe(configDir);
      rmSync(dir, { recursive: true, force: true });
    });

    it('resolves via global config file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plynx-global-'));
      const configDir = join(dir, CONFIG_DIR_NAME);
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'plynx.yaml'), YAML.stringify({ version: 1, name: 'test' }));

      saveGlobalConfig(configDir);
      resetConfigCache();

      expect(getConfigRoot()).toBe(configDir);

      removeGlobalConfig();
      rmSync(dir, { recursive: true, force: true });
    });

    it('env var takes priority over global config', () => {
      const envDir = mkdtempSync(join(tmpdir(), 'plynx-envpri-'));
      const envConfigDir = join(envDir, CONFIG_DIR_NAME);
      mkdirSync(envConfigDir, { recursive: true });

      const globalDir = mkdtempSync(join(tmpdir(), 'plynx-globpri-'));
      const globalConfigDir = join(globalDir, CONFIG_DIR_NAME);
      mkdirSync(globalConfigDir, { recursive: true });
      writeFileSync(join(globalConfigDir, 'plynx.yaml'), YAML.stringify({ version: 1, name: 'test' }));

      saveGlobalConfig(globalConfigDir);
      process.env.PILOTLYNX_ROOT = envConfigDir;
      resetConfigCache();

      expect(getConfigRoot()).toBe(envConfigDir);

      removeGlobalConfig();
      rmSync(envDir, { recursive: true, force: true });
      rmSync(globalDir, { recursive: true, force: true });
    });

    it('throws when global config points to invalid path (no plynx.yaml)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plynx-invalid-'));
      const configDir = join(dir, CONFIG_DIR_NAME);
      mkdirSync(configDir, { recursive: true });
      // No plynx.yaml created

      saveGlobalConfig(configDir);
      resetConfigCache();

      expect(() => getConfigRoot()).toThrow('Could not find PilotLynx config');

      removeGlobalConfig();
      rmSync(dir, { recursive: true, force: true });
    });

    it('throws when no env var and no global config', () => {
      removeGlobalConfig();
      resetConfigCache();
      resetGlobalConfigCache();

      expect(() => getConfigRoot()).toThrow('Could not find PilotLynx config');
    });
  });

  describe('getWorkspaceRoot', () => {
    it('returns parent of config root', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plynx-wsroot-'));
      const configDir = join(dir, CONFIG_DIR_NAME);
      mkdirSync(configDir, { recursive: true });
      process.env.PILOTLYNX_ROOT = configDir;
      resetConfigCache();

      expect(getWorkspaceRoot()).toBe(dir);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('TEMPLATE_DIR', () => {
    it('returns config root template when it exists', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plynx-tpl-'));
      const configDir = join(dir, CONFIG_DIR_NAME);
      mkdirSync(configDir, { recursive: true });
      process.env.PILOTLYNX_ROOT = configDir;
      resetConfigCache();

      const wsTemplate = join(configDir, 'template');
      mkdirSync(wsTemplate, { recursive: true });

      expect(TEMPLATE_DIR()).toBe(wsTemplate);
      rmSync(dir, { recursive: true, force: true });
    });

    it('falls back to package template when config template missing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plynx-tpl2-'));
      const configDir = join(dir, CONFIG_DIR_NAME);
      mkdirSync(configDir, { recursive: true });
      process.env.PILOTLYNX_ROOT = configDir;
      resetConfigCache();

      const result = TEMPLATE_DIR();
      expect(result).toContain('template');
      expect(result).not.toContain(configDir);
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
