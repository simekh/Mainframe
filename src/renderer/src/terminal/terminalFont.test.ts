import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTerminalFont } from './terminalFont';

afterEach(() => vi.restoreAllMocks());

describe('loadTerminalFont', () => {
  it('waits for the regular and the bold terminal font', async () => {
    const load = vi.fn(async (_font: string) => [] as FontFace[]);
    await loadTerminalFont({ load });
    expect(load.mock.calls.map(([font]) => font)).toEqual(["13px 'JetBrains Mono'", "bold 13px 'JetBrains Mono'"]);
  });

  it('still lets the terminals open when the font fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new SyntaxError('Could not resolve the font');
    const load = vi.fn(async (_font: string): Promise<FontFace[]> => {
      throw failure;
    });
    await expect(loadTerminalFont({ load })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('terminal font'), failure);
  });
});
