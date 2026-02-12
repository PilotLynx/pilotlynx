import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { getServiceStatus } from '../../../src/lib/relay/service.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';

describe('relay service', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-relay-svc-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('getServiceStatus returns platform info', () => {
    const status = getServiceStatus();
    expect(status).toHaveProperty('installed');
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('platform');
    expect(['linux', 'macos', 'windows']).toContain(status.platform);
  });

  it('getServiceStatus returns not installed by default', () => {
    const status = getServiceStatus();
    // On a fresh test environment, no service should be installed
    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
  });
});
