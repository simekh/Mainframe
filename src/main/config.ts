import { resolve } from 'node:path';

export interface AppConfig {
  /** MAINFRAME_CLAUDE_BIN; not set when the setup is to find claude itself. */
  claudeBin?: string;
  /** MAINFRAME_OPENCODE_BIN; not set when OpenCode is to be found on PATH or in its installer's folder. */
  opencodeBin?: string;
  dataDir: string;
  inputBatchMs: number;
  outputBatchMs: number;
  logOsc: boolean;
  e2e: boolean;
}

function readClaudeBin(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.MAINFRAME_CLAUDE_BIN;
  if (raw === '') throw new Error('MAINFRAME_CLAUDE_BIN must name the claude binary, got an empty value');
  return raw;
}

function readOpencodeBin(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.MAINFRAME_OPENCODE_BIN;
  if (raw === '') throw new Error('MAINFRAME_OPENCODE_BIN must name the opencode binary, got an empty value');
  return raw;
}

function readBatchMs(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) > 50) {
    throw new Error(`${key} must be an integer from 0 to 50, got ${raw}`);
  }
  return Number(raw);
}

/** The data folder comes back absolute: the session hooks and `--settings` need it so. */
export function loadConfig(env: NodeJS.ProcessEnv, defaultDataDir: string): AppConfig {
  return {
    claudeBin: readClaudeBin(env),
    opencodeBin: readOpencodeBin(env),
    dataDir: resolve(env.MAINFRAME_DATA_DIR ?? defaultDataDir),
    inputBatchMs: readBatchMs(env, 'MAINFRAME_INPUT_BATCH_MS', 0),
    outputBatchMs: readBatchMs(env, 'MAINFRAME_OUTPUT_BATCH_MS', 8),
    logOsc: env.MAINFRAME_LOG_OSC === '1',
    e2e: env.MAINFRAME_E2E === '1',
  };
}
