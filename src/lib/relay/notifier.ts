// ── Relay Notifier ──
// Sends proactive notifications to bound channels for scheduled runs,
// improve insights, budget alerts, and health score changes.

import type Database from 'better-sqlite3';
import type { ChatPlatform } from './platform.js';
import type { RunRecord } from '../types.js';
import type { RelayConfig } from './types.js';
import { getChannelForProject } from './bindings.js';

export class RelayNotifier {
  constructor(
    private platforms: Map<string, ChatPlatform>,
    private db: Database.Database,
    private config: RelayConfig,
  ) {}

  /**
   * Notify bound channels about a scheduled workflow run result.
   */
  async notifyScheduleResult(project: string, record: RunRecord): Promise<void> {
    if (!this.config.notifications.scheduleFailures && !record.success) return;

    const start = new Date(record.startedAt).getTime();
    const end = new Date(record.completedAt).getTime();
    const dur = Math.round((end - start) / 1000);
    const status = record.success ? 'Success' : 'Failed';

    let message = `Scheduled run \`${record.workflow}\` for *${project}*: ${status}\nCost: $${record.costUsd.toFixed(4)} | Duration: ${dur}s`;
    if (!record.success && record.error) {
      message += `\n${record.error}`;
    }

    await this.broadcast(project, message);
  }

  /**
   * Notify bound channels about insights from the improve loop.
   */
  async notifyImproveInsights(project: string, insights: string[]): Promise<void> {
    if (!this.config.notifications.improveInsights) return;
    if (insights.length === 0) return;

    const bullets = insights.map((i) => `  - ${i}`).join('\n');
    const message = `Improve loop found insights for *${project}*:\n${bullets}`;

    await this.broadcast(project, message);
  }

  /**
   * Notify bound channels about budget threshold being approached.
   */
  async notifyBudgetAlert(project: string, spent: number, limit: number): Promise<void> {
    if (!this.config.notifications.budgetAlerts) return;

    const pct = Math.round((spent / limit) * 100);
    const message = `Budget alert for *${project}*: $${spent.toFixed(2)} of $${limit.toFixed(2)} daily budget used (${pct}%)`;

    await this.broadcast(project, message);
  }

  /**
   * Notify bound channels when a project's health score drops.
   */
  async notifyHealthDrop(project: string, oldScore: number, newScore: number): Promise<void> {
    if (newScore >= this.config.notifications.healthScoreThreshold) return;

    const message = `Health score dropped for *${project}*: ${oldScore} -> ${newScore}`;

    await this.broadcast(project, message);
  }

  /**
   * Send a message to all platforms that have a channel bound to the project.
   */
  private async broadcast(project: string, message: string): Promise<void> {
    for (const [platformName, platform] of this.platforms) {
      const channelId = getChannelForProject(this.db, platformName, project);
      if (!channelId) continue;

      try {
        await platform.sendMessage(channelId, message);
      } catch (err) {
        console.error(
          `[relay-notifier] Failed to send to ${platformName}/${channelId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
