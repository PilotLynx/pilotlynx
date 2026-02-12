import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { listProjects } from '../project.js';
import { getRecentLogs, writeInsight } from '../observation.js';
import { getImproveAgentConfig } from '../../agents/improve.agent.js';
import { runAgent } from '../agent-runner.js';
import { buildProjectEnv } from '../secrets.js';
import { getRunAgentConfig } from '../../agents/run.agent.js';
import { getProjectDir } from '../config.js';
import { resetPolicyCache } from '../policy.js';

export interface ImproveResult {
  success: boolean;
  error?: string;
  failures?: Array<{ project: string; error: string }>;
  noProjects?: boolean;
  noActivity?: boolean;
  noFeedback?: boolean;
}

export async function executeImprove(verbose?: boolean): Promise<ImproveResult> {
  const projects = listProjects();
  if (projects.length === 0) {
    return { success: true, noProjects: true };
  }

  const logSummaries: Record<string, string> = {};
  for (const project of projects) {
    const logs = getRecentLogs(project, 1);
    if (logs.length > 0) {
      logSummaries[project] = logs
        .map((l) => `[${l.workflow}] ${l.success ? 'OK' : 'FAIL'}: ${l.summary}`)
        .join('\n');
    }
  }

  if (Object.keys(logSummaries).length === 0) {
    return { success: true, noActivity: true };
  }

  let result: Awaited<ReturnType<typeof runAgent>>;
  try {
    const config = getImproveAgentConfig(logSummaries);
    result = await runAgent(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Improve agent failed: ${msg}` };
  }

  if (!result.success) {
    return { success: false, error: result.result };
  }

  const output = result.structuredOutput as {
    projectFeedback: Record<string, string>;
    crossProjectInsights: string;
  } | null;

  if (!output) {
    return { success: true, noFeedback: true };
  }

  const feedbackWorkflow = 'daily_feedback';
  const failures: Array<{ project: string; error: string }> = [];

  for (const [project, feedback] of Object.entries(output.projectFeedback)) {
    if (!feedback) continue;

    const workflowPath = join(getProjectDir(project), 'workflows', `${feedbackWorkflow}.ts`);
    if (!existsSync(workflowPath)) {
      console.log(chalk.dim(`[plynx] Skipping "${project}": no ${feedbackWorkflow} workflow found.`));
      continue;
    }

    try {
      resetPolicyCache();
      const projectEnv = buildProjectEnv(project);
      const feedbackConfig = getRunAgentConfig(project, feedbackWorkflow, projectEnv, feedback);
      const feedbackResult = await runAgent(feedbackConfig);
      if (!feedbackResult.success) {
        failures.push({ project, error: feedbackResult.result });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ project, error: msg });
    }
  }

  if (output.crossProjectInsights) {
    writeInsight(output.crossProjectInsights);
  }

  return {
    success: failures.length === 0,
    failures: failures.length > 0 ? failures : undefined,
  };
}
