import { projectExists } from '../project.js';
import { getSyncTemplateAgentConfig } from '../../agents/sync-template.agent.js';
import { runAgent } from '../agent-runner.js';

export interface SyncResult {
  success: boolean;
  error?: string;
}

export async function executeSyncTemplate(project: string): Promise<SyncResult> {
  if (!projectExists(project)) {
    return { success: false, error: `Project "${project}" does not exist.` };
  }

  const config = getSyncTemplateAgentConfig(project);
  const result = await runAgent(config);

  if (!result.success) {
    return { success: false, error: result.result };
  }

  return { success: true };
}
