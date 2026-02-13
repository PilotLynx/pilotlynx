#!/usr/bin/env node

import { Command } from 'commander';
import { getVersion } from './lib/config.js';
import { makeCreateCommand, makeAddCommand, makeRemoveCommand } from './commands/project.js';
import { makeListCommand } from './commands/projects.js';
import { makeRunCommand } from './commands/run.js';
import { makeVerifyCommand } from './commands/verify.js';
import { makeImproveCommand } from './commands/improve.js';
import { makeScheduleCommand } from './commands/schedule.js';
import { makeSyncCommand } from './commands/sync.js';
import { makeInitCommand } from './commands/init.js';
import { makeEnvCommand } from './commands/env.js';
import { makeLinkCommand } from './commands/link.js';
import { makeUnlinkCommand } from './commands/unlink.js';
import { makeLogsCommand } from './commands/logs.js';
import { makeInsightsCommand } from './commands/insights.js';
import { makeRelayCommand } from './commands/relay.js';
import { makeStatusCommand } from './commands/status.js';
import { makeCostCommand } from './commands/cost.js';
import { makeDoctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('plynx')
  .description('PilotLynx — local monorepo orchestration for Claude Agent SDK workflows')
  .version(getVersion())
  .exitOverride()
  .showSuggestionAfterError();

program.option('--verbose', 'enable verbose output');

// Commands that work without a workspace
program.addCommand(makeInitCommand());

// Project management (top-level — plynx manages projects by default)
program.addCommand(makeCreateCommand());
program.addCommand(makeAddCommand());
program.addCommand(makeRemoveCommand());
program.addCommand(makeListCommand());

// Workspace commands
program.addCommand(makeScheduleCommand());
program.addCommand(makeSyncCommand());
program.addCommand(makeRunCommand());
program.addCommand(makeVerifyCommand());
program.addCommand(makeImproveCommand());
program.addCommand(makeEnvCommand());
program.addCommand(makeLinkCommand());
program.addCommand(makeUnlinkCommand());
program.addCommand(makeLogsCommand());
program.addCommand(makeInsightsCommand());
program.addCommand(makeRelayCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeCostCommand());
program.addCommand(makeDoctorCommand());

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof Error && 'code' in err && err.code === 'commander.helpDisplayed') {
    process.exit(0);
  }
  if (err instanceof Error && 'code' in err && err.code === 'commander.version') {
    process.exit(0);
  }
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
}
