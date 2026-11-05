import { TERMINAL_FONT, TERMINAL_OPTIONS } from './terminalOptions';

/**
 * xterm measures its cells once, when it opens; a font that loads later would leave rows the wrong height.
 * A font that fails to load must not keep the terminals closed: they then open in the monospace fallback.
 */
export function loadTerminalFont(fonts: Pick<FontFaceSet, 'load'>): Promise<void> {
  const font = `${TERMINAL_OPTIONS.fontSize}px '${TERMINAL_FONT}'`;
  return Promise.all([fonts.load(font), fonts.load(`bold ${font}`)]).then(
    () => undefined,
    (e: unknown) => console.warn('[fonts] the terminal font failed to load; terminals use the fallback', e),
  );
}
