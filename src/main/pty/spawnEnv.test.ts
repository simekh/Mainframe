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
  })).toEqual({
    PATH: '/usr/bin', HOME: '/Users/x', CLAUDE_CODE_NO_FLICKER: '1',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_HYPERLINK: '1',
  });
});

it('drops what `npm start` and Vite add, keeping the rest of PATH in order', () => {
  expect(buildSpawnEnv({
    PATH: [
      '<root>/node_modules/.bin', '/Users/simonekholm/Developer/node_modules/.bin', '/node_modules/.bin',
      '/Users/x/.nvm/versions/node/v24.21.0/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',
      '/Users/x/.local/bin', '/usr/bin',
    ].join(':'),
    NODE: '/x/node', COLOR: '0', INIT_CWD: '/x', NODE_ENV: 'production', EDITOR: 'vi',
    npm_command: 'run-script', npm_config_prefix: '/x', npm_lifecycle_event: 'start', npm_package_name: 'mainframe',
  })).toEqual({
    PATH: '/Users/x/.local/bin:/usr/bin', EDITOR: 'vi',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_HYPERLINK: '1',
  });
});

it('keeps an existing LANG', () => {
  expect(buildSpawnEnv({ LANG: 'sv_SE.UTF-8' }).LANG).toBe('sv_SE.UTF-8');
});

it("keeps the owner's own FORCE_HYPERLINK, even 0", () => {
  expect(buildSpawnEnv({ FORCE_HYPERLINK: '0' }).FORCE_HYPERLINK).toBe('0');
});
