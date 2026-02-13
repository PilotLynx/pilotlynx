import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ENV_FILE, POLICIES_DIR, getProjectDir } from '../lib/config.js';
import { executeProjectCreate, executeProjectAdd } from '../lib/command-ops/project-ops.js';
import { unregisterProject, isRegistered } from '../lib/registry.js';
import { loadScheduleConfig } from '../lib/schedule.js';

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

export function makeCreateCommand(): Command {
  return new Command('create')
    .argument('<name>', 'name of the new project')
    .description('Create a new project from the template')
    .action(async (name: string) => {
      console.log(chalk.blue(`Creating project: ${name}`));

      const { availableKeys, currentPolicy } = getSecretsContext();
      const result = await executeProjectCreate(name, availableKeys, currentPolicy);

      if (result.success) {
        console.log(chalk.green(`\nProject "${name}" created successfully.`));
        console.log(chalk.dim(`\nTip: For MCP secrets when working directly in this project:`));
        console.log(chalk.dim(`  pilotlynx link ${name} --direnv    # generates .envrc for direnv`));
      } else {
        console.error(chalk.red(`\nProject creation encountered issues: ${result.error}`));
        process.exit(1);
      }
    });
}

export function makeAddCommand(): Command {
  return new Command('add')
    .argument('<name>', 'name for the project in PilotLynx')
    .argument('[path]', 'path to existing directory', '.')
    .description('Add an existing directory as a PilotLynx project')
    .action(async (name: string, path: string) => {
      const targetPath = resolve(path);
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
        console.log(chalk.dim(`  pilotlynx link ${name} --direnv    # generates .envrc for direnv`));
      } else {
        console.error(chalk.red(`\nProject addition encountered issues: ${result.error}`));
        process.exit(1);
      }
    });
}

export function makeRemoveCommand(): Command {
  return new Command('remove')
    .argument('<name>', 'project name to remove')
    .option('--delete', 'also delete the project directory')
    .description('Remove a project from the registry')
    .action(async (name: string, opts) => {
      if (!isRegistered(name)) {
        console.error(chalk.red(`Project "${name}" is not registered.`));
        process.exit(1);
      }

      // Warn about scheduled workflows
      try {
        const schedConfig = loadScheduleConfig(name);
        if (schedConfig && schedConfig.schedules.length > 0) {
          console.log(chalk.yellow(
            `Warning: "${name}" has ${schedConfig.schedules.length} scheduled workflow(s) that will stop running.`
          ));
        }
      } catch {
        // No schedule config
      }

      const projectDir = getProjectDir(name);

      if (opts.delete) {
        console.log(chalk.yellow(`\nThis will permanently delete: ${projectDir}`));
        const confirmed = await confirmAction('Type the project name to confirm deletion: ', name);
        if (!confirmed) {
          console.log(chalk.dim('Cancelled.'));
          return;
        }
      }

      unregisterProject(name);

      if (opts.delete && existsSync(projectDir)) {
        rmSync(projectDir, { recursive: true, force: true });
        console.log(chalk.green(`Project "${name}" removed and directory deleted.`));
      } else {
        console.log(chalk.green(`Project "${name}" removed from registry.`));
        if (!opts.delete) {
          console.log(chalk.dim(`Directory left intact at: ${projectDir}`));
        }
      }
    });
}

function confirmAction(prompt: string, expected: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() === expected);
    });
  });
}
