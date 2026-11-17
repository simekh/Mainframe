import { dirname, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cloneRepo, commitFile, git, makeRepo } from '../src/main/testing/makeRepo';
import { cleanUp, launchApp, removeAfterTest } from './launch';
import { boxOf, projectPane as pane, repo, rowButton } from './tasks';

test.afterEach(cleanUp);

/**
 * A user's clone of a Mainframe whose maintainer released v0.1.0, then v0.2.0 with "New: thing" in its notes. The
 * clone is taken `behind` (at v0.1.0) or after v0.2.0 (up to date); removed after the test.
 */
function userClone(at: 'behind' | 'latest'): string {
  const { origin, main } = makeRepo();
  removeAfterTest(dirname(origin));
  git(main, 'tag', 'v0.1.0');
  git(main, 'push', 'origin', 'v0.1.0');
  const user = join(dirname(origin), 'user');
  if (at === 'behind') cloneRepo(origin, user);
  commitFile(main, 'CHANGELOG.md', '## Unreleased\n\n## 0.2.0 · 17 Nov\n\nNew: thing\n');
  git(main, 'tag', 'v0.2.0');
  git(main, 'push', 'origin', 'stage', 'v0.2.0');
  if (at === 'latest') cloneRepo(origin, user);
  return user;
}

const updateEnv = (dir: string, env: Record<string, string> = {}) => ({ MAINFRAME_E2E_UPDATE_DIR: dir, ...env });

/** Settings' Check for Updates…, as on Windows and Linux, which have no menu bar. */
async function checkFromSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-open').click();
  await page.getByTestId('settings-check-updates').click();
}

test('behind a release, one pill shows right before the cog, and its dialog has the notes and, with no launcher, the commands', async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp(updateEnv(userClone('behind')), [acme, globex]);
  const pill = page.getByTestId('update-pill');
  // The first automatic check runs 10 s after start.
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const [p, cog] = [await boxOf(pill), await boxOf(page.getByTestId('settings-open'))];
  expect(p.x + p.width).toBeLessThanOrEqual(cog.x);
  expect(cog.x - (p.x + p.width)).toBeLessThan(16);
  expect(Math.abs(p.y + p.height / 2 - (cog.y + cog.height / 2))).toBeLessThanOrEqual(1);

  // Updates are the app's, not a project's: one pill for the window, with both projects side by side.
  await (await rowButton(page, globex, 'rail-beside')).click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  await expect(pill).toHaveCount(1);

  await pill.click();
  const dialog = page.getByTestId('update-dialog');
  await expect(dialog).toContainText('Mainframe 0.2.0 is available');
  await expect(dialog).toContainText('You have 0.1.0.');
  await expect(dialog).toContainText('New: thing');
  await expect(dialog).toContainText("wasn't started with npm start");
  await expect(dialog.getByTestId('update-commands')).toContainText('v0.2.0');
  await expect(dialog.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  // Later closes it; the pill stays.
  await dialog.getByRole('button', { name: 'Later' }).click();
  await expect(dialog).toBeHidden();
  await expect(pill).toBeVisible();
  await app.close();
});

test('up to date, Settings shows the version and Check for Updates… says so', async () => {
  const { app, page } = await launchApp(updateEnv(userClone('latest')));
  await checkFromSettings(page);
  await expect(page.getByTestId('settings-version-row')).toContainText('Version 0.2.0');
  await expect(page.getByTestId('update-dialog')).toContainText('Mainframe is up to date (0.2.0)');
  await expect(page.getByTestId('update-pill')).toHaveCount(0);
  await app.close();
});

test("with the clone's remote gone, Check for Updates… says it couldn't check, and no pill shows", async () => {
  const clone = userClone('latest');
  git(clone, 'remote', 'set-url', 'origin', join(dirname(clone), 'gone.git'));
  const { app, page } = await launchApp(updateEnv(clone));
  await checkFromSettings(page);
  await expect(page.getByTestId('update-dialog')).toContainText("Couldn't check for updates");
  await expect(page.getByTestId('update-pill')).toHaveCount(0);
  await app.close();
});

test("after an update that didn't finish, the dialog is open at start and says why", async () => {
  const { app, page } = await launchApp(updateEnv(userClone('latest'), { MAINFRAME_UPDATE_FAILED: 'boom' }));
  const dialog = page.getByTestId('update-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#update-heading')).toHaveText("The update didn't finish");
  await expect(dialog).toContainText("The update didn't finish: boom");
  await app.close();
});

test("after an update that didn't finish, with the release still newer, the check at start fills in how to finish it", async () => {
  const { app, page } = await launchApp(updateEnv(userClone('behind'), { MAINFRAME_UPDATE_FAILED: 'boom' }));
  const dialog = page.getByTestId('update-dialog');
  await expect(dialog.locator('#update-heading')).toHaveText('Mainframe 0.2.0 is available');
  await expect(dialog).toContainText("The update didn't finish: boom");
  await expect(dialog.getByTestId('update-commands')).toContainText('v0.2.0');
  await app.close();
});
