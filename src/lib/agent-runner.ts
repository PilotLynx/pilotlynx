import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentConfig, AgentResult } from './types.js';

/** Local type for SDK streaming messages (SDK doesn't export message types) */
interface SDKMessage {
  type: string;
  content?: string | Array<{ type: string; text: string }>;
  subtype?: string;
  result?: string;
  error?: string;
  total_cost_usd?: number;
  num_turns?: number;
  structured_output?: unknown;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  /** Per-model breakdowns provided by the SDK result message */
  model_usage?: Record<string, {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }>;
}

/**
 * System env vars passed through to the child process so that subscription
 * auth (~/.claude/ OAuth tokens), PATH-dependent tools (git, npm), and
 * locale/temp settings work correctly. Policy secrets overlay on top —
 * if a key collides, the policy secret wins.
 */
export const SYSTEM_ENV_PASSTHROUGH = [
  // Universal
  'PATH', 'LANG', 'LC_ALL', 'TERM',
  'TMPDIR', 'TMP', 'TEMP',
  'CLAUDE_CONFIG_DIR',
  // Unix
  'HOME', 'USER', 'LOGNAME', 'SHELL',
  'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  // Windows
  'USERPROFILE', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA',
  'HOMEDRIVE', 'HOMEPATH',
  'SystemRoot', 'COMSPEC', 'PATHEXT',
] as const;

export function buildRuntimeEnv(
  policyEnv: Record<string, string> | undefined,
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of SYSTEM_ENV_PASSTHROUGH) {
    const val = process.env[key];
    if (val !== undefined) {
      base[key] = val;
    }
  }
  return { ...base, ...policyEnv };
}

export async function runAgent(
  config: AgentConfig,
  onText?: (text: string) => void,
): Promise<AgentResult> {
  const start = Date.now();
  let resultText = '';
  let structuredOutput: unknown = undefined;
  let costUsd = 0;
  let numTurns = 0;
  let success = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let model: string | undefined;

  const runtimeEnv = config.env ? buildRuntimeEnv(config.env) : undefined;

  try {
    const q = query({
      prompt: config.prompt,
      options: {
        cwd: config.cwd,
        env: runtimeEnv,
        allowedTools: config.allowedTools,
        disallowedTools: config.disallowedTools,
        systemPrompt: config.systemPrompt,
        permissionMode: config.permissionMode,
        allowDangerouslySkipPermissions: config.allowDangerouslySkipPermissions,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        model: config.model,
        additionalDirectories: config.additionalDirectories,
        settingSources: config.settingSources,
        outputFormat: config.outputFormat,
        canUseTool: config.canUseTool,
        agents: config.agents,
      // SDK doesn't export its options type; cast required until types are published
      } as any,
    });

    for await (const message of q) {
      const msg = message as SDKMessage;
      if (msg.type === 'assistant') {
        const text =
          typeof msg.content === 'string'
            ? msg.content
            : msg.content
                ?.filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('');
        if (text) {
          (onText ?? process.stdout.write.bind(process.stdout))(text);
          resultText += text;
        }
      }
      if (msg.type === 'result') {
        costUsd = msg.total_cost_usd ?? 0;
        numTurns = msg.num_turns ?? 0;

        // Extract token usage from model_usage (per-model breakdown) or usage
        if (msg.model_usage) {
          for (const [modelId, usage] of Object.entries(msg.model_usage)) {
            if (!model) model = modelId;
            inputTokens += usage.input_tokens ?? 0;
            outputTokens += usage.output_tokens ?? 0;
            cacheReadTokens += usage.cache_read_input_tokens ?? 0;
            cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
          }
        } else if (msg.usage) {
          inputTokens = msg.usage.input_tokens ?? 0;
          outputTokens = msg.usage.output_tokens ?? 0;
          cacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
          cacheCreationTokens = msg.usage.cache_creation_input_tokens ?? 0;
        }
        if (msg.model) model = msg.model;

        if (msg.subtype === 'success') {
          success = true;
          resultText = msg.result ?? resultText;
          structuredOutput = msg.structured_output;
        } else {
          success = false;
          resultText = msg.error ?? resultText;
        }
      }
    }
  } catch (err) {
    success = false;
    resultText = err instanceof Error ? err.message : String(err);
  }

  return {
    success,
    result: resultText,
    structuredOutput,
    costUsd,
    durationMs: Date.now() - start,
    numTurns,
    ...(inputTokens > 0 && { inputTokens }),
    ...(outputTokens > 0 && { outputTokens }),
    ...(cacheReadTokens > 0 && { cacheReadTokens }),
    ...(cacheCreationTokens > 0 && { cacheCreationTokens }),
    ...(model && { model }),
  };
}
