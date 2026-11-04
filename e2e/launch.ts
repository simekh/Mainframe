import os from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const root = join(__dirname, '..');

export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [root],
    env: {
      ...(process.env as Record<string, string>),
      THESOURCE_E2E: '1',
      THESOURCE_PROJECT_DIR: os.tmpdir(),
      THESOURCE_SESSION_ARGV: '["/bin/bash","--noprofile","--norc"]',
      PS1: '$ ',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      ...env,
    },
  });
  const page = await app.firstWindow();
  return { app, page };
}
