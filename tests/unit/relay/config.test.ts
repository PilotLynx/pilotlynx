import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { loadWebhookConfig } from '../../../src/lib/relay/config.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';

describe('webhook config', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-webhook-cfg-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'pilotlynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('returns null when webhook.yaml does not exist', () => {
    expect(loadWebhookConfig()).toBeNull();
  });

  it('loads a valid webhook.yaml', () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          { name: 'slack', url: 'https://hooks.slack.com/test', events: ['run_complete'] },
        ],
      }),
    );
    const config = loadWebhookConfig();
    expect(config).not.toBeNull();
    expect(config!.version).toBe(1);
    expect(config!.enabled).toBe(true);
    expect(config!.webhooks).toHaveLength(1);
    expect(config!.webhooks[0].name).toBe('slack');
  });

  it('reads config fresh each time (no caching)', () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({ version: 1, enabled: true, webhooks: [] }),
    );
    const a = loadWebhookConfig();
    expect(a!.enabled).toBe(true);

    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({ version: 1, enabled: false, webhooks: [] }),
    );
    const b = loadWebhookConfig();
    expect(b!.enabled).toBe(false);
  });

});
