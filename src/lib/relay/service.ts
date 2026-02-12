import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { platform, homedir } from 'node:os';
import { getConfigRoot } from '../config.js';

export type ServicePlatform = 'linux' | 'macos' | 'windows';

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  platform: ServicePlatform;
}

function detectPlatform(): ServicePlatform {
  const p = platform();
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

function resolveNodePath(): string {
  try {
    return execFileSync('which', ['node'], { encoding: 'utf8' }).trim();
  } catch {
    return process.execPath;
  }
}

function resolvePlynxBin(): string {
  try {
    return execFileSync('which', ['plynx'], { encoding: 'utf8' }).trim();
  } catch {
    return 'plynx';
  }
}

// ── Linux (systemd user service) ──

const SYSTEMD_SERVICE_NAME = 'plynx-relay';

function systemdServicePath(): string {
  return join(homedir(), '.config', 'systemd', 'user', `${SYSTEMD_SERVICE_NAME}.service`);
}

function generateSystemdUnit(): string {
  const nodePath = resolveNodePath();
  const plynxBin = resolvePlynxBin();
  const configRoot = getConfigRoot();

  return `[Unit]
Description=PilotLynx Relay (Telegram bot)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${plynxBin} relay start
Restart=on-failure
RestartSec=5
StartLimitBurst=3
Environment=PILOTLYNX_ROOT=${configRoot}
Environment=PATH=${process.env.PATH}
Environment=HOME=${homedir()}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

function installLinux(): void {
  const servicePath = systemdServicePath();
  mkdirSync(dirname(servicePath), { recursive: true });
  writeFileSync(servicePath, generateSystemdUnit(), 'utf8');

  try {
    execFileSync('loginctl', ['enable-linger', process.env.USER ?? ''], { stdio: 'pipe' });
  } catch {
    // May fail if already enabled or not supported
  }

  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  execFileSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_SERVICE_NAME], { stdio: 'pipe' });
}

function uninstallLinux(): void {
  try {
    execFileSync('systemctl', ['--user', 'stop', SYSTEMD_SERVICE_NAME], { stdio: 'pipe' });
  } catch { /* may not be running */ }
  try {
    execFileSync('systemctl', ['--user', 'disable', SYSTEMD_SERVICE_NAME], { stdio: 'pipe' });
  } catch { /* may not be enabled */ }

  const servicePath = systemdServicePath();
  if (existsSync(servicePath)) unlinkSync(servicePath);

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  } catch { /* best effort */ }
}

function statusLinux(): ServiceStatus {
  const installed = existsSync(systemdServicePath());
  let running = false;
  if (installed) {
    try {
      const result = execFileSync('systemctl', ['--user', 'is-active', SYSTEMD_SERVICE_NAME], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      running = result === 'active';
    } catch { /* inactive or failed */ }
  }
  return { installed, running, platform: 'linux' };
}

// ── macOS (launchd user agent) ──

const LAUNCHD_LABEL = 'com.pilotlynx.relay';

function launchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function generateLaunchdPlist(): string {
  const nodePath = resolveNodePath();
  const plynxBin = resolvePlynxBin();
  const configRoot = getConfigRoot();
  const logDir = join(homedir(), 'Library', 'Logs', 'pilotlynx');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${plynxBin}</string>
    <string>relay</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PILOTLYNX_ROOT</key>
    <string>${configRoot}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/relay.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/relay-error.log</string>
</dict>
</plist>
`;
}

function installMacos(): void {
  const plistPath = launchdPlistPath();
  mkdirSync(dirname(plistPath), { recursive: true });

  const logDir = join(homedir(), 'Library', 'Logs', 'pilotlynx');
  mkdirSync(logDir, { recursive: true });

  writeFileSync(plistPath, generateLaunchdPlist(), 'utf8');
  execFileSync('launchctl', ['load', plistPath], { stdio: 'pipe' });
}

function uninstallMacos(): void {
  const plistPath = launchdPlistPath();
  if (existsSync(plistPath)) {
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'pipe' });
    } catch { /* may not be loaded */ }
    unlinkSync(plistPath);
  }
}

function statusMacos(): ServiceStatus {
  const installed = existsSync(launchdPlistPath());
  let running = false;
  if (installed) {
    try {
      const result = execFileSync('launchctl', ['list', LAUNCHD_LABEL], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      running = result.includes(LAUNCHD_LABEL);
    } catch { /* not loaded */ }
  }
  return { installed, running, platform: 'macos' };
}

// ── Windows (instructions only — node-windows is optional) ──

function installWindows(): void {
  throw new Error(
    'Automatic Windows service installation requires the "node-windows" package.\n' +
    'Install it with: npm install -g node-windows\n' +
    'Then run: plynx relay install\n\n' +
    'Alternatively, run "plynx relay start" manually or create a Task Scheduler entry.'
  );
}

function uninstallWindows(): void {
  throw new Error(
    'Automatic Windows service uninstallation requires the "node-windows" package.\n' +
    'Remove the service manually via services.msc or Task Scheduler.'
  );
}

function statusWindows(): ServiceStatus {
  return { installed: false, running: false, platform: 'windows' };
}

// ── Public API ──

export function installService(): void {
  const p = detectPlatform();
  if (p === 'linux') installLinux();
  else if (p === 'macos') installMacos();
  else installWindows();
}

export function uninstallService(): void {
  const p = detectPlatform();
  if (p === 'linux') uninstallLinux();
  else if (p === 'macos') uninstallMacos();
  else uninstallWindows();
}

export function getServiceStatus(): ServiceStatus {
  const p = detectPlatform();
  if (p === 'linux') return statusLinux();
  if (p === 'macos') return statusMacos();
  return statusWindows();
}
