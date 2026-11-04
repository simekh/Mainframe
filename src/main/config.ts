export interface AppConfig {
  projectDir: string;
  sessionArgv: string[];
  inputBatchMs: number;
  outputBatchMs: number;
  logOsc: boolean;
  e2e: boolean;
}

const DEFAULT_PROJECT_DIR = '/Users/simonekholm/Developer/Simmesolo/Damela';

function readArgv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.THESOURCE_SESSION_ARGV;
  if (raw === undefined) return ['claude'];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((a) => typeof a === 'string')) {
    throw new Error(`THESOURCE_SESSION_ARGV must be a JSON array of at least one string, got ${raw}`);
  }
  return parsed;
}

function readBatchMs(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) > 50) {
    throw new Error(`${key} must be an integer from 0 to 50, got ${raw}`);
  }
  return Number(raw);
}

export function loadConfig(env: NodeJS.ProcessEnv, isDirectory: (path: string) => boolean): AppConfig {
  const projectDir = env.THESOURCE_PROJECT_DIR ?? DEFAULT_PROJECT_DIR;
  if (!isDirectory(projectDir)) {
    throw new Error(`THESOURCE_PROJECT_DIR is not a directory: ${projectDir}`);
  }
  return {
    projectDir,
    sessionArgv: readArgv(env),
    inputBatchMs: readBatchMs(env, 'THESOURCE_INPUT_BATCH_MS', 0),
    outputBatchMs: readBatchMs(env, 'THESOURCE_OUTPUT_BATCH_MS', 8),
    logOsc: env.THESOURCE_LOG_OSC === '1',
    e2e: env.THESOURCE_E2E === '1',
  };
}
