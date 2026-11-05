import { describe, it, expect } from 'vitest';
import { planMove, type CardSpot } from './cardMoves';

const at = (lane: string, top: number, left = 0): CardSpot => ({ left, top, lane });

describe('planMove', () => {
  it('a new card enters, and arrives only when it lands in needs-you', () => {
    expect(planMove(undefined, at('working', 0))).toEqual({ kind: 'enter', arrives: false });
    expect(planMove(undefined, at('needs-you', 0))).toEqual({ kind: 'enter', arrives: true });
  });

  it('a card that stays in its lane slides when it moved more than 1 px', () => {
    expect(planMove(at('working', 100), at('working', 140))).toEqual({ kind: 'slide', arrives: false });
    expect(planMove(at('working', 100), at('working', 100.5))).toEqual({ kind: 'none', arrives: false });
    expect(planMove(at('needs-you', 100), at('needs-you', 140))).toEqual({ kind: 'slide', arrives: false });
  });

  it('a card that changes lanes flies, and arrives only into needs-you', () => {
    expect(planMove(at('working', 100, 300), at('needs-you', 60, 40))).toEqual({ kind: 'fly', arrives: true });
    expect(planMove(at('needs-you', 60, 40), at('working', 100, 300))).toEqual({ kind: 'fly', arrives: false });
    expect(planMove(at('working', 100, 300), at('needs-you', 100.5, 300))).toEqual({ kind: 'none', arrives: true });
  });
});
