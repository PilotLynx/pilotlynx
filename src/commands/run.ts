import { Command } from 'commander';
import chalk from 'chalk';
import { executeRun } from '../lib/command-ops/run-ops.js';

export function makeRunCommand(): Command {
  const cmd = new Command('run')
    .argument('<project>', 'project name')
    .argument('<workflow>', 'workflow name')
    .description('Run a workflow in a project with secrets injection and logging')
    .action(async (project: string, workflow: string, _opts, command: Command) => {
      const verbose = command.parent?.opts().verbose ?? false;

      console.log(chalk.blue(`Running ${workflow} in ${project}...`));

      const result = await executeRun(project, workflow);

      if (!result.success) {
        console.error(chalk.red(result.error ?? 'Unknown error'));
        process.exit(1);
      }

      console.log(chalk.green(`\nWorkflow "${workflow}" completed successfully.`));
      if (verbose && result.costUsd !== undefined) {
        console.log(chalk.dim(`  Cost: $${result.costUsd.toFixed(4)} | Turns: ${result.numTurns} | Duration: ${((result.durationMs ?? 0) / 1000).toFixed(1)}s`));
      }
    });

  return cmd;
}
