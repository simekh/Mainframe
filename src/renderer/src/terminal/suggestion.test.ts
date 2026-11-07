import { describe, expect, it } from 'vitest';
import { hasSuggestion } from './suggestion';

const CHOICES = '1: Learn more   2: Knew this already   0: Dismiss';
const SEEN = "✦ You should know · Acme's splash screen has a second line that wraps onto the next row too.";

describe('hasSuggestion', () => {
  it('is true for the block as Claude Code shows it', () => {
    expect(hasSuggestion(['> ', '', SEEN, CHOICES, ''])).toBe(true);
  });

  it('is true when a narrow panel wraps the choices between 0: and Dismiss', () => {
    expect(hasSuggestion([SEEN, '1: Learn more   2: Knew this already   0:', 'Dismiss'])).toBe(true);
  });

  it('is true when the label reads Heads up', () => {
    expect(hasSuggestion(['✦ Heads up · Run /help to list the commands.', CHOICES])).toBe(true);
  });

  it('is true when the block is indented and its text wraps before the choices', () => {
    expect(hasSuggestion(['  ✦ You should know · a long tip', 'that wraps', 'twice', CHOICES])).toBe(true);
  });

  it('is false without the choices line', () => {
    expect(hasSuggestion(['> ', '', SEEN, '', '  ? for shortcuts'])).toBe(false);
  });

  it('is false when the choices are further than three lines on', () => {
    expect(hasSuggestion([SEEN, 'one', 'two', 'three', CHOICES])).toBe(false);
  });

  it('is false for a line that quotes the words', () => {
    expect(hasSuggestion(['⏺ The label reads "✦ You should know · tip" in Claude Code.', CHOICES])).toBe(false);
    expect(hasSuggestion(['You should know · this is a quote, not the block', CHOICES])).toBe(false);
    expect(hasSuggestion(['- ✦ You should know · a bullet', CHOICES])).toBe(false);
  });

  it('is false for a ✦ with no label', () => {
    expect(hasSuggestion(['✦ Pondering…', CHOICES])).toBe(false);
  });

  it('is false for an empty screen', () => {
    expect(hasSuggestion([])).toBe(false);
    expect(hasSuggestion(['', '', ''])).toBe(false);
  });
});
