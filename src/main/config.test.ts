import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const isDir = () => true;

describe('loadConfig', () => {
  it('uses the defaults', () => {
    expect(loadConfig({}, isDir, '/data')).toEqual({
      projectDir: '/Users/simonekholm/Developer/Simmesolo/Damela',
      claudeBin: 'claude', dataDir: '/data', inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false,
    });
  });

  it('reads every override', () => {
    expect(loadConfig({
      THESOURCE_PROJECT_DIR: '/tmp/x', THESOURCE_CLAUDE_BIN: '/x/claude', THESOURCE_DATA_DIR: '/tmp/d',
      THESOURCE_INPUT_BATCH_MS: '8', THESOURCE_OUTPUT_BATCH_MS: '0', THESOURCE_LOG_OSC: '1', THESOURCE_E2E: '1',
    }, isDir, '/data')).toEqual({
      projectDir: '/tmp/x', claudeBin: '/x/claude', dataDir: '/tmp/d',
      inputBatchMs: 8, outputBatchMs: 0, logOsc: true, e2e: true,
    });
  });

  it('makes relative project and data dirs absolute', () => {
    const config = loadConfig({ THESOURCE_PROJECT_DIR: 'p', THESOURCE_DATA_DIR: 'd' }, isDir, '/data');
    expect([config.projectDir, config.dataDir]).toEqual([resolve('p'), resolve('d')]);
  });

  it.each([
    ['THESOURCE_CLAUDE_BIN', ''],
    ['THESOURCE_INPUT_BATCH_MS', '-1'], ['THESOURCE_INPUT_BATCH_MS', '51'], ['THESOURCE_OUTPUT_BATCH_MS', '2.5'],
  ])('rejects %s=%s and names the variable', (key, value) => {
    expect(() => loadConfig({ [key]: value }, isDir, '/data')).toThrow(key);
  });

  it('rejects a project dir that is not a directory', () => {
    expect(() => loadConfig({ THESOURCE_PROJECT_DIR: '/nope' }, () => false, '/data')).toThrow('THESOURCE_PROJECT_DIR');
  });
});
