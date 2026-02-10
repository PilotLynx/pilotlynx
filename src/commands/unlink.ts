import { Command } from 'commander';
import chalk from 'chalk';
import { executeUnlink } from '../lib/command-ops/link-ops.js';

export function makeUnlinkCommand(): Command {
  const cmd = new Command('unlink')
    .description('Remove direct-access configuration from a project')
    .argument('<project>', 'project name')
    .action(async (project: string) => {
      const result = executeUnlink(project);

      if (!result.success) {
        console.error(chalk.red(result.error ?? 'Unknown error'));
        process.exit(1);
      }

      if (result.removedSettings) {
        console.log(chalk.green(`Removed PILOTLYNX_ROOT from .claude/settings.json`));
      }

      if (result.removedEnvrc) {
        console.log(chalk.green(`Removed .envrc`));
      }

      if (!result.removedSettings && !result.removedEnvrc) {
        console.log(chalk.dim(`Nothing to remove for project "${project}".`));
      }
    });

  return cmd;
}
