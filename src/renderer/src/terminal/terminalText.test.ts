import { describe, expect, it } from 'vitest';
import { terminalTextChanged } from './terminalText';

describe('terminalTextChanged', () => {
  it('applies a new size and says it changed', () => {
    const term = { options: { fontSize: 13, lineHeight: 1 } };
    expect(terminalTextChanged(term, { fontSize: 16, lineHeight: 1.3 })).toBe(true);
    expect(term.options).toEqual({ fontSize: 16, lineHeight: 1.3 });
  });

  it('the same values change nothing', () => {
    const options = { fontSize: 13, lineHeight: 1 };
    const term = {
      get options() {
        return new Proxy(options, {
          set: () => {
            throw new Error('options were set');
          },
        });
      },
    };
    expect(terminalTextChanged(term, { fontSize: 13, lineHeight: 1 })).toBe(false);
    expect(options).toEqual({ fontSize: 13, lineHeight: 1 });
  });
});
