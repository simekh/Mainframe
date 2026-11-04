import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './launch';

const ids = (page: Page) => page.evaluate(() => window.__thesourceE2E.sessionIds());
const screen = (page: Page, id: string) => page.evaluate((i) => window.__thesourceE2E.screenText(i), id);
async function newSession(page: Page): Promise<string> {
  await page.getByTestId('new-session').click();
  const all = await ids(page);
  const id = all[all.length - 1];
  await expect.poll(() => screen(page, id)).toContain('$');
  return id;
}
async function run(page: Page, line: string) {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

test('typed input reaches the shell and its output shows', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'echo e2e-$((40+2))');
  await expect.poll(() => screen(page, a)).toContain('e2e-42');
  await app.close();
});

test('switching sessions keeps each one intact and shows only the selected one', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'echo first-$((0+1))');
  const b = await newSession(page);
  await run(page, 'echo second-$((1+1))');
  await page.locator(`[data-testid=session-row][data-session-id="${a}"]`).click();
  await expect(page.locator(`[data-testid=session-row][data-session-id="${a}"]`)).toHaveAttribute('data-selected', 'true');
  expect(await screen(page, a)).toContain('first-1');
  expect(await screen(page, a)).not.toContain('second-2');
  expect(await screen(page, b)).toContain('second-2');
  await app.close();
});

test('OSC 7501 status shows on the session row', async () => {
  const { app, page } = await launchApp();
  await newSession(page);
  await run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(page.getByTestId('session-status').first()).toHaveText('blocked · question');
  await app.close();
});

test('a flood in a hidden session arrives in full', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'yes thesource | head -c 3000000; echo flood-$((2+3))');
  await newSession(page);
  await page.waitForTimeout(2000);
  await page.locator(`[data-testid=session-row][data-session-id="${a}"]`).click();
  await expect.poll(() => screen(page, a), { timeout: 30_000 }).toContain('flood-5');
  await app.close();
});

test('an exited session says so, and quitting leaves no session process behind', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'exit');
  await expect.poll(() => screen(page, a)).toContain('[Process exited]');
  const b = await newSession(page);
  await run(page, 'echo pid-$$');
  await expect.poll(() => screen(page, b)).toMatch(/pid-\d+/);
  const pid = Number((await screen(page, b)).match(/pid-(\d+)/)![1]);
  await app.close();
  await expect.poll(() => { try { process.kill(pid, 0); return 'alive'; } catch { return 'gone'; } }).toBe('gone');
});
