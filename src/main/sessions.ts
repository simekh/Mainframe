import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '../shared/types';

/** The sessions the app has created and how each one is launched. */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionInfo>();
  private count = 0;

  constructor(private readonly opts: { projectDir: string; sessionArgv: string[] }) {}

  create(): SessionInfo {
    const info: SessionInfo = { id: randomUUID(), name: `Session ${++this.count}`, cwd: this.opts.projectDir };
    this.sessions.set(info.id, info);
    return info;
  }

  launchSpec(id: string): { argv: string[]; cwd: string } {
    const info = this.sessions.get(id);
    if (!info) throw new Error(`Unknown session ${id}`);
    return { argv: [...this.opts.sessionArgv], cwd: info.cwd };
  }
}
