import { Command } from 'commander';
import chalk from 'chalk';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { INSIGHTS_DIR } from '../lib/config.js';
import type { StructuredInsight } from '../lib/observation.js';

export function makeInsightsCommand(): Command {
  const cmd = new Command('insights')
    .description('View cross-project insights from the self-improvement loop')
    .option('--last <n>', 'number of insight files to show', '5')
    .option('--since <date>', 'show insights since date (YYYY-MM-DD)')
    .option('--category <cat>', 'filter by category (performance, reliability, cost, patterns)')
    .option('--active', 'show only non-superseded insights')
    .option('--json', 'output structured JSON insights')
    .action(async (opts) => {
      const dir = INSIGHTS_DIR();

      if (!existsSync(dir)) {
        console.log(chalk.dim('No insights directory found. Run `pilotlynx improve` to generate insights.'));
        return;
      }

      // Structured JSON mode
      if (opts.json || opts.category || opts.active) {
        return showStructuredInsights(dir, opts);
      }

      let files = readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort();

      if (files.length === 0) {
        console.log(chalk.dim('No insights found. Run `pilotlynx improve` to generate insights.'));
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

function showStructuredInsights(dir: string, opts: { last?: string; since?: string; category?: string; active?: boolean; json?: boolean }): void {
  let jsonFiles = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('improve-log') && !f.startsWith('feedback-log'))
    .sort();

  if (jsonFiles.length === 0) {
    console.log(chalk.dim('No structured insights found. Run `pilotlynx improve` to generate insights.'));
    return;
  }

  if (opts.since) {
    const sinceDate = opts.since;
    jsonFiles = jsonFiles.filter((f) => f.replace('.json', '') >= sinceDate);
  }

  const limit = parseInt(opts.last ?? '5', 10) || 5;
  jsonFiles = jsonFiles.slice(-limit);

  // Load all insights from selected files
  let insights: StructuredInsight[] = [];
  for (const file of jsonFiles) {
    try {
      const content = readFileSync(join(dir, file), 'utf8');
      const parsed = JSON.parse(content) as StructuredInsight[];
      insights.push(...parsed);
    } catch {
      // Skip corrupt files
    }
  }

  // Filter by category
  if (opts.category) {
    insights = insights.filter((i) => i.category === opts.category);
  }

  // Filter active (non-superseded)
  if (opts.active) {
    const supersededIds = new Set(insights.filter((i) => i.supersedes).map((i) => i.supersedes!));
    insights = insights.filter((i) => !supersededIds.has(i.id));
  }

  if (insights.length === 0) {
    console.log(chalk.dim('No insights match the given criteria.'));
    return;
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(insights, null, 2));
  } else {
    for (const insight of insights) {
      const actionTag = insight.actionable ? chalk.green('actionable') : chalk.dim('informational');
      console.log(`${chalk.blue(`[${insight.category}]`)} ${insight.insight} ${actionTag}`);
      console.log(chalk.dim(`  Evidence: ${insight.evidence}`));
      if (insight.supersedes) {
        console.log(chalk.dim(`  Supersedes: ${insight.supersedes}`));
      }
      console.log('');
    }
    console.log(chalk.dim(`${insights.length} insight(s) shown.`));
  }
}
