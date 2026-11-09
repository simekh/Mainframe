import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, cardIn, ids, run, screen, startTask, styleOf } from './tasks';

test.afterEach(cleanUp);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch {
    return 'gone';
  }
};

async function shellPid(page: Page, taskId: string, tag: string): Promise<number> {
  // In Git Bash, `$$` is an MSYS process id; process.kill takes the Windows one, which it keeps in /proc.
  await run(page, `echo ${tag}-pid-${process.platform === 'win32' ? '$(cat /proc/$$/winpid)' : '$$'}`);
  await expect.poll(() => screen(page, taskId)).toMatch(new RegExp(`${tag}-pid-\\d+`));
  return Number((await screen(page, taskId)).match(new RegExp(`${tag}-pid-(\\d+)`))![1]);
}

test('typed input reaches the shell and its output shows', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page);
  await run(page, 'echo e2e-$((40+2))');
  await expect.poll(() => screen(page, a)).toContain('e2e-42');
  await app.close();
});

test('the terminal is measured in the bundled JetBrains Mono, loaded before it opens', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page);
  const rows = (await screen(page, a)).split('\n').length; // a fresh shell's buffer is exactly one screen
  const { loaded, cellHeight, fontCellHeight } = await page.evaluate((r) => {
    const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'JetBrains Mono' && f.status === 'loaded');
    const screenEl = document.querySelector<HTMLElement>('.well > .terminal:not(.terminal--hidden) .xterm-screen')!;
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
  const a = await startTask(page);
  // 🍎, one column back, then #: on a two-column emoji the # lands on its second half (blanking
  // the first); on a one-column emoji it replaces the emoji.
  await run(page, "printf 'w-\\360\\237\\215\\216\\033[D#\\n'");
  await expect.poll(() => screen(page, a)).toMatch(/^w-.?#$/m);
  expect(await screen(page, a)).toMatch(/^w- #$/m);
  await app.close();
});

test("bold text and links take the owner's colours", async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page);
  // The words are built by the shell and the https kept in a variable, so the echoed command line
  // holds none of them.
  await run(
    page,
    "u=https; printf '\\033[1m%s\\033[22m %s \\033]8;;%s\\033\\\\%s\\033]8;;\\033\\\\ %s\\n' " +
      'bold-$((40+2)) plain-$((40+2)) "${u}://example.com/" link-$((40+2)) after-$((40+2))',
  );
  await expect.poll(() => screen(page, a)).toContain('after-42');
  expect(await styleOf(page, a, 'bold-42')).toEqual([{ fg: '#addb67', bold: true, underline: false }]);
  expect(await styleOf(page, a, 'plain-42')).toEqual([{ fg: 'default', bold: false, underline: false }]);
  // The underline is xterm's own, under every OSC 8 link.
  expect(await styleOf(page, a, 'link-42')).toEqual([{ fg: '#82aaff', bold: false, underline: true }]);
  expect(await styleOf(page, a, 'after-42')).toEqual([{ fg: 'default', bold: false, underline: false }]);
  await app.close();
});

test('switching tasks keeps each one intact and shows only the selected one', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'First');
  await run(page, 'echo first-$((0+1))');
  await expect.poll(() => screen(page, a)).toContain('first-1');
  const b = await startTask(page, 'Second');
  await run(page, 'echo second-$((1+1))');
  await expect.poll(() => screen(page, b)).toContain('second-2');
  await card(page, a).click();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, b)).toHaveAttribute('data-selected', 'false');
  expect(await screen(page, a)).toContain('first-1');
  expect(await screen(page, a)).not.toContain('second-2');
  expect(await screen(page, b)).toContain('second-2');
  await app.close();
});

test('OSC 7501 status shows on the task card', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page);
  await run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(cardIn(page, 'needs-you', a).getByTestId('task-ask')).toHaveText('Needs input');
  await expect(card(page, a).getByTestId('task-activity')).toHaveText('Asking you a question');
  await app.close();
});

test('a new status replaces the old one, so a resolved question leaves no kind behind', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page);
  await run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(cardIn(page, 'needs-you', a).getByTestId('task-ask')).toHaveText('Needs input');
  await expect(card(page, a).getByTestId('task-activity')).toHaveText('Asking you a question');
  await run(page, "printf '\\033]7501;state=done\\033\\\\'");
  await expect(cardIn(page, 'needs-you', a).getByTestId('task-ask')).toHaveText('Finished its turn');
  // Blocked again without a kind: a question kind left over from the first report would show here.
  await run(page, "printf '\\033]7501;state=blocked\\033\\\\'");
  await expect(cardIn(page, 'needs-you', a).getByTestId('task-ask')).toHaveText('Needs input');
  await expect(card(page, a).getByTestId('task-activity')).toHaveText('Blocked');
  await app.close();
});

test('a flood in a hidden task arrives in full', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Flood');
  // Node writes the flood, as Claude Code writes its output. Git Bash's own programs write to Windows'
  // console at tens of KB a second, too slowly to fill the window that pauses a session, and 3 MB of
  // `yes` took over 40 s on Windows CI with no Mainframe in the way.
  await run(page, `node -e "process.stdout.write('mainframe\\n'.repeat(300000))"; echo flood-$((2+3))`);
  await startTask(page, 'Other');
  await expect(card(page, a)).toHaveAttribute('data-selected', 'false');
  await expect.poll(() => screen(page, a), { timeout: 30_000 }).toContain('flood-5');
  await card(page, a).click();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  expect(await screen(page, a)).toContain('flood-5');
  await app.close();
});

test('quitting leaves no session process behind', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page);
  const pid = await shellPid(page, a, 'a');
  await app.close();
  await expect.poll(() => alive(pid)).toBe('gone');
});

test('Close session ends the process and keeps the task, and the other tasks keep running', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  const aPid = await shellPid(page, a, 'a');
  const b = await startTask(page, 'Beta');
  const bPid = await shellPid(page, b, 'b');
  const c = await startTask(page, 'Gamma');
  const cPid = await shellPid(page, c, 'c');

  await card(page, b).click();
  await expect(card(page, b)).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('close-session').click();

  await expect(cardIn(page, 'closed', b).getByTestId('task-ask')).toHaveText('Closed');
  await expect.poll(() => screen(page, b)).toContain('[Process exited]');
  await expect.poll(() => alive(bPid)).toBe('gone');
  expect(await ids(page)).toEqual([a, b, c]);
  await expect(card(page, b)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('close-session')).toHaveCount(0);

  // The others keep their screens and processes, and still take input.
  expect([alive(aPid), alive(cPid)]).toEqual(['alive', 'alive']);
  for (const [id, tag] of [[a, 'a'], [c, 'c']]) {
    await expect(cardIn(page, 'working', id).getByTestId('task-activity')).toHaveText('Starting…');
    await expect(card(page, id).getByTestId('task-ask')).toHaveCount(0);
    await card(page, id).click();
    await run(page, `echo still-${tag}-$((1+1))`);
    await expect.poll(() => screen(page, id)).toContain(`still-${tag}-2`);
  }
  await app.close();
});
