import { describe, it, expect, vi } from 'vitest';
import { installBoardShortcuts } from './shortcuts';

type Handler = (e: KeyboardEvent) => void;

/** A window that only records its keydown listener, and where it was put. */
function fakeWindow() {
  const listeners = new Set<{ handler: Handler; capture: boolean }>();
  const target = {
    addEventListener: (type: string, handler: Handler, capture: boolean) => {
      expect(type).toBe('keydown');
      listeners.add({ handler, capture });
    },
    removeEventListener: (type: string, handler: Handler, capture: boolean) => {
      expect(type).toBe('keydown');
      for (const l of listeners) if (l.handler === handler && l.capture === capture) listeners.delete(l);
    },
  };
  const press = (key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'metaKey' | 'altKey', boolean>> = {}) => {
    const e = { key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...mods } as unknown as KeyboardEvent;
    for (const l of [...listeners]) l.handler(e);
    return e;
  };
  return { target: target as unknown as Window, listeners, press };
}

describe('installBoardShortcuts', () => {
  it('Ctrl+Tab jumps forward and Ctrl+Shift+Tab back, and the key goes no further', () => {
    const w = fakeWindow();
    const jump = vi.fn();
    installBoardShortcuts(w.target, jump);

    const forward = w.press('Tab', { ctrlKey: true });
    expect(jump).toHaveBeenLastCalledWith(1);
    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(forward.stopPropagation).toHaveBeenCalledOnce();

    const back = w.press('Tab', { ctrlKey: true, shiftKey: true });
    expect(jump).toHaveBeenLastCalledWith(-1);
    expect(back.preventDefault).toHaveBeenCalledOnce();
    expect(back.stopPropagation).toHaveBeenCalledOnce();
    expect(jump).toHaveBeenCalledTimes(2);
  });

  it('listens in the capture phase, so the terminal never sees the key', () => {
    const w = fakeWindow();
    installBoardShortcuts(w.target, vi.fn());
    expect([...w.listeners].map((l) => l.capture)).toEqual([true]);
  });

  it('every other key passes through untouched, Cmd+Tab and Option+Tab included', () => {
    const w = fakeWindow();
    const jump = vi.fn();
    installBoardShortcuts(w.target, jump);
    const others = [
      w.press('Tab'),
      w.press('Tab', { shiftKey: true }),
      w.press('Tab', { metaKey: true }),
      w.press('Tab', { ctrlKey: true, metaKey: true }),
      w.press('Tab', { altKey: true }),
      w.press('Tab', { ctrlKey: true, altKey: true, shiftKey: true }),
      w.press('a', { ctrlKey: true }),
      w.press('Enter', { ctrlKey: true }),
    ];
    expect(jump).not.toHaveBeenCalled();
    for (const e of others) {
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopPropagation).not.toHaveBeenCalled();
    }
  });

  it('the returned function removes the listener', () => {
    const w = fakeWindow();
    const jump = vi.fn();
    const remove = installBoardShortcuts(w.target, jump);
    remove();
    expect(w.listeners.size).toBe(0);
    w.press('Tab', { ctrlKey: true });
    expect(jump).not.toHaveBeenCalled();
  });
});
