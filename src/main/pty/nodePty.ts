import * as pty from 'node-pty';
import type { SpawnPty } from './sessionHost';

/**
 * node-pty's spawn. On Windows it runs through the ConPTY bundled with node-pty, so every Windows
 * gets the same one, not whichever the system has.
 */
export function spawnNodePty(platform: NodeJS.Platform): SpawnPty {
  return (file, args, opts) => pty.spawn(file, args, { ...opts, useConptyDll: platform === 'win32' });
}
