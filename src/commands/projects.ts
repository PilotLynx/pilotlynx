import { Command } from 'commander';
import chalk from 'chalk';
import { getRegisteredProjects } from '../lib/registry.js';

export function makeProjectsCommand(): Command {
  const cmd = new Command('projects').description('List and manage projects');

  cmd
    .command('list')
    .description('List all projects')
    .action(async () => {
      const projects = getRegisteredProjects();
      const names = Object.keys(projects);

      if (names.length === 0) {
        console.log(chalk.yellow('No projects found. Create one with: plynx project create <name>'));
        return;
      }

      console.log(chalk.blue('Projects:\n'));
      for (const name of names) {
        const entry = projects[name];
        console.log(`  ${chalk.white(name)}  ${chalk.dim(entry.path)}`);
      }
      console.log(`\n${chalk.dim(`${names.length} project(s)`)}`);
    });

  return cmd;
}
