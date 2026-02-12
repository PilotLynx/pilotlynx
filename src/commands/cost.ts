import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { listProjects } from '../lib/project.js';
import { getRecentLogs } from '../lib/observation.js';
import type { RunRecord } from '../lib/types.js';

export function makeCostCommand(): Command {
  const cmd = new Command('cost')
    .description('Show cost summary across projects and workflows')
    .argument('[project]', 'filter to a single project')
    .option('--since <date>', 'start date (YYYY-MM-DD)')
    .option('--last <n>', 'last N days (default 7)', '7')
    .option('--by <grouping>', 'group by: project (default) or workflow', 'project')
    .action(async (project: string | undefined, opts) => {
      const days = parseInt(opts.last, 10) || 7;
      const sinceDate = opts.since ? new Date(opts.since) : null;

      const projects = project ? [project] : listProjects();
      if (projects.length === 0) {
        console.log(chalk.dim('No projects registered.'));
        return;
      }

      // Collect all logs
      let allLogs: RunRecord[] = [];
      for (const p of projects) {
        try {
          const logs = getRecentLogs(p, sinceDate ? 365 : days);
          if (sinceDate) {
            const cutoff = sinceDate.getTime();
            allLogs.push(...logs.filter(l => new Date(l.startedAt).getTime() >= cutoff));
          } else {
            allLogs.push(...logs);
          }
        } catch {
          // Project might not exist or have no logs
        }
      }

      if (allLogs.length === 0) {
        console.log(chalk.dim('No runs found in the specified period.'));
        return;
      }

      // Determine grouping
      const groupBy = opts.by === 'workflow' ? 'workflow' : 'project';

      // Group the logs
      const groups = new Map<string, RunRecord[]>();
      for (const log of allLogs) {
        const key = groupBy === 'workflow'
          ? (project ? log.workflow : `${log.project}/${log.workflow}`)
          : log.project;
        const arr = groups.get(key) ?? [];
        arr.push(log);
        groups.set(key, arr);
      }

      // Build the header
      const periodLabel = sinceDate
        ? `since ${opts.since}`
        : `last ${days} day${days === 1 ? '' : 's'}`;
      const scopeLabel = project ? `project: ${project}` : 'all projects';
      console.log(chalk.blue(`Cost summary — ${scopeLabel}, ${periodLabel}\n`));

      const table = new Table({
        head: [groupBy === 'workflow' ? 'Workflow' : 'Project', 'Runs', 'OK', 'Fail', 'Total Cost', 'Avg Cost/Run'],
        style: { head: [], border: [] },
      });

      let totalRuns = 0;
      let totalOk = 0;
      let totalFail = 0;
      let totalCost = 0;

      // Sort groups by total cost descending
      const sorted = [...groups.entries()].sort(
        (a, b) => b[1].reduce((s, l) => s + l.costUsd, 0) - a[1].reduce((s, l) => s + l.costUsd, 0)
      );

      for (const [key, logs] of sorted) {
        const runs = logs.length;
        const ok = logs.filter(l => l.success).length;
        const fail = runs - ok;
        const cost = logs.reduce((s, l) => s + l.costUsd, 0);
        const avg = cost / runs;

        totalRuns += runs;
        totalOk += ok;
        totalFail += fail;
        totalCost += cost;

        table.push([
          key,
          String(runs),
          String(ok),
          fail > 0 ? chalk.red(String(fail)) : String(fail),
          `$${cost.toFixed(3)}`,
          `$${avg.toFixed(3)}`,
        ]);
      }

      console.log(table.toString());

      // Summary line
      const totalAvg = totalRuns > 0 ? totalCost / totalRuns : 0;
      console.log(
        chalk.dim(`\nTotal: ${totalRuns} runs, $${totalCost.toFixed(3)} cost, $${totalAvg.toFixed(3)} avg/run`)
      );
    });

  return cmd;
}
