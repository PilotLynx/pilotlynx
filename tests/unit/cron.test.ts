import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installScheduleCron, uninstallScheduleCron, isScheduleCronInstalled } from '../../src/lib/cron.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const mockedExec = vi.mocked(execFileSync);
const mockedPlatform = vi.mocked(platform);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPlatform.mockReturnValue('linux');
});

describe('installScheduleCron', () => {
  it('installs a cron entry with markers', () => {
    mockedExec.mockImplementation((cmd, args) => {
      if (args?.[0] === '-l') return '' as any;
      return '' as any;
    });

    const result = installScheduleCron('/usr/local/bin/pilotlynx');
    expect(result).toBe(true);

    const setCall = mockedExec.mock.calls.find((c) => c[1]?.[0] === '-');
    expect(setCall).toBeDefined();
    const input = (setCall?.[2] as any)?.input as string;
    expect(input).toContain('# BEGIN pilotlynx schedule');
    expect(input).toContain('# END pilotlynx schedule');
    expect(input).toContain('/usr/local/bin/pilotlynx schedule tick');
  });

  it('replaces existing entry on reinstall', () => {
    const existingCrontab = [
      '0 * * * * some-other-job',
      '# BEGIN pilotlynx schedule',
      '*/15 * * * * old-pilotlynx schedule tick',
      '# END pilotlynx schedule',
      '',
    ].join('\n');

    mockedExec.mockImplementation((cmd, args) => {
      if (args?.[0] === '-l') return existingCrontab as any;
      return '' as any;
    });

    installScheduleCron('/new/pilotlynx');

    const setCall = mockedExec.mock.calls.find((c) => c[1]?.[0] === '-');
    const input = (setCall?.[2] as any)?.input as string;
    expect(input).toContain('/new/pilotlynx schedule tick');
    expect(input).not.toContain('old-pilotlynx');
    expect(input).toContain('some-other-job');
  });

  it('returns false on Windows', () => {
    mockedPlatform.mockReturnValue('win32');
    const result = installScheduleCron('/usr/local/bin/pilotlynx');
    expect(result).toBe(false);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});

describe('uninstallScheduleCron', () => {
  it('removes the marked entry', () => {
    const crontab = [
      '0 * * * * other-job',
      '# BEGIN pilotlynx schedule',
      '*/15 * * * * pilotlynx schedule tick',
      '# END pilotlynx schedule',
      '',
    ].join('\n');

    mockedExec.mockImplementation((cmd, args) => {
      if (args?.[0] === '-l') return crontab as any;
      return '' as any;
    });

    const result = uninstallScheduleCron();
    expect(result).toBe(true);

    const setCall = mockedExec.mock.calls.find((c) => c[1]?.[0] === '-');
    const input = (setCall?.[2] as any)?.input as string;
    expect(input).not.toContain('pilotlynx schedule');
    expect(input).toContain('other-job');
  });

  it('returns false when no entry exists', () => {
    mockedExec.mockImplementation((cmd, args) => {
      if (args?.[0] === '-l') return '0 * * * * other-job\n' as any;
      return '' as any;
    });

    const result = uninstallScheduleCron();
    expect(result).toBe(false);
  });
});

describe('isScheduleCronInstalled', () => {
  it('returns true when marker is present', () => {
    mockedExec.mockReturnValue('# BEGIN pilotlynx schedule\n*/15 * * * * pilotlynx tick\n# END pilotlynx schedule\n' as any);
    expect(isScheduleCronInstalled()).toBe(true);
  });

  it('returns false when no marker', () => {
    mockedExec.mockReturnValue('0 * * * * other-job\n' as any);
    expect(isScheduleCronInstalled()).toBe(false);
  });
});
