import { it, expect } from 'vitest';
import { buildSpawnEnv } from './spawnEnv';

it('sets the terminal identity and drops the parent terminal and Claude Code session markers', () => {
  expect(buildSpawnEnv({
    PATH: '/usr/bin', HOME: '/Users/x', CLAUDE_CODE_NO_FLICKER: '1', MISSING: undefined,
    TERM: 'dumb', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.7.6', TERM_SESSION_ID: 'w0', TERM_FEATURES: 'T3',
    TERMINFO_DIRS: '/x', ITERM_SESSION_ID: 'w0t0', ITERM_PROFILE: 'Default', LC_TERMINAL: 'iTerm2',
    LC_TERMINAL_VERSION: '3.7.6', __CFBundleIdentifier: 'com.googlecode.iterm2',
    CLAUDECODE: '1', CLAUDE_PID: '1', CLAUDE_EFFORT: 'xhigh', CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_EXECPATH: '/x', CLAUDE_CODE_MESSAGING_SOCKET: '/s',
    CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: 'id',
    ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://localhost:5173',
  }, 'darwin')).toEqual({
    PATH: '/usr/bin', HOME: '/Users/x', CLAUDE_CODE_NO_FLICKER: '1',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_HYPERLINK: '1',
  });
});

it('drops what `npm start` and Vite add, keeping the rest of PATH in order', () => {
  expect(buildSpawnEnv({
    PATH: [
      '<root>/node_modules/.bin', '/Users/x/Developer/node_modules/.bin', '/node_modules/.bin',
      '/Users/x/.nvm/versions/node/v24.21.0/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',
      '/Users/x/.local/bin', '/usr/bin',
    ].join(':'),
    NODE: '/x/node', COLOR: '0', INIT_CWD: '/x', NODE_ENV: 'production', EDITOR: 'vi',
    npm_command: 'run-script', npm_config_prefix: '/x', npm_lifecycle_event: 'start', npm_package_name: 'mainframe',
  }, 'darwin')).toEqual({
    PATH: '/Users/x/.local/bin:/usr/bin', EDITOR: 'vi',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_HYPERLINK: '1',
  });
});

it('keeps an existing LANG', () => {
  expect(buildSpawnEnv({ LANG: 'sv_SE.UTF-8' }, 'darwin').LANG).toBe('sv_SE.UTF-8');
});

it("keeps the owner's own FORCE_HYPERLINK, even 0", () => {
  expect(buildSpawnEnv({ FORCE_HYPERLINK: '0' }, 'darwin').FORCE_HYPERLINK).toBe('0');
});

const TERMINAL_KEYS = { TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_HYPERLINK: '1' };

it('win32: cleans the Path value under its own key, on its own delimiter and with either slash', () => {
  expect(buildSpawnEnv({
    Path: [
      'C:\\x\\node_modules\\.bin', 'C:/Users/x/Developer/node_modules/.bin',
      'C:\\Users\\x\\AppData\\nvm\\node_modules\\npm\\node_modules\\@npmcli\\run-script\\lib\\node-gyp-bin',
      'C:\\Users\\x\\.local\\bin',
    ].join(';'),
  }, 'win32')).toEqual({ Path: 'C:\\Users\\x\\.local\\bin', ...TERMINAL_KEYS });
});

it('win32: keeps only the first spelling of Path, so the session never gets two', () => {
  expect(buildSpawnEnv({ Path: 'C:\\a', PATH: 'C:\\b' }, 'win32')).toEqual({ Path: 'C:\\a', ...TERMINAL_KEYS });
});

it("drops the Windows Terminal session markers, which name the terminal the app was started from", () => {
  for (const platform of ['darwin', 'win32'] as const) {
    expect(buildSpawnEnv({ WT_SESSION: 'a-b', WT_PROFILE_ID: '{c}' }, platform)).toEqual(TERMINAL_KEYS);
  }
});

it("drops the markers OpenCode sets in its shells, and keeps its other settings", () => {
  expect(buildSpawnEnv({ OPENCODE_TERMINAL: '1', OPENCODE_PTY_HANDOFF: '{}', OPENCODE_CONFIG_DIR: '/x' }, 'darwin')).toEqual({
    OPENCODE_CONFIG_DIR: '/x', ...TERMINAL_KEYS,
  });
});
