import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import envPaths from 'env-paths';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { GlobalConfigSchema, type GlobalConfig } from './types.js';

const paths = envPaths('pilotlynx', { suffix: '' });

let _cache: GlobalConfig | null | undefined;

export function getGlobalConfigDir(): string {
  return paths.config;
}

export function getGlobalConfigPath(): string {
  return join(paths.config, 'config.yaml');
}

export function loadGlobalConfig(): GlobalConfig | null {
  if (_cache !== undefined) return _cache;

  const file = getGlobalConfigPath();
  if (!existsSync(file)) {
    _cache = null;
    return null;
  }

  try {
    const raw = parseYaml(readFileSync(file, 'utf8'));
    const config = GlobalConfigSchema.parse(raw);
    _cache = config;
    return config;
  } catch (err) {
    console.warn(`[pilotlynx] Warning: global config is corrupt, ignoring: ${file}`, err instanceof Error ? err.message : err);
    _cache = null;
    return null;
  }
}

export function saveGlobalConfig(configRoot: string): void {
  const dir = getGlobalConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getGlobalConfigPath(), stringifyYaml({ configRoot }), 'utf8');
  _cache = { configRoot };
}

export function removeGlobalConfig(): void {
  const file = getGlobalConfigPath();
  if (existsSync(file)) {
    unlinkSync(file);
  }
  _cache = undefined;
}

export function resetGlobalConfigCache(): void {
  _cache = undefined;
}
