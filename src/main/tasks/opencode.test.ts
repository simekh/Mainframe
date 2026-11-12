import { expect, it } from 'vitest';
import {
  isOpencodeSessionId,
  newOpencodeSessionId,
  OPENCODE_ENV,
  opencodeReopenArgv,
  opencodeStartArgv,
} from './opencode';

const id = 'ses_' + 'a'.repeat(28);

it('starts a session under the given id with the prompt, standalone', () => {
  expect(opencodeStartArgv({ opencodeBin: 'oc', sessionId: id, prompt: 'P' })).toEqual([
    'oc', '--standalone', '-s', id, '--prompt', 'P',
  ]);
});

it('reopens a session without a prompt, or with one', () => {
  expect(opencodeReopenArgv({ opencodeBin: 'oc', sessionId: id })).toEqual(['oc', '--standalone', '-s', id]);
  expect(opencodeReopenArgv({ opencodeBin: 'oc', sessionId: id, prompt: 'P' })).toEqual([
    'oc', '--standalone', '-s', id, '--prompt', 'P',
  ]);
});

it('refuses to reopen a session whose id is not an OpenCode id', () => {
  expect(() => opencodeReopenArgv({ opencodeBin: 'oc', sessionId: 'ses_x' })).toThrow('not a session id: ses_x');
});

it('makes distinct ids that pass the check', () => {
  const ids = Array.from({ length: 100 }, newOpencodeSessionId);
  expect(ids.every(isOpencodeSessionId)).toBe(true);
  expect(new Set(ids).size).toBe(100);
});

it('turns OpenCode tabs off in its environment', () => {
  expect(OPENCODE_ENV).toEqual({ OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"}}' });
});
