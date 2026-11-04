// Keys that describe the terminal or Claude Code session the app was started from. A session
// that inherits them misdetects its terminal or behaves as a nested Claude Code session.
// Other CLAUDE_CODE_* keys are the owner's own settings and pass through.
const DROPPED_KEYS = new Set([
  'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'TERM_FEATURES', 'TERMINFO_DIRS',
  'ITERM_SESSION_ID', 'ITERM_PROFILE', 'LC_TERMINAL', 'LC_TERMINAL_VERSION', '__CFBundleIdentifier',
  'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID',
  // Added by launching through `npm start` (and NODE_ENV by Vite); the owner's shell never sets them.
  'INIT_CWD', 'NODE', 'COLOR', 'NODE_ENV',
]);

function isDropped(key: string): boolean {
  return DROPPED_KEYS.has(key) || key.startsWith('ELECTRON_') || key.startsWith('npm_');
}

// npm puts every node_modules/.bin up the tree and its node-gyp shim at the front of PATH.
function cleanPath(path: string): string {
  return path
    .split(':')
    .filter((entry) => !entry.endsWith('/node_modules/.bin') && !entry.includes('/@npmcli/run-script/'))
    .join(':');
}

export function buildSpawnEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !isDropped(key)) env[key] = value;
  }
  if (env.PATH !== undefined) env.PATH = cleanPath(env.PATH);
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.LANG ??= 'en_US.UTF-8';
  return env;
}
