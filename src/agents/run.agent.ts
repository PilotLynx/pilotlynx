import type { AgentConfig } from '../lib/types.js';
import { getProjectDir, SHARED_DOCS_DIR, INSIGHTS_DIR } from '../lib/config.js';
import { buildProjectTools } from '../lib/tools.js';
import { loadPrompt } from '../lib/prompts.js';
import { detectSandbox } from '../lib/sandbox.js';
import { pathEnforcementCallback, feedbackPathEnforcementCallback } from '../lib/callbacks.js';

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
    console.error(`[pilotlynx] Filesystem sandbox: ${sandbox.mechanism} (kernel-level isolation)`);
  } else {
    console.error('[pilotlynx] Filesystem sandbox: regex-only (bwrap not available)');
  }

  const isFeedbackRun = !!feedbackPrompt;
  const additionalDirs = [SHARED_DOCS_DIR(), INSIGHTS_DIR()];

  return {
    prompt,
    cwd: projectDir,
    additionalDirectories: additionalDirs,
    env: projectEnv,
    allowedTools: toolPolicy.allowedTools.length > 0 ? toolPolicy.allowedTools : undefined,
    disallowedTools: toolPolicy.disallowedTools.length > 0 ? toolPolicy.disallowedTools : undefined,
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: isFeedbackRun ? 20 : 50,
    canUseTool: isFeedbackRun
      ? feedbackPathEnforcementCallback(projectDir, additionalDirs)
      : pathEnforcementCallback(projectDir, additionalDirs),
  };
}
