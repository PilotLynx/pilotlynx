import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectExists } from '../project.js';
import { buildProjectEnv } from '../secrets.js';
import { getRunAgentConfig } from '../../agents/run.agent.js';
import { runAgent } from '../agent-runner.js';
import { writeRunLog } from '../logger.js';
import { getProjectDir } from '../config.js';
import { validateWorkflowName } from '../validation.js';
import type { RunRecord } from '../types.js';

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
  feedbackPrompt?: string,
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
  const projectEnv = buildProjectEnv(project);
  const config = getRunAgentConfig(project, workflow, projectEnv, feedbackPrompt);
  const result = await runAgent(config);
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
  };

  writeRunLog(project, record);

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
