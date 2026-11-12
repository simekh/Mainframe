import { ADAPTERS } from '../agents/adapters';
import { pathFor, pathKey } from './findExecutable';

// Keys that describe the terminal the app was started from, which a session that inherits them misdetects.
const DROPPED_KEYS = new Set([
  'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'TERM_FEATURES', 'TERMINFO_DIRS',
  'ITERM_SESSION_ID', 'ITERM_PROFILE', 'LC_TERMINAL', 'LC_TERMINAL_VERSION', '__CFBundleIdentifier',
  'WT_SESSION', 'WT_PROFILE_ID',
  ...Object.values(ADAPTERS).flatMap((a) => a.droppedEnv),
  // Added by launching through `npm start` (and NODE_ENV by Vite); the owner's shell never sets them.
  'INIT_CWD', 'NODE', 'COLOR', 'NODE_ENV',
]);

function isDropped(key: string): boolean {
  return DROPPED_KEYS.has(key) || key.startsWith('ELECTRON_') || key.startsWith('npm_');
}

// npm puts every node_modules/.bin up the tree and its node-gyp shim at the front of PATH.
function cleanPath(path: string, platform: NodeJS.Platform): string {
  const { delimiter } = pathFor(platform);
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
