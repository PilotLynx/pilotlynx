import { Command } from 'commander';
import chalk from 'chalk';
import { runDoctorChecks } from '../lib/command-ops/doctor-ops.js';
import type { CheckStatus } from '../lib/command-ops/doctor-ops.js';

const statusIcon: Record<CheckStatus, string> = {
  pass: chalk.green('[OK]'),
  warn: chalk.yellow('[!!]'),
  fail: chalk.red('[FAIL]'),
};

export function makeDoctorCommand(): Command {
  const cmd = new Command('doctor')
    .description('Check workspace health and configuration')
    .action(async () => {
      console.log(chalk.blue.bold('Workspace Health Check\n'));

      const checks = runDoctorChecks();
      let hasIssues = false;

      for (const check of checks) {
        const icon = statusIcon[check.status];
        console.log(`  ${icon}  ${check.name}: ${check.message}`);
        if (check.suggestion && check.status !== 'pass') {
          console.log(`        ${chalk.dim(check.suggestion)}`);
          hasIssues = true;
        }
      }

      const passed = checks.filter(c => c.status === 'pass').length;
      const warned = checks.filter(c => c.status === 'warn').length;
      const failed = checks.filter(c => c.status === 'fail').length;

      console.log('');
      if (!hasIssues) {
        console.log(chalk.green(`All ${passed} checks passed.`));
      } else {
        console.log(
          `${chalk.green(`${passed} passed`)}, ` +
          `${warned > 0 ? chalk.yellow(`${warned} warning(s)`) : '0 warnings'}, ` +
          `${failed > 0 ? chalk.red(`${failed} failed`) : '0 failed'}`
        );
      }
    });

  return cmd;
}
