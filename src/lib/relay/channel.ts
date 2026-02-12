import { Bot, type Context } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Api } from 'grammy';
import { getTelegramToken } from './config.js';

export interface InboundMessage {
  chatId: string;
  userId: string;
  username: string;
  text: string;
  channel: 'telegram';
}

export type MessageHandler = (msg: InboundMessage) => Promise<void>;

export interface ChannelAdapter {
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  send(chatId: string, message: string): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
}

export class TelegramAdapter implements ChannelAdapter {
  private bot: Bot;
  private runner: RunnerHandle | null = null;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async start(handler: MessageHandler): Promise<void> {
    this.bot.on('message:text', async (ctx: Context) => {
      const msg = ctx.message!;
      try {
        await handler({
          chatId: `telegram:${msg.chat.id}`,
          userId: String(msg.from!.id),
          username: msg.from!.username ?? msg.from!.first_name ?? 'unknown',
          text: msg.text!,
          channel: 'telegram',
        });
      } catch (err) {
        console.error('Relay message handler error:', err);
      }
    });

    this.runner = run(this.bot);
  }

  async stop(): Promise<void> {
    if (this.runner) {
      this.runner.stop();
      this.runner = null;
    }
  }

  async send(chatId: string, message: string): Promise<void> {
    const tgChatId = chatId.startsWith('telegram:') ? chatId.slice('telegram:'.length) : chatId;
    // Telegram message limit is 4096 chars
    if (message.length > 4000) {
      message = message.slice(0, 4000) + '\n...(truncated)';
    }
    await this.bot.api.sendMessage(tgChatId, message);
  }

  async sendTyping(chatId: string): Promise<void> {
    const tgChatId = chatId.startsWith('telegram:') ? chatId.slice('telegram:'.length) : chatId;
    await this.bot.api.sendChatAction(tgChatId, 'typing');
  }
}

/**
 * WebhookAdapter is outbound-only. No inbound listener.
 * Sends via native fetch() — zero dependencies.
 */
export class WebhookAdapter {
  async send(chatId: string, message: string): Promise<void> {
    const url = chatId.startsWith('webhook:') ? chatId.slice('webhook:'.length) : chatId;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) throw new Error(`Webhook POST failed: HTTP ${res.status}`);
  }
}

export function createTelegramAdapter(): TelegramAdapter {
  const token = getTelegramToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not found in .env');
  return new TelegramAdapter(token);
}
