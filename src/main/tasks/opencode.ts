import { randomBytes } from 'node:crypto';

/** OpenCode's own tabs would sit inside Mainframe's terminal: switched off for the session. */
export const OPENCODE_ENV: Record<string, string> = { OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"}}' };

const SESSION_ID = /^ses_[0-9a-f]{28}$/;

export function newOpencodeSessionId(): string {
  return `ses_${randomBytes(14).toString('hex')}`;
}

export function isOpencodeSessionId(s: string): boolean {
  return SESSION_ID.test(s);
}

export function opencodeStartArgv(o: { opencodeBin: string; sessionId: string; prompt: string }): string[] {
  return [o.opencodeBin, '--standalone', '-s', o.sessionId, '--prompt', o.prompt];
}

export function opencodeReopenArgv(o: { opencodeBin: string; sessionId: string; prompt?: string }): string[] {
  if (!isOpencodeSessionId(o.sessionId)) throw new Error(`not a session id: ${o.sessionId}`);
  return [o.opencodeBin, '--standalone', '-s', o.sessionId, ...(o.prompt === undefined ? [] : ['--prompt', o.prompt])];
}
