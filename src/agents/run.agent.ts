import type { AgentConfig } from '../lib/types.js';
import { getProjectDir, SHARED_DOCS_DIR, INSIGHTS_DIR } from '../lib/config.js';
import { buildProjectTools } from '../lib/tools.js';
import { loadPrompt } from '../lib/prompts.js';
import { detectSandbox } from '../lib/sandbox.js';
import { pathEnforcementCallback } from '../lib/callbacks.js';

export { pathEnforcementCallback } from '../lib/callbacks.js';

export function getRunAgentConfig(
  project: string,
  workflow: string,
  projectEnv: Record<string, string>,
  feedbackPrompt?: string,
): AgentConfig {
  const projectDir = getProjectDir(project);
  const toolPolicy = buildProjectTools(project);
  const promptName = feedbackPrompt ? 'run_with_feedback' : 'run_default';
  const vars: Record<string, string> = { workflow };
  if (feedbackPrompt) vars.feedback = feedbackPrompt;
  const prompt = loadPrompt('run', promptName, vars);

  const sandbox = detectSandbox();
  if (sandbox.level === 'kernel') {
    console.error(`[plynx] Filesystem sandbox: ${sandbox.mechanism} (kernel-level isolation)`);
  } else {
    console.error('[plynx] Filesystem sandbox: regex-only (bwrap not available)');
  }

  return {
    prompt,
    cwd: projectDir,
    additionalDirectories: [SHARED_DOCS_DIR(), INSIGHTS_DIR()],
    env: projectEnv,
    allowedTools: toolPolicy.allowedTools.length > 0 ? toolPolicy.allowedTools : undefined,
    disallowedTools: toolPolicy.disallowedTools.length > 0 ? toolPolicy.disallowedTools : undefined,
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 50,
    canUseTool: pathEnforcementCallback(projectDir, [SHARED_DOCS_DIR(), INSIGHTS_DIR()]),
  };
}
