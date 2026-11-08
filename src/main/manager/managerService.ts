import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ManagerView, ProgramState } from '../../shared/types';
import { resumePromptFor, TurnTracker } from '../tasks/carryOn';
import { managerArgv, writeHookSettings } from '../tasks/launch';
import { MANAGER_SLUG, projectKey, sessionName } from '../tasks/naming';
import { writeJsonAtomic } from '../tasks/taskStore';
import { readResumableSession } from './resumableChat';
import { ROLE_PROMPT } from './rolePrompt';

const MANAGER_FILE = 'manager.json';
const MCP_FILE = 'mcp.json';

/**
 * What the manager may call without asking, as an allow rule names a tool: the read of the sessions, and a sync, whose
 * background run may use only the tools the owner confirmed. Starting a task goes through the owner's permission mode,
 * so the role prompt is not all that stands between the manager and a session.
 */
const ALLOWED_TOOLS = ['mcp__mainframe__list_sessions', 'mcp__mainframe__sync_todo'];

/** The version of `manager.json` this build writes and reads. */
const VERSION = 1;

export interface ManagerServiceDeps {
  projectDir: string;
  dataDir: string;
  claudeBin: string;
  /** The contents of `mcp.json`: the MCP server's port and token change with each run of the app. */
  mcpConfig: string;
  onChange(view: ManagerView): void;
  newId?: () => string;
  warn?: (msg: string) => void;
}

/** What `manager.json` holds: where the manager's last turn was. The chat it carries on is the one SessionStart recorded. */
interface ManagerRecord {
  version: number;
  midTurn?: boolean;
  askAgain?: boolean;
}

/** The one `claude` process of the manager, held with its launch spec until it exits. */
interface Session {
  id: string;
  argv: string[];
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

  /** Launches the manager unless it runs. Throws for a `manager.json` from a newer Mainframe. */
  start(): ManagerView {
    if (this.session) return this.view();
    const prior = loadRecord(this.recordFile, this.warn);

    // Every launch: the port and the token change with each run of the app.
    const settingsPath = writeHookSettings(this.dir, ALLOWED_TOOLS);
    const mcpConfigPath = join(this.dir, MCP_FILE);
    // Made anew, as the mode is only for a file that is made here; one that was there would keep its own.
    rmSync(mcpConfigPath, { force: true });
    writeFileSync(mcpConfigPath, this.deps.mcpConfig, { mode: 0o600 });

    const recorded = readResumableSession(this.dir);
    const prompt = recorded === null ? undefined : resumePromptFor(prior);
    const carryOn = prompt !== undefined;
    // Without a conversation to resume none was saved, whether SessionStart fired or not: this starts it as the first launch would.
    const claudeSessionId = recorded ?? this.newId();
    const argv = managerArgv({
      claudeBin: this.deps.claudeBin,
      name: sessionName(this.deps.projectDir, MANAGER_SLUG),
      claudeSessionId,
      resume: recorded !== null,
      mcpConfigPath,
      settingsPath,
      rolePrompt: ROLE_PROMPT,
      prompt,
    });
    // midTurn is cleared here; a session whose carry-on prompt never takes sets it again as it ends. askAgain
    // is kept, so the prompt owed again is the same one.
    const record: ManagerRecord = { version: VERSION, midTurn: false, askAgain: prior.askAgain };
    // Saved first: a start that cannot save it holds no session, so the next one tries again.
    writeJsonAtomic(this.recordFile, record);
    this.session = { id: this.newId(), argv, startedWithPrompt: carryOn, record, turn: new TurnTracker(carryOn) };
    const view = this.view();
    this.deps.onChange(view);
    return view;
  }

  launchSpec(sessionId: string): { argv: string[]; cwd: string } {
    if (this.session?.id !== sessionId) throw new Error(`Unknown session ${sessionId}`);
    return { argv: this.session.argv, cwd: this.deps.projectDir };
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
  if (record.version !== VERSION || !flag(record.midTurn) || !flag(record.askAgain)) {
    warn(`Could not use ${file} (it does not hold a version ${VERSION} record); treating it as missing`);
    return {};
  }
  return record as Partial<ManagerRecord>;
}
