import { Command } from 'commander';
import chalk from 'chalk';
import { executeVerify } from '../lib/command-ops/verify-ops.js';

export function makeVerifyCommand(): Command {
  const cmd = new Command('verify')
    .argument('<project>', 'project name to verify')
    .description('Validate project structure and required files')
    .action(async (project: string) => {
      console.log(chalk.blue(`Verifying project: ${project}\n`));

      const result = executeVerify(project);

      if (!result.success && !result.verification) {
        console.error(chalk.red(result.error ?? 'Unknown error'));
        process.exit(1);
      }

      const v = result.verification!;
      for (const error of v.errors) {
        console.log(chalk.red(`  \u2717 ${error}`));
      }
      for (const warning of v.warnings) {
        console.log(chalk.yellow(`  \u26A0 ${warning}`));
      }

      if (v.valid) {
        console.log(chalk.green('\n  \u2713 Project structure is valid.'));
      } else {
        console.error(chalk.red(`\n  ${v.errors.length} error(s) found.`));
        process.exit(1);
      }
    });

  return cmd;
}
