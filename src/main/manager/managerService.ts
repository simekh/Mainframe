import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_NAMES, type AgentName, type ManagerView, type ProgramState } from '../../shared/types';
import type { AgentInUse, LaunchArgs } from '../agents/agent';
import { resumePromptFor, TurnTracker } from '../tasks/carryOn';
import { MANAGER_SLUG, projectKey, sessionName } from '../tasks/naming';
import { writeJsonAtomic } from '../tasks/taskStore';
import { rolePrompt } from './rolePrompt';

const MANAGER_FILE = 'manager.json';

/** The version of `manager.json` this build writes and reads. */
const VERSION = 1;

export interface ManagerServiceDeps {
  projectDir: string;
  dataDir: string;
  /** A real program path, for what the agent runs beside it (Claude Code's SessionStart hook); null when no node was found. */
  nodeBin: string | null;
  env: Record<string, string>;
  /** Where Mainframe's MCP server is: its port and token change with each run of the app. */
  mcp: { url: string; token: string };
  /** Asked at each start, so the manager switches agent only then. */
  agent(): AgentInUse;
  onChange(view: ManagerView): void;
  newId?: () => string;
  warn?: (msg: string) => void;
}

/** What `manager.json` holds: where the manager's last turn was, the agent it last ran, and each agent's chat. */
interface ManagerRecord {
  version: number;
  midTurn?: boolean;
  askAgain?: boolean;
  /** Absent in a record from before agents could be picked: Claude Code. */
  agent?: AgentName;
  chats?: Partial<Record<AgentName, string>>;
}

/** The one agent process of the manager, held with its launch until it exits. */
interface Session {
  id: string;
  launch: LaunchArgs;
  startedWithPrompt: boolean;
  /** The record of its chat, as this session leaves it. */
  record: ManagerRecord;
  turn: TurnTracker;
}

export class ManagerService {
  private readonly newId: () => string;
  private readonly warn: (msg: string) => void;
  private readonly dir: string;
  private readonly recordFile: string;
  private session: Session | null = null;
  private starting: Promise<ManagerView> | null = null;

  constructor(private readonly deps: ManagerServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.warn = deps.warn ?? console.warn;
    this.dir = join(deps.dataDir, 'managers', projectKey(deps.projectDir));
    this.recordFile = join(this.dir, MANAGER_FILE);
  }

  view(): ManagerView {
    return { session: this.session ? { id: this.session.id, startedWithPrompt: this.session.startedWithPrompt } : null };
  }

  /** Its running session, as a list: none, or the one. */
  sessionIds(): string[] {
    return this.session ? [this.session.id] : [];
  }

  /**
   * Launches the manager unless it runs; a call while one is under way gets that one's view. Rejects for a
   * `manager.json` from a newer Mainframe.
   */
  start(): Promise<ManagerView> {
    if (this.session) return Promise.resolve(this.view());
    this.starting ??= this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  private async launch(): Promise<ManagerView> {
    const prior = loadRecord(this.recordFile, this.warn);
    const { adapter, bin, setting } = this.deps.agent();
    const name = adapter.name;
    const sameAgent = (prior.agent ?? 'claude') === name;

    const chat = adapter.managerChat(this.dir, prior.chats?.[name]);
    // A carry-on prompt is owed only to the chat of the agent that left it.
    const prompt = chat !== null && sameAgent ? resumePromptFor(prior) : undefined;
    const carryOn = prompt !== undefined;
    // Without a chat to carry on, this starts one as the first launch would.
    const id = chat ?? adapter.newSessionId(this.newId);
    const launch = await adapter.managerLaunch({
      bin,
      nodeBin: this.deps.nodeBin,
      env: this.deps.env,
      dir: this.dir,
      projectDir: this.deps.projectDir,
      name: sessionName(this.deps.projectDir, MANAGER_SLUG),
      mcp: this.deps.mcp,
      rolePrompt: rolePrompt(adapter.instructions),
      chat: id,
      resume: chat !== null,
      prompt,
      setting,
    });
    // midTurn is cleared here; a session whose carry-on prompt never takes sets it again as it ends. askAgain
    // is kept for the same agent, so the prompt owed again is the same one.
    const record: ManagerRecord = {
      version: VERSION,
      midTurn: false,
      askAgain: sameAgent ? prior.askAgain : undefined,
      agent: name,
      chats: { ...prior.chats, [name]: id },
    };
    // Saved first: a start that cannot save it holds no session, so the next one tries again.
    writeJsonAtomic(this.recordFile, record);
    this.session = { id: this.newId(), launch, startedWithPrompt: carryOn, record, turn: new TurnTracker(carryOn) };
    const view = this.view();
    this.deps.onChange(view);
    return view;
  }

  launchSpec(sessionId: string): { argv: string[]; cwd: string; env?: Record<string, string> } {
    if (this.session?.id !== sessionId) throw new Error(`Unknown session ${sessionId}`);
    const { argv, env } = this.session.launch;
    return { argv, cwd: this.deps.projectDir, env };
  }

  /** What the session's OSC 7501 reports say now, as they arrive; null once they are cleared. */
  noteStatus(sessionId: string, state: ProgramState | null): void {
    if (this.session?.id === sessionId) this.session.turn.note(state);
  }

  onSessionExit(sessionId: string): void {
    const session = this.session;
    if (session?.id !== sessionId) return;
    this.session = null;
    if (!session.turn.ending) this.markEnding(session);
    writeJsonAtomic(this.recordFile, session.record);
    this.deps.onChange(this.view());
  }

  beginQuit(): void {
    if (!this.session) return;
    // Now rather than at its exit: the app may be gone before that arrives.
    this.markEnding(this.session);
    // Saved, not sent: nothing the window shows has changed.
    writeJsonAtomic(this.recordFile, this.session.record);
  }

  /** Records on the chat where the session's turn was as its end was decided. */
  private markEnding(session: Session): void {
    Object.assign(session.record, session.turn.end());
  }
}

/**
 * What `manager.json` says, or `{}` when it is missing or cannot be used, which starts a new chat. Throws for
 * one a newer Mainframe wrote: that is neither read nor touched, so that build still has it whole.
 */
function loadRecord(file: string, warn: (msg: string) => void): Partial<ManagerRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Could not read ${file} (${String(err)}); treating it as missing`);
    return {};
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record.version === 'number' && record.version > VERSION) {
    throw new Error(
      `The manager's record ${file} was written by a newer Mainframe (it is version ${record.version}; ` +
        `this one reads version ${VERSION}). It is left as it is. Open this project with the newer Mainframe, ` +
        'or set MAINFRAME_DATA_DIR to another folder.',
    );
  }
  const flag = (value: unknown) => value === undefined || typeof value === 'boolean';
  const isAgent = (value: unknown) => typeof value === 'string' && Object.hasOwn(AGENT_NAMES, value);
  const chats = (value: unknown) =>
    value === undefined ||
    (typeof value === 'object' && value !== null && Object.entries(value).every(([k, v]) => isAgent(k) && typeof v === 'string'));
  if (
    record.version !== VERSION || !flag(record.midTurn) || !flag(record.askAgain) ||
    !(record.agent === undefined || isAgent(record.agent)) || !chats(record.chats)
  ) {
    warn(`Could not use ${file} (it does not hold a version ${VERSION} record); treating it as missing`);
    return {};
  }
  return record as Partial<ManagerRecord>;
}
