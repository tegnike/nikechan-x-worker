import { HermesCliAgent } from './cli-agent.js';
import { LocalFallbackPlanner } from './local-planner.js';
import type { HermesAgentRuntime, HermesRuntimeMode } from './types.js';

export function createHermesRuntime(): HermesAgentRuntime {
  const mode = readHermesMode();
  if (mode === 'local-fallback') return new LocalFallbackPlanner();
  return new HermesCliAgent();
}

export function readHermesMode(): HermesRuntimeMode {
  const value = process.env.NIKECHAN_X_WORKER_HERMES_MODE ?? 'cli';
  if (value === 'local-fallback') return 'local-fallback';
  return 'cli';
}
