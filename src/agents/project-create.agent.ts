import type { AgentConfig } from '../lib/types.js';
import { getProjectDir, POLICIES_DIR } from '../lib/config.js';
import { loadPrompt } from '../lib/prompts.js';
import { join } from 'node:path';
import { projectSetupCallback } from '../lib/callbacks.js';

export function getProjectCreateAgentConfig(
  name: string,
  availableSecretKeys: string[] = [],
  currentSecretsPolicy: string = '',
): AgentConfig {
  const projectDir = getProjectDir(name);
  return {
    prompt: loadPrompt('project-create', 'project_create', {
      name,
      projectDir,
      availableSecretKeys: availableSecretKeys.join(', ') || '(none configured)',
      currentSecretsPolicy: currentSecretsPolicy || 'version: 1\nshared: []\nprojects: {}\n',
      secretsPolicyPath: join(POLICIES_DIR(), 'secrets-access.yaml'),
    }),
    cwd: projectDir,
    additionalDirectories: [POLICIES_DIR()],
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Bash', 'AskUserQuestion'],
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'acceptEdits',
    maxTurns: 20,
    canUseTool: projectSetupCallback(projectDir, POLICIES_DIR()),
  };
}
