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
  await write('\x1b[?1000l');
  expect(watch.canCopy()).toBe(false);
});

it('never to a program that has not asked about the kitty keyboard protocol, which would read the key as typed text', async () => {
  const { write, watch } = setup();
  await write('\x1b[?1002h\x1b[?1006h');
  expect(watch.canCopy()).toBe(false);
});

it('never to a program that asked but leaves the mouse to the terminal, as xterm then has the selection', async () => {
  const { write, watch } = setup();
  await write('\x1b[?u');
  expect(watch.canCopy()).toBe(false);
});

it('stops watching once disposed', async () => {
  const { write, watch } = setup();
  watch.dispose();
  await write('\x1b[?1000h\x1b[?u');
  expect(watch.canCopy()).toBe(false);
});
