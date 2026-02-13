import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { resolveProjectPath } from './registry.js';
import { loadGlobalConfig } from './global-config.js';
import { WorkspaceConfigSchema } from './types.js';
import type { WorkspaceConfig } from './types.js';

// ── Constants ──

export const CONFIG_DIR_NAME = 'pilotlynx';

// ── Caches ──

let _packageRoot: string | null = null;
let _configRoot: string | null = null;

export function resetConfigCache(): void {
  _packageRoot = null;
  _configRoot = null;
}

// ── Package Root ──

/**
 * Find the npm package root by walking up from the current file
 * to find the directory containing package.json with name "pilotlynx".
 * Works both in compiled form (dist/lib/config.js) and dev (lynx/src/lib/config.ts).
 */
export function getPackageRoot(): string {
  if (_packageRoot) return _packageRoot;

  const thisFile = fileURLToPath(import.meta.url);
  let dir = dirname(thisFile);
  while (true) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.bin?.pilotlynx) {
          _packageRoot = dir;
          return dir;
        }
      } catch {
        // not valid JSON, keep searching
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels up from this file (standard npm layout)
  _packageRoot = dirname(dirname(dirname(thisFile)));
  return _packageRoot;
}

// ── Config Root Resolution ──

/**
 * Resolve the config root (the `pilotlynx/` directory):
 * 1. PILOTLYNX_ROOT env var → direct path to config root (tests/CI)
 * 2. Global config file → read configRoot
 * 3. Error
 */
export function getConfigRoot(): string {
  if (_configRoot) return _configRoot;

  // Step 1: PILOTLYNX_ROOT env var (tests/CI)
  if (process.env.PILOTLYNX_ROOT) {
    _configRoot = process.env.PILOTLYNX_ROOT;
    return _configRoot;
  }

  // Step 2: Global config file
  const global = loadGlobalConfig();
  if (global && existsSync(join(global.configRoot, 'pilotlynx.yaml'))) {
    _configRoot = global.configRoot;
    return _configRoot;
  }

  throw new Error(
    'Could not find PilotLynx config.\n' +
    '  Run `pilotlynx init` to create a workspace.'
  );
}

// ── Path constants ──

export const SHARED_DIR = () => join(getConfigRoot(), 'shared');
export const POLICIES_DIR = () => join(getConfigRoot(), 'shared', 'policies');
export const INSIGHTS_DIR = () => join(getConfigRoot(), 'shared', 'insights');
export const SHARED_DOCS_DIR = () => join(getConfigRoot(), 'shared', 'docs');
export const ENV_FILE = () => join(getConfigRoot(), '.env');

/**
 * TEMPLATE_DIR resolves from config root first (pilotlynx/template/),
 * falling back to the bundled template in the npm package.
 */
export const TEMPLATE_DIR = (): string => {
  const wsTemplate = join(getConfigRoot(), 'template');
  if (existsSync(wsTemplate)) return wsTemplate;
  return join(getPackageRoot(), 'template');
};

export function getProjectDir(name: string): string {
  return resolveProjectPath(name);
}

export function loadWorkspaceConfig(): WorkspaceConfig {
  const raw = parseYaml(readFileSync(join(getConfigRoot(), 'pilotlynx.yaml'), 'utf8'));
  return WorkspaceConfigSchema.parse(raw);
}

export function getVersion(): string {
  try {
    const pkgPath = join(getPackageRoot(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
