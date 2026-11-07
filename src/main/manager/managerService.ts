import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ManagerView, ProgramState } from '../../shared/types';
import { inTurn, resumePromptFor, turnAtEnd } from '../tasks/carryOn';
import { managerArgv, readRecordedSession, writeHookSettings } from '../tasks/launch';
import { sessionName, slugify } from '../tasks/naming';
import { ROLE_PROMPT } from './rolePrompt';

const MANAGER_FILE = 'manager.json';
const MCP_FILE = 'mcp.json';

/** What the manager may call without asking: every tool of the one server, as an allow rule must name it. */
const ALLOWED_TOOLS = ['mcp__mainframe__*'];

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

/** What `manager.json` holds: the chat the manager carries on, and where its last turn was. */
interface ManagerRecord {
  version: number;
  projectDir: string;
  claudeSessionId: string;
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
  /** What its last OSC 7501 report said; null before the first, and after a clear. */
  lastState: ProgramState | null;
  /** Set once it has been told to end: what it reports on the way out is not what its turn was. */
  ending: boolean;
  /** It was launched with a carry-on prompt and has not yet worked or blocked: the prompt has not taken. */
  resumePending: boolean;
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
    const hash = createHash('sha256').update(deps.projectDir).digest('hex').slice(0, 8);
    this.dir = join(deps.dataDir, 'managers', `${slugify(basename(deps.projectDir))}-${hash}`);
    this.recordFile = join(this.dir, MANAGER_FILE);
  }

  view(): ManagerView {
    return { session: this.session ? { id: this.session.id, startedWithPrompt: this.session.startedWithPrompt } : null };
  }

  owns(sessionId: string): boolean {
    return this.session?.id === sessionId;
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

    const recorded = readRecordedSession(this.dir);
    const prompt = recorded === null ? undefined : resumePromptFor(prior);
    const carryOn = prompt !== undefined;
    // Without a recorded conversation none was saved, whether SessionStart fired or not: this starts it as the first launch would.
    const claudeSessionId = recorded ?? this.newId();
    const argv = managerArgv({
      claudeBin: this.deps.claudeBin,
      name: sessionName(this.deps.projectDir, 'manager'),
      claudeSessionId,
      resume: recorded !== null,
      mcpConfigPath,
      settingsPath,
      rolePrompt: ROLE_PROMPT,
      prompt,
    });
    // midTurn is cleared here; a session whose carry-on prompt never takes sets it again as it ends. askAgain
    // is kept, so the prompt owed again is the same one.
    const record = { ...prior, version: VERSION, projectDir: this.deps.projectDir, claudeSessionId, midTurn: false };
    this.session = { id: this.newId(), argv, startedWithPrompt: carryOn, record, lastState: null, ending: false, resumePending: carryOn };
    saveRecord(this.recordFile, record);
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
    const session = this.session;
    if (session?.id !== sessionId || session.ending) return;
    session.lastState = state;
    if (inTurn(state)) session.resumePending = false;
  }

  onSessionExit(sessionId: string): void {
    const session = this.session;
    if (session?.id !== sessionId) return;
    this.session = null;
    if (!session.ending) this.markEnding(session);
    session.record.claudeSessionId = readRecordedSession(this.dir) ?? session.record.claudeSessionId;
    saveRecord(this.recordFile, session.record);
    this.deps.onChange(this.view());
  }

  beginQuit(): void {
    if (!this.session) return;
    // Now rather than at its exit: the app may be gone before that arrives.
    this.markEnding(this.session);
    // Saved, not sent: nothing the window shows has changed.
    saveRecord(this.recordFile, this.session.record);
  }

  /** Records on the chat whether the session ends in the middle of a turn, and whether Claude was waiting for the owner's answer. */
  private markEnding(session: Session): void {
    session.ending = true;
    Object.assign(session.record, turnAtEnd(session.lastState, session.resumePending));
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

function saveRecord(file: string, record: ManagerRecord): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  renameSync(tmp, file);
}
