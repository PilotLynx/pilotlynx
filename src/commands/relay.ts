import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getConfigRoot } from '../lib/config.js';
import { loadWebhookConfig, loadRelayConfig, getRelayDbPath } from '../lib/relay/config.js';
import { sendWebhookNotification } from '../lib/relay/notify.js';
import type { WebhookPayload } from '../lib/relay/types.js';

export function makeRelayCommand(): Command {
  const cmd = new Command('relay').description('Manage webhooks and chat relay');

  cmd
    .command('status')
    .description('Show configured webhooks')
    .action(async () => {
      const config = loadWebhookConfig();
      if (!config) {
        console.log(chalk.dim('No webhook.yaml found. Webhooks are not configured.'));
        console.log(chalk.dim('Run `pilotlynx relay add <name> --url <url>` to add one.'));
        return;
      }

      console.log(chalk.blue('Webhook Status\n'));
      console.log(chalk.bold('Enabled: ') + (config.enabled ? chalk.green('yes') : chalk.red('no')));
      console.log(chalk.bold(`Webhooks: ${config.webhooks.length}\n`));

      for (const wh of config.webhooks) {
        console.log(chalk.bold(`  ${wh.name}`));
        console.log(`    URL: ${wh.url}`);
        console.log(`    Events: ${wh.events.join(', ')}`);
        console.log(`    Secret: ${wh.secret ? 'configured' : 'none'}`);
        if (wh.headers && Object.keys(wh.headers).length > 0) {
          console.log(`    Headers: ${Object.keys(wh.headers).join(', ')}`);
        }
        console.log('');
      }
    });

  cmd
    .command('test')
    .description('Send a test payload to all configured webhooks')
    .action(async () => {
      const config = loadWebhookConfig();
      if (!config?.enabled || config.webhooks.length === 0) {
        console.log(chalk.yellow('No enabled webhooks to test.'));
        return;
      }

      const payload: WebhookPayload = {
        event: 'run_complete',
        timestamp: new Date().toISOString(),
        project: 'test-project',
        workflow: 'test-workflow',
        success: true,
        summary: 'This is a test webhook payload from PilotLynx.',
        costUsd: 0,
        durationMs: 0,
      };

      console.log(chalk.blue('Sending test payload...'));
      await sendWebhookNotification(payload);
      console.log(chalk.green('Test payload sent to all matching webhooks.'));
    });

  cmd
    .command('add')
    .description('Add a webhook to configuration')
    .argument('<name>', 'webhook name')
    .requiredOption('--url <url>', 'webhook URL (must be HTTPS)')
    .option('--secret <secret>', 'HMAC signing secret')
    .option('--events <events>', 'comma-separated event list', 'run_complete,run_failed')
    .action(async (name: string, opts: { url: string; secret?: string; events: string }) => {
      const configPath = join(getConfigRoot(), 'webhook.yaml');

      let raw: Record<string, unknown>;
      if (existsSync(configPath)) {
        raw = parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      } else {
        raw = { version: 1, enabled: true, webhooks: [] };
      }

      const webhooks = (raw.webhooks ?? []) as Array<Record<string, unknown>>;

      // Check for duplicate name
      if (webhooks.some(w => w.name === name)) {
        console.error(chalk.red(`Webhook "${name}" already exists. Remove it first.`));
        process.exit(1);
      }

      const events = opts.events.split(',').map(e => e.trim());
      const entry: Record<string, unknown> = { name, url: opts.url, events };
      if (opts.secret) entry.secret = opts.secret;

      webhooks.push(entry);
      raw.webhooks = webhooks;

      writeFileSync(configPath, stringifyYaml(raw), 'utf8');
      console.log(chalk.green(`Added webhook "${name}" -> ${opts.url}`));
      console.log(chalk.dim(`Config written to ${configPath}`));
    });

  cmd
    .command('remove')
    .description('Remove a webhook from configuration')
    .argument('<name>', 'webhook name to remove')
    .action(async (name: string) => {
      const configPath = join(getConfigRoot(), 'webhook.yaml');
      if (!existsSync(configPath)) {
        console.error(chalk.red('No webhook.yaml found.'));
        process.exit(1);
      }

      const raw = parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      const webhooks = (raw.webhooks ?? []) as Array<Record<string, unknown>>;
      const filtered = webhooks.filter(w => w.name !== name);

      if (filtered.length === webhooks.length) {
        console.error(chalk.red(`Webhook "${name}" not found.`));
        process.exit(1);
      }

      raw.webhooks = filtered;
      writeFileSync(configPath, stringifyYaml(raw), 'utf8');
      console.log(chalk.green(`Removed webhook "${name}".`));
    });

  // ── Chat Relay Commands ──

  cmd
    .command('serve')
    .description('Start the chat relay service')
    .option('--platform <name>', 'platform to enable (slack, telegram, or all)', 'all')
    .action(async (opts: { platform: string }) => {
      const config = loadRelayConfig();
      if (!config) {
        console.error(chalk.red('No relay.yaml found. Create one in your pilotlynx/ config directory.'));
        console.log(chalk.dim('See `pilotlynx relay doctor` for setup guidance.'));
        process.exit(1);
      }

      // Override platform selection if specified
      if (opts.platform !== 'all') {
        if (opts.platform === 'slack') {
          config.platforms.telegram.enabled = false;
        } else if (opts.platform === 'telegram') {
          config.platforms.slack.enabled = false;
        }
      }

      try {
        const { startRelayService } = await import('../lib/relay/service.js');
        const service = await startRelayService();
        console.log(chalk.green('Relay service is running. Press Ctrl+C to stop.'));

        // Keep the process alive
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => resolve());
          process.on('SIGTERM', () => resolve());
        });
      } catch (err) {
        console.error(chalk.red(`Failed to start relay: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command('stop')
    .description('Stop the running relay service')
    .action(async () => {
      try {
        const { stopRelayByPid } = await import('../lib/relay/service.js');
        const stopped = stopRelayByPid();
        if (stopped) {
          console.log(chalk.green('Sent stop signal to relay service.'));
        } else {
          console.log(chalk.yellow('No relay service is running.'));
        }
      } catch (err) {
        console.error(chalk.red(`Failed to stop relay: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command('bind')
    .description('Bind a platform channel to a project')
    .argument('<platform>', 'platform name (slack or telegram)')
    .argument('<channel-id>', 'channel identifier')
    .argument('<project>', 'project name')
    .action(async (platform: string, channelId: string, project: string) => {
      try {
        const { initDb } = await import('../lib/relay/db.js');
        const { saveBinding } = await import('../lib/relay/bindings.js');

        const db = initDb(getRelayDbPath());
        saveBinding(db, platform, channelId, project, 'cli');
        db.close();

        console.log(chalk.green(`Bound ${platform}/${channelId} → ${project}`));
      } catch (err) {
        console.error(chalk.red(`Failed to bind: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command('unbind')
    .description('Remove a channel binding')
    .argument('<platform>', 'platform name')
    .argument('<channel-id>', 'channel identifier')
    .action(async (platform: string, channelId: string) => {
      try {
        const { initDb } = await import('../lib/relay/db.js');
        const { removeBinding } = await import('../lib/relay/bindings.js');

        const db = initDb(getRelayDbPath());
        const removed = removeBinding(db, platform, channelId);
        db.close();

        if (removed) {
          console.log(chalk.green(`Removed binding for ${platform}/${channelId}`));
        } else {
          console.log(chalk.yellow(`No binding found for ${platform}/${channelId}`));
        }
      } catch (err) {
        console.error(chalk.red(`Failed to unbind: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command('bindings')
    .description('List all channel bindings')
    .action(async () => {
      try {
        const { initDb } = await import('../lib/relay/db.js');
        const { getAllBindings } = await import('../lib/relay/bindings.js');

        const dbPath = getRelayDbPath();
        if (!existsSync(dbPath)) {
          console.log(chalk.dim('No relay database found. Run `pilotlynx relay serve` first.'));
          return;
        }

        const db = initDb(dbPath);
        const bindings = getAllBindings(db);
        db.close();

        if (bindings.length === 0) {
          console.log(chalk.dim('No bindings configured.'));
          return;
        }

        console.log(chalk.blue('Channel Bindings\n'));
        for (const b of bindings) {
          console.log(`  ${chalk.bold(b.platform)}/${b.channelId} → ${chalk.green(b.project)} (by ${b.boundBy}, ${b.boundAt})`);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to list bindings: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command('doctor')
    .description('Check relay prerequisites and recommend settings')
    .action(async () => {
      console.log(chalk.blue('Relay Doctor\n'));

      // Check relay.yaml
      const config = loadRelayConfig();
      if (config) {
        console.log(chalk.green('  ✓ relay.yaml found'));
      } else {
        console.log(chalk.red('  ✗ relay.yaml not found'));
        console.log(chalk.dim('    Create pilotlynx/relay.yaml with platform configuration.'));
      }

      // Check sandbox
      try {
        const { detectSandbox } = await import('../lib/sandbox.js');
        const sandbox = detectSandbox();
        if (sandbox.level === 'kernel') {
          console.log(chalk.green(`  ✓ Kernel sandbox available (${sandbox.mechanism})`));
        } else {
          console.log(chalk.yellow('  ⚠ No kernel sandbox — relay requires bwrap (Linux) or sandbox-exec (macOS)'));
        }
      } catch {
        console.log(chalk.red('  ✗ Could not check sandbox'));
      }

      // Check env tokens
      const envPath = join(getConfigRoot(), '.env');
      if (existsSync(envPath)) {
        const { loadRootEnv } = await import('../lib/env-loader.js');
        const env = loadRootEnv(envPath);
        const hasSlack = !!(env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN);
        const hasTelegram = !!env.TELEGRAM_BOT_TOKEN;
        console.log(hasSlack ? chalk.green('  ✓ Slack tokens present') : chalk.dim('  - Slack tokens not configured'));
        console.log(hasTelegram ? chalk.green('  ✓ Telegram token present') : chalk.dim('  - Telegram token not configured'));
      } else {
        console.log(chalk.yellow('  ⚠ .env file not found'));
      }

      // Check optional deps
      for (const [pkg, label] of [['@slack/bolt', 'Slack (Bolt)'], ['grammy', 'Telegram (grammy)'], ['better-sqlite3', 'SQLite'], ['p-queue', 'Queue']]) {
        try {
          await import(pkg);
          console.log(chalk.green(`  ✓ ${label} installed`));
        } catch {
          console.log(chalk.dim(`  - ${label} not installed (npm i ${pkg})`));
        }
      }

      // Memory recommendation
      const totalMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const recommended = Math.max(1, Math.min(5, Math.floor(totalMem / 500)));
      console.log(`\n${chalk.bold('Recommended maxConcurrent:')} ${recommended} (based on ${totalMem}MB current RSS)`);
    });

  return cmd;
}
