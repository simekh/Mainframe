import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const isDir = () => true;
const PROJECT = { MAINFRAME_PROJECT_DIR: '/p' };

describe('loadConfig', () => {
  it('uses the defaults for all but the project', () => {
    expect(loadConfig(PROJECT, isDir, '/data')).toEqual({
      projectDir: '/p',
      claudeBin: 'claude', dataDir: '/data', inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false,
    });
  });

  // Mainframe has no project of its own to fall back on.
  it.each([[{}], [{ MAINFRAME_PROJECT_DIR: '' }]])('rejects a missing project dir (%o) and names the variable', (env) => {
    expect(() => loadConfig(env, isDir, '/data')).toThrow('MAINFRAME_PROJECT_DIR is not set');
  });

  it('reads every override', () => {
    expect(loadConfig({
      MAINFRAME_PROJECT_DIR: '/tmp/x', MAINFRAME_CLAUDE_BIN: '/x/claude', MAINFRAME_DATA_DIR: '/tmp/d',
      MAINFRAME_INPUT_BATCH_MS: '8', MAINFRAME_OUTPUT_BATCH_MS: '0', MAINFRAME_LOG_OSC: '1', MAINFRAME_E2E: '1',
    }, isDir, '/data')).toEqual({
      projectDir: '/tmp/x', claudeBin: '/x/claude', dataDir: '/tmp/d',
      inputBatchMs: 8, outputBatchMs: 0, logOsc: true, e2e: true,
    });
  });

  it('makes relative project and data dirs absolute', () => {
    const config = loadConfig({ MAINFRAME_PROJECT_DIR: 'p', MAINFRAME_DATA_DIR: 'd' }, isDir, '/data');
    expect([config.projectDir, config.dataDir]).toEqual([resolve('p'), resolve('d')]);
  });

  it.each([
    ['MAINFRAME_CLAUDE_BIN', ''],
    ['MAINFRAME_INPUT_BATCH_MS', '-1'], ['MAINFRAME_INPUT_BATCH_MS', '51'], ['MAINFRAME_OUTPUT_BATCH_MS', '2.5'],
  ])('rejects %s=%s and names the variable', (key, value) => {
    expect(() => loadConfig({ ...PROJECT, [key]: value }, isDir, '/data')).toThrow(key);
  });

  it('rejects a project dir that is not a directory', () => {
    expect(() => loadConfig({ MAINFRAME_PROJECT_DIR: '/nope' }, () => false, '/data')).toThrow('MAINFRAME_PROJECT_DIR');
  });
});
