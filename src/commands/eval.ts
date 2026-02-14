import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { executeEval } from '../lib/command-ops/eval-ops.js';

export function makeEvalCommand(): Command {
  const cmd = new Command('eval')
    .description('Run evaluation test cases against a project workflow')
    .argument('<project>', 'project name')
    .option('--workflow <name>', 'filter by workflow name')
    .option('--tag <tag>', 'filter by tag')
    .option('--budget <usd>', 'max budget in USD', parseFloat)
    .action(async (project: string, opts) => {
      console.log(chalk.blue(`Running evals for ${project}...\n`));

      try {
        const summary = await executeEval(project, {
          workflow: opts.workflow,
          tag: opts.tag,
          budget: opts.budget,
        });

        const table = new Table({
          head: ['Test Case', 'Workflow', 'Status', 'Score', 'Cost', 'Reasoning'],
          style: { head: [], border: [] },
        });

        for (const r of summary.results) {
          table.push([
            r.testCase,
            r.workflow,
            r.passed ? chalk.green('PASS') : chalk.red('FAIL'),
            `${(r.score * 100).toFixed(0)}%`,
            `$${r.costUsd.toFixed(4)}`,
            r.reasoning.slice(0, 40),
          ]);
        }

        console.log(table.toString());
        console.log(`\n${chalk.bold('Summary:')} ${summary.passed}/${summary.totalCases} passed, avg score: ${(summary.avgScore * 100).toFixed(0)}%`);

        if (summary.failed > 0) {
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  return cmd;
}
