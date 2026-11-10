import { describe, expect, it } from 'vitest';
import { commandHeld, commandName, linkClickHeld, shortcutLetter } from './keys';

const mods = (held: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...held,
});

describe('commandHeld', () => {
  it('on the Mac is Cmd, whatever else is held, as before', () => {
    expect(commandHeld(mods({ metaKey: true }), 'darwin')).toBe(true);
    expect(commandHeld(mods({ metaKey: true, ctrlKey: true }), 'darwin')).toBe(true);
    expect(commandHeld(mods({ metaKey: true, altKey: true }), 'darwin')).toBe(true);
    expect(commandHeld(mods({ ctrlKey: true }), 'darwin')).toBe(false);
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

describe('shortcutLetter', () => {
  it('is the letter the key gives, lower case, whichever key it sits on: Dvorak and AZERTY keep what they see', () => {
    expect(shortcutLetter({ key: 'c', code: 'KeyC' })).toBe('c');
    expect(shortcutLetter({ key: 'C', code: 'KeyC' })).toBe('c');
    expect(shortcutLetter({ key: 'c', code: 'KeyI' })).toBe('c');
    expect(shortcutLetter({ key: 'j', code: 'KeyC' })).toBe('j');
    expect(shortcutLetter({ key: 'z', code: 'KeyW' })).toBe('z');
  });

  it('is the letter on the key itself when the layout gives no Latin one: Russian, Greek', () => {
    expect(shortcutLetter({ key: 'с', code: 'KeyC' })).toBe('c');
    expect(shortcutLetter({ key: 'С', code: 'KeyC' })).toBe('c');
    expect(shortcutLetter({ key: 'ц', code: 'KeyW' })).toBe('w');
    expect(shortcutLetter({ key: 'ψ', code: 'KeyC' })).toBe('c');
  });

  it('is nothing for a key that is no letter, or a key that sits on no letter', () => {
    expect(shortcutLetter({ key: 'Enter', code: 'Enter' })).toBe('');
    expect(shortcutLetter({ key: '1', code: 'Digit1' })).toBe('');
    expect(shortcutLetter({ key: '@', code: 'Digit2' })).toBe('');
    expect(shortcutLetter({ key: 'с', code: 'Digit1' })).toBe('');
    expect(shortcutLetter({ key: 'Dead', code: 'Quote' })).toBe('');
  });

  it("is nothing for another ASCII character on a letter's place: Dvorak's , and < sit where W is, AZERTY's , where M is", () => {
    expect(shortcutLetter({ key: ',', code: 'KeyW' })).toBe('');
    expect(shortcutLetter({ key: '<', code: 'KeyW' })).toBe('');
    expect(shortcutLetter({ key: ',', code: 'KeyM' })).toBe('');
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
