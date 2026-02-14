// ── Telegram Platform Adapter ──
// Implements ChatPlatform via grammy Bot framework.

import type {
  ChatPlatform,
  ChatMessage,
  PlatformCapabilities,
  StreamHandle,
} from '../platform.js';

export interface TelegramAdapterConfig {
  botToken: string;
  streamMode: 'edit' | 'chunked' | 'final-only';
  editIntervalMs: number;
}

export class TelegramAdapter implements ChatPlatform {
  readonly name = 'telegram';
  readonly capabilities: PlatformCapabilities = {
    nativeStreaming: false,
    maxStreamUpdateHz: 0.08,
    supportsReactions: true,
    supportsSlashCommands: false,
    supportsThreads: false,
    maxMessageLength: 4096,
  };

  onMessage: (msg: ChatMessage) => Promise<void> = async () => {};
  onReaction: (
    channelId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ) => Promise<void> = async () => {};
  onCommand: (
    channelId: string,
    userId: string,
    command: string,
    args: string,
  ) => Promise<string> = async () => '';

  private bot: any; // grammy Bot – dynamically imported
  private InputFile: any; // grammy InputFile constructor

  constructor(private config: TelegramAdapterConfig) {}

  async start(): Promise<void> {
    const grammy = await import('grammy');
    const { Bot } = grammy;
    this.InputFile = grammy.InputFile;

    this.bot = new Bot(this.config.botToken);

    // ── Text messages ──
    this.bot.on('message:text', async (ctx: any) => {
      const msg = ctx.message;

      // Handle /command messages
      if (msg.text.startsWith('/')) {
        const [cmdRaw, ...rest] = msg.text.split(' ');
        const command = cmdRaw.slice(1).replace(/@.*$/, ''); // strip /prefix and @botname
        const args = rest.join(' ');
        const response = await this.onCommand(
          String(msg.chat.id),
          String(msg.from.id),
          command,
          args,
        );
        if (response) {
          await ctx.reply(response);
        }
        return;
      }

      const chatMessage = this.telegramToChatMessage(msg);
      await this.onMessage(chatMessage);
    });

    // ── Callback queries (inline keyboard feedback) ──
    this.bot.on('callback_query:data', async (ctx: any) => {
      const query = ctx.callbackQuery;
      await ctx.answerCallbackQuery();
      await this.onReaction(
        String(query.message?.chat?.id ?? ''),
        String(query.message?.message_id ?? ''),
        String(query.from.id),
        query.data,
      );
    });

    await this.bot.start();
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
    }
  }

  async sendMessage(
    channelId: string,
    text: string,
    threadId?: string,
  ): Promise<string> {
    const opts: any = {};
    if (threadId) {
      opts.reply_to_message_id = parseInt(threadId, 10);
    }
    const escaped = escapeMarkdownV2(text);
    const result = await this.bot.api.sendMessage(
      channelId,
      escaped,
      { ...opts, parse_mode: 'MarkdownV2' },
    );
    return String(result.message_id);
  }

  async updateMessage(
    channelId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    const escaped = escapeMarkdownV2(text);
    await this.bot.api.editMessageText(
      channelId,
      parseInt(messageId, 10),
      escaped,
      { parse_mode: 'MarkdownV2' },
    );
  }

  async startStream(
    channelId: string,
    threadId?: string,
  ): Promise<StreamHandle> {
    const mode = this.config.streamMode;
    const intervalMs = this.config.editIntervalMs;

    if (mode === 'final-only') {
      return this.streamFinalOnly(channelId, threadId);
    }
    if (mode === 'chunked') {
      return this.streamChunked(channelId, threadId);
    }
    // Default: 'edit' mode
    return this.streamEdit(channelId, threadId, intervalMs);
  }

  async uploadFile(
    channelId: string,
    content: string,
    filename: string,
    threadId?: string,
  ): Promise<void> {
    const opts: any = {};
    if (threadId) {
      opts.reply_to_message_id = parseInt(threadId, 10);
    }
    const inputFile = new this.InputFile(Buffer.from(content), filename);
    await this.bot.api.sendDocument(channelId, inputFile, opts);
  }

  async getThreadHistory(
    _channelId: string,
    _threadId: string,
    _afterTs?: string,
  ): Promise<ChatMessage[]> {
    // Telegram has no thread history API – rely on SQLite cache
    return [];
  }

  // ── Stream mode implementations ──

  private async streamEdit(
    channelId: string,
    threadId: string | undefined,
    intervalMs: number,
  ): Promise<StreamHandle> {
    const msgId = await this.sendMessage(
      channelId,
      'Working on it\u2026',
      threadId,
    );
    let accumulated = '';
    let lastUpdate = 0;
    let pending: NodeJS.Timeout | undefined;

    const flush = async (text: string): Promise<void> => {
      const now = Date.now();
      if (now - lastUpdate < intervalMs) return;
      lastUpdate = now;
      try {
        await this.updateMessage(channelId, msgId, text);
      } catch {
        // Telegram rate limit or identical content – ignore
      }
    };

    return {
      append: async (text: string): Promise<void> => {
        accumulated += text;
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          void flush(accumulated);
        }, intervalMs);
      },
      stop: async (finalText?: string): Promise<void> => {
        if (pending) clearTimeout(pending);
        await this.updateMessage(channelId, msgId, finalText ?? accumulated);
      },
    };
  }

  private async streamChunked(
    channelId: string,
    threadId: string | undefined,
  ): Promise<StreamHandle> {
    const chunkSize = 2000;
    let accumulated = '';
    let sentLength = 0;

    return {
      append: async (text: string): Promise<void> => {
        accumulated += text;
        while (accumulated.length - sentLength >= chunkSize) {
          const chunk = accumulated.slice(sentLength, sentLength + chunkSize);
          await this.sendMessage(channelId, chunk, threadId);
          sentLength += chunkSize;
        }
      },
      stop: async (finalText?: string): Promise<void> => {
        const remaining = finalText ?? accumulated.slice(sentLength);
        if (remaining.length > 0) {
          await this.sendMessage(channelId, remaining, threadId);
        }
      },
    };
  }

  private streamFinalOnly(
    channelId: string,
    threadId: string | undefined,
  ): StreamHandle {
    let accumulated = '';

    return {
      append: async (text: string): Promise<void> => {
        accumulated += text;
      },
      stop: async (finalText?: string): Promise<void> => {
        const content = finalText ?? accumulated;
        if (content.length > 0) {
          await this.sendMessage(channelId, content, threadId);
        }
      },
    };
  }

  // ── Helpers ──

  private telegramToChatMessage(msg: any): ChatMessage {
    const conversationId = this.resolveConversationId(msg);
    return {
      platform: 'telegram',
      channelId: String(msg.chat.id),
      conversationId,
      messageId: String(msg.message_id),
      userId: String(msg.from.id),
      userName:
        msg.from.username ||
        [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') ||
        String(msg.from.id),
      text: msg.text ?? '',
      timestamp: String(msg.date),
      isBot: msg.from.is_bot ?? false,
    };
  }

  private resolveConversationId(msg: any): string {
    // Walk reply chain to find root message ID
    let current = msg;
    while (current.reply_to_message) {
      current = current.reply_to_message;
    }
    return String(current.message_id);
  }
}

// ── Telegram MarkdownV2 escaping ──

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
