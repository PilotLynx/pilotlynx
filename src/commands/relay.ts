import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getConfigRoot } from '../lib/config.js';
import { loadWebhookConfig } from '../lib/relay/config.js';
import { sendWebhookNotification } from '../lib/relay/notify.js';
import type { WebhookPayload } from '../lib/relay/types.js';

export function makeRelayCommand(): Command {
  const cmd = new Command('relay').description('Manage webhook notifications');

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

  return cmd;
}
