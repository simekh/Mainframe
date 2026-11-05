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

test('the terminal is measured in the bundled JetBrains Mono, loaded before it opens', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  const rows = (await screen(page, a)).split('\n').length; // a fresh shell's buffer is exactly one screen
  const { loaded, cellHeight, fontCellHeight } = await page.evaluate((r) => {
    const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'JetBrains Mono' && f.status === 'loaded');
    const screenEl = document.querySelector<HTMLElement>('.xterm-screen')!;
    // xterm's own measurement: font box height, rounded to device pixels.
    const ctx = new OffscreenCanvas(10, 10).getContext('2d')!;
    ctx.font = "13px 'JetBrains Mono', monospace";
    const m = ctx.measureText('W');
    const dpr = window.devicePixelRatio;
    const fontCellHeight = Math.floor((m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) * dpr) / dpr;
    return { loaded, cellHeight: screenEl.getBoundingClientRect().height / r, fontCellHeight };
  }, rows);
  expect(loaded).toBe(true);
  expect(cellHeight).toBeCloseTo(fontCellHeight, 1);
  await app.close();
});

test('an emoji takes two columns, as Claude Code counts it, so its tables line up', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  // 🍎, one column back, then #: on a two-column emoji the # lands on its second half (blanking
  // the first); on a one-column emoji it replaces the emoji.
  await run(page, "printf 'w-\\360\\237\\215\\216\\033[D#\\n'");
  await expect.poll(() => screen(page, a)).toMatch(/^w-.?#$/m);
  expect(await screen(page, a)).toMatch(/^w- #$/m);
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

test('a new status replaces the old one, so a resolved question leaves no kind behind', async () => {
  const { app, page } = await launchApp();
  await newSession(page);
  await run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(page.getByTestId('session-status').first()).toHaveText('blocked · question');
  await run(page, "printf '\\033]7501;state=done\\033\\\\'");
  await expect(page.getByTestId('session-status').first()).toHaveText('done');
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

const row = (page: Page, id: string) => page.locator(`[data-testid=session-row][data-session-id="${id}"]`);
const alive = (pid: number) => { try { process.kill(pid, 0); return 'alive'; } catch { return 'gone'; } };
async function shellPid(page: Page, id: string, tag: string): Promise<number> {
  await run(page, `echo ${tag}-pid-$$`);
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`${tag}-pid-\\d+`));
  return Number((await screen(page, id)).match(new RegExp(`${tag}-pid-(\\d+)`))![1]);
}

test('closing sessions kills them, moves the selection, and leaves the others running', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  const aPid = await shellPid(page, a, 'a');
  const b = await newSession(page);
  const bPid = await shellPid(page, b, 'b');
  const c = await newSession(page);
  const cPid = await shellPid(page, c, 'c');

  // The selected one: the selection moves to its neighbour.
  await row(page, c).getByTestId('close-session').click();
  expect(await ids(page)).toEqual([a, b]);
  await expect(row(page, b)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => alive(cPid)).toBe('gone');
  // The others keep their screens and processes; nothing was respawned.
  for (const id of [a, b]) expect(await screen(page, id)).not.toContain('Could not start');
  expect(await screen(page, a)).toMatch(/a-pid-\d+/);
  expect([alive(aPid), alive(bPid)]).toEqual(['alive', 'alive']);
  await run(page, 'echo still-$((1+1))');
  await expect.poll(() => screen(page, b)).toContain('still-2');

  // An unselected one: the selection stays.
  await row(page, a).getByTestId('close-session').click();
  expect(await ids(page)).toEqual([b]);
  await expect(row(page, b)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => alive(aPid)).toBe('gone');

  // The last one: the empty state, and a new session still works.
  await row(page, b).getByTestId('close-session').click();
  expect(await ids(page)).toEqual([]);
  await expect.poll(() => alive(bPid)).toBe('gone');
  const d = await newSession(page);
  await run(page, 'echo fresh-$((4+1))');
  await expect.poll(() => screen(page, d)).toContain('fresh-5');
  await app.close();
});

test('an exited session shows exited and closes cleanly', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'exit');
  await expect(row(page, a).getByTestId('session-status')).toHaveText('exited');
  await row(page, a).getByTestId('close-session').click();
  expect(await ids(page)).toEqual([]);
  await app.close();
});
