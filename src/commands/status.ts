import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getWorkspaceStatus } from '../lib/command-ops/status-ops.js';

export function makeStatusCommand(): Command {
  const cmd = new Command('status')
    .description('Show workspace health dashboard')
    .action(async () => {
      const status = getWorkspaceStatus();

      // ── Section 1: Projects table ──
      if (status.projects.length === 0) {
        console.log(chalk.dim('No projects registered. Run `pilotlynx create <name>` to get started.\n'));
      } else {
        console.log(chalk.blue.bold('Projects\n'));

        const table = new Table({
          head: ['Project', 'Last Run', 'Status', 'Cost (7d)', 'Next Scheduled', 'Path'],
          style: { head: [], border: [] },
        });

        for (const p of status.projects) {
          const lastRun = p.lastRun
            ? new Date(p.lastRun).toISOString().replace('T', ' ').slice(0, 16)
            : chalk.dim('—');
          const statusStr = p.lastStatus === 'OK'
            ? chalk.green('OK')
            : p.lastStatus === 'FAIL'
              ? chalk.red('FAIL')
              : chalk.dim('—');
          const cost = p.cost7d > 0 ? `$${p.cost7d.toFixed(3)}` : chalk.dim('$0');
          const nextSched = p.nextScheduled
            ? new Date(p.nextScheduled).toISOString().replace('T', ' ').slice(0, 16)
            : chalk.dim('—');

          table.push([p.name, lastRun, statusStr, cost, nextSched, p.path]);
        }
        console.log(table.toString());
      }

      // ── Section 2: Schedule overview ──
      console.log(chalk.blue.bold('\nSchedule\n'));

      const schedInfo = [
        `  Scheduled workflows:  ${status.scheduledWorkflows}`,
        `  Next run:             ${status.nextGlobalRun
          ? new Date(status.nextGlobalRun).toISOString().replace('T', ' ').slice(0, 16)
          : chalk.dim('none')}`,
        `  Cron job:             ${status.cronInstalled ? chalk.green('installed') : chalk.yellow('not installed')}`,
      ];
      console.log(schedInfo.join('\n'));

      // ── Section 3: Workspace info ──
      console.log(chalk.blue.bold('\nWorkspace\n'));

      const wsInfo = [
        `  Config root:          ${status.configRoot}`,
        `  Projects:             ${status.projects.length}`,
        `  Relay:                ${status.relayConfigured ? chalk.green('configured') : chalk.dim('not configured')}`,
        `  Auto-improve:         ${status.autoImproveEnabled ? chalk.green('enabled') : chalk.dim('disabled')}${
          status.lastImproveRun
            ? ` (last: ${new Date(status.lastImproveRun).toISOString().replace('T', ' ').slice(0, 16)})`
            : ''}`,
      ];
      console.log(wsInfo.join('\n'));
      console.log('');
    });

  return cmd;
}
