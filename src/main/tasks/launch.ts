const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

export function startArgv(o: {
  claudeBin: string;
  slug: string;
  name: string;
  claudeSessionId: string;
  settingsPath: string;
  prompt: string;
}): string[] {
  return [o.claudeBin, '-w', o.slug, '-n', o.name, '--session-id', o.claudeSessionId, '--settings', o.settingsPath, o.prompt];
}

export function reopenArgv(o: {
  claudeBin: string;
  slug: string;
  claudeSessionId: string;
  settingsPath: string;
  branchExists: boolean;
  /** Sent to the resumed conversation as its next prompt: Claude starts no turn of its own after a resume. */
  prompt?: string;
}): string[] {
  if (!isUuid(o.claudeSessionId)) throw new Error(`not a session id: ${o.claudeSessionId}`);
  const worktree = o.branchExists ? ['--worktree', o.slug] : [];
  const prompt = o.prompt === undefined ? [] : [o.prompt];
  return [o.claudeBin, ...worktree, '--resume', o.claudeSessionId, '--settings', o.settingsPath, ...prompt];
}

function shQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** The file the SessionStart hook writes, in each task's folder. */
export const SESSION_START_FILE = 'session-start.json';

export function hookSettings(taskDir: string): string {
  const target = shQuote(`${taskDir}/${SESSION_START_FILE}`);
  const tmp = shQuote(`${taskDir}/${SESSION_START_FILE}.tmp`);
  const command = `cat > ${tmp} && mv ${tmp} ${target}`;
  return JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command, timeout: 10 }] }],
    },
  });
}

export function readSessionStart(text: string | null): string | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const id = (parsed as { session_id?: unknown } | null)?.session_id;
  return typeof id === 'string' && isUuid(id) ? id : null;
}
