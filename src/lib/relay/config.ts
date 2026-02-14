import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getConfigRoot } from '../config.js';
import { WebhookConfigSchema } from './types.js';
import type { WebhookConfig } from './types.js';

export function loadWebhookConfig(): WebhookConfig | null {
  const configPath = join(getConfigRoot(), 'webhook.yaml');
  if (!existsSync(configPath)) return null;

  const raw = parseYaml(readFileSync(configPath, 'utf8'));
  return WebhookConfigSchema.parse(raw);
}
