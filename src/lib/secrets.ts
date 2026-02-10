import { ENV_FILE, POLICIES_DIR } from './config.js';
import { loadRootEnv } from './env-loader.js';
import { loadPolicy } from './policy.js';
import { SecretsAccessPolicySchema } from './types.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

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

  for (const key of allowedSet) {
    if (key in allEnv) {
      result[key] = allEnv[key];
    }
  }

  if (projectPolicy?.mappings) {
    for (const [newKey, envKey] of Object.entries(projectPolicy.mappings)) {
      if (envKey in allEnv) {
        result[newKey] = allEnv[envKey];
      }
    }
  }

  return result;
}
