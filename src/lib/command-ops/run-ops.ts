import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectExists } from '../project.js';
import { buildProjectEnv } from '../secrets.js';
import { getRunAgentConfig } from '../../agents/run.agent.js';
import { runAgent } from '../agent-runner.js';
import type { RunAgentOptions } from '../agent-runner.js';
import { writeRunLog } from '../logger.js';
import { getProjectDir } from '../config.js';
import { validateWorkflowName } from '../validation.js';
import type { RunRecord, TraceSpan } from '../types.js';

export interface RunOptions {
  model?: string;
  budget?: number;
  timeoutSeconds?: number;
  tracing?: boolean;
  feedbackPrompt?: string;
}

export interface RunResult {
  success: boolean;
  error?: string;
  record?: RunRecord;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}

export async function executeRun(
  project: string,
  workflow: string,
  options?: RunOptions,
): Promise<RunResult> {
  if (!projectExists(project)) {
    return { success: false, error: `Project "${project}" does not exist.` };
  }

  validateWorkflowName(workflow);

  const workflowPath = join(getProjectDir(project), 'workflows', `${workflow}.ts`);
  if (!existsSync(workflowPath)) {
    return { success: false, error: `Workflow "${workflow}" not found at ${workflowPath}` };
  }

  const startedAt = new Date().toISOString();

  let result: Awaited<ReturnType<typeof runAgent>>;
  try {
    const projectEnv = buildProjectEnv(project);
    const config = getRunAgentConfig(project, workflow, projectEnv, options?.feedbackPrompt);

    // Apply CLI overrides
    if (options?.model) config.model = options.model;
    if (options?.budget) config.maxBudgetUsd = options.budget;

    const runOptions: RunAgentOptions = {
      timeoutMs: options?.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined,
      tracing: options?.tracing,
    };

    result = await runAgent(config, undefined, runOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Agent execution failed: ${msg}` };
  }

  const completedAt = new Date().toISOString();

  const record: RunRecord = {
    project,
    workflow,
    startedAt,
    completedAt,
    success: result.success,
    summary: result.result,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    ...(result.success ? {} : { error: result.result }),
    ...(result.inputTokens !== undefined && { inputTokens: result.inputTokens }),
    ...(result.outputTokens !== undefined && { outputTokens: result.outputTokens }),
    ...(result.cacheReadTokens !== undefined && { cacheReadTokens: result.cacheReadTokens }),
    ...(result.cacheCreationTokens !== undefined && { cacheCreationTokens: result.cacheCreationTokens }),
    ...(result.model && { model: result.model }),
  };

  writeRunLog(project, record);

  // Write trace file if tracing was enabled
  if (options?.tracing && result.spans && result.spans.length > 0) {
    writeTraceFile(project, workflow, startedAt, result.spans);
  }

  if (!result.success) {
    return { success: false, error: result.result, record };
  }

  return {
    success: true,
    record,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    durationMs: result.durationMs,
  };
}

function writeTraceFile(
  project: string,
  workflow: string,
  startedAt: string,
  spans: TraceSpan[],
): void {
  const tracesDir = join(getProjectDir(project), 'logs', 'traces');
  mkdirSync(tracesDir, { recursive: true });

  const dateStr = startedAt.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${workflow}_${dateStr}.jsonl`;
  const content = spans.map((s) => JSON.stringify(s)).join('\n') + '\n';

  writeFileSync(join(tracesDir, filename), content, 'utf8');
}
