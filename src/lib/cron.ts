import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const MARKER_START = '# BEGIN pilotlynx schedule';
const MARKER_END = '# END pilotlynx schedule';

function getCurrentCrontab(): string {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

function setCrontab(content: string): void {
  execFileSync('crontab', ['-'], { input: content, stdio: ['pipe', 'pipe', 'pipe'] });
}

function stripExistingEntry(crontab: string): string {
  const lines = crontab.split('\n');
  const result: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === MARKER_START) { inside = true; continue; }
    if (line.trim() === MARKER_END) { inside = false; continue; }
    if (!inside) result.push(line);
  }
  return result.join('\n');
}

export function installScheduleCron(plynxBin: string): boolean {
  if (platform() === 'win32') return false;

  const current = getCurrentCrontab();
  const cleaned = stripExistingEntry(current).trimEnd();

  const entry = [
    MARKER_START,
    `*/15 * * * * ${plynxBin} schedule tick >> /tmp/plynx-tick.log 2>&1`,
    MARKER_END,
  ].join('\n');

  const newCrontab = cleaned ? `${cleaned}\n${entry}\n` : `${entry}\n`;
  setCrontab(newCrontab);
  return true;
}

export function uninstallScheduleCron(): boolean {
  if (platform() === 'win32') return false;

  const current = getCurrentCrontab();
  if (!current.includes(MARKER_START)) return false;

  const cleaned = stripExistingEntry(current).trimEnd();
  setCrontab(cleaned ? `${cleaned}\n` : '');
  return true;
}

export function isScheduleCronInstalled(): boolean {
  return getCurrentCrontab().includes(MARKER_START);
}
