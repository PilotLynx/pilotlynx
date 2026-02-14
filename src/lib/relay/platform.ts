// ── Chat Platform Abstraction ──
// Platform-agnostic interface for bi-directional chat relay.
// Slack and Telegram adapters implement this contract.

export interface ChatMessage {
  platform: string;
  channelId: string;
  conversationId: string; // Slack: thread_ts, Telegram: reply chain root
  messageId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
  isBot: boolean;
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  type: string;
  url: string;
  content?: string;
}

export interface PlatformCapabilities {
  nativeStreaming: boolean;
  maxStreamUpdateHz: number; // Slack: ~10, Telegram: ~0.08
  supportsReactions: boolean;
  supportsSlashCommands: boolean;
  supportsThreads: boolean;
  maxMessageLength: number; // Slack: 4000, Telegram: 4096
}

export interface StreamHandle {
  append(text: string): Promise<void>;
  stop(finalText?: string): Promise<void>;
}

export interface ChatPlatform {
  readonly name: string;
  readonly capabilities: PlatformCapabilities;

  start(): Promise<void>;
  stop(): Promise<void>;

  sendMessage(channelId: string, text: string, threadId?: string): Promise<string>;
  updateMessage(channelId: string, messageId: string, text: string): Promise<void>;
  startStream(channelId: string, threadId?: string): Promise<StreamHandle>;
  uploadFile(channelId: string, content: string, filename: string, threadId?: string): Promise<void>;
  getThreadHistory(channelId: string, threadId: string, afterTs?: string): Promise<ChatMessage[]>;

  onMessage: (msg: ChatMessage) => Promise<void>;
  onReaction: (channelId: string, messageId: string, userId: string, emoji: string) => Promise<void>;
  onCommand: (channelId: string, userId: string, command: string, args: string) => Promise<string>;
}

export interface FeedbackSignal {
  type: 'positive' | 'negative' | 'acknowledge' | 'save';
  platform: string;
  conversationId: string;
  messageId: string;
  userId: string;
  userName: string;
  timestamp: string;
}
