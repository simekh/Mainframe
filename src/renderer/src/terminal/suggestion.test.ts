import { describe, expect, it } from 'vitest';
import { hasSuggestion } from './suggestion';

const CHOICES = '1: Learn more   2: Knew this already   0: Dismiss';
const SEEN = "✦ You should know · Acme's splash screen has a second line that wraps onto the next row too.";

describe('hasSuggestion', () => {
  it.each([
    ['the block as Claude Code shows it', ['> ', '', SEEN, CHOICES, '']],
    ['a narrow panel wrapping the choices between 0: and Dismiss', [SEEN, '1: Learn more   2: Knew this already   0:', 'Dismiss']],
    ['the label Heads up', ['✦ Heads up · Run /help to list the commands.', CHOICES]],
    ['an indented block whose text wraps before the choices', ['  ✦ You should know · a long tip', 'that wraps', 'twice', CHOICES]],
  ])('is true for %s', (_name, lines) => {
    expect(hasSuggestion(lines)).toBe(true);
  });

  it.each([
    ['no choices line', ['> ', '', SEEN, '', '  ? for shortcuts']],
    ['choices further than three lines on', [SEEN, 'one', 'two', 'three', CHOICES]],
    ['a line that quotes the label', ['⏺ The label reads "✦ You should know · tip" in Claude Code.', CHOICES]],
    ['the words without the star', ['You should know · this is a quote, not the block', CHOICES]],
    ['a bullet before the star', ['- ✦ You should know · a bullet', CHOICES]],
    ['a ✦ with no label', ['✦ Pondering…', CHOICES]],
    ['an empty screen', []],
    ['blank lines', ['', '', '']],
  ])('is false for %s', (_name, lines) => {
    expect(hasSuggestion(lines)).toBe(false);
  });
});
