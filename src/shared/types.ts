// OSC 7501 program status (https://superlogical.com/rex/docs/build/program-status).
export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error';
export type ProgramKind = 'permission' | 'question' | 'auth';

export interface ProgramReport {
  state: ProgramState | 'clear';
  /** `/`-separated record path; '' is the root record. */
  id: string;
  kind?: ProgramKind;
  progress?: number;
  app?: string;
  title?: string;
  msg?: string;
}

export interface ProgramStatus extends Omit<ProgramReport, 'state'> {
  state: ProgramState;
  updatedAt: number;
}
