// Minimal type declarations for @slack/bolt (optional runtime dependency)
declare module '@slack/bolt' {
  export class App {
    constructor(options: Record<string, any>);
    event(name: string, handler: (...args: any[]) => any): void;
    command(name: string, handler: (...args: any[]) => any): void;
    start(port?: number): Promise<void>;
    stop(): Promise<void>;
    client: {
      auth: { test: (opts?: any) => Promise<{ user_id?: string }> };
      chat: {
        postMessage: (opts: any) => Promise<{ ts?: string }>;
        update: (opts: any) => Promise<void>;
      };
      conversations: {
        replies: (opts: any) => Promise<{ messages?: any[] }>;
      };
      files: {
        uploadV2: (opts: any) => Promise<void>;
      };
      users: {
        info: (opts: any) => Promise<{ user?: { real_name?: string; profile?: { display_name?: string } } }>;
      };
    };
  }
}
