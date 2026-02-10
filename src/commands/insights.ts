import { Command } from 'commander';
import chalk from 'chalk';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { INSIGHTS_DIR } from '../lib/config.js';

export function makeInsightsCommand(): Command {
  const cmd = new Command('insights')
    .description('View cross-project insights from the self-improvement loop')
    .option('--last <n>', 'number of insight files to show', '5')
    .option('--since <date>', 'show insights since date (YYYY-MM-DD)')
    .action(async (opts) => {
      const dir = INSIGHTS_DIR();

      if (!existsSync(dir)) {
        console.log(chalk.dim('No insights directory found. Run `plynx improve` to generate insights.'));
        return;
      }

      let files = readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort();

      if (files.length === 0) {
        console.log(chalk.dim('No insights found. Run `plynx improve` to generate insights.'));
        return;
      }

      if (opts.since) {
        const sinceDate = opts.since;
        files = files.filter((f) => f.replace('.md', '') >= sinceDate);
      }

      const limit = parseInt(opts.last, 10) || 5;
      files = files.slice(-limit);

      if (files.length === 0) {
        console.log(chalk.dim('No insights match the given criteria.'));
        return;
      }

      for (const file of files) {
        const date = file.replace('.md', '');
        console.log(chalk.blue.bold(`── ${date} ──`));
        const content = readFileSync(join(dir, file), 'utf8');
        console.log(content.trim());
        console.log('');
      }

      console.log(chalk.dim(`${files.length} insight file(s) shown.`));
    });

  return cmd;
}
