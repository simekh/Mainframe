import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createOutputBatcher } from './outputBatcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (intervalMs: number) => {
  const sent: string[] = [];
  const b = createOutputBatcher({ intervalMs, send: (d) => sent.push(Buffer.from(d).toString()) });
  return { b, sent };
};

it('sends the first chunk after a quiet spell at once and coalesces the rest within the interval', () => {
  const { b, sent } = setup(8);
  b.push('a'); b.push('b'); b.push('c');
  expect(sent).toEqual(['a']);
  vi.advanceTimersByTime(8);
  expect(sent).toEqual(['a', 'bc']);
});

it('sends at once when 64 KiB are queued', () => {
  const { b, sent } = setup(8);
  b.push('a'); b.push('x'.repeat(65536));
  expect(sent).toHaveLength(2);
});

it('with interval 0 sends every chunk at once', () => {
  const { b, sent } = setup(0);
  b.push('a'); b.push('b');
  expect(sent).toEqual(['a', 'b']);
});

it('flush() sends what is queued', () => {
  const { b, sent } = setup(8);
  b.push('a'); b.push('b'); b.flush();
  expect(sent).toEqual(['a', 'b']);
});
