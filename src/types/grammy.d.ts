// Type declarations for grammy (optional runtime dependency)
declare module 'grammy' {
  export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  }

  export interface TelegramChat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
  }

  export interface TelegramMessage {
    message_id: number;
    from: TelegramUser;
    chat: TelegramChat;
    date: number;
    text?: string;
    reply_to_message?: TelegramMessage;
    entities?: Array<{ type: string; offset: number; length: number }>;
  }

  export interface TelegramCallbackQuery {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
    chat_instance: string;
  }

  export interface TelegramContext {
    message?: TelegramMessage;
    callbackQuery?: TelegramCallbackQuery;
    reply: (text: string, opts?: Record<string, any>) => Promise<TelegramMessage>;
    answerCallbackQuery: (opts?: Record<string, any>) => Promise<boolean>;
  }

  export class Bot {
    constructor(token: string);
    on(event: 'message:text', handler: (ctx: TelegramContext) => Promise<void>): void;
    on(event: 'callback_query:data', handler: (ctx: TelegramContext) => Promise<void>): void;
    on(event: string, handler: (ctx: TelegramContext) => Promise<void>): void;
    start(): Promise<void>;
    stop(): void;
    api: {
      sendMessage: (chatId: string | number, text: string, opts?: Record<string, any>) => Promise<TelegramMessage>;
      editMessageText: (chatId: string | number, messageId: number, text: string, opts?: Record<string, any>) => Promise<TelegramMessage | boolean>;
      sendDocument: (chatId: string | number, document: InputFile | string, opts?: Record<string, any>) => Promise<TelegramMessage>;
    };
  }

  export class InputFile {
    constructor(data: Buffer | string, filename?: string);
  }
}
