import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { loadRelayConfig, resetRelayConfigCache, getRelayDir } from '../../../src/lib/relay/config.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';

describe('relay config', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-relay-cfg-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRelayConfigCache();
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRelayConfigCache();
  });

  it('returns null when relay.yaml does not exist', () => {
    expect(loadRelayConfig()).toBeNull();
  });

  it('loads a valid relay.yaml', () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
      }),
    );
    const config = loadRelayConfig();
    expect(config).not.toBeNull();
    expect(config!.version).toBe(1);
    expect(config!.channels.telegram.enabled).toBe(true);
  });

  it('reads config fresh each time (no caching)', () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({ version: 1, enabled: true }),
    );
    const a = loadRelayConfig();
    expect(a!.enabled).toBe(true);

    // Update the file
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({ version: 1, enabled: false }),
    );
    const b = loadRelayConfig();
    expect(b!.enabled).toBe(false);
  });

  it('getRelayDir returns path under config root', () => {
    const dir = getRelayDir();
    expect(dir).toBe(join(configDir, 'relay'));
  });
});
