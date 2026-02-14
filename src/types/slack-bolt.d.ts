// Type declarations for @slack/bolt (optional runtime dependency)
declare module '@slack/bolt' {
  export interface SlackEvent {
    type: string;
    channel: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    subtype?: string;
    files?: Array<{ url_private?: string; name?: string; mimetype?: string }>;
  }

  export interface SlackContext {
    botToken?: string;
    botId?: string;
    botUserId?: string;
    retryNum?: number;
    retryReason?: string;
  }

  export interface SlackCommand {
    channel_id: string;
    user_id: string;
    command: string;
    text: string;
    response_url: string;
    trigger_id: string;
  }

  export interface SlackMessage {
    type: string;
    channel: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    subtype?: string;
    files?: Array<{ url_private?: string; name?: string; mimetype?: string }>;
  }

  export class App {
    constructor(options: {
      token?: string;
      botToken?: string;
      appToken?: string;
      signingSecret?: string;
      socketMode?: boolean;
      port?: number;
      [key: string]: any;
    });
    event(name: string, handler: (args: { event: any; context: SlackContext; say?: (msg: string | Record<string, any>) => Promise<void> }) => Promise<void>): void;
    command(name: string, handler: (args: { command: SlackCommand; ack: () => Promise<void>; say?: (msg: string | Record<string, any>) => Promise<void> }) => Promise<any>): void;
    start(port?: number): Promise<void>;
    stop(): Promise<void>;
    client: {
      auth: {
        test: (opts?: Record<string, any>) => Promise<{ user_id?: string; bot_id?: string }>;
      };
      chat: {
        postMessage: (opts: {
          channel: string;
          text?: string;
          blocks?: any[];
          thread_ts?: string;
          [key: string]: any;
        }) => Promise<{ ok: boolean; ts?: string; channel?: string }>;
        update: (opts: {
          channel: string;
          ts: string;
          text?: string;
          blocks?: any[];
          [key: string]: any;
        }) => Promise<{ ok: boolean; ts?: string }>;
      };
      conversations: {
        replies: (opts: {
          channel: string;
          ts: string;
          oldest?: string;
          limit?: number;
          [key: string]: any;
        }) => Promise<{ ok: boolean; messages?: SlackMessage[] }>;
      };
      files: {
        uploadV2: (opts: {
          channel_id: string;
          content?: string;
          file?: Buffer;
          filename?: string;
          thread_ts?: string;
          [key: string]: any;
        }) => Promise<{ ok: boolean }>;
      };
      users: {
        info: (opts: {
          user: string;
          [key: string]: any;
        }) => Promise<{
          ok: boolean;
          user?: {
            name?: string;
            real_name?: string;
            profile?: { display_name?: string; image_48?: string };
          };
        }>;
      };
    };
  }
}
