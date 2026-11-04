// Adapted from Parallel Code (MIT): scripts/fix-node-pty-spawn-helper.mjs at 97c3558. See THIRD_PARTY_NOTICES.md.
import { chmodSync, existsSync } from 'fs';
import { join } from 'path';
import process from 'process';

if (process.platform === 'darwin') {
  const helperPath = join(
    process.cwd(),
    'node_modules',
    'node-pty',
    'prebuilds',
    `darwin-${process.arch}`,
    'spawn-helper',
  );

  if (existsSync(helperPath)) {
    chmodSync(helperPath, 0o755);
  }
}
