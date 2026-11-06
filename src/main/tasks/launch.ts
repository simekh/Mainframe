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

/**
 * The manager's launch, in the main checkout. `--mcp-config` takes several values, so nothing positional
 * may follow it: the carry-on prompt comes last, after the role prompt.
 */
export function managerArgv(o: {
  claudeBin: string;
  name: string;
  claudeSessionId: string;
  /** Resumes the conversation `claudeSessionId` rather than beginning it. */
  resume: boolean;
  mcpConfigPath: string;
  settingsPath: string;
  rolePrompt: string;
  /** Sent to the resumed conversation as its next prompt: Claude starts no turn of its own after a resume. */
  prompt?: string;
}): string[] {
  if (o.resume && !isUuid(o.claudeSessionId)) throw new Error(`not a session id: ${o.claudeSessionId}`);
  const conversation = o.resume ? ['--resume', o.claudeSessionId] : ['-n', o.name, '--session-id', o.claudeSessionId];
  const prompt = o.prompt === undefined ? [] : [o.prompt];
  return [
    o.claudeBin, ...conversation, '--mcp-config', o.mcpConfigPath, '--settings', o.settingsPath,
    '--append-system-prompt', o.rolePrompt, ...prompt,
  ];
}

function shQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** The file the SessionStart hook writes, in each task's folder and in the manager's. */
export const SESSION_START_FILE = 'session-start.json';

/** The settings file of a session whose folder is `dir`: its SessionStart hook, and `allow` as permission rules. */
export function hookSettings(dir: string, allow: string[] = []): string {
  const target = shQuote(`${dir}/${SESSION_START_FILE}`);
  const tmp = shQuote(`${dir}/${SESSION_START_FILE}.tmp`);
  const command = `cat > ${tmp} && mv ${tmp} ${target}`;
  return JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command, timeout: 10 }] }],
    },
    ...(allow.length > 0 && { permissions: { allow } }),
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
