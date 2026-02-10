import type { AgentConfig } from '../lib/types.js';
import { loadPrompt, loadSystemPrompt } from '../lib/prompts.js';
import type { MigrationPlan } from '../lib/secrets-migration.js';

export interface MigrationAgentOutput {
  approved: boolean;
  conflictResolutions: Record<string, {
    action: 'skip' | 'rename' | 'overwrite';
    newName?: string;
  }>;
}

interface SecretsMigrationInput {
  projectName: string;
  plan: MigrationPlan;
}

function formatKeyList(keys: { key: string; source: string }[]): string {
  if (keys.length === 0) return '(none)';
  return keys.map(k => `- ${k.key} (from ${k.source})`).join('\n');
}

export function getSecretsMigrationAgentConfig(input: SecretsMigrationInput): AgentConfig {
  const { projectName, plan } = input;

  const newKeys = plan.keys.filter(k => k.category === 'new');
  const deduped = plan.keys.filter(k => k.category === 'deduplicated');
  const conflicts = plan.keys.filter(k => k.category === 'conflicting');

  const mcpNote = plan.rewrittenMcpJson
    ? 'Literal values in .mcp.json will be replaced with ${VAR} references for migrated keys.'
    : '';

  return {
    prompt: loadPrompt('secrets-migration', 'secrets_migration_confirm', {
      projectName,
      totalMigratable: String(plan.keys.length),
      newKeysCount: String(newKeys.length),
      newKeysList: formatKeyList(newKeys),
      dedupedCount: String(deduped.length),
      dedupedList: formatKeyList(deduped),
      conflictsCount: String(conflicts.length),
      conflictsList: formatKeyList(conflicts),
      mcpNote,
    }),
    systemPrompt: loadSystemPrompt('secrets-migration', 'secrets_migration_confirm'),
    allowedTools: ['AskUserQuestion'],
    maxTurns: 8,
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          approved: {
            type: 'boolean',
            description: 'Whether the user approved the migration',
          },
          conflictResolutions: {
            type: 'object',
            description: 'Resolution for each conflicting key',
            additionalProperties: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['skip', 'rename', 'overwrite'],
                },
                newName: {
                  type: 'string',
                  description: 'New key name when action is rename',
                },
              },
              required: ['action'],
            },
          },
        },
        required: ['approved', 'conflictResolutions'],
      },
    },
  };
}
