import { loadWebhookConfig } from './config.js';
import type { WebhookPayload } from './types.js';
import type { RunRecord } from '../types.js';

export async function sendWebhookNotification(payload: WebhookPayload): Promise<void> {
  const config = loadWebhookConfig();
  if (!config?.enabled) return;

  for (const webhook of config.webhooks) {
    if (!webhook.events.some((e) => e === payload.event)) continue;

    const body = JSON.stringify(payload);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'PilotLynx-Webhook/1.0',
      ...webhook.headers,
    };

    if (webhook.secret) {
      const crypto = await import('node:crypto');
      const signature = crypto.createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex');
      headers['X-PilotLynx-Signature'] = `sha256=${signature}`;
    }

    try {
      await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.error(`[pilotlynx] Webhook "${webhook.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Converts a RunRecord into a WebhookPayload and sends it to configured webhooks. */
export async function sendRunNotification(record: RunRecord): Promise<void> {
  const start = new Date(record.startedAt).getTime();
  const end = new Date(record.completedAt).getTime();

  const payload: WebhookPayload = {
    event: record.success ? 'run_complete' : 'run_failed',
    timestamp: record.completedAt,
    project: record.project,
    workflow: record.workflow,
    success: record.success,
    summary: record.error ?? record.summary ?? '',
    costUsd: record.costUsd,
    durationMs: end - start,
    model: record.model,
  };

  await sendWebhookNotification(payload);
}
