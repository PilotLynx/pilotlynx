import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getConfigRoot, ENV_FILE } from '../config.js';
import { loadRootEnv } from '../env-loader.js';
import { RelayConfigSchema } from './types.js';
import type { RelayConfig } from './types.js';

export function resetRelayConfigCache(): void {}

export function getRelayDir(): string {
  return join(getConfigRoot(), 'relay');
}

export function loadRelayConfig(): RelayConfig | null {
  const configPath = join(getConfigRoot(), 'relay.yaml');
  if (!existsSync(configPath)) return null;

  const raw = parseYaml(readFileSync(configPath, 'utf8'));
  return RelayConfigSchema.parse(raw);
}

export function getTelegramToken(): string | undefined {
  const allEnv = loadRootEnv(ENV_FILE());
  return allEnv.TELEGRAM_BOT_TOKEN;
}
