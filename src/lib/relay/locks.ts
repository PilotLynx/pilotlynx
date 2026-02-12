import { lock, unlock, check } from 'proper-lockfile';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getProjectDir } from '../config.js';

function getLockTarget(project: string): string {
  const projectDir = getProjectDir(project);
  const lockTarget = `${projectDir}/.relay-run.lock`;
  if (!existsSync(lockTarget)) {
    mkdirSync(dirname(lockTarget), { recursive: true });
    writeFileSync(lockTarget, '', 'utf8');
  }
  return lockTarget;
}

/**
 * Acquire a run lock for a project. Returns a release function on success,
 * or null if the lock is already held (project is busy).
 */
export async function acquireRunLock(project: string): Promise<(() => Promise<void>) | null> {
  const target = getLockTarget(project);
  try {
    const isLocked = await check(target);
    if (isLocked) return null;

    const release = await lock(target, { stale: 300_000, retries: 0 });
    return async () => { await release(); };
  } catch {
    return null;
  }
}

/**
 * Check if a project currently has a run lock held.
 */
export async function isRunLocked(project: string): Promise<boolean> {
  const target = getLockTarget(project);
  if (!existsSync(target)) return false;
  try {
    return await check(target);
  } catch {
    return false;
  }
}
