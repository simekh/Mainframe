import { writeFile } from 'node:fs/promises';
import type { CheckResult, UpdateAvailable, UpdateView } from '../../shared/types';
import { changelogAt, howToUpdate, releaseRemote, remoteNewest, runningVersion } from './updateGit';
import { compareVersions, formatVersion, notesSince, type Version } from './versions';

/** The exit code that asks start.mjs to update to the tag in its file, then start Mainframe again. */
export const UPDATE_EXIT_CODE = 75;

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const NO_REMOTE = 'This copy of Mainframe has no git remote to check.';

export interface UpdateDeps {
  /** The Mainframe clone to check and update. */
  dir: string;
  /** Where start.mjs reads the tag to update to; undefined when Mainframe wasn't started by it. */
  launcherFile: string | undefined;
  /** Why the last update did not happen, from start.mjs. */
  failure: string | undefined;
  onChange(view: UpdateView): void;
  /** Quits the normal way, ending in UPDATE_EXIT_CODE. */
  requestQuit(): void;
}

/** Checks the clone's remote for newer releases, now and then and when asked, and hands one to start.mjs. One per app. */
export class UpdateService {
  /** The running release, read once: it changes only by an update, which restarts the app. Null on any failure. */
  readonly running: Promise<Version | null>;
  private current: Version | null = null;
  private available: UpdateAvailable | null = null;
  /** The remote and tag the known release came from, for install(). */
  private source: { remote: string; tag: string } | null = null;
  private checking: Promise<CheckResult> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly deps: UpdateDeps) {
    this.running = runningVersion(deps.dir).then(
      (v) => (this.current = v),
      () => null,
    );
  }

  view(): UpdateView {
    return {
      current: this.current && formatVersion(this.current),
      available: this.available,
      failure: this.deps.failure ?? null,
    };
  }

  /** Never rejects: a check that fails says why, and keeps the release it knew of. A check asked for during one joins it. */
  check(): Promise<CheckResult> {
    this.checking ??= this.runCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  /**
   * Leaves the release's tag for start.mjs and quits. Asks git again how first: a commit or an edit since the check
   * would make a fast-forward fail. Rejects when it must be done by hand, with the view showing the commands.
   */
  async install(): Promise<void> {
    const { available, source } = this;
    if (!available || !source) throw new Error('There is no update to install.');
    const how = await howToUpdate(this.deps.dir, source.remote, source.tag, this.deps.launcherFile !== undefined);
    if (how.kind !== 'one-click' || this.deps.launcherFile === undefined) {
      this.show({ ...available, how }, source);
      throw new Error('This update has to be made by hand.');
    }
    await writeFile(this.deps.launcherFile, source.tag);
    this.deps.requestQuit();
  }

  /** The automatic checks: the first shortly after start, then every 6 hours. */
  start(): void {
    this.timers.push(
      setTimeout(() => {
        void this.check();
        this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS));
      }, FIRST_CHECK_MS),
    );
  }

  stop(): void {
    // clearTimeout clears an interval too.
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private async runCheck(): Promise<CheckResult> {
    const { dir } = this.deps;
    const current = await this.running;
    try {
      const remote = await releaseRemote(dir);
      if (!remote) return { kind: 'failed', why: NO_REMOTE };
      const latest = await remoteNewest(dir, remote);
      if (!latest || (current && compareVersions(latest, current) <= 0)) {
        this.show(null, null);
        return { kind: 'up-to-date' };
      }
      const tag = `v${formatVersion(latest)}`;
      // changelogAt fetches the tag, which howToUpdate needs.
      const changelog = await changelogAt(dir, remote, tag);
      const how = await howToUpdate(dir, remote, tag, this.deps.launcherFile !== undefined);
      this.show({ latest: formatVersion(latest), notes: notesSince(changelog, current, latest), how }, { remote, tag });
      return { kind: 'available' };
    } catch (err) {
      return { kind: 'failed', why: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Tells the page only when what it shows changes. */
  private show(available: UpdateAvailable | null, source: { remote: string; tag: string } | null): void {
    const before = JSON.stringify(this.view());
    this.available = available;
    this.source = source;
    const view = this.view();
    if (JSON.stringify(view) !== before) this.deps.onChange(view);
  }
}
