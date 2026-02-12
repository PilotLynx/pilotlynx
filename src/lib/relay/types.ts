import { z } from 'zod';

// ── Chat Routing ──

export const ChatConfigSchema = z.object({
  project: z.string().optional(),
  allowRun: z.boolean().default(true),
  allowChat: z.boolean().default(true),
  notifySchedule: z.boolean().default(true),
}).strict();

export type ChatConfig = z.infer<typeof ChatConfigSchema>;

// ── Relay Config (pilotlynx/relay.yaml) ──

export const RelayConfigSchema = z.object({
  version: z.number(),
  enabled: z.boolean().default(true),

  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().default(false),
    }).default({ enabled: false }),
    webhook: z.object({
      enabled: z.boolean().default(false),
    }).default({ enabled: false }),
  }).default({ telegram: { enabled: false }, webhook: { enabled: false } }),

  notifications: z.object({
    onScheduleComplete: z.boolean().default(true),
    onScheduleFailure: z.boolean().default(true),
  }).default({ onScheduleComplete: true, onScheduleFailure: true }),

  routing: z.object({
    defaultProject: z.string().nullable().default(null),
    chats: z.record(z.string(), ChatConfigSchema).default({}),
    allowedUsers: z.array(z.string()).default([]),
  }).default({ defaultProject: null, chats: {}, allowedUsers: [] }),
}).strict();

export type RelayConfig = z.infer<typeof RelayConfigSchema>;

// ── Conversation History ──

export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ── Dead Letter ──

export interface DeadLetter {
  timestamp: string;
  chatId: string;
  channel: 'telegram' | 'webhook';
  error: string;
  payload: unknown;
}
