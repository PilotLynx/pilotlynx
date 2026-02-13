import { listProjects } from '../project.js';
import { getRecentLogs } from '../observation.js';
import { executeRun } from '../command-ops/run-ops.js';
import { acquireRunLock } from './locks.js';
import { loadRelayConfig } from './config.js';
import { appendConversation, getRecentConversation } from './history.js';
import { runRelayChatAgent } from './chat.js';
import type { ChannelAdapter, InboundMessage } from './channel.js';
import type { ChatConfig, RelayConfig } from './types.js';

function getChatConfig(config: RelayConfig, chatId: string): ChatConfig | null {
  return config.routing.chats[chatId] ?? null;
}

function isUserAllowed(config: RelayConfig, userId: string): boolean {
  if (config.routing.allowedUsers.length === 0) return true;
  return config.routing.allowedUsers.includes(userId);
}

function formatLogsSummary(project: string): string {
  const logs = getRecentLogs(project, 7);
  if (logs.length === 0) return `No recent logs for "${project}".`;

  const lines = logs.slice(-10).map(r => {
    const icon = r.success ? '\u2705' : '\u274c';
    const time = new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ');
    return `${icon} ${time} ${r.workflow} ($${r.costUsd.toFixed(4)})`;
  });
  return `Recent runs for *${project}* (last 7 days):\n${lines.join('\n')}`;
}

const HELP_TEXT = `*PilotLynx Relay*

Commands:
/run <project> <workflow> — Execute a workflow
/status [project] — Show recent run logs
/projects — List registered projects
/help — Show this message

Or just type normally to chat with the project agent.`;

export function createRouter(adapter: ChannelAdapter) {
  return async (msg: InboundMessage): Promise<void> => {
    const config = loadRelayConfig();
    if (!config || !config.enabled) return;

    // User allowlist check
    if (!isUserAllowed(config, msg.userId)) {
      await adapter.send(msg.chatId, 'Unauthorized. Your user ID is not in the allowedUsers list.');
      return;
    }

    const chatConfig = getChatConfig(config, msg.chatId);

    // Unmapped chat: send setup instructions
    if (!chatConfig) {
      const rawId = msg.chatId.startsWith('telegram:') ? msg.chatId.slice('telegram:'.length) : msg.chatId;
      await adapter.send(
        msg.chatId,
        `Your chat ID is \`${rawId}\`.\n\n` +
        `Run this to connect:\n` +
        `\`pilotlynx relay add-chat ${rawId} --project <name>\``,
      );
      return;
    }

    const text = msg.text.trim();

    // Command routing
    if (text.startsWith('/')) {
      await handleCommand(msg, text, chatConfig, config, adapter);
    } else if (chatConfig.allowChat) {
      await handleChat(msg, text, chatConfig, adapter);
    } else {
      await adapter.send(msg.chatId, 'Chat is disabled for this channel. Use /help for commands.');
    }
  };
}

async function handleCommand(
  msg: InboundMessage,
  text: string,
  chatConfig: ChatConfig,
  config: RelayConfig,
  adapter: ChannelAdapter,
): Promise<void> {
  try {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/help') {
      await adapter.send(msg.chatId, HELP_TEXT);
      return;
    }

    if (cmd === '/projects') {
      const projects = listProjects();
      if (projects.length === 0) {
        await adapter.send(msg.chatId, 'No projects registered.');
      } else {
        await adapter.send(msg.chatId, `*Registered projects:*\n${projects.map(p => `• ${p}`).join('\n')}`);
      }
      return;
    }

    if (cmd === '/status') {
      const project = parts[1] ?? chatConfig.project ?? config.routing.defaultProject;
      if (!project) {
        await adapter.send(msg.chatId, 'Usage: /status <project>\nNo default project configured.');
        return;
      }
      await adapter.send(msg.chatId, formatLogsSummary(project));
      return;
    }

    if (cmd === '/run') {
      if (!chatConfig.allowRun) {
        await adapter.send(msg.chatId, 'Run commands are disabled for this chat.');
        return;
      }
      let resolvedProject: string | undefined;
      let resolvedWorkflow: string | undefined;

      if (parts.length === 3) {
        resolvedProject = parts[1];
        resolvedWorkflow = parts[2];
      } else if (parts.length === 2 && chatConfig.project) {
        resolvedProject = chatConfig.project;
        resolvedWorkflow = parts[1];
      } else {
        await adapter.send(msg.chatId, 'Usage: /run <project> <workflow>');
        return;
      }

      // Acquire run lock
      const release = await acquireRunLock(resolvedProject!);
      if (!release) {
        await adapter.send(msg.chatId, `\u23f3 Project "${resolvedProject}" is busy. Try again shortly.`);
        return;
      }

      let typingInterval: ReturnType<typeof setInterval>;
      try {
        await adapter.sendTyping(msg.chatId);
        typingInterval = setInterval(() => {
          adapter.sendTyping(msg.chatId).catch(() => {});
        }, 4000);

        const result = await executeRun(resolvedProject!, resolvedWorkflow!);

        if (result.success) {
          const duration = result.durationMs ? `${Math.round(result.durationMs / 1000)}s` : '?';
          await adapter.send(
            msg.chatId,
            `\u2705 *${resolvedProject}/${resolvedWorkflow}* completed\n` +
            `Duration: ${duration} | Cost: $${result.costUsd?.toFixed(4) ?? '?'}\n` +
            `${result.record?.summary?.slice(0, 500) ?? ''}`,
          );
        } else {
          await adapter.send(
            msg.chatId,
            `\u274c *${resolvedProject}/${resolvedWorkflow}* failed\n${result.error?.slice(0, 500) ?? 'Unknown error'}`,
          );
        }
      } finally {
        clearInterval(typingInterval!);
        await release();
      }
      return;
    }

    await adapter.send(msg.chatId, `Unknown command: ${cmd}\nUse /help for available commands.`);
  } catch (err) {
    await adapter.send(msg.chatId, `Command error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleChat(
  msg: InboundMessage,
  text: string,
  chatConfig: ChatConfig,
  adapter: ChannelAdapter,
): Promise<void> {
  const project = chatConfig.project;
  if (!project) {
    await adapter.send(msg.chatId, 'No project assigned to this chat. Use /help for commands.');
    return;
  }

  // Log user message
  await appendConversation(msg.chatId, {
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  });

  // Acquire lock for read-only agent too (prevents concurrent agent sessions)
  const release = await acquireRunLock(project);
  if (!release) {
    await adapter.send(msg.chatId, '\u23f3 Project is busy processing another request. Try again shortly.');
    return;
  }

  let typingInterval: ReturnType<typeof setInterval>;
  try {
    await adapter.sendTyping(msg.chatId);
    typingInterval = setInterval(() => {
      adapter.sendTyping(msg.chatId).catch(() => {});
    }, 4000);

    const history = getRecentConversation(msg.chatId);
    const reply = await runRelayChatAgent(project, text, history);

    // Log assistant reply
    await appendConversation(msg.chatId, {
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
    });

    await adapter.send(msg.chatId, reply);
  } catch (err) {
    await adapter.send(msg.chatId, `Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearInterval(typingInterval!);
    await release();
  }
}
