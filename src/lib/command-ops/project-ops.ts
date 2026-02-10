import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProjectFromTemplate, addScaffolding } from '../project.js';
import { isRegistered, registerProject } from '../registry.js';
import { getConfigRoot, ENV_FILE } from '../config.js';
import { runAgent } from '../agent-runner.js';
import { getProjectCreateAgentConfig } from '../../agents/project-create.agent.js';
import { getProjectAddAgentConfig } from '../../agents/project-add.agent.js';
import { validateProjectName } from '../validation.js';
import { executeSecretsMigration } from './secrets-migration-ops.js';

export interface ProjectCreateResult {
  success: boolean;
  error?: string;
}

export async function executeProjectCreate(
  name: string,
  availableKeys: string[],
  currentPolicy: string,
): Promise<ProjectCreateResult> {
  validateProjectName(name);

  createProjectFromTemplate(name);

  const config = getProjectCreateAgentConfig(name, availableKeys, currentPolicy);
  const result = await runAgent(config);

  if (!result.success) {
    return { success: false, error: result.result };
  }

  return { success: true };
}

export interface ProjectAddResult {
  success: boolean;
  error?: string;
  added?: string[];
  skipped?: string[];
}

export async function executeProjectAdd(
  name: string,
  targetPath: string,
  availableKeys: string[],
  currentPolicy: string,
): Promise<ProjectAddResult> {
  validateProjectName(name);
  const resolved = resolve(targetPath);

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return { success: false, error: `Directory does not exist: ${resolved}` };
  }

  const configRoot = getConfigRoot();
  if (resolved === resolve(configRoot) || resolved.startsWith(resolve(configRoot) + '/')) {
    return { success: false, error: 'Cannot register the PilotLynx config directory as a project' };
  }

  if (isRegistered(name)) {
    return { success: false, error: `Project "${name}" is already registered` };
  }

  const { added, skipped } = addScaffolding(name, resolved);
  registerProject(name, resolved);

  // Auto-migrate secrets before handing off to the agent
  const migrationResult = await executeSecretsMigration(name, resolved);

  // Re-read available keys (migration may have added new ones to central .env)
  if (migrationResult.migrated) {
    const envFile = ENV_FILE();
    if (existsSync(envFile)) {
      const content = readFileSync(envFile, 'utf8');
      availableKeys = content.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => l.split('=')[0].trim());
    }
  }

  const config = getProjectAddAgentConfig(name, availableKeys, currentPolicy, migrationResult.summary);
  const result = await runAgent(config);

  if (!result.success) {
    return { success: false, error: result.result, added, skipped };
  }

  return { success: true, added, skipped };
}
