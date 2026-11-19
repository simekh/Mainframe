import { readFileSync, rmSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import * as z from 'zod/v4';
import { MIN_CODEX_VERSION, type ModelChoices, type ProgramCheck } from '../../shared/types';
import { findExecutable, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';
import { checkProgram, findProgram, type FindOptions, type VersionRunner } from '../setup/programChecks';
import { writeJsonAtomic } from '../tasks/taskStore';
import { MANAGER_TOOL_TIMEOUT_MS } from '../todo/syncRun';
import type { AgentAdapter, ModelPick } from './agent';
import { isUuid } from './claude';
import { runCodex, type Run } from './codexInstructions';
import { makeCodexSync, tomlString } from './codexSync';
import { agentsMdInstructions, mainframeWorktreeNote } from './opencode';

/** Where the manager's Codex finds Mainframe's MCP token: set for its launch alone. */
const CODEX_TOKEN_ENV = 'MAINFRAME_MCP_TOKEN';

/**
 * Keys Codex sets in the shells it runs, and the manager's token, which no other session may hold. CODEX_HOME is the
 * user's own setting, so it stays.
 */
export const CODEX_DROPPED_ENV: readonly string[] = [
  CODEX_TOKEN_ENV,
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_SESSION_ID',
  'CODEX_THREAD_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
  'CODEX_VERSION',
  'CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS',
  'CODEX_MANAGED_BY_NPM',
  'CODEX_MANAGED_PACKAGE_ROOT',
];

/** `-m` and the reasoning effort, as a TOML string, for a pick; nothing for none. */
const codexPickFlags = ({ model, effort }: ModelPick): string[] => [
  ...(model === undefined ? [] : ['-m', model]),
  ...(effort === undefined ? [] : ['-c', `model_reasoning_effort=${tomlString(effort)}`]),
];

/** Only the task's pick is passed: the task runs in its worktree on the user's own config otherwise. */
export function codexStartArgv(o: ModelPick & { codexBin: string; prompt: string }): string[] {
  return [o.codexBin, ...codexPickFlags(o), o.prompt];
}

/** The worktree's latest Codex session, as Codex picks it from the folder it runs in. */
export function codexReopenArgv(o: ModelPick & { codexBin: string; prompt?: string }): string[] {
  return [o.codexBin, 'resume', '--last', ...codexPickFlags(o), ...(o.prompt ? [o.prompt] : [])];
}

// Only codex's own line counts, for the same reason as claude's; colour codes are stripped as for opencode.
export function parseCodexVersion(stdout: string): string | null {
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  return /^codex-cli (\d+\.\d+\.\d+)$/.exec(plain.trim())?.[1] ?? null;
}

const checkCodex = (path: string, run: VersionRunner, files: ExecutableFiles) =>
  checkProgram(path, parseCodexVersion, MIN_CODEX_VERSION, run, files);

/** Where codex may be: PATH, then its installer's folder, which the installer may not have put on PATH. */
export function codexPlaces(lookup: ExecutableLookup): string[] {
  const { env } = lookup;
  const places = [findExecutable('codex', lookup)];
  if (lookup.platform === 'win32') {
    if (env.LOCALAPPDATA) places.push(win32.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  } else if (env.HOME) {
    places.push(posix.join(env.HOME, '.local', 'bin', 'codex'));
  }
  return [...new Set(places.filter((place) => place !== null))];
}

export const findCodex = (o: FindOptions): Promise<ProgramCheck> => findProgram(o, codexPlaces, checkCodex);

export const CODEX_CHAT_FILE = 'codex-chat.json';
const CODEX_FIRST_CALL = 'Before your first answer in a chat, call list_sessions.';

/** The manager's Codex: Mainframe's server with its token from the environment, the tools that act asking first, and the role. */
export function codexManagerArgv(o: { codexBin: string; url: string; rolePrompt: string; resume: string | null; prompt?: string }): string[] {
  const server = 'mcp_servers.mainframe';
  const settings = [
    `${server}.url=${tomlString(o.url)}`,
    `${server}.bearer_token_env_var=${tomlString(CODEX_TOKEN_ENV)}`,
    `${server}.tool_timeout_sec=${MANAGER_TOOL_TIMEOUT_MS / 1000}`,
    ...['list_sessions', 'sync_todo', 'close_session'].map((tool) => `${server}.tools.${tool}.approval_mode="approve"`),
    `${server}.tools.start_task.approval_mode="prompt"`,
    `developer_instructions=${tomlString(`${o.rolePrompt}\n\n${CODEX_FIRST_CALL}`)}`,
  ].flatMap((value) => ['-c', value]);
  return [o.codexBin, ...(o.resume ? ['resume', ...settings, o.resume] : settings), ...(o.prompt ? [o.prompt] : [])];
}

/** The chat Codex named in a Mainframe tool call; null when none was noted or the file holds anything but a session id. */
function codexManagerChat(dir: string): string | null {
  try {
    const { sessionId } = JSON.parse(readFileSync(join(dir, CODEX_CHAT_FILE), 'utf8')) as { sessionId?: unknown };
    // Checked again on reading, as the file can be edited by hand and the id goes into a command line.
    return typeof sessionId === 'string' && isUuid(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}

const CATALOG = z.object({
  models: z.array(z.object({ slug: z.string(), display_name: z.string(), visibility: z.string(), supported_reasoning_levels: z.array(z.object({ effort: z.string() })) })),
});

/**
 * The models Codex's catalog shows in its own picker (`visibility: list`), in its order. Default offers the efforts
 * every one of them supports. Run in Mainframe's data folder, so no project's config is read.
 */
export async function codexTaskModels(o: { bin: string; dataDir: string; env: Record<string, string> }, run: Run = runCodex): Promise<ModelChoices> {
  try {
    const stdout = await run([o.bin, 'debug', 'models'], { cwd: o.dataDir, env: o.env });
    let printed: unknown;
    try {
      printed = JSON.parse(stdout);
    } catch {
      // Not JSON.parse's own message, which quotes the output.
      throw new Error('its answer was not JSON');
    }
    const parsed = CATALOG.safeParse(printed);
    if (!parsed.success) throw new Error('its answer was not the catalog it prints');
    const models = parsed.data.models
      .filter((m) => m.visibility === 'list')
      .map((m) => ({ id: m.slug, name: m.display_name, efforts: m.supported_reasoning_levels.map((l) => l.effort) }));
    const defaultEfforts = models.length === 0 ? [] : models[0].efforts.filter((e) => models.every((m) => m.efforts.includes(e)));
    return { models, defaultEfforts };
  } catch (err) {
    throw new Error(`Codex could not list its models: ${(err as Error).message}`);
  }
}

export const codexAgent: AgentAdapter = {
  name: 'codex',
  envVar: 'MAINFRAME_CODEX_BIN',
  find: findCodex,
  check: checkCodex,
  droppedEnv: CODEX_DROPPED_ENV,
  instructions: agentsMdInstructions,
  worktreeNote: mainframeWorktreeNote,
  mainframeAddsWorktree: true,
  worktreesDir: '.mainframe/worktrees',
  tracksBegan: true,
  needsNode: false,
  // Mainframe's own key for the task, never sent to Codex: a reopen resumes the worktree's latest session.
  newSessionId: (uuid) => uuid(),
  taskStart: (o) => ({ argv: codexStartArgv({ codexBin: o.bin, model: o.model, effort: o.effort, prompt: o.prompt }) }),
  taskReopen: (o) => ({ argv: codexReopenArgv({ codexBin: o.bin, model: o.model, effort: o.effort, prompt: o.prompt }) }),
  taskModels: (o) => codexTaskModels(o),
  // Mainframe never reads Codex's own session store: the task's `began` says whether Codex took the brief.
  recordedSession: () => null,
  chatKept: () => true,
  began: (_taskDir, task) => task.began === true,
  forgetChat: () => {},
  managerChat: codexManagerChat,
  managerLaunch: async (o) => ({
    argv: codexManagerArgv({ codexBin: o.bin, url: o.mcp.url, rolePrompt: o.rolePrompt, resume: o.resume ? o.chat : null, prompt: o.prompt }),
    env: { [CODEX_TOKEN_ENV]: o.mcp.token },
  }),
  // The id goes into a command line, so only a session id's shape is kept.
  noteManagerChat: (dir, sessionId) => {
    if (!isUuid(sessionId)) return;
    writeJsonAtomic(join(dir, CODEX_CHAT_FILE), { sessionId });
  },
  forgetManagerChat: (dir) => rmSync(join(dir, CODEX_CHAT_FILE), { force: true }),
  sync: makeCodexSync(),
};
