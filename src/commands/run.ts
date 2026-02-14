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
    .option('--model <name>', 'override model (e.g. sonnet, haiku, opus)')
    .option('--budget <usd>', 'max budget in USD', parseFloat)
    .option('--timeout <seconds>', 'timeout in seconds', parseInt)
    .option('--trace', 'enable run tracing (writes JSONL spans to logs/traces/)')
    .description('Run a workflow in a project with secrets injection and logging')
    .action(async (project: string, workflow: string, opts, command: Command) => {
      const verbose = command.parent?.opts().verbose ?? false;
      const maxRetries = parseInt(opts.retry, 10) || 0;

      console.log(chalk.blue(`Running ${workflow} in ${project}...`));
      if (opts.model) console.log(chalk.dim(`  Model: ${opts.model}`));
      if (opts.budget) console.log(chalk.dim(`  Budget: $${opts.budget}`));
      if (opts.timeout) console.log(chalk.dim(`  Timeout: ${opts.timeout}s`));

      const runOptions = {
        model: opts.model,
        budget: opts.budget,
        timeoutSeconds: opts.timeout,
        tracing: opts.trace,
      };

      let result: RunResult = await executeRun(project, workflow, runOptions);
      let attempt = 0;

      while (!result.success && attempt < maxRetries) {
        attempt++;
        const delay = retryDelay(attempt - 1);
        console.log(chalk.yellow(`\nAttempt ${attempt} failed. Retrying in ${(delay / 1000).toFixed(1)}s... (${attempt}/${maxRetries})`));
        await sleep(delay);
        console.log(chalk.blue(`Retry ${attempt}/${maxRetries}: Running ${workflow} in ${project}...`));
        result = await executeRun(project, workflow, runOptions);
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
      if (opts.trace) {
        console.log(chalk.dim(`  Trace written to logs/traces/`));
      }
    });

  return cmd;
}
