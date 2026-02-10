import { Command } from 'commander';
import chalk from 'chalk';
import { resolveProjectPath } from '../lib/registry.js';
import { executeLink } from '../lib/command-ops/link-ops.js';

export function makeLinkCommand(): Command {
  const cmd = new Command('link')
    .description('Configure a project for direct access (Claude Code, MCP servers)')
    .argument('<project>', 'project name')
    .option('--direnv', 'also generate .envrc with policy-filtered secrets')
    .action(async (project: string, opts) => {
      const result = executeLink(project, { direnv: opts.direnv });

      if (!result.success) {
        console.error(chalk.red(result.error ?? 'Unknown error'));
        process.exit(1);
      }

      if (result.updatedSettings) {
        console.log(chalk.green(`Updated .claude/settings.json with PILOTLYNX_ROOT`));
      }

      if (result.generatedEnvrc) {
        const projectDir = resolveProjectPath(project);
        console.log(chalk.green(`Generated .envrc with ${result.secretCount} secret(s)`));
        console.log(chalk.dim(`Run \`direnv allow\` in ${projectDir} to activate`));
      }
    });

  return cmd;
}
