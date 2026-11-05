import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, cardIn, run, screen, startTask } from './tasks';

test.afterEach(cleanUp);

const blocked = (page: Page) => run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");

/** Whether the focus is in the terminal on show, where typing goes. */
const terminalHasFocus = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('.well > .terminal:not(.terminal--hidden)') != null);

async function expectJumpedTo(page: Page, taskId: string): Promise<void> {
  await expect(card(page, taskId)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => terminalHasFocus(page)).toBe(true);
}

test('Ctrl+Tab goes through the sessions that need you, from the terminal too', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  await blocked(page);
  await expect(cardIn(page, 'needs-you', a)).toHaveCount(1);
  const b = await startTask(page, 'Beta');
  const c = await startTask(page, 'Gamma');
  await blocked(page);
  await expect(cardIn(page, 'needs-you', c)).toHaveCount(1);

  await card(page, b).click();
  await expect(card(page, b)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.type('ech');
  await expect.poll(() => screen(page, b)).toMatch(/\$ ech *$/m);

  // B is not in the queue, so the first key lands on the queue's first entry.
  await page.keyboard.press('Control+Tab');
  await expectJumpedTo(page, a);
  await page.keyboard.press('Control+Tab');
  await expectJumpedTo(page, c);
  await page.keyboard.press('Control+Tab');
  await expectJumpedTo(page, a);
  await page.keyboard.press('Control+Shift+Tab');
  await expectJumpedTo(page, c);
  await page.getByTestId('jump-next').click();
  await expectJumpedTo(page, a);

  // A Tab that had reached B's shell would have completed `ech` to `echo`.
  await card(page, b).click();
  await expect(card(page, b)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page, b)).toContain('ech: command not found');
  await app.close();
});

test('with nothing waiting, Ctrl+Tab changes nothing and still stays out of the terminal, while a plain Tab reaches it', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  const b = await startTask(page, 'Beta');
  await expect(cardIn(page, 'working', a)).toHaveCount(1);
  await expect(cardIn(page, 'working', b)).toHaveCount(1);
  // Beta is selected after its start: select Alpha, so a jump that did something would show.
  await card(page, a).click();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.type('ech');
  await expect.poll(() => screen(page, a)).toMatch(/\$ ech *$/m);

  // Checked after each, since two jumps through a queue of two would end where they began.
  await page.keyboard.press('Control+Tab');
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, b)).toHaveAttribute('data-selected', 'false');
  await page.getByTestId('jump-next').click();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, b)).toHaveAttribute('data-selected', 'false');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page, a)).toContain('ech: command not found');

  await page.keyboard.type('ech');
  await page.keyboard.press('Tab');
  await expect.poll(() => screen(page, a)).toMatch(/\$ echo *$/m);
  await app.close();
});

test('from an unpinned panel that is put away, Ctrl+Tab brings it out with the terminal focused', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  await blocked(page);
  await expect(cardIn(page, 'needs-you', a)).toHaveCount(1);
  await page.getByTestId('panel-pin').click();
  await page.getByTestId('panel-hide').click();
  const panel = page.getByTestId('side-panel');
  await expect(panel).toBeHidden();

  // Alpha is selected already, so no terminal changes hands: only the jump can put the cursor in
  // it, and only once the panel is out.
  await page.keyboard.press('Control+Tab');
  await expect(panel).toBeVisible();
  await expectJumpedTo(page, a);
  await app.close();
});

test('with one session waiting and its message field focused, Ctrl+Tab puts the cursor back in its terminal', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  await blocked(page);
  await expect(cardIn(page, 'needs-you', a)).toHaveCount(1);
  await page.getByTestId('message-field').click();
  await expect(page.getByTestId('message-field')).toBeFocused();
  expect(await terminalHasFocus(page)).toBe(false);

  await page.keyboard.press('Control+Tab');
  await expectJumpedTo(page, a);
  await app.close();
});

test('behind the open New task dialog, Ctrl+Tab changes nothing and the dialog keeps the focus', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  await blocked(page);
  await expect(cardIn(page, 'needs-you', a)).toHaveCount(1);
  const b = await startTask(page, 'Beta');
  await expect(card(page, b)).toHaveAttribute('data-selected', 'true');

  await page.getByTestId('new-task').click();
  await expect(page.getByTestId('new-task-title')).toBeFocused();
  await page.keyboard.press('Control+Tab');
  await expect(card(page, b)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, a)).toHaveAttribute('data-selected', 'false');
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.closest('dialog') != null)).toBe(true);

  // The key waits only while the dialog is open.
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.keyboard.press('Control+Tab');
  await expectJumpedTo(page, a);
  await app.close();
});
