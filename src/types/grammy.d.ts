// Minimal type declarations for grammy (optional runtime dependency)
declare module 'grammy' {
  export class Bot {
    constructor(token: string);
    on(event: string, handler: (...args: any[]) => any): void;
    start(): Promise<void>;
    stop(): void;
    api: {
      sendMessage: (chatId: string | number, text: string, opts?: any) => Promise<{ message_id: number }>;
      editMessageText: (chatId: string | number, messageId: number, text: string, opts?: any) => Promise<void>;
      sendDocument: (chatId: string | number, document: any, opts?: any) => Promise<void>;
    };
  }

  export class InputFile {
    constructor(data: Buffer | string, filename?: string);
  }
}
