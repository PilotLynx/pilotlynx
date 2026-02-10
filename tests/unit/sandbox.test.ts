import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectSandbox, wrapInSandbox, resetSandboxCache } from '../../src/lib/sandbox.js';

// Mock child_process and os at module level
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedPlatform = vi.mocked(platform);

beforeEach(() => {
  resetSandboxCache();
  vi.clearAllMocks();
  mockedPlatform.mockReturnValue('linux');
});

describe('detectSandbox', () => {
  it('returns kernel level when bwrap is found on linux', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    const info = detectSandbox();
    expect(info.level).toBe('kernel');
    expect(info.mechanism).toBe('bwrap');
  });

  it('returns regex-only when bwrap is not found', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const info = detectSandbox();
    expect(info.level).toBe('regex-only');
    expect(info.mechanism).toBeUndefined();
  });

  it('returns kernel level with sandbox-exec on macOS when available', () => {
    mockedPlatform.mockReturnValue('darwin');
    mockedExecFileSync.mockReturnValue(Buffer.from(''));

    const info = detectSandbox();
    expect(info.level).toBe('kernel');
    expect(info.mechanism).toBe('sandbox-exec');
  });

  it('returns regex-only on macOS when sandbox-exec is not available', () => {
    mockedPlatform.mockReturnValue('darwin');
    mockedExecFileSync.mockImplementation(() => { throw new Error('not found'); });

    const info = detectSandbox();
    expect(info.level).toBe('regex-only');
  });

  it('returns regex-only on unsupported platforms', () => {
    mockedPlatform.mockReturnValue('win32');

    const info = detectSandbox();
    expect(info.level).toBe('regex-only');
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('caches the result across calls', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    detectSandbox();
    detectSandbox();
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('resetSandboxCache clears cached detection', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    detectSandbox();
    resetSandboxCache();
    detectSandbox();
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });
});

describe('wrapInSandbox', () => {
  it('returns command unchanged when sandbox level is regex-only', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = wrapInSandbox('npm test', '/home/user/project');
    expect(result).toBe('npm test');
  });

  it('wraps command in bwrap when kernel sandbox is available', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    const result = wrapInSandbox('npm test', '/home/user/project');
    expect(result).toContain('bwrap');
    expect(result).toContain('--ro-bind / /');
    expect(result).toContain("--bind '/home/user/project' '/home/user/project'");
    expect(result).toContain("--chdir '/home/user/project'");
    expect(result).toContain('--die-with-parent');
    expect(result).toContain("bash -c 'npm test'");
  });

  it('includes --dev, --proc, and --tmpfs mounts', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    const result = wrapInSandbox('ls', '/proj');
    expect(result).toContain('--dev /dev');
    expect(result).toContain('--proc /proc');
    expect(result).toContain('--tmpfs /tmp');
  });

  it('adds read-only binds for additional directories', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    const result = wrapInSandbox('cat docs/readme.md', '/proj', [
      '/shared/docs',
      '/shared/insights',
    ]);
    expect(result).toContain("--ro-bind '/shared/docs' '/shared/docs'");
    expect(result).toContain("--ro-bind '/shared/insights' '/shared/insights'");
  });

  it('properly escapes commands with single quotes', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    const result = wrapInSandbox("echo 'hello world'", '/proj');
    // shellEscape wraps in single quotes, escaping inner single quotes
    expect(result).toContain("bash -c 'echo '\\''hello world'\\'''");
  });

  it('properly escapes project dirs with spaces', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/bwrap'));

    const result = wrapInSandbox('npm test', '/home/user/my project');
    expect(result).toContain("--bind '/home/user/my project' '/home/user/my project'");
    expect(result).toContain("--chdir '/home/user/my project'");
  });

  it('wraps command with sandbox-exec on macOS', () => {
    mockedPlatform.mockReturnValue('darwin');
    mockedExecFileSync.mockReturnValue(Buffer.from(''));

    const result = wrapInSandbox('npm test', '/proj');
    expect(result).toContain('sandbox-exec');
    expect(result).toContain('npm test');
  });

  it('returns command unchanged on unsupported platforms', () => {
    mockedPlatform.mockReturnValue('win32');

    const result = wrapInSandbox('npm test', '/proj');
    expect(result).toBe('npm test');
  });
});
