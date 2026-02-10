import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ENV_FILE, POLICIES_DIR } from '../lib/config.js';
import { executeProjectCreate, executeProjectAdd } from '../lib/command-ops/project-ops.js';

function getSecretsContext(): { availableKeys: string[]; currentPolicy: string } {
  const envFile = ENV_FILE();
  let availableKeys: string[] = [];
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf8');
    availableKeys = content.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => l.split('=')[0].trim());
  }

  const policyFile = join(POLICIES_DIR(), 'secrets-access.yaml');
  const currentPolicy = existsSync(policyFile)
    ? readFileSync(policyFile, 'utf8')
    : 'version: 1\nshared: []\nprojects: {}\n';

  return { availableKeys, currentPolicy };
}

export function makeProjectCommand(): Command {
  const cmd = new Command('project').description('Manage individual projects');

  cmd
    .command('create')
    .argument('<name>', 'name of the new project')
    .description('Create a new project from the template')
    .action(async (name: string) => {
      console.log(chalk.blue(`Creating project: ${name}`));

      const { availableKeys, currentPolicy } = getSecretsContext();
      const result = await executeProjectCreate(name, availableKeys, currentPolicy);

      if (result.success) {
        console.log(chalk.green(`\nProject "${name}" created successfully.`));
        console.log(chalk.dim(`\nTip: For MCP secrets when working directly in this project:`));
        console.log(chalk.dim(`  plynx link ${name} --direnv    # generates .envrc for direnv`));
      } else {
        console.error(chalk.red(`\nProject creation encountered issues: ${result.error}`));
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .argument('<name>', 'name for the project in PilotLynx')
    .option('--path <dir>', 'path to existing directory (default: current directory)')
    .description('Add an existing directory as a PilotLynx project')
    .action(async (name: string, opts) => {
      const targetPath = resolve(opts.path ?? '.');
      console.log(chalk.blue(`Adding project: ${name} from ${targetPath}`));

      const { availableKeys, currentPolicy } = getSecretsContext();
      const result = await executeProjectAdd(name, targetPath, availableKeys, currentPolicy);

      if (result.added && result.added.length > 0) {
        console.log(chalk.green('\nAdded:'));
        for (const f of result.added) console.log(`  + ${f}`);
      }
      if (result.skipped && result.skipped.length > 0) {
        console.log(chalk.dim('\nSkipped (already exist):'));
        for (const f of result.skipped) console.log(`  - ${f}`);
      }

      if (result.success) {
        console.log(chalk.green(`\nProject "${name}" added successfully.`));
        console.log(chalk.dim(`\nTip: For MCP secrets when working directly in this project:`));
        console.log(chalk.dim(`  plynx link ${name} --direnv    # generates .envrc for direnv`));
      } else {
        console.error(chalk.red(`\nProject addition encountered issues: ${result.error}`));
        process.exit(1);
      }
    });

  return cmd;
}
