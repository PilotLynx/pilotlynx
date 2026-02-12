import { Api } from 'grammy';
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { lock } from 'proper-lockfile';
import { loadRelayConfig, getTelegramToken, getRelayDir } from './config.js';
import type { RunRecord } from '../types.js';
import type { DeadLetter } from './types.js';

function isWebhookUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1') return false;
    // Reject private IP ranges
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (host === '0.0.0.0') return false;
    return true;
  } catch {
    return false;
  }
}

function formatRunMessage(record: RunRecord): string {
  const icon = record.success ? '\u2705' : '\u274c';
  const status = record.success ? 'Success' : 'Failed';
  const duration = (() => {
    const start = new Date(record.startedAt).getTime();
    const end = new Date(record.completedAt).getTime();
    const secs = Math.round((end - start) / 1000);
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  })();

  let msg = `${icon} *${record.project}/${record.workflow}* — ${status}\n`;
  msg += `Duration: ${duration} | Cost: $${record.costUsd.toFixed(4)} | Turns: ${record.numTurns}\n`;
  if (record.error) {
    const truncated = record.error.length > 200 ? record.error.slice(0, 200) + '...' : record.error;
    msg += `Error: ${truncated}`;
  } else if (record.summary) {
    const truncated = record.summary.length > 300 ? record.summary.slice(0, 300) + '...' : record.summary;
    msg += truncated;
  }
  return msg;
}

const MAX_DEAD_LETTERS = 1000;

async function logDeadLetter(entry: DeadLetter): Promise<void> {
  const dir = getRelayDir();
  mkdirSync(dir, { recursive: true });
  const filePath = `${dir}/dead-letters.jsonl`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', 'utf8');
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(filePath, { stale: 10_000, retries: { retries: 3, minTimeout: 100 } });
    const content = readFileSync(filePath, 'utf8').trim();
    const lines = content ? content.split('\n') : [];
    lines.push(JSON.stringify(entry));

    // Trim to last MAX_DEAD_LETTERS entries
    const trimmed = lines.length > MAX_DEAD_LETTERS ? lines.slice(-MAX_DEAD_LETTERS) : lines;
    writeFileSync(filePath, trimmed.join('\n') + '\n', 'utf8');
  } catch {
    // Best-effort: fall back to simple append if locking fails
    appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } finally {
    if (release) await release();
  }
}

async function sendWithRetry(
  fn: () => Promise<void>,
  chatId: string,
  channel: 'telegram' | 'webhook',
  payload: unknown,
  retries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      const status = (err as any)?.error_code ?? (err as any)?.status;
      // Don't retry 4xx errors (except 429 rate limits)
      if (status && status >= 400 && status < 500 && status !== 429) {
        await logDeadLetter({
          timestamp: new Date().toISOString(),
          chatId,
          channel,
          error: err instanceof Error ? err.message : String(err),
          payload,
        });
        return;
      }
      if (attempt === retries) {
        await logDeadLetter({
          timestamp: new Date().toISOString(),
          chatId,
          channel,
          error: err instanceof Error ? err.message : String(err),
          payload,
        });
        return;
      }
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
}

/**
 * Send a notification for a completed workflow run to all configured chats.
 * Uses stateless Bot.api (no running process needed).
 */
export async function sendRunNotification(record: RunRecord): Promise<void> {
  const config = loadRelayConfig();
  if (!config || !config.enabled) return;

  // Filter by notification preferences
  const shouldNotify = record.success
    ? config.notifications.onScheduleComplete
    : config.notifications.onScheduleFailure;
  if (!shouldNotify) return;

  const message = formatRunMessage(record);

  for (const [chatId, chatConfig] of Object.entries(config.routing.chats)) {
    if (!chatConfig.notifySchedule) continue;

    // Only notify chats mapped to this project (or unmapped chats)
    if (chatConfig.project && chatConfig.project !== record.project) continue;

    if (chatId.startsWith('telegram:')) {
      if (!config.channels.telegram.enabled) continue;
      const token = getTelegramToken();
      if (!token) continue;
      const tgChatId = chatId.slice('telegram:'.length);
      const api = new Api(token);
      await sendWithRetry(
        () => api.sendMessage(tgChatId, message, { parse_mode: 'Markdown' }).then(() => {}),
        chatId,
        'telegram',
        record,
      );
    } else if (chatId.startsWith('webhook:')) {
      if (!config.channels.webhook.enabled) continue;
      const url = chatId.slice('webhook:'.length);
      if (!isWebhookUrlSafe(url)) {
        await logDeadLetter({
          timestamp: new Date().toISOString(),
          chatId,
          channel: 'webhook',
          error: `Unsafe webhook URL rejected: ${url}`,
          payload: record,
        });
        continue;
      }
      await sendWithRetry(
        () => fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        }).then(res => {
          if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        }),
        chatId,
        'webhook',
        record,
      );
    }
  }
}
