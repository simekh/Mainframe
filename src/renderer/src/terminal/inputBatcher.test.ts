import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { InputBatcher } from './inputBatcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('with interval 0 sends each keystroke at once', () => {
  const sent: string[] = [];
  const b = new InputBatcher({ intervalMs: 0, send: (d) => sent.push(d) });
  b.push('a'); b.push('b');
  expect(sent).toEqual(['a', 'b']);
});

it('with interval 8 sends what arrived within 8 ms together, or at 2048 chars', () => {
  const sent: string[] = [];
  const b = new InputBatcher({ intervalMs: 8, send: (d) => sent.push(d) });
  b.push('a'); b.push('b');
  expect(sent).toEqual([]);
  vi.advanceTimersByTime(8);
  expect(sent).toEqual(['ab']);
  b.push('x'.repeat(2048));
  expect(sent).toHaveLength(2);
});
