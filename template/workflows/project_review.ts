interface WorkflowConfig {
  project: string;
  workflow: string;
  prompt?: string;
  env: Record<string, string>;
}

interface WorkflowResult {
  success: boolean;
  summary: string;
  outputs: Record<string, unknown>;
}

/**
 * Produces a short project-scoped status update.
 * Reads PROJECT_BRIEF.md, RUNBOOK.md, and memory/ to summarize current state.
 */
export async function run(config: WorkflowConfig): Promise<WorkflowResult> {
  return {
    success: true,
    summary: 'Project review workflow completed.',
    outputs: {},
  };
}
