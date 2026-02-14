import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { Cron } from 'croner';
import { existsSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { lock, check } from 'proper-lockfile';
import { listProjects } from '../lib/project.js';
import { evaluateSchedules, loadScheduleConfig, loadScheduleState, saveScheduleState, loadImproveState, saveImproveState } from '../lib/schedule.js';
import { loadWorkspaceConfig, getConfigRoot } from '../lib/config.js';
import { executeImprove } from '../lib/command-ops/improve-ops.js';
import { buildProjectEnv } from '../lib/secrets.js';
import { getRunAgentConfig } from '../agents/run.agent.js';
import { runAgent } from '../lib/agent-runner.js';
import { writeRunLog } from '../lib/logger.js';
import { validateWorkflowName } from '../lib/validation.js';
import { sendRunNotification } from '../lib/relay/notify.js';
import type { RunRecord } from '../lib/types.js';

export function makeScheduleCommand(): Command {
  const cmd = new Command('schedule').description('Manage scheduled workflow runs');

  cmd
    .command('tick')
    .description('Evaluate and run due scheduled workflows across all projects')
    .action(async () => {
      // Global lock to prevent concurrent schedule ticks
      const configRoot = getConfigRoot();
      const lockTarget = pathJoin(configRoot, '.schedule-tick.lock');
      if (!existsSync(lockTarget)) {
        writeFileSync(lockTarget, '', 'utf8');
      }
      let tickRelease: (() => Promise<void>) | undefined;
      try {
        const isLocked = await check(lockTarget);
        if (isLocked) {
          console.log(chalk.dim('Another schedule tick is running. Skipping.'));
          return;
        }
        tickRelease = await lock(lockTarget, { stale: 600_000, retries: 0 });
      } catch {
        console.log(chalk.dim('Could not acquire schedule lock. Skipping.'));
        return;
      }

      try {
        const projects = listProjects();

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

            // Apply per-workflow model and budget from schedule.yaml
            const schedEntry = scheduleConfig.schedules.find(s => s.workflow === workflow);
            if (schedEntry?.model) config.model = schedEntry.model;
            if (schedEntry?.maxBudgetUsd) config.maxBudgetUsd = schedEntry.maxBudgetUsd;

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
            await sendRunNotification(record);

            state.lastRuns[workflow] = now.toISOString();
            totalRuns++;
          }

          saveScheduleState(project, state);
        }

        // Auto-improve (once per 24h)
        const wsConfig = loadWorkspaceConfig();
        if (wsConfig.autoImprove.enabled) {
          const now = new Date();
          const improveState = loadImproveState();
          const lastImprove = improveState.lastRun ? new Date(improveState.lastRun) : null;
          const hoursSince = lastImprove ? (now.getTime() - lastImprove.getTime()) / (1000 * 60 * 60) : Infinity;

          if (hoursSince >= 24) {
            console.log(chalk.blue('\nRunning auto-improve...'));
            const improveResult = await executeImprove();
            saveImproveState({ ...improveState, lastRun: now.toISOString() });
            if (improveResult.success) {
              console.log(chalk.green('Auto-improve completed.'));
            } else {
              console.log(chalk.yellow(`Auto-improve finished with issues: ${improveResult.error ?? 'some workflows failed'}`));
            }
          }
        }

        if (totalRuns === 0) {
          console.log(chalk.dim('No workflows due at this time.'));
        } else {
          console.log(chalk.green(`\n${totalRuns} workflow(s) executed.`));
        }
      } finally {
        if (tickRelease) await tickRelease();
      }
    });

  cmd
    .command('status')
    .description('Show schedule status for a project')
    .argument('<project>', 'project name')
    .action(async (project: string) => {
      const scheduleConfig = loadScheduleConfig(project);

      if (!scheduleConfig || scheduleConfig.schedules.length === 0) {
        console.log(chalk.dim(`No schedules configured for "${project}".`));
        console.log(chalk.dim(`Add a schedule.yaml to the project directory.`));
        return;
      }

      const state = loadScheduleState(project);
      const now = new Date();

      console.log(chalk.blue(`Schedule status for ${project}\n`));

      const table = new Table({
        head: ['Workflow', 'Cron', 'Last Run', 'Next Run', 'Catch-Up'],
        style: { head: [], border: [] },
      });

      for (const entry of scheduleConfig.schedules) {
        const lastRunStr = state.lastRuns[entry.workflow];

        let nextRun = '—';
        try {
          const job = new Cron(entry.cron, { timezone: entry.timezone });
          const next = job.nextRun(now);
          if (next) nextRun = next.toISOString().replace('T', ' ').slice(0, 19);
        } catch {
          nextRun = 'invalid cron';
        }

        const lastDisplay = lastRunStr
          ? new Date(lastRunStr).toISOString().replace('T', ' ').slice(0, 19)
          : '—';

        table.push([entry.workflow, entry.cron, lastDisplay, nextRun, entry.catchUpPolicy]);
      }
      console.log(table.toString());

      // Auto-improve status
      const wsConfig = loadWorkspaceConfig();
      const improveState = loadImproveState();
      console.log('');
      console.log(chalk.bold('Auto-improve: ') + (wsConfig.autoImprove.enabled ? chalk.green('enabled') : chalk.dim('disabled')));
      if (improveState.lastRun) {
        console.log(chalk.bold('Last improve: ') + new Date(improveState.lastRun).toISOString().replace('T', ' ').slice(0, 19));
      }
    });

  return cmd;
}
