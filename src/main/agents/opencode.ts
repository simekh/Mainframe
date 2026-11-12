import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { MIN_OPENCODE_VERSION, type OpencodeChoices, type ProgramCheck } from '../../shared/types';
import { findExecutable, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';
import { checkProgram, findProgram, type FindOptions, type VersionRunner } from '../setup/programChecks';
import type { AgentAdapter, Instructions, LaunchArgs, ManagerLaunch } from './agent';
import { apiList, listModels, makeOpencodeSync } from './opencodeSync';

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

// Only opencode's own line counts, for the same reason as claude's. It colours that line when FORCE_COLOR is set.
export function parseOpencodeVersion(stdout: string): string | null {
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  return /^opencode v(\d+\.\d+\.\d+)$/.exec(plain.trim())?.[1] ?? null;
}

const checkOpencode = (path: string, run: VersionRunner, files: ExecutableFiles) =>
  checkProgram(path, parseOpencodeVersion, MIN_OPENCODE_VERSION, run, files);

/** Where opencode may be: PATH, then its installer's folder (`~/.opencode/bin`, which the installer may not have put on PATH). */
export function opencodePlaces(lookup: ExecutableLookup): string[] {
  const { env } = lookup;
  const places = [findExecutable('opencode', lookup)];
  if (lookup.platform === 'win32') {
    if (env.USERPROFILE) places.push(win32.join(env.USERPROFILE, '.opencode', 'bin', 'opencode.exe'));
  } else if (env.HOME) {
    places.push(posix.join(env.HOME, '.opencode', 'bin', 'opencode'));
  }
  return [...new Set(places.filter((place) => place !== null))];
}

export const findOpencode = (o: FindOptions): Promise<ProgramCheck> => findProgram(o, opencodePlaces, checkOpencode);

// `api model.list` prints every model whole, which passes execFile's 1 MiB default with a large catalog.
const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Runs opencode with no shell and resolves with what it printed. Its output may hold API keys, so it is never
 * logged, and an error carries only stderr's last line.
 */
export function runOpencode(argv: string[], o: { cwd: string; env: Record<string, string> }): Promise<string> {
  const [file, ...args] = argv;
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: o.cwd, env: o.env, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: MAX_OUTPUT }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const last = stderr.trim().split(/\r?\n/).at(-1);
      reject(new Error(last || (typeof err.code === 'number' ? `opencode exited with code ${err.code}` : err.message)));
    });
  });
}

/**
 * OpenCode's agents in its own order, which puts its default first. Only each id and whether it is a primary agent
 * leave here: the rest of the list can hold API keys (an agent's request headers).
 */
export function opencodeAgents(o: {
  bin: string;
  cwd: string;
  env: Record<string, string>;
  run?: typeof runOpencode;
  /** Only the user's own agents: no project's config is read from `cwd`. */
  noProjectConfig?: boolean;
}): Promise<{ id: string; primary: boolean }[]> {
  const env = { ...o.env, ...(o.noProjectConfig && { OPENCODE_DISABLE_PROJECT_CONFIG: '1' }) };
  return apiList(o.run ?? runOpencode, 'agent', { bin: o.bin, cwd: o.cwd, env }, (data) =>
    (data as { id?: unknown; mode?: unknown; hidden?: unknown }[]).map((a) => ({
      id: String(a.id),
      primary: a.mode !== 'subagent' && !a.hidden,
    })),
  );
}

/**
 * OpenCode's primary agents and its models, listed in a folder of their own in `dataDir`, so no project's
 * config is read. Only ids and the models' kept fields come back: the lists can hold API keys.
 */
export async function opencodeChoices(o: { bin: string; dataDir: string; env: Record<string, string>; run?: typeof runOpencode }): Promise<OpencodeChoices> {
  const dir = join(o.dataDir, 'opencode-lists');
  mkdirSync(dir, { recursive: true });
  const { bin, env, run = runOpencode } = o;
  const [agents, models] = await Promise.all([
    opencodeAgents({ bin, cwd: dir, env, run, noProjectConfig: true }),
    listModels(run, { bin, dir, env }),
  ]);
  const primary = agents.filter((a) => a.primary);
  return { agents: primary.map((a, i) => ({ id: a.id, isDefault: i === 0 })), models };
}

/** What the manager may call without asking. Starting a task asks: OpenCode otherwise allows every tool. */
const MANAGER_RULES = [
  { action: 'mainframe_list_sessions', resource: '*', effect: 'allow' },
  { action: 'mainframe_sync_todo', resource: '*', effect: 'allow' },
  { action: 'mainframe_start_task', resource: '*', effect: 'ask' },
];

/**
 * The manager's OPENCODE_CONFIG_CONTENT. The rules sit under every agent as well, since an agent's own rules come
 * after the top-level ones, and the chat may run on any of them (switched in its terminal, or a subagent). No
 * `model`: the manager runs on the user's own.
 */
export function managerConfig(o: { url: string; token: string; rolesFile: string; agentIds: string[]; defaultAgent?: string }): string {
  return JSON.stringify({
    mcp: { servers: { mainframe: { type: 'remote', url: o.url, headers: { Authorization: `Bearer ${o.token}` }, oauth: false } } },
    permissions: MANAGER_RULES,
    agents: Object.fromEntries(o.agentIds.map((id) => [id, { permissions: MANAGER_RULES }])),
    instructions: [o.rolesFile],
    ...(o.defaultAgent !== undefined && { default_agent: o.defaultAgent }),
  });
}

/**
 * The role prompt goes in a file, as `instructions` takes paths only. The agent Settings names is made the default,
 * which a new chat starts on; one OpenCode no longer lists is left out, so the chat starts on OpenCode's own default.
 */
async function opencodeManagerLaunch(o: ManagerLaunch, run: typeof runOpencode): Promise<LaunchArgs> {
  mkdirSync(o.dir, { recursive: true });
  const rolesFile = join(o.dir, 'role-prompt.md');
  writeFileSync(rolesFile, o.rolePrompt);
  const agentIds = (await opencodeAgents({ bin: o.bin, cwd: o.projectDir, env: o.env, run })).map((a) => a.id);
  const named = o.setting.managerAgent;
  const defaultAgent = named !== undefined && agentIds.includes(named) ? named : undefined;
  return {
    // `-s` creates the chat under this id, or continues it.
    argv: opencodeReopenArgv({ opencodeBin: o.bin, sessionId: o.chat, prompt: o.prompt }),
    env: { ...OPENCODE_ENV, OPENCODE_CONFIG_CONTENT: managerConfig({ ...o.mcp, rolesFile, agentIds, defaultAgent }) },
  };
}

const instructions: Instructions = {
  first: "this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)",
  again: 'those instructions',
  requires: 'those instructions require',
  integrates: 'those instructions integrate',
};

/** OpenCode's adapter. `run` runs opencode's commands that run to an end; tests hand it a fake. */
export function makeOpencodeAgent({ run = runOpencode }: { run?: typeof runOpencode } = {}): AgentAdapter {
  return {
    name: 'opencode',
    envVar: 'MAINFRAME_OPENCODE_BIN',
    find: findOpencode,
    check: checkOpencode,
    // OpenCode sets these in the shells it runs.
    droppedEnv: ['OPENCODE_TERMINAL', 'OPENCODE_PTY_HANDOFF'],
    instructions,
    worktreeNote: ({ branch, worktreePath, projectDir }) =>
      `Mainframe started you in this task's own worktree, ${worktreePath}, on branch ${branch}. The main checkout is ${projectDir}: when you need it, for example to merge, run git there with git -C ${projectDir}.`,
    mainframeAddsWorktree: true,
    worktreesDir: '.mainframe/worktrees',
    needsNode: false,
    newSessionId: newOpencodeSessionId,
    // No `addDir`: OpenCode reads outside the project by default.
    taskStart: (o) => ({ argv: opencodeStartArgv({ opencodeBin: o.bin, sessionId: o.sessionId, prompt: o.prompt }), env: OPENCODE_ENV }),
    taskReopen: (o) => ({ argv: opencodeReopenArgv({ opencodeBin: o.bin, sessionId: o.sessionId, prompt: o.prompt }), env: OPENCODE_ENV }),
    // OpenCode has no SessionStart hook: its task keeps the session Mainframe started, and its manager the chat manager.json saved.
    recordedSession: () => null,
    managerChat: (_dir, saved) => saved ?? null,
    managerLaunch: (o) => opencodeManagerLaunch(o, run),
    sync: makeOpencodeSync({ run, instructions }),
  };
}

export const opencodeAgent = makeOpencodeAgent();
