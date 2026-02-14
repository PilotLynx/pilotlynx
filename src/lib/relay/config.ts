import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getConfigRoot } from '../config.js';
import { WebhookConfigSchema, RelayConfigSchema } from './types.js';
import type { WebhookConfig, RelayConfig } from './types.js';

export function loadWebhookConfig(): WebhookConfig | null {
  const configPath = join(getConfigRoot(), 'webhook.yaml');
  if (!existsSync(configPath)) return null;

  const raw = parseYaml(readFileSync(configPath, 'utf8'));
  return WebhookConfigSchema.parse(raw);
}

let _relayConfigCache: RelayConfig | null = null;

export function resetRelayConfigCache(): void {
  _relayConfigCache = null;
}

export function loadRelayConfig(): RelayConfig | null {
  if (_relayConfigCache) return _relayConfigCache;

  const configPath = join(getConfigRoot(), 'relay.yaml');
  if (!existsSync(configPath)) return null;

  const raw = parseYaml(readFileSync(configPath, 'utf8'));
  _relayConfigCache = RelayConfigSchema.parse(raw);
  return _relayConfigCache;
}

export function getRelayDbPath(): string {
  return join(getConfigRoot(), 'relay.sqlite3');
}
