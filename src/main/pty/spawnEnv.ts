import { posix, win32 } from 'node:path';

// Keys that describe the terminal or Claude Code session the app was started from. A session
// that inherits them misdetects its terminal or behaves as a nested Claude Code session.
// Other CLAUDE_CODE_* keys are the owner's own settings and pass through.
const DROPPED_KEYS = new Set([
  'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'TERM_FEATURES', 'TERMINFO_DIRS',
  'ITERM_SESSION_ID', 'ITERM_PROFILE', 'LC_TERMINAL', 'LC_TERMINAL_VERSION', '__CFBundleIdentifier',
  'WT_SESSION', 'WT_PROFILE_ID',
  'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID',
  // Added by launching through `npm start` (and NODE_ENV by Vite); the owner's shell never sets them.
  'INIT_CWD', 'NODE', 'COLOR', 'NODE_ENV',
]);

function isDropped(key: string): boolean {
  return DROPPED_KEYS.has(key) || key.startsWith('ELECTRON_') || key.startsWith('npm_');
}

/**
 * The key a program's search path is under: PATH on POSIX; on Windows, whichever key spells it in
 * any case (the first, as `Path` is what Windows itself uses).
 */
export function pathKey(env: Record<string, string | undefined>, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env.PATH === undefined ? undefined : 'PATH';
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
}

// npm puts every node_modules/.bin up the tree and its node-gyp shim at the front of PATH.
function cleanPath(path: string, platform: NodeJS.Platform): string {
  const { delimiter } = platform === 'win32' ? win32 : posix;
  return path
    .split(delimiter)
    .filter((entry) => {
      const slashed = platform === 'win32' ? entry.replaceAll('\\', '/') : entry;
      return !slashed.endsWith('/node_modules/.bin') && !slashed.includes('/@npmcli/run-script/');
    })
    .join(delimiter);
}

export function buildSpawnEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string> {
  const pathName = pathKey(base, platform);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    // Windows' env is case-insensitive; a second spelling of PATH would shadow or be shadowed by the first.
    const otherPathSpelling = platform === 'win32' && key !== pathName && key.toUpperCase() === 'PATH';
    if (value !== undefined && !isDropped(key) && !otherPathSpelling) env[key] = value;
  }
  if (pathName !== undefined && env[pathName] !== undefined) env[pathName] = cleanPath(env[pathName], platform);
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.LANG ??= 'en_US.UTF-8';
  // Claude Code emits OSC 8 hyperlinks when this is 1, and the terminal makes them clickable.
  // The owner's own setting, even 0, wins.
  env.FORCE_HYPERLINK ??= '1';
  return env;
}
