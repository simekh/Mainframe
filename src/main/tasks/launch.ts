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
}): string[] {
  if (!isUuid(o.claudeSessionId)) throw new Error(`not a session id: ${o.claudeSessionId}`);
  const worktree = o.branchExists ? ['--worktree', o.slug] : [];
  return [o.claudeBin, ...worktree, '--resume', o.claudeSessionId, '--settings', o.settingsPath];
}

function shQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function hookSettings(taskDir: string): string {
  const target = shQuote(`${taskDir}/session-start.json`);
  const tmp = shQuote(`${taskDir}/session-start.json.tmp`);
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
