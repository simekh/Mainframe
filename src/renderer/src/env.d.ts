import type { TheSourceApi } from '../../shared/ipc';

declare global {
  interface Window {
    thesource: TheSourceApi;
    /** Test hooks; installed only when the app runs with THESOURCE_E2E=1. */
    __thesourceE2E: {
      sessionIds(): string[];
      screenText(id: string): string;
    };
  }
}

export {};
