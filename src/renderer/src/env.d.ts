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
      /**
       * A cell of the task's terminal buffer, at the row screenText gives its line: its
       * foreground (`#rrggbb`, `default` or `palette n`), and whether xterm draws it bold and underlined.
       */
      cell(taskId: string, row: number, col: number): { fg: string; bold: boolean; underline: boolean } | null;
      /** The size a fit of the task's terminal would give now, with the renderer it has. */
      fitSize(taskId: string): { cols: number; rows: number } | null;
      /** The size the task's session was first spawned at. */
      firstSpawn(taskId: string): { cols: number; rows: number } | null;
      /** The bridge's spawn, recording each session's first size; terminals spawn through it. */
      spawn: TheSourceApi['spawn'];
    };
  }
}

export {};
