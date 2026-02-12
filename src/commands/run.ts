import { Command } from 'commander';
import chalk from 'chalk';
import { executeRun } from '../lib/command-ops/run-ops.js';
import type { RunResult } from '../lib/command-ops/run-ops.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number): number {
  const base = 2000 * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return base + jitter;
}

export function makeRunCommand(): Command {
  const cmd = new Command('run')
    .argument('<project>', 'project name')
    .argument('<workflow>', 'workflow name')
    .option('--retry <n>', 'retry up to N times on failure', '0')
    .description('Run a workflow in a project with secrets injection and logging')
    .action(async (project: string, workflow: string, opts, command: Command) => {
      const verbose = command.parent?.opts().verbose ?? false;
      const maxRetries = parseInt(opts.retry, 10) || 0;

      console.log(chalk.blue(`Running ${workflow} in ${project}...`));

      let result: RunResult = await executeRun(project, workflow);
      let attempt = 0;

      while (!result.success && attempt < maxRetries) {
        attempt++;
        const delay = retryDelay(attempt - 1);
        console.log(chalk.yellow(`\nAttempt ${attempt} failed. Retrying in ${(delay / 1000).toFixed(1)}s... (${attempt}/${maxRetries})`));
        await sleep(delay);
        console.log(chalk.blue(`Retry ${attempt}/${maxRetries}: Running ${workflow} in ${project}...`));
        result = await executeRun(project, workflow);
      }

      if (!result.success) {
        console.error(chalk.red(result.error ?? 'Unknown error'));
        if (maxRetries > 0) {
          console.error(chalk.red(`Failed after ${maxRetries} retries.`));
        }
        process.exit(1);
      }

      console.log(chalk.green(`\nWorkflow "${workflow}" completed successfully.`));
      if (attempt > 0) {
        console.log(chalk.dim(`  Succeeded on attempt ${attempt + 1}`));
      }
      if (verbose && result.costUsd !== undefined) {
        console.log(chalk.dim(`  Cost: $${result.costUsd.toFixed(4)} | Turns: ${result.numTurns} | Duration: ${((result.durationMs ?? 0) / 1000).toFixed(1)}s`));
      }
    });

  return cmd;
}
