import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getRecentLogs } from '../lib/observation.js';

export function makeLogsCommand(): Command {
  const cmd = new Command('logs')
    .description('View recent workflow run logs for a project')
    .argument('<project>', 'project name')
    .option('--last <n>', 'number of logs to show', '10')
    .option('--workflow <name>', 'filter by workflow name')
    .option('--failures', 'show only failed runs')
    .option('--verbose', 'show token usage details')
    .action(async (project: string, opts, command: Command) => {
      const verbose = opts.verbose || command.parent?.opts().verbose;
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

      const head = verbose
        ? ['Time', 'Workflow', 'Status', 'Duration', 'Cost', 'Tokens (in/out)', 'Model', 'Summary']
        : ['Time', 'Workflow', 'Status', 'Duration', 'Cost', 'Summary'];

      const table = new Table({
        head,
        style: { head: [], border: [] },
      });

      for (const r of records) {
        const time = new Date(r.startedAt).toISOString().replace('T', ' ').slice(0, 19);
        const startMs = new Date(r.startedAt).getTime();
        const endMs = new Date(r.completedAt).getTime();
        const duration = `${((endMs - startMs) / 1000).toFixed(0)}s`;
        const cost = `$${r.costUsd.toFixed(3)}`;
        const summary = (r.success ? r.summary : (r.error ?? r.summary)).slice(0, 38);

        if (verbose) {
          const tokens = r.inputTokens != null
            ? `${r.inputTokens.toLocaleString()}/${r.outputTokens?.toLocaleString() ?? '?'}`
            : chalk.dim('—');
          table.push([
            time,
            r.workflow,
            r.success ? chalk.green('OK') : chalk.red('FAIL'),
            duration,
            cost,
            tokens,
            r.model ?? chalk.dim('—'),
            summary,
          ]);
        } else {
          table.push([
            time,
            r.workflow,
            r.success ? chalk.green('OK') : chalk.red('FAIL'),
            duration,
            cost,
            summary,
          ]);
        }
      }
      console.log(table.toString());

      console.log(chalk.dim(`\n${records.length} log(s) shown.`));
    });

  return cmd;
}
