import type { TheSourceApi } from '../../shared/ipc';

declare global {
  interface Window {
    thesource: TheSourceApi;
  }
}

export {};
