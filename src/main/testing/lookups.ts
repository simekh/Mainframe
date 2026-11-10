import type { ExecutableFiles } from '../pty/findExecutable';

/** Where nothing runs: the path is only written into settings. */
export const NODE = '/usr/local/bin/node';

/** A computer whose only executable files are `paths`. */
export const files = (...paths: string[]): ExecutableFiles => ({ isExecutableFile: (p) => paths.includes(p) });

/** The lookup a Mac does, over `env`, with `existing` as the executable files. */
export const mac = (env: Record<string, string>, ...existing: string[]) =>
  ({ env, cwd: '/repo', platform: 'darwin' as const, files: files(...existing) });

/** The lookup Windows does, over `env`, with `existing` as the executable files. */
export const win = (env: Record<string, string>, ...existing: string[]) =>
  ({ env, cwd: 'C:\\repo', platform: 'win32' as const, files: files(...existing) });
