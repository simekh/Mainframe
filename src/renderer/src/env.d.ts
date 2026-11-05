import type { TheSourceApi } from '../../shared/ipc';

declare global {
  interface Window {
    thesource: TheSourceApi;
    /** Test hooks; installed only when the app runs with THESOURCE_E2E=1. */
    __thesourceE2E: {
      taskIds(): string[];
      /** The task's terminal buffer, its running session's or the last one's. */
      screenText(taskId: string): string;
      termSize(taskId: string): { cols: number; rows: number } | null;
      /** The size the task's session was first spawned at, and whether the side panel was out then. */
      firstSpawn(taskId: string): { cols: number; rows: number; panelShown: boolean } | null;
      /** The bridge's spawn, recording each session's first size; terminals spawn through it. */
      spawn: TheSourceApi['spawn'];
    };
  }
}

export {};
