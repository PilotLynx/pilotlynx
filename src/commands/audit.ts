import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { readAuditEntries, formatAuditCSV } from '../lib/audit.js';

export function makeAuditCommand(): Command {
  const cmd = new Command('audit')
    .description('View and export audit trail for a project')
    .argument('<project>', 'project name')
    .option('--days <n>', 'number of days to include', '30')
    .option('--workflow <name>', 'filter by workflow')
    .option('--format <fmt>', 'output format: table, json, csv', 'table')
    .action(async (project: string, opts) => {
      const days = parseInt(opts.days, 10) || 30;
      const entries = readAuditEntries(project, { days, workflow: opts.workflow });

      if (entries.length === 0) {
        console.log(chalk.dim('No audit entries found.'));
        return;
      }

      switch (opts.format) {
        case 'json':
          console.log(JSON.stringify(entries, null, 2));
          break;
        case 'csv':
          console.log(formatAuditCSV(entries));
          break;
        default: {
          console.log(chalk.blue(`Audit trail for ${project} (last ${days} days)\n`));
          const table = new Table({
            head: ['Time', 'Workflow', 'Trigger', 'Status', 'Cost', 'Duration', 'Tools'],
            style: { head: [], border: [] },
          });

          for (const e of entries.slice(-20)) {
            const time = e.timestamp.replace('T', ' ').slice(0, 19);
            table.push([
              time,
              e.workflow,
              e.triggeredBy,
              e.success ? chalk.green('OK') : chalk.red('FAIL'),
              `$${e.costUsd.toFixed(3)}`,
              `${(e.durationMs / 1000).toFixed(0)}s`,
              e.toolInvocations.length.toString(),
            ]);
          }
          console.log(table.toString());
          console.log(chalk.dim(`\n${entries.length} entries total.`));
        }
      }
    });

  return cmd;
}
