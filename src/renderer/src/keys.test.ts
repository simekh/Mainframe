import { describe, expect, it } from 'vitest';
import { commandHeld, commandName, linkClickHeld } from './keys';

const mods = (held: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...held,
});

describe('commandHeld', () => {
  it('on the Mac is Cmd, alone of Cmd, Ctrl and Option', () => {
    expect(commandHeld(mods({ metaKey: true }), 'darwin')).toBe(true);
    expect(commandHeld(mods({ ctrlKey: true }), 'darwin')).toBe(false);
    expect(commandHeld(mods({ metaKey: true, ctrlKey: true }), 'darwin')).toBe(false);
    expect(commandHeld(mods({ metaKey: true, altKey: true }), 'darwin')).toBe(false);
    expect(commandHeld(mods(), 'darwin')).toBe(false);
  });

  it.each(['win32', 'linux'] as const)('on %s is Ctrl, alone of Ctrl, Meta and Alt', (platform) => {
    expect(commandHeld(mods({ ctrlKey: true }), platform)).toBe(true);
    expect(commandHeld(mods({ metaKey: true }), platform)).toBe(false);
    expect(commandHeld(mods({ ctrlKey: true, metaKey: true }), platform)).toBe(false);
    expect(commandHeld(mods(), platform)).toBe(false);
  });

  it('is not held for AltGr on Windows, which arrives as Ctrl+Alt', () => {
    expect(commandHeld(mods({ ctrlKey: true, altKey: true }), 'win32')).toBe(false);
  });
});

describe('commandName', () => {
  it('names Cmd on the Mac and Ctrl on Windows and Linux', () => {
    expect(commandName('darwin')).toBe('Cmd');
    expect(commandName('win32')).toBe('Ctrl');
    expect(commandName('linux')).toBe('Ctrl');
  });
});

describe('linkClickHeld', () => {
  it('on the Mac is a Cmd+click, as before', () => {
    expect(linkClickHeld({ metaKey: true, ctrlKey: false }, 'darwin')).toBe(true);
    expect(linkClickHeld({ metaKey: false, ctrlKey: true }, 'darwin')).toBe(false);
  });

  it.each(['win32', 'linux'] as const)('on %s is a Ctrl+click', (platform) => {
    expect(linkClickHeld({ metaKey: false, ctrlKey: true }, platform)).toBe(true);
    expect(linkClickHeld({ metaKey: true, ctrlKey: false }, platform)).toBe(false);
  });
});
