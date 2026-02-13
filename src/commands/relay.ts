import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getConfigRoot } from '../lib/config.js';
import { loadRelayConfig, getTelegramToken } from '../lib/relay/config.js';
import { createTelegramAdapter } from '../lib/relay/channel.js';
import { createRouter } from '../lib/relay/router.js';
import { installService, uninstallService, getServiceStatus } from '../lib/relay/service.js';

export function makeRelayCommand(): Command {
  const cmd = new Command('relay').description('Manage the Telegram/webhook relay');

  cmd
    .command('start')
    .description('Start the relay bot (long-running process)')
    .action(async () => {
      const config = loadRelayConfig();
      if (!config) {
        console.error(chalk.red('No relay.yaml found. Create one in your pilotlynx/ directory.'));
        console.log(chalk.dim('See: pilotlynx relay --help'));
        process.exit(1);
      }

      if (!config.enabled) {
        console.error(chalk.yellow('Relay is disabled in relay.yaml (enabled: false).'));
        process.exit(1);
      }

      if (!config.channels.telegram.enabled) {
        console.error(chalk.yellow('No channels enabled. Enable telegram in relay.yaml.'));
        process.exit(1);
      }

      const token = getTelegramToken();
      if (!token) {
        console.error(chalk.red('TELEGRAM_BOT_TOKEN not found in .env'));
        process.exit(1);
      }

      console.log(chalk.blue('Starting PilotLynx Relay...'));

      const adapter = createTelegramAdapter();
      const router = createRouter(adapter);

      // Handle graceful shutdown
      const shutdown = async () => {
        console.log(chalk.dim('\nShutting down relay...'));
        try {
          await adapter.stop();
        } catch (err) {
          console.error('Error during shutdown:', err);
        }
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await adapter.start(router);

      const chatCount = Object.keys(config.routing.chats).length;
      console.log(chalk.green('Relay is running.'));
      console.log(chalk.dim(`  Channels: Telegram`));
      console.log(chalk.dim(`  Mapped chats: ${chatCount}`));
      console.log(chalk.dim(`  Press Ctrl+C to stop\n`));
    });

  cmd
    .command('status')
    .description('Show relay configuration and service status')
    .action(async () => {
      const config = loadRelayConfig();
      if (!config) {
        console.log(chalk.dim('No relay.yaml found. Relay is not configured.'));
        return;
      }

      console.log(chalk.blue('Relay Status\n'));
      console.log(chalk.bold('Enabled: ') + (config.enabled ? chalk.green('yes') : chalk.red('no')));
      console.log(chalk.bold('Telegram: ') + (config.channels.telegram.enabled ? chalk.green('enabled') : chalk.dim('disabled')));
      console.log(chalk.bold('Webhook: ') + (config.channels.webhook.enabled ? chalk.green('enabled') : chalk.dim('disabled')));

      const token = getTelegramToken();
      console.log(chalk.bold('Bot token: ') + (token ? chalk.green('configured') : chalk.red('missing')));

      console.log(chalk.bold('\nNotifications:'));
      console.log(`  On success: ${config.notifications.onScheduleComplete ? 'yes' : 'no'}`);
      console.log(`  On failure: ${config.notifications.onScheduleFailure ? 'yes' : 'no'}`);

      const chats = Object.entries(config.routing.chats);
      console.log(chalk.bold(`\nMapped chats: ${chats.length}`));
      for (const [chatId, chatConfig] of chats) {
        const project = chatConfig.project ?? '(any)';
        const flags = [
          chatConfig.allowRun ? 'run' : null,
          chatConfig.allowChat ? 'chat' : null,
          chatConfig.notifySchedule ? 'notify' : null,
        ].filter(Boolean).join(', ');
        console.log(`  ${chatId} → ${project} [${flags}]`);
      }

      // Service status
      const service = getServiceStatus();
      console.log(chalk.bold('\nService:'));
      console.log(`  Platform: ${service.platform}`);
      console.log(`  Installed: ${service.installed ? chalk.green('yes') : chalk.dim('no')}`);
      console.log(`  Running: ${service.running ? chalk.green('yes') : chalk.dim('no')}`);
    });

  cmd
    .command('install')
    .description('Install relay as a system service')
    .action(async () => {
      try {
        const config = loadRelayConfig();
        if (!config) {
          console.error(chalk.red('No relay.yaml found. Configure relay first.'));
          process.exit(1);
        }
        installService();
        console.log(chalk.green('Relay service installed and started.'));
        console.log(chalk.dim('Use `pilotlynx relay status` to check.'));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  cmd
    .command('uninstall')
    .description('Remove relay system service')
    .action(async () => {
      try {
        uninstallService();
        console.log(chalk.green('Relay service removed.'));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  cmd
    .command('add-chat')
    .description('Map a Telegram chat ID to a project')
    .argument('<chatId>', 'Telegram chat ID (numeric)')
    .requiredOption('--project <name>', 'project name to map')
    .option('--no-run', 'disable /run commands')
    .option('--no-chat', 'disable free-form chat')
    .option('--no-notify', 'disable schedule notifications')
    .action(async (chatId: string, opts: { project: string; run: boolean; chat: boolean; notify: boolean }) => {
      const configPath = join(getConfigRoot(), 'relay.yaml');

      // Create relay.yaml if it doesn't exist
      let raw: Record<string, unknown>;
      if (existsSync(configPath)) {
        raw = parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      } else {
        raw = {
          version: 1,
          enabled: true,
          channels: { telegram: { enabled: true }, webhook: { enabled: false } },
          notifications: { onScheduleComplete: true, onScheduleFailure: true },
          routing: { defaultProject: null, chats: {}, allowedUsers: [] },
        };
      }

      // Ensure routing.chats exists
      const routing = (raw.routing ?? {}) as Record<string, unknown>;
      const chats = (routing.chats ?? {}) as Record<string, unknown>;

      const key = `telegram:${chatId}`;
      chats[key] = {
        project: opts.project,
        allowRun: opts.run,
        allowChat: opts.chat,
        notifySchedule: opts.notify,
      };

      routing.chats = chats;
      raw.routing = routing;

      const tmpPath = configPath + '.tmp';
      writeFileSync(tmpPath, stringifyYaml(raw), 'utf8');
      renameSync(tmpPath, configPath);
      console.log(chalk.green(`Mapped chat ${chatId} → project "${opts.project}"`));
      console.log(chalk.dim(`Config written to ${configPath}`));
    });

  return cmd;
}
