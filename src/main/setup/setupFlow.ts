import type { ProgramCheck, SetupView } from '../../shared/types';
import type { ExecutableLookup } from '../pty/findExecutable';
import { hasProjectsFile, rememberedProjects } from '../projects';
import { checkClaude, checkGit, findClaude, type VersionRunner } from './programChecks';
import { readSettings, writeSettings, type AppSettings } from './settings';

export interface SetupDeps {
  dataDir: string;
  /** MAINFRAME_CLAUDE_BIN: the only claude looked at, and nothing is saved about it. */
  envClaudeBin?: string;
  lookup: ExecutableLookup;
  run: VersionRunner;
  /** Asks for a claude file; undefined when the user cancels. */
  pickClaude(): Promise<string | undefined>;
  /** Asks for a project folder; undefined when the user cancels. */
  pickFolder(): Promise<string | undefined>;
  /** The setup screen to show, or null when it is to go. */
  onChange(view: SetupView | null): void;
  /** Starts Mainframe on these projects, and settles once they have answered. */
  start(claudeBin: string, projectDirs: string[]): Promise<void>;
  warn(msg: string): void;
}

/**
 * Decides at start whether Mainframe can open the board without a word or needs the setup screen,
 * and what each answer on that screen does. It knows nothing of Electron: `start`, the dialogs and
 * the screen are handed to it.
 */
export class SetupFlow {
  private settings: AppSettings = {};
  /** No projects remembered and no welcome seen. Any other start is a later one. */
  private firstStart = false;
  private lookedAgain = false;
  // Nothing has been looked at before `begin`, so its first pass runs both checks.
  private git: ProgramCheck = { state: 'missing' };
  private claude: ProgramCheck = { state: 'missing' };
  private current: SetupView | null = null;

  constructor(private readonly deps: SetupDeps) {}

  /** Null while no screen is needed: before this settles, and once the projects have started. */
  view(): SetupView | null {
    return this.current;
  }

  /** With everything found at a later start, the projects have started when this settles, and no view was published. */
  async begin(): Promise<void> {
    this.settings = readSettings(this.deps.dataDir, this.deps.warn);
    this.firstStart = !hasProjectsFile(this.deps.dataDir) && !this.settings.welcomeSeen;
    await this.recheck();
    await this.proceed();
  }

  async lookAgain(): Promise<void> {
    await this.recheck();
    this.lookedAgain = this.ready() === null;
    await this.proceed();
  }

  /** Not offered when MAINFRAME_CLAUDE_BIN names the claude: that path wins, and nothing is saved. */
  async findClaude(): Promise<void> {
    if (this.deps.envClaudeBin) return;
    const picked = await this.deps.pickClaude();
    if (picked === undefined) return;
    this.claude = await checkClaude(picked, this.deps.run, this.deps.lookup.files);
    if (this.claude.state === 'found') this.rememberClaude(picked);
    await this.proceed();
  }

  /** The welcome counts as seen only here, so quitting before a project is chosen shows it again. */
  async chooseProject(): Promise<void> {
    const claudeBin = this.ready();
    if (claudeBin === null) return;
    const dir = await this.deps.pickFolder();
    if (dir === undefined) return;
    this.save(this.deps.envClaudeBin ? { welcomeSeen: true } : { welcomeSeen: true, claudeBin });
    await this.deps.start(claudeBin, [dir]);
    this.publish(null);
  }

  /** Looks again at what is not found. A failing claude is tried at its own path first: a file picked by hand may have been updated. */
  private async recheck(): Promise<void> {
    const { envClaudeBin, lookup, run } = this.deps;
    [this.git, this.claude] = await Promise.all([
      this.git.state === 'found' ? this.git : checkGit(lookup, run),
      this.claude.state === 'found'
        ? this.claude
        : findClaude({ fromEnv: envClaudeBin, saved: this.claude.path ?? this.settings.claudeBin, lookup, run }),
    ]);
  }

  /** The claude to run, once git and claude both work. */
  private ready(): string | null {
    return this.git.state === 'found' && this.claude.state === 'found' ? (this.claude.path ?? null) : null;
  }

  private async proceed(): Promise<void> {
    const claudeBin = this.ready();
    if (claudeBin === null) {
      this.show(false);
    } else if (this.firstStart) {
      this.show(true);
    } else {
      this.rememberClaude(claudeBin);
      await this.deps.start(claudeBin, rememberedProjects(this.deps.dataDir, this.deps.warn));
      if (this.current !== null) this.publish(null);
    }
  }

  private rememberClaude(claudeBin: string): void {
    if (this.deps.envClaudeBin || claudeBin === this.settings.claudeBin) return;
    this.save({ claudeBin });
  }

  private save(patch: AppSettings): void {
    this.settings = { ...this.settings, ...patch };
    writeSettings(this.deps.dataDir, this.settings);
  }

  private show(askProject: boolean): void {
    this.publish({
      intro: this.firstStart ? 'welcome' : 'moved',
      git: this.git,
      claude: this.claude,
      claudeFromEnv: Boolean(this.deps.envClaudeBin),
      // The hint is for what is still missing; a claude picked by hand since may have fixed it.
      lookedAgain: this.lookedAgain && !askProject,
      askProject,
      platform: this.deps.lookup.platform,
    });
  }

  private publish(view: SetupView | null): void {
    this.current = view;
    this.deps.onChange(view);
  }
}
