import chalk from 'chalk';
import { ENV_FILE, POLICIES_DIR } from './config.js';
import { loadRootEnv } from './env-loader.js';
import { loadPolicy } from './policy.js';
import { SecretsAccessPolicySchema } from './types.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Keys matching these prefixes are NEVER injected into project agent runs.
// Relay credentials must stay isolated from project sandboxes.
const RELAY_CREDENTIAL_PREFIXES = ['SLACK_', 'TELEGRAM_', 'RELAY_'];

function isRelayCredential(key: string): boolean {
  return RELAY_CREDENTIAL_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function buildProjectEnv(projectName: string): Record<string, string> {
  const allEnv = loadRootEnv(ENV_FILE());
  const policyPath = join(POLICIES_DIR(), 'secrets-access.yaml');
  if (!existsSync(policyPath)) {
    return {};
  }
  const policy = loadPolicy(policyPath, SecretsAccessPolicySchema);

  const projectPolicy = policy.projects[projectName];
  const allowedSet = new Set<string>([
    ...policy.shared,
    ...(projectPolicy?.allowed ?? []),
  ]);

  const result: Record<string, string> = {};
  const missingKeys: string[] = [];

  for (const key of allowedSet) {
    if (isRelayCredential(key)) continue;
    if (key in allEnv) {
      result[key] = allEnv[key];
    } else {
      missingKeys.push(key);
    }
  }

  if (projectPolicy?.mappings) {
    for (const [newKey, envKey] of Object.entries(projectPolicy.mappings)) {
      if (isRelayCredential(newKey) || isRelayCredential(envKey)) continue;
      if (envKey in allEnv) {
        result[newKey] = allEnv[envKey];
      } else if (!missingKeys.includes(envKey)) {
        missingKeys.push(envKey);
      }
    }
  }

  if (missingKeys.length > 0) {
    console.warn(chalk.yellow(
      `[pilotlynx] Warning: Policy for "${projectName}" references keys not found in .env: ${missingKeys.join(', ')}`
    ));
  }

  return result;
}
