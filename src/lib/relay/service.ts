// ── Relay Service Orchestrator ──
// Starts/stops the relay service, wires together all components.

import { writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import type { ChatPlatform } from './platform.js';
import type { RelayConfig } from './types.js';
import { loadRelayConfig, getRelayDbPath } from './config.js';
import { getConfigRoot } from '../config.js';
import { loadRootEnv } from '../env-loader.js';
import { initDb, cleanupStaleData, getPendingMessages, getRunStats } from './db.js';
import { AgentPool } from './queue.js';
import { RelayRouter } from './router.js';
import { RelayNotifier } from './notifier.js';

const PID_FILE = () => join(getConfigRoot(), 'relay.pid');
const ENV_FILE = () => join(getConfigRoot(), '.env');

export interface RelayServiceStatus {
  running: boolean;
  uptime: number;
  platforms: string[];
  activeRuns: number;
  totalRunsProcessed: number;
}

export class RelayService {
  private db: Database.Database | null = null;
  private platforms = new Map<string, ChatPlatform>();
  private pool: AgentPool | null = null;
  private router: RelayRouter | null = null;
  private notifier: RelayNotifier | null = null;
  private healthServer: Server | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private startedAt: Date | null = null;
  private _running = false;

  constructor(private config: RelayConfig) {}

  get running(): boolean {
    return this._running;
  }

  async start(): Promise<void> {
    if (this._running) throw new Error('Relay service is already running.');

    // Check for sandbox if required
    if (this.config.agent.requireKernelSandbox) {
      const { assertSandboxAvailable } = await import('../sandbox.js');
      assertSandboxAvailable();
    }

    // Check PID file — refuse to start if another instance is running
    const pidFile = PID_FILE();
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (isProcessRunning(pid)) {
        throw new Error(`Another relay instance is running (PID ${pid}). Stop it first with \`pilotlynx relay stop\`.`);
      }
      // Stale PID file — clean it up
      unlinkSync(pidFile);
    }

    // Write PID file immediately to prevent TOCTOU race
    writeFileSync(pidFile, String(process.pid), 'utf8');

    try {
    // Initialize SQLite
    const dbPath = getRelayDbPath();
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    this.db = initDb(dbPath);

    // Initialize agent pool
    this.pool = new AgentPool(
      this.config.agent.maxConcurrent,
      this.config.limits.projectQueueDepth,
      this.config.agent.maxMemoryMB,
    );

    // Initialize router
    this.router = new RelayRouter(this.db, this.pool, this.config);

    // Load env for platform tokens
    const env = loadRootEnv(ENV_FILE());

    // Initialize platforms
    if (this.config.platforms.slack.enabled) {
      const slackPlatform = await this.initSlack(env);
      if (slackPlatform) {
        this.platforms.set('slack', slackPlatform);
      }
    }

    if (this.config.platforms.telegram.enabled) {
      const telegramPlatform = await this.initTelegram(env);
      if (telegramPlatform) {
        this.platforms.set('telegram', telegramPlatform);
      }
    }

    if (this.platforms.size === 0) {
      throw new Error('No platforms enabled or configured. Enable at least one platform in relay.yaml.');
    }

    // Initialize notifier
    this.notifier = new RelayNotifier(this.platforms, this.db, this.config);

    // Wire platform handlers to router
    for (const platform of this.platforms.values()) {
      platform.onMessage = (msg) => this.router!.routeMessage(platform, msg);
      platform.onReaction = (channelId, messageId, userId, emoji) =>
        this.router!.routeReaction(platform, channelId, messageId, userId, emoji);
      platform.onCommand = (channelId, userId, command, args) =>
        this.router!.routeCommand(platform, channelId, userId, command, args);
    }

    // Start all platforms
    for (const [name, platform] of this.platforms) {
      try {
        await platform.start();
        console.log(`[relay] ${name} platform started.`);
      } catch (err) {
        console.error(`[relay] Failed to start ${name}:`, err);
        throw err;
      }
    }

    // Recover pending messages from previous crash
    await this.recoverPendingMessages();

    // Start periodic cleanup with budget alerts (every hour)
    this.cleanupTimer = setInterval(() => {
      if (this.db) {
        cleanupStaleData(this.db, 24, 7, 30);

        // Check budget alerts for bound projects
        if (this.notifier && this.config.notifications.budgetAlerts) {
          const projects = this.db.prepare('SELECT DISTINCT project FROM bindings').all() as { project: string }[];
          for (const { project } of projects) {
            const stats = getRunStats(this.db!, project, 1);
            const limit = this.config.limits.dailyBudgetPerProject;
            if (limit > 0 && stats.totalCost >= limit * 0.8) {
              this.notifier!.notifyBudgetAlert(project, stats.totalCost, limit).catch((err) => {
                console.error(`[relay] Failed to send budget alert for ${project}:`, err);
              });
            }
          }
        }
      }
    }, 3_600_000);
    this.cleanupTimer.unref();

    // Initial cleanup
    cleanupStaleData(this.db, 24, 7, 30);

    // Start health endpoint
    this.healthServer = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: this.getUptime() }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.healthServer.listen(9100, '127.0.0.1');
    this.healthServer.unref();

    this.startedAt = new Date();
    this._running = true;

    console.log(`[relay] Service started. Platforms: ${[...this.platforms.keys()].join(', ')}`);
    } catch (err) {
      // Clean up PID file on startup failure
      try { unlinkSync(pidFile); } catch { /* ignore */ }
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this._running) return;

    console.log('[relay] Stopping service...');
    this._running = false;

    // Stop accepting new work
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop health server
    if (this.healthServer) {
      this.healthServer.close();
      this.healthServer = null;
    }

    // Drain the pool (wait up to 5 min for in-flight runs)
    if (this.pool) {
      try {
        await Promise.race([
          this.pool.shutdown(),
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              console.warn('[relay] Drain timeout reached, force-stopping.');
              resolve();
            }, 300_000);
            timer.unref();
          }),
        ]);
      } catch (err) {
        console.error('[relay] Error during pool shutdown:', err);
      }
    }

    // Stop platforms
    for (const [name, platform] of this.platforms) {
      try {
        await platform.stop();
        console.log(`[relay] ${name} platform stopped.`);
      } catch (err) {
        console.error(`[relay] Error stopping ${name}:`, err);
      }
    }
    this.platforms.clear();

    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Remove PID file
    const pidFile = PID_FILE();
    if (existsSync(pidFile)) {
      try {
        unlinkSync(pidFile);
      } catch (err) {
        console.warn('[relay] Failed to remove PID file:', err);
      }
    }

    console.log('[relay] Service stopped.');
  }

  getStatus(): RelayServiceStatus {
    return {
      running: this._running,
      uptime: this.getUptime(),
      platforms: [...this.platforms.keys()],
      activeRuns: this.pool?.getActiveCount() ?? 0,
      totalRunsProcessed: this.db ? getRunStats(this.db).totalRuns : 0,
    };
  }

  getNotifier(): RelayNotifier | null {
    return this.notifier;
  }

  // ── Private ──

  private getUptime(): number {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt.getTime();
  }

  private async initSlack(env: Record<string, string>): Promise<ChatPlatform | null> {
    const botToken = env.SLACK_BOT_TOKEN;
    const appToken = env.SLACK_APP_TOKEN;
    const signingSecret = env.SLACK_SIGNING_SECRET;

    if (!botToken || !appToken) {
      console.error('[relay] Slack enabled but SLACK_BOT_TOKEN or SLACK_APP_TOKEN missing in .env');
      return null;
    }

    try {
      const { SlackAdapter } = await import('./platforms/slack.js');
      return new SlackAdapter({
        botToken,
        appToken,
        signingSecret: signingSecret ?? '',
        mode: this.config.platforms.slack.mode,
        port: this.config.platforms.slack.port,
        mainChannel: this.config.platforms.slack.mainChannel,
      });
    } catch (err) {
      console.error('[relay] Failed to load Slack adapter. Is @slack/bolt installed?', err);
      return null;
    }
  }

  private async initTelegram(env: Record<string, string>): Promise<ChatPlatform | null> {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('[relay] Telegram enabled but TELEGRAM_BOT_TOKEN missing in .env');
      return null;
    }

    try {
      const { TelegramAdapter } = await import('./platforms/telegram.js');
      return new TelegramAdapter({
        botToken,
        streamMode: this.config.platforms.telegram.streamMode,
        editIntervalMs: this.config.platforms.telegram.editIntervalMs,
      });
    } catch (err) {
      console.error('[relay] Failed to load Telegram adapter. Is grammy installed?', err);
      return null;
    }
  }

  private async recoverPendingMessages(): Promise<void> {
    if (!this.db) return;

    const pending = getPendingMessages(this.db, 10); // 10 min TTL
    if (pending.length === 0) return;

    console.log(`[relay] Recovering ${pending.length} pending message(s) from previous session.`);

    for (const msg of pending) {
      const platform = this.platforms.get(msg.platform);
      if (!platform) continue;

      try {
        await platform.sendMessage(
          msg.channelId,
          `_Recovered from previous session. Your message "${msg.text.slice(0, 50)}..." is being re-processed._`,
          msg.conversationId,
        );
      } catch (err) {
        console.warn(`[relay] Failed to send recovery notification for pending message:`, err);
      }
    }
  }
}

// ── Service Management ──

export async function startRelayService(): Promise<RelayService> {
  const config = loadRelayConfig();
  if (!config) {
    throw new Error('No relay.yaml found. Create one in your pilotlynx/ config directory.');
  }

  const service = new RelayService(config);
  await service.start();

  // Handle graceful shutdown
  const shutdown = async () => {
    try {
      await service.stop();
    } catch (err) {
      console.error('[relay] Error during shutdown:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return service;
}

export function stopRelayByPid(): boolean {
  const pidFile = PID_FILE();
  if (!existsSync(pidFile)) return false;

  const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (!isProcessRunning(pid)) {
    unlinkSync(pidFile);
    return false;
  }

  process.kill(pid, 'SIGTERM');
  return true;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
