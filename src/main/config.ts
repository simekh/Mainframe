import { resolve } from 'node:path';

export interface AppConfig {
  /** MAINFRAME_CLAUDE_BIN; not set when the setup is to find claude itself. */
  claudeBin?: string;
  /** MAINFRAME_OPENCODE_BIN; not set when OpenCode is to be found on PATH or in its installer's folder. */
  opencodeBin?: string;
  /** MAINFRAME_CODEX_BIN; not set when Codex is to be found on PATH or in its installer's folder. */
  codexBin?: string;
  dataDir: string;
  inputBatchMs: number;
  outputBatchMs: number;
  logOsc: boolean;
  e2e: boolean;
  /** MAINFRAME_E2E_UPDATE_DIR, read only in e2e: the clone a test checks for updates in place of the app's own. */
  updateDir?: string;
  /** MAINFRAME_E2E_TRELLO_URL, read only in e2e: a stand-in for Trello's sign-in and API, both at this address. */
  trelloUrl?: string;
  /** MAINFRAME_UPDATE_FILE, set only by start.mjs: where to leave the tag to update to. Without it one click can't work. */
  launcherFile?: string;
  /** MAINFRAME_UPDATE_FAILED: start.mjs says why the update it was asked for did not happen. */
  updateFailure?: string;
  /**
   * Whether the app checks for updates by itself: not in `npm run dev` (ELECTRON_RENDERER_URL set), which is someone
   * working on Mainframe, nor in e2e unless a test names a clone.
   */
  autoCheck: boolean;
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

function readCodexBin(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.MAINFRAME_CODEX_BIN;
  if (raw === '') throw new Error('MAINFRAME_CODEX_BIN must name the codex binary, got an empty value');
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
  const e2e = env.MAINFRAME_E2E === '1';
  // A test app on the user's own data folder would run their projects with the stand-ins and rewrite their tasks.
  if (e2e && !env.MAINFRAME_DATA_DIR) throw new Error('MAINFRAME_E2E needs MAINFRAME_DATA_DIR: a test app never runs on the real data folder');
  return {
    claudeBin: readClaudeBin(env),
    opencodeBin: readOpencodeBin(env),
    codexBin: readCodexBin(env),
    dataDir: resolve(env.MAINFRAME_DATA_DIR ?? defaultDataDir),
    inputBatchMs: readBatchMs(env, 'MAINFRAME_INPUT_BATCH_MS', 0),
    outputBatchMs: readBatchMs(env, 'MAINFRAME_OUTPUT_BATCH_MS', 8),
    logOsc: env.MAINFRAME_LOG_OSC === '1',
    e2e,
    updateDir: e2e ? env.MAINFRAME_E2E_UPDATE_DIR : undefined,
    trelloUrl: (e2e && env.MAINFRAME_E2E_TRELLO_URL) || undefined,
    // Empty counts as unset: an empty failure would open the dialog with nothing to say.
    launcherFile: env.MAINFRAME_UPDATE_FILE || undefined,
    updateFailure: env.MAINFRAME_UPDATE_FAILED || undefined,
    autoCheck: !env.ELECTRON_RENDERER_URL && (!e2e || Boolean(env.MAINFRAME_E2E_UPDATE_DIR)),
  };
}
