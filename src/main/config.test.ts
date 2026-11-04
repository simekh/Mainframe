import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const isDir = () => true;

describe('loadConfig', () => {
  it('uses the defaults', () => {
    expect(loadConfig({}, isDir)).toEqual({
      projectDir: '/Users/simonekholm/Developer/Simmesolo/Damela',
      sessionArgv: ['claude'], inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false,
    });
  });

  it('reads every override', () => {
    expect(loadConfig({
      THESOURCE_PROJECT_DIR: '/tmp/x', THESOURCE_SESSION_ARGV: '["/bin/zsh","-l"]',
      THESOURCE_INPUT_BATCH_MS: '8', THESOURCE_OUTPUT_BATCH_MS: '0', THESOURCE_LOG_OSC: '1', THESOURCE_E2E: '1',
    }, isDir)).toEqual({
      projectDir: '/tmp/x', sessionArgv: ['/bin/zsh', '-l'], inputBatchMs: 8, outputBatchMs: 0, logOsc: true, e2e: true,
    });
  });

  it.each([
    ['THESOURCE_SESSION_ARGV', '[]'], ['THESOURCE_SESSION_ARGV', 'claude'], ['THESOURCE_SESSION_ARGV', '[1]'],
    ['THESOURCE_INPUT_BATCH_MS', '-1'], ['THESOURCE_INPUT_BATCH_MS', '51'], ['THESOURCE_OUTPUT_BATCH_MS', '2.5'],
  ])('rejects %s=%s and names the variable', (key, value) => {
    expect(() => loadConfig({ [key]: value }, isDir)).toThrow(key);
  });

  it('rejects a project dir that is not a directory', () => {
    expect(() => loadConfig({ THESOURCE_PROJECT_DIR: '/nope' }, () => false)).toThrow('THESOURCE_PROJECT_DIR');
  });
});
