// ── Slack Platform Adapter ──
// Implements ChatPlatform via @slack/bolt (Socket Mode or HTTP).

import type {
  ChatPlatform,
  ChatMessage,
  PlatformCapabilities,
  StreamHandle,
} from '../platform.js';

export interface SlackAdapterConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  mode: 'socket' | 'http';
  port: number;
  mainChannel?: string;
}

export class SlackAdapter implements ChatPlatform {
  readonly name = 'slack';
  readonly capabilities: PlatformCapabilities = {
    nativeStreaming: true,
    maxStreamUpdateHz: 10,
    supportsReactions: true,
    supportsSlashCommands: true,
    supportsThreads: true,
    maxMessageLength: 4000,
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

  private app: any; // Bolt App – dynamically imported
  private botUserId: string | undefined;
  private userCache = new Map<string, string>(); // userId → displayName
  private reconnectBackoff = 1000;
  private lastEventTime = Date.now();
  private healthTimer: NodeJS.Timeout | undefined;
  private processedRetries = new Set<string>(); // dedup x-slack-retry-num

  constructor(private config: SlackAdapterConfig) {}

  async start(): Promise<void> {
    const { App } = await import('@slack/bolt');

    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      signingSecret: this.config.signingSecret,
      socketMode: this.config.mode === 'socket',
      port: this.config.port,
    });

    // ── Event: app_mention ──
    this.app.event('app_mention', async ({ event, context }: any) => {
      if (this.shouldSkipRetry(context)) return;
      this.lastEventTime = Date.now();
      const msg = await this.slackEventToChatMessage(event);
      if (!msg.isBot) await this.onMessage(msg);
    });

    // ── Event: message ──
    this.app.event('message', async ({ event, context }: any) => {
      if (this.shouldSkipRetry(context)) return;
      if (event.subtype && event.subtype !== 'file_share') return;
      this.lastEventTime = Date.now();
      const msg = await this.slackEventToChatMessage(event);
      if (!msg.isBot) await this.onMessage(msg);
    });

    // ── Event: reaction_added ──
    this.app.event('reaction_added', async ({ event, context }: any) => {
      if (this.shouldSkipRetry(context)) return;
      this.lastEventTime = Date.now();
      await this.onReaction(
        event.item.channel,
        event.item.ts,
        event.user,
        event.reaction,
      );
    });

    // ── Slash command: /pilotlynx-bind ──
    this.app.command('/pilotlynx-bind', async ({ command, ack }: any) => {
      await ack();
      this.lastEventTime = Date.now();
      const response = await this.onCommand(
        command.channel_id,
        command.user_id,
        'bind',
        command.text,
      );
      return { text: response };
    });

    await this.app.start();

    // Resolve bot user ID for self-filtering
    const authResult = await this.app.client.auth.test();
    this.botUserId = authResult.user_id;

    // Health check timer – force reconnect if no events for 90s
    this.healthTimer = setInterval(() => {
      if (Date.now() - this.lastEventTime > 90_000) {
        this.attemptReconnect();
      }
    }, 30_000);
  }

  async stop(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
    if (this.app) {
      await this.app.stop();
    }
  }

  async sendMessage(
    channelId: string,
    text: string,
    threadId?: string,
  ): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadId,
    });
    return result.ts as string;
  }

  async updateMessage(
    channelId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    await this.app.client.chat.update({
      channel: channelId,
      ts: messageId,
      text,
    });
  }

  async startStream(
    channelId: string,
    threadId?: string,
  ): Promise<StreamHandle> {
    const initialTs = await this.sendMessage(
      channelId,
      'Working on it\u2026',
      threadId,
    );
    let accumulated = '';
    let pending: NodeJS.Timeout | undefined;
    const debounceMs = 300;

    const flush = async (text: string): Promise<void> => {
      await this.updateMessage(channelId, initialTs, text);
    };

    return {
      append: async (text: string): Promise<void> => {
        accumulated += text;
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          void flush(accumulated);
        }, debounceMs);
      },
      stop: async (finalText?: string): Promise<void> => {
        if (pending) clearTimeout(pending);
        await flush(finalText ?? accumulated);
      },
    };
  }

  async uploadFile(
    channelId: string,
    content: string,
    filename: string,
    threadId?: string,
  ): Promise<void> {
    await this.app.client.files.uploadV2({
      channel_id: channelId,
      content,
      filename,
      thread_ts: threadId,
    });
  }

  async getThreadHistory(
    channelId: string,
    threadId: string,
    afterTs?: string,
  ): Promise<ChatMessage[]> {
    const result = await this.app.client.conversations.replies({
      channel: channelId,
      ts: threadId,
      oldest: afterTs,
    });

    const messages: ChatMessage[] = [];
    for (const msg of result.messages ?? []) {
      messages.push(await this.slackMsgToChatMessage(channelId, msg));
    }
    return messages;
  }

  // ── Helpers ──

  private shouldSkipRetry(context: any): boolean {
    const retryNum = context?.retryNum;
    if (retryNum == null) return false;
    const key = `${retryNum}`;
    if (this.processedRetries.has(key)) return true;
    this.processedRetries.add(key);
    // Prevent memory leak – prune old entries periodically
    if (this.processedRetries.size > 1000) {
      const entries = Array.from(this.processedRetries);
      this.processedRetries = new Set(entries.slice(-500));
    }
    return false;
  }

  private async resolveUserName(userId: string): Promise<string> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.app.client.users.info({ user: userId });
      const name =
        result.user?.profile?.display_name ||
        result.user?.real_name ||
        result.user?.name ||
        userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  private async slackEventToChatMessage(event: any): Promise<ChatMessage> {
    const isBot = !!(event.bot_id || event.user === this.botUserId);
    const userName = isBot
      ? 'bot'
      : await this.resolveUserName(event.user ?? '');

    return {
      platform: 'slack',
      channelId: event.channel,
      conversationId: event.thread_ts ?? event.ts,
      messageId: event.ts,
      userId: event.user ?? event.bot_id ?? '',
      userName,
      text: slackMrkdwnToMarkdown(event.text ?? ''),
      timestamp: event.ts,
      isBot,
    };
  }

  private async slackMsgToChatMessage(
    channelId: string,
    msg: any,
  ): Promise<ChatMessage> {
    const isBot = !!(msg.bot_id || msg.user === this.botUserId);
    const userName = isBot
      ? 'bot'
      : await this.resolveUserName(msg.user ?? '');

    return {
      platform: 'slack',
      channelId,
      conversationId: msg.thread_ts ?? msg.ts,
      messageId: msg.ts,
      userId: msg.user ?? msg.bot_id ?? '',
      userName,
      text: slackMrkdwnToMarkdown(msg.text ?? ''),
      timestamp: msg.ts,
      isBot,
    };
  }

  private attemptReconnect(): void {
    this.reconnectBackoff = Math.min(this.reconnectBackoff * 2, 30_000);
    setTimeout(async () => {
      try {
        await this.app.stop();
        await this.app.start();
        this.reconnectBackoff = 1000;
        this.lastEventTime = Date.now();
      } catch {
        // Will retry on next health check interval
      }
    }, this.reconnectBackoff);
  }
}

// ── Slack mrkdwn → Markdown conversion ──

function slackMrkdwnToMarkdown(text: string): string {
  return text
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**') // *bold* → **bold**
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '*$1*') // _italic_ → *italic*
    .replace(/~([^~]+)~/g, '~~$1~~') // ~strike~ → ~~strike~~
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)') // <url|text> → [text](url)
    .replace(/<(https?:\/\/[^>]+)>/g, '$1'); // <url> → url
}
