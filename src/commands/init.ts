import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import YAML from 'yaml';
import { getPackageRoot, CONFIG_DIR_NAME } from '../lib/config.js';
import { saveGlobalConfig } from '../lib/global-config.js';
import { installScheduleCron } from '../lib/cron.js';

export function makeInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize a new PilotLynx workspace')
    .option('--name <name>', 'workspace name (default: directory basename)')
    .option('--path <dir>', 'target directory (default: current directory)', '.')
    .action(async (opts) => {
      const targetDir = resolve(opts.path);
      const name = opts.name ?? basename(targetDir);
      const configDir = join(targetDir, CONFIG_DIR_NAME);

      // If workspace already exists, ensure global config points to it
      if (existsSync(join(configDir, 'pilotlynx.yaml'))) {
        saveGlobalConfig(configDir);
        console.log(chalk.green(`Workspace already initialized at ${configDir}`));
        console.log(chalk.dim('Global config updated.'));
        return;
      }

      console.log(chalk.blue(`Initializing workspace "${name}" at ${targetDir}\n`));

      // Create config directory and workspace marker
      mkdirSync(configDir, { recursive: true });
      const marker = { version: 1, name, autoImprove: { enabled: true } };
      writeFileSync(join(configDir, 'pilotlynx.yaml'), YAML.stringify(marker), 'utf8');

      // Create shared directory structure inside config dir
      const dirs = [
        join('shared', 'policies'),
        join('shared', 'docs'),
        join('shared', 'insights'),
      ];
      for (const d of dirs) {
        mkdirSync(join(configDir, d), { recursive: true });
      }

      // Create default policy files
      const secretsPolicyPath = join(configDir, 'shared', 'policies', 'secrets-access.yaml');
      if (!existsSync(secretsPolicyPath)) {
        writeFileSync(secretsPolicyPath, YAML.stringify({
          version: 1,
          shared: [],
          projects: {},
        }), 'utf8');
      }

      const toolPolicyPath = join(configDir, 'shared', 'policies', 'tool-access.yaml');
      if (!existsSync(toolPolicyPath)) {
        writeFileSync(toolPolicyPath, YAML.stringify({
          version: 1,
          defaults: { allowed: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'] },
          projects: {},
        }), 'utf8');
      }

      // Copy bundled template → pilotlynx/template/
      const bundledTemplate = join(getPackageRoot(), 'template');
      const destTemplate = join(configDir, 'template');
      if (existsSync(bundledTemplate)) {
        cpSync(bundledTemplate, destTemplate, { recursive: true });
      }

      // Create empty project registry
      const registryPath = join(configDir, 'projects.yaml');
      writeFileSync(registryPath, YAML.stringify({ version: 1, projects: {} }), 'utf8');

      // Create .gitignore inside pilotlynx/ (just protects .env)
      const gitignore = [
        '# PilotLynx config',
        '.env',
        '',
      ].join('\n');
      const gitignorePath = join(configDir, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, gitignore, 'utf8');
      }

      // Create default webhook.yaml (disabled by default)
      const webhookConfigPath = join(configDir, 'webhook.yaml');
      if (!existsSync(webhookConfigPath)) {
        writeFileSync(webhookConfigPath, YAML.stringify({
          version: 1,
          enabled: false,
          webhooks: [],
        }), 'utf8');
      }

      // Register globally so pilotlynx works from any directory
      saveGlobalConfig(configDir);

      // Install cron job for schedule tick (every 15 min)
      let cronInstalled = false;
      let cronError = false;
      try {
        const pilotlynxBin = resolve(join(getPackageRoot(), 'dist', 'cli.js'));
        cronInstalled = installScheduleCron(`node ${pilotlynxBin}`);
        if (!cronInstalled) cronError = true;
      } catch {
        cronError = true;
      }

      console.log(chalk.green('Workspace initialized:'));
      console.log(`  ${chalk.dim('config')}    ${CONFIG_DIR_NAME}/`);
      console.log(`  ${chalk.dim('marker')}    ${CONFIG_DIR_NAME}/pilotlynx.yaml`);
      console.log(`  ${chalk.dim('registry')}  ${CONFIG_DIR_NAME}/projects.yaml`);
      console.log(`  ${chalk.dim('shared')}    ${CONFIG_DIR_NAME}/shared/`);
      console.log(`  ${chalk.dim('template')}  ${CONFIG_DIR_NAME}/template/`);
      console.log(`  ${chalk.dim('webhooks')}   ${CONFIG_DIR_NAME}/webhook.yaml`);
      if (cronInstalled) {
        console.log(`  ${chalk.dim('cron')}      schedule tick every 15 min (auto-improve daily)`);
      }
      console.log('');
      console.log(chalk.blue('Next steps:'));
      console.log(`  pilotlynx create <name>    Create a new project`);
      console.log(`  pilotlynx add <name>       Add an existing directory`);
      if (!cronInstalled) {
        console.log(chalk.yellow(`\n  Warning: Could not install cron job automatically.`));
        console.log(chalk.yellow(`  Scheduled workflows will not run until a cron job is configured.`));
        console.log(`\n  To enable scheduling, add this to your crontab (crontab -e):`);
        console.log(chalk.dim(`  */15 * * * * pilotlynx schedule tick >> /tmp/pilotlynx-tick.log 2>&1`));
      }
    });

  return cmd;
}
