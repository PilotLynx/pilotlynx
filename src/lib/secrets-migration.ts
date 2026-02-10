import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRootEnv } from './env-loader.js';

// ── Types ──

export interface DetectedSecrets {
  /** Keys found in the project's .env file */
  envKeys: Map<string, string>;
  /** Literal values found in .mcp.json env blocks (key → value) */
  mcpLiterals: Map<string, string>;
}

export type MigrationCategory = 'new' | 'deduplicated' | 'conflicting';

export interface CategorizedKey {
  key: string;
  category: MigrationCategory;
  source: '.env' | '.mcp.json';
}

export interface MigrationPlan {
  /** Keys categorized by migration action */
  keys: CategorizedKey[];
  /** Lines to append to central .env (new keys only) */
  envAppendLines: string[];
  /** Rewritten .mcp.json content (literals replaced with ${VAR} refs), or null if no .mcp.json */
  rewrittenMcpJson: string | null;
  /** Keys that should be added to the project's secrets-access policy */
  policyKeys: string[];
  /** True if there's nothing to migrate */
  isEmpty: boolean;
  /** All detected key→value pairs (needed for conflict resolution: rename/overwrite) */
  detectedValues: Record<string, string>;
}

// ── Detection ──

const VAR_REF_PATTERN = /^\$\{.+\}$/;

/**
 * Detect secrets in a project directory.
 * Scans .env file and .mcp.json env blocks for literal values.
 */
export function detectProjectSecrets(projectDir: string): DetectedSecrets {
  const envKeys = new Map<string, string>();
  const mcpLiterals = new Map<string, string>();

  // Parse project .env
  const envPath = join(projectDir, '.env');
  if (existsSync(envPath)) {
    const parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      envKeys.set(key, value);
    }
  }

  // Scan .mcp.json env blocks
  const mcpPath = join(projectDir, '.mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
      if (mcp.mcpServers && typeof mcp.mcpServers === 'object') {
        for (const server of Object.values(mcp.mcpServers)) {
          const env = (server as Record<string, unknown>).env;
          if (env && typeof env === 'object') {
            for (const [key, value] of Object.entries(env as Record<string, string>)) {
              if (typeof value === 'string' && !VAR_REF_PATTERN.test(value)) {
                mcpLiterals.set(key, value);
              }
            }
          }
        }
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  return { envKeys, mcpLiterals };
}

// ── Planning ──

/**
 * Build a migration plan by comparing detected secrets against the central .env.
 */
export function buildMigrationPlan(
  projectDir: string,
  centralEnvPath: string,
): MigrationPlan {
  const detected = detectProjectSecrets(projectDir);
  const centralEnv = loadRootEnv(centralEnvPath);

  // Merge all detected keys (envKeys take precedence for value if key appears in both)
  const allDetected = new Map<string, { value: string; source: '.env' | '.mcp.json' }>();

  for (const [key, value] of detected.mcpLiterals) {
    allDetected.set(key, { value, source: '.mcp.json' });
  }
  for (const [key, value] of detected.envKeys) {
    allDetected.set(key, { value, source: '.env' });
  }

  const keys: CategorizedKey[] = [];
  const envAppendLines: string[] = [];
  const policyKeys: string[] = [];

  for (const [key, { value, source }] of allDetected) {
    if (key in centralEnv) {
      if (centralEnv[key] === value) {
        keys.push({ key, category: 'deduplicated', source });
      } else {
        keys.push({ key, category: 'conflicting', source });
      }
    } else {
      keys.push({ key, category: 'new', source });
      envAppendLines.push(`${key}=${value}`);
    }

    // All non-conflicting keys get policy entries
    if (!(key in centralEnv) || centralEnv[key] === value) {
      policyKeys.push(key);
    }
  }

  // Build rewritten .mcp.json
  let rewrittenMcpJson: string | null = null;
  const mcpPath = join(projectDir, '.mcp.json');
  if (existsSync(mcpPath) && detected.mcpLiterals.size > 0) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
      // Only rewrite non-conflicting literals
      const conflictingKeys = new Set(
        keys.filter(k => k.category === 'conflicting').map(k => k.key),
      );

      for (const server of Object.values(mcp.mcpServers ?? {})) {
        const env = (server as Record<string, unknown>).env;
        if (env && typeof env === 'object') {
          for (const key of Object.keys(env as Record<string, string>)) {
            if (detected.mcpLiterals.has(key) && !conflictingKeys.has(key)) {
              (env as Record<string, string>)[key] = `\${${key}}`;
            }
          }
        }
      }
      rewrittenMcpJson = JSON.stringify(mcp, null, 2) + '\n';
    } catch {
      // Invalid JSON — skip rewrite
    }
  }

  const detectedValues: Record<string, string> = {};
  for (const [key, { value }] of allDetected) {
    detectedValues[key] = value;
  }

  return {
    keys,
    envAppendLines,
    rewrittenMcpJson,
    policyKeys,
    isEmpty: allDetected.size === 0,
    detectedValues,
  };
}
