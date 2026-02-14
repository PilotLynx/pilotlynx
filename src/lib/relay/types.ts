import { z } from 'zod';

export const WebhookConfigSchema = z.object({
  version: z.number().default(1),
  enabled: z.boolean().default(false),
  webhooks: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    events: z.array(z.enum(['run_complete', 'run_failed', 'improve_complete', 'schedule_complete'])).default(['run_complete', 'run_failed']),
    headers: z.record(z.string(), z.string()).optional(),
    secret: z.string().optional(),
  })).default([]),
});

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

export interface WebhookPayload {
  event: string;
  timestamp: string;
  project: string;
  workflow: string;
  success: boolean;
  summary: string;
  costUsd: number;
  durationMs?: number;
  model?: string;
}
