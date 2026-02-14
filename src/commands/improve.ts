import { Command } from 'commander';
import chalk from 'chalk';
import { executeImprove, executeRevert } from '../lib/command-ops/improve-ops.js';

function truncate(str: string, maxLen = 200): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export function makeImproveCommand(): Command {
  const cmd = new Command('improve')
    .description('Trigger self-improvement loop across all projects')
    .option('--dry-run', 'Run analysis only, print feedback without dispatching')
    .option('--budget <usd>', 'Maximum budget for the improvement cycle in USD', parseFloat)
    .option('--days <n>', 'Number of days of logs to analyze (default: 7)', parseInt)
    .option('--revert <project>', 'Revert last improvement for a project')
    .action(async (opts) => {
      // Handle revert
      if (opts.revert) {
        console.log(chalk.blue(`Reverting last improvement for "${opts.revert}"...`));
        const revertResult = await executeRevert(opts.revert);
        if (revertResult.success) {
          console.log(chalk.green(`Successfully reverted "${opts.revert}" to pre-improve state.`));
        } else {
          console.error(chalk.red(`Revert failed: ${revertResult.error}`));
          process.exit(1);
        }
        return;
      }

      if (opts.dryRun) {
        console.log(chalk.blue('Starting improvement analysis (dry run)...\n'));
      } else {
        console.log(chalk.blue('Starting improvement cycle...\n'));
      }

      const result = await executeImprove({
        dryRun: opts.dryRun,
        budget: opts.budget,
        days: opts.days,
      });

      if (result.noProjects) {
        console.log(chalk.yellow('No projects found. Nothing to improve.'));
        return;
      }

      if (result.noActivity) {
        console.log(chalk.yellow('No recent activity found across projects.'));
        console.log('Run some workflows first, then try improve again.');
        return;
      }

      if (!result.success && result.error) {
        console.error(chalk.red(`Improvement analysis failed: ${truncate(result.error)}`));
        process.exit(1);
      }

      if (result.noFeedback) {
        console.log(chalk.yellow('No structured feedback produced.'));
        return;
      }

      // Dry-run: print structured output
      if (result.dryRunOutput) {
        const output = result.dryRunOutput;
        console.log(chalk.blue.bold('=== Dry Run Results ===\n'));

        for (const [project, feedback] of Object.entries(output.projectFeedback)) {
          console.log(chalk.bold(`${project} [${feedback.priority}]`));
          console.log(`  ${feedback.summary}`);
          if (feedback.actionItems.length > 0) {
            console.log('  Action items:');
            for (const item of feedback.actionItems) {
              console.log(`    - ${item}`);
            }
          }
          if (feedback.suggestedSkills && feedback.suggestedSkills.length > 0) {
            console.log('  Suggested skills:');
            for (const skill of feedback.suggestedSkills) {
              console.log(`    - ${skill.name}: ${skill.description}`);
            }
          }
          if (feedback.suggestedRules && feedback.suggestedRules.length > 0) {
            console.log('  Suggested rules:');
            for (const rule of feedback.suggestedRules) {
              console.log(`    - ${rule.name}: ${rule.content}`);
            }
          }
          if (feedback.modifyClaude) {
            console.log(chalk.yellow('  CLAUDE.md update requested'));
          }
          console.log('');
        }

        if (output.crossProjectInsights.length > 0) {
          console.log(chalk.blue.bold('Cross-Project Insights:'));
          for (const insight of output.crossProjectInsights) {
            console.log(`  [${insight.category}] ${insight.insight}`);
          }
          console.log('');
        }

        if (output.antiPatterns && output.antiPatterns.length > 0) {
          console.log(chalk.blue.bold('Anti-Patterns Detected:'));
          for (const ap of output.antiPatterns) {
            console.log(`  - ${ap.pattern}: ${ap.reason}`);
          }
          console.log('');
        }

        if (result.totalCostUsd !== undefined) {
          console.log(chalk.dim(`Analysis cost: $${result.totalCostUsd.toFixed(4)}`));
        }
        return;
      }

      // Normal run results
      if (result.failures && result.failures.length > 0) {
        console.log(chalk.yellow(`\nImprovement cycle completed with ${result.failures.length} failure(s):`));
        for (const f of result.failures) {
          console.log(chalk.yellow(`  - ${f.project}: ${truncate(f.error)}`));
        }
      } else {
        console.log(chalk.green('\nImprovement cycle complete.'));
      }

      if (result.totalCostUsd !== undefined) {
        console.log(chalk.dim(`Total cost: $${result.totalCostUsd.toFixed(4)}`));
      }
    });

  return cmd;
}
