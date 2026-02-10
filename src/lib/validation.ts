const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const WORKFLOW_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const RESERVED_NAMES = new Set(['pilotlynx', '.', '..', '']);

export function validateProjectName(name: string): void {
  if (RESERVED_NAMES.has(name)) {
    throw new Error(`"${name}" is reserved and cannot be used as a project name`);
  }
  if (!PROJECT_NAME_RE.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Names must start with alphanumeric, ` +
      `contain only letters, digits, dots, hyphens, underscores, and be 1-128 chars.`
    );
  }
}

export function validateWorkflowName(name: string): void {
  if (!WORKFLOW_NAME_RE.test(name)) {
    throw new Error(
      `Invalid workflow name "${name}". Names must start with alphanumeric ` +
      `and contain only letters, digits, dots, hyphens, underscores.`
    );
  }
  if (name.length > 128) {
    throw new Error(`Workflow name too long (max 128 characters)`);
  }
}

/** Sanitize a name for use in filenames by removing any path separators */
export function sanitizeForFilename(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
}
