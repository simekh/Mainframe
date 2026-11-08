import { basename } from 'node:path';
import type { ProjectView } from '../shared/types';
import { writeOpenProjects } from './projects';

/** What the registry needs of a project's task service and of its manager. */
export interface ProjectSessions {
  sessionIds(): string[];
  owns(sessionId: string): boolean;
  /** Records where each session was, as at Quit, so they run again when the project next opens. */
  beginQuit(): void;
}

export interface RegisteredProject {
  service: ProjectSessions;
  manager: ProjectSessions;
  /** Once registered: brings back its open tasks and starts its manager. */
  start(): void;
  /** Once its sessions have ended: lets go of what else it holds. */
  release(): Promise<void>;
}

export interface ProjectRegistryDeps<P> {
  dataDir: string;
  /** Makes a project's services for its folder; throws when it can't. */
  open(dir: string): Promise<P>;
  kill(sessionId: string): void;
  /** Whether a session's process still runs. */
  running(sessionId: string): boolean;
  /** Every change to the list of open projects, with the whole list. */
  onChange(projects: ProjectView[]): void;
  /** How long a close waits for its sessions to end. */
  closeTimeoutMs?: number;
}

const CLOSE_TIMEOUT_MS = 5000;
const POLL_MS = 25;

/** The open projects, in the order the owner opened them, as `projects.json` keeps them. */
export class ProjectRegistry<P extends RegisteredProject> {
  private readonly projects = new Map<string, P>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly closing = new Map<string, Promise<void>>();

  constructor(private readonly deps: ProjectRegistryDeps<P>) {}

  list(): ProjectView[] {
    return [...this.projects.keys()].map((dir) => ({ dir, name: basename(dir) }));
  }

  get(dir: string): P | undefined {
    return this.projects.get(dir);
  }

  /** The task service or the manager that runs the session. */
  ownerOf(sessionId: string): P['service'] | P['manager'] | undefined {
    for (const { service, manager } of this.projects.values()) {
      if (manager.owns(sessionId)) return manager;
      if (service.owns(sessionId)) return service;
    }
    return undefined;
  }

  /** Opens the project unless it is open; one that is closing opens again once its sessions have ended. */
  open(dir: string): Promise<void> {
    if (this.projects.has(dir)) return Promise.resolve();
    let opening = this.opening.get(dir);
    if (!opening) {
      opening = this.openNow(dir).finally(() => this.opening.delete(dir));
      this.opening.set(dir, opening);
    }
    return opening;
  }

  /** Ends the project's sessions as Quit does, so they come back when it opens again. */
  async close(dir: string): Promise<void> {
    const project = this.projects.get(dir);
    if (!project) return;
    this.projects.delete(dir);
    this.changed();
    const closing = this.end(dir, project).finally(() => this.closing.delete(dir));
    this.closing.set(dir, closing);
    await closing;
  }

  beginQuit(): void {
    for (const [dir, project] of this.projects) recordWhereSessionsWere(dir, project);
  }

  private async openNow(dir: string): Promise<void> {
    await this.closing.get(dir);
    const project = await this.deps.open(dir);
    this.projects.set(dir, project);
    this.changed();
    project.start();
  }

  private async end(dir: string, project: P): Promise<void> {
    const { service, manager } = project;
    recordWhereSessionsWere(dir, project);
    const ids = [...service.sessionIds(), ...manager.sessionIds()];
    for (const id of ids) this.deps.kill(id);
    const deadline = Date.now() + (this.deps.closeTimeoutMs ?? CLOSE_TIMEOUT_MS);
    while (ids.some((id) => this.deps.running(id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    await project.release();
  }

  private changed(): void {
    writeOpenProjects(this.deps.dataDir, [...this.projects.keys()]);
    this.deps.onChange(this.list());
  }
}

/** Logged, never thrown: the sessions must still be ended, and the other projects' recorded. */
function recordWhereSessionsWere(dir: string, { service, manager }: RegisteredProject): void {
  for (const [what, sessions] of [['tasks', service], ['manager', manager]] as const) {
    try {
      sessions.beginQuit();
    } catch (err) {
      console.error(`[${what}] could not record where the sessions of ${dir} were`, err);
    }
  }
}
