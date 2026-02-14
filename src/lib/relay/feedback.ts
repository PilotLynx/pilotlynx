// ── Feedback Handler ──
// Classifies chat reactions as feedback signals and persists them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type Database from 'better-sqlite3';
import type { FeedbackSignal } from './platform.js';
import type { ChatFeedbackEntry } from './types.js';
import { INSIGHTS_DIR, getProjectDir } from '../config.js';

const FEEDBACK_FILE = () => join(INSIGHTS_DIR(), 'relay-feedback.jsonl');
const MAX_ENTRIES = 1000;

// ── Emoji Classification ──

const POSITIVE_EMOJI = new Set(['thumbsup', '+1', 'white_check_mark', 'heavy_check_mark']);
const NEGATIVE_EMOJI = new Set(['thumbsdown', '-1', 'x', 'negative_squared_cross_mark']);
const SAVE_EMOJI = new Set(['star', 'star2', 'glowing_star']);
const ACKNOWLEDGE_EMOJI = new Set(['eyes', 'mag']);

/**
 * Classify a reaction emoji into a feedback type.
 * Returns null for unrecognized emoji.
 */
export function classifyReaction(emoji: string): FeedbackSignal['type'] | null {
  const key = emoji.replace(/:/g, '').toLowerCase();
  if (POSITIVE_EMOJI.has(key)) return 'positive';
  if (NEGATIVE_EMOJI.has(key)) return 'negative';
  if (SAVE_EMOJI.has(key)) return 'save';
  if (ACKNOWLEDGE_EMOJI.has(key)) return 'acknowledge';
  return null;
}

/**
 * Convert a FeedbackSignal into a ChatFeedbackEntry.
 */
export function handleFeedback(
  signal: FeedbackSignal,
  project: string,
  agentOutputSummary?: string,
): ChatFeedbackEntry {
  return {
    type: signal.type,
    platform: signal.platform,
    conversationId: signal.conversationId,
    messageId: signal.messageId,
    userId: signal.userId,
    userName: signal.userName,
    timestamp: signal.timestamp,
    project,
    agentOutputSummary,
  };
}

/**
 * Append a feedback entry to the relay feedback JSONL file.
 * Caps at MAX_ENTRIES by trimming oldest entries when exceeded.
 */
export function appendRelayFeedback(entry: ChatFeedbackEntry): void {
  const filePath = FEEDBACK_FILE();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Read existing content, append new entry, and trim atomically
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const lines = existing.split('\n').filter(Boolean);
  lines.push(JSON.stringify(entry));

  // Trim oldest entries if over the cap
  const kept = lines.length > MAX_ENTRIES ? lines.slice(lines.length - MAX_ENTRIES) : lines;
  writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
}

/**
 * Read all feedback entries, optionally filtered by project.
 */
export function readRelayFeedback(project?: string): ChatFeedbackEntry[] {
  const filePath = FEEDBACK_FILE();
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const entries: ChatFeedbackEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ChatFeedbackEntry;
      if (!project || entry.project === project) {
        entries.push(entry);
      }
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

// ── Save to Memory ──

/**
 * Save a starred/saved response to the project's memory/ directory.
 * Creates a timestamped markdown file with the thread context and bot response.
 */
export function saveFeedbackToMemory(
  project: string,
  entry: ChatFeedbackEntry,
  botResponse?: string,
): void {
  let projectDir: string;
  try {
    projectDir = getProjectDir(project);
  } catch {
    return; // project not found — skip silently
  }

  const memoryDir = join(projectDir, 'memory');
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

  const ts = entry.timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `relay-saved-${ts}.md`;
  const filePath = join(memoryDir, filename);

  const lines = [
    `# Saved Relay Response`,
    ``,
    `- **Platform**: ${entry.platform}`,
    `- **User**: ${entry.userName}`,
    `- **Date**: ${entry.timestamp}`,
    `- **Conversation**: ${entry.conversationId}`,
    ``,
  ];

  if (botResponse) {
    lines.push(`## Response`, ``, botResponse, ``);
  }

  if (entry.agentOutputSummary) {
    lines.push(`## Agent Context`, ``, entry.agentOutputSummary, ``);
  }

  writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ── Rate Limiting ──

const reactionTimestamps = new Map<string, number[]>();

/**
 * Check if a user has exceeded the reaction rate limit (sliding window, 1 hour).
 */
export function isReactionRateLimited(userId: string, maxPerHour: number): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const cutoff = now - windowMs;

  let timestamps = reactionTimestamps.get(userId);
  if (!timestamps) {
    timestamps = [];
    reactionTimestamps.set(userId, timestamps);
  }

  // Prune old entries
  const recent = timestamps.filter((t) => t > cutoff);
  if (recent.length === 0) {
    reactionTimestamps.delete(userId);
  } else {
    reactionTimestamps.set(userId, recent);
  }

  if (recent.length >= maxPerHour) return true;

  recent.push(now);
  reactionTimestamps.set(userId, recent);
  return false;
}
