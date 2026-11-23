import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses the defaults, and sets no claude path of its own', () => {
    expect(loadConfig({}, '/data')).toEqual({
      claudeBin: undefined, dataDir: resolve('/data'), inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false, autoCheck: true,
    });
  });

  it('reads every override', () => {
    expect(loadConfig({
      MAINFRAME_CLAUDE_BIN: '/x/claude', MAINFRAME_DATA_DIR: '/tmp/d',
      MAINFRAME_INPUT_BATCH_MS: '8', MAINFRAME_OUTPUT_BATCH_MS: '0', MAINFRAME_LOG_OSC: '1', MAINFRAME_E2E: '1',
    }, '/data')).toEqual({
      claudeBin: '/x/claude', dataDir: resolve('/tmp/d'),
      inputBatchMs: 8, outputBatchMs: 0, logOsc: true, e2e: true, autoCheck: false,
    });
  });

  it('reads MAINFRAME_OPENCODE_BIN, and rejects an empty one with its own message', () => {
    expect(loadConfig({ MAINFRAME_OPENCODE_BIN: '/x/opencode' }, '/data').opencodeBin).toBe('/x/opencode');
    expect(() => loadConfig({ MAINFRAME_OPENCODE_BIN: '' }, '/d')).toThrow(
      'MAINFRAME_OPENCODE_BIN must name the opencode binary, got an empty value',
    );
  });

  it('reads MAINFRAME_CODEX_BIN, and rejects an empty one with its own message', () => {
    expect(loadConfig({ MAINFRAME_CODEX_BIN: '/x/codex' }, '/data').codexBin).toBe('/x/codex');
    expect(() => loadConfig({ MAINFRAME_CODEX_BIN: '' }, '/d')).toThrow(
      'MAINFRAME_CODEX_BIN must name the codex binary, got an empty value',
    );
  });

  it('reads the update settings, and the update folder only in e2e', () => {
    const env = { MAINFRAME_E2E_UPDATE_DIR: '/x/clone', MAINFRAME_UPDATE_FILE: '/x/update', MAINFRAME_UPDATE_FAILED: 'it failed' };
    expect(loadConfig(env, '/data')).toMatchObject({ updateDir: undefined, launcherFile: '/x/update', updateFailure: 'it failed' });
    expect(loadConfig({ ...env, MAINFRAME_E2E: '1' }, '/data').updateDir).toBe('/x/clone');
    expect(loadConfig({ MAINFRAME_UPDATE_FILE: '', MAINFRAME_UPDATE_FAILED: '' }, '/data')).toMatchObject({ launcherFile: undefined, updateFailure: undefined });
  });

  it('MAINFRAME_E2E_TRELLO_URL is read only in e2e', () => {
    const env = { MAINFRAME_E2E_TRELLO_URL: 'http://127.0.0.1:9999' };
    expect(loadConfig(env, '/data').trelloUrl).toBeUndefined();
    expect(loadConfig({ ...env, MAINFRAME_E2E: '1' }, '/data').trelloUrl).toBe('http://127.0.0.1:9999');
    expect(loadConfig({ MAINFRAME_E2E_TRELLO_URL: '', MAINFRAME_E2E: '1' }, '/data').trelloUrl).toBeUndefined();
  });

  it('checks for updates by itself except in dev, and in e2e only with a clone named', () => {
    expect(loadConfig({}, '/data').autoCheck).toBe(true);
    expect(loadConfig({ ELECTRON_RENDERER_URL: 'http://localhost:5173' }, '/data').autoCheck).toBe(false);
    expect(loadConfig({ MAINFRAME_E2E: '1' }, '/data').autoCheck).toBe(false);
    expect(loadConfig({ MAINFRAME_E2E: '1', MAINFRAME_E2E_UPDATE_DIR: '/x/clone' }, '/data').autoCheck).toBe(true);
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
