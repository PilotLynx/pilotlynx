import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { getRelayDir } from './config.js';
import type { ConversationEntry } from './types.js';

const MAX_ENTRIES = 200;

function getConversationDir(): string {
  const dir = join(getRelayDir(), 'conversations');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeChatId(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getConversationPath(chatId: string): string {
  return join(getConversationDir(), `${sanitizeChatId(chatId)}.jsonl`);
}

function ensureFileExists(filePath: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', 'utf8');
  }
}

export async function appendConversation(chatId: string, entry: ConversationEntry): Promise<void> {
  const filePath = getConversationPath(chatId);
  ensureFileExists(filePath);

  const release = await lock(filePath, { stale: 10_000, retries: { retries: 3, minTimeout: 100 } });
  try {
    // Read current entries to check if trimming needed
    const content = readFileSync(filePath, 'utf8').trim();
    const lines = content ? content.split('\n') : [];

    lines.push(JSON.stringify(entry));

    // Trim to MAX_ENTRIES
    if (lines.length > MAX_ENTRIES) {
      const trimmed = lines.slice(lines.length - MAX_ENTRIES);
      writeFileSync(filePath, trimmed.join('\n') + '\n', 'utf8');
    } else {
      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
    }
  } finally {
    await release();
  }
}

export function getRecentConversation(chatId: string, n = 20): ConversationEntry[] {
  const filePath = getConversationPath(chatId);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];

  const lines = content.split('\n');
  const recent = lines.slice(-n);

  return recent.map(line => {
    try {
      return JSON.parse(line) as ConversationEntry;
    } catch {
      return null;
    }
  }).filter((e): e is ConversationEntry => e !== null);
}
