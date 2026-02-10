import { Command } from 'commander';
import chalk from 'chalk';
import { listProjects } from '../lib/project.js';
import { evaluateSchedules, loadScheduleConfig, loadScheduleState, saveScheduleState } from '../lib/schedule.js';
import { buildProjectEnv } from '../lib/secrets.js';
import { getRunAgentConfig } from '../agents/run.agent.js';
import { runAgent } from '../lib/agent-runner.js';
import { writeRunLog } from '../lib/logger.js';
import { validateWorkflowName } from '../lib/validation.js';
import type { RunRecord } from '../lib/types.js';

export function makeScheduleCommand(): Command {
  const cmd = new Command('schedule').description('Manage scheduled workflow runs');

  cmd
    .command('tick')
    .description('Evaluate and run due scheduled workflows across all projects')
    .action(async () => {
      const projects = listProjects();
      if (projects.length === 0) {
        console.log(chalk.yellow('No projects found.'));
        return;
      }

      console.log(chalk.blue('Evaluating schedules...\n'));
      let totalRuns = 0;

      for (const project of projects) {
        const scheduleConfig = loadScheduleConfig(project);
        if (!scheduleConfig || scheduleConfig.schedules.length === 0) continue;

        const state = loadScheduleState(project);
        const now = new Date();
        const dueWorkflows = evaluateSchedules(scheduleConfig, state, now);

        for (const { workflow, runTime } of dueWorkflows) {
          validateWorkflowName(workflow);
          console.log(chalk.blue(`  Running ${project}/${workflow} (due: ${runTime.toISOString()})...`));
          const startedAt = new Date().toISOString();
          const projectEnv = buildProjectEnv(project);
          const config = getRunAgentConfig(project, workflow, projectEnv);
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

          state.lastRuns[workflow] = now.toISOString();
          totalRuns++;
        }

        saveScheduleState(project, state);
      }

      if (totalRuns === 0) {
        console.log(chalk.dim('No workflows due at this time.'));
      } else {
        console.log(chalk.green(`\n${totalRuns} workflow(s) executed.`));
      }
    });

  return cmd;
}
