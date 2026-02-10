import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';

// We override the global config dir via env before importing — env-paths reads HOME
const origXdg = process.env.XDG_CONFIG_HOME;

describe('global-config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-gc-'));
    // Point XDG_CONFIG_HOME so env-paths('pilotlynx') → tmpDir/pilotlynx/
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (origXdg !== undefined) process.env.XDG_CONFIG_HOME = origXdg;
    else delete process.env.XDG_CONFIG_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Re-import fresh each time to pick up new XDG_CONFIG_HOME
  async function loadModule() {
    // env-paths caches the result at module level, so we need dynamic import
    // with cache busting. Instead, test the functions with the actual module
    // and manually reset cache.
    const mod = await import('../../src/lib/global-config.js');
    mod.resetGlobalConfigCache();
    return mod;
  }

  it('loadGlobalConfig returns null when no config file exists', async () => {
    const { loadGlobalConfig, removeGlobalConfig, resetGlobalConfigCache } = await loadModule();
    removeGlobalConfig();
    resetGlobalConfigCache();
    const result = loadGlobalConfig();
    expect(result).toBeNull();
  });

  it('saveGlobalConfig creates dir and writes valid YAML', async () => {
    const { saveGlobalConfig, getGlobalConfigPath, resetGlobalConfigCache } = await loadModule();
    resetGlobalConfigCache();
    const configPath = getGlobalConfigPath();

    saveGlobalConfig('/home/user/workspace/pilotlynx');

    expect(existsSync(configPath)).toBe(true);
    const content = parseYaml(readFileSync(configPath, 'utf8'));
    expect(content.configRoot).toBe('/home/user/workspace/pilotlynx');
  });

  it('saveGlobalConfig overwrites existing config', async () => {
    const { saveGlobalConfig, loadGlobalConfig, resetGlobalConfigCache } = await loadModule();
    resetGlobalConfigCache();

    saveGlobalConfig('/first/path');
    resetGlobalConfigCache();
    saveGlobalConfig('/second/path');
    resetGlobalConfigCache();

    const config = loadGlobalConfig();
    expect(config).not.toBeNull();
    expect(config!.configRoot).toBe('/second/path');
  });

  it('removeGlobalConfig deletes the file', async () => {
    const { saveGlobalConfig, removeGlobalConfig, getGlobalConfigPath, resetGlobalConfigCache } = await loadModule();
    resetGlobalConfigCache();

    saveGlobalConfig('/some/path');
    expect(existsSync(getGlobalConfigPath())).toBe(true);

    removeGlobalConfig();
    expect(existsSync(getGlobalConfigPath())).toBe(false);
  });

  it('loadGlobalConfig returns cached value', async () => {
    const { saveGlobalConfig, loadGlobalConfig, resetGlobalConfigCache } = await loadModule();
    resetGlobalConfigCache();

    saveGlobalConfig('/cached/path');
    resetGlobalConfigCache();

    const first = loadGlobalConfig();
    const second = loadGlobalConfig();
    expect(first).toBe(second); // Same reference (cached)
  });

  it('resetGlobalConfigCache clears the cache', async () => {
    const { saveGlobalConfig, loadGlobalConfig, resetGlobalConfigCache } = await loadModule();
    resetGlobalConfigCache();

    saveGlobalConfig('/path/one');
    resetGlobalConfigCache();

    const first = loadGlobalConfig();
    resetGlobalConfigCache();

    // Write a different value directly (simulating external change)
    saveGlobalConfig('/path/two');
    resetGlobalConfigCache();

    const second = loadGlobalConfig();
    expect(first!.configRoot).toBe('/path/one');
    expect(second!.configRoot).toBe('/path/two');
  });
});
