import headless from '@xterm/headless';
import { expect, it } from 'vitest';
import { watchProgramCopy } from './programCopy';

const setup = () => {
  const term = new headless.Terminal({ allowProposedApi: true });
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { write, watch: watchProgramCopy(term) };
};

it('hands the copy to a program that captures the mouse and has asked about the kitty keyboard protocol', async () => {
  const { write, watch } = setup();
  expect(watch.canCopy()).toBe(false);
  await write('\x1b[?1000h\x1b[?1006h');
  expect(watch.canCopy()).toBe(false);
  await write('\x1b[?u');
  expect(watch.canCopy()).toBe(true);
});

it('never to a program that has not spoken the kitty keyboard protocol, which would read the key as typed text', async () => {
  const { write, watch } = setup();
  await write('\x1b[?1049h\x1b[?1002h\x1b[?1006h');
  expect(watch.canCopy()).toBe(false);
});

it('never to a program that asked but leaves the mouse to the terminal, as xterm then has the selection', async () => {
  const { write, watch } = setup();
  await write('\x1b[?u');
  expect(watch.canCopy()).toBe(false);
});

it('never to the next program: releasing the mouse, entering the alternate screen or a reset needs the protocol spoken again', async () => {
  const { write, watch } = setup();
  for (const next of ['\x1b[?1000l\x1b[?1000h', '\x1b[?1049h', '\x1bc\x1b[?1000h']) {
    await write('\x1b[?1000h\x1b[?u');
    expect(watch.canCopy()).toBe(true);
    await write(next);
    expect(watch.canCopy()).toBe(false);
  }
});

// The sequences Claude Code v2.1.323 sends around Ctrl+G, with vim (mouse on) as the editor.
it("gives Claude Code's editor nothing, and Claude Code the copy again once it is back", async () => {
  const { write, watch } = setup();
  await write('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?u');
  expect(watch.canCopy()).toBe(true);
  await write('\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[<u\x1b[<u'); // Claude Code hands over the screen
  await write('\x1b[?1049h\x1b[?1000h\x1b[?1006h'); // vim
  expect(watch.canCopy()).toBe(false);
  await write('\x1b[?1000l\x1b[?1049l'); // vim quits
  await write('\x1b[?1049h\x1b[<u\x1b[?1000h\x1b[?1002h\x1b[?1003h'); // Claude Code is back, without asking again
  expect(watch.canCopy()).toBe(true);
});

it('stops watching once disposed', async () => {
  const { write, watch } = setup();
  watch.dispose();
  await write('\x1b[?1000h\x1b[?u');
  expect(watch.canCopy()).toBe(false);
});
