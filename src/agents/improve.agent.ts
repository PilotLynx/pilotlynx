import type { AgentConfig, CanUseToolResult } from '../lib/types.js';
import { getWorkspaceRoot, SHARED_DIR, ENV_FILE } from '../lib/config.js';
import { loadPrompt, loadSystemPrompt } from '../lib/prompts.js';
import { resolve, dirname } from 'node:path';

function improveToolCallback(): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const envFile = resolve(ENV_FILE());
  const envDir = dirname(envFile);
  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    const filePath = (input as any)?.file_path ?? (input as any)?.path;
    if (filePath) {
      const resolved = resolve(filePath);
      // Deny access to .env files in config root
      if (resolved === envFile || /[/\\]\.env(\..+)?$/.test(resolved)) {
        if (resolved.startsWith(envDir)) {
          return { behavior: 'deny', message: 'Cannot access .env files' };
        }
      }
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

export function getImproveAgentConfig(logSummaries: Record<string, string>): AgentConfig {
  const summaryText = Object.entries(logSummaries)
    .map(([project, summary]) => `## ${project}\n${summary}`)
    .join('\n\n');

  return {
    prompt: loadPrompt('improve', 'improve_analyze', { summaryText }),
    cwd: getWorkspaceRoot(),
    allowedTools: ['Read', 'Glob', 'Grep'],
    // Intentional: uses string systemPrompt (not preset 'claude_code') because
    // this agent is read-only and doesn't need CLAUDE.md context or Claude Code tools.
    systemPrompt: loadSystemPrompt('improve', 'improve_analyze')!,
    maxTurns: 10,
    canUseTool: improveToolCallback(),
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          projectFeedback: {
            type: 'object',
            description: 'Map of project name to feedback string',
            additionalProperties: { type: 'string' },
          },
          crossProjectInsights: {
            type: 'string',
            description: 'Abstract cross-project learnings, no project names or secrets',
          },
        },
        required: ['projectFeedback', 'crossProjectInsights'],
      },
    },
  };
}
