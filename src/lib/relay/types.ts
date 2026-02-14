import { z } from 'zod';

// ── Webhook Config (existing) ──

export const WebhookConfigSchema = z.object({
  version: z.number().default(1),
  enabled: z.boolean().default(false),
  webhooks: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    events: z.array(z.enum(['run_complete', 'run_failed', 'improve_complete', 'schedule_complete', 'relay_run_complete', 'relay_run_failed'])).default(['run_complete', 'run_failed']),
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
  platform?: string;
  channelId?: string;
}

// ── Relay Config (relay.yaml) ──

const SlackPlatformSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['socket', 'http']).default('socket'),
  port: z.number().default(3210),
  mainChannel: z.string().optional(),
});

const TelegramPlatformSchema = z.object({
  enabled: z.boolean().default(false),
  streamMode: z.enum(['edit', 'chunked', 'final-only']).default('edit'),
  editIntervalMs: z.number().default(12000),
});

export const RelayPlatformConfigSchema = z.object({
  slack: SlackPlatformSchema.default(() => SlackPlatformSchema.parse({})),
  telegram: TelegramPlatformSchema.default(() => TelegramPlatformSchema.parse({})),
});

export const RelayAgentConfigSchema = z.object({
  maxConcurrent: z.number().min(1).max(20).default(3),
  defaultTimeoutMs: z.number().min(30_000).max(3_600_000).default(300_000),
  maxMemoryMB: z.number().min(256).max(32_768).default(4096),
  requireKernelSandbox: z.boolean().default(true),
  networkIsolation: z.boolean().default(true),
  maxTurns: z.number().min(1).max(100).default(30),
});

export const RelayContextConfigSchema = z.object({
  tokenBudget: z.number().min(1000).max(100_000).default(16_000),
  maxMessagesPerThread: z.number().min(1).max(200).default(50),
  maxCharsPerMessage: z.number().min(100).max(10_000).default(4000),
  staleThreadDays: z.number().min(1).max(365).default(7),
  enableCache: z.boolean().default(true),
});

export const RelayLimitsConfigSchema = z.object({
  userRatePerHour: z.number().min(1).max(1000).default(10),
  projectQueueDepth: z.number().min(1).max(100).default(10),
  dailyBudgetPerProject: z.number().min(0).default(10),
  reactionRatePerHour: z.number().min(1).max(1000).default(20),
  globalConcurrency: z.number().min(1).max(50).default(5),
});

export const RelayNotificationsConfigSchema = z.object({
  scheduleFailures: z.boolean().default(true),
  improveInsights: z.boolean().default(true),
  budgetAlerts: z.boolean().default(true),
  healthScoreThreshold: z.number().min(0).max(100).default(50),
});

const AdminsSchema = z.object({
  slack: z.array(z.string()).default([]),
  telegram: z.array(z.string()).default([]),
});

export const RelayConfigSchema = z.object({
  version: z.number().default(1),
  platforms: RelayPlatformConfigSchema.default(() => RelayPlatformConfigSchema.parse({})),
  agent: RelayAgentConfigSchema.default(() => RelayAgentConfigSchema.parse({})),
  context: RelayContextConfigSchema.default(() => RelayContextConfigSchema.parse({})),
  limits: RelayLimitsConfigSchema.default(() => RelayLimitsConfigSchema.parse({})),
  notifications: RelayNotificationsConfigSchema.default(() => RelayNotificationsConfigSchema.parse({})),
  admins: AdminsSchema.default(() => AdminsSchema.parse({})),
});

export type RelayConfig = z.infer<typeof RelayConfigSchema>;

// ── Binding Record ──

export interface BindingRecord {
  platform: string;
  channelId: string;
  project: string;
  boundBy: string;
  boundAt: string;
  configJson?: string;
}

// ── Chat Feedback ──

export interface ChatFeedbackEntry {
  type: 'positive' | 'negative' | 'acknowledge' | 'save';
  platform: string;
  conversationId: string;
  messageId: string;
  userId: string;
  userName: string;
  timestamp: string;
  project: string;
  agentOutputSummary?: string;
  followUpText?: string;
}

// ── Relay Run Contract ──

export interface RelayRunRequest {
  platform: string;
  channelId: string;
  conversationId: string;
  userId: string;
  userName: string;
  project: string;
  prompt: string;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
  onToolUse?: (toolName: string) => void;
}

export interface RelayRunResult {
  success: boolean;
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  numTurns: number;
  model?: string;
  gitDiffStat?: string;
}

// ── Relay Log Entry ──

export interface RelayLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
  platform?: string;
  channelId?: string;
  project?: string;
  userId?: string;
  error?: string;
}

// ── Pending Message (WAL) ──

export interface PendingMessage {
  id: string;
  platform: string;
  channelId: string;
  conversationId: string;
  userId: string;
  userName: string;
  text: string;
  receivedAt: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
}
