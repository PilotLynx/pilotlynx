import { Command } from 'commander';
import chalk from 'chalk';
import { getRecentLogs } from '../lib/observation.js';

export function makeLogsCommand(): Command {
  const cmd = new Command('logs')
    .description('View recent workflow run logs for a project')
    .argument('<project>', 'project name')
    .option('--last <n>', 'number of logs to show', '10')
    .option('--workflow <name>', 'filter by workflow name')
    .option('--failures', 'show only failed runs')
    .action(async (project: string, opts) => {
      const limit = parseInt(opts.last, 10) || 10;
      let records = getRecentLogs(project, 30);

      if (opts.workflow) {
        records = records.filter((r) => r.workflow === opts.workflow);
      }

      if (opts.failures) {
        records = records.filter((r) => !r.success);
      }

      // Take the last N (records are sorted ascending, so slice from end)
      records = records.slice(-limit);

      if (records.length === 0) {
        console.log(chalk.dim('No matching logs found.'));
        return;
      }

      console.log(chalk.blue(`Recent logs for ${project}\n`));

      const cols = ['Time', 'Workflow', 'Status', 'Duration', 'Cost', 'Summary'];
      const widths = [20, 20, 8, 10, 8, 40];
      const header = cols.map((c, i) => c.padEnd(widths[i])).join('');
      console.log(chalk.bold(header));
      console.log('─'.repeat(header.length));

      for (const r of records) {
        const time = new Date(r.startedAt).toISOString().replace('T', ' ').slice(0, 19);
        const status = r.success ? chalk.green('OK') : chalk.red('FAIL');
        const startMs = new Date(r.startedAt).getTime();
        const endMs = new Date(r.completedAt).getTime();
        const durationSec = ((endMs - startMs) / 1000).toFixed(0);
        const duration = `${durationSec}s`;
        const cost = `$${r.costUsd.toFixed(3)}`;
        const summary = (r.success ? r.summary : (r.error ?? r.summary)).slice(0, 38);

        const row = [
          time.padEnd(widths[0]),
          r.workflow.padEnd(widths[1]),
          (r.success ? 'OK' : 'FAIL').padEnd(widths[2]),
          duration.padEnd(widths[3]),
          cost.padEnd(widths[4]),
          summary,
        ].join('');
        console.log(row);
      }

      console.log(chalk.dim(`\n${records.length} log(s) shown.`));
    });

  return cmd;
}
