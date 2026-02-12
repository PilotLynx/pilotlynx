import { resolve } from 'node:path';

/**
 * Extracts path-like tokens from a shell command string and checks
 * whether any resolve to a location outside the allowed directory.
 */
export function bashCommandEscapesDir(command: string, allowedDir: string): boolean {
  // Deny shell features that bypass static path analysis
  // Command substitution, variable expansion, process substitution
  if (/\$\(/.test(command)) return true;
  if (/`/.test(command)) return true;
  if (/\$\{/.test(command)) return true;
  if (/\$[A-Za-z_]/.test(command)) return true;
  if (/[<>]\(/.test(command)) return true;

  // Encoded characters (hex, octal, unicode escapes)
  if (/\\x[0-9a-fA-F]{2}/.test(command)) return true;
  if (/\\[0-7]{1,3}/.test(command)) return true;
  if (/\\u[0-9a-fA-F]{4}/.test(command)) return true;

  // Tilde expansion (home directory references)
  if (/(?:^|[\s;|&(])~(?:[/\s]|$)/.test(command)) return true;

  // Brace expansion (can expand to multiple paths)
  if (/\{[^}]*,/.test(command)) return true;

  // Input redirects (can read arbitrary files)
  if (/\s<\s+\S/.test(command)) return true;

  // Output redirects (can write to arbitrary locations)
  if (/(?:^|[^<])>{1,2}\s*\S/.test(command)) return true;
  if (/\d>\s*\S/.test(command)) return true;

  // Heredocs
  if (/<<-?\s*\S/.test(command)) return true;

  // Deny shell inception
  if (/\b(bash|sh|zsh|dash)\s+-c\b/.test(command)) return true;
  if (/\beval\s/.test(command)) return true;
  if (/\bexec\s/.test(command)) return true;

  // Deny relative path traversal (.. components)
  if (/(?:^|\s|\/|=)\.\.(?:\/|\s|$)/.test(command)) return true;

  // Deny symlink creation pointing outside
  if (/\bln\s+(-\w+\s+)*-s\b/.test(command) || /\bln\s+-\w*s/.test(command)) {
    return true;
  }

  // Deny cd/pushd to outside project dir
  const cdPattern = /\b(cd|pushd)\s+("[^"]+"|'[^']+'|\S+)/g;
  let cdMatch;
  while ((cdMatch = cdPattern.exec(command)) !== null) {
    const target = cdMatch[2].replace(/^['"]|['"]$/g, '');
    if (target === '-' || target === '~') return true;
    const resolved = resolve(allowedDir, target);
    const prefix = allowedDir.endsWith('/') ? allowedDir : allowedDir + '/';
    if (resolved !== allowedDir && !resolved.startsWith(prefix)) return true;
  }

  // Check for absolute paths (including inside quotes) that escape project dir
  const absPathPattern = /(?:^|[\s='"])(\/?(?:\/[^\s;|&><"']*)+)/g;
  let pathMatch;
  while ((pathMatch = absPathPattern.exec(command)) !== null) {
    const path = pathMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (!path.startsWith('/')) continue;
    const resolved = resolve(path);
    const prefix = allowedDir.endsWith('/') ? allowedDir : allowedDir + '/';
    if (resolved !== allowedDir && !resolved.startsWith(prefix)) return true;
  }

  return false;
}
