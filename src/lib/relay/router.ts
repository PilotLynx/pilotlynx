// ── Relay Router ──
// Central dispatch: routes platform messages to the right handler.
// Wires together: bindings, context, queue, executor, poster, admin, feedback.

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ChatPlatform, ChatMessage, FeedbackSignal } from './platform.js';
import type { RelayConfig, RelayRunRequest } from './types.js';
import { lookupBinding } from './bindings.js';
import { cacheMessage, writePendingMessage, markPendingDone, recordRelayRun, updateRelayRun } from './db.js';
import { assembleContext } from './context.js';
import { executeRelayRun } from './executor.js';
import { formatResponse, addCostFooter } from './poster.js';
import { AgentPool } from './queue.js';
import { parseCommand, handleAdminCommand } from './admin.js';
import { classifyReaction, handleFeedback, appendRelayFeedback, saveFeedbackToMemory, isReactionRateLimited } from './feedback.js';
import { sendWebhookNotification } from './notify.js';

// ── Rate Limiting ──

const userMessageTimestamps = new Map<string, number[]>();

function isUserRateLimited(userId: string, maxPerHour: number): boolean {
  const now = Date.now();
  const cutoff = now - 3_600_000;

  let timestamps = userMessageTimestamps.get(userId);
  if (!timestamps) {
    timestamps = [];
    userMessageTimestamps.set(userId, timestamps);
  }

  const recent = timestamps.filter((t) => t > cutoff);
  userMessageTimestamps.set(userId, recent);

  if (recent.length >= maxPerHour) return true;

  recent.push(now);
  return false;
}

// ── Router ──

export class RelayRouter {
  private activeAbortControllers = new Map<string, AbortController>(); // conversationId → controller
  private startedAt = new Date();

  constructor(
    private db: Database.Database,
    private pool: AgentPool,
    private config: RelayConfig,
  ) {}

  /**
   * Main message handler — called by platform adapters on incoming messages.
   */
  async routeMessage(platform: ChatPlatform, msg: ChatMessage): Promise<void> {
    // Ignore bot messages
    if (msg.isBot) return;

    // Cache the incoming message
    cacheMessage(this.db, msg);

    // Check for admin commands first
    const parsed = parseCommand(msg.text);
    if (parsed) {
      const response = await handleAdminCommand(
        {
          db: this.db,
          platform: platform.name,
          channelId: msg.channelId,
          userId: msg.userId,
          config: this.config,
          getQueueDepth: (p) => this.pool.getQueueDepth(p),
          getActiveCount: () => this.pool.getActiveCount(),
          startedAt: this.startedAt,
        },
        parsed.command,
        parsed.args,
      );

      // Handle special commands
      if (parsed.command === 'cancel') {
        const controller = this.activeAbortControllers.get(msg.conversationId);
        if (controller) {
          controller.abort();
          this.activeAbortControllers.delete(msg.conversationId);
        }
      }

      await platform.sendMessage(msg.channelId, response, msg.conversationId);
      return;
    }

    // Look up channel binding
    const project = lookupBinding(this.db, platform.name, msg.channelId);
    if (!project) {
      await platform.sendMessage(
        msg.channelId,
        'This channel is not bound to a project. An admin can use `bind <project>` to set one up.',
        msg.conversationId,
      );
      return;
    }

    // Rate limit
    if (isUserRateLimited(msg.userId, this.config.limits.userRatePerHour)) {
      await platform.sendMessage(
        msg.channelId,
        'You\'re sending messages too quickly. Please slow down.',
        msg.conversationId,
      );
      return;
    }

    // Write pending message for crash recovery
    const pendingId = randomUUID();
    writePendingMessage(this.db, {
      id: pendingId,
      platform: platform.name,
      channelId: msg.channelId,
      conversationId: msg.conversationId,
      userId: msg.userId,
      userName: msg.userName,
      text: msg.text,
      receivedAt: new Date().toISOString(),
      status: 'pending',
    });

    // Enqueue the agent run
    try {
      const { result: runPromise, position } = await this.pool.enqueue(project, async () => {
        return this.executeAndPost(platform, msg, project, pendingId);
      });

      // If queued (not immediate), notify the user
      if (position > 0) {
        await platform.sendMessage(
          msg.channelId,
          `Your request is queued (position ${position}). I'll respond shortly.`,
          msg.conversationId,
        );
      }

      // Don't await the run promise — it executes in the background via the queue
      runPromise.catch((err) => {
        console.error(`[relay] Run failed for ${project}:`, err);
      });
    } catch (err) {
      // Queue full or memory pressure
      markPendingDone(this.db, pendingId);
      const errMsg = err instanceof Error ? err.message : String(err);
      await platform.sendMessage(
        msg.channelId,
        `Cannot process request: ${errMsg}`,
        msg.conversationId,
      );
    }
  }

  /**
   * Reaction handler — called by platform adapters on reactions.
   */
  async routeReaction(
    platform: ChatPlatform,
    channelId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    // Rate limit reactions
    if (isReactionRateLimited(userId, this.config.limits.reactionRatePerHour)) return;

    // Check for cancellation reaction (stop_sign on a "Working on it..." message)
    if (emoji === 'stop_sign' || emoji === 'octagonal_sign') {
      // Find conversation for this message and abort
      for (const [convId, controller] of this.activeAbortControllers) {
        controller.abort();
        this.activeAbortControllers.delete(convId);
        await platform.sendMessage(channelId, 'Run cancelled.', convId);
        break;
      }
      return;
    }

    const feedbackType = classifyReaction(emoji);
    if (!feedbackType) return;

    const project = lookupBinding(this.db, platform.name, channelId);
    if (!project) return;

    const signal: FeedbackSignal = {
      type: feedbackType,
      platform: platform.name,
      conversationId: messageId, // approximate — reactions target a message
      messageId,
      userId,
      userName: userId, // resolved by platform adapter if available
      timestamp: new Date().toISOString(),
    };

    // Try to get agent output summary from the most recent run for this project
    const lastRun = this.db.prepare(
      `SELECT id, status FROM relay_runs
       WHERE project = ? AND platform = ? AND channel_id = ?
       ORDER BY started_at DESC LIMIT 1`,
    ).get(project, platform.name, channelId) as { id: string; status: string } | undefined;
    const outputSummary = lastRun?.status === 'completed' ? `(run ${lastRun.id})` : undefined;

    const entry = handleFeedback(signal, project, outputSummary);
    appendRelayFeedback(entry);

    // Save starred/saved responses to project memory/ dir
    if (feedbackType === 'save') {
      saveFeedbackToMemory(project, entry, outputSummary);
    }

    if (feedbackType === 'negative') {
      await platform.sendMessage(
        channelId,
        'Got it — what went wrong? Reply in this thread and I\'ll note the feedback.',
        messageId,
      );
    }
  }

  /**
   * Slash command handler — called by platform adapters.
   */
  async routeCommand(
    platform: ChatPlatform,
    channelId: string,
    userId: string,
    command: string,
    args: string,
  ): Promise<string> {
    return handleAdminCommand(
      {
        db: this.db,
        platform: platform.name,
        channelId,
        userId,
        config: this.config,
        getQueueDepth: (p) => this.pool.getQueueDepth(p),
        getActiveCount: () => this.pool.getActiveCount(),
        startedAt: this.startedAt,
      },
      command,
      args,
    );
  }

  // ── Internal ──

  private async executeAndPost(
    platform: ChatPlatform,
    msg: ChatMessage,
    project: string,
    pendingId: string,
  ): Promise<void> {
    const runId = randomUUID();
    const abortController = new AbortController();
    this.activeAbortControllers.set(msg.conversationId, abortController);

    // Record the run start
    recordRelayRun(this.db, {
      id: runId,
      platform: platform.name,
      channelId: msg.channelId,
      conversationId: msg.conversationId,
      project,
      userId: msg.userId,
      startedAt: new Date().toISOString(),
      status: 'running',
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });

    // Start streaming indicator
    const stream = await platform.startStream(msg.channelId, msg.conversationId);

    try {
      // Assemble context
      const { prompt, isStale } = await assembleContext(
        this.db,
        platform,
        msg.channelId,
        msg.conversationId,
        msg.text,
        msg.userName,
        project,
        this.config.context,
      );

      if (isStale) {
        await platform.sendMessage(
          msg.channelId,
          `_Thread inactive for ${this.config.context.staleThreadDays}+ days. Starting fresh context._`,
          msg.conversationId,
        );
      }

      // Execute agent run
      const request: RelayRunRequest = {
        platform: platform.name,
        channelId: msg.channelId,
        conversationId: msg.conversationId,
        userId: msg.userId,
        userName: msg.userName,
        project,
        prompt,
        abortSignal: abortController.signal,
        onText: (text) => {
          stream.append(text).catch(() => {});
        },
      };

      const result = await executeRelayRun(request);

      // Stop streaming and post final response
      await stream.stop();

      // Format and split response
      const maxLen = platform.capabilities.maxMessageLength;
      const parts = formatResponse(result.text, maxLen);
      for (const part of parts) {
        await platform.sendMessage(msg.channelId, part, msg.conversationId);
      }

      // Git diff summary
      if (result.gitDiffStat) {
        await platform.sendMessage(
          msg.channelId,
          `\`\`\`\n${result.gitDiffStat}\n\`\`\``,
          msg.conversationId,
        );
      }

      // Cost footer
      const footer = addCostFooter(result);
      await platform.sendMessage(msg.channelId, footer, msg.conversationId);

      // Update run record
      const completedAt = new Date().toISOString();
      updateRelayRun(this.db, runId, {
        completedAt,
        status: result.success ? 'completed' : 'failed',
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
        model: result.model,
      });

      // Emit relay webhook event
      sendWebhookNotification({
        event: result.success ? 'relay_run_complete' : 'relay_run_failed',
        timestamp: completedAt,
        project,
        workflow: 'relay',
        success: result.success,
        summary: result.text.slice(0, 200),
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        model: result.model,
        platform: platform.name,
        channelId: msg.channelId,
      }).catch(() => {});
    } catch (err) {
      await stream.stop();
      const errMsg = err instanceof Error ? err.message : String(err);
      await platform.sendMessage(
        msg.channelId,
        `Error: ${errMsg}`,
        msg.conversationId,
      );

      updateRelayRun(this.db, runId, {
        completedAt: new Date().toISOString(),
        status: 'failed',
      });
    } finally {
      this.activeAbortControllers.delete(msg.conversationId);
      markPendingDone(this.db, pendingId);
    }
  }
}
