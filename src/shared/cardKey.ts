const TRELLO_ARI = 'ari:cloud:trello::card/';

/**
 * The id a task and a card are matched on: Trello's own id. An agent sync gave Trello cards as an ARI
 * (`ari:cloud:trello::card/workspace/<ws>/<id>`), the direct source gives the bare id. Any other id stays whole.
 */
export function cardKey(id: string): string {
  return id.startsWith(TRELLO_ARI) ? id.slice(id.lastIndexOf('/') + 1) : id;
}

/** Whether two ids name the same card, by `cardKey`. */
export function sameCard(a: string, b: string): boolean {
  return cardKey(a) === cardKey(b);
}
