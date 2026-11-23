import { expect, it } from 'vitest';
import { cardKey, sameCard } from './cardKey';

it("takes Trello's own id out of an agent-sync ARI", () => {
  expect(cardKey('ari:cloud:trello::card/workspace/60c1/6b03f0975d81')).toBe('6b03f0975d81');
});

it('leaves any other id whole', () => {
  expect(cardKey('6b03f0975d81')).toBe('6b03f0975d81');
  expect(cardKey('owner/repo#12')).toBe('owner/repo#12');
  expect(cardKey('c128')).toBe('c128');
});

it('matches an ARI and the bare id of one card, and no other', () => {
  expect(sameCard('ari:cloud:trello::card/workspace/60c1/6b03f0975d81', '6b03f0975d81')).toBe(true);
  expect(sameCard('c1', 'c2')).toBe(false);
});
