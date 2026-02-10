import { projectExists, verifyProject } from '../project.js';
import type { VerificationResult } from '../types.js';

export interface VerifyResult {
  success: boolean;
  error?: string;
  verification?: VerificationResult;
}

export function executeVerify(project: string): VerifyResult {
  if (!projectExists(project)) {
    return { success: false, error: `Project "${project}" does not exist.` };
  }

  const verification = verifyProject(project);
  return {
    success: verification.valid,
    verification,
  };
}
