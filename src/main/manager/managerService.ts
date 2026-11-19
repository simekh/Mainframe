import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAgentName, type AgentName, type ManagerView, type ProgramState } from '../../shared/types';
import type { AgentAdapter, AgentInUse, LaunchArgs } from '../agents/agent';
import { clearImages } from '../images/imageLog';
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
  adapter: AgentAdapter;
  /** It resumed a chat the agent named, rather than starting one. */
  resumed: boolean;
  /** It has reported a state: its chat is one the agent still has. */
  reported: boolean;
  /** The chat id last kept from its tool calls, so a call naming the same chat writes nothing. */
  noted?: string;
}

export class ManagerService {
  private readonly newId: () => string;
  private readonly warn: (msg: string) => void;
  private readonly dir: string;
  private readonly recordFile: string;
  private session: Session | null = null;
  private starting: Promise<ManagerView> | null = null;
  private quitting = false;

  constructor(private readonly deps: ManagerServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.warn = deps.warn ?? console.warn;
    this.dir = join(deps.dataDir, 'managers', projectKey(deps.projectDir));
    this.recordFile = join(this.dir, MANAGER_FILE);
  }

  view(): ManagerView {
    const s = this.session;
    return { session: s ? { id: s.id, startedWithPrompt: s.startedWithPrompt, agent: s.adapter.name } : null };
  }

  /** Where the running session's chat keeps the images it received: one folder per agent, as each agent has its own chat. */
  imagesDir(sessionId: string): string | null {
    return this.session?.id === sessionId ? this.imagesFolder(this.session.adapter.name) : null;
  }

  private imagesFolder(agent: AgentName): string {
    return join(this.dir, 'images', agent);
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
    // The app quit or the project closed while the launch was made: nothing would end a session held now.
    if (this.quitting) return this.view();
    // midTurn is cleared here; a session whose carry-on prompt never takes sets it again as it ends. askAgain
    // is kept for the same agent, so the prompt owed again is the same one.
    const record: ManagerRecord = {
      version: VERSION,
      midTurn: false,
      askAgain: sameAgent ? prior.askAgain : undefined,
      agent: name,
      chats: { ...prior.chats, [name]: id },
    };
    // Saved first: a start that cannot save it holds no session, so the next one tries again. Not every agent's launch makes the folder.
    mkdirSync(this.dir, { recursive: true });
    writeJsonAtomic(this.recordFile, record);
    // A new chat counts its images from #1: the last chat's list goes.
    if (chat === null) clearImages(this.imagesFolder(name));
    this.session = { id: this.newId(), launch, startedWithPrompt: carryOn, record, turn: new TurnTracker(carryOn), adapter, resumed: chat !== null, reported: false };
    const view = this.view();
    this.deps.onChange(view);
    return view;
  }

  launchSpec(sessionId: string): LaunchArgs & { cwd: string } {
    if (this.session?.id !== sessionId) throw new Error(`Unknown session ${sessionId}`);
    return { ...this.session.launch, cwd: this.deps.projectDir };
  }

  /** What the session's OSC 7501 reports say now, as they arrive; null once they are cleared. */
  noteStatus(sessionId: string, state: ProgramState | null): void {
    if (this.session?.id !== sessionId) return;
    this.session.turn.note(state);
    if (state !== null) this.session.reported = true;
  }

  /** A tool call of the running manager, as its agent names its chat: kept, so the next start resumes it. Never throws into the call. */
  noteToolCall(sessionId: string): void {
    const session = this.session;
    if (!session || session.noted === sessionId) return;
    try {
      session.adapter.noteManagerChat?.(this.dir, sessionId);
      session.noted = sessionId;
    } catch (err) {
      this.warn(`Could not keep the manager's chat ${sessionId} (${String(err)}); the next start may not resume it`);
    }
  }

  /** `exit` is the PTY's; a spawn that failed has none. */
  onSessionExit(sessionId: string, exit?: { exitCode: number; signal: number | null }): void {
    const session = this.session;
    if (session?.id !== sessionId) return;
    this.session = null;
    if (!session.turn.ending) this.markEnding(session);
    writeJsonAtomic(this.recordFile, session.record);
    // A resumed chat that never reported and ended by itself with an error is one the agent no longer has. A quit,
    // a closed pane, a restart (a signal) or a spawn that failed ends it for other reasons.
    if (session.resumed && !session.reported && !this.quitting && exit && exit.exitCode !== 0 && !exit.signal) {
      try {
        session.adapter.forgetManagerChat?.(this.dir);
      } catch (err) {
        this.warn(`Could not forget the manager's chat (${String(err)}); the next start may try to resume it`);
      }
    }
    this.deps.onChange(this.view());
  }

  /** As the app's quit or the project's close begins; a start still under way then holds no session. */
  beginQuit(): void {
    this.quitting = true;
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
  const chats = (value: unknown) =>
    value === undefined ||
    (typeof value === 'object' && value !== null && Object.entries(value).every(([k, v]) => isAgentName(k) && typeof v === 'string'));
  if (
    record.version !== VERSION || !flag(record.midTurn) || !flag(record.askAgain) ||
    !(record.agent === undefined || isAgentName(record.agent)) || !chats(record.chats)
  ) {
    warn(`Could not use ${file} (it does not hold a version ${VERSION} record); treating it as missing`);
    return {};
  }
  return record as Partial<ManagerRecord>;
}
