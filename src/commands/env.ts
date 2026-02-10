import { Command } from 'commander';
import { executeEnv } from '../lib/command-ops/env-ops.js';

export function makeEnvCommand(): Command {
  const cmd = new Command('env')
    .description('Output policy-filtered environment variables for a project')
    .argument('<project>', 'project name')
    .option('--export', 'output as export KEY=value (for eval)')
    .option('--json', 'output as JSON')
    .option('--envrc', 'output as .envrc content (includes PILOTLYNX_ROOT)')
    .action(async (project: string, opts) => {
      const result = executeEnv(project, {
        export: opts.export,
        json: opts.json,
        envrc: opts.envrc,
      });

      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }

      if (result.output) {
        process.stdout.write(result.output);
      }
    });

  return cmd;
}
