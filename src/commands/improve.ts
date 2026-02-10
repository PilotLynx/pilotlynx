import { Command } from 'commander';
import chalk from 'chalk';
import { executeImprove } from '../lib/command-ops/improve-ops.js';

function truncate(str: string, maxLen = 200): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export function makeImproveCommand(): Command {
  const cmd = new Command('improve')
    .description('Trigger self-improvement loop across all projects')
    .action(async (_opts, command: Command) => {
      const verbose = command.parent?.opts().verbose ?? false;

      console.log(chalk.blue('Starting improvement cycle...\n'));

      const result = await executeImprove(verbose);

      if (result.noProjects) {
        console.log(chalk.yellow('No projects found. Nothing to improve.'));
        return;
      }

      if (result.noActivity) {
        console.log(chalk.yellow('No recent activity found across projects.'));
        console.log('Run some workflows first, then try improve again.');
        return;
      }

      if (!result.success && result.error) {
        console.error(chalk.red(`Improvement analysis failed: ${truncate(result.error)}`));
        process.exit(1);
      }

      if (result.noFeedback) {
        console.log(chalk.yellow('No structured feedback produced.'));
        return;
      }

      if (result.failures && result.failures.length > 0) {
        console.log(chalk.yellow(`\nImprovement cycle completed with ${result.failures.length} failure(s):`));
        for (const f of result.failures) {
          console.log(chalk.yellow(`  - ${f.project}: ${truncate(f.error)}`));
        }
      } else {
        console.log(chalk.green('\nImprovement cycle complete.'));
      }
    });

  return cmd;
}
