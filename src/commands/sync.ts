import { Command } from 'commander';
import chalk from 'chalk';
import { executeSyncTemplate } from '../lib/command-ops/sync-ops.js';

export function makeSyncCommand(): Command {
  const cmd = new Command('sync').description('Synchronization commands');

  cmd
    .command('template')
    .argument('<project>', 'project to sync with template')
    .description('Apply template updates to a project')
    .action(async (project: string) => {
      console.log(chalk.blue(`Syncing template to project: ${project}\n`));

      const result = await executeSyncTemplate(project);

      if (result.success) {
        console.log(chalk.green(`\nTemplate sync complete for "${project}".`));
      } else {
        console.error(chalk.red(`\nTemplate sync failed: ${result.error}`));
        process.exit(1);
      }
    });

  return cmd;
}
