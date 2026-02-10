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

      // Check for existing workspace marker
      if (existsSync(join(configDir, 'plynx.yaml'))) {
        console.error(chalk.red(`Workspace already initialized at ${targetDir}`));
        process.exit(1);
      }

      console.log(chalk.blue(`Initializing workspace "${name}" at ${targetDir}\n`));

      // Create config directory and workspace marker
      mkdirSync(configDir, { recursive: true });
      const marker = { version: 1, name, autoImprove: { enabled: true } };
      writeFileSync(join(configDir, 'plynx.yaml'), YAML.stringify(marker), 'utf8');

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

      // Register globally so plynx works from any directory
      saveGlobalConfig(configDir);

      // Install cron job for schedule tick (every 15 min)
      let cronInstalled = false;
      try {
        const plynxBin = resolve(join(getPackageRoot(), 'dist', 'cli.js'));
        cronInstalled = installScheduleCron(`node ${plynxBin}`);
      } catch {
        // Crontab not available — skip silently
      }

      console.log(chalk.green('Workspace initialized:'));
      console.log(`  ${chalk.dim('config')}    ${CONFIG_DIR_NAME}/`);
      console.log(`  ${chalk.dim('marker')}    ${CONFIG_DIR_NAME}/plynx.yaml`);
      console.log(`  ${chalk.dim('registry')}  ${CONFIG_DIR_NAME}/projects.yaml`);
      console.log(`  ${chalk.dim('shared')}    ${CONFIG_DIR_NAME}/shared/`);
      console.log(`  ${chalk.dim('template')}  ${CONFIG_DIR_NAME}/template/`);
      if (cronInstalled) {
        console.log(`  ${chalk.dim('cron')}      schedule tick every 15 min (auto-improve daily)`);
      }
      console.log('');
      console.log(chalk.blue('Next steps:'));
      console.log(`  plynx project create <name>       Create a new project`);
      console.log(`  plynx project add <name> --path .  Add an existing directory`);
      if (!cronInstalled) {
        console.log(`\n${chalk.yellow('Note:')} Could not install cron job. To enable scheduling, add manually:`);
        console.log(`  */15 * * * * plynx schedule tick >> /tmp/plynx-tick.log 2>&1`);
      }
    });

  return cmd;
}
