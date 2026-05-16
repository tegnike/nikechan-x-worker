import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface KillSwitchState {
  global: 'open' | 'closed';
  surface: 'open' | 'closed';
  reasons: string[];
}

interface KillSwitchFile {
  global?: 'open' | 'closed';
  x?: 'open' | 'closed';
  reasons?: string[];
}

export function readKillSwitchState(): KillSwitchState {
  const fileState = readKillSwitchFile();
  const global = normalizeSwitch(
    process.env.NIKECHAN_X_WORKER_KILL_SWITCH ?? fileState?.global ?? 'open'
  );
  const surface = normalizeSwitch(
    process.env.NIKECHAN_X_WORKER_X_KILL_SWITCH ?? fileState?.x ?? 'open'
  );
  return {
    global,
    surface,
    reasons: [
      ...(fileState?.reasons ?? []),
      global === 'closed' ? 'global kill switch is closed' : null,
      surface === 'closed' ? 'x surface kill switch is closed' : null,
    ].filter((reason): reason is string => Boolean(reason)),
  };
}

function readKillSwitchFile(): KillSwitchFile | null {
  const path = resolve(process.env.NIKECHAN_X_WORKER_KILL_SWITCH_FILE ?? '.worker/kill-switch.json');
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as KillSwitchFile;
  return parsed;
}

function normalizeSwitch(value: string): 'open' | 'closed' {
  const normalized = value.trim().toLowerCase();
  if (['closed', 'close', 'off', 'disabled', 'true', '1'].includes(normalized)) return 'closed';
  return 'open';
}
