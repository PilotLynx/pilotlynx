import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { shellEscape } from './shell-escape.js';

export type SandboxLevel = 'kernel' | 'regex-only';

export interface SandboxInfo {
  level: SandboxLevel;
  mechanism?: 'bwrap' | 'sandbox-exec';
}

let _cached: SandboxInfo | null = null;

/**
 * Detect available sandbox mechanism.
 * On Linux, checks for bwrap (bubblewrap).
 * On macOS, checks for sandbox-exec (seatbelt).
 * On other platforms, falls back to regex-only.
 */
export function detectSandbox(): SandboxInfo {
  if (_cached) return _cached;

  const os = platform();

  if (os === 'linux') {
    try {
      execFileSync('bwrap', ['--version'], { stdio: 'pipe' });
      _cached = { level: 'kernel', mechanism: 'bwrap' };
      return _cached;
    } catch {
      _cached = { level: 'regex-only' };
      return _cached;
    }
  }

  if (os === 'darwin') {
    try {
      execFileSync('sandbox-exec', ['-n', 'no-internet', 'true'], { stdio: 'pipe' });
      _cached = { level: 'kernel', mechanism: 'sandbox-exec' };
      return _cached;
    } catch {
      _cached = { level: 'regex-only' };
      return _cached;
    }
  }

  _cached = { level: 'regex-only' };
  return _cached;
}

export function resetSandboxCache(): void {
  _cached = null;
}

/**
 * Wrap a shell command in a bwrap sandbox if kernel-level sandboxing is
 * available. The sandbox makes the entire filesystem read-only, then
 * overlays a writable bind mount for the project directory.
 *
 * On macOS with sandbox-exec, uses a seatbelt profile for filesystem
 * restrictions.
 *
 * When no kernel sandbox is available, returns the command unchanged.
 */
export function wrapInSandbox(
  command: string,
  projectDir: string,
  readOnlyDirs: string[] = [],
): string {
  const info = detectSandbox();
  if (info.level !== 'kernel') return command;

  const esc = shellEscape;

  if (info.mechanism === 'bwrap') {
    const parts: string[] = [
      'bwrap',
      '--ro-bind / /',
      '--dev /dev',
      '--proc /proc',
      '--tmpfs /tmp',
      `--bind ${esc(projectDir)} ${esc(projectDir)}`,
    ];

    for (const dir of readOnlyDirs) {
      parts.push(`--ro-bind ${esc(dir)} ${esc(dir)}`);
    }

    parts.push(
      `--chdir ${esc(projectDir)}`,
      '--die-with-parent',
      `-- bash -c ${esc(command)}`,
    );

    return parts.join(' ');
  }

  if (info.mechanism === 'sandbox-exec') {
    const allowRead = [projectDir, ...readOnlyDirs]
      .map(d => `(allow file-read* (subpath ${JSON.stringify(d)}))`)
      .join(' ');
    const allowWrite = `(allow file-write* (subpath ${JSON.stringify(projectDir)}))`;
    const profile = `(version 1)(deny default)${allowRead} ${allowWrite}(allow process-exec)(allow process-fork)(allow sysctl-read)(allow mach-lookup)`;
    return `sandbox-exec -p ${esc(profile)} bash -c ${esc(command)}`;
  }

  return command;
}
