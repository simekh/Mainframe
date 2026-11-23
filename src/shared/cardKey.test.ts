import { expect, it } from 'vitest';
import { cardKey } from './cardKey';

it("takes Trello's own id out of an agent-sync ARI", () => {
  expect(cardKey('ari:cloud:trello::card/workspace/60c1/6b03f0975d81')).toBe('6b03f0975d81');
});

it('leaves any other id whole', () => {
  expect(cardKey('6b03f0975d81')).toBe('6b03f0975d81');
  expect(cardKey('owner/repo#12')).toBe('owner/repo#12');
  expect(cardKey('c128')).toBe('c128');
});
