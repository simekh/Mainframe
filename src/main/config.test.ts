import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses the defaults, and sets no claude path of its own', () => {
    expect(loadConfig({}, '/data')).toEqual({
      claudeBin: undefined, dataDir: resolve('/data'), inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false,
    });
  });

  it('reads every override', () => {
    expect(loadConfig({
      MAINFRAME_CLAUDE_BIN: '/x/claude', MAINFRAME_DATA_DIR: '/tmp/d',
      MAINFRAME_INPUT_BATCH_MS: '8', MAINFRAME_OUTPUT_BATCH_MS: '0', MAINFRAME_LOG_OSC: '1', MAINFRAME_E2E: '1',
    }, '/data')).toEqual({
      claudeBin: '/x/claude', dataDir: resolve('/tmp/d'),
      inputBatchMs: 8, outputBatchMs: 0, logOsc: true, e2e: true,
    });
  });

  it('reads MAINFRAME_OPENCODE_BIN, and rejects an empty one with its own message', () => {
    expect(loadConfig({ MAINFRAME_OPENCODE_BIN: '/x/opencode' }, '/data').opencodeBin).toBe('/x/opencode');
    expect(() => loadConfig({ MAINFRAME_OPENCODE_BIN: '' }, '/d')).toThrow(
      'MAINFRAME_OPENCODE_BIN must name the opencode binary, got an empty value',
    );
  });

  it('makes a relative data dir absolute', () => {
    expect(loadConfig({ MAINFRAME_DATA_DIR: 'd' }, '/data').dataDir).toBe(resolve('d'));
  });

  it.each([
    ['MAINFRAME_CLAUDE_BIN', ''],
    ['MAINFRAME_INPUT_BATCH_MS', '-1'], ['MAINFRAME_INPUT_BATCH_MS', '51'], ['MAINFRAME_OUTPUT_BATCH_MS', '2.5'],
  ])('rejects %s=%s and names the variable', (key, value) => {
    expect(() => loadConfig({ [key]: value }, '/data')).toThrow(key);
  });
});
