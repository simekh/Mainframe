import { resolve } from 'node:path';

export interface AppConfig {
  projectDir: string;
  claudeBin: string;
  dataDir: string;
  inputBatchMs: number;
  outputBatchMs: number;
  logOsc: boolean;
  e2e: boolean;
}

function readClaudeBin(env: NodeJS.ProcessEnv): string {
  const raw = env.MAINFRAME_CLAUDE_BIN;
  if (raw === undefined) return 'claude';
  if (raw === '') throw new Error('MAINFRAME_CLAUDE_BIN must name the claude binary, got an empty value');
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

/** The project and data folders come back absolute: the session hooks and `--settings` need them so. */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  isDirectory: (path: string) => boolean,
  defaultDataDir: string,
): AppConfig {
  // Mainframe has no project of its own to fall back on.
  if (!env.MAINFRAME_PROJECT_DIR) {
    throw new Error('MAINFRAME_PROJECT_DIR is not set: set it to the folder of the project Mainframe should run on');
  }
  const projectDir = resolve(env.MAINFRAME_PROJECT_DIR);
  if (!isDirectory(projectDir)) {
    throw new Error(`MAINFRAME_PROJECT_DIR is not a directory: ${projectDir}`);
  }
  return {
    projectDir,
    claudeBin: readClaudeBin(env),
    dataDir: resolve(env.MAINFRAME_DATA_DIR ?? defaultDataDir),
    inputBatchMs: readBatchMs(env, 'MAINFRAME_INPUT_BATCH_MS', 0),
    outputBatchMs: readBatchMs(env, 'MAINFRAME_OUTPUT_BATCH_MS', 8),
    logOsc: env.MAINFRAME_LOG_OSC === '1',
    e2e: env.MAINFRAME_E2E === '1',
  };
}
