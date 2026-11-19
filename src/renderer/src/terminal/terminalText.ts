import type { TerminalText } from '../../../shared/types';

/** Gives the terminal the text size and line height; true when either changed, so the caller fits and redraws only then. */
export function terminalTextChanged(term: { options: { fontSize?: number; lineHeight?: number } }, text: TerminalText): boolean {
  const { options } = term;
  if (options.fontSize === text.fontSize && options.lineHeight === text.lineHeight) return false;
  options.fontSize = text.fontSize;
  options.lineHeight = text.lineHeight;
  return true;
}
