import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { buildMigrationPlan, type MigrationPlan } from '../secrets-migration.js';
import { ENV_FILE, POLICIES_DIR } from '../config.js';
import { runAgent } from '../agent-runner.js';
import { getSecretsMigrationAgentConfig, type MigrationAgentOutput } from '../../agents/secrets-migration.agent.js';

// ── Types ──

export interface SecretsMigrationResult {
  /** Whether migration was performed */
  migrated: boolean;
  /** Keys that were successfully migrated */
  migratedKeys: string[];
  /** Keys skipped due to conflicts */
  conflictingKeys: string[];
  /** Summary string for the agent prompt */
  summary: string;
}

// ── Conflict Resolution ──

/**
 * Transform a migration plan based on agent conflict resolutions.
 * - skip: key stays excluded (no change)
 * - rename: project value stored under newName, added to envAppendLines + policyKeys
 * - overwrite: key promoted to 'new', added to envAppendLines + policyKeys + overwriteKeys
 */
export function applyConflictResolutions(
  plan: MigrationPlan,
  resolutions: MigrationAgentOutput['conflictResolutions'],
): { resolvedPlan: MigrationPlan; overwriteKeys: Record<string, string> } {
  const overwriteKeys: Record<string, string> = {};
  const resolvedPlan: MigrationPlan = {
    ...plan,
    envAppendLines: [...plan.envAppendLines],
    policyKeys: [...plan.policyKeys],
    keys: [...plan.keys],
  };

  for (const [key, resolution] of Object.entries(resolutions)) {
    const value = plan.detectedValues[key];
    if (value === undefined) continue;

    switch (resolution.action) {
      case 'skip':
        // No changes — key stays excluded
        break;

      case 'rename': {
        const newName = resolution.newName;
        if (!newName) break;
        resolvedPlan.envAppendLines.push(`${newName}=${value}`);
        resolvedPlan.policyKeys.push(newName);
        break;
      }

      case 'overwrite': {
        overwriteKeys[key] = value;
        resolvedPlan.policyKeys.push(key);
        break;
      }
    }
  }

  return { resolvedPlan, overwriteKeys };
}

/**
 * Replace an existing key's value in a .env file.
 * If the key doesn't exist, this is a no-op.
 */
export function replaceEnvKey(envPath: string, key: string, newValue: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const updated = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      return `${key}=${newValue}`;
    }
    return line;
  });
  writeFileSync(envPath, updated.join('\n'));
}

// ── Apply Migration ──

export function applyMigration(
  projectName: string,
  projectDir: string,
  plan: MigrationPlan,
  overwriteKeys?: Record<string, string>,
): void {
  const centralEnvPath = ENV_FILE();
  const projectEnvPath = join(projectDir, '.env');

  // Overwrite existing keys in central .env
  if (overwriteKeys) {
    for (const [key, value] of Object.entries(overwriteKeys)) {
      replaceEnvKey(centralEnvPath, key, value);
    }
  }

  // Append new keys to central .env
  if (plan.envAppendLines.length > 0) {
    if (existsSync(centralEnvPath)) {
      const existing = readFileSync(centralEnvPath, 'utf8');
      const separator = existing.endsWith('\n') ? '' : '\n';
      appendFileSync(centralEnvPath, separator + plan.envAppendLines.join('\n') + '\n');
    } else {
      writeFileSync(centralEnvPath, plan.envAppendLines.join('\n') + '\n');
    }
  }

  // Rewrite .mcp.json with ${VAR} references
  if (plan.rewrittenMcpJson) {
    writeFileSync(join(projectDir, '.mcp.json'), plan.rewrittenMcpJson);
  }

  // Backup and remove project .env
  if (existsSync(projectEnvPath)) {
    renameSync(projectEnvPath, join(projectDir, '.env.plynx-backup'));
  }

  // Update secrets-access policy
  if (plan.policyKeys.length > 0) {
    updateSecretsPolicy(projectName, plan.policyKeys);
  }
}

function updateSecretsPolicy(projectName: string, keys: string[]): void {
  const policyPath = join(POLICIES_DIR(), 'secrets-access.yaml');

  let policy: { version: number; shared: string[]; projects: Record<string, { allowed?: string[]; mappings?: Record<string, string> }> };

  if (existsSync(policyPath)) {
    policy = parseYaml(readFileSync(policyPath, 'utf8'));
  } else {
    policy = { version: 1, shared: [], projects: {} };
  }

  // Filter out keys already in shared list
  const sharedSet = new Set(policy.shared);
  const projectKeys = keys.filter(k => !sharedSet.has(k));

  if (projectKeys.length === 0) return;

  if (!policy.projects[projectName]) {
    policy.projects[projectName] = {};
  }

  const existing = new Set(policy.projects[projectName].allowed ?? []);
  for (const key of projectKeys) {
    existing.add(key);
  }
  policy.projects[projectName].allowed = [...existing].sort();

  writeFileSync(policyPath, stringifyYaml(policy));
}

// ── Orchestration ──

export async function executeSecretsMigration(
  projectName: string,
  projectDir: string,
): Promise<SecretsMigrationResult> {
  const plan = buildMigrationPlan(projectDir, ENV_FILE());

  if (plan.isEmpty) {
    return { migrated: false, migratedKeys: [], conflictingKeys: [], summary: '' };
  }

  // Run the secrets migration agent for user confirmation + conflict resolution
  const agentConfig = getSecretsMigrationAgentConfig({ projectName, plan });
  const result = await runAgent(agentConfig);

  if (!result.success || !result.structuredOutput) {
    return { migrated: false, migratedKeys: [], conflictingKeys: [], summary: '' };
  }

  const output = result.structuredOutput as MigrationAgentOutput;

  if (!output.approved) {
    return { migrated: false, migratedKeys: [], conflictingKeys: [], summary: '' };
  }

  // Apply conflict resolutions to the plan
  const { resolvedPlan, overwriteKeys } = applyConflictResolutions(
    plan,
    output.conflictResolutions ?? {},
  );

  applyMigration(projectName, projectDir, resolvedPlan, overwriteKeys);

  const conflicts = plan.keys.filter(k => k.category === 'conflicting');
  const skippedConflicts = conflicts
    .filter(k => {
      const resolution = output.conflictResolutions?.[k.key];
      return !resolution || resolution.action === 'skip';
    })
    .map(k => k.key);

  return {
    migrated: true,
    migratedKeys: resolvedPlan.policyKeys,
    conflictingKeys: skippedConflicts,
    summary: buildSummary(resolvedPlan.policyKeys, skippedConflicts),
  };
}

function buildSummary(migratedKeys: string[], conflictingKeys: string[]): string {
  const parts: string[] = [];
  if (migratedKeys.length > 0) {
    parts.push(`Migrated keys: ${migratedKeys.join(', ')}`);
  }
  if (conflictingKeys.length > 0) {
    parts.push(`Conflicting keys (skipped, need manual resolution): ${conflictingKeys.join(', ')}`);
  }
  if (parts.length === 0) return '';
  return `- Secrets auto-migration already ran: ${parts.join('. ')}. The policy has been updated with migrated keys.`;
}
