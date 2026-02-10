import type { AgentConfig } from '../lib/types.js';
import { getProjectDir, TEMPLATE_DIR } from '../lib/config.js';
import { loadPrompt } from '../lib/prompts.js';
import { pathEnforcementCallback } from '../lib/callbacks.js';

export function getSyncTemplateAgentConfig(project: string): AgentConfig {
  const projectDir = getProjectDir(project);
  return {
    prompt: loadPrompt('sync-template', 'sync_template', {
      project,
      templateDir: TEMPLATE_DIR(),
      projectDir,
    }),
    cwd: projectDir,
    additionalDirectories: [TEMPLATE_DIR()],
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'acceptEdits',
    maxTurns: 20,
    canUseTool: pathEnforcementCallback(projectDir, [TEMPLATE_DIR()]),
  };
}
