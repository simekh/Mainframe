import { describe, it, expect, vi } from 'vitest';
import { installBoardShortcuts } from './shortcuts';

type Handler = (e: KeyboardEvent) => void;
type Mods = Partial<Record<'ctrlKey' | 'shiftKey' | 'metaKey' | 'altKey', boolean>>;

/** A window that only records its keydown listener, and where it was put, and may show a modal dialog. */
function fakeWindow() {
  const listeners = new Set<{ handler: Handler; capture: boolean }>();
  let modal = false;
  const target = {
    document: { querySelector: (selector: string) => (selector === 'dialog:modal' && modal ? {} : null) },
    addEventListener: (type: string, handler: Handler, capture: boolean) => {
      expect(type).toBe('keydown');
      listeners.add({ handler, capture });
    },
    removeEventListener: (type: string, handler: Handler, capture: boolean) => {
      expect(type).toBe('keydown');
      for (const l of listeners) if (l.handler === handler && l.capture === capture) listeners.delete(l);
    },
  };
  /** `code` is the physical key, as the browser names it; it defaults to the key. */
  const press = (key: string, mods: Mods = {}, code = key) => {
    const e = { key, code, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...mods } as unknown as KeyboardEvent;
    for (const l of [...listeners]) l.handler(e);
    return e;
  };
  const openModal = () => void (modal = true);
  return { target: target as unknown as Window, listeners, press, openModal };
}

const install = (w: ReturnType<typeof fakeWindow>, platform: NodeJS.Platform) => {
  const actions = { jump: vi.fn(), focusProject: vi.fn(), closePane: vi.fn(), openProject: vi.fn() };
  return { actions, remove: installBoardShortcuts(w.target, actions, platform) };
};

const swallowed = (e: KeyboardEvent) => {
  expect(e.preventDefault).toHaveBeenCalledOnce();
  expect(e.stopPropagation).toHaveBeenCalledOnce();
};

/** No action ran, and every key went on as if no listener were there. */
const untouched = (actions: ReturnType<typeof install>['actions'], keys: KeyboardEvent[]) => {
  for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  for (const e of keys) {
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  }
};

describe('installBoardShortcuts', () => {
  it('Ctrl+Tab jumps forward and Ctrl+Shift+Tab back, and the key goes no further', () => {
    const w = fakeWindow();
    const { actions } = install(w, 'darwin');

    swallowed(w.press('Tab', { ctrlKey: true }));
    expect(actions.jump).toHaveBeenLastCalledWith(1);
    swallowed(w.press('Tab', { ctrlKey: true, shiftKey: true }));
    expect(actions.jump).toHaveBeenLastCalledWith(-1);
    expect(actions.jump).toHaveBeenCalledTimes(2);
  });

  it('Cmd+1 to Cmd+9 focus the open projects in the order the list shows them, and the key goes no further', () => {
    const w = fakeWindow();
    const { actions } = install(w, 'darwin');

    swallowed(w.press('1', { metaKey: true }, 'Digit1'));
    expect(actions.focusProject).toHaveBeenLastCalledWith(0);
    swallowed(w.press('9', { metaKey: true }, 'Digit9'));
    expect(actions.focusProject).toHaveBeenLastCalledWith(8);
    // The key, not the character: Shift+1 types "!" on most layouts, and "&" is unshifted 1 on a French one.
    swallowed(w.press('&', { metaKey: true }, 'Digit1'));
    expect(actions.focusProject).toHaveBeenLastCalledWith(0);
    expect(actions.focusProject).toHaveBeenCalledTimes(3);
  });

  it("Cmd+W takes the focused project's pane off screen, and the key goes no further", () => {
    const w = fakeWindow();
    const { actions } = install(w, 'darwin');
    swallowed(w.press('w', { metaKey: true }, 'KeyW'));
    // By the character, as macOS's own shortcuts go: W sits elsewhere on some layouts.
    swallowed(w.press('w', { metaKey: true }, 'KeyZ'));
    expect(actions.closePane).toHaveBeenCalledTimes(2);
  });

  it('does nothing while a modal dialog is open, as it blocks what lies behind it, and the key goes no further', () => {
    const w = fakeWindow();
    const { actions } = install(w, 'darwin');
    w.openModal();
    swallowed(w.press('Tab', { ctrlKey: true }));
    swallowed(w.press('1', { metaKey: true }, 'Digit1'));
    swallowed(w.press('w', { metaKey: true }, 'KeyW'));
    expect(actions.jump).not.toHaveBeenCalled();
    expect(actions.focusProject).not.toHaveBeenCalled();
    expect(actions.closePane).not.toHaveBeenCalled();
  });

  it('listens in the capture phase, so the terminal never sees the key', () => {
    const w = fakeWindow();
    install(w, 'darwin');
    expect([...w.listeners].map((l) => l.capture)).toEqual([true]);
  });

  it('every other key passes through untouched, Cmd+Tab, Option+Tab, Cmd+0 and Ctrl+W included', () => {
    const w = fakeWindow();
    const { actions } = install(w, 'darwin');
    const others = [
      w.press('Tab'),
      w.press('Tab', { shiftKey: true }),
      w.press('Tab', { metaKey: true }),
      w.press('Tab', { ctrlKey: true, metaKey: true }),
      w.press('Tab', { altKey: true }),
      w.press('Tab', { ctrlKey: true, altKey: true, shiftKey: true }),
      w.press('a', { ctrlKey: true }),
      w.press('Enter', { ctrlKey: true }),
      w.press('1', {}, 'Digit1'),
      w.press('0', { metaKey: true }, 'Digit0'),
      w.press('!', { metaKey: true, shiftKey: true }, 'Digit1'),
      w.press('1', { metaKey: true, altKey: true }, 'Digit1'),
      w.press('1', { metaKey: true, ctrlKey: true }, 'Digit1'),
      w.press('1', { metaKey: true }, 'Numpad1'),
      // Ctrl+W deletes the word before the cursor in the terminal.
      w.press('w', { ctrlKey: true }, 'KeyW'),
      w.press('W', { metaKey: true, shiftKey: true }, 'KeyW'),
      w.press('w', { metaKey: true, altKey: true }, 'KeyW'),
    ];
    expect(actions.jump).not.toHaveBeenCalled();
    expect(actions.focusProject).not.toHaveBeenCalled();
    expect(actions.closePane).not.toHaveBeenCalled();
    for (const e of others) {
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopPropagation).not.toHaveBeenCalled();
    }
  });

  it("on the Mac, Windows and Linux's Ctrl+1, Ctrl+Shift+W and Ctrl+Shift+O pass through untouched", () => {
    const w = fakeWindow();
    const { actions } = install(w, 'darwin');
    const others = [
      w.press('1', { ctrlKey: true }, 'Digit1'),
      w.press('W', { ctrlKey: true, shiftKey: true }, 'KeyW'),
      w.press('O', { ctrlKey: true, shiftKey: true }, 'KeyO'),
    ];
    untouched(actions, others);
  });

  it('the returned function removes the listener', () => {
    const w = fakeWindow();
    const { actions, remove } = install(w, 'darwin');
    remove();
    expect(w.listeners.size).toBe(0);
    w.press('Tab', { ctrlKey: true });
    w.press('1', { metaKey: true }, 'Digit1');
    w.press('w', { metaKey: true }, 'KeyW');
    expect(actions.jump).not.toHaveBeenCalled();
    expect(actions.focusProject).not.toHaveBeenCalled();
    expect(actions.closePane).not.toHaveBeenCalled();
  });
});

describe.each(['win32', 'linux'] as const)('installBoardShortcuts on %s', (platform) => {
  it('Ctrl+1 to Ctrl+9 focus the open projects in the order the list shows them, and the key goes no further', () => {
    const w = fakeWindow();
    const { actions } = install(w, platform);

    swallowed(w.press('1', { ctrlKey: true }, 'Digit1'));
    expect(actions.focusProject).toHaveBeenLastCalledWith(0);
    swallowed(w.press('9', { ctrlKey: true }, 'Digit9'));
    expect(actions.focusProject).toHaveBeenLastCalledWith(8);
    // The key, not the character, as on the Mac.
    swallowed(w.press('&', { ctrlKey: true }, 'Digit1'));
    expect(actions.focusProject).toHaveBeenLastCalledWith(0);
    expect(actions.focusProject).toHaveBeenCalledTimes(3);
  });

  it("Ctrl+Shift+W takes the focused project's pane off screen, with Caps Lock on too, and the key goes no further", () => {
    const w = fakeWindow();
    const { actions } = install(w, platform);
    swallowed(w.press('W', { ctrlKey: true, shiftKey: true }, 'KeyW'));
    swallowed(w.press('w', { ctrlKey: true, shiftKey: true }, 'KeyW'));
    expect(actions.closePane).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+Shift+O opens a project, with Caps Lock on too, and the key goes no further', () => {
    const w = fakeWindow();
    const { actions } = install(w, platform);
    swallowed(w.press('O', { ctrlKey: true, shiftKey: true }, 'KeyO'));
    swallowed(w.press('o', { ctrlKey: true, shiftKey: true }, 'KeyO'));
    expect(actions.openProject).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+Tab jumps forward and Ctrl+Shift+Tab back, as on the Mac', () => {
    const w = fakeWindow();
    const { actions } = install(w, platform);
    swallowed(w.press('Tab', { ctrlKey: true }));
    expect(actions.jump).toHaveBeenLastCalledWith(1);
    swallowed(w.press('Tab', { ctrlKey: true, shiftKey: true }));
    expect(actions.jump).toHaveBeenLastCalledWith(-1);
    expect(actions.jump).toHaveBeenCalledTimes(2);
  });

  it('does nothing while a modal dialog is open, Open Project included, and the key goes no further', () => {
    const w = fakeWindow();
    const { actions } = install(w, platform);
    w.openModal();
    swallowed(w.press('Tab', { ctrlKey: true }));
    swallowed(w.press('1', { ctrlKey: true }, 'Digit1'));
    swallowed(w.press('W', { ctrlKey: true, shiftKey: true }, 'KeyW'));
    swallowed(w.press('O', { ctrlKey: true, shiftKey: true }, 'KeyO'));
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  it('Ctrl+W, Ctrl+O, the Meta key and AltGr pass through untouched', () => {
    const w = fakeWindow();
    const { actions } = install(w, platform);
    const others = [
      // Ctrl+W deletes the word before the cursor in the terminal, and Ctrl+O is Claude Code's.
      w.press('w', { ctrlKey: true }, 'KeyW'),
      w.press('o', { ctrlKey: true }, 'KeyO'),
      w.press('!', { ctrlKey: true, shiftKey: true }, 'Digit1'),
      // The Mac's keys, with the Windows or Super key in Cmd's place.
      w.press('1', { metaKey: true }, 'Digit1'),
      w.press('w', { metaKey: true }, 'KeyW'),
      // AltGr arrives as Ctrl+Alt on Windows: AltGr+2, 7 and 0 type @ { } on Nordic and German layouts.
      w.press('@', { ctrlKey: true, altKey: true }, 'Digit2'),
      w.press('{', { ctrlKey: true, altKey: true }, 'Digit7'),
      w.press('}', { ctrlKey: true, altKey: true }, 'Digit0'),
      w.press('W', { ctrlKey: true, altKey: true, shiftKey: true }, 'KeyW'),
    ];
    untouched(actions, others);
  });
});
