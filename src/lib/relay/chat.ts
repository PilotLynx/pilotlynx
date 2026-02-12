import type { AgentConfig, CanUseToolResult } from '../types.js';
import { getProjectDir, ENV_FILE } from '../config.js';
import { loadPrompt, loadSystemPrompt } from '../prompts.js';
import { runAgent } from '../agent-runner.js';
import { resolve, dirname } from 'node:path';
import type { ConversationEntry } from './types.js';

function chatToolCallback(projectDir: string): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const resolvedDir = resolve(projectDir);
  const prefix = resolvedDir + '/';
  const envFile = resolve(ENV_FILE());
  const envDir = dirname(envFile);

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    // Block access to .env files
    const filePath = (input as any)?.file_path ?? (input as any)?.path;
    if (filePath) {
      const resolved = resolve(filePath);
      if (resolved === envFile || (/[/\\]\.env(\..+)?$/.test(resolved) && resolved.startsWith(envDir))) {
        return { behavior: 'deny', message: 'Cannot access .env files' };
      }
      // Restrict to project directory
      if (resolved !== resolvedDir && !resolved.startsWith(prefix)) {
        return { behavior: 'deny', message: `Access restricted to project directory: ${resolvedDir}` };
      }
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

function formatConversationContext(history: ConversationEntry[]): string {
  if (history.length === 0) return 'No previous conversation.';
  return history.map(e => {
    const time = new Date(e.timestamp).toISOString().slice(0, 16).replace('T', ' ');
    return `[${time}] ${e.role}: ${e.content}`;
  }).join('\n');
}

function getRelayChatAgentConfig(
  project: string,
  userMessage: string,
  history: ConversationEntry[],
): AgentConfig {
  const projectDir = getProjectDir(project);
  const conversationContext = formatConversationContext(history);

  return {
    prompt: loadPrompt('relay-chat', 'chat_default', {
      project,
      userMessage,
      conversationContext,
    }),
    cwd: projectDir,
    allowedTools: ['Read', 'Glob', 'Grep'],
    systemPrompt: loadSystemPrompt('relay-chat', 'chat_default') ?? 'You are a helpful project assistant with read-only access.',
    maxTurns: 15,
    permissionMode: 'default',
    canUseTool: chatToolCallback(projectDir),
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          reply: {
            type: 'string',
            description: 'The reply message to send back to the user',
          },
        },
        required: ['reply'],
      },
    },
  };
}

export async function runRelayChatAgent(
  project: string,
  userMessage: string,
  history: ConversationEntry[],
): Promise<string> {
  const config = getRelayChatAgentConfig(project, userMessage, history);
  const result = await runAgent(config);

  if (!result.success) {
    return `I encountered an error processing your request: ${result.result.slice(0, 200)}`;
  }

  // Extract reply from structured output
  const output = result.structuredOutput as { reply?: string } | undefined;
  if (output?.reply) return output.reply;

  // Fallback to raw text
  return result.result.slice(0, 2000) || 'I processed your request but have no response.';
}
