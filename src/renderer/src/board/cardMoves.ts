/** Where a card is on screen, and the lane it is in. */
export interface CardSpot {
  left: number;
  top: number;
  lane: string;
}

/** How a card goes from where it was to where it is now. Sub-pixel shifts don't count as moves. */
export function planMove(
  prev: CardSpot | undefined,
  now: CardSpot,
): { kind: 'enter' | 'slide' | 'fly' | 'none'; arrives: boolean } {
  // The one move the owner must notice: a card landing in Needs you.
  const arrives = now.lane === 'needs-you' && prev?.lane !== 'needs-you';
  if (!prev) return { kind: 'enter', arrives };
  const moved = Math.abs(prev.left - now.left) > 1 || Math.abs(prev.top - now.top) > 1;
  if (!moved) return { kind: 'none', arrives };
  return { kind: prev.lane === now.lane ? 'slide' : 'fly', arrives };
}

const SLIDE_MS = 230;
const FLY_MS = 270;
const ENTER_MS = 170;
const ARRIVE_MS = 1400;
/** Parallel Code's --ease-out. */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/** Card id → its copy in flight, and how to end that flight. */
const flights = new Map<string, { copy: HTMLElement; land: () => void }>();
/** A card's slide or entrance, cancelled before the card is measured where it now lies. */
const moving = new WeakMap<HTMLElement, Animation>();

const cardsIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-testid=task-card]')];

/** Where every card is now, by task id. A card in flight is where its copy is, and its flight ends here. */
export function snapshotCards(root: HTMLElement): Map<string, CardSpot> {
  const spots = new Map<string, CardSpot>();
  for (const el of cardsIn(root)) {
    const id = el.dataset.taskId!;
    const { left, top } = (flights.get(id)?.copy ?? el).getBoundingClientRect();
    spots.set(id, { left, top, lane: el.dataset.lane! });
  }
  for (const flight of [...flights.values()]) flight.land();
  return spots;
}

/** Moves each card from where `before` saw it to where it is now. Under reduced motion only the arrival ring plays. */
export function playCardMoves(root: HTMLElement, before: Map<string, CardSpot>, reducedMotion: boolean): void {
  const cards = cardsIn(root);
  for (const el of cards) moving.get(el)?.cancel();
  const measured = cards.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  for (const { el, rect } of measured) {
    const prev = before.get(el.dataset.taskId!);
    const { kind, arrives } = planMove(prev, { left: rect.left, top: rect.top, lane: el.dataset.lane! });
    const flies = kind === 'fly' && !reducedMotion;
    if (arrives) arrive(el, flies ? FLY_MS : 0);
    if (reducedMotion) continue;
    if (kind === 'enter') {
      moving.set(
        el,
        el.animate([{ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, { opacity: 1, transform: 'none' }], {
          duration: ENTER_MS,
          easing: EASE,
        }),
      );
    } else if (kind === 'slide') {
      const from = `translate(${prev!.left - rect.left}px, ${prev!.top - rect.top}px)`;
      moving.set(el, el.animate([{ transform: from }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE }));
    } else if (flies) {
      fly(el, prev!, rect);
    }
  }
}

/** A ring shown once, from the moment the card lands. */
function arrive(el: HTMLElement, delay: number): void {
  el.animate(
    [
      {
        boxShadow:
          '0 0 0 1px color-mix(in srgb, var(--warning) 80%, transparent), 0 0 14px color-mix(in srgb, var(--warning) 22%, transparent)',
      },
      { boxShadow: '0 0 0 1px transparent, 0 0 14px transparent' },
    ],
    { duration: ARRIVE_MS, delay, easing: 'ease-out', fill: 'backwards' },
  );
}

/**
 * Flies a copy of the card from its old spot to its new one, above the board: each lane's list
 * clips what leaves it. The card itself stays hidden until the copy lands.
 */
function fly(el: HTMLElement, from: CardSpot, to: DOMRect): void {
  const id = el.dataset.taskId!;
  const copy = el.cloneNode(true) as HTMLElement;
  // Not a card: nothing that looks for cards or their parts may find it.
  for (const node of copy.querySelectorAll('[data-testid]')) node.removeAttribute('data-testid');
  copy.removeAttribute('data-testid');
  copy.removeAttribute('data-task-id');
  copy.classList.add('card-fly');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  Object.assign(copy.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.body.append(copy);
  el.style.visibility = 'hidden';
  const animation = copy.animate(
    [
      {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
      },
      { transform: 'none', boxShadow: '0 0 0 rgba(0, 0, 0, 0)' },
    ],
    { duration: FLY_MS, easing: EASE },
  );
  const land = () => {
    flights.delete(id);
    animation.cancel();
    copy.remove();
    el.style.visibility = '';
  };
  animation.onfinish = land;
  flights.set(id, { copy, land });
}
